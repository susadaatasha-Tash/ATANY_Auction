// frontend/src/pages/LandingPage.jsx
// Landing page — hero, stats, live auctions, jewelry, about, how-it-works, branches, CTA, footer
import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuctionCountdown, formatCountdown } from '../shared/hooks/useAuctionCountdown';
import { useToast } from '../shared/components/Toast';
import { AssistantWidget } from '../shared/components/AssistantWidget';
import { PublicHeader } from '../shared/components/PublicHeader';
import { BranchMap } from '../roles/customer/components/BranchMap';
import { apiFetch } from '../shared/lib/apiClient';
import { uploadSupportAttachment, validateSupportImage, SUPPORT_IMAGE_ACCEPT, SUPPORT_IMAGE_HINT } from '../shared/lib/supportAttachment';
import { useAuth } from '../shared/hooks/useAuth';
// Hero art: identical pixels to landing-page-background.png but ~27x smaller
// (1.78 MB -> 70 KB) via lossy WebP at q88. The PNG is kept in the repo as the
// untouched source; it is simply no longer shipped to visitors.
import landingPageBackground from '../assests/landing-page-background.webp';
import { ArrowRight, Mail, MapPin } from 'lucide-react';

// Verification-section image. The previous Unsplash id (photo-1586878341523…)
// returns HTTP 404, which is why the page was rendering its alt text instead of
// a photo. This id is verified to return 200 and is not reused by any other card.
const verificationImage = 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=600&q=80';

// ATANY contact addresses.
//
// GENERAL/SUPPORT now resolve to the real, monitored destination mailbox that
// receives every Contact Us and Customer Help & Support notification
// (backend SUPPORT_RECIPIENT_EMAIL). The previous hello@atany.ph /
// support@atany.ph pair sat on a domain that was never verified with the mail
// provider, so no notification was ever reliably deliverable to them.
// Partnerships is a distinct business channel and is unchanged.
const CONTACT_GENERAL_EMAIL = 'goldjewelryauction@gmail.com';
const CONTACT_SUPPORT_EMAIL = 'goldjewelryauction@gmail.com';
const CONTACT_PARTNERSHIPS_EMAIL = 'partnerships@atany.ph';

// Single, explicit data model for the footer Contact column.
//
// Two fixes land here at once:
//  1. Keys are stable semantic IDs, never the address. Addresses can legitimately
//     be shared (General and Support resolve to the same mailbox), so keying on
//     the value is what produced the duplicate-key warning.
//  2. General + Support are consolidated into ONE row instead of rendering the
//     same Gmail twice. `mailto` is preserved; the backend recipient is
//     unaffected (SUPPORT_RECIPIENT_EMAIL is the single source of truth there).
const FOOTER_CONTACT_LINKS = [
  {
    id: 'general-support-email',
    label: 'General & Support',
    href: `mailto:${CONTACT_GENERAL_EMAIL}`,
    email: CONTACT_GENERAL_EMAIL,
    Icon: Mail,
  },
  {
    id: 'branch-locations',
    label: 'Branch locations',
    href: '/branches',
    Icon: MapPin,
  },
];

// Public Contact → "Email Us" panel. Same rule: unique IDs, and the shared
// General/Support mailbox is shown once rather than duplicated.
const CONTACT_EMAIL_ROWS = [
  {
    id: 'general-support',
    label: 'General & Support:',
    email: CONTACT_GENERAL_EMAIL,
  },
  {
    id: 'partnerships',
    label: 'Partnerships:',
    email: CONTACT_PARTNERSHIPS_EMAIL,
  },
];

function Countdown({ initial }) {
  const sec = useAuctionCountdown(initial);
  return <span className="timer">{sec <= 0 ? 'Auction ended' : formatCountdown(sec)}</span>;
}

