// backend/src/services/auctionStarter.js
// Checks for scheduled auctions that should go live (start_time <= NOW()) and notifies watchers
import { pool } from '../db/pool.js';
import { sendNotificationEmail } from './emailService.js';

export async function startScheduledAuctions() {
  // Simple query — no JOINs (REST-compatible)
  const { rows: toStart } = await pool.query(
    "SELECT id, product_id FROM auctions WHERE status = 'scheduled' AND start_time <= NOW()"
  );
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
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE auctions SET status = 'live' WHERE id = $1", [auction.id]);
      // Find users who clicked Notify Me for this auction (separate from watchlist)
      const { rows: watchers } = await client.query('SELECT user_id FROM auction_reminders WHERE auction_id = $1', [auction.id]);
      for (const w of watchers) {
        const message = `Your watched auction "${productName}" is now live! Place your bid now.`;
        await client.query("INSERT INTO notifications (user_id, type, message) VALUES ($1, 'auction', $2)", [w.user_id, message]);
        // Fire email via Resend (non-blocking, best effort)
        try {
          const { rows: userRows } = await client.query('SELECT email FROM users WHERE id = $1', [w.user_id]);
          if (userRows[0]?.email) {
            await sendNotificationEmail({
              to: userRows[0].email,
              subject: `ATANY: ${productName} is now live`,
              html: `<p>${message}</p><p><a href="${process.env.FRONTEND_URL || 'http://localhost:5174'}/customer/live">View auction</a></p>`,
            });
          }
        } catch (emailErr) {
          console.warn('Failed to send live notification email', emailErr.message);
        }
      }
      // Clean up reminders after notifying (one-time)
      await client.query('DELETE FROM auction_reminders WHERE auction_id = $1', [auction.id]);
      await client.query('COMMIT');
      console.log(`Auction ${auction.id} (${productName}) started, notified ${watchers.length} watchers`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('startScheduledAuctions error', auction.id, e);
    } finally {
      client.release();
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
            await pool.query('INSERT INTO notifications (user_id, type, message) VALUES ($1, $2, $3)', [cust.id, 'auction', otherNotifMsg]);
          }
          if (otherCustomers.rows.length) console.log(`Other-branch notification for auction ${auction.id} at ${branchName}: notified ${otherCustomers.rows.length} customers`);
        }
      }
    } catch (notifErr) {
      console.warn('[other-branch starter notification] failed:', notifErr.message);
    }
  }
}
