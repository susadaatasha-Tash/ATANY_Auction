// backend/src/controllers/shop-owner/sales.controller.js
// Spec 4.4/4.7: sales are orders where product's shop_id matches. Payout = 90% per original mock
// REST-compatible: decomposes JOINs into simple queries for Supabase REST fallback
import { pool } from '../../db/pool.js';
import { localMonthKey, localMonthLabel } from '../../lib/monthKey.js';

// Canonical money rule (backend is the ONLY source of truth):
// platform commission = 10% of the sale amount, seller payout = 90%.
const COMMISSION_RATE = 0.10;

export const listSales = async (req, res) => {
  try {
    // Seller ownership — the caller's shop rows are resolved server-side, the
    // client never sends a shop_id / owner id.
    const { rows: shopRows } = await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id]);
    if (!shopRows.length) return res.json([]);
    const shopIds = shopRows.map((s) => s.id);

    const { rows: products } = await pool.query(
      `SELECT id, name, category, image_url FROM products WHERE shop_id IN (${shopIds.map((_, i) => `$${i + 1}`).join(',')})`,
      shopIds
    );
    if (!products.length) return res.json([]);
    const productMap = Object.fromEntries(products.map((p) => [p.id, p]));
    const productIds = products.map((p) => p.id);

    const { rows: auctions } = await pool.query(
      `SELECT id, product_id FROM auctions WHERE product_id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`,
      productIds
    );
    if (!auctions.length) return res.json([]);
    const auctionMap = Object.fromEntries(auctions.map((a) => [a.id, a.product_id]));
    const auctionIds = auctions.map((a) => a.id);

    const { rows: orders } = await pool.query(
      `SELECT id, auction_id, buyer_id, amount, status, created_at, transaction_code,
              branch_id, payment_method, payment_deadline, winner_confirmed_at
         FROM orders WHERE auction_id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY created_at DESC`,
      auctionIds
    );
    if (!orders.length) return res.json([]);

    // Buyer names (batch)
    const buyerIds = [...new Set(orders.map((o) => o.buyer_id).filter(Boolean))];
    let buyerMap = {};
    if (buyerIds.length) {
      const { rows: buyers } = await pool.query(
        `SELECT id, name FROM users WHERE id IN (${buyerIds.map((_, i) => `$${i + 1}`).join(',')})`,
        buyerIds
      );
      buyerMap = Object.fromEntries(buyers.map((u) => [u.id, u.name]));
    }

    // Payments — ONE batched query for every order (the previous version ran a
    // COUNT-style lookup per order, which was an N+1 on the page load).
    const orderIds = orders.map((o) => o.id);
    const { rows: payments } = await pool.query(
      `SELECT order_id, status, payment_method, amount, paid_at, created_at
         FROM payments WHERE order_id IN (${orderIds.map((_, i) => `$${i + 1}`).join(',')})`,
      orderIds
    );
    const paymentMap = {};
    for (const p of payments) {
      const existing = paymentMap[p.order_id];
      if (!existing || new Date(p.created_at) > new Date(existing.created_at)) {
        paymentMap[p.order_id] = p;
      }
    }

    // Pickup branch per order (batch)
    const branchIds = [...new Set(orders.map((o) => o.branch_id).filter(Boolean))];
    let branchMap = {};
    if (branchIds.length) {
      const { rows: branches } = await pool.query(
        `SELECT id, name FROM branches WHERE id IN (${branchIds.map((_, i) => `$${i + 1}`).join(',')})`,
        branchIds
      );
      branchMap = Object.fromEntries(branches.map((b) => [b.id, b.name]));
    }

    const rows = orders.map((o) => {
      const product = productMap[auctionMap[o.auction_id]] || {};
      const payment = paymentMap[o.id] || null;
      const amount = Number(o.amount || 0);
      const commission = Math.round(amount * COMMISSION_RATE);
      // payout = sale amount - commission, so Amount = Commission + Payout always holds
      const payout = amount - commission;
      return {
        id: o.id,
        transaction_code: o.transaction_code,
        item: product.name || 'Jewelry Item',
        item_image: product.image_url || null,
        category: product.category || null,
        buyer: buyerMap[o.buyer_id] || 'Customer',
        amount,
        commission,
        payout,
        status: o.status,
        payment_status: payment?.status || null,
        payment_method: payment?.payment_method || o.payment_method || null,
        paid_at: payment?.paid_at || null,
        branch_name: branchMap[o.branch_id] || null,
        payment_deadline: o.payment_deadline || null,
        winner_confirmed_at: o.winner_confirmed_at || null,
        date: o.created_at,
      };
    });
    res.json(rows);
  } catch (e) {
    console.error('[shop-owner/sales]', e.message);
    res.status(500).json({ message: 'Failed to load sales' });
  }
};

