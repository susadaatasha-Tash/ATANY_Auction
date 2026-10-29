// backend/src/services/subscriptionPlanChangeService.js
// Plan-change domain: preview, proration, upgrade confirm, scheduled downgrade,
// cancel, and apply-at-period-end. billing_records stays append-only history.
import { pool } from '../db/pool.js';
import {
  getPlanByCode,
  getPlanPriceForInterval,
  normalizeBillingInterval,
  comparePlanRank,
  isValidBillingInterval,
  resolvePlanForRecord,
  intervalLabel,
} from '../config/subscriptionPlans.js';
import {
  computeBillingPeriod,
  getBillingRecordsForSeller,
  getShopForSeller,
  pickCurrentBillingRecord,
  deriveSubscriptionStatus,
  createBillingCheckoutSession,
  toISODate,
  writeAuditLog,
  notifyUserOnce,
} from './subscriptionService.js';

// ---------------------------------------------------------------------------
// Proration (integer centavos — never floating-point money)
// ---------------------------------------------------------------------------

/** remaining_fraction in micro-units (1e6) for integer proration math. */
export function remainingFractionMicros({ periodStart, periodEnd, now = new Date() }) {
  const startMs = new Date(periodStart).getTime();
  const endMs = new Date(periodEnd).getTime();
  const nowMs = now.getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return 0;
  if (nowMs >= endMs) return 0;
  const remainingMs = Math.max(0, endMs - nowMs);
  const totalMs = endMs - startMs;
  return Math.floor((remainingMs * 1_000_000) / totalMs);
}

/**
 * Proration in integer centavos.
 * prorationCents = max(0, (newPeriodPrice - currentPeriodPrice)) * remaining
 * Never negative — upgrades only charge the positive difference.
 */
export function computeProrationCents({
  currentPeriodPricePesos,
  newPeriodPricePesos,
  periodStart,
  periodEnd,
  now = new Date(),
}) {
  const currentCents = Math.round(Number(currentPeriodPricePesos) * 100);
  const newCents = Math.round(Number(newPeriodPricePesos) * 100);
  const diffCents = newCents - currentCents;
  if (diffCents <= 0) return 0;
  const fraction = remainingFractionMicros({ periodStart, periodEnd, now });
  if (fraction <= 0) return 0;
  return Math.floor((diffCents * fraction) / 1_000_000);
}

/** Centavos → whole pesos for billing_records.amount (INTEGER column). */
export function centsToWholePesos(cents) {
  return Math.round(Number(cents) / 100);
}

export function pesosToCents(pesos) {
  return Math.round(Number(pesos) * 100);
}

export { computeBillingPeriod };

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify a plan/interval change.
 * upgrade → rank increase OR monthly→annual (higher commitment) → immediate
 * downgrade → rank decrease OR annual→monthly (lower commitment) → next cycle
 * noop → same plan + same interval
 */
export function classifyPlanChange({ currentPlan, targetPlan, currentInterval, targetInterval }) {
  const curIv = normalizeBillingInterval(currentInterval);
  const tgtIv = normalizeBillingInterval(targetInterval);

  if (!currentPlan) {
    return { type: 'select', effective: 'immediate', rankDelta: 0, intervalChange: curIv !== tgtIv };
  }

  const rankDelta = comparePlanRank(targetPlan, currentPlan);
  const samePlan = currentPlan.code === targetPlan.code;
  const intervalChange = curIv !== tgtIv;

  if (rankDelta > 0) {
    return { type: 'upgrade', effective: 'immediate', rankDelta, intervalChange };
  }
  if (rankDelta < 0) {
    return { type: 'downgrade', effective: 'next_cycle', rankDelta, intervalChange };
  }
  // same rank
  if (intervalChange && tgtIv === 'annual' && curIv === 'monthly') {
    return { type: 'upgrade', effective: 'immediate', rankDelta: 0, intervalChange: true };
  }
  if (intervalChange) {
    return { type: 'downgrade', effective: 'next_cycle', rankDelta: 0, intervalChange: true };
  }
  return { type: 'noop', effective: 'none', rankDelta: 0, intervalChange: false, samePlan };
}

// ---------------------------------------------------------------------------
// DB accessors for subscription_changes
// ---------------------------------------------------------------------------

export async function getActiveSubscriptionChange(sellerId) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM subscription_changes
       WHERE seller_id = $1 AND status IN ('pending_payment', 'scheduled')
       ORDER BY created_at DESC LIMIT 1`,
      [sellerId]
    );
    return rows[0] || null;
  } catch (e) {
    // Pre-migration database without subscription_changes (025/026): there can
    // be no active change by definition — return null instead of 500ing every
    // preview/confirm. Any other error still propagates.
    if (e?.code === '42P01') return null;
    throw e;
  }
}

export async function getScheduledDowngrade(sellerId) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM subscription_changes
       WHERE seller_id = $1 AND status = 'scheduled'
       ORDER BY created_at DESC LIMIT 1`,
      [sellerId]
    );
    return rows[0] || null;
  } catch (e) {
    // Pre-migration database (no subscription_changes table): no scheduled
    // change can exist — return null instead of failing the caller.
    if (e?.code === '42P01') return null;
    throw e;
  }
}

