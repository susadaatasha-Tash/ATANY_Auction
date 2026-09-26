// frontend/src/shared/components/Topbar.jsx
// Premium topbar — polished user chip, notification integration
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, User } from 'lucide-react';

const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export function Topbar({ title, subtitle, onMenuToggle, sidebarCollapsed, onSidebarToggle, user, rightExtra, branchName, settingsTo }) {
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
      <div className="topbar-left" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
        <button className="menu-toggle" onClick={onMenuToggle} aria-label="Open navigation menu">☰</button>
        {onSidebarToggle && (
          <button className="sidebar-toggle" onClick={onSidebarToggle} aria-label="Toggle sidebar" title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
            <Menu size={18} />
          </button>
        )}
        <div className="topbar-title" style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center' }}>
          <h1 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>{title}</h1>
        </div>
        {branchName && (
          <span className="topbar-branch" style={{ marginLeft: 12, padding: '3px 10px', borderRadius: 6, background: 'rgba(196,162,101,.1)', color: '#b8860b', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
            📍 {branchName}
          </span>
        )}
      </div>
      <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, minWidth: 0 }}>
        {rightExtra}
        <div className="user-menu-wrap" ref={wrapRef} style={{ flexShrink: 0 }}>
          <div
            className="admin-chip user-menu-trigger"
            role="button"
            tabIndex={0}
            aria-haspopup="menu"
            aria-expanded={menuOpen ? 'true' : 'false'}
            onClick={() => setMenuOpen((v) => !v)}
            onKeyDown={(e) => e.key === 'Enter' && setMenuOpen((v) => !v)}
            style={{ minWidth: 0, flexShrink: 0 }}
          >
            <div className="admin-avatar" aria-hidden="true" style={{ flexShrink: 0 }}>{user.initials}</div>
            <div style={{ minWidth: 0, overflow: 'hidden' }}>
              <div className="name profile-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{user.name}</div>
              <div className="role profile-branch" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{user.role}</div>
            </div>
            <ChevronIcon />
          </div>
          {menuOpen && settingsTo && (
            <div className="user-dropdown open" role="menu">
              <button className="user-dropdown-item" role="menuitem" onClick={() => { setMenuOpen(false); navigate(settingsTo); }}>
                <User size={14} /> Profile
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
