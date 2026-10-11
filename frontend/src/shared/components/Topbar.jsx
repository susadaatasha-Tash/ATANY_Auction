// frontend/src/shared/components/Topbar.jsx
// Thin wrapper around shared flat PortalPageHeader (kept for layout import stability).
import { PortalPageHeader } from './PortalPageHeader';

export function Topbar({
  title,
  eyebrow,
  search,
  actions,
  role,
  onMenuToggle,
  sidebarCollapsed,
  onSidebarToggle,
  user,
  rightExtra,
  branchName,
  settingsTo,
}) {
  const resolvedActions = actions ?? (
    <>
      {branchName && (
        <span
          className="topbar-branch"
          style={{
            marginLeft: 0,
            padding: '4px 10px',
            borderRadius: 999,
            background: 'rgba(200,155,60,.1)',
            color: '#8A6A1F',
            fontSize: 11,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {branchName}
        </span>
      )}
      {rightExtra}
    </>
  );

  return (
    <PortalPageHeader
      title={title}
      eyebrow={eyebrow}
      search={search}
      actions={resolvedActions}
      user={user}
      settingsTo={settingsTo}
      onMenuToggle={onMenuToggle}
      sidebarCollapsed={sidebarCollapsed}
      onSidebarToggle={onSidebarToggle}
      role={role}
    />
  );
}

export default Topbar;
