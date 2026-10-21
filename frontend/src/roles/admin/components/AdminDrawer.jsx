// frontend/src/roles/admin/components/AdminDrawer.jsx
// Right-side read-only drawer used by the Admin branch monitoring screens.
// Desktop: ~40% of the viewport. Mobile: near full width.
// The background content is blurred/dimmed, the header and the footer stay
// fixed while the body scrolls.
import { useEffect } from 'react';
import { X } from 'lucide-react';

export function AdminDrawer({ open, onClose, label, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="adm-drawer-overlay"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="adm-drawer" role="dialog" aria-modal="true" aria-label={label}>
        <button type="button" className="adm-drawer__close" onClick={onClose} aria-label="Close panel">
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}

export default AdminDrawer;