export default function LandingPage() {
  const showToast = useToast();
  const { hash } = useLocation();
  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cSubject, setCSubject] = useState('General Inquiry');
  const [cMessage, setCMessage] = useState('');
  const [cBusy, setCBusy] = useState(false);
  const [cSent, setCSent] = useState(false);
  const [cAttachment, setCAttachment] = useState(null);   // { file, path, name }
  const [cAttachmentError, setCAttachmentError] = useState(null);
  const navigate = useNavigate();
  // role/status drive the bid CTA: only an ACTIVE customer may bid, and never
  // from this page — the real bidding UI is reused.
  const { user, role, status } = useAuth();
  const suspended = status === 'suspended';
  const [liveAuctions, setLiveAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [guestBidAuctionId, setGuestBidAuctionId] = useState(null);

  // Real platform statistics (was four hardcoded marketing numbers).
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);

  // Real branches — same `branches` table Admin manages at /admin/branches.
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState(false);

  /**
   * CTA destination.
   *
   * Follows the same post-auth role routing Login.jsx already applies (role ->
   * its own portal), so a signed-in visitor is never pushed back to a signup
   * form they no longer need. A suspended customer stays governed by the
   * suspension page — the CTA must never route around it.
   */
  const ctaPath = !user
    ? '/signup'
    : suspended
      ? '/account-suspended'
      : role === 'admin'
        ? '/admin'
        : role === 'shop_owner'
          ? '/shop'
          : '/customer';

  /** The one auction page this platform actually has. Used for every redirect. */
  const auctionPath = (id) => `/customer/auctions${id ? `?auction=${encodeURIComponent(id)}` : ''}`;
  const loginPath = (next) => `/login?redirect=${encodeURIComponent(next)}`;

  /** Validate immediately, then upload to private storage and keep the path. */
  const handleAttachmentPick = async (e) => {
    const file = e.target.files?.[0] || null;
    setCAttachmentError(null);
    if (!file) { setCAttachment(null); return; }
    const invalid = validateSupportImage(file);
    if (invalid) {
      setCAttachment(null);
      setCAttachmentError(invalid);
      e.target.value = '';
      return;
    }
    try {
      const path = await uploadSupportAttachment(file, { authenticated: false });
      setCAttachment({ file, path, name: file.name });
    } catch (err) {
      setCAttachment(null);
      setCAttachmentError(err?.message || 'We could not upload your image. Please try again.');
      e.target.value = '';
    }
  };

  const handleContactSubmit = async (e) => {
    e.preventDefault();
    if (!cName.trim() || !cEmail.trim() || !cMessage.trim()) {
      showToast('Please fill in all required fields');
      return;
    }
    setCBusy(true);
    try {
      // Upload first (best effort): if the image cannot be stored we still send
      // the message rather than losing it, and the attachment is simply absent.
      let attachmentPath = null;
      if (cAttachment?.file) {
        try {
          attachmentPath = await uploadSupportAttachment(cAttachment.file, { authenticated: false });
        } catch (uploadErr) {
          setCAttachmentError(uploadErr?.message || 'We could not attach your image.');
        }
      }
      // Routed through the backend so the request is validated and rate-limited;
      // the support_requests row remains the authoritative record.
      await apiFetch('/api/public/contact', {
        method: 'POST',
        public: true,
        body: JSON.stringify({
          name: cName.trim(),
          email: cEmail.trim().toLowerCase(),
          subject: cSubject,
          message: cMessage.trim(),
          ...(attachmentPath ? { attachment_path: attachmentPath } : {}),
        }),
      });
      setCSent(true);
      showToast('Your message has been submitted successfully.');
      setCName(''); setCEmail(''); setCSubject('General Inquiry'); setCMessage('');
      setCAttachment(null); setCAttachmentError(null);
    } catch (err) {
      showToast(err?.message || 'Something went wrong — please try again or email us directly');
    } finally {
      setCBusy(false);
    }
  };

  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 100);
    }
    // One scroll-spy, applied immediately on mount so "Home" is highlighted
    // before the visitor ever scrolls, and kept in sync afterwards.
    const syncActive = () => {
      const sections = document.querySelectorAll('main section[id]');
      const links = document.querySelectorAll('.nav-links a');
      let cur = 'home';
      sections.forEach((s) => { if (window.scrollY >= s.offsetTop - 120) cur = s.id; });
      links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + cur));
    };
    syncActive();
    window.addEventListener('scroll', syncActive, { passive: true });
    window.addEventListener('resize', syncActive);
    return () => {
      window.removeEventListener('scroll', syncActive);
      window.removeEventListener('resize', syncActive);
    };
  }, [hash]);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/public/stats', { public: true })
      .then((d) => { if (!cancelled) setStats(d); })
      .catch(() => { if (!cancelled) setStatsError(true); })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/branches', { public: true })
      .then((rows) => { if (!cancelled) setBranches(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setBranchesError(true); })
      .finally(() => { if (!cancelled) setBranchesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Deterministic featured branch: first OPEN branch in the server's order.
  // Never randomised, and never a hardcoded branch.
  const featuredBranch = useMemo(
    () => branches.find((b) => String(b.status).toLowerCase() === 'open') || branches[0] || null,
    [branches]
  );

  // Contact panel: up to 3 open branches, in the same server order.
  const contactBranches = useMemo(
    () => (branches.filter((b) => String(b.status).toLowerCase() === 'open').length
      ? branches.filter((b) => String(b.status).toLowerCase() === 'open')
      : branches
    ).slice(0, 3),
    [branches]
  );

  useEffect(() => {
    async function fetchLiveAuctions() {
      setLoading(true);
      setError(null);
      try {
        const rows = await apiFetch('/api/auctions/live', { public: true });
        setLiveAuctions(rows);
      } catch (e) {
        setError('Unable to load live auctions.');
        setLiveAuctions([]);
      } finally {
        setLoading(false);
      }
    }
    fetchLiveAuctions();
  }, []);

  /**
   * Place Bid from a landing card.
   * guest          -> existing login-required modal, redirecting back to THIS auction
   * active customer-> straight to the real auction page (no duplicate bid logic here)
   * suspended      -> the suspension guard owns the outcome
   * seller/admin   -> bidding is a customer-only capability
   */
  const handlePlaceBid = (a) => {
    const target = auctionPath(a.id);
    if (!user) { setGuestBidAuctionId(a.id); return; }
    if (suspended) { showToast('Your account is suspended and cannot place bids.'); return; }
    if (role !== 'customer') {
      showToast('Bids are placed with a customer account.');
      return;
    }
    navigate(target);
  };

  return (
    <div className="public-page">
      <PublicHeader landing />

      <main>
        <section className="hero" id="home" style={{ backgroundImage: `url(${landingPageBackground})` }}>
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
            {/* Real counts from GET /api/public/stats. No invented totals: a
                failed request renders an em dash rather than a fake number. */}
            {[
              ['registeredCustomers', 'Registered Customers'],
              ['jewelryPieces', 'Jewelry Pieces'],
              ['completedAuctions', 'Completed Auctions'],
              ['branches', 'ATANY Branches'],
            ].map(([key, label]) => (
              <div key={key} className="stat">
                <div>
                  <div className="stat-number">
                    {statsLoading
                      ? <span className="stat-skeleton" aria-hidden="true" />
                      : statsError || stats?.[key] === undefined
                        ? '\u2014'
                        : Number(stats[key]).toLocaleString()}
                  </div>
                  <div className="stat-label">{label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <section id="auctions">
          <div className="container">
            <div className="section-heading">
              <div><h2>Featured Auctions</h2><p>Bid before time runs out — server decides winner.</p></div>
              {/* ATANY has no public auction catalogue — Customer Auctions is the
                  real one and it requires an account, so guests are sent to log in
                  and returned here afterwards. */}
              <Link to={user ? auctionPath() : loginPath('/customer/auctions')} className="text-link">View all auctions →</Link>
            </div>
            <div className="auction-grid">
              {loading ? (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px 0' }}>Loading auctions...</div>
              ) : error ? (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>Unable to load live auctions.</div>
              ) : liveAuctions.length === 0 ? (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>No live auctions at the moment.</div>
              ) : liveAuctions.map((a) => {
                const isLive = a.status === 'live';
                return (
                  <article key={a.id} className="auction-card">
                    <div className="card-image">
                      <img src={a.img} alt={a.name} />
                      {isLive && (
                        <span className="live-tag"><span className="live-dot" />LIVE</span>
                      )}
                    </div>
                    <div className="card-body">
                      <h3 className="card-title">{a.name}</h3>
                      <div className="live-meta">
                        <span>{a.shop_name || 'Shop'}</span>
                        <span>{a.branch_name || ''}</span>
                      </div>
                      <div className="price">Current bid: {a.currentBid ? `₱${a.currentBid.toLocaleString()}` : 'Starting'}</div>
                      {/* Minimum next bid is computed ONLY from the server's own
                          current bid + the auction's minimum_bid_increment, which
                          is the exact rule the backend enforces. */}
                      {isLive && a.currentBid ? (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                          Min next bid: ₱{(Number(a.currentBid) + Number(a.minimum_bid_increment || 1000)).toLocaleString()}
                        </div>
                      ) : null}
                      {a.karat_weight && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>✦ {a.karat_weight}</div>}
                      <div className="starting"><div>{isLive ? 'Ends in' : 'Starts in'}</div>
                        {isLive
                          ? (a.endsInSec !== undefined ? <Countdown initial={a.endsInSec} /> : <span>Unknown</span>)
                          : (a.startsInSec !== undefined ? <Countdown initial={a.startsInSec} /> : <span>—</span>)}
                      </div>
                      <div className="bid-box" onClick={(e) => e.stopPropagation()}>
                        {isLive ? (
                          <button className="btn btn-primary" onClick={() => handlePlaceBid(a)}>Place Bid</button>
                        ) : (
                          <button className="btn btn-outline" onClick={() => navigate(auctionPath(a.id))}>View Auction</button>
                        )}
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
              <Link to={user ? auctionPath() : loginPath('/customer/auctions')} className="text-link">Browse All Auctions →</Link>
            </div>
            <div className="jewelry-grid">
              {[
                { name: 'Rings', img: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=400&q=80' },
                { name: 'Necklaces', img: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=400&q=80' },
                { name: 'Bracelets', img: 'https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=400&q=80' },
                { name: 'Earrings', img: 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=400&q=80' },
                { name: 'Watches', img: 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=400&q=80' },
              ].map((cat) => (
                <Link
                  key={cat.name}
                  to={user
                    ? `/customer/auctions?category=${encodeURIComponent(cat.name)}`
                    : loginPath(`/customer/auctions?category=${encodeURIComponent(cat.name)}`)}
                  className="collection-card"
                >
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
                <img src={verificationImage} alt="Jewelry being inspected before it is listed" style={{ width: '100%', height: 320, objectFit: 'cover' }} />
              </div>
              <div style={{ order: 1 }}>
                <div className="eyebrow">VERIFIED LISTINGS</div>
                <h2 style={{ fontSize: 28, color: 'var(--navy)', fontWeight: 800, lineHeight: 1.2, marginBottom: 14 }}>Know What You Are Bidding On</h2>
                <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 14 }}>
                  Every piece listed on ATANY is reviewed before it reaches the auction floor, and its
                  karat and weight are recorded on the listing so you can see exactly what you are bidding on.
                </p>
                <div style={{ display: 'grid', gap: 10 }}>
                  {/* Wording describes what the platform actually holds on every
                      listing (karat + weight) rather than promising certificate
                      records or condition grades the database does not store. */}
                  {[
                    ['Karat & Weight Recorded', 'Each listing shows the piece\u2019s stated karat and gram weight before you bid.'],
                    ['Pre-Listing Review', 'A listing must be approved before it can go live, so incomplete items are not auctioned.'],
                    ['Branch Inspection at Pickup', 'Collect in person at an ATANY branch, where you can inspect the piece before completing pickup.'],
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
                ['Browse', 'Explore the jewelry currently listed for auction and follow the pieces you like.'],
                ['Place Your Bid', 'When an auction is live, bid any amount above the current bid plus the stated minimum increment.'],
                ['Win & Pay Within 7 Days', 'When an auction ends, the highest eligible bidder becomes the winner and has 7 days to complete payment. If payment is not completed in time, the opportunity may pass to the next highest eligible bidder with a fresh 7-day window.'],
                ['Claim at Branch', 'After payment is confirmed and your order is prepared, collect your piece at your selected ATANY branch with valid ID and your order number.'],
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
              {/* Real map of the featured branch's ACTUAL coordinates. Same
                  Leaflet/OpenStreetMap stack already used by /branches — the
                  previous decorative divs are gone, so nothing here pretends to
                  be interactive. */}
              <div className="branch-map" aria-label={featuredBranch ? `Map showing ${featuredBranch.name}` : 'Branch map'}>
                {featuredBranch && Number.isFinite(Number(featuredBranch.lat)) && Number.isFinite(Number(featuredBranch.lng)) ? (
                  <BranchMap
                    branches={[featuredBranch]}
                    initialCenter={[Number(featuredBranch.lat), Number(featuredBranch.lng)]}
                  />
                ) : (
                  <div className="branch-map__placeholder" aria-hidden="true">
                    <span>Map preview unavailable</span>
                  </div>
                )}
              </div>
              <div className="branch-content">
                <div className="eyebrow">CONVENIENT PICKUP</div>
                <h2>Find Your Nearest Branch</h2>
                <p>Won an auction? Your jewelry can be securely claimed at an ATANY branch convenient for you.</p>
                {branchesLoading ? (
                  <div className="branch-info" aria-busy="true">
                    <div className="branch-skeleton" />
                  </div>
                ) : branchesError || !featuredBranch ? (
                  <div className="branch-info">
                    <div>Branch information is temporarily unavailable.</div>
                  </div>
                ) : (
                  <div className="branch-info">
                    <div>⌖ <strong>{featuredBranch.name}</strong></div>
                    {featuredBranch.address ? <div>◇ {featuredBranch.address}</div> : null}
                    {featuredBranch.hours ? <div>◷ {featuredBranch.hours}</div> : null}
                    {featuredBranch.phone ? <div>☎ {featuredBranch.phone}</div> : null}
                  </div>
                )}
                {/* Public route: visitors must never be pushed into a
                    customer-only page just to see where ATANY is. */}
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
                    <h3 style={{ fontSize: 18, color: 'var(--navy)', fontWeight: 800, marginBottom: 6 }}>Message Received</h3>
                    <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>Thanks for reaching out. Your message has been submitted successfully. Our team will review it as soon as possible.</p>
                    <button className="btn btn-outline" onClick={() => setCSent(false)}>Send Another Message</button>
                  </div>
                ) : (
                  <form onSubmit={handleContactSubmit}>
                    <div className="form-row"><label>Name *</label><input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Your full name" required /></div>
                    <div className="form-row"><label>Email *</label><input type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="you@example.com" required /></div>
                    <div className="form-row"><label>Subject</label>
                      <select value={cSubject} onChange={(e) => setCSubject(e.target.value)}>
                        <option>General Inquiry</option><option>Bid Support</option><option>Payout Question</option><option>Account Issue</option><option>Partnership</option>
                      </select>
                    </div>
                    <div className="form-row"><label>Message *</label><textarea value={cMessage} onChange={(e) => setCMessage(e.target.value)} placeholder="How can we help?" required rows={5} /></div>
                    <div className="form-row">
                      <label htmlFor="cf-attachment">Attach Image (optional)</label>
                      <input
                        id="cf-attachment"
                        type="file"
                        accept={SUPPORT_IMAGE_ACCEPT}
                        onChange={handleAttachmentPick}
                        style={{ fontSize: 12 }}
                      />
                      {cAttachmentError
                        ? <span className="field-error">{cAttachmentError}</span>
                        : cAttachment
                          ? <span className="field-hint">Attached: {cAttachment.name}</span>
                          : <span className="field-hint">{SUPPORT_IMAGE_HINT}</span>}
                    </div>
                    <button type="submit" className="btn btn-primary" disabled={cBusy} style={{ width: '100%', minHeight: 46 }}>{cBusy ? 'Sending…' : 'Send Message'}</button>
                  </form>
                )}
              </div>
              <div>
                <div style={{ background: 'var(--ivory)', border: '1px solid var(--line)', borderRadius: 14, padding: '24px 22px', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, color: 'var(--navy)', fontWeight: 800, marginBottom: 14 }}>Email Us</h3>
                  <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
                    {CONTACT_EMAIL_ROWS.map(({ id, label, email }) => (
                      <div key={id}>
                        <strong style={{ color: 'var(--navy)' }}>{label}</strong>{' '}
                        <a href={`mailto:${email}`} style={{ color: 'var(--navy)' }}>{email}</a>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ background: 'var(--ivory)', border: '1px solid var(--line)', borderRadius: 14, padding: '24px 22px', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, color: 'var(--navy)', fontWeight: 800, marginBottom: 14 }}>Visit a Branch</h3>
                  {/* REAL branches from the Admin-managed `branches` table. The
                      previous hardcoded Cebu / Manila entries did not exist in
                      the database and were removed. */}
                  {branchesLoading ? (
                    <div className="branch-skeleton" aria-busy="true" />
                  ) : branchesError ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Branch information is temporarily unavailable.</div>
                  ) : contactBranches.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>No branches are listed yet.</div>
                  ) : contactBranches.map((b) => (
                    <div key={b.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>{b.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                        {b.address ? <>{b.address}<br /></> : null}
                        {[b.phone, b.hours].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  ))}
                  <Link to="/branches" className="text-link">View All Branches →</Link>
                </div>
                <div style={{ background: 'var(--navy)', borderRadius: 14, padding: '22px 22px', color: '#fff' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Response Time</h3>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,.72)', lineHeight: 1.6 }}>Our team reviews every message as soon as possible. For urgent bid or payout matters, you can also raise it in person at your nearest ATANY branch.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="cta">
          <div className="container">
            <div className="cta-box">
              <div className="cta-title">
                <h2>Join ATANY Today</h2>
                <p>Create an account and start your journey to owning timeless beauty.</p>
              </div>
              <Link className="cta-btn" to={ctaPath}>
                Get Started Now
                <ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" />
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

            {/* Quick Links point at the REAL landing sections through the
                existing hash-scroll behaviour (/#section), never at invented
                routes such as /jewelry. */}
            <nav className="footer-col" aria-label="Quick links">
              <h3>Quick Links</h3>
              <ul className="footer-list">
                <li><Link to="/#auctions">Live Auctions</Link></li>
                <li><Link to="/#jewelry">Shop Jewelry</Link></li>
                <li><Link to="/#how-it-works">How It Works</Link></li>
                <li><Link to="/branches">Find a Branch</Link></li>
              </ul>
            </nav>

            {/* Static by design, matching PublicHeader's Login / Sign Up pair.
                /login and /signup keep their own guards, so an already
                signed-in visitor is forwarded by Login rather than looping. */}
            <nav className="footer-col" aria-label="Account">
              <h3>Account</h3>
              <ul className="footer-list">
                <li><Link to="/login">Sign In</Link></li>
                <li><Link to="/signup">Create Account</Link></li>
              </ul>
            </nav>

            <div className="footer-col">
              <h3>Contact</h3>
              <ul className="footer-list">
                {FOOTER_CONTACT_LINKS.map(({ id, label, href, Icon }) => (
                  <li key={id}>
                    {href.startsWith('mailto:') ? (
                      <a href={href}>
                        <Icon size={15} aria-hidden="true" />
                        <span>{id === 'general-support-email' ? CONTACT_GENERAL_EMAIL : label}</span>
                      </a>
                    ) : (
                      <Link to={href}>
                        <Icon size={15} aria-hidden="true" />
                        <span>{label}</span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="footer-bottom">
            <span>&copy; {new Date().getFullYear()} ATANY. All rights reserved.</span>
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
              <Link className="btn btn-primary" to={loginPath(auctionPath(guestBidAuctionId))}>Login / Create Account</Link>
            </div>
          </div>
        </div>
      )}

      <AssistantWidget mode="customer" />
    </div>
  );
}
