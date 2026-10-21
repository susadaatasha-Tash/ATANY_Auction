// backend/src/controllers/admin/transaction.controller.js
// Admin → Orders (monitoring read).
//
// The list is SERVER-SIDE filtered, sorted and paginated — the admin never
// downloads every order to page in JavaScript.
//
// Data model (real ATANY tables):
//   orders ── buyer_id ──> users            (customer)
//   orders ── auction_id ──> auctions ── product_id ──> products   (item)
//   orders ── branch_id ──> branches        (pickup branch)
//   orders ── id ──> payments                (payment / recognized revenue)
//
// Revenue rule (canonical, see shop-owner/sales.controller.js):
//   recognized revenue = orders whose payment row is 'paid'.
//   Unpaid / pending / expired orders are NOT sales.
import { pool } from '../../db/pool.js';

/** The order states the database actually supports (public.order_status enum). */
export const ORDER_STATUSES = ['pending', 'preparing', 'ready_pickup', 'completed', 'expired'];

/** Human labels for the real enum values (no invented states). */
export const ORDER_STATUS_LABELS = {
  pending: 'Pending',
  preparing: 'Preparing',
  ready_pickup: 'Ready for pickup',
  completed: 'Completed',
  expired: 'Expired',
};

/** Whitelisted sort fields — a client string is NEVER interpolated into SQL. */
const SORTABLE = {
  date: 'o.created_at',
  amount: 'o.amount',
  branch: 'b.name',
  status: 'o.status',
  transaction: 'o.transaction_code',
};

const PAGE_SIZES = [10, 25, 50];
const DEFAULT_LIMIT = 10;

/** Parse + clamp a page-size request. */
function resolveLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  const allowed = PAGE_SIZES.includes(n) ? n : DEFAULT_LIMIT;
  return allowed;
}

