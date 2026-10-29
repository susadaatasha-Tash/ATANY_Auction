// frontend/src/roles/shop-owner/subscription/SubscriptionPageSkeleton.jsx
// Seller Subscription — initial-load skeleton.
//
// Built ONLY from the shared ATANY skeleton primitives (shared/ui/Skeleton.jsx),
// so the shimmer, tones and prefers-reduced-motion behaviour are identical to
// every other portal. No second skeleton library, no local shimmer CSS, no
// timers and no artificial delay — it renders purely from real request state.
//
// Geometry mirrors the REAL finished page 1:1 (class names reused from
// seller-subscription.css) so there is minimal layout shift when data arrives:
//   1. Current plan hero   .ssub-hero            (eyebrow, name, price, meta, actions)
//   2. Mid row             .ssub-midrow          (Usage card + Next payment card)
//   3. Compare plans       .ssub-compare         (3 plan cards)
//   4. Billing history     .ssub-card.ssub-history (table rows)
// The seller shell (sidebar + header + "Subscription" title) is owned by
// ShopOwnerLayout and is NOT skeletonized.
import { Skeleton, SkeletonRegion } from '../../../shared/ui/Skeleton';
import './seller-subscription.css';

function CardHead() {
  return (
    <div className="ssub-card__head">
      <div>
        <Skeleton w={132} h={15} />
        <Skeleton w={96} h={11} style={{ marginTop: 7 }} />
      </div>
    </div>
  );
}

export function SubscriptionPageSkeleton() {
  return (
    <div className="ssub-skel" data-testid="subscription-skeleton">
      <SkeletonRegion label="Loading subscription">
      {/* ---- 1. Current plan hero ---- */}
      <section className="ssub-hero ssub-hero--none" aria-hidden="true">
        <div className="ssub-hero__eyebrow"><Skeleton w={116} h={11} /></div>
        <div className="ssub-hero__name-row">
          <Skeleton w={210} h={34} />
          <Skeleton w={78} h={22} r="999px" />
        </div>
        <div className="ssub-hero__amount"><Skeleton w={168} h={26} /></div>
        <div className="ssub-hero__meta">
          <Skeleton w={168} h={12} />
          <Skeleton w={140} h={12} />
        </div>
        <div className="ssub-hero__actions">
          <Skeleton w={150} h={38} r={11} />
          <Skeleton w={132} h={38} r={11} />
        </div>
        <ul className="ssub-feature-list">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="ssub-feature-list__check">
              <Skeleton w="72%" h={12} />
            </li>
          ))}
        </ul>
      </section>

      {/* ---- 2. Mid row: usage + next payment ---- */}
      <div className="ssub-midrow">
        <section className="ssub-card" aria-hidden="true">
          <CardHead />
          <div className="ssub-usage-list">
            {[0, 1, 2].map((i) => (
              <div className="ssub-usage-row" key={i}>
                <div className="ssub-usage-row__top">
                  <Skeleton w="46%" h={12} />
                  <Skeleton w={38} h={12} />
                </div>
                <Skeleton w="100%" h={10} r={6} />
                <div className="ssub-usage-row__foot">
                  <Skeleton w={92} h={11} />
                  <Skeleton w={64} h={11} />
                  <Skeleton w={78} h={11} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="ssub-card" aria-hidden="true">
          <CardHead />
          <div className="ssub-nextpay__amount-box">
            <Skeleton w={148} h={26} />
          </div>
          <div className="ssub-nextpay__row">
            <Skeleton w={104} h={12} />
            <Skeleton w={132} h={12} />
          </div>
          <div className="ssub-nextpay__row">
            <Skeleton w={92} h={12} />
            <Skeleton w={108} h={12} />
          </div>
          <div className="ssub-nextpay__row">
            <Skeleton w={96} h={12} />
            <Skeleton w={118} h={12} />
          </div>
          <div className="ssub-nextpay__row">
            <Skeleton w={110} h={12} />
            <Skeleton w={96} h={12} />
          </div>
          <div className="ssub-hero__actions">
            <Skeleton w={136} h={38} r={11} />
            <Skeleton w={124} h={38} r={11} />
          </div>
        </section>
      </div>

      {/* ---- 3. Compare plans (3 cards on desktop) ---- */}
      <section className="ssub-compare" aria-hidden="true">
        <div className="ssub-compare__head">
          <Skeleton w={168} h={18} />
          <Skeleton w="52%" h={12} />
        </div>
        <div className="ssub-compare__grid">
          {[0, 1, 2].map((i) => (
            <article className="ssub-plan" key={i}>
              <Skeleton w={82} h={20} r="999px" />
              <Skeleton w="66%" h={17} style={{ marginTop: 12 }} />
              <Skeleton w="88%" h={12} style={{ marginTop: 8 }} />
              <div className="ssub-plan__amount"><Skeleton w={116} h={24} style={{ marginTop: 14 }} /></div>
              <div className="ssub-plan__features">
                {[0, 1, 2, 3, 4, 5].map((k) => (
                  <div className="ssub-plan__check" key={k}>
                    <Skeleton w="84%" h={11} />
                  </div>
                ))}
              </div>
              <Skeleton w="100%" h={40} r={11} style={{ marginTop: 16 }} />
            </article>
          ))}
        </div>
      </section>

      {/* ---- 4. Billing history table ---- */}
      <section className="ssub-card ssub-history" aria-hidden="true">
        <CardHead />
        <table className="ssub-table">
          <thead>
            <tr>
              {['Date', 'Plan', 'Amount', '', ''].map((h, i) => (
                <th key={i}><Skeleton w={i === 0 ? 72 : i === 1 ? 62 : i === 2 ? 66 : 46} h={11} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3, 4].map((r) => (
              <tr key={r}>
                <td><Skeleton w={72} h={16} /></td>
                <td><Skeleton w={62} h={16} /></td>
                <td><Skeleton w={66} h={16} /></td>
                <td><Skeleton w={44} h={16} /></td>
                <td><Skeleton w={78} h={30} r={8} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      </SkeletonRegion>
    </div>
  );
}

/**
 * Section-level skeleton for the Next payment card, whose default payment
 * method comes from a separate request. Used while SECONDARY data loads so one
 * slow endpoint never blanks the whole page.
 */
export function NextPaymentCardSkeleton() {
  return (
    <div data-testid="next-payment-skeleton">
      <SkeletonRegion label="Loading next payment">
      <section className="ssub-card" aria-hidden="true">
        <CardHead />
        <div className="ssub-nextpay__amount-box">
          <Skeleton w={148} h={26} />
        </div>
        <div className="ssub-nextpay__row">
          <Skeleton w={104} h={12} />
          <Skeleton w={132} h={12} />
        </div>
        <div className="ssub-nextpay__row">
          <Skeleton w={96} h={12} />
          <Skeleton w={118} h={12} />
        </div>
        <div className="ssub-hero__actions">
          <Skeleton w={136} h={38} r={11} />
          <Skeleton w={124} h={38} r={11} />
        </div>
      </section>
      </SkeletonRegion>
    </div>
  );
}

export default SubscriptionPageSkeleton;