// frontend/src/roles/admin/pages/BranchDetails.jsx
// Admin → Branches → branch detail (Overview / Jewelry / Auctions).
//
// Everything on this page is branch-scoped SERVER-SIDE: the branch record,
// its listings (products → shop → home_branch_id), its auctions, the bids on
// those auctions and the live customer watcher presence.
//
// The admin is an observer: there is no favourite, no reserve, no buy and no
// bid control anywhere on this page — only read-only monitoring.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Search, Gem, Radio, Gavel, Coins, Wallet, Eye, Clock3,
  MapPin, Store, User, ChevronRight,
} from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { socket } from '../../../shared/lib/socketClient';
import { AdminJewelryDrawer } from '../components/AdminJewelryDrawer';
import { AdminAuctionDrawer } from '../components/AdminAuctionDrawer';
import {
  peso, compactPeso, isBranchOpen, branchStatusLabel, listingStatus, listingStatusLabel,
  isNotStarted, lotCode, timeAgo, formatStartLabel,
  countdownTo, auctionStatusLabel,
} from '../lib/adminBranchLabels';
import './branches.css';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'jewelry', label: 'Jewelry' },
  { value: 'auctions', label: 'Auctions' },
];

const JEWELRY_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live' },
  { value: 'draft', label: 'Draft' },
];

function PanelSkeleton() { return <div className="adm-skel adm-skel--panel" />; }
function CardSkeleton() { return <div className="adm-skel adm-skel--media" />; }

