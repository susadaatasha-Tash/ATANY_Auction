// frontend/src/shared/components/Sidebar.jsx
// Premium jewelry marketplace sidebar — gem brand, section dividers, polished nav
import { NavLink } from 'react-router-dom';
import { LogOut } from 'lucide-react';

const GemIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3h12l4 6-10 13L2 9z" />
    <path d="M2 9h20" />
    <path d="M10 3l-4 6 6 13" />
    <path d="M14 3l4 6-6 13" />
  </svg>
);

export function Sidebar({ brand, tag, sections, open, onClose, onSignOut }) {
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Primary navigation">
      <div className="sidebar-brand">
        <span className="brand-icon"><GemIcon /></span>
        <div>
          <span className="brand-name">{brand}</span>
          <span className="brand-tag">{tag}</span>
        </div>
      </div>
      <nav className="sidebar-nav">
        {sections.map((sec, si) => (
          <div key={sec.label}>
            {si > 0 && <div style={{ height: 1, background: 'var(--line)', margin: '4px 12px 0' }} />}
            <div className="nav-section-label">{sec.label}</div>
            {sec.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={onClose}
              >
                {item.icon}
                <span className="nav-label">{item.name}</span>
                {item.badge != null && <span className="nav-badge">{item.badge}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      {onSignOut && (
        <div className="sidebar-foot">
          <button type="button" onClick={onSignOut} className="nav-item" style={{ width: '100%', justifyContent: 'flex-start' }}>
            <LogOut size={16} />
            <span className="nav-label">Sign Out</span>
          </button>
        </div>
      )}
    </aside>
  );
}
