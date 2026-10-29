// frontend/src/roles/shop-owner/pages/Billing.jsx
// Seller Subscription — premium portal (current plan, usage, next payment, compare, history)
// Change plan / Manage billing open the Manage Billing modal (not page redesign).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { CurrentPlanHero } from '../subscription/CurrentPlanHero';
import { SubscriptionUsage } from '../subscription/SubscriptionUsage';
import { NextPaymentCard } from '../subscription/NextPaymentCard';
import { ComparePlans } from '../subscription/ComparePlans';
import { BillingHistory } from '../subscription/BillingHistory';
import { ManageBillingModal } from '../subscription/ManageBillingModal';
import { UpgradeConfirmModal } from '../subscription/UpgradeConfirmModal';
import { DowngradeConfirmModal } from '../subscription/DowngradeConfirmModal';
import { PaymentMethodModal } from '../subscription/PaymentMethodModal';
import {
  billingHistoryRows,
  buildComparePlans,
  buildSellerSubscriptionState,
  buildUsageMetrics,
  formatDate,
} from '../subscription/sellerSubscriptionSelectors';
import {
  normalizeBillingInterval,
  getPlanForPlanCode,
  planPriceLabel,
} from '../../../shared/lib/subscriptionPlans';
import { SubscriptionPageSkeleton, NextPaymentCardSkeleton } from '../subscription/SubscriptionPageSkeleton';
import '../subscription/seller-subscription.css';

// Exported for unit tests. Maps structured backend error codes to friendly
// UI messages; unknown errors fall back to the server message (never SQL).
export function billingErrorText(e, fallback) {
  switch (e?.code) {
    case 'SUBSCRIPTION_NOT_FOUND': return 'Subscription information could not be found.';
    case 'INVALID_PLAN': return 'Selected plan is unavailable.';
    case 'INVALID_INTERVAL':
    case 'INVALID_BILLING_INTERVAL': return 'Selected billing interval is invalid.';
    case 'MIGRATION_MISSING': return 'Billing configuration is unavailable.';
    case 'BILLING_UNAVAILABLE': return 'Billing service is temporarily unavailable.';
    default: return e?.message || fallback;
  }
}

