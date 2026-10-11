// backend/src/services/subscriptionService.js
// Shared subscription/billing domain logic for seller + admin.
// billing_records is the single source of truth for subscription state.
import { pool } from '../db/pool.js';
import {
  getPlanByCode,
  getPlanCatalog,
  resolvePlanForRecord,
  normalizeBillingInterval,
  getPlanPriceForInterval,
  isValidBillingInterval,
} from '../config/subscriptionPlans.js';
import { getCheckoutSession, checkoutStatus } from './paymongoService.js';

export const OPEN_BILLING_STATUSES = ['pending', 'processing', 'overdue', 'failed', 'expired'];
export const PAYABLE_BILLING_STATUSES = ['pending', 'overdue', 'failed', 'expired'];

/** Calendar-month period helper (no +30 day drift). Month-end safe. */
export function addOneCalendarMonth(date) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

/** Calendar-year period helper (Feb 29 safe). */
export function addOneCalendarYear(date) {
  const d = new Date(date);
  const day = d.getDate();
  d.setFullYear(d.getFullYear() + 1);
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

export function toISODate(d) {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatPeriodLabel(start, end) {
  const opts = { month: 'long', year: 'numeric' };
  return `${new Date(start).toLocaleDateString('en-US', opts)} – ${new Date(end).toLocaleDateString('en-US', opts)}`;
}

/** Interval-aware billing period (monthly = 1 calendar month, annual = 1 calendar year). */
export function computeBillingPeriod(interval, from = new Date()) {
  const iv = normalizeBillingInterval(interval);
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = iv === 'annual' ? addOneCalendarYear(start) : addOneCalendarMonth(start);
  return {
    start: toISODate(start),
    end: toISODate(end),
    due_date: toISODate(end),
    label: formatPeriodLabel(start, end),
    interval: iv,
  };
}

/** One monthly billing period starting from `from` (default: now). */
export function computeMonthlyPeriod(from = new Date()) {
  return computeBillingPeriod('monthly', from);
}

/** Normalized MRR contribution for admin metrics (annual_price / 12). */
export function normalizeMrrContribution(plan, billingInterval) {
  if (!plan) return 0;
  const iv = normalizeBillingInterval(billingInterval);
  const periodPrice = getPlanPriceForInterval(plan, iv);
  if (iv === 'annual') return Math.round(periodPrice / 12);
  return periodPrice;
}

export function startOfTodayMs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function isPaidPeriodActive(record) {
  if (!record || record.status !== 'paid') return false;
  const end = record.current_period_end || record.due_date;
  if (!end) return true;
  const ms = new Date(end).getTime();
  if (isNaN(ms)) return true;
  return ms >= startOfTodayMs();
}

export function isPayableStatus(status) {
  return PAYABLE_BILLING_STATUSES.includes(String(status || '').toLowerCase());
}

/**
 * Current subscription record for a seller:
 * 1) latest paid record whose period is still active
 * 2) else latest open (unpaid) record
 * 3) else newest record
 */
export function pickCurrentBillingRecord(records = []) {
  const list = [...(records || [])].sort(
    (a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0)
  );
  if (!list.length) return null;
  const currentPaid = list.find(isPaidPeriodActive);
  if (currentPaid) return currentPaid;
  const open = list.find((r) => OPEN_BILLING_STATUSES.includes(String(r?.status || '').toLowerCase()));
  return open || list[0];
}

export function pickOpenBillingRecord(records = []) {
  return (
    [...(records || [])]
      .sort((a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0))
      .find((r) => OPEN_BILLING_STATUSES.includes(String(r?.status || '').toLowerCase())) || null
  );
}

/**
 * Derive subscription status from CURRENT billing cycle only.
 * Billing status and subscription status are separate concepts.
 */
export function deriveSubscriptionStatus(current) {
  if (!current) return { status: 'none', billing_status: null };
  const billingStatus = String(current.status || '').toLowerCase();
  if (billingStatus === 'cancelled' || billingStatus === 'canceled') {
    return { status: 'canceled', billing_status: 'cancelled' };
  }
  if (billingStatus === 'paid') {
    if (isPaidPeriodActive(current)) return { status: 'active', billing_status: 'paid' };
    // paid but period ended with no newer open cycle yet
    return { status: 'expired', billing_status: 'paid' };
  }
  if (billingStatus === 'overdue') return { status: 'past_due', billing_status: 'overdue' };
  if (billingStatus === 'pending' || billingStatus === 'processing') {
    const due = current.due_date || current.current_period_end;
    if (due && new Date(due).getTime() < startOfTodayMs()) {
      return { status: 'past_due', billing_status: billingStatus };
    }
    return { status: 'pending', billing_status: billingStatus };
  }
  if (billingStatus === 'failed' || billingStatus === 'expired') {
    const due = current.due_date || current.current_period_end;
    if (due && new Date(due).getTime() < startOfTodayMs()) {
      return { status: 'past_due', billing_status: billingStatus };
    }
    return { status: 'pending', billing_status: billingStatus };
  }
  return { status: 'pending', billing_status: billingStatus || null };
}

export function buildSubscriptionSummary(records = []) {
  const list = [...(records || [])].sort(
    (a, b) => new Date(b?.created_at || 0) - new Date(a?.created_at || 0)
  );
  const current = pickCurrentBillingRecord(list);
  const open = pickOpenBillingRecord(list);
  const derived = deriveSubscriptionStatus(current);
  const plan = current ? resolvePlanForRecord(current) : null;
  const billingInterval = normalizeBillingInterval(current?.billing_interval || 'monthly');
  const periodPrice = plan ? getPlanPriceForInterval(plan, billingInterval) : 0;

  let next_payment = null;
  if (open) {
    const openPlan = resolvePlanForRecord(open);
    const openInterval = normalizeBillingInterval(open.billing_interval || 'monthly');
    next_payment = {
      mode: 'open_invoice',
      billing_id: open.id,
      amount: Number(open.amount) || 0,
      plan_code: open.plan_code || openPlan.code,
      plan_name: openPlan.name,
      billing_interval: openInterval,
      due_date: open.due_date || open.current_period_end || null,
      billing_status: open.status,
      subscription_status: deriveSubscriptionStatus(open).status,
      payment_reference: open.payment_reference || open.paymongo_checkout_session_id || null,
    };
  } else if (derived.status === 'active' && current) {
    next_payment = {
      mode: 'next_billing_date',
      billing_id: null,
      amount: periodPrice || Number(current.amount) || 0,
      plan_code: current.plan_code || plan?.code || null,
      plan_name: plan?.name || null,
      billing_interval: billingInterval,
      due_date: current.current_period_end || current.due_date || null,
      billing_status: current.status,
      subscription_status: 'active',
      payment_reference: current.payment_reference || null,
      note: 'Renewal is billed manually when the period ends. Automatic recurring charges are not enabled.',
    };
  }

  return {
    has_subscription: !!current,
    subscription_status: derived.status,
    billing_status: derived.billing_status,
    billing_interval: current ? billingInterval : null,
    plan: plan
      ? {
          code: plan.code,
          name: plan.name,
          monthly_price: plan.monthly_price,
          annual_price: plan.annual_price,
          rank: plan.rank,
          tone: plan.tone,
        }
      : null,
    current_record: current || null,
    open_record: open || null,
    next_payment,
    current_period_start: current?.current_period_start || null,
    current_period_end: current?.current_period_end || null,
    next_renewal_at: current?.current_period_end || null,
    total_paid: list
      .filter((r) => r.status === 'paid')
      .reduce((s, r) => s + (Number(r.amount) || 0), 0),
    total_due: list
      .filter((r) => ['pending', 'overdue', 'failed', 'expired'].includes(r.status))
      .reduce((s, r) => s + (Number(r.amount) || 0), 0),
  };
}

export async function getBillingRecordsForSeller(sellerId) {
  const { rows } = await pool.query(
    `SELECT * FROM billing_records WHERE seller_id = $1 ORDER BY created_at DESC`,
    [sellerId]
  );
  return rows;
}

export async function getShopForSeller(sellerId) {
  const { rows } = await pool.query(
    `SELECT id, user_id, shop_name, home_branch_id FROM shops WHERE user_id = $1 LIMIT 1`,
    [sellerId]
  );
  return rows[0] || null;
}

/** Idempotent paid transition for a billing record. Returns updated row or null if already paid. */
export async function markBillingPaid({ billingId, paymentReference, source = 'unknown' }) {
  const { rows } = await pool.query(
    `UPDATE billing_records
     SET status = 'paid',
         paid_at = COALESCE(paid_at, now()),
         payment_reference = COALESCE($1, payment_reference),
         updated_at = now()
     WHERE id = $2 AND status IS DISTINCT FROM 'paid'
     RETURNING *`,
    [paymentReference || null, billingId]
  );
  if (!rows.length) return null;
  const billing = rows[0];
  await backfillPlanCode(billing);
  await writeAuditLog({
    userId: billing.seller_id,
    action: billing.billing_type === 'upgrade_proration' ? 'upgrade_proration_paid' : 'subscription_paid',
    entityType: 'billing',
    entityId: billing.id,
    details: {
      billing_period: billing.billing_period,
      amount: billing.amount,
      plan_code: billing.plan_code,
      billing_type: billing.billing_type || 'subscription',
      billing_interval: billing.billing_interval || 'monthly',
      source,
    },
  });

  // If this payment settles a pending upgrade, apply the plan change.
  if (billing.billing_type === 'upgrade_proration' || billing.subscription_change_id) {
    try {
      const { applyPendingUpgradeForBilling } = await import('./subscriptionPlanChangeService.js');
      await applyPendingUpgradeForBilling(billing);
    } catch (e) {
      console.warn('[subscription-upgrade] apply after payment failed:', e.message);
    }
  } else {
    await notifyPaymentConfirmed(billing);
  }
  return billing;
}

export async function markBillingFailed({ billingId, status = 'failed' }) {
  const next = status === 'expired' ? 'expired' : 'failed';
  const { rows } = await pool.query(
    `UPDATE billing_records
     SET status = $1, updated_at = now()
     WHERE id = $2 AND status IS DISTINCT FROM 'paid'
     RETURNING *`,
    [next, billingId]
  );
  return rows[0] || null;
}

export async function backfillPlanCode(billing) {
  if (!billing || billing.plan_code) return billing;
  const plan = resolvePlanForRecord(billing);
  if (!plan) return billing;
  try {
    const { rows } = await pool.query(
      `UPDATE billing_records SET plan_code = $1, updated_at = now() WHERE id = $2 AND plan_code IS NULL RETURNING *`,
      [plan.code, billing.id]
    );
    return rows[0] || billing;
  } catch {
    return billing;
  }
}

export async function writeAuditLog({ userId, action, entityType, entityId, details }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, action, entityType, entityId || null, JSON.stringify(details || {})]
    );
  } catch (e) {
    console.warn('[audit log] failed:', e.message);
  }
}

