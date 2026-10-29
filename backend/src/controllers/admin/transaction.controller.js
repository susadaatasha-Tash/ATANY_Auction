import { pool } from '../../db/pool.js';
import {
  MANUAL_PROVIDER, ALLOWED_TRANSITIONS, PAYMENT_GATED_STATUSES,
  recordManualPayment, applyOrderTransition, PAYMENT_WINDOW_EXPIRED,
} from '../../services/manualPayment.js';
export const listTransactions = async (_req, res) => {
  try {
    const { rows: orders } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    if (!orders.length) return res.json([]);
    const buyerIds = [...new Set(orders.map(o => o.buyer_id).filter(Boolean))];
    const branchIds = [...new Set(orders.map(o => o.branch_id).filter(Boolean))];
    const auctionIds = [...new Set(orders.map(o => o.auction_id).filter(Boolean))];
    let userMap = {};
    if (buyerIds.length) {
      const { rows: users } = await pool.query(`SELECT id, name FROM users WHERE id IN (${buyerIds.map((_,i)=>`$${i+1}`).join(',')})`, buyerIds);
      userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
    }
    let branchMap = {};
    if (branchIds.length) {
      const { rows: branches } = await pool.query(`SELECT * FROM branches WHERE id IN (${branchIds.map((_,i)=>`$${i+1}`).join(',')})`, branchIds);
      branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));
    }
    // Payment truth for the winner label: an unpaid winner is an ELIGIBLE
    // winner, not a settled one. Single query, no per-row cost.
    let paymentByOrder = {};
    try {
      const { rows: pays } = await pool.query(
        `SELECT order_id, status, paid_at FROM payments WHERE order_id = ANY($1::uuid[]) AND status = 'paid'`,
        [orders.map((o) => o.id)]
      );
      paymentByOrder = Object.fromEntries(pays.map((p) => [p.order_id, p]));
    } catch { /* label falls back to order status */ }

    let productMap = {};
    if (auctionIds.length) {
      const { rows: auctions } = await pool.query(`SELECT id, product_id FROM auctions WHERE id IN (${auctionIds.map((_,i)=>`$${i+1}`).join(',')})`, auctionIds);
      const auctionMap = Object.fromEntries(auctions.map(a => [a.id, a.product_id]));
      const productIds = [...new Set(Object.values(auctionMap).filter(Boolean))];
      if (productIds.length) {
        const { rows: products } = await pool.query(`SELECT id, name FROM products WHERE id IN (${productIds.map((_,i)=>`$${i+1}`).join(',')})`, productIds);
        productMap = Object.fromEntries(products.map(p => [p.id, p.name]));
        // Map auction -> product name
        for (const aid of auctionIds) {
          const pid = auctionMap[aid];
          if (pid && productMap[pid]) productMap[aid] = productMap[pid];
        }
      }
      // Rebuild with correct mapping
      const result = orders.map(o => {
        const auction = auctions.find(a => a.id === o.auction_id);
        const productName = auction ? productMap[auction.product_id] : null;
        return {
          id: o.id,
          transaction_code: o.transaction_code,
          customer: userMap[o.buyer_id] || null,
          item: productName || null,
          amount: o.amount,
          branch: branchMap[o.branch_id] || null,
          status: o.status,
          date: o.created_at,
          // Current eligible-winner state for the 7-day rule. An unpaid winner is
          // "Eligible Winner", not a settled winner.
          buyer_id: o.buyer_id,
          payment_deadline: o.payment_deadline || null,
          winner_confirmed_at: o.winner_confirmed_at || null,
          winner_rank: o.winner_rank ?? 1,
          payment_status: paymentByOrder[o.id]?.status || null,
          paid_at: paymentByOrder[o.id]?.paid_at || null,
        };
      });
      return res.json(result);
    }
    // Fallback if no auctions
    const result = orders.map(o => ({
      id: o.id,
      transaction_code: o.transaction_code,
      customer: userMap[o.buyer_id] || null,
      item: null,
      amount: o.amount,
      branch: branchMap[o.branch_id] || null,
      status: o.status,
      date: o.created_at,
      buyer_id: o.buyer_id,
      payment_deadline: o.payment_deadline || null,
      winner_confirmed_at: o.winner_confirmed_at || null,
      winner_rank: o.winner_rank ?? 1,
      payment_status: paymentByOrder[o.id]?.status || null,
      paid_at: paymentByOrder[o.id]?.paid_at || null,
    }));
    res.json(result);
  } catch (e) {
    console.error('[admin/transactions:list]', e.message);
    res.status(500).json({ message: 'Failed to load transactions' });
  }
};
/**
 * PATCH /admin/transactions/:id/pay — "Mark Paid".
 *
 * This endpoint is RETAINED (the Admin Orders screen uses it) but no longer
 * performs a blind write. An order status is not evidence of money:
 *   - the amount is read from the SERVER order row, never the request;
 *   - a manual payment record is established/claimed first, exactly like a
 *     counter payment, so the sale becomes recognizable by services/revenueRule.js
 *     and stops being eligible for unpaid-winner rotation;
 *   - fulfillment then advances through the SHARED transition model
 *     (services/manualPayment.js) instead of jumping straight to ready_pickup;
 *   - re-confirming is idempotent: the existing 'paid' payment is returned and
 *     never rewritten, and no second paid row can be created
 *     (idx_payments_one_paid_per_order).
 *
 * The response still ends at ready_pickup so the Admin UI contract is unchanged.
 */
