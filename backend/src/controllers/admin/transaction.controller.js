import { pool } from '../../db/pool.js';
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
    }));
    res.json(result);
  } catch (e) {
    console.error('[admin/transactions:list]', e.message);
    res.status(500).json({ message: 'Failed to load transactions' });
  }
};
export const markPaid = async (req, res) => {
  try {
    const { rows } = await pool.query("UPDATE orders SET status='ready_pickup' WHERE id=$1 RETURNING *", [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Order not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[admin/transactions:pay]', e.message);
    res.status(500).json({ message: 'Failed to update transaction' });
  }
};

const ALLOWED_TRANSITIONS = {
  pending: ['preparing'],
  preparing: ['ready_pickup'],
  ready_pickup: ['completed'],
  completed: [],
};

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
    if (['preparing','ready_pickup','completed'].includes(status)) {
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