export default function Billing() {
  const [records, setRecords] = useState([]);
  const [listings, setListings] = useState([]);
  const [auctions, setAuctions] = useState([]);
  const [shop, setShop] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState([]);
  // Request-state model. `initialLoading` is driven ONLY by the primary
  // subscription request; secondary requests (usage inputs, payment methods,
  // scheduled/pending change) never block the page.
  const [initialLoading, setInitialLoading] = useState(true);
  const [secondaryLoading, setSecondaryLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [payingId, setPayingId] = useState(null);
  const [planNotice, setPlanNotice] = useState('');
  const compareRef = useRef(null);
  const historyRef = useRef(null);
  const showToast = useToast();

  // Modals
  const [manageOpen, setManageOpen] = useState(false);
  const [payMethodOpen, setPayMethodOpen] = useState(false);
  const [upgradePreview, setUpgradePreview] = useState(null);
  const [downgradePreview, setDowngradePreview] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [modalError, setModalError] = useState('');
  const [busyPlanCode, setBusyPlanCode] = useState(null);
  const [scheduledChange, setScheduledChange] = useState(null);
  const [pendingChange, setPendingChange] = useState(null);
  const [subscriptionSummary, setSubscriptionSummary] = useState(null);

  // `silent` skips the page-level loading gate: payment-method changes refresh
  // in the background so an open modal never unmounts/resets mid-action.
  // `silent` keeps the already-rendered page visible while refreshing in the
  // background (payment-method changes, plan actions) so an open modal never
  // unmounts and the page never flashes a skeleton it does not need.
  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else { setInitialLoading(true); setSecondaryLoading(true); }

    // PRIMARY: the subscription records themselves. This alone gates the page.
    let billingRows = null;
    try {
      billingRows = await apiFetch('/billing/me');
      setRecords(Array.isArray(billingRows) ? billingRows : []);
      setError(null);
      setInitialLoading(false);
    } catch (e) {
      setError(billingErrorText(e, 'Failed to load subscription data'));
      setRecords([]);
      setInitialLoading(false);
      setSecondaryLoading(false);
      return;
    } finally {
      if (!silent) setRefreshing(false);
    }

    // SECONDARY: independent, never block the page, each already has its own
    // fallback so one slow endpoint cannot take the whole screen down.
    try {
      const [listingRows, auctionRows, shopRow, subRes, pmRes] = await Promise.all([
        apiFetch('/shop-owner/listings').catch(() => []),
        apiFetch('/shop-owner/auctions').catch(() => []),
        apiFetch('/shop-owner/shop').catch(() => null),
        apiFetch('/billing/me/subscription').catch(() => null),
        apiFetch('/billing/payment-methods').catch(() => ({ payment_methods: [] })),
      ]);
      setListings(Array.isArray(listingRows) ? listingRows : []);
      setAuctions(Array.isArray(auctionRows) ? auctionRows : []);
      setShop(shopRow || null);
      setPaymentMethods(
        Array.isArray(pmRes?.payment_methods)
          ? pmRes.payment_methods
          : Array.isArray(pmRes)
            ? pmRes
            : []
      );
      // Scheduled banner shows REAL scheduled downgrades only — a pending
      // upgrade is surfaced separately via pendingChange (never conflated).
      setSubscriptionSummary(subRes || null);
      setScheduledChange(subRes?.scheduled_change || null);
      const pending = subRes?.pending_change
        || (subRes?.active_change?.status === 'pending_payment' ? subRes.active_change : null);
      setPendingChange(pending);
    } finally {
      setSecondaryLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // PayMongo cancel return: /shop/billing?payment=cancelled — payment state is
  // unchanged server-side; show a safe notice and clean the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('payment') === 'cancelled') {
      showToast('Payment was cancelled.');
      const next = new URLSearchParams(searchParams);
      next.delete('payment');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const state = useMemo(() => buildSellerSubscriptionState(records), [records]);
  const usageMetrics = useMemo(
    () => buildUsageMetrics({ listings, auctions, shop, plan: state.plan }),
    [listings, auctions, shop, state.plan]
  );
  const comparePlans = useMemo(() => buildComparePlans(state.plan), [state.plan]);
  const historyRows = useMemo(() => billingHistoryRows(records), [records]);
  const defaultMethod = useMemo(
    () => paymentMethods.find((m) => m.is_default) || paymentMethods[0] || null,
    [paymentMethods]
  );

  const activeListings = usageMetrics?.activeListings ?? usageMetrics?.active_listings ?? listings.length;
  const billingInterval = normalizeBillingInterval(state.record?.billing_interval || 'monthly');

  const scrollTo = (ref) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Structured backend error codes → friendly messages (never raw SQL).
  const billingErrorMessage = (e, fallback) => billingErrorText(e, fallback);

  const handleChangePlan = () => {
    setPlanNotice('');
    setModalError('');
    setManageOpen(true);
  };

  const handleManageBilling = () => {
    setModalError('');
    setManageOpen(true);
  };

  const handleRetryOrPay = async (record) => {
    if (!record?.id) return;
    setPayingId(record.id);
    try {
      const res = await apiFetch(`/billing/${record.id}/checkout`, { method: 'POST' });
      if (res?.checkout_url) {
        window.location.href = res.checkout_url;
      } else {
        showToast('Checkout created');
      }
    } catch (e) {
      showToast(e.message || 'Failed to create checkout');
    } finally {
      setPayingId(null);
    }
  };

  const loadPreview = async ({ planCode, interval }) => {
    const res = await apiFetch('/billing/subscription/change/preview', {
      method: 'POST',
      body: JSON.stringify({ plan_code: planCode, billing_interval: interval }),
    });
    return res;
  };

  const handlePlanAction = async ({ plan, kind, interval }) => {
    const planCode = plan.code || plan.id;
    setModalError('');
    setBusyPlanCode(planCode);

    try {
      // No active subscription → first-time checkout
      if (state.kind === 'none' || state.kind === 'canceled' || !state.record) {
        setPayingId(`plan-${planCode}`);
        const res = await apiFetch('/billing/subscription/checkout', {
          method: 'POST',
          body: JSON.stringify({ plan_code: planCode, billing_interval: interval }),
        });
        if (res?.checkout_url) {
          window.location.href = res.checkout_url;
        } else {
          showToast('Checkout created');
        }
        setManageOpen(false);
        return;
      }

      // Active subscription → plan-change preview → confirm modal
      const preview = await loadPreview({ planCode, interval });
      if (preview?.type === 'upgrade') {
        setUpgradePreview(preview);
        setDowngradePreview(null);
        setManageOpen(false);
      } else if (preview?.type === 'downgrade') {
        setDowngradePreview(preview);
        setUpgradePreview(null);
        setManageOpen(false);
      } else if (preview?.type === 'noop') {
        showToast('Already on this plan and interval');
        setManageOpen(false);
      } else {
        setModalError(preview?.message || 'Unable to preview plan change');
      }
    } catch (e) {
      const msg = billingErrorMessage(e, 'Failed to preview plan change');
      setModalError(msg);
      showToast(msg);
    } finally {
      setBusyPlanCode(null);
      setPayingId(null);
    }
  };

  const handleComparePlanSelect = (plan) => {
    const kind = plan.actionKind || 'select';
    if (kind === 'current' && state.nextPayment?.record) {
      return handleRetryOrPay(state.nextPayment.record);
    }
    if (state.kind === 'active' || state.kind === 'active_with_upcoming' || state.kind === 'pending' || state.kind === 'past_due') {
      // Open manage modal with current interval (or plan's implied interval)
      setPlanNotice('');
      setManageOpen(true);
      return;
    }
    // First-time select via existing checkout
    handlePlanAction({
      plan: { code: plan.code || plan.id, name: plan.name },
      kind,
      interval: billingInterval,
    });
  };

  const confirmUpgrade = async () => {
    if (!upgradePreview?.target_plan) return;
    setConfirming(true);
    setModalError('');
    try {
      const res = await apiFetch('/billing/subscription/change/confirm', {
        method: 'POST',
        body: JSON.stringify({
          plan_code: upgradePreview.target_plan.code,
          billing_interval: upgradePreview.billing_interval || billingInterval,
        }),
      });
      if (res?.checkout_url) {
        window.location.href = res.checkout_url;
        return;
      }
      if (res?.mode === 'applied_immediately') {
        showToast('Your subscription has been upgraded.');
        setUpgradePreview(null);
        await refresh();
        return;
      }
      if (res?.mode === 'pending_payment' && res?.checkout_url) {
        window.location.href = res.checkout_url;
        return;
      }
      showToast('Upgrade confirmed');
      setUpgradePreview(null);
      await refresh();
    } catch (e) {
      setModalError(billingErrorMessage(e, 'Failed to confirm upgrade'));
    } finally {
      setConfirming(false);
    }
  };

  const confirmDowngrade = async () => {
    if (!downgradePreview?.target_plan) return;
    setConfirming(true);
    setModalError('');
    try {
      const res = await apiFetch('/billing/subscription/change/confirm', {
        method: 'POST',
        body: JSON.stringify({
          plan_code: downgradePreview.target_plan.code,
          billing_interval: downgradePreview.billing_interval || billingInterval,
        }),
      });
      if (res?.mode === 'scheduled') {
        showToast('Downgrade scheduled for next billing cycle.');
        setDowngradePreview(null);
        setManageOpen(false);
        await refresh();
      } else {
        setModalError(res?.message || 'Unexpected response');
      }
    } catch (e) {
      const msg = billingErrorMessage(e, 'Failed to schedule downgrade');
      setModalError(msg);
      showToast(msg);
    } finally {
      setConfirming(false);
    }
  };

  const cancelScheduled = async () => {
    setConfirming(true);
    try {
      const res = await apiFetch('/billing/subscription/change/cancel', { method: 'POST' });
      showToast(res?.kind === 'pending' ? 'Pending upgrade canceled.' : 'Scheduled downgrade canceled');
      setScheduledChange(null);
      setPendingChange(null);
      await refresh();
    } catch (e) {
      showToast(e.message || 'Failed to cancel scheduled change');
    } finally {
      setConfirming(false);
    }
  };

  // Resume a pending upgrade: re-confirm the SAME target (server reuses the
  // existing checkout — never a duplicate charge).
  const resumePending = async () => {
    if (!pendingChange) return;
    setConfirming(true);
    setModalError('');
    try {
      const res = await apiFetch('/billing/subscription/change/confirm', {
        method: 'POST',
        body: JSON.stringify({
          plan_code: pendingChange.target_plan_code,
          billing_interval: pendingChange.target_billing_interval || billingInterval,
        }),
      });
      if (res?.checkout_url) {
        window.location.href = res.checkout_url;
        return;
      }
      showToast('Upgrade payment resumed');
      await refresh();
    } catch (e) {
      const msg = billingErrorMessage(e, 'Failed to resume payment');
      setModalError(msg);
      showToast(msg);
    } finally {
      setConfirming(false);
    }
  };

  const cancelPending = async () => {
    setConfirming(true);
    try {
      const res = await apiFetch('/billing/subscription/change/cancel', { method: 'POST' });
      if (res?.kind === 'reconciled') {
        showToast('Payment already resolved — refreshing.');
      } else {
        showToast('Pending upgrade canceled.');
      }
      setPendingChange(null);
      await refresh();
    } catch (e) {
      showToast(e.message || 'Failed to cancel pending upgrade');
    } finally {
      setConfirming(false);
    }
  };

  const resetLabel =
    state.periodLabel && state.periodLabel.includes('–')
      ? state.periodLabel.split('–').pop().trim()
      : state.renewalLabel && state.renewalLabel !== '—'
        ? state.renewalLabel
        : formatDate(state.record?.current_period_end || state.record?.due_date);

  // Real request state only: the primary subscription record has not resolved.
  if (initialLoading) {
    return (
      <div className="ssub-page" data-testid="seller-subscription-loading-page">
        <SubscriptionPageSkeleton />
      </div>
    );
  }

  return (
    <div className="ssub-page" data-testid="seller-subscription-page">
      {error && (
        <div className="ssub-error" data-testid="subscription-error">
          <span>{error}</span>
          <button
            type="button"
            className="ssub-btn ssub-btn--ghost ssub-btn--sm"
            onClick={() => refresh()}
            disabled={refreshing}
          >
            {refreshing ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      <CurrentPlanHero
        state={state}
        onChangePlan={handleChangePlan}
        onManageBilling={handleManageBilling}
        onRetryPayment={
          state.nextPayment?.mode === 'open_invoice' && state.nextPayment?.record
            ? () => handleRetryOrPay(state.nextPayment.record)
            : null
        }
      />

      <div className="ssub-midrow">
        <SubscriptionUsage metrics={usageMetrics} resetLabel={resetLabel} />
        <div ref={historyRef} style={{ display: 'contents' }}>
          {secondaryLoading ? <NextPaymentCardSkeleton /> : <NextPaymentCard
            nextPayment={state.nextPayment}
            currentPlanName={state.planName}
            billingInterval={billingInterval}
            paying={!!payingId && state.nextPayment?.record?.id === payingId}
            defaultMethod={defaultMethod}
            onPayNow={
              state.nextPayment?.mode === 'open_invoice' && state.nextPayment?.record
                ? () => handleRetryOrPay(state.nextPayment.record)
                : null
            }
            onUpdatePaymentMethod={() => setPayMethodOpen(true)}
          />}
        </div>
      </div>

      <div ref={compareRef}>
        <ComparePlans
          plans={comparePlans}
          onSelectPlan={handleComparePlanSelect}
          notice={planNotice}
        />
      </div>

      <BillingHistory
        rows={historyRows}
        onPay={handleRetryOrPay}
        payingId={payingId}
        loading={refreshing}
        error={null}
      />

      <ManageBillingModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        currentState={{
          plan: state.plan,
          billingInterval,
          record: state.record,
        }}
        onPlanAction={handlePlanAction}
        busyPlanCode={busyPlanCode}
        scheduledChange={scheduledChange}
        pendingChange={pendingChange}
        activeListings={activeListings}
        error={modalError}
      />

      <UpgradeConfirmModal
        open={!!upgradePreview}
        onClose={() => setUpgradePreview(null)}
        preview={upgradePreview}
        onConfirm={confirmUpgrade}
        confirming={confirming}
        error={modalError}
      />

      <DowngradeConfirmModal
        open={!!downgradePreview}
        onClose={() => setDowngradePreview(null)}
        preview={downgradePreview}
        onConfirm={confirmDowngrade}
        confirming={confirming}
        error={modalError}
        lostFeatures={
          downgradePreview?.current_plan?.features?.filter(
            (f) => !(downgradePreview?.target_plan?.features || []).includes(f)
          ) || []
        }
      />

      <PaymentMethodModal
        open={payMethodOpen}
        onClose={() => setPayMethodOpen(false)}
        showToast={showToast}
        payableRecord={
          state.nextPayment?.mode === 'open_invoice' && state.nextPayment?.record
            ? state.nextPayment.record
            : null
        }
        subscriptionSummary={subscriptionSummary}
        onChanged={() => refresh({ silent: true })}
      />

      {pendingChange && (
        <div className="ssub-hero__notice" data-testid="pending-upgrade-banner" style={{ marginTop: 16 }}>
          <strong>{(getPlanForPlanCode(pendingChange.target_plan_code)?.name) || pendingChange.target_plan_code} upgrade pending</strong>
          {Number(pendingChange.proration_amount) > 0 && (
            <span> — Amount: <strong>₱{Number(pendingChange.proration_amount).toLocaleString()}</strong></span>
          )}
          <span> — Started: <strong>{pendingChange.created_at ? new Date(pendingChange.created_at).toLocaleDateString() : 'recently'}</strong></span>
          <span style={{ marginLeft: 12 }}>
            <button
              type="button"
              className="ssub-btn ssub-btn--gold ssub-btn--sm"
              data-testid="resume-pending-upgrade"
              disabled={confirming}
              onClick={resumePending}
            >
              Resume payment
            </button>
            <button
              type="button"
              className="ssub-btn ssub-btn--outline ssub-btn--sm"
              style={{ marginLeft: 8 }}
              data-testid="cancel-pending-upgrade"
              disabled={confirming}
              onClick={cancelPending}
            >
              Cancel upgrade
            </button>
          </span>
        </div>
      )}

      {scheduledChange && (
        <div className="ssub-hero__notice" data-testid="scheduled-downgrade-banner" style={{ marginTop: 16 }}>
          Scheduled change to <strong>{(getPlanForPlanCode(scheduledChange.target_plan_code)?.name) || scheduledChange.target_plan_code}</strong> on{' '}
          <strong>{scheduledChange.effective_at}</strong>
          <button
            type="button"
            className="ssub-btn ssub-btn--outline ssub-btn--sm"
            style={{ marginLeft: 12 }}
            data-testid="cancel-scheduled-downgrade"
            disabled={confirming}
            onClick={cancelScheduled}
          >
            Cancel scheduled downgrade
          </button>
        </div>
      )}
    </div>
  );
}