export async function notifyUserOnce({ userId, type = 'payout', message, withinHours = 24 }) {
  if (!userId || !message) return false;
  try {
    const { rows: existing } = await pool.query(
      `SELECT id FROM notifications
       WHERE user_id = $1 AND message = $2
         AND created_at > NOW() - ($3 || ' hours')::interval
       LIMIT 1`,
      [userId, message, String(withinHours)]
    );
    if (existing.length) return false;
    await pool.query(`INSERT INTO notifications (user_id, type, message) VALUES ($1, $2, $3)`, [
      userId,
      type,
      message,
    ]);
    return true;
  } catch (e) {
    console.warn('[notification] failed:', e.message);
    return false;
  }
}

export async function notifyPaymentConfirmed(billing) {
  const amountLabel = `₱${Number(billing.amount).toLocaleString()}`;
  const sellerMsg = `Your subscription payment of ${amountLabel} for ${billing.billing_period} has been confirmed. Your subscription is now active.`;
  await notifyUserOnce({
    userId: billing.seller_id,
    type: 'payout',
    message: sellerMsg,
    withinHours: 24,
  });
  try {
    const { rows: admins } = await pool.query(`SELECT id FROM users WHERE role='admin' LIMIT 5`);
    for (const a of admins) {
      await notifyUserOnce({
        userId: a.id,
        type: 'payout',
        message: `Subscription payment received for ${billing.billing_period} — ${amountLabel}.`,
        withinHours: 24,
      });
    }
  } catch {}
}