export async function getPendingUpgrade(sellerId) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM subscription_changes
       WHERE seller_id = $1 AND status = 'pending_payment'
       ORDER BY created_at DESC LIMIT 1`,
      [sellerId]
    );
    return rows[0] || null;
  } catch (e) {
    if (e?.code === '42P01') return null;
    throw e;
  }
}

export async function getSubscriptionChangeById(id, sellerId = null) {
  const params = sellerId ? [id, sellerId] : [id];
  const where = sellerId ? `id = $1 AND seller_id = $2` : `id = $1`;
  const { rows } = await pool.query(
    `SELECT * FROM subscription_changes WHERE ${where} LIMIT 1`,
    params
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Plan limit check (active listings vs target plan limits)
// ---------------------------------------------------------------------------

export async function countActiveListingsForSeller(sellerId) {
  const shop = await getShopForSeller(sellerId);
  if (!shop?.id) return 0;
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM products WHERE shop_id = $1 AND status = 'approved'`,
      [shop.id]
    );
    return rows[0]?.n || 0;
  } catch {
    return 0;
  }
}

export function checkPlanLimitConflict({ activeListings, targetPlan }) {
  if (!targetPlan?.limits) return null;
  const limit = targetPlan.limits.activeLots;
  if (limit == null) return null; // unlimited
  if (Number(activeListings) <= Number(limit)) return null;
  return {
    code: 'PLAN_LIMIT_CONFLICT',
    status: 409,
    message: `You currently have ${activeListings} active listings. ${targetPlan.name} allows ${limit}. Reduce your active listings before downgrading.`,
    conflicts: [
      {
        type: 'active_listings',
        limit: Number(limit),
        current: Number(activeListings),
        target_plan: targetPlan.code,
        target_plan_name: targetPlan.name,
      },
    ],
    details: {
      active_listings: Number(activeListings),
      target_limit: Number(limit),
      target_plan: targetPlan.code,
      target_plan_name: targetPlan.name,
    },
  };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

function serializePlan(plan, interval) {
  if (!plan) return null;
  const iv = normalizeBillingInterval(interval);
  return {
    code: plan.code,
    name: plan.name,
    rank: plan.rank,
    tone: plan.tone,
    monthly_price: plan.monthly_price,
    annual_price: plan.annual_price,
    billing_interval: iv,
    period_price: getPlanPriceForInterval(plan, iv),
    price_label: `₱${getPlanPriceForInterval(plan, iv).toLocaleString()}/${intervalLabel(iv)}`,
    features: plan.features || [],
    limits: plan.limits || null,
  };
}

function serializeChange(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.change_type,
    status: row.status,
    current_plan_code: row.current_plan_code,
    target_plan_code: row.target_plan_code,
    current_billing_interval: row.current_billing_interval,
    target_billing_interval: row.target_billing_interval,
    effective_at: row.effective_at,
    proration_amount: Number(row.proration_amount) || 0,
    created_at: row.created_at,
  };
}

/**
 * Preview a plan change. Does NOT mutate subscription state.
 * amount_due_now is computed server-side from catalog + current period.
 */
