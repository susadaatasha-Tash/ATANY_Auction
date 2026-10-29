// frontend/src/shared/components/Drawer.jsx
// Right-side drawer used by the admin branch-centric monitoring screens
// (Jewelry details + Auction monitor). Built on the same accessibility contract
// as shared/components/Modal.jsx: Escape to close, focus moved in on open,
// focus restored on close, background scroll locked, backdrop click to dismiss.
//
// There was no drawer primitive in the project before this — this is the single
// shared implementation both admin drawers use (no duplicated overlay logic).
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export function Drawer({ open, onClose, labelledBy, width, className = '', children, footer }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    panelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose?.(); return; }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <aside
        ref={panelRef}
        tabIndex={-1}
        className={`drawer-panel${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={width ? { width } : undefined}
      >
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Close panel">
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </aside>
    </div>
  );
}

export default Drawer;