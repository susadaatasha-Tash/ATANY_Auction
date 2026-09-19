// backend/src/services/auctionCloser.js
// Spec 5.2: winner decided server-side by cron/pg_cron, never by client timer.
// Run every minute via node-cron or pg_cron job. Closes auctions where end_time <= NOW() and status != ended
import { pool } from '../db/pool.js';
import { sendNotificationEmail } from './emailService.js';

export async function closeExpiredAuctions() {
  const { rows } = await pool.query("SELECT id FROM auctions WHERE status != 'ended' AND end_time <= NOW()");
  for (const a of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE auctions SET status = 'ended' WHERE id = $1", [a.id]);
      // Winner = highest bid
      const { rows: top } = await client.query('SELECT user_id, amount FROM bids WHERE auction_id = $1 ORDER BY amount DESC LIMIT 1', [a.id]);
      let winnerId = null;
      let winningAmount = null;
      let orderId = null;
      if (top.length) {
        // Idempotency: skip if order already exists for this auction (cron may run twice)
        const { rows: existingOrder } = await client.query('SELECT id FROM orders WHERE auction_id=$1', [a.id]);
        if (existingOrder.length) {
          orderId = existingOrder[0].id;
          winnerId = top[0].user_id;
          winningAmount = top[0].amount;
        } else {
          // spec 4.1: auto-create order status pending — REST-compatible: fetch branch via simple queries
          let branchId = null;
          try {
            const { rows: aucProd } = await client.query('SELECT product_id FROM auctions WHERE id=$1', [a.id]);
            const productId = aucProd[0]?.product_id;
            if (productId) {
              const { rows: prodShop } = await client.query('SELECT shop_id FROM products WHERE id=$1', [productId]);
              const shopId = prodShop[0]?.shop_id;
              if (shopId) {
                const { rows: shopBranch } = await client.query('SELECT home_branch_id FROM shops WHERE id=$1', [shopId]);
                branchId = shopBranch[0]?.home_branch_id || null;
              }
            }
          } catch {}
          let orderRows;
          try {
            const res = await client.query(
              `INSERT INTO orders (auction_id, buyer_id, amount, branch_id, status) VALUES ($1,$2,$3,$4,'pending') RETURNING id`,
              [a.id, top[0].user_id, top[0].amount, branchId]
            );
            orderRows = res.rows;
          } catch (insErr) {
            if (insErr.code === '23505') {
              const { rows: existing } = await client.query('SELECT id FROM orders WHERE auction_id=$1', [a.id]);
              orderRows = existing;
            } else throw insErr;
          }
          if (orderRows.length) orderId = orderRows[0]?.id;
          winnerId = top[0].user_id;
          winningAmount = top[0].amount;
          orderId = orderRows[0]?.id;
        }
      }
      await client.query('COMMIT');

      // After commit: notify winner via in-app + email (REST-compatible simple queries)
      if (winnerId) {
        try {
          const { rows: orderRows } = await pool.query('SELECT amount, transaction_code, buyer_id, auction_id, branch_id FROM orders WHERE id=$1', [orderId]);
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
              await pool.query(
                "INSERT INTO notifications (user_id, type, message) VALUES ($1, 'auction', $2)",
                [winnerId, `🎉 You won "${d.product_name}" for ₱${Number(d.winning_bid).toLocaleString()}! Transaction ${d.transaction_code} was for auction ${d.auction_code} — Pickup at ${d.branch_name || 'branch'} — bring valid government-issued ID. ${claimDeadlineNote}`]
              );
            }
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
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('closeExpiredAuctions error', a.id, e);
    } finally {
      client.release();
    }
  }
}

// In server entry: import cron from 'node-cron'; cron.schedule('* * * * *', closeExpiredAuctions);
