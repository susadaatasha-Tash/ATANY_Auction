// frontend/src/roles/shop-owner/subscription/ComparePlans.jsx
const toneGlyph = {
  bronze: 'B',
  gold: 'G',
  platinum: 'P',
};

function SellerPlanCard({ plan, onSelect, disabledSelect }) {
  return (
    <article
      className={`ssub-plan${plan.isCurrent ? ' ssub-plan--current' : ''}`}
      data-testid={`seller-plan-${plan.id}`}
      data-current={plan.isCurrent ? 'true' : 'false'}
    >
      {plan.isCurrent && <div className="ssub-plan__badge">Current plan</div>}
      <div className={`ssub-plan__icon ssub-plan-tone--${plan.tone}`} aria-hidden="true">
        {toneGlyph[plan.tone] || 'S'}
      </div>
      <h3 className="ssub-plan__name">{plan.name}</h3>
      <p className="ssub-plan__desc">{plan.description}</p>
      <div className="ssub-plan__price">
        <span className="ssub-plan__amount">{plan.priceLabel}</span>
        <span className="ssub-plan__period">/ month</span>
      </div>
      <ul className="ssub-plan__features">
        {[...(plan.features || []), plan.allowance].filter(Boolean).map((f) => (
          <li key={f}>
            <span className="ssub-plan__check" aria-hidden="true">✓</span>
            {f}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={`ssub-btn ${plan.isCurrent ? 'ssub-btn--outline' : 'ssub-btn--gold'}`}
        data-testid={`seller-plan-action-${plan.id}`}
        data-action={plan.actionKind}
        disabled={plan.isCurrent || disabledSelect}
        aria-pressed={plan.isCurrent}
        onClick={() => !plan.isCurrent && onSelect?.(plan)}
      >
        {plan.actionLabel}
      </button>
    </article>
  );
}

export function ComparePlans({ plans, onSelectPlan, notice }) {
  if (!plans?.length) return null;

  return (
    <div className="ssub-compare" data-testid="compare-plans">
      <div className="ssub-compare__head">
        <div>
          <h2 className="ssub-compare__title">Compare plans</h2>
          <p className="ssub-compare__subtitle">Monthly plans from the ATANY subscription catalog</p>
        </div>
      </div>
      {notice && (
        <div className="ssub-error" data-testid="plan-change-notice" style={{ marginBottom: 12 }}>
          {notice}
        </div>
      )}
      <div className="ssub-compare__grid">
        {plans.map((plan) => (
          <SellerPlanCard
            key={plan.id}
            plan={plan}
            onSelect={onSelectPlan}
          />
        ))}
      </div>
    </div>
  );
}

export default ComparePlans;
