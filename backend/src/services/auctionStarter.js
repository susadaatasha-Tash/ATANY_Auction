// backend/src/services/auctionStarter.js
// Checks for scheduled auctions that should go live (start_time <= NOW()) and notifies watchers
import { pool, isDirectPg } from '../db/pool.js';
import { sendNotificationEmail } from './emailService.js';

export async function startScheduledAuctions() {
  // Status transition is an atomic conditional UPDATE (safe once pool preserves
  // AND status='scheduled'). Multi-instance safety: only the instance that wins
  // the conditional UPDATE proceeds. REST fallback still applies that predicate.
  const nowIso = new Date().toISOString();
  const nowLocal = new Date().toString();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Debug: show scheduler tick
  // console.log(`[auctionStarter] tick ${nowIso} local ${nowLocal} tz ${tz}`);
  // Simple query — no JOINs (REST-compatible)
  const { rows: toStart } = await pool.query(
    "SELECT id, product_id, start_time, end_time, status FROM auctions WHERE status = 'scheduled' AND start_time <= NOW()"
  );
  if (toStart.length) {
    console.log(`[auctionStarter] ${nowIso} (${tz}) found ${toStart.length} to start:`, toStart.map(a=>`${a.id.slice(0,8)} start=${new Date(a.start_time).toISOString()} local=${new Date(a.start_time).toString()} status=${a.status}`).join(' | '));
  }
  // Fetch product names in bulk
  const productIds = [...new Set(toStart.map(a => a.product_id))];
  let productMap = {};
  if (productIds.length) {
    const { rows: products } = await pool.query(
      `SELECT id, name FROM products WHERE id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`,
      productIds
    );
    productMap = Object.fromEntries(products.map(p => [p.id, p.name]));
  }
  for (const auction of toStart) {
    const productName = productMap[auction.product_id] || 'Unknown';
    console.log(`[auctionStarter] processing ${auction.id.slice(0,8)} start=${new Date(auction.start_time).toISOString()} end=${new Date(auction.end_time).toISOString()} status before=${auction.status} now=${new Date().toISOString()}`);
    // Email jobs collected inside the tx but SENT after COMMIT+release:
    // Resend is a network service (15s bound each) and must never hold a pool
    // client / transaction open across N watchers (pool exhaustion → seller
    // mutations waiting on acquisition). Notification-row INSERTs stay in-tx
    // so a rollback still discards them; emails are best-effort anyway.
    const pendingEmails = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Atomic claim: only transition scheduled→live; multi-instance safe.
      // Requires pool REST UPDATE to preserve AND status='scheduled' (see parseSimpleWhere).
      const up = await client.query("UPDATE auctions SET status = 'live' WHERE id = $1 AND status = 'scheduled' RETURNING id", [auction.id]);
      if ((up.rowCount ?? up.rows?.length ?? 0) === 0) {
        await client.query('ROLLBACK');
        console.log(`[auctionStarter] ${auction.id.slice(0,8)} skip — already live (rowCount 0)`);
        continue;
      }
      console.log(`[auctionStarter] ${auction.id.slice(0,8)} transitioned scheduled→live at ${new Date().toISOString()}`);
      // Find users who clicked Notify Me for this auction (separate from watchlist)
      const { rows: watchers } = await client.query('SELECT user_id FROM auction_reminders WHERE auction_id = $1', [auction.id]);
      for (const w of watchers) {
        const message = `Your watched auction "${productName}" is now live! Place your bid now.`;
        const { shouldDeliverNotification } = await import('./notificationPreference.js');
        if (await shouldDeliverNotification(w.user_id, 'auction', message)) {
          await client.query("INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1, 'auction', $2, $3)", [w.user_id, message, auction.id]);
        }
        // Queue email for after COMMIT — do not await network inside the tx.
        try {
          const { rows: userRows } = await client.query('SELECT email FROM users WHERE id = $1', [w.user_id]);
          if (userRows[0]?.email) {
            pendingEmails.push({
              to: userRows[0].email,
              subject: `ATANY: ${productName} is now live`,
              html: `<p>${message}</p><p><a href="${process.env.FRONTEND_URL || 'http://localhost:5174'}/customer/live">View auction</a></p>`,
            });
          }
        } catch (emailErr) {
          console.warn('Failed to queue live notification email', emailErr.message);
        }
      }
      // Keep reminders until auction ends or user removes — do NOT delete immediately after start
      // Deleting before frontend Realtime GET causes race: GET returns 0 → no popup (BUG 2)
      // Cleanup will happen when auction ends or via explicit user toggle
      await client.query('COMMIT');
      console.log(`Auction ${auction.id} (${productName}) started, notified ${watchers.length} watchers`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('startScheduledAuctions error', auction.id, e);
      pendingEmails.length = 0;
    } finally {
      client.release();
    }
    // Outside the transaction/client: fire queued emails (best effort, same
    // per-email error handling as before — a failed email never rolls back).
    for (const mail of pendingEmails) {
      try {
        await sendNotificationEmail(mail);
      } catch (emailErr) {
        console.warn('Failed to send live notification email', emailErr.message);
      }
    }
    // Other-branch live auction notification (outside transaction, after status is live)
    try {
      const { rows: prodRows } = await pool.query('SELECT shop_id FROM products WHERE id = $1', [auction.product_id]);
      const shopId = prodRows[0]?.shop_id;
      if (shopId) {
        const { rows: shopRows } = await pool.query('SELECT home_branch_id FROM shops WHERE id = $1', [shopId]);
        const branchId = shopRows[0]?.home_branch_id;
        if (branchId) {
          const { rows: branchRows } = await pool.query('SELECT name FROM branches WHERE id = $1', [branchId]);
          const branchName = branchRows[0]?.name || 'Branch';
          // Fetch auction details for notification
          const { rows: aucRows } = await pool.query('SELECT start_price FROM auctions WHERE id = $1', [auction.id]);
          const startPrice = aucRows[0]?.start_price || 0;
          const otherNotifMsg = `New Live Auction at ${branchName}\n\nA new auction is now live at ${branchName}.\n${productName} — Starting price: ₱${Number(startPrice).toLocaleString()}\n\nView Auction`;
          const { rows: otherCustomers } = await pool.query('SELECT id FROM users WHERE preferred_branch_id IS NOT NULL AND preferred_branch_id != $1 AND role = $2', [branchId, 'customer']);
          for (const cust of otherCustomers.rows) {
            const { shouldDeliverNotification } = await import('./notificationPreference.js');
            if (await shouldDeliverNotification(cust.id, 'auction', otherNotifMsg)) {
              // Duplicate guard keyed to this auction; message wording unchanged.
              let dupOB = [];
              try {
                const { rows } = await pool.query(
                  `SELECT id FROM notifications WHERE user_id=$1 AND auction_id=$2 AND message LIKE $3 LIMIT 1`,
                  [cust.id, auction.id, 'New Live Auction at%']
                );
                dupOB = rows;
              } catch (gErr) {
                // notifications.auction_id column absent: fall back to legacy unguarded insert
                if (gErr.code !== '42703') throw gErr;
              }
              if (dupOB.length) continue;
              try {
                await pool.query('INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1, $2, $3, $4)', [cust.id, 'auction', otherNotifMsg, auction.id]);
              } catch (insErr) {
                if (insErr.code !== '42703') throw insErr;
                await pool.query('INSERT INTO notifications (user_id, type, message) VALUES ($1, $2, $3)', [cust.id, 'auction', otherNotifMsg]);
              }
            }
          }
          if (otherCustomers.rows.length) console.log(`Other-branch notification for auction ${auction.id} at ${branchName}: notified ${otherCustomers.rows.length} customers`);
        }
      }
    } catch (notifErr) {
      console.warn('[other-branch starter notification] failed:', notifErr.message);
    }
  }
}
