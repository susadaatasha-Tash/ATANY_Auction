// frontend/src/pages/LandingPage.jsx
// Landing page — hero, stats, live auctions, jewelry, about, how-it-works, branches, CTA, footer
// All dynamic content comes from real ATANY data (no hardcoded business figures).
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Mail, MapPin } from 'lucide-react';
import { useAuctionCountdown, formatCountdown } from '../shared/hooks/useAuctionCountdown';
import { useToast } from '../shared/components/Toast';
import { AssistantWidget } from '../shared/components/AssistantWidget';
import { PublicHeader } from '../shared/components/PublicHeader';
import { apiFetch } from '../shared/lib/apiClient';
import { useAuth } from '../shared/hooks/useAuth';
import { roleHome, ACCOUNT_SUSPENDED_ROUTE } from '../shared/lib/roleRoutes';
import { BranchMap } from '../roles/customer/components/BranchMap';
import { SUPPORT_EMAIL, SUPPORT_CATEGORIES } from '../shared/config/support';

function Countdown({ initial }) {
  const sec = useAuctionCountdown(initial);
  return <span className="timer">{sec <= 0 ? 'Auction ended' : formatCountdown(sec)}</span>;
}

// Stat definitions — every metric is a real aggregate from GET /api/public/stats.
const STAT_DEFS = [
  { key: 'customers', label: 'Registered Customers' },
  { key: 'jewelryPieces', label: 'Jewelry Pieces' },
  { key: 'completedAuctions', label: 'Completed Auctions' },
  { key: 'branches', label: 'ATANY Branches' },
];

// Real, verified image for the certification block (the previous URL 404'd).
const CERTIFICATION_IMG = 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=600&q=80';

