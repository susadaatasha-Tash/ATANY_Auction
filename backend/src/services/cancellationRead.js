import { pool } from '../db/pool.js';

// Identity is stored as a user id. Prefer the role persisted by the authenticated
// cancellation operation; legacy records may use the trusted users.role value.
export async function readCancellationActor(order) {
  if(!order.cancelled_by)return null;
  const {rows}=await pool.query('SELECT id,name,role FROM users WHERE id=$1',[order.cancelled_by]);
  if(!rows[0])return null;
  let actor=rows[0];
  try {
    const {rows:ops}=await pool.query("SELECT context FROM payment_operations WHERE order_id=$1 AND actor_id=$2 AND kind='cancel' AND state='completed' ORDER BY created_at DESC LIMIT 1",[order.id,order.cancelled_by]);
    const role=ops[0]?.context?.role;
    if(['customer','shop_owner'].includes(role))actor={...actor,role};
  } catch { /* Missing historical operation never fabricates a cancelling role. */ }
  return actor;
}