/** Parse + clamp the page number (1-based). */
function resolvePage(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/**
 * Validate an optional timestamp filter. Returns an ISO string or null.
 * Invalid input is ignored rather than breaking the whole list request.
 */
function resolveDate(raw) {
  if (raw == null || raw === '') return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Build the shared WHERE clause.
 * `includeStatus` is false for the summary/status-counts query so the status
 * breakdown always describes the whole (searched + scoped) set.
 */
function buildFilters(query, { includeStatus = true, includeSearch = true } = {}) {
  const where = [];
  const params = [];

  const search = String(query.search || '').trim();
  if (includeSearch && search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    where.push(`(o.transaction_code ILIKE ${p} OR u.name ILIKE ${p} OR p.name ILIKE ${p})`);
  }

  const branchId = String(query.branch_id || '').trim();
  if (branchId) {
    params.push(branchId);
    where.push(`o.branch_id = $${params.length}`);
  }

  if (includeStatus) {
    const status = String(query.status || '').trim().toLowerCase();
    if (status && status !== 'all' && ORDER_STATUSES.includes(status)) {
      params.push(status);
      where.push(`o.status = $${params.length}`);
    }
  }

  const from = resolveDate(query.date_from);
  if (from) {
    params.push(from);
    where.push(`o.created_at >= $${params.length}`);
  }
  const to = resolveDate(query.date_to);
  if (to) {
    params.push(to);
    where.push(`o.created_at <= $${params.length}`);
  }

  return { where, params };
}

/**
 * GET /admin/transactions
 * Query: search, branch_id, status, date_from, date_to, page, limit, sort, order
 * Response: { items, pagination, summary }
 */
export const listTransactions = async (req, res) => {
  try {
    const query = req.query || {};
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);

    const sortKey = Object.prototype.hasOwnProperty.call(SORTABLE, String(query.sort || ''))
      ? String(query.sort)
      : 'date';
    const sortCol = SORTABLE[sortKey];
    const sortDir = String(query.order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // ── the table page ────────────────────────────────────────────
    const list = buildFilters(query);
    const listParams = [...list.params];
    const whereSql = list.where.length ? `WHERE ${list.where.join(' AND ')}` : '';
    listParams.push(limit);
    const limitParam = `$${listParams.length}`;
    listParams.push((page - 1) * limit);
    const offsetParam = `$${listParams.length}`;

    const { rows: items } = await pool.query(
      `SELECT o.id, o.transaction_code, o.amount, o.status, o.created_at, o.branch_id,
              COALESCE(u.name, '') AS customer,
              COALESCE(p.name, '') AS item,
              COALESCE(b.name, '') AS branch,
              COUNT(*) OVER()::int AS total_count
         FROM orders o
         LEFT JOIN users u ON u.id = o.buyer_id
         LEFT JOIN auctions a ON a.id = o.auction_id
         LEFT JOIN products p ON p.id = a.product_id
         LEFT JOIN branches b ON b.id = o.branch_id
         ${whereSql}
        ORDER BY ${sortCol} ${sortDir}, o.created_at DESC, o.id DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}`,
      listParams
    );

    // ── total for the current filter set ──────────────────────────
    // The window count already carries it; the extra COUNT only runs when the
    // page is empty (so "no matches" can be told apart from "page too far").
    let total = items[0]?.total_count ?? 0;
    if (!items.length) {
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*)::int AS total
           FROM orders o
           LEFT JOIN users u ON u.id = o.buyer_id
           LEFT JOIN auctions a ON a.id = o.auction_id
           LEFT JOIN products p ON p.id = a.product_id
           ${whereSql}`,
        list.params
      );
      total = countRows[0]?.total || 0;
    }

    // ── summary (KPIs + status breakdown) ─────────────────────────
    // Scoped by the search / branch / date filters, but NOT by the status
    // filter — the status tabs describe the whole scoped set.
    const summaryFilter = buildFilters(query, { includeStatus: false });
    const summaryWhere = summaryFilter.where.length ? `WHERE ${summaryFilter.where.join(' AND ')}` : '';
    const { rows: summaryRows } = await pool.query(
      `SELECT COUNT(*)::int AS total_orders,
              COUNT(DISTINCT o.branch_id)::int AS branches_in_scope,
              COUNT(*) FILTER (WHERE o.status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE o.status = 'preparing')::int AS preparing,
              COUNT(*) FILTER (WHERE o.status = 'ready_pickup')::int AS ready_pickup,
              COUNT(*) FILTER (WHERE o.status = 'completed')::int AS completed,
              COUNT(*) FILTER (WHERE o.status = 'expired')::int AS expired,
              COALESCE(SUM(o.amount) FILTER (WHERE EXISTS (
                SELECT 1 FROM payments pay WHERE pay.order_id = o.id AND pay.status = 'paid'
              )), 0)::int AS total_sales,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM payments pay WHERE pay.order_id = o.id AND pay.status = 'paid'
              ))::int AS paid_orders
         FROM orders o
         LEFT JOIN users u ON u.id = o.buyer_id
         LEFT JOIN auctions a ON a.id = o.auction_id
         LEFT JOIN products p ON p.id = a.product_id
         ${summaryWhere}`,
      summaryFilter.params
    );

    const s = summaryRows[0] || {};
    const totalOrders = s.total_orders || 0;
    const summary = {
      total_orders: totalOrders,
      branches_in_scope: s.branches_in_scope || 0,
      // Canonical recognized revenue (payments.status = 'paid').
      total_sales: s.total_sales || 0,
      paid_orders: s.paid_orders || 0,
      pending: s.pending || 0,
      preparing: s.preparing || 0,
      ready_pickup: s.ready_pickup || 0,
      completed: s.completed || 0,
      expired: s.expired || 0,
      completion_rate: totalOrders ? Math.round(((s.completed || 0) / totalOrders) * 100) : 0,
      status_counts: {
        all: totalOrders,
        pending: s.pending || 0,
        preparing: s.preparing || 0,
        ready_pickup: s.ready_pickup || 0,
        completed: s.completed || 0,
        expired: s.expired || 0,
      },
    };

    res.json({
      items: items.map((o) => ({
        id: o.id,
        transaction_code: o.transaction_code,
        customer: o.customer,
        item: o.item,
        amount: Number(o.amount || 0),
        branch: o.branch,
        branch_id: o.branch_id,
        status: o.status,
        date: o.created_at,
      })),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
      summary,
      filters: {
        search: String(query.search || '').trim(),
        branch_id: String(query.branch_id || '').trim(),
        status: String(query.status || '').trim(),
        date_from: resolveDate(query.date_from),
        date_to: resolveDate(query.date_to),
        sort: sortKey,
        order: sortDir.toLowerCase(),
      },
    });
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