export async function notifySubscriptionPastDue(billing) {
  const amountLabel = `₱${Number(billing.amount).toLocaleString()}`;
  await notifyUserOnce({
    userId: billing.seller_id,
    type: 'payout',
    message: `Your subscription payment of ${amountLabel} for ${billing.billing_period} is past due. Please pay to keep your shop active.`,
    withinHours: 24,
  });
}

export async function notifyPaymentFailed(billing) {
  const amountLabel = `₱${Number(billing.amount).toLocaleString()}`;
  await notifyUserOnce({
    userId: billing.seller_id,
    type: 'payout',
    message: `We couldn't process your subscription payment of ${amountLabel} for ${billing.billing_period}. Please retry payment.`,
    withinHours: 1,
  });
}

/**
 * Create (or reuse) a PayMongo checkout session for a billing record.
 * Amount always comes from the billing row / plan catalog — never from the client.
 */
export async function createBillingCheckoutSession(billing, { actorRole = 'shop_owner' } = {}) {
  if (!billing) throw new Error('Billing record required');
  if (!isPayableStatus(billing.status)) {
    const err = new Error(
      billing.status === 'paid' ? 'Billing already paid' : 'Billing not payable'
    );
    err.statusCode = billing.status === 'paid' ? 409 : 400;
    throw err;
  }

  const plan = resolvePlanForRecord(billing);
  const amount = Number(billing.amount) || Number(plan?.monthly_price) || 0;
  if (!amount || amount <= 0) {
    const err = new Error('Invalid billing amount');
    err.statusCode = 400;
    throw err;
  }

  // Reuse an existing active checkout when still valid
  if (billing.paymongo_checkout_session_id) {
    const updatedRecently =
      billing.updated_at &&
      Date.now() - new Date(billing.updated_at).getTime() < 30 * 60 * 1000;
    if (updatedRecently || ['pending', 'processing'].includes(billing.status)) {
      try {
        const checkout = await getCheckoutSession(billing.paymongo_checkout_session_id);
        const url = checkout?.data?.attributes?.checkout_url;
        if (url && checkoutStatus(checkout) === 'pending') {
          return { checkout_url: url, billing, reused: true };
        }
      } catch {}
    }
  }

  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5178').replace(/\/$/, '');
  const successUrl = `${frontendUrl}/shop/billing/success?billing_id=${billing.id}`;
  const cancelUrl = `${frontendUrl}/shop/billing`;
  const planLabel = plan?.name ? `${plan.name} — ` : '';
  const description = `ATANY ${planLabel}${billing.billing_period}`;

  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) {
    const err = new Error('PAYMONGO_SECRET_KEY not configured');
    err.statusCode = 500;
    throw err;
  }

  const paymongoRes = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(key + ':').toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [
            {
              currency: 'PHP',
              amount: Math.round(amount * 100),
              name: `ATANY Maintenance Fee - ${billing.billing_period}`,
              quantity: 1,
            },
          ],
          payment_method_types: ['gcash', 'card', 'paymaya', 'grab_pay', 'qrph', 'billease'],
          send_email_receipt: false,
          show_description: true,
          show_line_items: true,
          description,
          success_url: successUrl,
          cancel_url: cancelUrl,
          reference_number: billing.id,
        },
      },
    }),
  });

  const body = await paymongoRes.json().catch(() => ({}));
  if (!paymongoRes.ok) {
    const err = new Error(body?.errors?.[0]?.detail || `PayMongo failed: ${paymongoRes.status}`);
    err.statusCode = 502;
    throw err;
  }

  const checkoutId = body.data.id;
  const checkoutUrl = body.data.attributes.checkout_url;
  await pool.query(
    `UPDATE billing_records SET paymongo_checkout_session_id = $1, updated_at = now() WHERE id = $2`,
    [checkoutId, billing.id]
  );
  await writeAuditLog({
    userId: billing.seller_id,
    action: actorRole === 'admin' ? 'billing_checkout_admin_retry' : 'billing_checkout_started',
    entityType: 'billing',
    entityId: billing.id,
    details: {
      plan_code: billing.plan_code || plan?.code || null,
      amount,
      actor_role: actorRole,
      checkout_session_id: checkoutId,
    },
  });
  const { rows: upd } = await pool.query(`SELECT * FROM billing_records WHERE id = $1`, [
    billing.id,
  ]);
  return { checkout_url: checkoutUrl, billing: upd[0] || billing, reused: false };
}

