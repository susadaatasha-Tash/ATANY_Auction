// frontend/src/pages/LandingPage.jsx
// Landing page — hero, stats, live auctions, jewelry, about, how-it-works, branches, CTA, footer
import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuctionCountdown, formatCountdown } from '../shared/hooks/useAuctionCountdown';
import { useToast } from '../shared/components/Toast';
import { AssistantWidget } from '../shared/components/AssistantWidget';
import { PublicHeader } from '../shared/components/PublicHeader';
import { supabase } from '../shared/lib/supabaseClient';
import { apiFetch } from '../shared/lib/apiClient';
import { useAuth } from '../shared/hooks/useAuth';
import landingPageBackground from '../assests/landing-page-background.png';

function Countdown({ initial }) {
  const sec = useAuctionCountdown(initial);
  return <span className="timer">{sec <= 0 ? 'Auction ended' : formatCountdown(sec)}</span>;
}

export default function LandingPage() {
  const showToast = useToast();
  const { hash } = useLocation();
  const [bidItem, setBidItem] = useState(null);
  const [amount, setAmount] = useState('');
  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cSubject, setCSubject] = useState('General Inquiry');
  const [cMessage, setCMessage] = useState('');
  const [cBusy, setCBusy] = useState(false);
  const [cSent, setCSent] = useState(false);
  const { user } = useAuth();
  const [liveAuctions, setLiveAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [guestBidAuctionId, setGuestBidAuctionId] = useState(null);

  const handleContactSubmit = async (e) => {
    e.preventDefault();
    if (!cName.trim() || !cEmail.trim() || !cMessage.trim()) {
      showToast('Please fill in all required fields');
      return;
    }
    setCBusy(true);
    const { error } = await supabase.from('support_requests').insert({
      name: cName.trim(), email: cEmail.trim().toLowerCase(), subject: cSubject, message: cMessage.trim(),
    });
    setCBusy(false);
    if (error) {
      showToast('Something went wrong — please try again or email us directly');
      return;
    }
    setCSent(true);
    showToast('Message sent — we\'ll get back to you within 1 business day');
    setCName(''); setCEmail(''); setCSubject('General Inquiry'); setCMessage('');
  };

  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 100);
    }
    const onScroll = () => {
      const sections = document.querySelectorAll('main section[id]');
      const links = document.querySelectorAll('.nav-links a');
      let cur = 'home';
      sections.forEach((s) => { if (window.scrollY >= s.offsetTop - 120) cur = s.id; });
      links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + cur));
    };
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, [hash]);

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
            {[
              ['2,450+', 'Happy Customers'],
              ['1,250+', 'Jewelry Pieces'],
              ['320+', 'Live Auctions'],
              ['98%', 'Satisfaction Rate'],
            ].map(([n, l]) => (
              <div key={l} className="stat"><div><div className="stat-number">{n}</div><div className="stat-label">{l}</div></div></div>
            ))}
          </div>
        </div>

        <section id="auctions">
          <div className="container">
            <div className="section-heading">
              <div><h2>Featured Auctions</h2><p>Bid before time runs out — server decides winner.</p></div>
              <Link to="/customer/auctions" className="text-link">View all auctions →</Link>
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
                      {a.karat_weight && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>✦ {a.karat_weight}</div>}
                      <div className="starting"><div>Ends in</div>{a.endsInSec !== undefined ? <Countdown initial={a.endsInSec} /> : <span>Unknown</span>}</div>
                      <div className="bid-box" onClick={(e) => e.stopPropagation()}>
                        {user ? (
                          <button className="btn btn-primary" onClick={() => setBidItem(a)}>Place Bid</button>
                        ) : (
                          <button className="btn btn-outline" onClick={() => setGuestBidAuctionId(a.id)}>Place Bid</button>
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
              <Link to="/customer/auctions" className="text-link">View All Jewelry →</Link>
            </div>
            <div className="jewelry-grid">
              {[
                { name: 'Rings', img: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=400&q=80' },
                { name: 'Necklaces', img: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=400&q=80' },
                { name: 'Bracelets', img: 'https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=400&q=80' },
                { name: 'Earrings', img: 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=400&q=80' },
                { name: 'Watches', img: 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=400&q=80' },
              ].map((cat) => (
                <Link key={cat.name} to={`/customer/auctions?category=${cat.name}`} className="collection-card">
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
                <img src="https://images.unsplash.com/photo-1586878341523-7c8e5f1b1f4e?auto=format&fit=crop&w=600&q=80" alt="Karat certification" style={{ width: '100%', height: 320, objectFit: 'cover' }} />
              </div>
              <div style={{ order: 1 }}>
                <div className="eyebrow">VERIFIED AUTHENTICITY</div>
                <h2 style={{ fontSize: 28, color: 'var(--navy)', fontWeight: 800, lineHeight: 1.2, marginBottom: 14 }}>Every Piece Certified</h2>
                <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 14 }}>
                  Every ATANY piece is professionally inspected and comes with a karat and weight certificate.
                  Our verification process ensures you know exactly what you're bidding on.
                </p>
                <div style={{ display: 'grid', gap: 10 }}>
                  {[
                    ['Karat Certification', 'Verified gold purity — 14K, 18K, 22K, or 24K confirmed by weight analysis.'],
                    ['Weight Documentation', 'Precise gram weight recorded for every piece, visible on the listing card.'],
                    ['Condition Grading', 'Each item graded for condition so you know exactly what to expect at pickup.'],
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
                ['Browse', 'Explore exquisite jewelry and discover pieces you love.'],
                ['Place Your Bid', 'Join a live auction and place your best competitive bid.'],
                ['Win', 'Highest bidder when auction ends wins — decided server-side by cron.'],
                ['Claim at Branch', 'Pickup-only — bring ID + order number to your selected ATANY branch.'],
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
                <div className="road" />
                <div className="road two" />
                <div className="pin" />
              </div>
              <div className="branch-content">
                <div className="eyebrow">CONVENIENT PICKUP</div>
                <h2>Find Your Nearest Branch</h2>
                <p>Won an auction? Your jewelry can be securely claimed at an ATANY branch convenient for you.</p>
                <div className="branch-info">
                  <div>⌖ <strong>Davao City Branch</strong></div>
                  <div>◇ Victoria Plaza Area, Davao City</div>
                  <div>◷ Mon–Sat · 9:00 AM – 6:00 PM</div>
                </div>
                <Link className="btn btn-primary" to="/customer/branches">Find a Branch</Link>
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
                    <h3 style={{ fontSize: 18, color: 'var(--navy)', fontWeight: 800, marginBottom: 6 }}>Message Sent</h3>
                    <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>Thanks for reaching out. We'll respond within 1 business day.</p>
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
                    <button type="submit" className="btn btn-primary" disabled={cBusy} style={{ width: '100%', minHeight: 46 }}>{cBusy ? 'Sending…' : 'Send Message'}</button>
                  </form>
                )}
              </div>
              <div>
                <div style={{ background: 'var(--ivory)', border: '1px solid var(--line)', borderRadius: 14, padding: '24px 22px', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, color: 'var(--navy)', fontWeight: 800, marginBottom: 14 }}>Email Us</h3>
                  <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7 }}>
                    <div><strong style={{ color: 'var(--navy)' }}>General:</strong> hello@atany.ph</div>
                    <div><strong style={{ color: 'var(--navy)' }}>Support:</strong> support@atany.ph</div>
                    <div><strong style={{ color: 'var(--navy)' }}>Partnerships:</strong> partnerships@atany.ph</div>
                  </div>
                </div>
                <div style={{ background: 'var(--ivory)', border: '1px solid var(--line)', borderRadius: 14, padding: '24px 22px', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, color: 'var(--navy)', fontWeight: 800, marginBottom: 14 }}>Visit a Branch</h3>
                  {[
                    { name: 'Davao City', addr: 'Victoria Plaza Area, Davao City', phone: '(082) 123-4567', hours: 'Mon–Sat · 9AM–6PM' },
                    { name: 'Cebu', addr: 'Ayala Center, Cebu City', phone: '(032) 234-5678', hours: 'Mon–Sat · 10AM–7PM' },
                    { name: 'Manila', addr: 'Greenbelt 5, Makati City', phone: '(02) 8888-1234', hours: 'Daily · 10AM–8PM' },
                  ].map((b) => (
                    <div key={b.name} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>{b.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>{b.addr}<br />{b.phone} · {b.hours}</div>
                    </div>
                  ))}
                  <Link to="/branches" className="text-link">View All Branches →</Link>
                </div>
                <div style={{ background: 'var(--navy)', borderRadius: 14, padding: '22px 22px', color: '#fff' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Response Time</h3>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,.72)', lineHeight: 1.6 }}>We aim to respond within 1 business day. For urgent bid or payout issues, visit your nearest ATANY branch with a valid ID.</p>
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
              <Link className="btn" to="/signup">Get Started Now</Link>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="container">
          <div className="footer-main">
            <div className="footer-brand">
              <Link to="/" style={{ fontSize: 20, fontWeight: 800, color: 'var(--navy)' }}>ATANY</Link>
              <p>The Philippines' premier jewelry auction platform. Discover, bid, and own timeless pieces with confidence.</p>
            </div>
            <div><h3>Quick Links</h3><a href="#auctions">Live Auctions</a><a href="#jewelry">Shop Jewelry</a><a href="#how-it-works">How It Works</a><Link to="/branches">Find a Branch</Link></div>
            <div><h3>Account</h3><Link to="/login">Sign In</Link><Link to="/signup">Create Account</Link></div>
            <div><h3>Contact</h3><a href="mailto:hello@atany.ph">hello@atany.ph</a><a href="mailto:support@atany.ph">support@atany.ph</a><a>Davao City, Philippines</a></div>
          </div>
          <div className="footer-bottom">
            <span>&copy; 2026 ATANY. All rights reserved.</span>
            <span>Pickup-only &middot; No delivery</span>
          </div>
        </div>
      </footer>

      {bidItem && (
        <div className="modal-overlay show" onClick={(e) => e.target === e.currentTarget && setBidItem(null)}>
          <div className="modal-box">
            <div className="modal-box-head"><h3>Place Your Bid</h3><button className="modal-close" onClick={() => setBidItem(null)}>×</button></div>
            <div className="modal-box-body">
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>{bidItem.title || bidItem.name} · Current bid: {bidItem.price || (bidItem.currentBid ? `₱${Number(bidItem.currentBid).toLocaleString()}` : '—')}</p>
              <div className="form-row"><label>Your Bid Amount</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter amount" /></div>
              <p style={{ fontSize: 10, color: 'var(--muted)' }}>Min increment ₱1,000 enforced server-side. Public landing bids require login — you'll be redirected.</p>
            </div>
            <div className="modal-box-foot">
              <button className="btn btn-outline" onClick={() => setBidItem(null)}>Cancel</button>
              <Link className="btn btn-primary" to="/login" onClick={() => { showToast('Please sign in to place a bid.'); setBidItem(null); }}>Sign In to Bid</Link>
            </div>
          </div>
        </div>
      )}

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
              <Link className="btn btn-primary" to={`/login?redirect=/auction/${guestBidAuctionId}`}>Login / Create Account</Link>
            </div>
          </div>
        </div>
      )}

      <AssistantWidget mode="customer" />
    </div>
  );
}