export default function LandingPage() {
  const showToast = useToast();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [amount, setAmount] = useState('');
  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cSubject, setCSubject] = useState('General Inquiry');
  const [cMessage, setCMessage] = useState('');
  const [cBusy, setCBusy] = useState(false);
  const [cSent, setCSent] = useState(false);
  const [cReference, setCReference] = useState('');
  const [cMailSent, setCMailSent] = useState(true);
  const { user, role, status, signOut } = useAuth();

  // ── Public data ────────────────────────────────────────────────────────────
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState(false);
  const [liveAuctions, setLiveAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [guestBidAuctionId, setGuestBidAuctionId] = useState(null);

  const isSuspended = !!user && role === 'customer' && String(status || '').toLowerCase() === 'suspended';

  // Only real branches that are open for pickup. Deterministic order (server sorts by name).
  const openBranches = useMemo(() => (branches || []).filter((b) => String(b.status || '').toLowerCase() === 'open'), [branches]);
  const featuredBranch = openBranches[0] || null;
  const contactBranches = openBranches.slice(0, 3);

  // ── Contact form ───────────────────────────────────────────────────────────
  const handleContactSubmit = async (e) => {
    e.preventDefault();
    if (!cName.trim() || !cEmail.trim() || !cMessage.trim()) {
      showToast('Please fill in all required fields');
      return;
    }
    setCBusy(true);
    try {
      // Backend endpoint validates, rate limits and stores the row authoritatively.
      const res = await apiFetch('/api/public/contact', {
        method: 'POST',
        public: true,
        body: JSON.stringify({ name: cName.trim(), email: cEmail.trim(), category: cSubject, subject: cSubject, message: cMessage.trim() }),
      });
      if (!res) throw new Error('Unable to send your support request. Please try again.');
      setCReference(res?.request?.reference || '');
      setCMailSent(res?.email_notification?.sent !== false);
      setCSent(true);
      showToast('Message received. ATANY Support will review your request.');
      setCName(''); setCEmail(''); setCSubject('General Inquiry'); setCMessage('');
    } catch (err) {
      showToast(err?.message || 'Something went wrong — please try again or email us directly');
    } finally {
      setCBusy(false);
    }
  };

  // ── Scroll spy + hash scroll (single listener, active state from first paint) ──
  const syncActiveSection = useCallback(() => {
    const sections = document.querySelectorAll('main section[id]');
    const links = document.querySelectorAll('.nav-links a');
    let cur = 'home';
    sections.forEach((s) => { if (window.scrollY >= s.offsetTop - 120) cur = s.id; });
    links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + cur));
  }, []);

  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 100);
    }
    // Highlight the correct nav item on first paint, not only after scrolling.
    syncActiveSection();
    const onScroll = () => syncActiveSection();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [hash, syncActiveSection]);

  // ── Public stats ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function fetchStats() {
      setStatsLoading(true);
      try {
        const rows = await apiFetch('/api/public/stats', { public: true });
        if (!cancelled) setStats(rows);
      } catch {
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    }
    fetchStats();
    return () => { cancelled = true; };
  }, []);

  // ── Public branches (single source of truth: Admin → branches table) ───────
  useEffect(() => {
    let cancelled = false;
    async function fetchBranches() {
      setBranchesLoading(true);
      setBranchesError(false);
      try {
        const rows = await apiFetch('/branches', { public: true });
        if (!cancelled) setBranches(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) { setBranches([]); setBranchesError(true); }
      } finally {
        if (!cancelled) setBranchesLoading(false);
      }
    }
    fetchBranches();
    return () => { cancelled = true; };
  }, []);

  // ── Featured auctions (real records; live first, then upcoming) ───────────
  useEffect(() => {
    async function fetchLiveAuctions() {
      setLoading(true);
      setError(null);
      try {
        const rows = await apiFetch('/api/auctions/live', { public: true });
        const list = Array.isArray(rows) ? rows : [];
        // Live auctions first, then upcoming (scheduled) — never label a scheduled one "Live".
        const sorted = [...list].sort((a, b) => {
          const rank = (x) => (String(x?.status || '').toLowerCase() === 'live' ? 0 : 1);
          if (rank(a) !== rank(b)) return rank(a) - rank(b);
          const ea = a?.endsInSec ?? Infinity, eb = b?.endsInSec ?? Infinity;
          return ea - eb;
        });
        setLiveAuctions(sorted);
      } catch (e) {
        setError('Unable to load live auctions.');
        setLiveAuctions([]);
      } finally {
        setLoading(false);
      }
    }
    fetchLiveAuctions();
  }, []);

  // ── Navigation helpers ────────────────────────────────────────────────────
  const isCustomer = role === 'customer';
  const isStaff = role === 'shop_owner' || role === 'admin';

  // The real existing auction route (customer portal). The auction detail is a modal
  // opened from the `auction` search param.
  const auctionRoute = (id) => `/customer/auctions?auction=${encodeURIComponent(id)}`;

  // Guest → login with a return path to the exact auction.
  const loginRedirect = (path) => `/login?redirect=${encodeURIComponent(path)}`;

  const handlePlaceBidClick = (a) => {
    if (!user) { setGuestBidAuctionId(a.id); return; }
    if (isSuspended) {
      showToast('Your account is suspended and cannot place bids. Please contact support.');
      return;
    }
    if (isStaff) {
      // Shop owners / admins are not customers — no cross-role bidding.
      showToast('Customer accounts only can place bids.');
      navigate(role === 'admin' ? '/admin' : '/shop');
      return;
    }
    if (isCustomer) {
      navigate(auctionRoute(a.id));
      return;
    }
    // Signed in but role unknown → send to login so the role is resolved properly.
    navigate(loginRedirect(auctionRoute(a.id)));
  };

  const categoryLink = (cat) => {
    const target = `/customer/auctions?category=${encodeURIComponent(cat)}`;
    return isCustomer ? target : loginRedirect(target);
  };

  const viewAllAuctionsLink = () => {
    const target = '/customer/auctions';
    return isCustomer ? target : loginRedirect(target);
  };

  const hasLive = liveAuctions.some((a) => String(a?.status || '').toLowerCase() === 'live');

  // ── CTA ───────────────────────────────────────────────────────────────────
  // Role-aware so an already-registered visitor is never pushed back to signup.
  // A suspended customer is routed to the account-status page — the landing CTA
  // must not become a way around the suspension guard.
  const cta = useMemo(() => {
    if (!user) {
      return {
        title: 'Join ATANY Today',
        copy: 'Create a customer account and start your journey to owning timeless beauty.',
        label: 'Get Started Now',
        to: '/signup',
      };
    }
    if (isSuspended) {
      return {
        title: 'Account Suspended',
        copy: 'Your account is currently suspended, so bidding and checkout are paused. Contact support to restore access.',
        label: 'View Account Status',
        to: ACCOUNT_SUSPENDED_ROUTE,
      };
    }
    if (role === 'admin') {
      return {
        title: 'ATANY Administration',
        copy: 'Manage branches, users, auctions and platform settings from the admin portal.',
        label: 'Open Admin Portal',
        to: roleHome('admin'),
      };
    }
    if (role === 'shop_owner') {
      return {
        title: 'Manage Your ATANY Shop',
        copy: 'Create listings, run your auctions and track payouts from the seller portal.',
        label: 'Open Seller Portal',
        to: roleHome('shop_owner'),
      };
    }
    if (role === 'customer') {
      return {
        title: 'Welcome Back to ATANY',
        copy: 'Your bids, favorites, purchases and pickup branch are all in one place.',
        label: 'Go to My Account',
        to: roleHome('customer'),
      };
    }
    return {
      title: 'Join ATANY Today',
      copy: 'Create a customer account and start your journey to owning timeless beauty.',
      label: 'Get Started Now',
      to: '/signup',
    };
  }, [user, role, isSuspended]);

  // Footer account links — mirrors the public header convention for guests and
  // points signed-in visitors at their own portal instead of a login page.
  const accountLinks = useMemo(() => {
    if (!user) {
      return [
        { label: 'Sign In', to: '/login' },
        { label: 'Create Account', to: '/signup' },
      ];
    }
    const home = roleHome(role);
    const links = home ? [{ label: 'My Account', to: home }] : [];
    links.push({ label: 'Sign Out', to: null, action: 'signout' });
    return links;
  }, [user, role]);

  const handleSignOut = useCallback(() => {
    signOut();
  }, [signOut]);

  // Section links use the same behaviour as the public header: prevent the
  // default jump and smooth-scroll to the section (sticky-header offset comes
  // from `scroll-margin-top` on `.public-page main section[id]`).
  const scrollToSection = useCallback((id) => (e) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const YEAR = new Date().getFullYear();

  return (
    <div className="public-page">
      <PublicHeader landing />

      <main>
        <section className="hero" id="home">
          <div className="container hero-content">
            <div className="hero-copy">
              <div className="eyebrow">EXQUISITE · ELEGANT · EXTRAORDINARY</div>
              <h1>Discover Timeless Jewelry Worth Bidding For.</h1>
              <p>Join our exclusive jewelry auctions and discover premium pieces crafted to perfection.</p>
              <div className="hero-buttons">
                <a className="btn btn-gold" href="#auctions">Explore Auctions</a>
                <a className="btn btn-outline" href="#jewelry">Shop Jewelry</a>
              </div>
            </div>
          </div>
        </section>

        <div className="stats">
          <div className="container stats-grid">
            {STAT_DEFS.map(({ key, label }) => (
              <div key={label} className="stat">
                <div>
                  {statsLoading ? (
                    <div className="stat-number" aria-hidden="true">&nbsp;</div>
                  ) : (
                    <div className="stat-number">{stats && stats[key] != null ? Number(stats[key]).toLocaleString() : '--'}</div>
                  )}
                  <div className="stat-label">{label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <section id="auctions">
          <div className="container">
            <div className="section-heading">
              <div>
                <h2>Featured Auctions</h2>
                <p>{hasLive ? 'Bid before time runs out — the highest eligible bidder wins.' : 'Upcoming auctions — place a bid when bidding opens.'}</p>
              </div>
              <Link to={viewAllAuctionsLink()} className="text-link">View all auctions →</Link>
            </div>
            <div className="auction-grid">
              {loading ? (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px 0' }}>Loading auctions...</div>
              ) : error ? (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>Unable to load live auctions.</div>
              ) : liveAuctions.length === 0 ? (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>No live auctions at the moment.</div>
              ) : liveAuctions.map((a) => {
                const statusLabel = String(a.status || '').toLowerCase();
                const isLive = statusLabel === 'live';
                const increment = Number(a.minimum_bid_increment) || 0;
                const currentBid = Number(a.currentBid) || 0;
                const minNextBid = currentBid + increment;
                return (
                  <article key={a.id} className="auction-card">
                    <div className="card-image">
                      <img src={a.img} alt={a.name} />
                      {isLive ? (
                        <span className="live-tag"><span className="live-dot" />LIVE</span>
                      ) : (
                        <span className="live-tag scheduled"><span className="live-dot" />UPCOMING</span>
                      )}
                    </div>
                    <div className="card-body">
                      <h3 className="card-title">{a.name}</h3>
                      <div className="live-meta">
                        <span>{a.shop_name || 'Shop'}</span>
                        <span>{a.branch_name || ''}</span>
                      </div>
                      <div className="price">Current bid: {a.currentBid ? `₱${currentBid.toLocaleString()}` : 'Starting'}</div>
                      {increment > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                          Min. increment ₱{increment.toLocaleString()} · Next bid ≥ ₱{minNextBid.toLocaleString()}
                        </div>
                      )}
                      {a.karat_weight && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>✦ {a.karat_weight}</div>}
                      <div className="starting">
                        <div>{isLive ? 'Ends in' : 'Starts in'}</div>
                        {isLive
                          ? (a.endsInSec !== undefined ? <Countdown initial={a.endsInSec} /> : <span>Unknown</span>)
                          : (a.startsInSec !== undefined ? <Countdown initial={a.startsInSec} /> : <span>Unknown</span>)}
                      </div>
                      <div className="bid-box" onClick={(e) => e.stopPropagation()}>
                        <button
                          className={isCustomer && !isSuspended ? 'btn btn-primary' : 'btn btn-outline'}
                          onClick={() => handlePlaceBidClick(a)}
                          disabled={isSuspended}
                          title={isSuspended ? 'Your account is suspended and cannot place bids.' : undefined}
                        >
                          Place Bid
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="jewelry">
          <div className="container">
            <div className="section-heading">
              <div><h2>Shop Our Jewelry</h2><p>Browse by category — find the perfect piece.</p></div>
              <Link to={viewAllAuctionsLink()} className="text-link">Browse All Auctions →</Link>
            </div>
            <div className="jewelry-grid">
              {[
                { name: 'Rings', img: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=400&q=80' },
                { name: 'Necklaces', img: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=400&q=80' },
                { name: 'Bracelets', img: 'https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=400&q=80' },
                { name: 'Earrings', img: 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=400&q=80' },
                { name: 'Watches', img: 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=400&q=80' },
              ].map((cat) => (
                <Link key={cat.name} to={categoryLink(cat.name)} className="collection-card">
                  <div className="collection-image"><img src={cat.img} alt={cat.name} /></div>
                  <div className="collection-info"><h4>{cat.name}</h4><span>Explore →</span></div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section id="about">
          <div className="container" style={{ maxWidth: 800 }}>
            <div className="landing-about-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}>
              <div>
                <div className="eyebrow">WHY ATANY</div>
                <h2 style={{ fontSize: 28, color: 'var(--navy)', fontWeight: 800, lineHeight: 1.2, marginBottom: 14 }}>A Platform Built on Trust</h2>
                <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 12 }}>
                  In a market flooded with uncertainty, ATANY was founded on a simple principle: every jewelry buyer deserves certainty.
                  We combine the excitement of live auctions with the rigor of professional authentication.
                </p>
                <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
                  From rings to watches, every piece on ATANY passes through our verification process before it ever reaches the auction floor.
                  No guesswork. No risk. Just beautifully crafted jewelry you can bid on with confidence.
                </p>
              </div>
              <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)' }}>
                <img src="https://images.unsplash.com/photo-1617038260897-41a1f14a8ca0?auto=format&fit=crop&w=600&q=80" alt="Jewelry craftsmanship" style={{ width: '100%', height: 320, objectFit: 'cover' }} />
              </div>
            </div>
          </div>
        </section>

        <section style={{ padding: '56px 0', background: 'var(--soft)' }}>
          <div className="container" style={{ maxWidth: 800 }}>
            <div className="landing-about-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}>
              <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)', order: 2 }}>
                <img src={CERTIFICATION_IMG} alt="Jewelry certification" style={{ width: '100%', height: 320, objectFit: 'cover' }} />
              </div>
              <div style={{ order: 1 }}>
                <div className="eyebrow">VERIFIED AUTHENTICITY</div>
                <h2 style={{ fontSize: 28, color: 'var(--navy)', fontWeight: 800, lineHeight: 1.2, marginBottom: 14 }}>Details You Can See Before You Bid</h2>
                <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 14 }}>
                  Every ATANY listing records the piece's karat/weight and the seller's own description of the item
                  before it ever reaches the auction floor. You always know what you are bidding on.
                </p>
                <div style={{ display: 'grid', gap: 10 }}>
                  {[
                    ['Karat & Weight Listed', 'The piece\'s karat/weight is recorded on every listing and shown on the auction card.'],
                    ['Seller Description', 'Each item carries the seller\'s description and category, reviewed before the lot goes live.'],
                    ['Live Bid History', 'Every bid is recorded server-side, so the current price and bid count are always accurate.'],
                  ].map(([title, desc]) => (
                    <div key={title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', marginTop: 6, flexShrink: 0 }} />
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>{title}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="how-section" id="how-it-works">
          <div className="container">
            <div className="center-heading"><h2>How It Works</h2></div>
            <div className="landing-steps" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 32 }}>
              {[
                ['Browse', 'Explore available jewelry and auctions from real ATANY sellers.'],
                ['Place Your Bid', 'Join a live auction and place a valid competitive bid above the minimum next bid.'],
                ['Win & Pay', 'When the auction ends, the highest eligible bidder becomes the current winner and has 7 days to complete payment. If payment is not completed in time, the opportunity may pass to the next highest eligible bidder.'],
                ['Claim at Branch', 'After payment is confirmed, collect your jewelry from your selected ATANY branch with the required identification and order details.'],
              ].map(([t, d], i) => (
                <div key={t} className="step">
                  <div className="step-number">{i + 1}</div>
                  <div><h3>{t}</h3><p>{d}</p></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="branch-section">
          <div className="container">
            <div className="branch-box">
              <div className="branch-map" aria-label="Branch map">
                {branchesLoading ? (
                  <div style={{ display: 'grid', placeItems: 'center', height: '100%', minHeight: 220, color: 'var(--muted)', fontSize: 13 }}>Loading branch map…</div>
                ) : branchesError ? (
                  <div style={{ display: 'grid', placeItems: 'center', height: '100%', minHeight: 220, color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 16 }}>
                    Branch information is temporarily unavailable.
                  </div>
                ) : featuredBranch ? (
                  <BranchMap
                    branches={[featuredBranch]}
                    selectedBranchId={featuredBranch.id}
                    initialCenter={[Number(featuredBranch.lat) || 7.07, Number(featuredBranch.lng) || 125.6]}
                    minHeight={330}
                    // Public page: the document owns the scroll, so the map
                    // must not swallow the mouse wheel.
                    scrollWheelZoom={false}
                  />
                ) : (
                  <div style={{ display: 'grid', placeItems: 'center', height: '100%', minHeight: 220, color: 'var(--muted)', fontSize: 13 }}>No branch to display.</div>
                )}
              </div>
              <div className="branch-content">
                <div className="eyebrow">CONVENIENT PICKUP</div>
                <h2>Find Your Nearest Branch</h2>
                <p>Won an auction? Your jewelry can be securely claimed at an ATANY branch convenient for you.</p>
                <div className="branch-info">
                  {branchesLoading ? (
                    <>
                      <div>&nbsp;</div><div>&nbsp;</div><div>&nbsp;</div>
                    </>
                  ) : branchesError ? (
                    <div>Branch information is temporarily unavailable.</div>
                  ) : featuredBranch ? (
                    <>
                      <div>⌖ <strong>{featuredBranch.name}</strong></div>
                      <div>◇ {featuredBranch.address}</div>
                      {featuredBranch.phone ? <div>☎ {featuredBranch.phone}</div> : null}
                      {featuredBranch.hours ? <div>◷ {featuredBranch.hours}</div> : null}
                    </>
                  ) : (
                    <div>No branch is currently open for pickup.</div>
                  )}
                </div>
                <Link className="btn btn-primary" to="/branches">Find a Branch</Link>
              </div>
            </div>
          </div>
        </section>

        <section id="contact">
          <div className="container" style={{ maxWidth: 960 }}>
            <div style={{ marginBottom: 32 }}>
              <div className="eyebrow">GET IN TOUCH</div>
              <h2 style={{ fontSize: 28, color: 'var(--navy)', fontWeight: 800, marginBottom: 6 }}>Contact Us</h2>
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Have a question about an auction, your account, or a pickup? We're here to help.</p>
            </div>
            <div className="landing-contact-grid" style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 36 }}>
              <div style={{ background: 'var(--ivory)', border: '1px solid var(--line)', borderRadius: 14, padding: '32px 28px' }}>
                {cSent ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
                    <h3 style={{ fontSize: 18, color: 'var(--navy)', fontWeight: 800, marginBottom: 6 }}>Support Request Sent</h3>
                    <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
                      We've received your message. ATANY Support will review your request.
                    </p>
                    {cReference ? (
                      <p style={{ fontSize: 13, color: 'var(--navy)', fontWeight: 700, marginBottom: 12 }}>
                        Reference: {cReference}
                      </p>
                    ) : null}
                    {!cMailSent ? (
                      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>
                        Your request was received. Email notification is temporarily delayed — you can also reach us
                        directly at <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--navy)', fontWeight: 700 }}>{SUPPORT_EMAIL}</a>.
                      </p>
                    ) : (
                      <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>
                        For urgent follow-up you can email{' '}
                        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--navy)', fontWeight: 700 }}>{SUPPORT_EMAIL}</a>.
                      </p>
                    )}
                    <button className="btn btn-outline" onClick={() => setCSent(false)}>Send Another Message</button>
                  </div>
                ) : (
                  <form onSubmit={handleContactSubmit}>
                    <div className="form-row"><label>Name *</label><input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Your full name" required /></div>
                    <div className="form-row"><label>Email *</label><input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="you@example.com" required /></div>
                    <div className="form-row"><label>Category</label>
                      <select value={cSubject} onChange={(e) => setCSubject(e.target.value)} aria-label="Category">
                        {SUPPORT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="form-row"><label>Message *</label><textarea value={cMessage} onChange={(e) => setCMessage(e.target.value)} placeholder="How can we help?" required rows={5} /></div>
                    <button type="submit" className="btn btn-primary" disabled={cBusy} style={{ width: '100%', minHeight: 46 }}>{cBusy ? 'Sending…' : 'Send Message'}</button>
                  </form>
                )}
              </div>
              <div>
                <div style={{ background: 'var(--ivory)', border: '1px solid var(--line)', borderRadius: 14, padding: '24px 22px', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, color: 'var(--navy)', fontWeight: 800, marginBottom: 14 }}>Email Us</h3>
                  <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
                    <div><strong style={{ color: 'var(--navy)' }}>Support:</strong>{' '}
                      <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12 }}>
                      The form on the left reaches the same ATANY Support inbox.
                    </div>
                  </div>
                </div>
                <div style={{ background: 'var(--ivory)', border: '1px solid var(--line)', borderRadius: 14, padding: '24px 22px', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, color: 'var(--navy)', fontWeight: 800, marginBottom: 14 }}>Visit a Branch</h3>
                  {branchesLoading ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Loading branches…</div>
                  ) : branchesError ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Branch information is temporarily unavailable.</div>
                  ) : contactBranches.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>No branch is currently open for pickup.</div>
                  ) : (
                    contactBranches.map((b) => (
                      <div key={b.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>{b.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                          {b.address}
                          {b.phone ? <><br />{b.phone}</> : null}
                          {b.hours ? <><br />{b.hours}</> : null}
                        </div>
                      </div>
                    ))
                  )}
                  <Link to="/branches" className="text-link">View All Branches →</Link>
                </div>
                <div style={{ background: 'var(--navy)', borderRadius: 14, padding: '22px 22px', color: '#fff' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Response Time</h3>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,.72)', lineHeight: 1.6 }}>Our team will review your message as soon as possible. For urgent bid or payout issues, visit your nearest ATANY branch with a valid ID.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="cta">
          <div className="container">
            <div className="cta-box">
              <div className="cta-title">
                <h2>{cta.title}</h2>
                <p>{cta.copy}</p>
              </div>
              <Link className="btn cta-action" to={cta.to}>
                {cta.label}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <div className="footer-main">
            <div className="footer-brand">
              <Link to="/" className="footer-logo">ATANY</Link>
              <p>The Philippines' premier jewelry auction platform. Discover, bid, and own timeless pieces with confidence.</p>
            </div>

            <nav className="footer-col" aria-label="Quick Links">
              <h3>Quick Links</h3>
              <a href="#auctions" onClick={scrollToSection('auctions')}>Live Auctions</a>
              <a href="#jewelry" onClick={scrollToSection('jewelry')}>Shop Jewelry</a>
              <a href="#how-it-works" onClick={scrollToSection('how-it-works')}>How It Works</a>
              <Link to="/branches">Find a Branch</Link>
            </nav>

            <nav className="footer-col" aria-label="Account">
              <h3>Account</h3>
              {accountLinks.map((l) => (
                l.action === 'signout' ? (
                  <button type="button" key={l.label} className="footer-link-btn" onClick={handleSignOut}>{l.label}</button>
                ) : (
                  <Link key={l.label} to={l.to}>{l.label}</Link>
                )
              ))}
            </nav>

            <nav className="footer-col" aria-label="Contact">
              <h3>Contact</h3>
              <a href={`mailto:${SUPPORT_EMAIL}`}><Mail size={15} aria-hidden="true" />{SUPPORT_EMAIL}</a>
              <Link to="/branches"><MapPin size={15} aria-hidden="true" />Branch locations</Link>
            </nav>
          </div>

          <div className="footer-bottom">
            <span>&copy; {YEAR} ATANY. All rights reserved.</span>
            <span>Pickup-only &middot; No delivery</span>
          </div>
        </div>
      </footer>

      {guestBidAuctionId && (
        <div className="modal-overlay show" onClick={(e) => (e.target === e.currentTarget ? setGuestBidAuctionId(null) : null)}>
          <div className="modal-box">
            <div className="modal-box-head">
              <h3>Want to join the bid?</h3>
            </div>
            <div className="modal-box-body">
              <p>Create an account or log in to view auctions and place your bid.</p>
            </div>
            <div className="modal-box-foot">
              <button className="btn btn-outline" onClick={() => setGuestBidAuctionId(null)}>Continue Browsing</button>
              <Link className="btn btn-primary" to={loginRedirect(auctionRoute(guestBidAuctionId))}>Login / Create Account</Link>
            </div>
          </div>
        </div>
      )}

      <AssistantWidget mode="customer" />
    </div>
  );
}
