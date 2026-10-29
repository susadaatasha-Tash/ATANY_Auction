import { pool } from '../db/pool.js';
import { getPlanCatalog, getPlanByCode, resolvePlanForRecord, normalizeBillingInterval } from '../config/subscriptionPlans.js';
import {
  addOneCalendarMonth,
  computeMonthlyPeriod,
  createBillingCheckoutSession,
  createPendingBillingForPlan,
  evaluatePlanCheckoutRequest,
  ensureNextPeriod,
  getBillingRecordsForSeller,
  getShopForSeller,
  buildSubscriptionSummary,
  syncBillingWithPayMongo,
  writeAuditLog,
  toISODate,
  normalizeMrrContribution,
  computeSubscriptionMetricsFromRecords,
  getPaymentMethodsCapability,
} from '../services/subscriptionService.js';
import {
  previewPlanChange,
  confirmPlanChange,
  cancelScheduledChange,
  cancelPendingUpgrade,
  getActiveSubscriptionChange,
  getPendingUpgrade,
  getScheduledDowngrade,
} from '../services/subscriptionPlanChangeService.js';
import {
  listPaymentMethodsForSeller,
  attachPaymentMethod,
  setDefaultPaymentMethod,
  deletePaymentMethod,
  assertNoSensitiveCardFields,
} from '../services/paymentMethodService.js';

function readInterval(body) {
  const raw = body?.billing_interval ?? body?.billingInterval ?? body?.interval ?? 'monthly';
  const iv = normalizeBillingInterval(raw);
  return iv;
}

// GET /subscription-plans — backend-driven plan catalog
export const listSubscriptionPlans = async (_req, res) => {
  try {
    res.json({ plans: getPlanCatalog() });
  } catch (e) {
    console.error('listSubscriptionPlans failed:', e.message);
    res.status(500).json({ message: 'Failed to load subscription plans' });
  }
};

// GET /billing/me — seller's own billing history (array shape kept for existing UI)
export const listMyBilling = async (req, res) => {
  try {
    try {
      await ensureNextPeriod(req.user.id);
    } catch (e) {
      console.warn('[ensureNextPeriod]', e.message);
    }
    const rows = await getBillingRecordsForSeller(req.user.id);
    res.json(rows);
  } catch (e) {
    console.error('listMyBilling failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch billing records' });
  }
};

// GET /billing/me/subscription — current subscription summary for authenticated seller
export const getMySubscription = async (req, res) => {
  try {
    try {
      await ensureNextPeriod(req.user.id);
    } catch {}
    const rows = await getBillingRecordsForSeller(req.user.id);
    const shop = await getShopForSeller(req.user.id);
    const summary = buildSubscriptionSummary(rows);
    let scheduled_change = null;
    let active_change = null;
    let pending_change = null;
    try {
      active_change = await getActiveSubscriptionChange(req.user.id);
      scheduled_change = await getScheduledDowngrade(req.user.id);
      pending_change = await getPendingUpgrade(req.user.id);
    } catch {}
    res.json({
      ...summary,
      scheduled_change,
      active_change,
      pending_change,
      shop: shop
        ? { id: shop.id, shop_name: shop.shop_name, home_branch_id: shop.home_branch_id }
        : null,
      billing: rows,
      plans: getPlanCatalog(),
    });
  } catch (e) {
    console.error('getMySubscription failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch subscription' });
  }
};

// GET /billing/me/:id — seller's own billing + PayMongo polling fallback
export const getMyBillingOne = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM billing_records WHERE id=$1 AND seller_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Billing record not found' });
    let billing = rows[0];
    billing = await syncBillingWithPayMongo(billing);
    res.json(billing);
  } catch (e) {
    console.error('getMyBillingOne failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch billing record' });
  }
};