export async function previewPlanChange({ sellerId, planCode, billingInterval }) {
  const targetPlan = getPlanByCode(planCode);
  if (!targetPlan) {
    return { ok: false, status: 400, error: 'INVALID_PLAN', message: 'Invalid plan code' };
  }
  if (billingInterval != null && !isValidBillingInterval(billingInterval)) {
    return { ok: false, status: 400, error: 'INVALID_INTERVAL', message: 'Invalid billing interval' };
  }

  const records = await getBillingRecordsForSeller(sellerId);
  const current = pickCurrentBillingRecord(records);
  const derived = deriveSubscriptionStatus(current);

  // Resolve current plan from record
  let currentResolved = null;
  if (current) {
    currentResolved = resolvePlanForRecord(current);
  }

  const currentInterval = normalizeBillingInterval(
    current?.billing_interval || (currentResolved ? 'monthly' : 'monthly')
  );
  const targetInterval = normalizeBillingInterval(billingInterval || currentInterval || 'monthly');

  const classification = classifyPlanChange({
    currentPlan: currentResolved,
    targetPlan,
    currentInterval,
    targetInterval,
  });

  const shop = await getShopForSeller(sellerId);
  const hasActiveSub =
    derived.status === 'active' ||
    derived.status === 'past_due' ||
    derived.status === 'pending';

  if (!hasActiveSub && !currentResolved) {
    // New subscription — no proration
    const period = computeBillingPeriod(targetInterval, new Date());
    const periodPrice = getPlanPriceForInterval(targetPlan, targetInterval);
    return {
      ok: true,
      type: 'select',
      mode: 'new_subscription',
      current_plan: null,
      target_plan: serializePlan(targetPlan, targetInterval),
      billing_interval: targetInterval,
      amount_due_now: periodPrice,
      next_billing_amount: periodPrice,
      next_billing_interval: targetInterval,
      effective_at: 'immediate',
      proration: {
        current_period_price: 0,
        new_period_price: periodPrice,
        remaining_fraction: 1,
        proration_amount: 0,
        cents: 0,
      },
      period: { start: period.start, end: period.end },
      shop_ok: !!shop,
      active_change: serializeChange(await getActiveSubscriptionChange(sellerId)),
      usage: {
        active_listings: await countActiveListingsForSeller(sellerId),
      },
    };
  }

  if (classification.type === 'noop') {
    return {
      ok: true,
      type: 'noop',
      current_plan: serializePlan(currentResolved, currentInterval),
      target_plan: serializePlan(targetPlan, targetInterval),
      billing_interval: targetInterval,
      amount_due_now: 0,
      next_billing_amount: getPlanPriceForInterval(currentResolved, currentInterval),
      next_billing_interval: currentInterval,
      effective_at: 'none',
      message: 'Already on this plan and billing interval.',
    };
  }

  const periodStart = current?.current_period_start || current?.created_at || new Date();
  const periodEnd = current?.current_period_end || current?.due_date || null;

  const currentPeriodPrice = getPlanPriceForInterval(currentResolved, currentInterval);
  const newPeriodPrice = getPlanPriceForInterval(targetPlan, targetInterval);

  let amountDueNow = 0;
  let prorationCents = 0;
  let remainingMicros = 1_000_000;

  if (classification.type === 'upgrade' || classification.type === 'interval_change') {
    if (periodStart && periodEnd) {
      prorationCents = computeProrationCents({
        currentPeriodPricePesos: currentPeriodPrice,
        newPeriodPricePesos: newPeriodPrice,
        periodStart,
        periodEnd,
      });
      remainingMicros = remainingFractionMicros({ periodStart, periodEnd });
    }
    amountDueNow = centsToWholePesos(prorationCents);
  }

  // Downgrades / reduced commitment: schedule at period end, no charge now
  const effectiveAt =
    classification.effective === 'immediate'
      ? 'immediate'
      : toISODate(periodEnd || new Date());

  // Limit conflict only blocks downgrades
  let limitConflict = null;
  if (classification.type === 'downgrade') {
    const activeListings = await countActiveListingsForSeller(sellerId);
    limitConflict = checkPlanLimitConflict({ activeListings, targetPlan });
    if (limitConflict) {
      return {
        ok: false,
        status: limitConflict.status,
        error: limitConflict.code,
        message: limitConflict.message,
        conflicts: limitConflict.conflicts || null,
        details: limitConflict.details,
        current_plan: serializePlan(currentResolved, currentInterval),
        target_plan: serializePlan(targetPlan, targetInterval),
      };
    }
  }

  let activeChange = await getActiveSubscriptionChange(sellerId);
  // Reconcile a stale pending_payment against PayMongo before deciding:
  // paid → applied (preview the NEW state); failed/expired → cleared so a
  // fresh attempt can proceed; still pending → resumable metadata below.
  if (activeChange && activeChange.status === 'pending_payment') {
    try {
      const reconciled = await reconcilePendingChange(sellerId, activeChange);
      if (reconciled.state === 'applied') {
        activeChange = await getActiveSubscriptionChange(sellerId);
      } else if (reconciled.state === 'failed' || reconciled.state === 'expired') {
        activeChange = null;
      } else {
        activeChange = { ...activeChange, _reconciled: reconciled.state, _expiresAt: reconciled.expiresAt || null };
      }
    } catch {
      // Reconciliation must never break preview — keep the change as-is.
    }
  }
  if (activeChange) {
    const samePendingUpgrade =
      activeChange.status === 'pending_payment' &&
      activeChange.target_plan_code === targetPlan.code &&
      normalizeBillingInterval(activeChange.target_billing_interval) === targetInterval;
    if (samePendingUpgrade) {
      // Reuse path: same upgrade already pending — surface it so confirm can reuse checkout.
      return {
        ok: true,
        type: 'upgrade',
        mode: 'immediate',
        reuse_pending_change: true,
        pending_payment: {
          id: activeChange.id,
          status: activeChange.status,
          expires_at: activeChange._expiresAt || null,
        },
        current_plan: serializePlan(currentResolved, currentInterval),
        target_plan: serializePlan(targetPlan, targetInterval),
        billing_interval: targetInterval,
        current_interval: currentInterval,
        amount_due_now: Number(activeChange.proration_amount) || 0,
        next_billing_amount: getPlanPriceForInterval(targetPlan, targetInterval),
        next_billing_interval: targetInterval,
        effective_at: 'immediate',
        proration: {
          current_period_price: currentPeriodPrice,
          new_period_price: newPeriodPrice,
          remaining_fraction: null,
          proration_amount: Number(activeChange.proration_amount) || 0,
          cents: null,
        },
        active_change: serializeChange(activeChange),
      };
    }
    return {
      ok: false,
      status: 409,
      error: 'PLAN_CHANGE_CONFLICT',
      message:
        activeChange.status === 'pending_payment'
          ? 'A plan upgrade payment is already in progress. Complete or wait for it to finish.'
          : `A plan change to ${activeChange.target_plan_code} is already scheduled. Cancel it before making another change.`,
      active_change: serializeChange(activeChange),
    };
  }

  return {
    ok: true,
    type: classification.type,
    mode: classification.effective === 'immediate' ? 'immediate' : 'scheduled',
    current_plan: serializePlan(currentResolved, currentInterval),
    target_plan: serializePlan(targetPlan, targetInterval),
    billing_interval: targetInterval,
    current_interval: currentInterval,
    amount_due_now: amountDueNow,
    next_billing_amount: newPeriodPrice,
    next_billing_interval: targetInterval,
    effective_at: effectiveAt,
    proration: {
      current_period_price: currentPeriodPrice,
      new_period_price: newPeriodPrice,
      remaining_fraction: Number((remainingMicros / 1_000_000).toFixed(6)),
      proration_amount: amountDueNow,
      cents: prorationCents,
    },
    period: periodStart
      ? { start: toISODate(periodStart), end: periodEnd ? toISODate(periodEnd) : null }
      : null,
    usage: {
      active_listings: await countActiveListingsForSeller(sellerId),
      target_limit: targetPlan.limits?.activeLots ?? null,
    },
    active_change: null,
  };
}