/** Validate a seller can open a new plan checkout. Returns { ok, reason, code, billing? }. */
export function evaluatePlanCheckoutRequest({ records = [], planCode, shop, billingInterval = 'monthly' }) {
  const plan = getPlanByCode(planCode);
  if (!plan) {
    return { ok: false, status: 400, message: 'Invalid plan code' };
  }
  if (billingInterval != null && !isValidBillingInterval(billingInterval)) {
    return { ok: false, status: 400, message: 'Invalid billing interval' };
  }
  if (!shop) {
    return {
      ok: false,
      status: 409,
      message: 'No shop is linked to this seller account yet',
    };
  }

  const open = pickOpenBillingRecord(records);
  if (open) {
    const openPlan = resolvePlanForRecord(open);
    const openInterval = normalizeBillingInterval(open.billing_interval || 'monthly');
    const targetInterval = normalizeBillingInterval(billingInterval || 'monthly');
    if (openPlan.code === plan.code && openInterval === targetInterval) {
      return { ok: true, mode: 'reuse_open', plan, billing: open, interval: targetInterval };
    }
    return {
      ok: false,
      status: 409,
      message: `You already have an open invoice for ${openPlan.name}. Pay or retry it before selecting another plan.`,
    };
  }

  const current = pickCurrentBillingRecord(records);
  const derived = deriveSubscriptionStatus(current);
  if (derived.status === 'active' || derived.status === 'past_due' || derived.status === 'pending') {
    // Mid-subscription plan changes go through /billing/subscription/change/* (preview/confirm).
    return {
      ok: false,
      status: 409,
      message:
        'You already have a subscription. Use Manage billing to change plan (upgrade, downgrade, or billing interval).',
    };
  }

  return { ok: true, mode: 'create_new', plan, interval: normalizeBillingInterval(billingInterval || 'monthly') };
}