/* ── GET /shop-owner/sales/summary — sales analytics for Sales & Payouts dashboard ──
   All figures derived from real orders belonging to the caller's shop.
   Commission = 10%, seller earnings = 90% (canonical backend rule).
   NOTE: ATANY does NOT record seller disbursements, so this endpoint returns
   recognized seller EARNINGS (never a payout) and there is no payout
   destination / method in the payload.
   Decomposed into simple queries for Supabase REST fallback compatibility. */
export const getSalesSummary = async (req, res) => {
  try {
    // Resolve seller's shop server-side — never trust client shop_id
    const shop = (await pool.query('SELECT id, user_id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
    if (!shop) return res.status(404).json({ message: 'Shop not found' });

    const { rows: products } = await pool.query('SELECT id, name, category FROM products WHERE shop_id=$1', [shop.id]);
    if (!products.length) return res.json(emptySummary(res));
    const productIds = products.map(p => p.id);
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    const { rows: auctions } = await pool.query(
      `SELECT id, product_id FROM auctions WHERE product_id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`,
      productIds
    );
    if (!auctions.length) return res.json(emptySummary(res));
    const auctionMap = Object.fromEntries(auctions.map(a => [a.id, a.product_id]));
    const auctionIds = auctions.map(a => a.id);

    const { rows: orders } = await pool.query(
      `SELECT id, auction_id, buyer_id, amount, status, created_at, transaction_code FROM orders WHERE auction_id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')})`,
      auctionIds
    );
    if (!orders.length) return res.json(emptySummary(res));

    // Latest payment per order — `paid_at` is REQUIRED: recognized revenue is
    // grouped by the month the payment was confirmed, not the order month.
    const orderIds = orders.map(o => o.id);
    const { rows: payments } = await pool.query(
      `SELECT order_id, status, payment_method, amount, paid_at, created_at
         FROM payments WHERE order_id IN (${orderIds.map((_, i) => `$${i + 1}`).join(',')})`,
      orderIds
    );
    const paymentMap = {};
    for (const p of payments) {
      const existing = paymentMap[p.order_id];
      if (!existing || new Date(p.created_at) > new Date(existing.created_at)) {
        paymentMap[p.order_id] = p;
      }
    }

    // Buyer names for the earnings history — ONE batched query (no N+1).
    const buyerIds = [...new Set(orders.map((o) => o.buyer_id).filter(Boolean))];
    let buyerMap = {};
    if (buyerIds.length) {
      const { rows: buyers } = await pool.query(
        `SELECT id, name FROM users WHERE id IN (${buyerIds.map((_, i) => `$${i + 1}`).join(',')})`,
        buyerIds
      );
      buyerMap = Object.fromEntries(buyers.map((b) => [b.id, b.name]));
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const yearStart = new Date(currentYear, 0, 1);
    const currentMonth = now.getMonth();
    const monthStart = new Date(currentYear, currentMonth, 1);

    let grossSalesYTD = 0;
    let netEarningsYTD = 0;
    let pendingEarnings = 0;
    let salesThisMonth = 0;
    let lotsSoldThisMonth = 0;

    const monthly = {}; // YYYY-MM -> { gross, net }
    const categoryRevenue = {};
    const earningsHistory = [];

    for (const o of orders) {
      const amount = Number(o.amount || 0);
      const product = productMap[auctionMap[o.auction_id]] || {};
      const payment = paymentMap[o.id] || {};
      const paymentStatus = payment.status || null;
      // Canonical recognized-revenue rule: payments.status = 'paid'
      const isPaid = paymentStatus === 'paid';
      const payoutAmount = Math.round(amount * 0.90);
      // payout = sale amount − commission, so Gross = Commission + Earnings always holds
      const commission = amount - payoutAmount;
      // Revenue is RECOGNIZED when the payment is confirmed, so the financial
      // date is the payment date (paid_at). The order date is only a fallback
      // for legacy paid rows without a paid_at.
      const recognizedAt = payment.paid_at || payment.created_at || o.created_at;
      const recognizedDate = new Date(recognizedAt);

      // Gross Sales YTD: recognized revenue (payments.status = 'paid') this calendar year
      if (isPaid && recognizedDate >= yearStart) grossSalesYTD += amount;

      // Net Earnings YTD: recognized revenue × 90% (after 10% commission), this calendar year
      if (isPaid && recognizedDate >= yearStart) netEarningsYTD += payoutAmount;

      // Pending Earnings: recognized revenue (paid) but the order is not yet
      // fulfilled (not completed) — the earnings are recognized but the order
      // is still in fulfilment. This is NOT a bank-transfer queue.
      if (isPaid && o.status !== 'completed') pendingEarnings += payoutAmount;

      // This Month: recognized revenue paid this calendar month
      if (isPaid && recognizedDate >= monthStart) {
        salesThisMonth += amount;
        lotsSoldThisMonth += 1;
      }

      // Revenue Trend: recognized revenue grouped by the local calendar month
      if (isPaid) {
        const monthKey = localMonthKey(recognizedDate);
        if (!monthly[monthKey]) monthly[monthKey] = { gross: 0, net: 0 };
        monthly[monthKey].gross += amount;
        monthly[monthKey].net += payoutAmount;
      }

      // Top Categories: recognized revenue grouped by product category
      if (isPaid && product.category) {
        categoryRevenue[product.category] = (categoryRevenue[product.category] || 0) + amount;
      }

      // Earnings History: recognized revenue only (payments.status = 'paid').
      // ATANY does NOT record seller disbursements yet, so this is the seller's
      // recognized EARNINGS (gross − ATANY commission), never a paid-out payout.
      // There is deliberately NO "method" column: the seller's subscription
      // payment preference and the customer's checkout method are both NOT a
      // payout destination.
      if (isPaid) {
        earningsHistory.push({
          id: o.transaction_code || `PAY-${o.id.slice(0, 8).toUpperCase()}`,
          date: recognizedAt,
          item: product.name || 'Jewelry Item',
          buyer: buyerMap[o.buyer_id] || 'Customer',
          gross: amount,
          commission,
          net: payoutAmount,
          status: 'Earned',
          // Fulfillment state, kept SEPARATE from the earnings state.
          order_status: o.status === 'completed' ? 'Completed' : 'Pending fulfillment',
        });
      }
    }

    // Build 12-month revenue trend (most recent last).
    // The lookup key AND the label come from the SAME local calendar month, so
    // a month's revenue can never slide into the neighbouring bucket.
    const trend = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = localMonthKey(d);
      trend.push({
        month: localMonthLabel(d),
        gross: monthly[key]?.gross || 0,
        net: monthly[key]?.net || 0
      });
    }

    // Top categories sorted by revenue desc
    const totalCatRev = Object.values(categoryRevenue).reduce((a, b) => a + b, 0);
    const topCategories = Object.entries(categoryRevenue)
      .map(([cat, rev]) => ({
        category: cat,
        revenue: rev,
        percentage: totalCatRev > 0 ? Math.round((rev / totalCatRev) * 100) : 0
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Earnings history sorted newest first
    earningsHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      summary: {
        gross_sales_ytd: grossSalesYTD,
        // Seller earnings (90% of recognized gross). ATANY does not record
        // seller disbursements yet — these are EARNINGS, not a payout.
        net_earnings_ytd: netEarningsYTD,
        pending_earnings: pendingEarnings,
        sales_this_month: salesThisMonth,
        lots_sold_this_month: lotsSoldThisMonth,
        commission_rate: COMMISSION_RATE
      },
      revenue_trend: trend,
      top_categories: topCategories,
      earnings_history: earningsHistory
    });
  } catch (e) {
    console.error('[shop-owner/getSalesSummary]', e.message);
    res.status(500).json({ message: 'Failed to load sales summary' });
  }
};

function emptySummary(res) {
  const now = new Date();
  const trend = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    trend.push({
      month: localMonthLabel(d),
      gross: 0,
      net: 0
    });
  }
  return res.json({
    summary: { gross_sales_ytd: 0, net_earnings_ytd: 0, pending_earnings: 0, sales_this_month: 0, lots_sold_this_month: 0, commission_rate: 0.10 },
    revenue_trend: trend,
    top_categories: [],
    earnings_history: []
  });
}

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
    const { rows } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
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
