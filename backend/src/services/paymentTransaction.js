import { pool } from '../db/pool.js';

export class PaymentSafetyError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}

export async function paymentTransaction(work) {
  const client = await pool.connect();
  try {
    if (client.__restFallback) throw new PaymentSafetyError('DB_UNAVAILABLE', 'Payment safety requires PostgreSQL. Please try again later.', 503);
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (!client.__restFallback) await client.query('ROLLBACK').catch(() => {});
    if (['42P01','42703','22P02'].includes(error.code)) {
      throw new PaymentSafetyError('PAYMENT_SCHEMA_REQUIRED', 'Payment safety database upgrade is required.', 503);
    }
    throw error;
  } finally { client.release(); }
}

export async function lockOrder(client, id) {
  const { rows } = await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id]);
  if (!rows[0]) throw new PaymentSafetyError('ORDER_NOT_FOUND', 'Order not found', 404);
  return rows[0];
}

export async function assertNoPaymentOperation(client, orderId) {
  const { rows } = await client.query("SELECT * FROM payment_operations WHERE order_id=$1 AND state IN ('running','unknown')", [orderId]);
  if (rows.length) throw new PaymentSafetyError('PAYMENT_OPERATION_PENDING', 'A payment operation is still being verified. Please retry later or contact support.');
}
