import { useNotifications } from '../../roles/customer/hooks/useNotifications';
import { useNavigate } from 'react-router-dom';

// ATANY refined bell - Option A: Classic outline (recommended)
// - 20x20 viewBox, stroke 1.6, navy #14301f, gold badge, hover circle
// Other options available in comments below:
// Option B: Rounded/friendly - same path with stroke 1.8 + slightly wider shoulders
// Option C: Minimalist line - stroke 1.4, no fill, extra-thin
const BellIcon = ({ variant = 'classic' }) => {
  const common = { fill: 'none', stroke: '#14301f', strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (variant === 'rounded') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...common} strokeWidth="1.8">
        <path d="M6.2 9a6 6 0 0 1 11.6 0c0 4.8 1.8 5.6 1.8 5.6H4.4s1.8-.8 1.8-5.6Z" />
        <path d="M10.2 19.5a2 2 0 0 0 3.6 0" />
      </svg>
    );
  }
  if (variant === 'minimal') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...common} strokeWidth="1.4">
        <path d="M7 9a5 5 0 0 1 10 0c0 4.5 2 5.5 2 5.5H5s2-1 2-5.5Z" />
        <path d="M11 19a1.5 1.5 0 0 0 2 0" />
      </svg>
    );
  }
  // classic (default)
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" {...common} strokeWidth="1.6">
      <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10.2 20a2 2 0 0 0 3.6 0" />
    </svg>
  );
};

export function NotificationBell({ to = '/customer/notifications', apiPath, variant = 'classic' }) {
  const { unread } = useNotifications(apiPath);
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      aria-label="Notifications"
      title={unread ? `${unread} unread notification${unread>1?'s':''}` : 'Notifications'}
      style={{
        position: 'relative',
        width: 38, height: 38,
        background: 'none',
        border: '1px solid transparent',
        borderRadius: '50%',
        display: 'grid', placeItems: 'center',
        cursor: 'pointer',
        color: '#14301f',
        transition: 'background .15s ease, border-color .15s ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#f3f1ec'; e.currentTarget.style.borderColor = '#e5e2da'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.borderColor = 'transparent'; }}
    >
      <BellIcon variant={variant} />
      {unread > 0 && (
        <span style={{
          position: 'absolute', top: 2, right: 2,
          background: '#c7a66a', color: '#14301f', borderRadius: 999,
          fontSize: 9, minWidth: 16, height: 16, display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: '0 4px', fontWeight: 800,
          border: '1.5px solid #fff', boxShadow: '0 1px 4px rgba(20,48,31,.15)'
        }}>
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}

// Preview helper for dev — renders 3 variants side-by-side
export function BellPreview() {
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', padding: 16, background: '#fffefa', border: '1px solid #e5e2da', borderRadius: 12 }}>
      <div style={{ textAlign: 'center' }}><NotificationBell variant="classic" /><div style={{ fontSize: 10, color: '#707782', marginTop: 6 }}>Classic outline<br/>(recommended)</div></div>
      <div style={{ textAlign: 'center' }}><NotificationBell variant="rounded" /><div style={{ fontSize: 10, color: '#707782', marginTop: 6 }}>Rounded/friendly</div></div>
      <div style={{ textAlign: 'center' }}><NotificationBell variant="minimal" /><div style={{ fontSize: 10, color: '#707782', marginTop: 6 }}>Minimalist line</div></div>
    </div>
  );
}