export default function BranchDetails() {
  const { branchId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'overview';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [jewelryQuery, setJewelryQuery] = useState('');
  const [jewelryStatus, setJewelryStatus] = useState('all');
  const [auctionStatus, setAuctionStatus] = useState('all');

  const [listingOpen, setListingOpen] = useState(null);
  const [auctionOpen, setAuctionOpen] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  // Live overrides pushed by the realtime events (watcher counts, current bid).
  const [overrides, setOverrides] = useState({});

  const load = useCallback(async (id, { quiet } = {}) => {
    if (!id) return;
    if (!quiet) setLoading(true);
    try {
      const res = await apiFetch(`/admin/branches/${id}/overview`);
      setData(res);
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load branch');
      if (!quiet) setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(branchId); }, [branchId, load]);

  // Countdown ticker for the live auction cards.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const auctions = data?.auctions || [];
  const listings = data?.listings || [];
  const kpis = data?.kpis || {};

  // The admin observes the live auction rooms of this branch (same rooms the
  // customer and the seller use) so watcher counts and prices stay live.
  const liveIds = useMemo(
    () => auctions.filter((a) => a.status === 'live' || a.status === 'paused').map((a) => String(a.id)),
    [auctions]
  );

  useEffect(() => {
    if (!liveIds.length) return undefined;
    try { socket.connect(); } catch { /* optional */ }
    const prev = new Set();
    liveIds.forEach((id) => { try { socket.emit('join:auction', id); } catch { /* noop */ } prev.add(id); });
    return () => {
      prev.forEach((id) => { try { socket.emit('leave:auction', id); } catch { /* noop */ } });
    };
  }, [liveIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onPresence = (payload) => {
      const id = String(payload?.auctionId || payload?.auction_id || '');
      if (!id) return;
      setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], watchers: Number(payload?.watchers || 0) } }));
    };
    const onBidUpdate = (payload) => {
      const id = String(payload?.auctionId || payload?.auction_id || '');
      if (!id) return;
      const amount = payload?.currentBid ?? payload?.current_bid;
      if (amount == null) return;
      // A bid never changes the watcher count.
      setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], current_bid: Number(amount) } }));
    };
    const onAuctionUpdate = (payload) => {
      const id = String(payload?.auction_id || payload?.id || payload?.auctionId || '');
      if (!id) return;
      load(branchId, { quiet: true });
    };
    socket.on('auction:presence', onPresence);
    socket.on('bid:update', onBidUpdate);
    socket.on('auction:update', onAuctionUpdate);
    return () => {
      socket.off('auction:presence', onPresence);
      socket.off('bid:update', onBidUpdate);
      socket.off('auction:update', onAuctionUpdate);
    };
  }, [branchId, load]);

  const setTab = (value) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    setParams(next, { replace: true });
  };

  const branch = data?.branch || null;
  const open = isBranchOpen(branch);

  const jewelries = useMemo(() => {
    const needle = jewelryQuery.trim().toLowerCase();
    return listings.filter((l) => {
      const status = listingStatus(l);
      if (jewelryStatus === 'live' && status !== 'live') return false;
      if (jewelryStatus === 'draft' && !isNotStarted(status)) return false;
      if (!needle) return true;
      return [l.name, l.category, l.shop?.name, l.shop?.owner_name, lotCode(l)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [listings, jewelryQuery, jewelryStatus]);

  const auctionFilters = useMemo(() => {
    const base = ['all', 'live', 'scheduled', 'paused'];
    if (auctions.some((a) => a.status === 'ended')) base.push('ended');
    return base;
  }, [auctions]);

  const filteredAuctions = useMemo(
    () => (auctionStatus === 'all' ? auctions : auctions.filter((a) => a.status === auctionStatus)),
    [auctions, auctionStatus]
  );

  const watcherOf = (a) => {
    const o = overrides[String(a.id)];
    return o?.watchers != null ? o.watchers : (a.watchers || 0);
  };
  const bidOf = (a) => {
    const o = overrides[String(a.id)];
    return o?.current_bid != null ? o.current_bid : a.current_bid;
  };

  const footnote = data
    ? `Figures are scoped to the ${kpis.total_jewelry ?? 0} listings, ${auctions.length} auctions (${kpis.scheduled_auctions ?? 0} scheduled) tracked for ${branch?.name || 'this branch'} in the admin view.`
    : '';

  if (loading && !data) {
    return (
      <div className="adm-page">
        <div className="adm-skel adm-skel--hero" />
        <div className="adm-skel" style={{ height: 44, width: 320, borderRadius: 999 }} />
        <div className="adm-kpi-grid adm-kpi-grid--5">
          <div className="adm-skel adm-skel--kpi" /><div className="adm-skel adm-skel--kpi" />
          <div className="adm-skel adm-skel--kpi" /><div className="adm-skel adm-skel--kpi" />
          <div className="adm-skel adm-skel--kpi" />
        </div>
        <div className="adm-panels"><PanelSkeleton /><PanelSkeleton /></div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="adm-page">
        <button type="button" className="adm-back" onClick={() => navigate('/admin/branches')}>
          <ArrowLeft size={14} /> Back to Branches
        </button>
        <div className="adm-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="adm-page">
      <button type="button" className="adm-back" onClick={() => navigate('/admin/branches')}>
        <ArrowLeft size={14} /> Back to Branches
      </button>

      {/* Hero */}
      <section className="adm-hero">
        {branch?.image_url && <img src={branch.image_url} alt={`${branch.name} branch`} />}
        <div className="adm-hero__scrim" />
        <div className="adm-hero__content">
          <span className={`adm-hero__badge${open ? '' : ' adm-hero__badge--closed'}`}>
            <i /> {branchStatusLabel(branch)}
          </span>
          <h1 className="adm-hero__title">{branch?.name}</h1>
          <div className="adm-hero__meta">
            {branch?.address && (
              <span><MapPin size={14} /> {branch.address}</span>
            )}
            <span><User size={14} /> Manager · {branch?.manager_name || 'Unassigned'}</span>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <nav className="adm-tabs" aria-label="Branch sections">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`adm-tab${tab === t.value ? ' is-active' : ''}`}
            onClick={() => setTab(t.value)}
            aria-current={tab === t.value ? 'page' : undefined}
          >
            {t.label}
            {t.value === 'jewelry' && <span className="adm-tab__count">{listings.length}</span>}
            {t.value === 'auctions' && <span className="adm-tab__count">{auctions.length}</span>}
          </button>
        ))}
      </nav>

      {/* ── OVERVIEW ───────────────────────────────────────────── */}
      {tab === 'overview' && (
        <>
          <div className="adm-kpi-grid adm-kpi-grid--5">
            <article className="adm-kpi">
              <div className="adm-kpi__top">
                <div className="adm-kpi__icon"><Gem size={18} /></div>
                <div>
                  <p className="adm-kpi__label">Total Jewelry</p>
                  <p className="adm-kpi__value">{kpis.total_jewelry ?? 0}</p>
                </div>
              </div>
              <div className="adm-kpi__foot">
                <span className="adm-pill adm-pill--blue">Branch scoped</span>
                <span className="adm-kpi__context">at {branch?.name}</span>
              </div>
            </article>

            <article className="adm-kpi">
              <div className="adm-kpi__top">
                <div className="adm-kpi__icon"><Radio size={18} /></div>
                <div>
                  <p className="adm-kpi__label">Live Auctions</p>
                  <p className="adm-kpi__value">{kpis.live_auctions ?? 0}</p>
                </div>
              </div>
              <div className="adm-kpi__foot">
                <span className="adm-pill">{kpis.watchers ?? 0} watching</span>
                <span className="adm-kpi__context">in session</span>
              </div>
            </article>

            <article className="adm-kpi">
              <div className="adm-kpi__top">
                <div className="adm-kpi__icon"><Gavel size={18} /></div>
                <div>
                  <p className="adm-kpi__label">Ended Auctions</p>
                  <p className="adm-kpi__value">{kpis.ended_auctions ?? 0}</p>
                </div>
              </div>
              <div className="adm-kpi__foot">
                <span className="adm-pill adm-pill--grey">Concluded</span>
                <span className="adm-kpi__context">with results</span>
              </div>
            </article>

            <article className="adm-kpi">
              <div className="adm-kpi__top">
                <div className="adm-kpi__icon"><Coins size={18} /></div>
                <div>
                  <p className="adm-kpi__label">Total Bids</p>
                  <p className="adm-kpi__value">{kpis.total_bids ?? 0}</p>
                </div>
              </div>
              <div className="adm-kpi__foot">
                <span className="adm-pill">All auctions</span>
                <span className="adm-kpi__context">recorded</span>
              </div>
            </article>

            <article className="adm-kpi">
              <div className="adm-kpi__top">
                <div className="adm-kpi__icon adm-kpi__icon--gold"><Wallet size={18} /></div>
                <div>
                  <p className="adm-kpi__label">Branch Revenue</p>
                  <p className="adm-kpi__value">{compactPeso(kpis.revenue ?? 0)}</p>
                </div>
              </div>
              <div className="adm-kpi__foot">
                <span className="adm-pill">Lifetime</span>
                <span className="adm-kpi__context">recognized</span>
              </div>
            </article>
          </div>

          <div className="adm-panels">
            <section className="adm-panel">
              <header className="adm-panel__head">
                <h2 className="adm-panel__title">Live auctions needing monitoring</h2>
                <span className="adm-pill">{(data?.live_auctions || []).length} live</span>
              </header>
              <div className="adm-panel__body">
                {(data?.live_auctions || []).length ? data.live_auctions.map((a) => (
                  <div className="adm-live-row" key={a.id}>
                    {a.product?.image_url && <img className="adm-live-row__thumb" src={a.product.image_url} alt="" />}
                    <div className="adm-live-row__main">
                      <p className="adm-live-row__title">{a.product?.name}</p>
                      <p className="adm-live-row__meta">
                        <span>{a.auction_code || lotCode(a)}</span>
                        <span>·</span>
                        <span>{a.shop?.name}</span>
                        {a.status === 'paused' && <span className="adm-pill adm-pill--warn">Paused</span>}
                      </p>
                    </div>
                    <div className="adm-live-row__right">
                      <div className="adm-live-row__price">{peso(bidOf(a))}</div>
                      <div className="adm-live-row__watch"><Eye size={12} /> {watcherOf(a)} watching</div>
                    </div>
                  </div>
                )) : (
                  <div className="adm-empty">No live auctions right now.</div>
                )}
              </div>
            </section>

            <section className="adm-panel">
              <header className="adm-panel__head">
                <h2 className="adm-panel__title">Recent auction results</h2>
                <span className="adm-pill adm-pill--grey">{(data?.recent_results || []).length} concluded</span>
              </header>
              <div className="adm-panel__body">
                {(data?.recent_results || []).length ? data.recent_results.map((a) => (
                  <div className="adm-live-row" key={a.id}>
                    {a.product?.image_url && <img className="adm-live-row__thumb" src={a.product.image_url} alt="" />}
                    <div className="adm-live-row__main">
                      <p className="adm-live-row__title">{a.product?.name}</p>
                      <p className="adm-live-row__meta">
                        <span>{a.auction_code || lotCode(a)}</span>
                        <span>·</span>
                        <span>{a.order?.winner_name || 'No winner recorded'}</span>
                      </p>
                    </div>
                    <div className="adm-live-row__right">
                      <div className="adm-live-row__price">{peso(a.order?.amount ?? a.current_bid)}</div>
                      <div className="adm-live-row__watch">{timeAgo(a.order?.created_at || a.end_time)}</div>
                    </div>
                  </div>
                )) : (
                  <div className="adm-empty">No concluded auctions yet.</div>
                )}
              </div>
            </section>
          </div>

          <p className="adm-footnote">{footnote}</p>
        </>
      )}

      {/* ── JEWELRY ────────────────────────────────────────────── */}
      {tab === 'jewelry' && (
        <>
          <div className="adm-filter-panel">
            <div className="adm-search">
              <Search size={16} />
              <input
                type="text"
                value={jewelryQuery}
                onChange={(e) => setJewelryQuery(e.target.value)}
                placeholder="Search lot, seller or ID..."
                aria-label="Search listings"
              />
            </div>
            <div className="adm-pills" role="group" aria-label="Filter listings by status">
              {JEWELRY_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className={`adm-pills__btn${jewelryStatus === f.value ? ' is-active' : ''}`}
                  onClick={() => setJewelryStatus(f.value)}
                  aria-pressed={jewelryStatus === f.value}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <p className="adm-footnote" style={{ fontStyle: 'normal', color: 'var(--adm-muted)' }}>
            {jewelries.length} of {listings.length} listings at {branch?.name}
          </p>

          {jewelries.length ? (
            <div className="adm-jewelry-grid">
              {jewelries.map((l) => {
                const status = listingStatus(l);
                const a = l.auction;
                const isEnded = status === 'ended';
                return (
                  <article className="adm-jewelry-card" key={l.id}>
                    <div className="adm-jewelry-card__media">
                      {l.image_url && <img src={l.image_url} alt={l.name} loading="lazy" />}
                      <span className={`adm-jewelry-card__badge adm-jewelry-card__badge--${status}`}>
                        <i /> {listingStatusLabel(status)}
                      </span>
                    </div>
                    <div className="adm-jewelry-card__body">
                      <div className="adm-jewelry-card__top">
                        <span className="adm-cat">{l.category}</span>
                        <span className="adm-lot">{lotCode(l)}</span>
                      </div>
                      <h3 className="adm-jewelry-card__title">{l.name}</h3>
                      <div className="adm-meta-rows">
                        <div className="adm-meta-row"><MapPin size={13} /> {l.branch?.name || branch?.name}</div>
                        <div className="adm-meta-row"><Store size={13} /> {l.shop?.name || '—'}</div>
                      </div>

                      <div className="adm-field-box">
                        <div className="adm-field-box__label">Estimated value</div>
                        <div className="adm-field-box__value">{l.price != null ? peso(l.price) : '—'}</div>
                      </div>

                      <div className="adm-two-col">
                        <div className="adm-field-box">
                          <div className="adm-field-box__label">Starting price</div>
                          <div className="adm-field-box__value adm-field-box__value--sm">
                            {a?.start_price != null ? peso(a.start_price) : '—'}
                          </div>
                        </div>
                        {isEnded ? (
                          <div className="adm-field-box">
                            <div className="adm-field-box__label">Final price</div>
                            <div className="adm-field-box__value adm-field-box__value--sm">
                              {peso(l.final_price ?? a?.current_bid)}
                            </div>
                          </div>
                        ) : a && a.status !== 'scheduled' ? (
                          <div className="adm-field-box">
                            <div className="adm-field-box__label">Current bid</div>
                            <div className="adm-field-box__value adm-field-box__value--sm">
                              {a.current_bid != null ? peso(a.current_bid) : '—'}
                            </div>
                          </div>
                        ) : (
                          <div className="adm-field-box">
                            <div className="adm-field-box__label">Auction</div>
                            <div className="adm-field-box__value adm-field-box__value--sm">Not started</div>
                          </div>
                        )}
                      </div>

                      <div className="adm-jewelry-card__foot">
                        <span><Gavel size={13} /> {a?.total_bids ?? 0} bids</span>
                        <span>
                          {status === 'live' ? 'Bidding open'
                            : status === 'paused' ? 'Auction paused'
                              : status === 'ended' ? 'Auction ended'
                                : 'Awaiting auction'}
                        </span>
                      </div>

                      <button type="button" className="adm-btn adm-btn--block" onClick={() => setListingOpen(l)}>
                        <Eye size={14} /> View details
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="adm-empty">No jewelry listings found for this branch.</div>
          )}
        </>
      )}

      {/* ── AUCTIONS ───────────────────────────────────────────── */}
      {tab === 'auctions' && (
        <>
          <div className="adm-filter-panel">
            <p className="adm-footnote" style={{ fontStyle: 'normal', color: 'var(--adm-muted)', margin: 0 }}>
              {filteredAuctions.length} of {auctions.length} auctions at {branch?.name}
            </p>
            <div className="adm-pills" role="group" aria-label="Filter auctions by status">
              {auctionFilters.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`adm-pills__btn${auctionStatus === f ? ' is-active' : ''}`}
                  onClick={() => setAuctionStatus(f)}
                  aria-pressed={auctionStatus === f}
                >
                  {f === 'all' ? 'All' : auctionStatusLabel(f)}
                </button>
              ))}
            </div>
          </div>

          {filteredAuctions.length ? (
            <div className="adm-auction-grid">
              {filteredAuctions.map((a) => {
                const status = a.status;
                const isLive = status === 'live';
                const isPaused = status === 'paused';
                const isScheduled = status === 'scheduled';
                const isEnded = status === 'ended';
                const watchers = watcherOf(a);
                const highest = bidOf(a);
                return (
                  <article className="adm-auction-card" key={a.id}>
                    <div className="adm-auction-card__media">
                      {a.product?.image_url && <img src={a.product.image_url} alt={a.product?.name} loading="lazy" />}
                      <div className="adm-auction-card__scrim" />
                      <span className={`adm-auction-card__badge adm-auction-card__badge--${status}`}>
                        <i /> {auctionStatusLabel(status)}
                      </span>
                      {(isLive || isPaused) && (
                        <span className="adm-auction-card__countdown">
                          <Clock3 size={11} /> {countdownTo(a.end_time, now)}
                        </span>
                      )}
                      <div className="adm-auction-card__foot-media">
                        <span>{a.auction_code || lotCode(a)}</span>
                        <span><Eye size={12} /> {watchers} watching</span>
                      </div>
                    </div>
                    <div className="adm-auction-card__body">
                      <div className="adm-jewelry-card__top">
                        <span className="adm-cat">{a.product?.category}</span>
                      </div>
                      <h3 className="adm-auction-card__title">{a.product?.name}</h3>
                      <div className="adm-meta-rows">
                        <div className="adm-meta-row"><Store size={13} /> {a.shop?.name || '—'}</div>
                        <div className="adm-meta-row"><MapPin size={13} /> {a.branch?.name || branch?.name}</div>
                      </div>

                      {isScheduled ? (
                        <div className="adm-price-block">
                          <div>
                            <div className="adm-price-block__label">Starting price</div>
                            <div className="adm-price-block__value">{peso(a.start_price)}</div>
                          </div>
                          <span className="adm-pill adm-pill--grey">{a.total_bids ?? 0} bids</span>
                        </div>
                      ) : (
                        <div className="adm-price-block">
                          <div>
                            <div className="adm-price-block__label">
                              {isEnded ? (a.winner_rank > 1 ? 'Current payable amount' : 'Final price') : 'Highest bid'}
                            </div>
                            <div className="adm-price-block__value">
                              {isEnded ? peso(a.order?.amount ?? highest) : peso(highest)}
                            </div>
                            {a.leader?.name && <div className="adm-price-block__by">by {a.leader.name}</div>}
                          </div>
                          <span className="adm-pill adm-pill--grey">{a.total_bids ?? 0} bids</span>
                        </div>
                      )}

                      <div className="adm-auction-card__terms">
                        {isScheduled ? (
                          <span><Clock3 size={12} /> Starts {formatStartLabel(a.start_time)}</span>
                        ) : (
                          <>
                            <span>Starting price · {peso(a.start_price)}</span>
                            <span>·</span>
                            <span>Increment {peso(a.minimum_bid_increment)}</span>
                          </>
                        )}
                      </div>

                      {isLive ? (
                        <button type="button" className="adm-btn adm-btn--gold adm-btn--block" onClick={() => setAuctionOpen(a.id)}>
                          Monitor live <ChevronRight size={14} />
                        </button>
                      ) : (
                        <button type="button" className="adm-btn adm-btn--block" onClick={() => setAuctionOpen(a.id)}>
                          View details
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="adm-empty">
              {auctionStatus === 'live' ? 'No live auctions right now.' : 'No auctions found for this branch.'}
            </div>
          )}
        </>
      )}

      <AdminJewelryDrawer
        listing={listingOpen}
        branch={branch}
        onClose={() => setListingOpen(null)}
      />
      <AdminAuctionDrawer
        auctionId={auctionOpen}
        branch={branch}
        keepRoom={liveIds.includes(String(auctionOpen))}
        onClose={() => setAuctionOpen(null)}
      />
    </div>
  );
}