// POST /billing/:id/checkout — seller pays/retries own billing record.
// Optional body { payment_method } restricts the hosted PayMongo checkout to a
// single method ('gcash' | 'card' | 'qrph' | 'maya' | 'billease' when
// enabled). Amount/seller always derived server-side; unknown types → 400.
export const createMaintenanceCheckout = async (req, res) => {
  try {
    const requestedType = (req.body?.payment_method || req.body?.paymentMethod || '')
      .toString()
      .trim()
      .toLowerCase();
    const { rows } = await pool.query(
      `SELECT * FROM billing_records WHERE id=$1 AND seller_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Billing record not found' });
    const result = await createBillingCheckoutSession(rows[0], {
      actorRole: 'shop_owner',
      paymentMethodTypes: requestedType || null,
    });
    res.json({ checkout_url: result.checkout_url, billing: result.billing, reused: result.reused });
  } catch (e) {
    const status = e.statusCode || 500;
    if (e.code === 'INVALID_PAYMENT_METHOD_TYPE') {
      return res.status(status).json({ error: e.code, message: e.message });
    }
    console.error('[billing checkout]', e.message);
    res.status(status).json({ message: e.message || 'Failed to create checkout' });
  }
};

// POST /billing/subscription/checkout — seller selects a plan by plan_code only.
// Backend resolves seller, shop, price, period. Never trusts client amount/identity.
export const checkoutSubscriptionPlan = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const planCode = (req.body?.plan_code || req.body?.planCode || '').toString().trim();
    if (!planCode) return res.status(400).json({ message: 'plan_code is required' });
    const billingInterval = readInterval(req.body);

    const shop = await getShopForSeller(sellerId);
    const records = await getBillingRecordsForSeller(sellerId);
    const decision = evaluatePlanCheckoutRequest({ records, planCode, shop, billingInterval });
    if (!decision.ok) {
      return res.status(decision.status || 409).json({ message: decision.message });
    }

    let billing;
    if (decision.mode === 'reuse_open' && decision.billing) {
      billing = decision.billing;
    } else {
      billing = await createPendingBillingForPlan({
        sellerId,
        plan: decision.plan,
        interval: decision.interval || billingInterval,
      });
      await writeAuditLog({
        userId: sellerId,
        action: 'subscription_checkout_created',
        entityType: 'billing',
        entityId: billing.id,
        details: {
          plan_code: decision.plan.code,
          amount: billing.amount,
          billing_interval: billing.billing_interval || billingInterval,
          shop_id: shop?.id || null,
        },
      });
    }

    const result = await createBillingCheckoutSession(billing, { actorRole: 'shop_owner' });
    res.status(decision.mode === 'create_new' ? 201 : 200).json({
      checkout_url: result.checkout_url,
      billing: result.billing,
      plan: {
        code: decision.plan.code,
        name: decision.plan.name,
        monthly_price: decision.plan.monthly_price,
        annual_price: decision.plan.annual_price,
      },
      billing_interval: billing.billing_interval || billingInterval,
    });
  } catch (e) {
    const status = e.statusCode || 500;
    console.error('[subscription checkout]', e.message);
    res.status(status).json({ message: e.message || 'Failed to start subscription checkout' });
  }
};

// ---------------------------------------------------------------------------
// Plan change — preview / confirm / cancel (seller)
// ---------------------------------------------------------------------------

export const previewSubscriptionChange = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const planCode = (req.body?.plan_code || req.body?.planCode || '').toString().trim();
    if (!planCode) return res.status(400).json({ error: 'INVALID_PLAN', message: 'plan_code is required' });
    const billingInterval = readInterval(req.body);

    const preview = await previewPlanChange({ sellerId, planCode, billingInterval });
    if (!preview.ok) {
      return res.status(preview.status || 409).json({
        error: preview.error || 'PLAN_CHANGE_CONFLICT',
        message: preview.message,
        details: preview.details,
        conflicts: preview.conflicts || null,
        active_change: preview.active_change || null,
        current_plan: preview.current_plan,
        target_plan: preview.target_plan,
      });
    }
    res.json(preview);
  } catch (e) {
    console.error('[subscription change preview]', e.message);
    res.status(500).json({ message: 'Failed to preview plan change' });
  }
};

export const confirmSubscriptionChange = async (req, res) => {
  try {
    const sellerId = req.user.id;
    const planCode = (req.body?.plan_code || req.body?.planCode || '').toString().trim();
    if (!planCode) return res.status(400).json({ error: 'INVALID_PLAN', message: 'plan_code is required' });
    const billingInterval = readInterval(req.body);

    const result = await confirmPlanChange({ sellerId, planCode, billingInterval });

    if (result.mode === 'new_subscription') {
      // Fall through to first-time checkout path
      const shop = await getShopForSeller(sellerId);
      const records = await getBillingRecordsForSeller(sellerId);
      const decision = evaluatePlanCheckoutRequest({ records, planCode, shop, billingInterval });
      if (!decision.ok) {
        return res.status(decision.status || 409).json({ message: decision.message });
      }
      const billing = await createPendingBillingForPlan({
        sellerId,
        plan: decision.plan,
        interval: decision.interval || billingInterval,
      });
      const checkout = await createBillingCheckoutSession(billing, { actorRole: 'shop_owner' });
      return res.status(201).json({
        mode: 'new_subscription',
        checkout_url: checkout.checkout_url,
        billing: checkout.billing,
        plan: decision.plan,
        billing_interval: billingInterval,
      });
    }

    if (result.mode === 'scheduled') {
      return res.json({
        mode: 'scheduled',
        change: result.change,
        preview: result.preview,
      });
    }

    if (result.mode === 'applied_immediately') {
      return res.json({
        mode: 'applied_immediately',
        change: result.change,
        billing: result.billing,
        amount_due_now: 0,
      });
    }

    if (result.mode === 'pending_payment') {
      return res.status(result.reused ? 200 : 201).json({
        mode: 'pending_payment',
        change: result.change,
        billing: result.billing,
        checkout_url: result.checkout_url,
        amount_due_now: result.amount_due_now,
        preview: result.preview,
        reused: !!result.reused,
      });
    }

    if (result.mode === 'noop') {
      return res.json(result);
    }

    res.json(result);
  } catch (e) {
    const status = e.statusCode || 500;
    const code = e.code || 'PLAN_CHANGE_CONFLICT';
    console.error('[subscription change confirm]', e.message);
    res.status(status).json({
      error: code,
      message: e.message || 'Failed to confirm plan change',
      details: e.details,
    });
  }
};

export const cancelSubscriptionChange = async (req, res) => {
  try {
    // Scheduled downgrades first (existing behavior).
    try {
      const change = await cancelScheduledChange({ sellerId: req.user.id });
      return res.json({ ok: true, kind: 'scheduled', change });
    } catch (e) {
      if (e?.code !== 'NO_SCHEDULED_CHANGE') throw e;
    }
    // Then unpaid pending upgrades (validated: unpaid only, never paid).
    const result = await cancelPendingUpgrade({
      sellerId: req.user.id,
      changeId: req.body?.change_id || req.body?.changeId || null,
    });
    if (result.reconciled) {
      return res.json({ ok: true, kind: 'reconciled', reconciled: result.reconciled, change: result.change || null });
    }
    return res.json({ ok: true, kind: 'pending', change: result.change });
  } catch (e) {
    const status = e.statusCode || 500;
    console.error('[subscription change cancel]', e.message);
    res.status(status).json({
      error: e.code || 'PLAN_CHANGE_CONFLICT',
      message: e.message || 'Failed to cancel scheduled change',
    });
  }
};

// ---------------------------------------------------------------------------
// Payment methods (safe metadata only)
// ---------------------------------------------------------------------------

// GET /billing/paymongo-config — client config for PayMongo.js Elements.
// SECURITY: only the PUBLISHABLE key (pk_...) is ever serialized; the secret
// key stays server-side in PAYMONGO_SECRET_KEY and is never read here.
// payment_methods is the provider capability map the frontend renders rows
// from (QR Ph / Card / GCash / GrabPay / Maya; BillEase only when enabled).
export const getPaymongoClientConfig = async (_req, res) => {
  try {
    const publishableKey = String(process.env.PAYMONGO_PUBLIC_KEY || '').trim();
    res.json({
      publishable_key: publishableKey || null,
      elements_src: 'https://js.paymongo.com/v1/elements.js',
      payment_methods: getPaymentMethodsCapability(),
    });
  } catch (e) {
    console.error('[paymongo config]', e.message);
    res.status(500).json({ message: 'Failed to load payment config' });
  }
};

export const listMyPaymentMethods = async (req, res) => {
  try {
    const methods = await listPaymentMethodsForSeller(req.user.id);
    res.json({ payment_methods: methods });
  } catch (e) {
    console.error('[payment-methods list]', e.message);
    res.status(500).json({ message: 'Failed to load payment methods' });
  }
};

export const attachMyPaymentMethod = async (req, res) => {
  try {
    assertNoSensitiveCardFields(req.body || {});
    const pmId = req.body?.provider_payment_method_id || req.body?.providerPaymentMethodId;
    const method = await attachPaymentMethod({
      sellerId: req.user.id,
      providerPaymentMethodId: pmId,
      type: req.body?.type,
      brand: req.body?.brand,
      last4: req.body?.last4,
      expMonth: req.body?.exp_month ?? req.body?.expMonth,
      expYear: req.body?.exp_year ?? req.body?.expYear,
      makeDefault: req.body?.make_default ?? req.body?.makeDefault ?? req.body?.is_default,
    });
    res.status(201).json({ payment_method: method });
  } catch (e) {
    const status = e.statusCode || 500;
    console.error('[payment-methods attach]', e.message);
    res.status(status).json({
      error: e.code || 'PAYMENT_METHOD_ERROR',
      message: e.message || 'Failed to attach payment method',
    });
  }
};

export const setDefaultMyPaymentMethod = async (req, res) => {
  try {
    const method = await setDefaultPaymentMethod({
      sellerId: req.user.id,
      methodId: req.params.id,
    });
    res.json({ payment_method: method });
  } catch (e) {
    const status = e.statusCode || 500;
    console.error('[payment-methods default]', e.message);
    res.status(status).json({
      error: e.code || 'PAYMENT_METHOD_ERROR',
      message: e.message || 'Failed to set default payment method',
    });
  }
};

export const deleteMyPaymentMethod = async (req, res) => {
  try {
    const result = await deletePaymentMethod({ sellerId: req.user.id, methodId: req.params.id });
    res.json(result);
  } catch (e) {
    const status = e.statusCode || 500;
    console.error('[payment-methods delete]', e.message);
    res.status(status).json({
      error: e.code || 'PAYMENT_METHOD_ERROR',
      message: e.message || 'Failed to delete payment method',
    });
  }
};

// GET /billing — admin list (same billing_records source of truth)
export const listAllBilling = async (req, res) => {
  try {
    const { status, seller_id } = req.query;
    const allowedStatuses = ['pending', 'paid', 'overdue', 'failed', 'expired', 'cancelled'];
    if (status && !allowedStatuses.includes(status)) {
      return res
        .status(400)
        .json({ message: `Status must be one of: ${allowedStatuses.join(', ')}` });
    }
    if (seller_id) {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(seller_id)) return res.status(400).json({ message: 'Invalid seller ID' });
    }
    let where = [];
    let params = [];
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (seller_id) {
      params.push(seller_id);
      where.push(`seller_id = $${params.length}`);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows: billings } = await pool.query(
      `SELECT * FROM billing_records ${whereClause} ORDER BY created_at DESC`,
      params
    );

    // Scheduled changes for admin sync (current plan stays until effective_at)
    let scheduledMap = {};
    try {
      const { rows: changes } = await pool.query(
        `SELECT * FROM subscription_changes WHERE status IN ('scheduled', 'pending_payment')`
      );
      for (const c of changes) {
        if (!scheduledMap[c.seller_id]) scheduledMap[c.seller_id] = [];
        scheduledMap[c.seller_id].push(c);
      }
    } catch {}

    if (!billings.length) return res.json([]);

    const sellerIds = [...new Set(billings.map((b) => b.seller_id).filter(Boolean))];
    let userMap = {};
    let shopMap = {};
    let branchMap = {};
    if (sellerIds.length) {
      const { rows: users } = await pool.query(
        `SELECT id, name, email FROM users WHERE id IN (${sellerIds.map((_, i) => `$${i + 1}`).join(',')})`,
        sellerIds
      );
      userMap = Object.fromEntries(users.map((u) => [u.id, u]));
      const { rows: shops } = await pool.query(
        `SELECT * FROM shops WHERE user_id IN (${sellerIds.map((_, i) => `$${i + 1}`).join(',')})`,
        sellerIds
      );
      shopMap = Object.fromEntries(shops.map((s) => [s.user_id, s]));
      const branchIds = [...new Set(shops.map((s) => s.home_branch_id).filter(Boolean))];
      if (branchIds.length) {
        const { rows: branches } = await pool.query(
          `SELECT * FROM branches WHERE id IN (${branchIds.map((_, i) => `$${i + 1}`).join(',')})`,
          branchIds
        );
        branchMap = Object.fromEntries(branches.map((b) => [b.id, b]));
      }
    }

    const rows = billings.map((br) => {
      const u = userMap[br.seller_id] || {};
      const s = shopMap[br.seller_id] || {};
      const b = branchMap[s.home_branch_id] || {};
      const plan = resolvePlanForRecord(br);
      const interval = normalizeBillingInterval(br.billing_interval || 'monthly');
      const changes = scheduledMap[br.seller_id] || [];
      const scheduled = changes.find((c) => c.status === 'scheduled') || null;
      const pending = changes.find((c) => c.status === 'pending_payment') || null;
      return {
        ...br,
        plan_code: br.plan_code || plan.code,
        plan_name: plan.name,
        plan_annual_price: plan.annual_price,
        billing_interval: interval,
        mrr: normalizeMrrContribution(plan, interval),
        scheduled_plan_code: scheduled?.target_plan_code || null,
        scheduled_billing_interval: scheduled?.target_billing_interval || null,
        scheduled_effective_at: scheduled?.effective_at || null,
        pending_change_plan_code: pending?.target_plan_code || null,
        seller_name: u.name || null,
        seller_email: u.email || null,
        shop_name: s.shop_name || null,
        branch_name: b.name || null,
        branch_address: b.address || null,
      };
    });

    // Backward-compatible array response (admin UI reads rows directly).
    // Each row is enriched with plan_code/plan_name from the shared catalog.
    res.json(rows);
  } catch (e) {
    console.error('listAllBilling failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch billing records' });
  }
};

// Admin creates a billing record — plan_code preferred; amount server-derived when plan_code given
export const createBillingRecord = async (req, res) => {
  const { seller_id, plan_code, amount, billing_period, due_date } = req.body;
  const billingInterval = readInterval(req.body);
  if (!seller_id) return res.status(400).json({ message: 'seller_id is required' });
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(seller_id)) return res.status(400).json({ message: 'Invalid seller ID' });

  let plan = null;
  let finalAmount = amount;
  if (plan_code) {
    plan = getPlanByCode(plan_code);
    if (!plan) return res.status(400).json({ message: 'Invalid plan_code' });
    finalAmount =
      billingInterval === 'annual' ? plan.annual_price : plan.monthly_price; // server catalog wins
  } else if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ message: 'Valid amount or plan_code is required' });
  }

  if (!billing_period || typeof billing_period !== 'string' || !billing_period.trim()) {
    return res.status(400).json({ message: 'billing_period is required' });
  }
  if (billing_period.length > 50) {
    return res.status(400).json({ message: 'billing_period must be at most 50 characters' });
  }
  if (due_date && isNaN(Date.parse(due_date))) {
    return res.status(400).json({ message: 'Invalid due_date format' });
  }

  try {
    const now = new Date();
    const end = due_date ? new Date(due_date) : addOneCalendarMonth(now);
    const startStr = toISODate(now);
    const endStr = toISODate(end);
    const planCode = plan?.code || resolvePlanForRecord({ amount: finalAmount }).code;
    const { rows } = await pool.query(
      `INSERT INTO billing_records
         (seller_id, amount, billing_period, due_date, current_period_start, current_period_end, plan_code, billing_interval)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        seller_id,
        Number(finalAmount),
        billing_period.trim(),
        due_date || endStr,
        startStr,
        endStr,
        planCode,
        billingInterval,
      ]
    );
    await writeAuditLog({
      userId: req.user.id,
      action: 'billing_record_created',
      entityType: 'billing',
      entityId: rows[0].id,
      details: {
        seller_id,
        plan_code: planCode,
        amount: finalAmount,
        billing_interval: billingInterval,
        actor_role: 'admin',
      },
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('createBillingRecord failed:', e.message);
    res.status(500).json({ message: 'Failed to create billing record' });
  }
};

// Admin retries eligible billing (same PayMongo session rules as seller)
export const adminRetryBilling = async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM billing_records WHERE id=$1`, [
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ message: 'Billing record not found' });
    const billing = rows[0];
    const result = await createBillingCheckoutSession(billing, { actorRole: 'admin' });
    await writeAuditLog({
      userId: req.user.id,
      action: 'billing_retry_admin',
      entityType: 'billing',
      entityId: billing.id,
      details: {
        seller_id: billing.seller_id,
        previous_status: billing.status,
        amount: billing.amount,
        actor_role: 'admin',
      },
    });
    res.json({ checkout_url: result.checkout_url, billing: result.billing, reused: result.reused });
  } catch (e) {
    const status = e.statusCode || 500;
    console.error('[billing admin retry]', e.message);
    res.status(status).json({ message: e.message || 'Failed to retry charge' });
  }
};

// Keep helper exported for tests / other controllers that may import it
export { addOneMonthAlias as addOneMonth };
function addOneMonthAlias(date) {
  return addOneCalendarMonth(date);
}

export { computeMonthlyPeriod };
