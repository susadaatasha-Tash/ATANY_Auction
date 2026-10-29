// frontend/src/roles/shop-owner/pages/Dashboard.jsx
// Seller dashboard — premium layout matching target reference, real data only
import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { ArrowRight, CalendarDays, Clock, Gavel, Gem, LineChart, Package, Receipt } from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { StatusBadge, payoutPresentation, fulfillmentPresentation, auctionPresentation } from '../components/StatusBadge';
import { DashboardEmptyState } from '../components/DashboardEmptyState';
import { Skeleton, SkeletonCircle, SkeletonList, SkeletonRegion } from '../../../shared/ui/Skeleton';
import { SellerWelcomeBanner } from '../components/SellerWelcomeBanner';
import '../seller-dashboard.css';

const ACTIVITY_META = {
  auction_created: { title: 'Auction Created', desc: (d) => `${d?.name || 'An auction'} was created`, icon: Gavel },
  auction_updated: { title: 'Auction Updated', desc: (d) => `${d?.name || 'An auction'} was updated`, icon: Gavel },
  auction_cancelled: { title: 'Auction Cancelled', desc: () => 'A scheduled auction was cancelled', icon: Gavel },
  auction_deleted: { title: 'Auction Removed', desc: (d) => `${d?.name || 'An auction'} was removed`, icon: Gavel },
  listing_created: { title: 'Listing Published', desc: (d) => `${d?.name || 'A jewelry item'} is live`, icon: Gem },
  listing_updated: { title: 'Listing Updated', desc: (d) => `${d?.name || 'A jewelry item'} details were updated`, icon: Gem },
  listing_resubmitted: { title: 'Listing Resubmitted', desc: (d) => `${d?.name || 'A jewelry item'} was resubmitted for review`, icon: Gem },
  order_preparing: { title: 'Order Preparing', desc: (d) => `${d?.name || 'An order'} is being prepared`, icon: Receipt },
  order_ready_pickup: { title: 'Ready for Pickup', desc: (d) => `${d?.name || 'An order'} is ready for pickup`, icon: Receipt },
  order_completed: { title: 'Order Completed', desc: (d) => `${d?.name || 'An order'} was picked up`, icon: Receipt },
  subscription_paid: { title: 'Subscription Paid', desc: (d) => `${d?.billing_period || 'Subscription'} payment confirmed`, icon: Package },
  subscription_past_due: { title: 'Subscription Past Due', desc: () => 'Subscription payment is overdue', icon: Package },
  upgrade_proration_paid: { title: 'Upgrade Confirmed', desc: () => 'Plan upgrade payment was confirmed', icon: Package },
  payment_method_attached: { title: 'Payment Method Added', desc: () => 'A payment method was attached to your account', icon: Package },
};

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }

function formatSaleDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(d) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-PH', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function buyerInitials(name) {
  const src = (name || '').trim();
  if (!src) return 'CU';
  if (src.includes('@')) {
    return src.split('@')[0].split(/[._-]/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
  }
  return src.split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
}

function startOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function startOfMonth() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1);
}

function daysAgo(n) {
  const d = startOfToday();
  d.setDate(d.getDate() - n);
  return d;
}

const FILTERS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
];

function matchesFilter(sale, key) {
  const when = new Date(sale.date);
  if (Number.isNaN(when.getTime())) return false;
  if (key === 'today') return when >= startOfToday();
  if (key === '7d') return when >= daysAgo(7);
  if (key === 'month') return when >= startOfMonth();
  return true;
}

function isSoldSale(sale) {
  return sale?.payment_status === 'paid' || sale?.status === 'completed';
}

function Thumb({ src, alt }) {
  if (src) return <img className="sdash-thumb" src={src} alt={alt || ''} loading="lazy" />;
  return (
    <div className="sdash-thumb sdash-thumb--placeholder" aria-hidden="true">
      <Gem />
    </div>
  );
}

/**
 * Mirrors `.sdash-summary-card` (icon + label / value / meta) while the sales
 * request is in flight, so the seller never sees a fabricated "₱0 / 0 lots"
 * that would be indistinguishable from a real zero.
 */
function SummaryCardSkeleton({ label, gold }) {
  return (
    <div className={`sdash-summary-card${gold ? ' sdash-summary-card--gold' : ''}`} aria-hidden="true">
      <div className="sdash-summary-card__icon"><Skeleton w={16} h={16} r={6} /></div>
      <div className="sdash-summary-card__body">
        <div className="sdash-summary-card__label">{label}</div>
        <div className="sdash-summary-card__value"><Skeleton w={72} h={18} /></div>
        <div className="sdash-summary-card__meta"><Skeleton w={46} h={11} /></div>
      </div>
    </div>
  );
}

