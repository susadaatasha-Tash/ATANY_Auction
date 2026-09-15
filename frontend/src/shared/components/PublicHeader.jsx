// frontend/src/shared/components/PublicHeader.jsx
// Shared header for all public pages (Landing, Login, Signup, etc.).
// On the landing page, pass `landing` prop for scroll-spy hash links.
// On other pages, About/Contact navigate to /#about or /#contact and scroll.
import { Link, useLocation, useNavigate } from 'react-router-dom';

const NAV_ITEMS = [
  { label: 'Home', hash: '#home', route: '/' },
  { label: 'Auctions', hash: '#auctions', route: '/customer/live' },
  { label: 'Jewelry', hash: '#jewelry', route: '/customer/live' },
  { label: 'About', hash: '#about', route: '/#about' },
  { label: 'How It Works', hash: '#how-it-works', route: null },
  { label: 'Contact', hash: '#contact', route: '/#contact' },
];

export function PublicHeader({ landing = false }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isLanding = landing || pathname === '/';

  const handleNavClick = (item, e) => {
    if (isLanding && item.hash) {
      // On landing page: smooth-scroll to section
      e.preventDefault();
      const el = document.getElementById(item.hash.slice(1));
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (!isLanding && item.route && item.route.startsWith('/#')) {
      // On another page: navigate to landing + scroll to section
      e.preventDefault();
      navigate(item.route);
      // Scroll after navigation completes
      setTimeout(() => {
        const el = document.getElementById(item.hash);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    }
  };

  return (
    <header className="header">
      <div className="container nav">
        <Link to="/" className="brand"><span className="brand-name">ATANY</span></Link>
        <nav className="nav-links" id={isLanding ? 'navLinks' : undefined}>
          {NAV_ITEMS.map((item) => {
            if (isLanding && item.hash) {
              return <a key={item.label} href={item.hash} onClick={(e) => handleNavClick(item, e)}>{item.label}</a>;
            }
            if (item.route && !item.route.startsWith('/#')) {
              const active = pathname === item.route || (item.route !== '/' && pathname.startsWith(item.route));
              return (
                <Link key={item.label} to={item.route} style={active ? { color: 'var(--navy)', fontWeight: 700 } : undefined}>
                  {item.label}
                </Link>
              );
            }
            if (item.route && item.route.startsWith('/#')) {
              return <a key={item.label} href={item.route} onClick={(e) => handleNavClick(item, e)}>{item.label}</a>;
            }
            return null;
          })}
        </nav>
        <div className="nav-actions">
          <Link className="btn btn-outline" to="/login">Login</Link>
          <Link className="btn btn-primary" to="/signup">Sign Up</Link>
        </div>
      </div>
    </header>
  );
}
