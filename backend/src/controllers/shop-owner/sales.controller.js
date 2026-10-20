// backend/src/controllers/shop-owner/sales.controller.js
// Spec 4.4/4.7: sales are orders where product's shop_id matches. Payout = 90% per original mock
// REST-compatible: decomposes JOINs into simple queries for Supabase REST fallback
import { pool } from '../../db/pool.js';
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
      `SELECT id, auction_id, buyer_id, amount, status, created_at, transaction_code FROM orders WHERE auction_id IN (${auctionIds.map((_, i) => `$${i + 1}`).join(',')}) ORDER BY created_at DESC`,
      auctionIds
    );
    if (!orders.length) return res.json([]);

    // fetch product names + images (for dashboard thumbnails)
    const { rows: prodDetails } = await pool.query(
      `SELECT id, name, image_url FROM products WHERE id IN (${productIds.map((_, i) => `$${i + 1}`).join(',')})`,
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

    // attach payment_status per order (simple, REST-compatible)
    const rows = [];
    for (const o of orders) {
      let payment_status = null;
      try {
        const { rows: pay } = await pool.query(`SELECT status FROM payments WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1`, [o.id]);
        payment_status = pay[0]?.status || null;
      } catch { payment_status = null; }
      const productId = auctionMap[o.auction_id];
      const product = prodMap[productId] || {};
      const commission = Math.round(o.amount * 0.10);
      rows.push({
        id: o.id,
        transaction_code: o.transaction_code,
        item: product.name || 'Jewelry Item',
        item_image: product.image_url || null,
        buyer: buyerMap[o.buyer_id] || 'Customer',
        amount: o.amount,
        commission,
        payout: Math.round(o.amount * 0.9),
        status: o.status,
        payment_status,
        date: o.created_at,
      });
    }
    res.json(rows);
  } catch (e) {
    console.error('[shop-owner/sales]', e.message);
    res.status(500).json({ message: 'Failed to load sales' });
  }
};

/* ── GET /shop-owner/sales/summary — sales analytics for Sales & Payouts dashboard ──
   All figures derived from real orders belonging to the caller's shop.
   Commission = 10%, seller payout = 90% (canonical backend rule).
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

    // Latest payment per order
    const orderIds = orders.map(o => o.id);
    const { rows: payments } = await pool.query(
      `SELECT order_id, status, payment_method, created_at FROM payments WHERE order_id IN (${orderIds.map((_, i) => `$${i + 1}`).join(',')})`,
      orderIds
    );
    const paymentMap = {};
    for (const p of payments) {
      const existing = paymentMap[p.order_id];
      if (!existing || new Date(p.created_at) > new Date(existing.created_at)) {
        paymentMap[p.order_id] = p;
      }
    }

    // Seller's default payment method (for masked display in payout history)
    const { rows: paymentMethods } = await pool.query(
      `SELECT provider, brand, last4 FROM seller_payment_methods WHERE seller_id=$1 AND is_default=true LIMIT 1`,
      [shop.user_id]
    );
    const defaultMethod = paymentMethods[0];

    const COMMISSION_RATE = 0.10;
    const now = new Date();
    const currentYear = now.getFullYear();
    const yearStart = new Date(currentYear, 0, 1);
    const currentMonth = now.getMonth();
    const monthStart = new Date(currentYear, currentMonth, 1);

    let grossSalesYTD = 0;
    let netPayoutYTD = 0;
    let pendingPayout = 0;
    let salesThisMonth = 0;
    let lotsSoldThisMonth = 0;

    const monthly = {}; // YYYY-MM -> { gross, net }
    const categoryRevenue = {};
    const payoutHistory = [];

    for (const o of orders) {
      const amount = Number(o.amount || 0);
      const product = productMap[auctionMap[o.auction_id]] || {};
      const payment = paymentMap[o.id] || {};
      const paymentStatus = payment.status || null;
      const orderDate = new Date(o.created_at);
      // Canonical recognized-revenue rule: payments.status = 'paid'
      const isPaid = paymentStatus === 'paid';
      const payoutAmount = Math.round(amount * 0.90);

      // Gross Sales YTD: recognized revenue (payments.status = 'paid') this calendar year
      if (isPaid && orderDate >= yearStart) grossSalesYTD += amount;

      // Net Payout YTD: recognized revenue × 90% (after 10% commission), this calendar year
      if (isPaid && orderDate >= yearStart) netPayoutYTD += payoutAmount;

      // Pending Payout: recognized revenue (paid) but order not yet fulfilled (not completed)
      if (isPaid && o.status !== 'completed') pendingPayout += payoutAmount;

      // This Month: recognized revenue created this calendar month
      if (isPaid && orderDate >= monthStart) {
        salesThisMonth += amount;
        lotsSoldThisMonth += 1;
      }

      // Revenue Trend: recognized revenue grouped by month
      if (isPaid) {
        const monthKey = orderDate.toISOString().slice(0, 7);
        if (!monthly[monthKey]) monthly[monthKey] = { gross: 0, net: 0 };
        monthly[monthKey].gross += amount;
        monthly[monthKey].net += payoutAmount;
      }

      // Top Categories: recognized revenue grouped by product category
      if (isPaid && product.category) {
        categoryRevenue[product.category] = (categoryRevenue[product.category] || 0) + amount;
      }

      // Payout History: all recognized-revenue orders (payments.status = 'paid')
      if (isPaid) {
        payoutHistory.push({
          id: o.transaction_code || `PAY-${o.id.slice(0, 8).toUpperCase()}`,
          date: o.created_at,
          amount: payoutAmount,
          method: defaultMethod ? maskPaymentMethod(defaultMethod) : (payment.payment_method || '—'),
          status: o.status === 'completed' ? 'Paid' : 'Scheduled'
        });
      }
    }

    // Build 12-month revenue trend (most recent last)
    const trend = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7);
      const monthYear = d.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
      const [mo, yr] = monthYear.split(' ');
      trend.push({
        month: `${mo.toUpperCase()} ${yr}`,
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

    // Payout history sorted newest first
    payoutHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      summary: {
        gross_sales_ytd: grossSalesYTD,
        net_payout_ytd: netPayoutYTD,
        pending_payout: pendingPayout,
        sales_this_month: salesThisMonth,
        lots_sold_this_month: lotsSoldThisMonth,
        commission_rate: COMMISSION_RATE
      },
      revenue_trend: trend,
      top_categories: topCategories,
      payout_history: payoutHistory
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
    const monthYear = d.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
    const [mo, yr] = monthYear.split(' ');
    trend.push({
      month: `${mo.toUpperCase()} ${yr}`,
      gross: 0,
      net: 0
    });
  }
  return res.json({
    summary: { gross_sales_ytd: 0, net_payout_ytd: 0, pending_payout: 0, sales_this_month: 0, lots_sold_this_month: 0, commission_rate: 0.10 },
    revenue_trend: trend,
    top_categories: [],
    payout_history: []
  });
}

function maskPaymentMethod(method) {
  const label = method.brand || method.provider || 'Account';
  const last4 = method.last4 ? String(method.last4).slice(-4) : '****';
  return `${label} •••• ${last4}`;
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
