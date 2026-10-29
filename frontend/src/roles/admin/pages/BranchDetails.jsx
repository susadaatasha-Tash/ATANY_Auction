// frontend/src/roles/admin/pages/BranchDetails.jsx
// Admin — Branch Details: Overview · Jewelry · Auctions, monitor-only.
//
// Route: /admin/branches/:branchId?tab=overview|jewelry|auctions
// The tab lives in the query string so a refresh / deep link / share keeps the
// selected branch AND the selected tab. Drawer selection uses the same query
// pattern (`?auction=` / `?listing=`) for the same reason.
//
// Every number here is server-scoped to the branch:
//   GET /admin/branches/:id/overview   → hero, KPIs, live monitoring, results
//   GET /admin/branches/:id/listings   → branch jewelry
//   GET /admin/branches/:id/auctions   → branch auction events
//   GET /admin/branches/:id/auctions/:auctionId → monitor drawer
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Award, Building2, Clock, Eye, Gem, Gavel, MapPin, Phone,
  ShieldCheck, Store, Users,
} from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { socket } from '../../../shared/lib/socketClient';
import { Skeleton, SkeletonCircle, SkeletonRegion } from '../../../shared/ui/Skeleton';
import { peso } from '../lib/currency';
import { fmtMoney, fmtWhen, timeAgo, countdownFrom } from '../lib/branchFormatters';
import { Drawer } from '../../../shared/components/Drawer';
import { useLiveAuction } from '../hooks/useLiveAuction';
import { JewelryDrawer } from '../components/JewelryDrawer';
import { AuctionMonitorDrawer } from '../components/AuctionMonitorDrawer';
import './admin-branches.css';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'jewelry', label: 'Jewelry' },
  { key: 'auctions', label: 'Auctions' },
];

// Jewelry status pills are derived from the states that ACTUALLY occur in the
// branch's listings (auction states + real product_status values). No status
// enum is invented and no pill is shown for a state the branch does not have.
const JEWELRY_STATE_ORDER = ['live', 'scheduled', 'paused', 'ended', 'pending', 'rejected', 'no-auction'];

/** Real listing state for a branch listing (auction state wins when present). */
export function jewelryState(listing) {
  if (listing.auction) return { key: listing.auction.status, label: cap(listing.auction.status) };
  if (listing.status === 'pending') return { key: 'pending', label: 'Draft' };
  if (listing.status === 'rejected') return { key: 'rejected', label: 'Rejected' };
  return { key: 'no-auction', label: 'No auction' };
}

function cap(s) { const str = String(s || ''); return str.charAt(0).toUpperCase() + str.slice(1); }

const AUCTION_PILLS = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'paused', label: 'Paused' },
  { value: 'ended', label: 'Ended' },
];

/** Pure merge of a realtime payload onto an existing auction row. */
export function mergeAuction(auction, payload) {
  if (!auction || !payload) return auction;
  const next = { ...auction };
  if (payload.status != null) next.status = payload.status;
  if (payload.current_bid != null) next.current_bid = Number(payload.current_bid);
  if (payload.watcher_count != null) next.watcher_count = Number(payload.watcher_count);
  if (payload.bid_count != null) next.bid_count = Number(payload.bid_count);
  if (payload.end_time) next.end_time = payload.end_time;
  if (payload.start_time) next.start_time = payload.start_time;
  return next;
}

