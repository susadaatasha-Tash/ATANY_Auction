// frontend/src/roles/shop-owner/pages/Billing.jsx
// Seller Subscription — premium portal (current plan, usage, next payment, compare, history)
// Change plan / Manage billing open the Manage Billing modal (not page redesign).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import SupportRequestForm from '../../../shared/components/SupportRequestForm';
import { SUPPORT_EMAIL } from '../../../shared/config/support';
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
import {
  subscriptionMethodLabel,
} from '../subscription/subscriptionPaymentMethods';
import '../subscription/seller-subscription.css';

export default function Billing() {
  const [records, setRecords] = useState([]);
  const [listings, setListings] = useState([]);
  const [auctions, setAuctions] = useState([]);
  const [shop, setShop] = useState(null);
  const [loading, setLoading] = useState(true);
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
  const [supportOpen, setSupportOpen] = useState(false);
  const [busyPlanCode, setBusyPlanCode] = useState(null);
  const [scheduledChange, setScheduledChange] = useState(null);
  // The saved "next payment method" preference (QR Ph / Card / GCash / Maya).
  const [paymentPreference, setPaymentPreference] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [billingRows, listingRows, auctionRows, shopRow, subRes, methodsRes] = await Promise.all([
        apiFetch('/billing/me'),
        apiFetch('/shop-owner/listings').catch(() => []),
        apiFetch('/shop-owner/auctions').catch(() => []),
        apiFetch('/shop-owner/shop').catch(() => null),
        apiFetch('/billing/me/subscription').catch(() => null),
        apiFetch('/billing/subscription/payment-methods').catch(() => null),
      ]);
      setRecords(Array.isArray(billingRows) ? billingRows : []);
      setListings(Array.isArray(listingRows) ? listingRows : []);
      setAuctions(Array.isArray(auctionRows) ? auctionRows : []);
      setShop(shopRow || null);
      setScheduledChange(subRes?.scheduled_change || subRes?.active_change || null);
      setPaymentPreference(methodsRes?.preference || null);
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load subscription data');
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const state = useMemo(() => buildSellerSubscriptionState(records), [records]);
  const usageMetrics = useMemo(
    () => buildUsageMetrics({ listings, auctions, shop, plan: state.plan }),
    [listings, auctions, shop, state.plan]
  );
  const comparePlans = useMemo(() => buildComparePlans(state.plan), [state.plan]);

  // SAFE billing context for a support request. Only the plan name, the
  // ATANY billing record reference and the payment status are included —
  // never a PayMongo secret, a raw payment payload or card data.
  const billingSupportMetadata = useMemo(() => {
    const meta = {};
    const planName = state.planName || state.plan?.name || null;
    const billingReference = state.nextPayment?.record?.id || state.record?.id || null;
    const paymentStatus = state.nextPayment?.record?.status || state.record?.status || null;
    if (planName) meta.plan_name = planName;
    if (billingReference) meta.billing_reference = billingReference;
    if (paymentStatus) meta.payment_status = paymentStatus;
    meta.provider = 'PayMongo';
    meta.role = 'shop_owner';
    return meta;
  }, [state]);
  const historyRows = useMemo(() => billingHistoryRows(records), [records]);

  const activeListings = usageMetrics?.activeListings ?? usageMetrics?.active_listings ?? listings.length;
  const billingInterval = normalizeBillingInterval(state.record?.billing_interval || 'monthly');

  // The saved payment-method preference, shown on the Next payment card.
  // The authoritative source is the seller's own billing record; the
  // payment-method endpoint is the fallback.
  const paymentPreferenceLabel = useMemo(() => {
    const method =
      state.nextPayment?.payment_method_type || paymentPreference?.method || null;
    return method ? subscriptionMethodLabel(method) : null;
  }, [state.nextPayment, paymentPreference]);

  const scrollTo = (ref) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
      const msg = e.message || 'Failed to preview plan change';
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
      setModalError(e.message || 'Failed to confirm upgrade');
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
      const msg = e.message || 'Failed to schedule downgrade';
      setModalError(msg);
      showToast(msg);
    } finally {
      setConfirming(false);
    }
  };

  const cancelScheduled = async () => {
    setConfirming(true);
    try {
      await apiFetch('/billing/subscription/change/cancel', { method: 'POST' });
      showToast('Scheduled downgrade canceled');
      setScheduledChange(null);
      await refresh();
    } catch (e) {
      showToast(e.message || 'Failed to cancel scheduled change');
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

  if (loading) {
    return (
      <div className="ssub-page">
        <div className="ssub-loading" data-testid="subscription-loading">Loading subscription…</div>
      </div>
    );
  }

  return (
    <div className="ssub-page" data-testid="seller-subscription-page">
      {error && (
        <div className="ssub-error" data-testid="subscription-error">
          {error}
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-outline" onClick={() => setSupportOpen(true)}>
              Contact ATANY Support
            </button>
          </div>
        </div>
      )}

      {supportOpen && (
        <div className="profile-modal-overlay" role="presentation" onClick={() => setSupportOpen(false)}>
          <div
            className="profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="billing-support-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="profile-modal__head">
              <h3 id="billing-support-title">Subscription Billing Support</h3>
              <button type="button" className="modal-close" onClick={() => setSupportOpen(false)} aria-label="Close support form">
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="profile-modal__body">
              <p className="form-hint">
                Include anything that helps us identify the payment — but never send card numbers or PINs.
              </p>
              <SupportRequestForm
                endpoint="/support/account"
                initialCategory="Billing / Subscription"
                initialSubject="Subscription Billing Support"
                initialMessage={'Hello ATANY Support,\n\nI need help with my ATANY subscription billing.\n\n'}
                submitLabel="Send Support Request"
                metadata={billingSupportMetadata}
              />
            </div>
          </div>
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
          <NextPaymentCard
            nextPayment={state.nextPayment}
            currentPlanName={state.planName}
            billingInterval={billingInterval}
            paying={!!payingId && state.nextPayment?.record?.id === payingId}
            onPayNow={
              state.nextPayment?.mode === 'open_invoice' && state.nextPayment?.record
                ? () => handleRetryOrPay(state.nextPayment.record)
                : null
            }
            onUpdatePaymentMethod={() => setPayMethodOpen(true)}
            paymentMethodLabel={paymentPreferenceLabel}
          />
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
        loading={loading}
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
        subscription={{
          planName: state.planName,
          planDescription: state.plan?.description || null,
          amount: state.nextPayment?.amount ?? state.amount ?? 0,
          billingDate: state.nextPayment?.date || null,
          reference: state.nextPayment?.reference || null,
          billingCycle:
            (state.nextPayment?.billing_interval || billingInterval) === 'annual' ? 'Annual' : 'Monthly',
          statusLabel: state.nextPayment?.statusLabel || state.statusLabel || null,
        }}
        onSaved={refresh}
      />

      {scheduledChange && (
        <div className="ssub-hero__notice" data-testid="scheduled-downgrade-banner" style={{ marginTop: 16 }}>
          Scheduled change to <strong>{scheduledChange.target_plan_code}</strong> on{' '}
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