// ---------------------------------------------------------------------------
// Apply a plan change to billing_records (server-authoritative)
// ---------------------------------------------------------------------------

async function applyPlanChangeToBilling({
  sellerId,
  targetPlan,
  targetInterval,
  changeId,
  source,
}) {
  const period = computeBillingPeriod(targetInterval, new Date());
  const amount = getPlanPriceForInterval(targetPlan, targetInterval);

  // Close out previous paid cycle conceptually by writing a new paid row for the
  // new configuration when upgrade is immediate + already paid via proration,
  // or a pending renewal row when scheduled downgrade applies at cycle end.
  const { rows } = await pool.query(
    `INSERT INTO billing_records
       (seller_id, amount, billing_period, status, due_date,
        current_period_start, current_period_end, plan_code,
        billing_interval, billing_type, subscription_change_id)
     VALUES ($1, $2, $3, 'paid', $4, $5, $6, $7, $8, 'subscription', $9)
     RETURNING *`,
    [
      sellerId,
      amount,
      period.label,
      period.due_date,
      period.start,
      period.end,
      targetPlan.code,
      normalizeBillingInterval(targetInterval),
      changeId || null,
    ]
  );
  return rows[0];
}

/**
 * Apply an upgrade (after payment confirmed, or immediately when ₱0 due).
 * Idempotent: claim via UPDATE ... WHERE status IN (...) so concurrent
 * webhook/job runs cannot apply twice or double-insert billing rows.
 */
