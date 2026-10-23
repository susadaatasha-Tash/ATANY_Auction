// frontend/src/shared/components/PortalPageHeader.jsx
// Shared flat page header for Customer, Seller, and Admin portals.
// Integrated into page background — not a floating card.
// Title-only: eyebrow/portal labels and page subtitles are removed globally.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, User } from 'lucide-react';
import './portal-page-header.css';

const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/**
 * Flat portal page header.
 * search: optional React node (form/input)
 * actions: optional controls (branch switch, live pill, notification, etc.)
 * user: { initials, name, role } — renders profile chip + dropdown
 */
export function PortalPageHeader({
  title,
  eyebrow,
  subtitle,
  search,
  actions,
  user,
  settingsTo,
  onMenuToggle,
  sidebarCollapsed,
  onSidebarToggle,
  role,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <header
      className={`portal-page-header topbar portal-page-header--compact${role ? ` portal-page-header--${role}` : ''}`}
    >
      <div className="portal-page-header__left">
        {onMenuToggle && (
          <button
            className="menu-toggle portal-page-header__menu"
            onClick={onMenuToggle}
            aria-label="Open navigation menu"
          >
            <Menu size={18} />
          </button>
        )}
        {onSidebarToggle && (
          <button
            className="sidebar-toggle portal-page-header__collapse"
            onClick={onSidebarToggle}
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            <Menu size={18} />
          </button>
        )}
        <div className={`portal-page-header__titles${subtitle ? ' portal-page-header__titles--stacked' : ''}`}>
          {eyebrow && <span className="portal-page-header__eyebrow">{eyebrow}</span>}
          <h1 className="portal-page-header__title">{title}</h1>
          {subtitle && <span className="portal-page-header__subtitle">{subtitle}</span>}
        </div>
      </div>

      {search && (
        <div className="portal-page-header__search">{search}</div>
      )}

      <div className="portal-page-header__right">
        {actions}
        {user && (
          <div className="user-menu-wrap" ref={wrapRef}>
            <div
              className="admin-chip user-menu-trigger portal-page-header__profile"
              role="button"
              tabIndex={0}
              aria-haspopup="menu"
              aria-expanded={menuOpen ? 'true' : 'false'}
              onClick={() => setMenuOpen((v) => !v)}
              onKeyDown={(e) => e.key === 'Enter' && setMenuOpen((v) => !v)}
            >
              <div className="admin-avatar" aria-hidden="true">{user.initials}</div>
              <div className="portal-page-header__profile-text">
                <div className="name profile-name">{user.name}</div>
                <div className="role profile-branch">{user.role}</div>
              </div>
              <ChevronIcon />
            </div>
            {menuOpen && settingsTo && (
              <div className="user-dropdown open" role="menu">
                <button
                  className="user-dropdown-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate(settingsTo);
                  }}
                >
                  <User size={14} /> Profile
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

export default PortalPageHeader;
