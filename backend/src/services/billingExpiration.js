// backend/src/services/billingExpiration.js
// Cron job to mark pending subscription bills as overdue after due_date
import { pool } from '../db/pool.js';

export async function expireOverdueBillings() {
  try {
    const { rows } = await pool.query(
      `UPDATE billing_records SET status='overdue', updated_at=now()
       WHERE status='pending' AND due_date < CURRENT_DATE
       RETURNING id, seller_id, billing_period, amount`
    );
    for (const r of rows) {
      try {
        // avoid duplicate overdue notifications within 24h
        const { rows: existing } = await pool.query(
          `SELECT id FROM notifications WHERE user_id=$1 AND message LIKE $2 AND created_at > NOW() - INTERVAL '1 day' LIMIT 1`,
          [r.seller_id, `%${r.billing_period}%overdue%`]
        );
        if (!existing.length) {
          await pool.query(
            `INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)`,
            [r.seller_id, `Your ${r.billing_period} maintenance payment is now overdue. Please pay to keep your shop active.`]
          );
        }
      } catch {}
    }
    if (rows.length) console.log(`[billing-expiration] marked ${rows.length} overdue`);
  } catch (e) {
    console.error('[billing-expiration] failed', e.message);
  }
}