export const markPaid = async (req, res) => {
  try {
    const { rows: orderRows } = await pool.query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    const order = orderRows[0];
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const recorded = await recordManualPayment({
      orderId: req.params.id,
      actorId: req.user?.id || null,
      paymentMethod: String(req.body?.payment_method || 'manual'),
      provider: MANUAL_PROVIDER,
      source: 'admin_mark_paid',
      note: 'Confirmed by administrator',
    });
    if (!recorded.ok) {
      const status = recorded.reason === 'ORDER_NOT_FOUND' ? 404 : 400;
      return res.status(status).json({ message: 'Order cannot be marked paid', reason: recorded.reason });
    }

    // Fulfillment: advance AT MOST ONE legal step, and only from 'pending'.
    // This endpoint records money; it is not a shortcut through the fulfillment
    // state machine. If the order is already past pending, payment is still
    // recorded and the fulfillment state is left exactly as it is.
    if (String(order.status || '').toLowerCase() === 'pending') {
      const step = await applyOrderTransition(req.params.id, nextStatusFor(order.status));
      if (!step.ok) {
        return res.status(400).json({ message: 'Payment recorded but fulfillment could not advance', reason: step.reason });
      }
    }

    const { rows: finalRows } = await pool.query('SELECT * FROM orders WHERE id=$1', [req.params.id]);
    res.json({
      ...finalRows[0],
      payment_status: 'paid',
      paid_at: recorded.payment?.paid_at || null,
      payment_provider: recorded.payment?.provider || MANUAL_PROVIDER,
    });
  } catch (e) {
    console.error('[admin/transactions:pay]', e.message);
    res.status(500).json({ message: 'Failed to update transaction' });
  }
};

/** The single legal next fulfillment step for an order, or null when terminal. */
function nextStatusFor(currentStatus) {
  return (ALLOWED_TRANSITIONS[String(currentStatus || '').toLowerCase()] || [])[0] || null;
}

export const updateOrderStatus = async (req, res) => {
  const { status } = req.body;
  const allowed = ['pending','preparing','ready_pickup','completed'];
  if (!allowed.includes(status)) return res.status(400).json({ message: `status must be one of ${allowed.join(', ')}` });
  try {
    const { rows: cur } = await pool.query('SELECT status FROM orders WHERE id=$1', [req.params.id]);
    if (!cur.length) return res.status(404).json({ message: 'Order not found' });
    const current = cur[0].status;
    // enforce valid transition (allow admin to stay same? no)
    if (current !== status && !(ALLOWED_TRANSITIONS[current] || []).includes(status)) {
      return res.status(400).json({ message: `Invalid transition ${current} → ${status}` });
    }
    // ensure payment paid before moving to preparing (unless already preparing etc)
    if (PAYMENT_GATED_STATUSES.includes(status)) {
      const { rows: pay } = await pool.query(`SELECT status FROM payments WHERE order_id=$1 AND status='paid' LIMIT 1`, [req.params.id]);
      if (!pay.length) return res.status(400).json({ message: 'Cannot fulfill: payment not confirmed' });
    }
    const { rows } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
    try {
      const msgMap = { preparing: 'Your jewelry is being prepared.', ready_pickup: 'Your jewelry is ready for pickup — bring valid ID + order number.', completed: 'Enjoy your new piece! Picked up confirmed.' };
      if (msgMap[status]) {
        const { rows: o } = await pool.query('SELECT buyer_id FROM orders WHERE id=$1', [req.params.id]);
        // Duplicate guard mirrors shop-owner sales fulfillment: same buyer + same
        // transition message within 1 hour is a retry, while each distinct transition
        // (preparing → ready → completed) has its own message and still notifies.
        if (o[0]?.buyer_id) {
          const { rows: dup } = await pool.query(
            `SELECT id FROM notifications WHERE user_id=$1 AND message=$2 AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1`,
            [o[0].buyer_id, msgMap[status]]
          );
          if (!dup.length) await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)`, [o[0].buyer_id, msgMap[status]]);
        }
      }
    } catch {}
    res.json(rows[0]);
  } catch (e) {
    console.error('[admin/orders:status]', e.message);
    res.status(500).json({ message: 'Failed to update order status' });
  }
};