/**
 * Table skeleton built on the shared ATANY primitive. Rendered inside the real
 * `.sdash-table-wrap` so its width matches the loaded table (no skeleton→table
 * shift) and the first column keeps the thumb rhythm.
 */
function TableSkeleton({ rows = 4, cols = 6 }) {
  return (
    <div className="sdash-table-wrap" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="sdash-skeleton-row" key={i}>
          <SkeletonCircle size={32} />
          {Array.from({ length: cols - 1 }).map((__, j) => (
            <Skeleton key={j} w="100%" h={14} style={{ flex: j === 0 ? 2 : 1 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function ShopDashboard() {
  const outlet = useOutletContext() || {};
  const listings = outlet.listings || [];
  const auctions = outlet.auctions || [];
  const sales = outlet.sales || [];
  const loading = !!outlet.loading;

  const [activities, setActivities] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setActivityLoading(true);
        setActivityError(null);
        const rows = await apiFetch('/shop-owner/activity');
        if (!cancelled) setActivities(Array.isArray(rows) ? rows : []);
      } catch (e) {
        if (!cancelled) {
          setActivityError(e.message || 'Unable to load recent activity.');
          setActivities([]);
        }
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Sales aggregates (real backend statuses only) ──────────
  const summary = useMemo(() => {
    const sold = sales.filter(isSoldSale);
    const soldToday = sold.filter((s) => matchesFilter(s, 'today'));
    const soldMonth = sold.filter((s) => matchesFilter(s, 'month'));
    // Awaiting release: customer paid, order not yet completed → payout not released
    const awaiting = sales.filter((s) =>
      s.payment_status === 'paid' && ['pending', 'preparing', 'ready_pickup'].includes(s.status)
    );
    return {
      soldTodayTotal: soldToday.reduce((sum, s) => sum + (s.amount || 0), 0),
      soldTodayCount: soldToday.length,
      soldMonthTotal: soldMonth.reduce((sum, s) => sum + (s.amount || 0), 0),
      soldMonthCount: soldMonth.length,
      awaitingTotal: awaiting.reduce((sum, s) => sum + (s.payout || 0), 0),
      awaitingCount: awaiting.length,
    };
  }, [sales]);

  const filteredSales = useMemo(() => {
    return sales.filter((s) => matchesFilter(s, filter)).slice(0, 5);
  }, [sales, filter]);

  const filterTotal = useMemo(() => {
    const rows = sales.filter((s) => matchesFilter(s, filter) && isSoldSale(s));
    return {
      total: rows.reduce((sum, s) => sum + (s.amount || 0), 0),
      count: rows.length,
    };
  }, [sales, filter]);

  // ── Auctions ending soon ───────────────────────────────────
  const endingSoon = useMemo(() => {
    const rank = { live: 0, scheduled: 1, draft: 2, ended: 3 };
    return (auctions || [])
      .slice()
      .sort((a, b) => {
        const ra = rank[a.status] ?? 9;
        const rb = rank[b.status] ?? 9;
        if (ra !== rb) return ra - rb;
        return (a.endsInSec ?? 0) - (b.endsInSec ?? 0);
      })
      .slice(0, 5);
  }, [auctions]);

  return (
    <div className="sdash">
      <SellerWelcomeBanner
        shop={outlet.shop}
        listings={listings}
        auctions={auctions}
        sales={sales}
        loading={loading}
      />
      <div className="sdash-main-grid">
        <div className="sdash-main-col">
          {/* ── Recent Sales (primary, compact) ────────────── */}
          <section className="sdash-panel" aria-labelledby="sdash-sales-title">
            <div className="sdash-panel__head">
              <div className="sdash-panel__head-text">
                <h2 className="sdash-panel__title" id="sdash-sales-title">Recent Sales</h2>
                <p className="sdash-panel__subtitle">Your latest sold lots, buyers and payouts</p>
              </div>
              <Link to="/shop/orders" className="sdash-link-btn">
                View all orders
                <ArrowRight />
              </Link>
            </div>

            <div className="sdash-filters" role="tablist" aria-label="Sales range">
              <div className="sdash-filters__chips">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.key}
                    className={`sdash-filter-chip${filter === f.key ? ' is-active' : ''}`}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="sdash-filter-total" title="Sold total for selected range" aria-busy={loading ? 'true' : undefined}>
                <span className="sdash-filter-total__icon" aria-hidden="true"><LineChart /></span>
                <span>{loading ? <Skeleton w={54} h={12} /> : peso(filterTotal.total)}</span>
                <span className="sdash-filter-total__sep">·</span>
                <span className="sdash-filter-total__meta">
                  {loading ? <Skeleton w={38} h={12} style={{ display: 'inline-block' }} /> : `${filterTotal.count} ${filterTotal.count === 1 ? 'lot' : 'lots'}`}
                </span>
              </div>
            </div>

            {/* Initial load: shape only. Once sales arrive the real figures
                render (a genuine ₱0 stays ₱0). */}
            <div className="sdash-summary" aria-busy={loading ? 'true' : undefined}>
              {loading ? (
                <>
                  <SummaryCardSkeleton gold label="Sold This Month" />
                  <SummaryCardSkeleton label="Sold Today" />
                  <SummaryCardSkeleton label="Awaiting Release" />
                </>
              ) : (
                <>
                  <div className="sdash-summary-card sdash-summary-card--gold">
                    <div className="sdash-summary-card__icon" aria-hidden="true"><LineChart /></div>
                    <div className="sdash-summary-card__body">
                      <div className="sdash-summary-card__label">Sold This Month</div>
                      <div className="sdash-summary-card__value">{peso(summary.soldMonthTotal)}</div>
                      <div className="sdash-summary-card__meta">{summary.soldMonthCount} {summary.soldMonthCount === 1 ? 'lot' : 'lots'}</div>
                    </div>
                  </div>
                  <div className="sdash-summary-card">
                    <div className="sdash-summary-card__icon" aria-hidden="true"><CalendarDays /></div>
                    <div className="sdash-summary-card__body">
                      <div className="sdash-summary-card__label">Sold Today</div>
                      <div className="sdash-summary-card__value">{peso(summary.soldTodayTotal)}</div>
                      <div className="sdash-summary-card__meta">{summary.soldTodayCount} {summary.soldTodayCount === 1 ? 'lot' : 'lots'}</div>
                    </div>
                  </div>
                  <div className="sdash-summary-card">
                    <div className="sdash-summary-card__icon" aria-hidden="true"><Clock /></div>
                    <div className="sdash-summary-card__body">
                      <div className="sdash-summary-card__label">Awaiting Release</div>
                      <div className="sdash-summary-card__value">{peso(summary.awaitingTotal)}</div>
                      <div className="sdash-summary-card__meta">{summary.awaitingCount} {summary.awaitingCount === 1 ? 'settlement' : 'settlements'}</div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="sdash-panel__body">
              {loading ? (
                <TableSkeleton rows={5} cols={6} />
              ) : filteredSales.length ? (
                <div className="sdash-table-wrap">
                  <table className="sdash-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Buyer</th>
                        <th>Sold Price</th>
                        <th>Date</th>
                        <th>Payout</th>
                        <th>Pickup</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSales.map((s) => {
                        const payout = payoutPresentation(s);
                        const fulfillment = fulfillmentPresentation(s);
                        return (
                          <tr key={s.id}>
                            <td>
                              <div className="sdash-item-cell">
                                <Thumb src={s.item_image} alt="" />
                                <div className="sdash-item-text">
                                  <div className="sdash-item-name" title={s.item}>{s.item}</div>
                                  <div className="sdash-item-ref">{s.transaction_code || s.id}</div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div className="sdash-buyer-cell">
                                <span className="sdash-avatar" aria-hidden="true">{buyerInitials(s.buyer)}</span>
                                <span>{s.buyer}</span>
                              </div>
                            </td>
                            <td>
                              <span className="sdash-amount">{peso(s.amount)}</span>
                              {s.payment_status && (
                                <span className="sdash-amount-sub">{s.payment_status}</span>
                              )}
                            </td>
                            <td><span className="sdash-date">{formatSaleDate(s.date)}</span></td>
                            <td><StatusBadge status={payout.status} label={payout.label} tone={payout.tone} /></td>
                            <td><StatusBadge status={fulfillment.status} label={fulfillment.label} tone={fulfillment.tone} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <DashboardEmptyState
                  icon={<Receipt />}
                  title="No recent sales yet"
                  text="Completed sales will appear here."
                  actionLabel="View sales & payouts"
                  actionTo="/shop/sales"
                />
              )}
            </div>
          </section>

          {/* ── Auctions Ending Soon (immediately below) ───── */}
          <section className="sdash-panel" aria-labelledby="sdash-auctions-title">
            <div className="sdash-panel__head">
              <div className="sdash-panel__head-text">
                <h2 className="sdash-panel__title" id="sdash-auctions-title">Your Auctions Ending Soon</h2>
                <p className="sdash-panel__subtitle">Live lots closing in the next few hours</p>
              </div>
              <Link to="/shop/auctions" className="sdash-link-btn">
                View all
                <ArrowRight />
              </Link>
            </div>
            <div className="sdash-panel__body">
              {loading ? (
                <TableSkeleton rows={4} cols={5} />
              ) : endingSoon.length ? (
                <div className="sdash-table-wrap">
                  <table className="sdash-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Current Bid</th>
                        <th>Bids</th>
                        <th>Ends</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {endingSoon.map((a) => {
                        const st = auctionPresentation(a.status);
                        const remaining = a.endTime
                          ? Math.max(0, Math.floor((new Date(a.endTime).getTime() - Date.now()) / 1000))
                          : Number(a.endsInSec) || 0;
                        const hasBids = Number(a.bids) > 0;
                        const currentBid = hasBids ? a.currentBid : (a.startPrice != null ? a.startPrice : a.currentBid);
                        return (
                          <tr key={a.id}>
                            <td>
                              <div className="sdash-item-cell">
                                <Thumb src={a.img || a.image_url} alt="" />
                                <div className="sdash-item-text">
                                  <div className="sdash-item-name" title={a.name || a.item}>{a.name || a.item}</div>
                                  <div className="sdash-item-ref">{a.auction_code || a.id}</div>
                                </div>
                              </div>
                            </td>
                            <td>
                              {hasBids ? (
                                <span className="sdash-amount">{peso(currentBid)}</span>
                              ) : (
                                <>
                                  <span className="sdash-amount">{currentBid != null ? peso(currentBid) : 'No bids'}</span>
                                  {!hasBids && a.startPrice != null && (
                                    <span className="sdash-amount-sub">Starting bid</span>
                                  )}
                                </>
                              )}
                            </td>
                            <td>{Number(a.bids) || 0}</td>
                            <td>
                              <span className={`sdash-countdown${st.status === 'ended' ? ' sdash-countdown--done' : remaining < 3600 ? ' sdash-countdown--urgent' : ''}`}>
                                {st.status === 'ended' ? 'Ended' : formatRemaining(remaining)}
                              </span>
                            </td>
                            <td><StatusBadge status={st.status} label={st.label} tone={st.tone} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <DashboardEmptyState
                  icon={<Gavel />}
                  title="No auctions ending soon"
                  text="Your live or scheduled auctions will appear here."
                  actionLabel="Create auction"
                  actionTo="/shop/auctions"
                />
              )}
            </div>
          </section>
        </div>

        {/* ── Recent Activity (dense right rail) ──────────── */}
        <aside className="sdash-side-col" aria-labelledby="sdash-activity-title">
          <section className="sdash-panel">
            <div className="sdash-panel__head">
              <div className="sdash-panel__head-text">
                <h2 className="sdash-panel__title" id="sdash-activity-title">Recent Activity</h2>
                <p className="sdash-panel__subtitle">Latest actions on your shop</p>
              </div>
            </div>
            <div className="sdash-panel__body">
              {activityLoading ? (
                <div style={{ padding: 4 }}>
                  <SkeletonRegion label="Loading recent activity">
                    <SkeletonList
                      count={5}
                      render={() => (
                        <>
                          <SkeletonCircle size={30} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <Skeleton w="82%" h={11} />
                            <Skeleton w="36%" h={9} style={{ marginTop: 6 }} />
                          </span>
                        </>
                      )}
                    />
                  </SkeletonRegion>
                </div>
              ) : activityError ? (
                <DashboardEmptyState
                  title="Unable to load recent activity"
                  text={activityError}
                />
              ) : activities.length ? (
                <div className="sdash-activity">
                  {activities.map((a) => {
                    const meta = ACTIVITY_META[a.action] || {
                      title: a.action?.replace(/_/g, ' ') || 'Activity',
                      desc: () => '',
                      icon: Package,
                    };
                    let details = {};
                    try {
                      details = typeof a.details === 'string' ? JSON.parse(a.details) : (a.details || {});
                    } catch { /* keep empty details */ }
                    const Icon = meta.icon || Package;
                    return (
                      <div key={a.id} className="sdash-activity-item">
                        <div className="sdash-activity-icon" aria-hidden="true"><Icon /></div>
                        <div className="sdash-activity-body">
                          <div className="sdash-activity-title">
                            {meta.title} <em>— {meta.desc(details)}</em>
                          </div>
                          <div className="sdash-activity-time">{formatDateTime(a.created_at)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <DashboardEmptyState
                  icon={<Package />}
                  title="No recent activity"
                  text="Your latest shop activities will appear here."
                />
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function formatRemaining(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return 'Ended';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const secRem = Math.floor(s % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  return `${h}h ${m}m ${secRem}s`;
}