export async function applyUpgradeChange({ change, paymentReference = null, source = 'upgrade' }) {
  if (!change) return null;

  // H2 money path: billing insert + plan status must be transactional → direct pg only
  const { requireDirectPg } = await import('../db/dbGuard.js');
  requireDirectPg('applyUpgradeChange');

  const { rows: existingRows } = await pool.query(
    `SELECT * FROM subscription_changes WHERE id = $1`,
    [change.id]
  );
  const current = existingRows[0] || change;
  if (current.status === 'applied') {
    const { rows: billRows } = await pool.query(
      `SELECT * FROM billing_records WHERE subscription_change_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [change.id]
    );
    return { change: current, alreadyApplied: true, billing: billRows[0] || null };
  }
  if (current.status !== 'pending_payment' && current.status !== 'scheduled') {
    return null;
  }

  // Atomic claim — only one runner wins
  const { rows: claimed } = await pool.query(
    `UPDATE subscription_changes
     SET status = 'applied', applied_at = now()
     WHERE id = $1 AND status IN ('pending_payment', 'scheduled')
     RETURNING *`,
    [change.id]
  );
  if (!claimed.length) {
    const { rows: after } = await pool.query(
      `SELECT * FROM subscription_changes WHERE id = $1`,
      [change.id]
    );
    return { change: after[0] || current, alreadyApplied: true, billing: null };
  }

  const targetPlan = getPlanByCode(claimed[0].target_plan_code);
  if (!targetPlan) {
    await pool.query(
      `UPDATE subscription_changes SET status = 'failed', applied_at = NULL WHERE id = $1`,
      [change.id]
    );
    return null;
  }

  const targetInterval = normalizeBillingInterval(claimed[0].target_billing_interval);
  try {
    const billing = await applyPlanChangeToBilling({
      sellerId: claimed[0].seller_id,
      targetPlan,
      targetInterval,
      changeId: change.id,
      source,
    });

    const { rows: updated } = await pool.query(
      `UPDATE subscription_changes
       SET billing_record_id = COALESCE($1, billing_record_id)
       WHERE id = $2
       RETURNING *`,
      [billing?.id || null, change.id]
    );
    const applied = updated[0] || claimed[0];

    await writeAuditLog({
      userId: claimed[0].seller_id,
      action: source === 'webhook' ? 'upgrade_payment_confirmed' : 'upgrade_applied',
      entityType: 'subscription_change',
      entityId: change.id,
      details: {
        target_plan: claimed[0].target_plan_code,
        target_interval: claimed[0].target_billing_interval,
        proration_amount: claimed[0].proration_amount,
        payment_reference: paymentReference,
        source,
      },
    });

    await notifyUserOnce({
      userId: claimed[0].seller_id,
      type: 'payout',
      message: `Your subscription has been upgraded to ${targetPlan.name}.`,
      withinHours: 24,
    });

    return { change: applied, alreadyApplied: false, billing };
  } catch (e) {
    // Revert claim so the job/webhook can retry cleanly
    try {
      await pool.query(
        `UPDATE subscription_changes
         SET status = 'pending_payment', applied_at = NULL
         WHERE id = $1 AND status = 'applied' AND billing_record_id IS NULL`,
        [change.id]
      );
    } catch (revertErr) {
      console.error('[subscription-changes] failed to revert claim', revertErr.message);
    }
    console.error('[subscription-changes] applyUpgradeChange failed', e.message);
    throw e;
  }
}

/**
 * Schedule a downgrade (or annual→monthly). Seller keeps current plan until period end.
 */
export async function scheduleDowngrade({
  sellerId,
  currentPlan,
  targetPlan,
  currentInterval,
  targetInterval,
  effectiveAt,
}) {
  const existing = await getScheduledDowngrade(sellerId);
  if (existing) {
    const err = new Error('A plan downgrade is already scheduled.');
    err.statusCode = 409;
    err.code = 'PLAN_CHANGE_CONFLICT';
    throw err;
  }
  const pending = await getPendingUpgrade(sellerId);
  if (pending) {
    const err = new Error('A plan upgrade payment is already in progress.');
    err.statusCode = 409;
    err.code = 'PLAN_CHANGE_CONFLICT';
    throw err;
  }

  let change;
  try {
    const { rows } = await pool.query(
      `INSERT INTO subscription_changes
         (seller_id, current_plan_code, target_plan_code,
          current_billing_interval, target_billing_interval,
          change_type, status, effective_at, proration_amount)
       VALUES ($1, $2, $3, $4, $5, 'downgrade', 'scheduled', $6, 0)
       RETURNING *`,
      [
        sellerId,
        currentPlan?.code || null,
        targetPlan.code,
        normalizeBillingInterval(currentInterval),
        normalizeBillingInterval(targetInterval),
        effectiveAt,
      ]
    );
    change = rows[0];
  } catch (e) {
    // Unique index idx_subscription_changes_one_scheduled (race)
    if (String(e.message || '').includes('idx_subscription_changes_one_scheduled')) {
      const err = new Error('A plan downgrade is already scheduled.');
      err.statusCode = 409;
      err.code = 'PLAN_CHANGE_CONFLICT';
      throw err;
    }
    throw e;
  }

  await writeAuditLog({
    userId: sellerId,
    action: 'downgrade_scheduled',
    entityType: 'subscription_change',
    entityId: change.id,
    details: {
      target_plan: targetPlan.code,
      target_interval: change.target_billing_interval,
      effective_at: change.effective_at,
    },
  });

  await notifyUserOnce({
    userId: sellerId,
    type: 'payout',
    message: `Your plan will change to ${targetPlan.name} on ${toISODate(new Date(change.effective_at))}.`,
    withinHours: 24,
  });

  return change;
}

/**
 * Reconcile a pending_payment change against PayMongo (authoritative).
 * - paid → apply the upgrade exactly once (idempotent claim), return applied.
 * - failed/expired → mark change + billing accordingly, return terminal state.
 * - still pending → return pending (with checkout expiry when known).
 * - PayMongo unreachable → return unknown (caller must stay fail-closed).
 * Never throws for provider states; throws only on DB errors.
 */
export async function reconcilePendingChange(sellerId, pending) {
  if (!pending || pending.status !== 'pending_payment') return { state: 'none' };
  let billing = null;
  try {
    const { rows } = await pool.query(`SELECT * FROM billing_records WHERE id = $1`, [
      pending.billing_record_id,
    ]);
    billing = rows[0] || null;
  } catch {
    billing = null;
  }
  let providerState = 'unknown';
  let expiresAt = null;
  try {
    const { getCheckoutSession, checkoutStatus } = await import('./paymongoService.js');
    if (pending.paymongo_checkout_session_id) {
      const body = await getCheckoutSession(pending.paymongo_checkout_session_id);
      providerState = checkoutStatus(body);
      const attrs = body?.data?.attributes || body?.attributes || {};
      expiresAt = attrs.expires_at || attrs.expiresAt || null;
    } else {
      providerState = 'unknown';
    }
  } catch {
    providerState = 'unknown';
  }
  if (providerState === 'paid') {
    const applied = await applyUpgradeChange({ change: pending, source: 'reconcile' });
    return { state: 'applied', applied, billing };
  }
  if (providerState === 'failed' || providerState === 'expired') {
    const targetStatus = providerState === 'expired' ? 'expired' : 'failed';
    try {
      await pool.query(`UPDATE subscription_changes SET status = $1 WHERE id = $2`, [targetStatus, pending.id]);
    } catch {}
    try {
      if (billing) {
        await pool.query(`UPDATE billing_records SET status = $1 WHERE id = $2`, [targetStatus, billing.id]);
      }
    } catch {}
    return { state: targetStatus, billing };
  }
  return { state: providerState === 'unknown' ? 'unknown' : 'pending', billing, expiresAt };
}

/**
 * Cancel an unpaid pending upgrade. Verifies ownership, pending status, and
 * that PayMongo has NOT been paid (paid → apply instead; never cancel paid).
 * Marks change + billing row canceled; subscription itself never changes.
 */
export async function cancelPendingUpgrade({ sellerId, changeId = null }) {
  let pending = null;
  if (changeId) {
    pending = await getSubscriptionChangeById(changeId, sellerId);
  } else {
    pending = await getPendingUpgrade(sellerId);
  }
  if (!pending || pending.status !== 'pending_payment') {
    const err = new Error('No pending upgrade to cancel.');
    err.statusCode = 404;
    err.code = 'NO_PENDING_UPGRADE';
    throw err;
  }
  const reconciled = await reconcilePendingChange(sellerId, pending);
  if (reconciled.state === 'applied') {
    const err = new Error('Payment already succeeded — the upgrade has been applied and cannot be canceled.');
    err.statusCode = 409;
    err.code = 'UPGRADE_ALREADY_PAID';
    throw err;
  }
  if (reconciled.state === 'failed' || reconciled.state === 'expired') {
    return { cancelled: false, reconciled: reconciled.state, change: pending };
  }
  const { rows } = await pool.query(
    `UPDATE subscription_changes
     SET status = 'canceled', canceled_at = now()
     WHERE id = $1 AND status = 'pending_payment'
     RETURNING *`,
    [pending.id]
  );
  if (!rows.length) {
    const err = new Error('Pending upgrade could not be canceled.');
    err.statusCode = 409;
    err.code = 'PLAN_CHANGE_CONFLICT';
    throw err;
  }
  try {
    const billing = reconciled.billing;
    if (billing && ['pending', 'processing'].includes(String(billing.status))) {
      await pool.query(`UPDATE billing_records SET status = 'cancelled' WHERE id = $1`, [billing.id]);
    }
  } catch {}
  await writeAuditLog({
    userId: sellerId,
    action: 'upgrade_canceled',
    entityType: 'subscription_change',
    entityId: pending.id,
    details: { target_plan: pending.target_plan_code },
  });
  return { cancelled: true, change: rows[0] };
}

export async function cancelScheduledChange({ sellerId }) {
  const scheduled = await getScheduledDowngrade(sellerId);
  if (!scheduled) {
    const err = new Error('No scheduled plan change to cancel.');
    err.statusCode = 404;
    err.code = 'NO_SCHEDULED_CHANGE';
    throw err;
  }
  const { rows } = await pool.query(
    `UPDATE subscription_changes
     SET status = 'canceled', canceled_at = now()
     WHERE id = $1 AND status = 'scheduled'
     RETURNING *`,
    [scheduled.id]
  );
  if (!rows.length) {
    const err = new Error('Scheduled change could not be canceled.');
    err.statusCode = 409;
    err.code = 'PLAN_CHANGE_CONFLICT';
    throw err;
  }
  await writeAuditLog({
    userId: sellerId,
    action: 'downgrade_canceled',
    entityType: 'subscription_change',
    entityId: scheduled.id,
    details: { target_plan: scheduled.target_plan_code },
  });
  await notifyUserOnce({
    userId: sellerId,
    type: 'payout',
    message: `Your scheduled downgrade to ${scheduled.target_plan_code} was canceled. Your current plan remains unchanged.`,
    withinHours: 24,
  });
  return rows[0];
}

// ---------------------------------------------------------------------------
// Confirm a plan change (server recalculates — never trusts preview amounts)
// ---------------------------------------------------------------------------

export async function confirmPlanChange({ sellerId, planCode, billingInterval }) {
  const preview = await previewPlanChange({ sellerId, planCode, billingInterval });
  if (!preview.ok) {
    // Same-target pending upgrade → reuse existing PayMongo checkout (no duplicate rows)
    if (preview.error === 'PLAN_CHANGE_CONFLICT') {
      const pending = await getPendingUpgrade(sellerId);
      const targetPlan = getPlanByCode(planCode);
      const targetIv = normalizeBillingInterval(billingInterval || pending?.target_billing_interval);
      if (
        pending &&
        targetPlan &&
        pending.target_plan_code === targetPlan.code &&
        normalizeBillingInterval(pending.target_billing_interval) === targetIv
      ) {
        const { rows } = await pool.query(`SELECT * FROM billing_records WHERE id = $1`, [
          pending.billing_record_id,
        ]);
        const billing = rows[0];
        if (billing && ['pending', 'processing'].includes(String(billing.status))) {
          const checkout = await createBillingCheckoutSession(billing, { actorRole: 'shop_owner' });
          return {
            mode: 'pending_payment',
            change: pending,
            billing: checkout.billing || billing,
            checkout_url: checkout.checkout_url,
            preview: { ...preview, active_change: serializeChange(pending), reused: true },
            amount_due_now: Number(pending.proration_amount) || 0,
            reused: true,
          };
        }
      }
    }
    const err = new Error(preview.message || 'Plan change not allowed');
    err.statusCode = preview.status || 409;
    err.code = preview.error || 'PLAN_CHANGE_CONFLICT';
    err.details = preview.details;
    err.conflicts = preview.conflicts || null;
    throw err;
  }

  // Explicit reuse when preview flagged an identical pending upgrade
  if (preview.reuse_pending_change && preview.active_change?.id) {
    let pending = await getSubscriptionChangeById(preview.active_change.id, sellerId);
    if (!pending || pending.status !== 'pending_payment') {
      pending = await getPendingUpgrade(sellerId);
    }
    if (pending && pending.status === 'pending_payment') {
      const { rows } = await pool.query(`SELECT * FROM billing_records WHERE id = $1`, [
        pending.billing_record_id,
      ]);
      const billing = rows[0];
      if (billing && ['pending', 'processing'].includes(String(billing.status))) {
        const checkout = await createBillingCheckoutSession(billing, { actorRole: 'shop_owner' });
        return {
          mode: 'pending_payment',
          change: pending,
          billing: checkout.billing || billing,
          checkout_url: checkout.checkout_url,
          preview,
          amount_due_now: Number(pending.proration_amount) || 0,
          reused: true,
        };
      }
    }
  }

  if (preview.type === 'noop') {
    return { mode: 'noop', preview };
  }

  const targetPlan = getPlanByCode(planCode);
  const targetInterval = normalizeBillingInterval(billingInterval || preview.billing_interval);
  const currentInterval = normalizeBillingInterval(preview.current_interval || 'monthly');
  const currentPlan = preview.current_plan ? getPlanByCode(preview.current_plan.code) : null;

  // NEW subscription — reuse existing checkout path shape
  if (preview.mode === 'new_subscription') {
    return { mode: 'new_subscription', preview, plan: targetPlan };
  }

  // DOWNGRADE / reduced commitment → schedule at period end
  if (preview.type === 'downgrade') {
    const change = await scheduleDowngrade({
      sellerId,
      currentPlan,
      targetPlan,
      currentInterval,
      targetInterval,
      effectiveAt: preview.effective_at,
    });
    return { mode: 'scheduled', change, preview };
  }

  // UPGRADE / higher commitment
  const amountDueNow = Number(preview.amount_due_now) || 0;

  if (amountDueNow === 0) {
    // Zero-cost upgrade — Priority 1 / C6:
    // Do NOT insert status='applied' before billing changes. Insert pending_payment,
    // then applyUpgradeChange claims → applyPlanChangeToBilling → marks applied.
    let zeroChange;
    try {
      const { rows } = await pool.query(
        `INSERT INTO subscription_changes
           (seller_id, current_plan_code, target_plan_code,
            current_billing_interval, target_billing_interval,
            change_type, status, effective_at, proration_amount)
         VALUES ($1, $2, $3, $4, $5, 'upgrade', 'pending_payment', now()::date, 0)
         RETURNING *`,
        [
          sellerId,
          currentPlan?.code || null,
          targetPlan.code,
          currentInterval,
          targetInterval,
        ]
      );
      zeroChange = rows[0];
    } catch (e) {
      if (String(e.message || '').includes('idx_subscription_changes_one_pending')) {
        const err = new Error('A plan upgrade is already in progress.');
        err.statusCode = 409;
        err.code = 'PLAN_CHANGE_CONFLICT';
        throw err;
      }
      throw e;
    }
    const applied = await applyUpgradeChange({ change: zeroChange, source: 'zero_cost_upgrade' });
    return {
      mode: 'applied_immediately',
      change: applied?.change || zeroChange,
      billing: applied?.billing || null,
      preview,
      amount_due_now: 0,
    };
  }

  // Upgrade with proration charge — pending_payment until PayMongo confirms
  let change;
  try {
    const { rows: changeRows } = await pool.query(
      `INSERT INTO subscription_changes
         (seller_id, current_plan_code, target_plan_code,
          current_billing_interval, target_billing_interval,
          change_type, status, effective_at, proration_amount)
       VALUES ($1, $2, $3, $4, $5, 'upgrade', 'pending_payment', now()::date, $6)
       RETURNING *`,
      [
        sellerId,
        currentPlan?.code || null,
        targetPlan.code,
        currentInterval,
        targetInterval,
        amountDueNow,
      ]
    );
    change = changeRows[0];
  } catch (e) {
    if (String(e.message || '').includes('idx_subscription_changes_one_pending')) {
      const err = new Error('A plan upgrade payment is already in progress.');
      err.statusCode = 409;
      err.code = 'PLAN_CHANGE_CONFLICT';
      throw err;
    }
    throw e;
  }

  // Proration billing row (appears in billing history as upgrade_proration)
  const period = preview.period || computeBillingPeriod(currentInterval, new Date());
  const { rows: billingRows } = await pool.query(
    `INSERT INTO billing_records
       (seller_id, amount, billing_period, status, due_date,
        current_period_start, current_period_end, plan_code,
        billing_interval, billing_type, subscription_change_id)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, 'upgrade_proration', $9)
     RETURNING *`,
    [
      sellerId,
      amountDueNow,
      `Upgrade to ${targetPlan.name}`,
      period.end || toISODate(new Date()),
      period.start,
      period.end,
      targetPlan.code,
      currentInterval,
      change.id,
    ]
  );
  const billing = billingRows[0];

  await pool.query(
    `UPDATE subscription_changes SET billing_record_id = $1, paymongo_checkout_session_id = $2 WHERE id = $3`,
    [billing.id, billing.paymongo_checkout_session_id || null, change.id]
  );

  const checkout = await createBillingCheckoutSession(billing, { actorRole: 'shop_owner' });

  // Persist checkout session on the change row
  const checkoutId = checkout.billing?.paymongo_checkout_session_id || null;
  if (checkoutId) {
    await pool.query(
      `UPDATE subscription_changes SET paymongo_checkout_session_id = $1 WHERE id = $2`,
      [checkoutId, change.id]
    );
  }

  await writeAuditLog({
    userId: sellerId,
    action: 'upgrade_initiated',
    entityType: 'subscription_change',
    entityId: change.id,
    details: {
      target_plan: targetPlan.code,
      target_interval: targetInterval,
      proration_amount: amountDueNow,
      billing_record_id: billing.id,
    },
  });

  return {
    mode: 'pending_payment',
    change,
    billing: checkout.billing || billing,
    checkout_url: checkout.checkout_url,
    preview,
    amount_due_now: amountDueNow,
    reused: false,
  };
}

/**
 * Called when a proration billing row is marked paid (webhook or polling).
 * Idempotent.
 */
export async function applyPendingUpgradeForBilling(billing) {
  if (!billing?.subscription_change_id) return null;
  const { rows } = await pool.query(
    `SELECT * FROM subscription_changes WHERE id = $1`,
    [billing.subscription_change_id]
  );
  const change = rows[0];
  if (!change) return null;
  if (change.status === 'applied') return { change, alreadyApplied: true };
  if (change.status !== 'pending_payment') return null;
  return applyUpgradeChange({
    change,
    paymentReference: billing.payment_reference || null,
    source: 'webhook',
  });
}

// ---------------------------------------------------------------------------
// Apply scheduled downgrades when a billing period ends
// ---------------------------------------------------------------------------

/**
 * Apply scheduled downgrades when their effective_at date has passed.
 * Safety:
 * - Idempotent: each change is claimed via UPDATE ... WHERE status='scheduled'
 *   before billing insert; concurrent/repeated jobs skip already-claimed rows.
 * - Retryable: if billing insert fails, status is reverted to 'scheduled'
 *   (billing_record_id still NULL) so the next run can apply it.
 * - Overdue changes (effective_at in the past) are picked up on any run
 *   (startup + daily cron `0 2 * * *` in backend/src/index.js). Exact midnight
 *   per-seller timezone is NOT guaranteed.
 */
export async function applyScheduledChangesDue(now = new Date()) {
  // H2: scheduled plan changes mutate billing + plan state. Claim UPDATE is atomic,
  // but FOR UPDATE SKIP LOCKED + multi-statement apply require direct pg.
  const { requireDirectPg } = await import('../db/dbGuard.js');
  requireDirectPg('applyScheduledChangesDue');
  const today = toISODate(now);
  let applied = 0;
  let failed = 0;
  try {
    // Multi-instance safety: advisory lock (in addition to per-row claim)
    const { runExclusiveJob } = await import('./jobLock.js');
    const lockResult = await runExclusiveJob('subscription_scheduled', async () => {
      const { rows } = await pool.query(
        `SELECT * FROM subscription_changes
       WHERE status = 'scheduled' AND effective_at <= $1
       ORDER BY effective_at ASC
       FOR UPDATE SKIP LOCKED`,
        [today]
      );
      for (const change of rows) {
        // Claim first — concurrent job runners cannot double-apply
        const { rows: claimed } = await pool.query(
          `UPDATE subscription_changes
         SET status = 'applied', applied_at = now()
         WHERE id = $1 AND status = 'scheduled'
         RETURNING *`,
          [change.id]
        );
        if (!claimed.length) continue;

        const targetPlan = getPlanByCode(change.target_plan_code);
        if (!targetPlan) {
          await pool.query(
            `UPDATE subscription_changes SET status = 'failed' WHERE id = $1 AND status = 'applied'`,
            [change.id]
          );
          failed += 1;
          console.error(
            `[subscription-changes] unknown target_plan_code for change ${change.id}: ${change.target_plan_code}`
          );
          continue;
        }

        const targetInterval = normalizeBillingInterval(change.target_billing_interval);
        try {
          const periodStart = change.effective_at ? new Date(change.effective_at) : new Date();
          const nextPeriod = computeBillingPeriod(targetInterval, periodStart);
          const amount = getPlanPriceForInterval(targetPlan, targetInterval);

          const { rows: billingRows } = await pool.query(
            `INSERT INTO billing_records
           (seller_id, amount, billing_period, status, due_date,
            current_period_start, current_period_end, plan_code,
            billing_interval, billing_type, subscription_change_id)
         VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, 'subscription', $9)
         RETURNING *`,
            [
              change.seller_id,
              amount,
              nextPeriod.label,
              nextPeriod.due_date,
              nextPeriod.start,
              nextPeriod.end,
              targetPlan.code,
              targetInterval,
              change.id,
            ]
          );

          await pool.query(
            `UPDATE subscription_changes
           SET billing_record_id = COALESCE($1, billing_record_id)
           WHERE id = $2`,
            [billingRows[0]?.id || null, change.id]
          );

          await writeAuditLog({
            userId: change.seller_id,
            action: 'downgrade_applied',
            entityType: 'subscription_change',
            entityId: change.id,
            details: {
              target_plan: targetPlan.code,
              target_interval: targetInterval,
              billing_record_id: billingRows[0]?.id || null,
              effective_at: change.effective_at,
            },
          });

          await notifyUserOnce({
            userId: change.seller_id,
            type: 'payout',
            message: `Your subscription is now ${targetPlan.name}.`,
            withinHours: 24,
          });

          applied += 1;
        } catch (e) {
          failed += 1;
          try {
            await pool.query(
              `UPDATE subscription_changes
           SET status = 'scheduled', applied_at = NULL
           WHERE id = $1 AND status = 'applied' AND billing_record_id IS NULL`,
              [change.id]
            );
          } catch (revertErr) {
            console.error(
              `[subscription-changes] failed to revert change ${change.id}`,
              revertErr.message
            );
          }
          console.error(
            `[subscription-changes] failed to apply change ${change.id} to ${change.target_plan_code}: ${e.message}`
          );
        }
      }
      if (applied || failed) {
        console.log(
          `[subscription-changes] applied=${applied} failed=${failed} scheduled_changes_due as of ${today}`
        );
      }
      return applied;
    });
    if (lockResult?.skipped) {
      console.warn('[subscription-changes] applyScheduledChangesDue skipped:', lockResult.reason);
      return 0;
    }
    return lockResult?.result ?? applied;
  } catch (e) {
    console.error('[subscription-changes] applyScheduledChangesDue failed', e.message);
    return 0;
  }
}
