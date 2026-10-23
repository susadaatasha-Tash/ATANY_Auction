// frontend/src/shared/components/Sidebar.jsx
// Premium jewelry marketplace sidebar — gem brand, section dividers, polished nav.
// Shared by Admin, Shop Owner and Customer portals.
//
// Collapsed behavior (desktop icon rail):
//   EXPANDED  = icon + label
//   COLLAPSED = icon only (labels + section headings hidden, icons remain
//               visible, clickable, centered and active-highlighted)
//   The hamburger toggles expanded <-> collapsed; the navigation is NEVER
//   removed or hidden to display:none on desktop.
import { NavLink, useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';

const GemIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3h12l4 6-10 13L2 9z" />
    <path d="M2 9h20" />
    <path d="M10 3l-4 6 6 13" />
    <path d="M14 3l4 6-6 13" />
  </svg>
);

/** Resolve whether a nav item is active for the current pathname.
    Supports exact match (end), explicit matchPrefixes (nested routes), and
    the default prefix match so a parent route stays highlighted while a
    child route is open. */
function isItemActive(pathname, item) {
  if (item.end) return pathname === item.to;
  if (item.matchPrefixes && item.matchPrefixes.length) {
    return item.matchPrefixes.some(
      (p) => pathname === p || pathname.startsWith(p + '/')
    );
  }
  return pathname === item.to || pathname.startsWith(item.to + '/');
}

export function Sidebar({
  brand,
  tag,
  sections,
  open,
  onClose,
  onSignOut,
  extra,
  collapsed = false,
}) {
  const { pathname } = useLocation();

  return (
    <aside
      className={`sidebar ${open ? 'open' : ''}${collapsed ? ' collapsed' : ''}`}
      aria-label="Primary navigation"
    >
      <div className="sidebar-brand">
        <span className="brand-icon"><GemIcon /></span>
        {!collapsed && (
          <div>
            <span className="brand-name">{brand}</span>
            <span className="brand-tag">{tag}</span>
          </div>
        )}
      </div>
      <nav className="sidebar-nav">
        {sections.map((sec, si) => (
          <div key={sec.label}>
            {!collapsed && (
              <>
                {si > 0 && (
                  <div
                    style={{ height: 1, background: 'var(--line)', margin: '4px 12px 0' }}
                  />
                )}
                <div className="nav-section-label">{sec.label}</div>
              </>
            )}
            {sec.items.map((item) => {
              const active = isItemActive(pathname, item);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive: _nlActive }) =>
                    `nav-item ${active ? 'active' : ''}`
                  }
                  onClick={onClose}
                  // Tooltip + accessible name remain while collapsed (labels
                  // are visually hidden but the name is still discoverable).
                  title={collapsed ? item.name : undefined}
                  aria-label={item.name}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.icon}
                  <span className="nav-label">{item.name}</span>
                  {item.badge != null && <span className="nav-badge">{item.badge}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
      {extra && <div className="sdash-sidebar-foot">{extra}</div>}
      {onSignOut && (
        <div className="sidebar-foot" style={{ padding: '8px 12px 14px' }}>
          <button
            type="button"
            onClick={onSignOut}
            className="nav-item"
            style={{ width: '100%', justifyContent: 'flex-start' }}
            title={collapsed ? 'Sign Out' : undefined}
            aria-label="Sign Out"
          >
            <LogOut size={15} />
            <span className="nav-label">Sign Out</span>
          </button>
        </div>
      )}
    </aside>
  );
}