export default function BranchDetails() {
  const { branchId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'overview';

  const [overview, setOverview] = useState(null);
  const [listings, setListings] = useState([]);
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [error, setError] = useState('');

  const [jewQ, setJewQ] = useState('');
  const [jewPill, setJewPill] = useState('all');
  const [aucPill, setAucPill] = useState('all');

  const listingParam = params.get('listing');
  const auctionParam = params.get('auction');

  const setParam = useCallback((key, value) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  }, [setParams]);

  const loadOverview = useCallback(async () => {
    const data = await apiFetch(`/admin/branches/${branchId}/overview`);
    setOverview(data);
  }, [branchId]);

  const loadTab = useCallback(async (which) => {
    setTabLoading(true);
    try {
      if (which === 'jewelry') setListings(await apiFetch(`/admin/branches/${branchId}/listings`));
      if (which === 'auctions') setAuctions(await apiFetch(`/admin/branches/${branchId}/auctions`));
    } finally {
      setTabLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const data = await apiFetch(`/admin/branches/${branchId}/overview`);
        if (alive) setOverview(data);
      } catch (e) {
        if (alive) setError(e.message || 'Unable to load this branch.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [branchId]);

  useEffect(() => {
    if (loading) return;
    loadTab(tab).catch(() => {});
  }, [tab, loading, loadTab]);

  // Live monitoring refresh: reuse the EXISTING socket events. Admin only listens
  // (join:auction does not register presence, so an admin never counts as a
  // watcher — see backend/src/index.js and services/auctionPresence.js).
  // Realtime patches for the Overview monitoring panel are applied as a PURE
  // merge of the incoming payload. (Calling setState from inside another
  // setState updater is not allowed in React — the panel patches itself and the
  // hook patches the auctions list.)
  const { patchAuction } = useLiveAuction(auctions, setAuctions, (id, payload) => {
    setOverview((prev) => (prev ? {
      ...prev,
      monitoring: (prev.monitoring || []).map((a) => (a.id === id ? mergeAuction(a, payload) : a)),
    } : prev));
  });

  useEffect(() => {
    if (tab !== 'auctions') return;
    const ids = auctions.map((a) => a.id).filter(Boolean);
    if (!ids.length) return undefined;
    try { ids.forEach((id) => socket.emit('join:auction', String(id))); } catch { /* transport not ready */ }
    return () => { try { ids.forEach((id) => socket.emit('leave:auction', String(id))); } catch { /* noop */ } };
  }, [tab, auctions]);

  const branch = overview?.branch || null;
  const kpis = overview?.kpis || null;

  const counts = useMemo(() => ({
    jewelry: overview?.kpis?.total_jewelry ?? 0,
    auctions: (overview?.kpis?.live_auctions ?? 0)
      + (overview?.kpis?.paused_auctions ?? 0)
      + (overview?.kpis?.scheduled_auctions ?? 0)
      + (overview?.kpis?.ended_auctions ?? 0),
  }), [overview]);

  const filteredListings = useMemo(() => {
    const term = jewQ.trim().toLowerCase();
    return listings.filter((l) => {
      const matchesQ = !term
        || String(l.name || '').toLowerCase().includes(term)
        || String(l.category || '').toLowerCase().includes(term)
        || String(l.seller_name || '').toLowerCase().includes(term)
        || String(l.auction?.lot_id || '').toLowerCase().includes(term);
      const matchesPill = jewPill === 'all' || jewelryState(l).key === jewPill;
      return matchesQ && matchesPill;
    });
  }, [listings, jewQ, jewPill]);

  // Only the states this branch actually has become pills.
  const jewelryPills = useMemo(() => {
    const present = new Set(listings.map((l) => jewelryState(l).key));
    const extra = JEWELRY_STATE_ORDER.filter((k) => present.has(k)).map((k) => ({
      value: k, label: k === 'pending' ? 'Draft' : k === 'no-auction' ? 'No auction' : cap(k),
    }));
    return [{ value: 'all', label: 'All' }, ...extra];
  }, [listings]);

  const filteredAuctions = useMemo(() => (
    aucPill === 'all' ? auctions : auctions.filter((a) => a.status === aucPill)
  ), [auctions, aucPill]);

  const selectedListing = listingParam ? listings.find((l) => String(l.id) === String(listingParam)) : null;

  if (loading) return <BranchSkeleton />;

  if (error || !branch) {
    return (
      <div className="abx-root">
        <button type="button" className="abx-back" onClick={() => navigate('/admin/branches')}>
          <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" /> Back to Branches
        </button>
        <div className="abx-state" role="alert">
          <p className="abx-state__title">{error || 'Branch not found.'}</p>
          <button type="button" className="abx-btn" onClick={() => navigate('/admin/branches')}>Back to Branches</button>
        </div>
      </div>
    );
  }

  const openNow = String(branch.status) === 'Open';

  return (
    <div className="abx-root">
      <button type="button" className="abx-back" onClick={() => navigate('/admin/branches')}>
        <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" /> Back to Branches
      </button>

      <section className="abx-hero" aria-label={`${branch.name} branch`}>
        {branch.branch_image_url ? (
          <img className="abx-hero__img" src={branch.branch_image_url} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        ) : (
          <span className="abx-hero__ph" aria-hidden="true"><Building2 size={40} /></span>
        )}
        <div className="abx-hero__overlay">
          <span className={`abx-badge abx-badge--lg${openNow ? ' is-open' : ' is-closed'}`}>
            <i aria-hidden="true" />{openNow ? 'Open' : 'Closed'}
          </span>
          <h1 className="abx-hero__name">{branch.name}</h1>
          <p className="abx-hero__meta">
            <span><MapPin size={13} strokeWidth={2} aria-hidden="true" />{branch.address}</span>
            {/* `branches` has no manager column — real operating details are shown. */}
            {branch.hours ? <span><Clock size={13} strokeWidth={2} aria-hidden="true" />{branch.hours}</span> : null}
            {branch.phone ? <span><Phone size={13} strokeWidth={2} aria-hidden="true" />{branch.phone}</span> : null}
          </p>
        </div>
      </section>

      <nav className="abx-tabs" aria-label="Branch sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`abx-tab${tab === t.key ? ' is-active' : ''}`}
            aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => setParam('tab', t.key)}
          >
            {t.label}
            {t.key === 'jewelry' ? <span className="abx-tab__count">{counts.jewelry}</span> : null}
            {t.key === 'auctions' ? <span className="abx-tab__count">{counts.auctions}</span> : null}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <OverviewTab overview={overview} branch={branch} counts={counts}
          onOpenListing={(l) => setParam('tab', 'jewelry') || setParam('listing', l.id)}
          onOpenAuction={(a) => setParam('tab', 'auctions') || setParam('auction', a.id)} />
      )}

      {tab === 'jewelry' && (
        <section className="abx-panel" aria-label="Branch jewelry">
          <div className="abx-controls">
            <div className="abx-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input type="text" value={jewQ} onChange={(e) => setJewQ(e.target.value)}
                placeholder="Search lot, seller or ID..." aria-label="Search lot, seller or ID" />
            </div>
            <div className="abx-pills" role="group" aria-label="Filter listings by status">
              {jewelryPills.map((p) => (
                <button key={p.value} type="button" className={`abx-pill${jewPill === p.value ? ' is-active' : ''}`}
                  aria-pressed={jewPill === p.value} onClick={() => setJewPill(p.value)}>{p.label}</button>
              ))}
            </div>
          </div>
          <p className="abx-count">
            {tabLoading ? 'Loading listings…' : `${filteredListings.length} of ${listings.length} listings at ${branch.name}`}
          </p>

          {tabLoading ? <JewelrySkeletons /> : (
            filteredListings.length ? (
              <div className="abx-jewelry">
                {filteredListings.map((l) => (
                  <JewelryCard key={l.id} listing={l} onOpen={() => setParam('listing', l.id)} />
                ))}
              </div>
            ) : (
              <div className="abx-state">
                <p className="abx-state__title">No jewelry listings found for this branch.</p>
                <p className="abx-state__sub">Listings created by sellers at this branch will appear here.</p>
              </div>
            )
          )}
        </section>
      )}

      {tab === 'auctions' && (
        <section aria-label="Branch auctions">
          <div className="abx-auction-bar">
            <p className="abx-count">
              {tabLoading ? 'Loading auctions…' : `${filteredAuctions.length} of ${auctions.length} auctions at ${branch.name}`}
            </p>
            <div className="abx-pills" role="group" aria-label="Filter auctions by status">
              {AUCTION_PILLS
                .filter((p) => p.value === 'all' || auctions.some((a) => a.status === p.value))
                .map((p) => (
                  <button key={p.value} type="button" className={`abx-pill${aucPill === p.value ? ' is-active' : ''}`}
                    aria-pressed={aucPill === p.value} onClick={() => setAucPill(p.value)}>{p.label}</button>
                ))}
            </div>
          </div>

          {tabLoading ? <AuctionSkeletons /> : (
            filteredAuctions.length ? (
              <div className="abx-auctions">
                {filteredAuctions.map((a) => (
                  <AuctionCard key={a.id} auction={a} onOpen={() => setParam('auction', a.id)} />
                ))}
              </div>
            ) : (
              <div className="abx-state">
                <p className="abx-state__title">
                  {aucPill === 'live' ? 'No live auctions right now.' : 'No auctions found for this branch.'}
                </p>
                <p className="abx-state__sub">Auctions created by sellers at this branch appear here in real time.</p>
              </div>
            )
          )}
        </section>
      )}

      <JewelryDrawer
        listing={selectedListing}
        branch={branch}
        onClose={() => setParam('listing', null)}
      />

      {auctionParam && (
        <AuctionMonitorDrawer
          auctionId={auctionParam}
          branch={branch}
          onClose={() => setParam('auction', null)}
          onLivePatch={patchAuction}
        />
      )}
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */
function OverviewTab({ overview, branch, counts, onOpenListing, onOpenAuction }) {
  const k = overview.kpis;
  const cards = [
    { label: 'Total Jewelry', value: k.total_jewelry, icon: <Gem size={18} />, tone: 'blue', badge: 'Branch scoped', note: `at ${branch.name}` },
    { label: 'Live Auctions', value: k.live_auctions, icon: <Gavel size={18} />, tone: 'gold', badge: `${k.live_watching} watching`, note: 'in session' },
    { label: 'Ended Auctions', value: k.ended_auctions, icon: <Award size={18} />, tone: 'blue', badge: 'Concluded', note: 'with results' },
    { label: 'Total Bids', value: k.total_bids, icon: <Users size={18} />, tone: 'gold', badge: 'All auctions', note: 'recorded' },
    { label: 'Branch Revenue', value: peso(k.revenue), icon: <span className="abx-peso">₱</span>, tone: 'gold', badge: 'This month', note: 'orders recorded' },
  ];

  return (
    <>
      <div className="abx-ov-kpis">
        {cards.map((c) => (
          <div className="abx-kpi" key={c.label}>
            <span className={`abx-kpi__icon abx-kpi__icon--${c.tone}`} aria-hidden="true">{c.icon}</span>
            <div className="abx-kpi__meta">
              <p className="abx-kpi__label">{c.label}</p>
              <p className="abx-kpi__value">{c.value}</p>
              <p className="abx-kpi__foot">
                <span className="abx-kpi__badge">{c.badge}</span>
                <span className="abx-kpi__note">{c.note}</span>
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="abx-ov-panels">
        <section className="abx-panel abx-panel--flush" aria-label="Live auctions needing monitoring">
          <header className="abx-panel__head">
            <h2>Live auctions needing monitoring</h2>
            <span className="abx-pill-label">{overview.monitoring.length} in session</span>
          </header>
          <div className="abx-panel__body">
            {overview.monitoring.length ? overview.monitoring.map((a) => (
              <button key={a.id} type="button" className="abx-monitor-row" onClick={() => onOpenAuction(a)}>
                <span className="abx-monitor-row__main">
                  <span className="abx-monitor-row__title">{a.product_name}</span>
                  <span className="abx-monitor-row__sub">{a.lot_id} · <Store size={12} strokeWidth={2} aria-hidden="true" />{a.shop_name || '—'}</span>
                </span>
                <span className="abx-monitor-row__side">
                  <span className="abx-monitor-row__price">{fmtMoney(a.current_bid)}</span>
                  <span className="abx-monitor-row__meta">
                    <span className={`abx-chip abx-chip--${a.status}`}>{a.status === 'live' ? 'Live' : 'Paused'}</span>
                    <span className="abx-watch"><Eye size={13} strokeWidth={2} aria-hidden="true" />{a.watcher_count}</span>
                  </span>
                </span>
              </button>
            )) : (
              <p className="abx-state__sub abx-state__sub--pad">No live auctions at this branch right now.</p>
            )}
          </div>
        </section>

        <section className="abx-panel abx-panel--flush" aria-label="Recent auction results">
          <header className="abx-panel__head">
            <h2>Recent auction results</h2>
            <span className="abx-pill-label">{overview.results.length} concluded</span>
          </header>
          <div className="abx-panel__body">
            {overview.results.length ? overview.results.map((a) => (
              <button key={a.id} type="button" className="abx-monitor-row" onClick={() => onOpenAuction(a)}>
                <span className="abx-monitor-row__main">
                  <span className="abx-monitor-row__title">{a.product_name}</span>
                  <span className="abx-monitor-row__sub">{a.lot_id} · {fmtWhen(a.end_time)}</span>
                </span>
                <span className="abx-monitor-row__side">
                  <span className="abx-monitor-row__price">{fmtMoney(a.current_bid)}</span>
                  <span className="abx-monitor-row__meta"><span className="abx-chip abx-chip--ended">Ended</span></span>
                </span>
              </button>
            )) : (
              <p className="abx-state__sub abx-state__sub--empty">No concluded auctions yet.</p>
            )}
          </div>
        </section>
      </div>

      <p className="abx-footnote">
        Figures are scoped to the {counts.jewelry} listing{counts.jewelry === 1 ? '' : 's'}, {counts.auctions} auction{counts.auctions === 1 ? '' : 's'}
        ({overview.kpis.scheduled_auctions} scheduled) tracked for {branch.name} in the admin view.
      </p>
    </>
  );
}

/* ── Jewelry card (read-only: no heart, favourite, reserve, buy or bid) ───── */
export function JewelryCard({ listing, onOpen }) {
  const state = jewelryState(listing);
  const status = state.label;
  const auction = listing.auction;
  const auctionState = auction ? (auction.status === 'live' ? 'Bidding open' : auction.status === 'paused' ? 'Paused' : auction.status === 'ended' ? 'Bidding closed' : 'Awaiting auction') : 'Awaiting auction';

  return (
    <article className="abx-jcard">
      <div className="abx-jcard__media">
        {listing.image_url ? (
          <img src={listing.image_url} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        ) : (
          <span className="abx-jcard__ph" aria-hidden="true"><Gem size={30} /></span>
        )}
        <span className={`abx-badge abx-badge--lg${state.key === 'live' ? ' is-open' : ''}`}><i aria-hidden="true" />{status}</span>
      </div>
      <div className="abx-jcard__body">
        <div className="abx-jcard__eyebrow">
          <span className="abx-cat">{listing.category || 'Jewelry'}</span>
          <span className="abx-lot">{auction?.lot_id || listing.id.slice(0, 8)}</span>
        </div>
        <h3 className="abx-jcard__name">{listing.name}</h3>
        <p className="abx-jcard__seller">
          <span><Store size={13} strokeWidth={2} aria-hidden="true" />{listing.branch_name || '—'}</span>
          <span><Users size={13} strokeWidth={2} aria-hidden="true" />{listing.seller_name || '—'}</span>
        </p>
        <div className="abx-est">
          <span className="abx-box__key">Estimated value</span>
          <span className="abx-box__val">{fmtMoney(listing.estimate)}</span>
        </div>
        <div className="abx-jcard__prices">
          <div className="abx-box">
            <span className="abx-box__key">Starting price</span>
            <span className="abx-box__val">{auction ? fmtMoney(auction.start_price) : '—'}</span>
          </div>
          <div className={`abx-box${auction && auction.status === 'live' ? ' abx-box--gold' : ''}`}>
            <span className="abx-box__key">{auction ? 'Current bid' : 'Auction'}</span>
            <span className="abx-box__val">{auction ? fmtMoney(auction.current_bid) : 'Not started'}</span>
          </div>
        </div>
        <div className="abx-jcard__foot">
          <span className="abx-bids"><Gavel size={13} strokeWidth={2} aria-hidden="true" />{auction?.bid_count ?? 0} bids</span>
          <span className="abx-jcard__state">{auctionState}</span>
        </div>
        <button type="button" className="abx-btn abx-btn--full" onClick={onOpen}>
          <Eye size={15} strokeWidth={2} aria-hidden="true" /> View details
        </button>
      </div>
    </article>
  );
}

/* ── Auction card ─────────────────────────────────────────────────────────── */
function AuctionCard({ auction, onOpen }) {
  const live = auction.status === 'live';
  const paused = auction.status === 'paused';
  const scheduled = auction.status === 'scheduled';
  const ended = auction.status === 'ended';
  const countdown = live || paused ? countdownFrom(auction.end_time) : null;

  return (
    <article className="abx-acard">
      <div className="abx-acard__media">
        {auction.image_url ? (
          <img src={auction.image_url} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        ) : (
          <span className="abx-acard__ph" aria-hidden="true"><Gem size={28} /></span>
        )}
        <span className={`abx-badge abx-badge--lg${live ? ' is-open' : paused ? ' is-paused' : ''}`}>
          <i aria-hidden="true" />{live ? 'Live' : paused ? 'Paused' : scheduled ? 'Scheduled' : 'Ended'}
        </span>
        {countdown ? <span className="abx-countdown"><Clock size={12} strokeWidth={2} aria-hidden="true" />{countdown}</span> : null}
        <span className="abx-acard__lot">{auction.lot_id}</span>
        {(live || paused) ? (
          <span className="abx-watch abx-watch--media"><Eye size={13} strokeWidth={2} aria-hidden="true" />{auction.watcher_count} watching</span>
        ) : null}
      </div>
      <div className="abx-acard__body">
        <span className="abx-cat">{auction.category || 'Jewelry'}</span>
        <h3 className="abx-acard__name">{auction.product_name}</h3>
        <p className="abx-acard__seller">
          <span><Users size={13} strokeWidth={2} aria-hidden="true" />{auction.shop_name || '—'}</span>
          <span><MapPin size={13} strokeWidth={2} aria-hidden="true" />{auction.branch_name || '—'}</span>
        </p>
        {scheduled ? (
          <>
            <div className="abx-box abx-box--full">
              <span className="abx-box__key">Starting price</span>
              <span className="abx-box__val">{fmtMoney(auction.start_price)}</span>
            </div>
            <div className="abx-acard__foot">
              <span className="abx-bids"><Gavel size={13} strokeWidth={2} aria-hidden="true" />{auction.bid_count} bids</span>
              <span className="abx-acard__state">Starts {fmtWhen(auction.start_time)}</span>
            </div>
          </>
        ) : ended ? (
          <div className="abx-box abx-box--full">
            <span className="abx-box__key">Final price</span>
            <span className="abx-box__val">{fmtMoney(auction.current_bid)}</span>
          </div>
        ) : (
          <>
            <div className="abx-box abx-box--full">
              <span className="abx-box__key">Highest bid</span>
              <span className="abx-box__val">{fmtMoney(auction.current_bid)}</span>
              <span className="abx-bids"><Gavel size={13} strokeWidth={2} aria-hidden="true" />{auction.bid_count} bids</span>
            </div>
            <div className="abx-acard__foot">
              <span className="abx-acard__state">
                Starting price · {fmtMoney(auction.start_price)} · Increment {fmtMoney(auction.minimum_bid_increment)}
              </span>
            </div>
          </>
        )}
        {/* Monitor only — there is deliberately no Place Bid control for Admin. */}
        <button type="button" className={`abx-btn abx-btn--full${live ? ' abx-btn--gold' : ''}`} onClick={onOpen}>
          <Eye size={15} strokeWidth={2} aria-hidden="true" /> {live ? 'Monitor live' : 'View details'}
        </button>
      </div>
    </article>
  );
}

/* ── Skeletons ────────────────────────────────────────────────────────────── */
function BranchSkeleton() {
  return (
    <SkeletonRegion label="Loading branch" className="abx">
      <Skeleton w={160} h={16} />
      <Skeleton w="100%" h={210} r={16} style={{ marginTop: 12 }} />
      <Skeleton w={340} h={40} r="999px" style={{ marginTop: 16 }} />
      <div className="abx-ov-kpis" style={{ marginTop: 18 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div className="abx-kpi" key={i}>
            <SkeletonCircle size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton w="58%" h={11} />
              <Skeleton w="40%" h={28} style={{ marginTop: 10 }} />
              <Skeleton w="66%" h={12} style={{ marginTop: 10 }} />
            </div>
          </div>
        ))}
      </div>
      <div className="abx-ov-panels">
        {[0, 1].map((i) => (
          <div className="abx-panel" key={i}>
            <Skeleton w="52%" h={16} />
            <Skeleton w="100%" h={62} style={{ marginTop: 14 }} />
            <Skeleton w="100%" h={62} style={{ marginTop: 10 }} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

function JewelrySkeletons() {
  return (
    <div className="abx-jewelry" aria-hidden="true">
      {[0, 1].map((i) => (
        <div className="abx-jcard" key={i}>
          <Skeleton w="100%" h={230} r="14px 14px 0 0" />
          <div style={{ padding: 16 }}>
            <Skeleton w="44%" h={11} />
            <Skeleton w="76%" h={16} style={{ marginTop: 10 }} />
            <Skeleton w="100%" h={54} r={12} style={{ marginTop: 14 }} />
            <Skeleton w="100%" h={54} r={12} style={{ marginTop: 10 }} />
            <Skeleton w="100%" h={40} r={11} style={{ marginTop: 14 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AuctionSkeletons() {
  return (
    <div className="abx-auctions" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div className="abx-acard" key={i}>
          <Skeleton w="100%" h={170} r="14px 14px 0 0" />
          <div style={{ padding: 16 }}>
            <Skeleton w="40%" h={11} />
            <Skeleton w="82%" h={16} style={{ marginTop: 10 }} />
            <Skeleton w="100%" h={62} r={12} style={{ marginTop: 14 }} />
            <Skeleton w="100%" h={40} r={11} style={{ marginTop: 14 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
