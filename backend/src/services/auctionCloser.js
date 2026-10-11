// backend/src/services/auctionCloser.js
// Spec 5.2: winner decided server-side by cron/pg_cron, never by client timer.
// Run every minute via node-cron or pg_cron job. Closes auctions where end_time <= NOW() and status != ended
import { pool, isDirectPg } from '../db/pool.js';
import { requireDirectPg } from '../db/dbGuard.js';
import { sendNotificationEmail } from './emailService.js';
import { closeSingleAuction } from './auctionClosingService.js';

export async function closeExpiredAuctions() {
  // H2: closing auctions creates winner orders (money path). REST fallback cannot
  // guarantee multi-statement atomicity → fail closed rather than risk duplicate orders.
  // Atomic claim: UPDATE auctions SET status='ended' WHERE id=$1 AND status != 'ended' RETURNING id — via closeSingleAuction
  let direct = true;
  try { direct = typeof isDirectPg === 'function' ? !!isDirectPg() : true; } catch { direct = false; }
  if (!direct) {
    console.warn('[auctionCloser] skipping — direct Postgres unavailable (fail closed)');
    return { skipped: true, reason: 'DB_UNAVAILABLE' };
  }
  const { rows } = await pool.query("SELECT id FROM auctions WHERE status != 'ended' AND end_time <= NOW() AND status != 'paused'");
  for (const a of rows) {
    let closeResult;
    try {
      closeResult = await closeSingleAuction(a.id);
    } catch (e) {
      if (e.code === 'DB_UNAVAILABLE') {
        console.warn('[auctionCloser] skipping auction', a.id, '—', e.message);
        continue;
      }
      console.error('closeExpiredAuctions error', a.id, e);
      continue;
    }
    if (closeResult.alreadyEnded) continue;
    const winnerId = closeResult.winnerId;
    const orderId = closeResult.orderId;
    // After authoritative commit: notify winner via in-app + email (REST-compatible simple queries)
      if (winnerId) {
        try {
          const { rows: orderRows } = await pool.query('SELECT * FROM orders WHERE id=$1', [orderId]);
          const oRow = orderRows[0];
          const { rows: userRows } = await pool.query('SELECT email, name FROM users WHERE id=$1', [oRow?.buyer_id || winnerId]);
          const { rows: aucRows } = await pool.query('SELECT auction_code, product_id FROM auctions WHERE id=$1', [oRow?.auction_id || a.id]);
          const { rows: prodRows } = await pool.query('SELECT name, image_url FROM products WHERE id=$1', [aucRows[0]?.product_id]);
          const { rows: branchRows } = oRow?.branch_id ? await pool.query('SELECT name, address, hours, phone FROM branches WHERE id=$1', [oRow.branch_id]) : { rows: [] };
          const d = {
            email: userRows[0]?.email,
            user_name: userRows[0]?.name,
            product_name: prodRows[0]?.name,
            image_url: prodRows[0]?.image_url,
            winning_bid: oRow?.amount,
            transaction_code: oRow?.transaction_code,
            auction_code: aucRows[0]?.auction_code,
            branch_name: branchRows[0]?.name,
            branch_address: branchRows[0]?.address,
            branch_hours: branchRows[0]?.hours,
            branch_phone: branchRows[0]?.phone,
          };
          if (d) {
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5174';
            const branchInfo = d.branch_name ? `${d.branch_name} — ${d.branch_address || ''} ${d.branch_hours ? `(${d.branch_hours})` : ''}`.trim() : 'Designated ATANY branch (see order details)';
            const paymentLink = `${frontendUrl}/customer/purchases`;
            const claimDeadlineNote = 'Please claim within 7 business days as per ATANY store policy (contact support if you need an extension).';
            // In-app notification (bell) — idempotent: skip if already notified for this order
            const { rows: existingNotif } = await pool.query(
              "SELECT id FROM notifications WHERE user_id=$1 AND message LIKE $2 AND created_at > NOW() - INTERVAL '1 day'",
              [winnerId, `%${d.product_name}%`]
            );
            if (!existingNotif.length) {
              const { shouldDeliverNotification } = await import('./notificationPreference.js');
              // Payment deadline = stored payment_deadline, else (winner_confirmed_at || created_at) + 7 days
              // (same fallback as winnerExpiration + order/payment display controllers)
              const winnerConfirmedAt = oRow?.winner_confirmed_at || oRow?.created_at;
              const paymentDeadlineIso = oRow?.payment_deadline || (winnerConfirmedAt ? new Date(new Date(winnerConfirmedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() : null);
              const paymentDeadlineStr = paymentDeadlineIso ? new Date(paymentDeadlineIso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
              const winMsg = `🎉 You won "${d.product_name}" for ₱${Number(d.winning_bid).toLocaleString()}! Transaction ${d.transaction_code} was for auction ${d.auction_code} — Pickup at ${d.branch_name || 'branch'} — bring valid government-issued ID.${paymentDeadlineStr ? ` Your PAYMENT is due by ${paymentDeadlineStr}. You have 7 days to complete payment.` : ''} ${claimDeadlineNote}`;
              if (await shouldDeliverNotification(winnerId, 'auction', winMsg)) {
                // Include auction_id when the column exists (migration 022); fall back without it
                try {
                  await pool.query(
                    "INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1, 'auction', $2, $3)",
                    [winnerId, winMsg, oRow?.auction_id || a.id]
                  );
                } catch (insErr) {
                  if (insErr.code !== '42703') throw insErr;
                  await pool.query(
                    "INSERT INTO notifications (user_id, type, message) VALUES ($1, 'auction', $2)",
                    [winnerId, winMsg]
                  );
                }
              }
            }
            // Problem 4B: seller + admin winner notifications (additive; failures never break winner flow)
            try {
              const { rows: prodShopRows } = await pool.query('SELECT shop_id FROM products WHERE id=$1', [aucRows[0]?.product_id]);
              const shopId = prodShopRows[0]?.shop_id;
              let sellerId = null;
              let shopName = null;
              if (shopId) {
                const { rows: shopRows } = await pool.query('SELECT user_id, shop_name FROM shops WHERE id=$1', [shopId]);
                sellerId = shopRows[0]?.user_id || null;
                shopName = shopRows[0]?.shop_name || null;
              }
              const txRef = d.transaction_code || String(orderId).slice(0, 8);
              const sellerMsg = `🏆 Your auction for "${d.product_name}" has a winner: ${d.user_name || 'A customer'} with a winning bid of ₱${Number(d.winning_bid).toLocaleString()}. Order ${txRef}. Status: Awaiting Payment. The winner has 7 days to complete payment. [Seller Winner Notice ${txRef}]`;
              const adminMsg = `🏆 Auction winner confirmed: "${d.product_name}" — ${d.user_name || 'A customer'} won with ₱${Number(d.winning_bid).toLocaleString()}. Order ${txRef}. Shop: ${shopName || 'Unknown shop'}.${d.branch_name ? ` Branch: ${d.branch_name}.` : ''} Status: Awaiting Payment. [Admin Winner Notice ${txRef}]`;
              const { shouldDeliverNotification: shouldDeliver4B } = await import('./notificationPreference.js');
              const insert4B = async (uid, msg) => {
                try {
                  await pool.query("INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1, 'auction', $2, $3)", [uid, msg, oRow?.auction_id || a.id]);
                } catch (insErr) {
                  if (insErr.code !== '42703') throw insErr;
                  await pool.query("INSERT INTO notifications (user_id, type, message) VALUES ($1, 'auction', $2)", [uid, msg]);
                }
              };
              // Seller (skip when the shop has no owner; never throws)
              if (sellerId) {
                try {
                  const { rows: dupS } = await pool.query(
                    `SELECT id FROM notifications WHERE user_id=$1 AND message LIKE $2 AND message LIKE $3 LIMIT 1`,
                    [sellerId, `%${txRef}%`, `%Seller Winner Notice%`]
                  );
                  if (!dupS.length && await shouldDeliver4B(sellerId, 'auction', sellerMsg)) {
                    await insert4B(sellerId, sellerMsg);
                  }
                } catch (e) { console.warn('[4B] seller winner notification failed for auction', a.id, e.message); }
              }
              // Admins individually (one failure never blocks the others)
              try {
                const { rows: admins } = await pool.query(`SELECT id FROM users WHERE role='admin' LIMIT 5`);
                for (const adm of admins) {
                  try {
                    const { rows: dupA } = await pool.query(
                      `SELECT id FROM notifications WHERE user_id=$1 AND message LIKE $2 AND message LIKE $3 LIMIT 1`,
                      [adm.id, `%${txRef}%`, `%Admin Winner Notice%`]
                    );
                    if (!dupA.length && await shouldDeliver4B(adm.id, 'auction', adminMsg)) {
                      await insert4B(adm.id, adminMsg);
                    }
                  } catch (e) { console.warn('[4B] admin winner notification failed for auction', a.id, e.message); }
                }
              } catch (e) { console.warn('[4B] admin lookup failed for auction', a.id, e.message); }
            } catch (e) { console.warn('[4B] seller/admin winner notifications failed for auction', a.id, e.message); }
            // Email via Resend (reuses existing emailService, handles missing key gracefully)
            if (d.email) {
              const html = `
                <div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif; color:#1a1a1a; max-width:600px;">
                  <h2 style="color:#0f3d2e;">Congratulations, ${d.user_name || 'ATANY winner'}! 🎉</h2>
                  <p>You won the auction for <strong>${d.product_name}</strong> with a winning bid of <strong>₱${Number(d.winning_bid).toLocaleString()}</strong>.</p>
                  ${d.image_url ? `<p><img src="${d.image_url}" alt="${d.product_name}" style="max-width:400px; border-radius:8px; border:1px solid #e5e7eb;" /></p>` : ''}
                  <h3 style="color:#0f3d2e;">Pickup Instructions</h3>
                  <p><strong>Pickup Branch:</strong> ${branchInfo}${d.branch_phone ? ` — ${d.branch_phone}` : ''}</p>
                  <p><strong>What to bring:</strong> Please bring a <strong>valid government-issued ID</strong> (e.g. passport, driver's license, UMID) for verification when claiming your item. The ID name must match your ATANY account.</p>
                  <h3 style="color:#0f3d2e;">Payment</h3>
                  <p>Please complete payment before pickup via your purchases page: <a href="${paymentLink}" style="color:#0f3d2e; font-weight:600;">${paymentLink}</a> (GCash / card via PayMongo sandbox).</p>
                  <p style="font-size:13px; color:#6b7280;">${claimDeadlineNote}</p>
                  <p style="font-size:13px; color:#6b7280;">Transaction ${d.transaction_code} (Order #${orderId}) — Auction ${d.auction_code} (#${a.id}) — ATANY Timeless Beauty</p>
                </div>
              `;
              await sendNotificationEmail({
                to: d.email,
                subject: `ATANY: You won "${d.product_name}" — ₱${Number(d.winning_bid).toLocaleString()}`,
                html,
              });
              console.log(`Win notification sent to ${d.email} for auction ${a.id} (${d.product_name})`);
            }
          }
        } catch (notifyErr) {
          console.error('Win notification failed for auction', a.id, notifyErr.message);
        }
      }
  }
}

// In server entry: import cron from 'node-cron'; cron.schedule('* * * * *', closeExpiredAuctions);
