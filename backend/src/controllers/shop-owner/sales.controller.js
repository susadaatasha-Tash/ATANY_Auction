// backend/src/controllers/shop-owner/sales.controller.js
// Spec 4.4/4.7: sales are orders where product's shop_id matches. Payout = 90% per original mock
// REST-compatible: decomposes JOINs into simple queries for Supabase REST fallback
import { pool } from '../../db/pool.js';
import { calculatePlatformCommission, calculateSellerPayout } from '../../services/commission.js';
import { getSellerSalesDashboard, isValidSalesRange } from '../../services/sellerSales.js';
export const getSalesSummary = async (req, res) => {
  try {
    const range = req.query?.range ?? 'month';
    if (!isValidSalesRange(range)) {
      return res.status(400).json({ message: 'Invalid range. Use 7d, month, or year.', code: 'INVALID_RANGE' });
    }
    const data = await getSellerSalesDashboard(req.user.id, new Date(), range);
    res.json(data);
  } catch (e) {
    console.error('[shop-owner/sales/summary]', e.message);
    res.status(500).json({ message: 'Failed to load sales summary' });
  }
};
export const listSales = async (req, res) => {
  try {
    const shop = (await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
    if (!shop) return res.json([]);
    const { rows: products } = await pool.query('SELECT id FROM products WHERE shop_id=$1', [shop.id]);
    if (!products.length) return res.json([]);
    const productIds = products.map(p => p.id);
    const { rows: auctions } = await pool.query(
      `SELECT id, product_id FROM auctions WHERE product_id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`,
      productIds
    );
    if (!auctions.length) return res.json([]);
    const auctionMap = Object.fromEntries(auctions.map(a => [a.id, a.product_id]));
    const auctionIds = auctions.map(a => a.id);
    const { rows: orders } = await pool.query(
      `SELECT id, auction_id, buyer_id, amount, status, branch_id, payment_method, created_at, transaction_code, winner_confirmed_at, payment_deadline, winner_rank FROM orders WHERE auction_id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY created_at DESC`,
      auctionIds
    );
    if (!orders.length) return res.json([]);

    // fetch product names + images (for dashboard thumbnails)
    const { rows: prodDetails } = await pool.query(
      `SELECT id, name, image_url, category FROM products WHERE id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`,
      productIds
    );
    const prodMap = Object.fromEntries(prodDetails.map(p => [p.id, p]));

    // fetch buyer names
    const buyerIds = [...new Set(orders.map(o => o.buyer_id).filter(Boolean))];
    let buyerMap = {};
    if (buyerIds.length) {
      const { rows: buyers } = await pool.query(
        `SELECT id, name FROM users WHERE id IN (${buyerIds.map((_, i) => `$${i + 1}`).join(',')})`,
        buyerIds
      );
      buyerMap = Object.fromEntries(buyers.map(u => [u.id, u.name]));
    }

    // Latest payment per order — ONE batched query (this used to run one query
    // per order = N+1). Semantics match services/sellerSales.js: a 'paid'
    // payment always wins over a newer failed/retry row, so the list and the
    // KPI totals can never disagree about the same order.
    const orderIds = orders.map(o => o.id);
    let paymentByOrder = {};
    try {
      const { rows: payments } = await pool.query(
        `SELECT order_id, status, payment_method, paid_at, created_at FROM payments WHERE order_id IN (${orderIds.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY created_at DESC`,
        orderIds
      );
      for (const pay of payments) {
        if (!paymentByOrder[pay.order_id]) paymentByOrder[pay.order_id] = pay;
      }
      for (const pay of payments) {
        if (paymentByOrder[pay.order_id]?.status !== 'paid' && pay.status === 'paid') {
          paymentByOrder[pay.order_id] = pay; // paid wins
        }
      }
    } catch { paymentByOrder = {}; }

    // Branch name for pickup details (batched, shop branch scope).
    const branchIds = [...new Set(orders.map(o => o.branch_id).filter(Boolean))];
    let branchMap = {};
    if (branchIds.length) {
      try {
        const { rows: branches } = await pool.query(
          `SELECT id, name FROM branches WHERE id IN (${branchIds.map((_, i) => `$${i + 1}`).join(',')})`,
          branchIds
        );
        branchMap = Object.fromEntries(branches.map(b => [b.id, b.name]));
      } catch { branchMap = {}; }
    }

    const rows = [];
    for (const o of orders) {
      const payment = paymentByOrder[o.id] || null;
      const productId = auctionMap[o.auction_id];
      const product = prodMap[productId] || {};
      const commission = calculatePlatformCommission(o.amount);
      rows.push({
        id: o.id,
        transaction_code: o.transaction_code,
        item: product.name || 'Jewelry Item',
        item_image: product.image_url || null,
        category: product.category || null,
        buyer: buyerMap[o.buyer_id] || 'Customer',
        amount: o.amount,
        commission,
        payout: calculateSellerPayout(o.amount),
        status: o.status,
        payment_status: payment?.status || null,
        payment_method: o.payment_method || payment?.payment_method || null,
        paid_at: payment?.paid_at || null,
        branch_name: o.branch_id ? branchMap[o.branch_id] || null : null,
        date: o.created_at,
        // Current eligible-winner state (7-day fallback). The seller always sees
        // the CURRENT holder — never a stale expired winner.
        buyer_id: o.buyer_id,
        winner_confirmed_at: o.winner_confirmed_at || null,
        payment_deadline: o.payment_deadline || null,
        winner_rank: o.winner_rank ?? 1,
      });
    }
    res.json(rows);
  } catch (e) {
    console.error('[shop-owner/sales]', e.message);
    res.status(500).json({ message: 'Failed to load sales' });
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
  const allowed = ['pending', 'preparing', 'ready_pickup', 'completed'];
  if (!allowed.includes(status)) return res.status(400).json({ message: `status must be one of ${allowed.join(', ')}` });
  try {
    const shop = (await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
    if (!shop) return res.status(404).json({ message: 'Shop not found' });
    // verify order belongs to seller's shop
    const { rows: orderRows } = await pool.query(
      `SELECT o.id, o.status, o.auction_id FROM orders o WHERE o.id=$1`,
      [req.params.id]
    );
    if (!orderRows.length) return res.status(404).json({ message: 'Order not found' });
    const order = orderRows[0];
    const { rows: auctionRows } = await pool.query(`SELECT product_id FROM auctions WHERE id=$1`, [order.auction_id]);
    if (!auctionRows.length) return res.status(404).json({ message: 'Order not found' });
    const { rows: productRows } = await pool.query(`SELECT shop_id, name FROM products WHERE id=$1`, [auctionRows[0].product_id]);
    if (!productRows.length || productRows[0].shop_id !== shop.id) return res.status(404).json({ message: 'Order not found' });

    const current = order.status;
    if (current !== status && !(ALLOWED_TRANSITIONS[current] || []).includes(status)) {
      return res.status(400).json({ message: `Invalid transition ${current} → ${status}` });
    }
    if (['preparing', 'ready_pickup', 'completed'].includes(status)) {
      const { rows: pay } = await pool.query(`SELECT status FROM payments WHERE order_id=$1 AND status='paid' LIMIT 1`, [req.params.id]);
      if (!pay.length) return res.status(400).json({ message: 'Order cannot be prepared until payment is confirmed.' });
    }
    // Ownership is enforced INSIDE the write, not only by the pre-check SELECTs
    // above, so a foreign order id can never be mutated.
    const { rows } = await pool.query(
      `UPDATE orders o SET status=$1
       WHERE o.id=$2
         AND o.auction_id IN (SELECT a.id FROM auctions a JOIN products p ON p.id = a.product_id WHERE p.shop_id = $3)
       RETURNING o.*`,
      [status, req.params.id, shop.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Order not found' });
    // Audit log (best-effort — never blocks the response)
    try {
      const statusAction = { preparing: 'order_preparing', ready_pickup: 'order_ready_pickup', completed: 'order_completed' }[status];
      if (statusAction) {
        await pool.query(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
          [req.user.id, statusAction, 'order', req.params.id, JSON.stringify({ name: productRows[0].name, status })]
        );
      }
    } catch (logErr) {
      console.warn('[audit log] failed:', logErr.message);
    }
    try {
      const prodName = productRows[0].name || 'your jewelry';
      const { rows: branchRows } = await pool.query(
        `SELECT b.name as branch_name FROM orders o LEFT JOIN branches b ON b.id=o.branch_id WHERE o.id=$1`,
        [req.params.id]
      );
      const branchName = branchRows[0]?.branch_name || 'branch';
      const msgMap = {
        preparing: `Your ${prodName} is being prepared.`,
        ready_pickup: `Your ${prodName} is ready for pickup at ${branchName}.`,
        completed: 'Enjoy your new piece! Picked up confirmed.',
      };
      if (msgMap[status]) {
        const { rows: o } = await pool.query('SELECT buyer_id FROM orders WHERE id=$1', [req.params.id]);
        if (o[0]?.buyer_id) {
          // prevent duplicate notification on retry
          const { rows: existing } = await pool.query(
            `SELECT id FROM notifications WHERE user_id=$1 AND message=$2 AND created_at > NOW() - INTERVAL '1 hour' LIMIT 1`,
            [o[0].buyer_id, msgMap[status]]
          );
          if (!existing.length) await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1,'payout',$2)`, [o[0].buyer_id, msgMap[status]]);
        }
      }
    } catch {}
    res.json(rows[0]);
  } catch (e) {
    console.error('[shop-owner/orders:status]', e.message);
    res.status(500).json({ message: 'Failed to update order status' });
  }
};