export async function createPendingBillingForPlan({ sellerId, plan, interval = 'monthly' }) {
  const iv = normalizeBillingInterval(interval);
  const period = computeBillingPeriod(iv, new Date());
  const amount = getPlanPriceForInterval(plan, iv);
  const { rows } = await pool.query(
    `INSERT INTO billing_records
       (seller_id, amount, billing_period, status, due_date,
        current_period_start, current_period_end, plan_code, billing_interval)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      sellerId,
      amount,
      period.label,
      period.due_date,
      period.start,
      period.end,
      plan.code,
      iv,
    ]
  );
  return rows[0];
}

/**
 * Ensure a next pending period exists when the latest paid period is ending.
 * Applies scheduled plan changes at period end, then creates the next billing
 * row using the resolved plan_code + billing_interval (server catalog prices).
 */
export async function ensureNextPeriod(sellerId) {
  try {
    const { applyScheduledChangesDue } = await import('./subscriptionPlanChangeService.js');
    await applyScheduledChangesDue();
  } catch (e) {
    console.warn('[ensureNextPeriod] scheduled changes:', e.message);
  }

  const records = await getBillingRecordsForSeller(sellerId);
  if (!records.length) return null;
  const lastPaid = records.find((r) => r.status === 'paid' && r.billing_type !== 'upgrade_proration');
  if (!lastPaid) return null;
  const end = lastPaid.current_period_end || lastPaid.due_date;
  if (!end) return null;
  const endMs = new Date(end).getTime();
  if (isNaN(endMs)) return null;
  const diffDays = (endMs - Date.now()) / (1000 * 60 * 60 * 24);
  if (diffDays > 3) return null;

  const open = pickOpenBillingRecord(records);
  if (open) return open;

  const plan = resolvePlanForRecord(lastPaid);
  const interval = normalizeBillingInterval(lastPaid.billing_interval || 'monthly');
  const nextStart = new Date(end);
  nextStart.setDate(nextStart.getDate() + 1);
  const nextPeriod = computeBillingPeriod(interval, nextStart);
  const amount = getPlanPriceForInterval(plan, interval) || Number(lastPaid.amount) || 1000;
  const planCode = lastPaid.plan_code || plan?.code || 'bronze';

  const { rows } = await pool.query(
    `INSERT INTO billing_records
       (seller_id, amount, billing_period, status, due_date,
        current_period_start, current_period_end, plan_code, billing_interval)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      sellerId,
      amount,
      nextPeriod.label,
      nextPeriod.due_date,
      nextPeriod.start,
      nextPeriod.end,
      planCode,
      interval,
    ]
  );
  return rows[0] || null;
}

/**
 * Poll PayMongo for a pending billing checkout and sync status.
 * Webhook is authoritative; this is a localhost/seller-return fallback.
 */
