// frontend/src/roles/admin/subscriptions/PlanTiersSection.jsx
import { planToneClass } from '../lib/subscriptionStatus';

function PlanTierCard({ tier, onView, isSelected }) {
  return (
    <article
      className={`sub-plan${isSelected ? ' sub-plan--selected' : ''}`}
      data-testid={`plan-tier-${tier.id}`}
      data-selected={isSelected ? 'true' : 'false'}
      data-popular={tier.popular ? 'true' : 'false'}
    >
      {tier.popular && (
        <div className="sub-plan__badge">
          <span aria-hidden="true">★</span> Most popular
        </div>
      )}
      <div className="sub-plan__head">
        <div className={`sub-plan__icon ${planToneClass(tier.tone)}`} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 18h16M6 18V9l6-4 6 4v9M9 18v-4h6v4" />
          </svg>
        </div>
        <div>
          <h3 className="sub-plan__name">{tier.name}</h3>
          <p className="sub-plan__meta">
            {tier.branchCount} branch{tier.branchCount === 1 ? '' : 'es'} · {tier.subscribers} subscriber{tier.subscribers === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      <div className="sub-plan__price">
        <span className="sub-plan__amount">{tier.amountLabel}</span>
        <span className="sub-plan__period">/ month</span>
      </div>
      <p className="sub-plan__desc">
        Seller subscriptions billed at {tier.amountLabel} monthly for this tier.
      </p>
      <ul className="sub-plan__features">
        {tier.features.map((f) => (
          <li key={f}>
            <span className="sub-plan__check" aria-hidden="true">✓</span>
            {f}
          </li>
        ))}
      </ul>
      <div className="sub-plan__share">
        <div className="sub-plan__share-row">
          <span>Subscribers</span>
          <strong>{tier.subscribers} · {tier.share}%</strong>
        </div>
        <div className="sub-plan__bar" aria-hidden="true">
          <span style={{ width: `${tier.share}%` }} className={tier.popular ? 'is-popular' : ''} />
        </div>
      </div>
      <button
        type="button"
        className={`sub-btn ${isSelected ? 'sub-btn--gold' : 'sub-btn--outline'}`}
        onClick={() => onView?.(tier)}
        aria-pressed={isSelected}
        aria-label={isSelected ? `Selected: ${tier.name}. Click to clear filter` : `View ${tier.name} subscribers`}
      >
        {isSelected ? 'Viewing subscribers' : 'View subscribers'}
      </button>
    </article>
  );
}

export function PlanTiersSection({ tiers, totalSubscriptions, totalArrLabel, onViewTier, loading, selectedPlanName }) {
  return (
    <section className="sub-plans" aria-labelledby="plan-tiers-heading">
      <div className="sub-section-head">
        <h2 id="plan-tiers-heading">Plan tiers</h2>
        {totalSubscriptions != null && (
          <p className="sub-section-aside">
            {totalSubscriptions} total subscription{totalSubscriptions === 1 ? '' : 's'}
            {totalArrLabel ? <> · ARR {totalArrLabel}</> : null}
          </p>
        )}
      </div>
      {loading || !tiers?.length ? (
        <div className="sub-plans__grid" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="sub-plan sub-plan--skeleton">
              <div className="sub-skel" style={{ width: 44, height: 44, borderRadius: 12 }} />
              <div className="sub-skel" style={{ width: '60%', height: 16, marginTop: 14 }} />
              <div className="sub-skel" style={{ width: '40%', height: 28, marginTop: 16 }} />
              <div className="sub-skel" style={{ width: '100%', height: 48, marginTop: 16 }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="sub-plans__grid">
          {tiers.map((tier) => (
            <PlanTierCard
              key={tier.id}
              tier={tier}
              onView={onViewTier}
              isSelected={selectedPlanName === tier.name}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default PlanTiersSection;
