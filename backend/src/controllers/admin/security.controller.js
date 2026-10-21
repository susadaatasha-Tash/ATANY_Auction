// backend/src/controllers/admin/security.controller.js
// Admin → Security Alerts (monitoring + review).
//
// The list is filtered, searched, sorted and paginated SERVER-SIDE.
//
// Real data model (public.security_alerts):
//   id, user_id → users, type, severity (alert_severity), status (alert_status),
//   detail, activity_trail (JSONB), created_at
// There is NO resolved_at column — the only real timestamp is created_at, so
// "resolved this month" means "alerts that are resolved and were detected in
// the current calendar month" (never a fabricated date).
import { pool } from '../../db/pool.js';
import { setAccountStatus } from '../../services/adminAccountStatus.js';
import { writeAuditLog } from '../../services/auditLog.js';

/** The severities the database actually supports. */
export const ALERT_SEVERITIES = ['low', 'medium', 'high'];
/** The statuses the database actually supports. */
export const ALERT_STATUSES = ['new', 'investigating', 'resolved', 'dismissed'];
/** Statuses that still need attention (the "open" bucket). */
export const OPEN_ALERT_STATUSES = ['new', 'investigating'];

/** Allowed review transitions — validated backend-side, never trusted from the client. */
export const ALERT_TRANSITIONS = {
  new: ['investigating', 'resolved', 'dismissed'],
  investigating: ['resolved', 'dismissed'],
  resolved: ['investigating'],
  dismissed: ['investigating'],
};

/** Whitelisted sort columns — a client string is NEVER interpolated into SQL. */
const SORTABLE = {
  id: 'a.id',
  customer: 'u.name',
  type: 'a.type',
  severity: 'a.severity',
  status: 'a.status',
  detected: 'a.created_at',
};

const PAGE_SIZES = [10, 25, 50];
const DEFAULT_LIMIT = 10;

function resolveLimit(raw) {
  const n = Number(raw);
  return PAGE_SIZES.includes(n) ? n : DEFAULT_LIMIT;
}
function resolvePage(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}
function resolveDate(raw) {
  if (raw == null || raw === '') return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Shared WHERE builder.
 * `includeSeverity` / `includeStatus` are disabled for the summary query so
 * the severity + status breakdowns always describe the whole scoped set.
 */
function buildFilters(query, { includeSeverity = true, includeStatus = true } = {}) {
  const where = [];
  const params = [];

  const search = String(query.search || '').trim();
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    // Alert id (uuid prefix), customer name and alert type.
    where.push(`(a.id::text ILIKE ${p} OR u.name ILIKE ${p} OR a.type ILIKE ${p})`);
  }

  if (includeSeverity) {
    const severity = String(query.severity || '').trim().toLowerCase();
    if (severity && severity !== 'all' && ALERT_SEVERITIES.includes(severity)) {
      params.push(severity);
      where.push(`a.severity = $${params.length}`);
    }
  }

  if (includeStatus) {
    const status = String(query.status || '').trim().toLowerCase();
    if (status && status !== 'all' && ALERT_STATUSES.includes(status)) {
      params.push(status);
      where.push(`a.status = $${params.length}`);
    }
  }

  const from = resolveDate(query.date_from);
  if (from) {
    params.push(from);
    where.push(`a.created_at >= $${params.length}`);
  }
  const to = resolveDate(query.date_to);
  if (to) {
    params.push(to);
    where.push(`a.created_at <= $${params.length}`);
  }

  return { where, params };
}