export async function syncBillingWithPayMongo(billing) {
  if (!billing) return billing;
  if (!['pending', 'processing', 'failed', 'expired'].includes(String(billing.status).toLowerCase())) {
    return billing;
  }
  if (!billing.paymongo_checkout_session_id) return billing;
  try {
    const checkout = await getCheckoutSession(billing.paymongo_checkout_session_id);
    const status = checkoutStatus(checkout);
    if (status === 'paid' && billing.status !== 'paid') {
      const attrs = checkout?.data?.attributes || {};
      const payId =
        attrs.payments?.[0]?.id || attrs.payment_intent?.id || billing.paymongo_checkout_session_id;
      const paid = await markBillingPaid({
        billingId: billing.id,
        paymentReference: payId,
        source: 'polling_sync',
      });
      return paid || billing;
    }
    if ((status === 'failed' || status === 'expired') && billing.status !== status) {
      const failed = await markBillingFailed({ billingId: billing.id, status });
      if (failed && status === 'failed') await notifyPaymentFailed(failed);
      return failed || billing;
    }
  } catch (e) {
    console.warn(`[billing-sync] Unable to verify checkout ${billing.paymongo_checkout_session_id}: ${e.message}`);
  }
  return billing;
}

/** Daily cron: pending rows past due_date → overdue + notify. */
export async function expireOverdueBillings() {
  try {
    const { rows } = await pool.query(
      `UPDATE billing_records
       SET status = 'overdue', updated_at = now()
       WHERE status = 'pending' AND due_date < CURRENT_DATE
       RETURNING id, seller_id, billing_period, amount, plan_code`
    );
    for (const r of rows) {
      await notifySubscriptionPastDue(r);
      await writeAuditLog({
        userId: r.seller_id,
        action: 'subscription_past_due',
        entityType: 'billing',
        entityId: r.id,
        details: { billing_period: r.billing_period, amount: r.amount, plan_code: r.plan_code },
      });
    }
    if (rows.length) console.log(`[billing-expiration] marked ${rows.length} overdue`);
    return rows.length;
  } catch (e) {
    console.error('[billing-expiration] failed', e.message);
    return 0;
  }
}

/** Admin metrics from CURRENT subscription state (one row per seller).
 *  Annual subscriptions contribute annual_price/12 to MRR (normalized). */
export function computeSubscriptionMetricsFromRecords(records = []) {
  const bySeller = new Map();
  for (const r of records || []) {
    if (!r?.seller_id) continue;
    // Skip pure proration rows when picking "the" subscription record? They still
    // have plan_code; pickCurrentBillingRecord prefers paid+active period.
    const arr = bySeller.get(r.seller_id) || [];
    arr.push(r);
    bySeller.set(r.seller_id, arr);
  }

  let mrr = 0;
  let pastDueMrr = 0;
  let activeCount = 0;
  let pastDueCount = 0;
  let pendingCount = 0;
  let canceledCount = 0;
  let expiredCount = 0;
  const planCounts = {
    bronze: { subscribers: 0, active: 0, pastDue: 0, pending: 0 },
    gold: { subscribers: 0, active: 0, pastDue: 0, pending: 0 },
    platinum: { subscribers: 0, active: 0, pastDue: 0, pending: 0 },
  };

  for (const [, rows] of bySeller) {
    const current = pickCurrentBillingRecord(rows);
    if (!current) continue;
    const { status } = deriveSubscriptionStatus(current);
    const plan = resolvePlanForRecord(current);
    const interval = normalizeBillingInterval(current.billing_interval || 'monthly');
    // MRR uses normalized monthly contribution (annual_price / 12)
    const amount = normalizeMrrContribution(plan, interval) || Number(current.amount) || 0;
    if (planCounts[plan.code]) planCounts[plan.code].subscribers += 1;

    if (status === 'active') {
      activeCount += 1;
      mrr += amount;
      if (planCounts[plan.code]) planCounts[plan.code].active += 1;
    } else if (status === 'past_due') {
      pastDueCount += 1;
      pastDueMrr += amount;
      if (planCounts[plan.code]) planCounts[plan.code].pastDue += 1;
    } else if (status === 'pending') {
      pendingCount += 1;
      if (planCounts[plan.code]) planCounts[plan.code].pending += 1;
    } else if (status === 'canceled') {
      canceledCount += 1;
    } else if (status === 'expired') {
      expiredCount += 1;
    }
  }

  return {
    totalSellers: bySeller.size,
    totalRecords: (records || []).length,
    activeCount,
    pastDueCount,
    pendingCount,
    canceledCount,
    expiredCount,
    mrr,
    pastDueMrr,
    arr: mrr * 12,
    planCounts,
    plans: getPlanCatalog().map((p) => ({
      code: p.code,
      name: p.name,
      monthly_price: p.monthly_price,
      annual_price: p.annual_price,
      rank: p.rank,
      sort_order: p.sort_order,
      tone: p.tone,
      ...(planCounts[p.code] || { subscribers: 0, active: 0, pastDue: 0, pending: 0 }),
    })),
  };
}
