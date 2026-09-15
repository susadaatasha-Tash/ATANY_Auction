// frontend/src/shared/components/Topbar.jsx
// Premium topbar — polished user chip, dropdown with settings/sign-out, notification integration
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu } from 'lucide-react';

const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const SettingsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const SignOutIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

export function Topbar({ title, subtitle, onMenuToggle, sidebarCollapsed, onSidebarToggle, user, onSignOut, rightExtra, settingsTo, branchName }) {
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
    <div className="topbar">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button className="menu-toggle" onClick={onMenuToggle} aria-label="Open navigation menu">☰</button>
        {onSidebarToggle && (
          <button className="sidebar-toggle" onClick={onSidebarToggle} aria-label="Toggle sidebar" title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
            <Menu size={18} />
          </button>
        )}
        <div className="topbar-title">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {branchName && (
          <span style={{ marginLeft: 12, padding: '3px 10px', borderRadius: 6, background: 'rgba(196,162,101,.1)', color: '#b8860b', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
            📍 {branchName}
          </span>
        )}
      </div>
      <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {rightExtra}
        <div className="user-menu-wrap" ref={wrapRef}>
          <div
            className="admin-chip user-menu-trigger"
            role="button"
            tabIndex={0}
            aria-haspopup="menu"
            aria-expanded={menuOpen ? 'true' : 'false'}
            onClick={() => setMenuOpen((v) => !v)}
            onKeyDown={(e) => e.key === 'Enter' && setMenuOpen((v) => !v)}
          >
            <div className="admin-avatar" aria-hidden="true">{user.initials}</div>
            <div>
              <div className="name">{user.name}</div>
              <div className="role">{user.role}</div>
            </div>
            <ChevronIcon />
          </div>
          {menuOpen && (
            <div className="user-dropdown open" role="menu">
              {settingsTo && (
                <button className="user-dropdown-item" role="menuitem" onClick={() => { setMenuOpen(false); navigate(settingsTo); }}>
                  <SettingsIcon /> Settings
                </button>
              )}
              <button className="user-dropdown-item danger" role="menuitem" onClick={() => { setMenuOpen(false); onSignOut?.(); }}>
                <SignOutIcon /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