/** Month-over-month percentage, or null when there is no comparable base. */
function monthOverMonth(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (!previous) return null; // no prior data → no honest percentage
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

/**
 * GET /admin/security-alerts
 * Query: search, severity, status, date_from, date_to, page, limit, sort, order
 * Response: { items, pagination, summary }
 */
export const listAlerts = async (req, res) => {
  try {
    const query = req.query || {};
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);

    const sortKey = Object.prototype.hasOwnProperty.call(SORTABLE, String(query.sort || ''))
      ? String(query.sort)
      : 'detected';
    const sortCol = SORTABLE[sortKey];
    const sortDir = String(query.order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // ── the table page ───────────────────────────────────────────
    const list = buildFilters(query);
    const listParams = [...list.params];
    const whereSql = list.where.length ? `WHERE ${list.where.join(' AND ')}` : '';
    listParams.push(limit);
    const limitParam = `$${listParams.length}`;
    listParams.push((page - 1) * limit);
    const offsetParam = `$${listParams.length}`;

    const { rows: items } = await pool.query(
      `SELECT a.id, a.user_id, a.type, a.severity, a.status, a.detail, a.activity_trail, a.created_at,
              COALESCE(u.name, '') AS customer,
              COUNT(*) OVER()::int AS total_count
         FROM security_alerts a
         LEFT JOIN users u ON u.id = a.user_id
         ${whereSql}
        ORDER BY ${sortCol} ${sortDir}, a.created_at DESC, a.id DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}`,
      listParams
    );

    let total = items[0]?.total_count ?? 0;
    if (!items.length) {
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*)::int AS total
           FROM security_alerts a
           LEFT JOIN users u ON u.id = a.user_id
           ${whereSql}`,
        list.params
      );
      total = countRows[0]?.total || 0;
    }

    // ── summary (KPIs + breakdowns + month-over-month inputs) ────
    // Scoped by search + date only: the severity / status tabs describe the
    // whole scoped set, exactly like the reference.
    const summaryFilter = buildFilters(query, { includeSeverity: false, includeStatus: false });
    const summaryWhere = summaryFilter.where.length ? `WHERE ${summaryFilter.where.join(' AND ')}` : '';
    const { rows: summaryRows } = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE a.status IN ('new','investigating'))::int AS open_alerts,
              COUNT(*) FILTER (WHERE a.severity = 'high')::int AS high_severity,
              COUNT(*) FILTER (WHERE a.severity = 'medium')::int AS medium_severity,
              COUNT(*) FILTER (WHERE a.severity = 'low')::int AS low_severity,
              COUNT(*) FILTER (WHERE a.status = 'new')::int AS status_new,
              COUNT(*) FILTER (WHERE a.status = 'investigating')::int AS status_investigating,
              COUNT(*) FILTER (WHERE a.status = 'resolved')::int AS status_resolved,
              COUNT(*) FILTER (WHERE a.status = 'dismissed')::int AS status_dismissed,
              COUNT(*) FILTER (WHERE a.status = 'resolved'
                  AND a.created_at >= date_trunc('month', NOW())
                  AND a.created_at < date_trunc('month', NOW()) + INTERVAL '1 month')::int AS resolved_this_month,
              COUNT(*) FILTER (WHERE a.created_at >= date_trunc('month', NOW())
                  AND a.created_at < date_trunc('month', NOW()) + INTERVAL '1 month')::int AS created_this_month,
              COUNT(*) FILTER (WHERE a.created_at >= date_trunc('month', NOW()) - INTERVAL '1 month'
                  AND a.created_at < date_trunc('month', NOW()))::int AS created_last_month,
              COUNT(*) FILTER (WHERE a.status IN ('new','investigating')
                  AND a.created_at >= date_trunc('month', NOW())
                  AND a.created_at < date_trunc('month', NOW()) + INTERVAL '1 month')::int AS open_this_month,
              COUNT(*) FILTER (WHERE a.status IN ('new','investigating')
                  AND a.created_at >= date_trunc('month', NOW()) - INTERVAL '1 month'
                  AND a.created_at < date_trunc('month', NOW()))::int AS open_last_month,
              COUNT(*) FILTER (WHERE a.severity = 'high'
                  AND a.created_at >= date_trunc('month', NOW())
                  AND a.created_at < date_trunc('month', NOW()) + INTERVAL '1 month')::int AS high_this_month,
              COUNT(*) FILTER (WHERE a.severity = 'high'
                  AND a.created_at >= date_trunc('month', NOW()) - INTERVAL '1 month'
                  AND a.created_at < date_trunc('month', NOW()))::int AS high_last_month,
              COUNT(*) FILTER (WHERE a.status = 'resolved'
                  AND a.created_at >= date_trunc('month', NOW()) - INTERVAL '1 month'
                  AND a.created_at < date_trunc('month', NOW()))::int AS resolved_last_month
         FROM security_alerts a
         LEFT JOIN users u ON u.id = a.user_id
         ${summaryWhere}`,
      summaryFilter.params
    );

    const s = summaryRows[0] || {};
    const summary = {
      total: s.total || 0,
      open: s.open_alerts || 0,
      high: s.high_severity || 0,
      medium: s.medium_severity || 0,
      low: s.low_severity || 0,
      resolved_this_month: s.resolved_this_month || 0,
      severity_counts: {
        all: s.total || 0,
        high: s.high_severity || 0,
        medium: s.medium_severity || 0,
        low: s.low_severity || 0,
      },
      status_counts: {
        all: s.total || 0,
        new: s.status_new || 0,
        investigating: s.status_investigating || 0,
        resolved: s.status_resolved || 0,
        dismissed: s.status_dismissed || 0,
      },
      // Real month-over-month movement (null when there is no comparable base).
      trends: {
        open: monthOverMonth(s.open_this_month || 0, s.open_last_month || 0),
        high: monthOverMonth(s.high_this_month || 0, s.high_last_month || 0),
        resolved: monthOverMonth(s.resolved_this_month || 0, s.resolved_last_month || 0),
        total: monthOverMonth(s.created_this_month || 0, s.created_last_month || 0),
      },
    };

    res.json({
      items: items.map((a) => ({
        id: a.id,
        user_id: a.user_id,
        type: a.type,
        severity: a.severity,
        status: a.status,
        detail: a.detail,
        activity_trail: typeof a.activity_trail === 'string'
          ? (JSON.parse(a.activity_trail || '[]'))
          : (a.activity_trail || []),
        created_at: a.created_at,
        customer: a.customer || null,
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
        severity: String(query.severity || '').trim(),
        status: String(query.status || '').trim(),
        date_from: resolveDate(query.date_from),
        date_to: resolveDate(query.date_to),
        sort: sortKey,
        order: sortDir.toLowerCase(),
      },
    });
  } catch (e) {
    console.error('[admin/security:list]', e.message);
    res.status(500).json({ message: 'Failed to load security alerts' });
  }
};

/**
 * GET /admin/security-alerts/:id
 * One alert with everything the review dialog needs:
 *   • the real customer (name, email, role, account status)
 *   • the REAL related auction / item / branch (the flagged bid that created
 *     the alert proves the association — nothing is fabricated)
 *   • the REAL activity trail (the user's bids in the alert window; the
 *     alert's own activity_trail metadata is used as a fallback)
 */
export const getAlert = async (req, res) => {
  try {
    const { rows: alertRows } = await pool.query(
      `SELECT a.id, a.user_id, a.type, a.severity, a.status, a.detail, a.activity_trail, a.created_at,
              u.name AS customer_name, u.email AS customer_email, u.role AS customer_role,
              u.status AS customer_status
         FROM security_alerts a
         LEFT JOIN users u ON u.id = a.user_id
        WHERE a.id = $1`,
      [req.params.id]
    );
    if (!alertRows.length) return res.status(404).json({ message: 'Alert not found' });
    const alert = alertRows[0];

    const trail = typeof alert.activity_trail === 'string'
      ? (JSON.parse(alert.activity_trail || '[]'))
      : (alert.activity_trail || []);

    // ── the related item: the bid that triggered the alert ──
    // The alert is written by the fraud engine in the same transaction as the
    // triggering bid, so the user's bid closest to the alert's timestamp (a
    // flagged bid wins) proves the association. Nothing is fabricated.
    let related = null;
    let bidActivity = [];
    if (alert.user_id) {
      const { rows: relatedRows } = await pool.query(
        `SELECT b.id AS bid_id, b.amount, b.created_at AS bid_created_at, b.flag_reason,
                au.id AS auction_id, au.auction_code, au.current_bid,
                p.id AS product_id, p.name AS product_name, p.image_url, p.category,
                br.id AS branch_id, br.name AS branch_name
           FROM bids b
           JOIN auctions au ON au.id = b.auction_id
           JOIN products p ON p.id = au.product_id
           LEFT JOIN shops s ON s.id = p.shop_id
           LEFT JOIN branches br ON br.id = s.home_branch_id
          WHERE b.user_id = $1
            AND b.created_at <= $2
            AND b.created_at >= $2 - INTERVAL '2 minutes'
          ORDER BY b.flagged DESC, b.created_at DESC
          LIMIT 1`,
        [alert.user_id, alert.created_at]
      );
      related = relatedRows[0] || null;

      if (related) {
        // The real bids on that auction inside the alert window.
        const { rows: activityRows } = await pool.query(
          `SELECT b.created_at, b.amount, b.flagged, p.name AS product_name
             FROM bids b
             JOIN auctions au ON au.id = b.auction_id
             JOIN products p ON p.id = au.product_id
            WHERE b.user_id = $1 AND b.auction_id = $2
              AND b.created_at <= $3
              AND b.created_at >= $3 - INTERVAL '15 minutes'
            ORDER BY b.created_at DESC
            LIMIT 12`,
          [alert.user_id, related.auction_id, alert.created_at]
        );
        bidActivity = activityRows.map((b) => ({
          created_at: b.created_at,
          time: new Date(b.created_at).toLocaleTimeString('en-GB', { hour12: false }),
          action: 'Bid',
          amount: Number(b.amount || 0),
          item: b.product_name || 'Unknown item',
          flagged: b.flagged === true,
        }));
      }
    }

    // The activity trail: the alert's OWN evidence (written by the fraud
    // engine). The real bids of the related auction are the fallback.
    let activity = [];
    if (trail.length) {
      activity = trail.map((line) => {
        const m = String(line).match(/^(\d{2}:\d{2}:\d{2})\s+—\s+(.+?)\s+₱([\d,]+)\s+on\s+(.+?)(?:\s+\(previous:.*\))?$/);
        if (!m) {
          return { created_at: null, time: null, action: String(line), amount: null, item: null, flagged: false };
        }
        return {
          created_at: null,
          time: m[1],
          action: m[2],
          amount: Number(String(m[3]).replace(/,/g, '')),
          item: m[4],
          flagged: false,
        };
      });
    } else {
      activity = bidActivity;
    }

    res.json({
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      status: alert.status,
      detail: alert.detail,
      created_at: alert.created_at,
      detected_at: alert.created_at,
      activity_trail: trail,
      customer: alert.user_id ? {
        id: alert.user_id,
        name: alert.customer_name || null,
        email: alert.customer_email || null,
        role: alert.customer_role || null,
        status: alert.customer_status || null,
      } : null,
      related: related ? {
        bid_id: related.bid_id,
        auction_id: related.auction_id,
        auction_code: related.auction_code || null,
        current_bid: related.current_bid != null ? Number(related.current_bid) : null,
        product_id: related.product_id,
        product_name: related.product_name || null,
        image_url: related.image_url || null,
        category: related.category || null,
        branch_id: related.branch_id || null,
        branch_name: related.branch_name || null,
        amount: Number(related.amount || 0),
        flagged_at: related.bid_created_at || null,
        flag_reason: related.flag_reason || null,
      } : null,
      activity,
      activity_count: activity.length,
    });
  } catch (e) {
    console.error('[admin/security:get]', e.message);
    res.status(500).json({ message: 'Failed to load alert details' });
  }
};

/**
 * PATCH /admin/security-alerts/:id
 * Body: { status, suspendUserId? }
 * The status transition is validated against ALERT_TRANSITIONS server-side.
 * A customer suspension runs through the ONE shared account-status service
 * (services/adminAccountStatus.js) — the same path Admin → Users & Roles uses.
 */
export const updateAlert = async (req, res) => {
  const { status, suspendUserId } = req.body || {};
  if (!status || !ALERT_STATUSES.includes(status)) {
    return res.status(400).json({ message: `Status must be one of: ${ALERT_STATUSES.join(', ')}` });
  }
  try {
    const { rows: current } = await pool.query('SELECT id, status, user_id FROM security_alerts WHERE id=$1', [req.params.id]);
    if (!current.length) return res.status(404).json({ message: 'Alert not found' });
    const from = current[0].status;
    const changed = from !== status;
    if (changed && !(ALERT_TRANSITIONS[from] || []).includes(status)) {
      return res.status(400).json({ message: `Invalid transition ${from} → ${status}` });
    }

    // ── customer suspension (shared service, same rules as Users & Roles) ──
    let suspendedUser = null;
    if (suspendUserId) {
      if (!current[0].user_id || String(suspendUserId) !== String(current[0].user_id)) {
        return res.status(400).json({ message: 'User does not match this alert' });
      }
      const result = await setAccountStatus({
        adminId: req.user.id,
        targetId: suspendUserId,
        nextStatus: 'suspended',
        source: 'security_alert',
      });
      if (!result.ok) return res.status(result.code || 400).json({ message: result.message });
      suspendedUser = result.user;
    }

    let updated = current[0];
    if (changed) {
      const { rows } = await pool.query(
        'UPDATE security_alerts SET status=$1 WHERE id=$2 RETURNING id, user_id, type, severity, status, detail, activity_trail, created_at',
        [status, req.params.id]
      );
      updated = rows[0];
      await writeAuditLog({
        adminId: req.user.id,
        action: `security_alert_${status}`,
        entityType: 'security_alert',
        entityId: req.params.id,
        details: { from, to: status, suspended_user_id: suspendedUser?.id || null },
      });
    }

    const { rows: userRows } = updated.user_id
      ? await pool.query('SELECT id, name, email, role, status FROM users WHERE id=$1', [updated.user_id])
      : { rows: [] };
    res.json({
      ...updated,
      activity_trail: typeof updated.activity_trail === 'string'
        ? (JSON.parse(updated.activity_trail || '[]'))
        : (updated.activity_trail || []),
      customer: userRows[0] || null,
      suspended_user: suspendedUser ? { id: suspendedUser.id, status: suspendedUser.status } : null,
    });
  } catch (e) {
    console.error('[admin/security:update]', e.message);
    res.status(500).json({ message: 'Failed to update alert' });
  }
};
