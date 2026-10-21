// frontend/src/shared/components/Modal.jsx
// Replaces .modal-overlay / .modal-box patterns from
// admin.html:438, customer-dashboard.html:176, atany-landing-page.html:795
// QA b: ARIA + focus trap + Escape + aria-modal per a11y audit
import React, { useEffect, useRef } from 'react';

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  subtitle,
  headerIcon,
  size,
  children,
  footer,
  className,
}) {
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    boxRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'Tab' && boxRef.current) {
        const focusable = boxRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus(); };
  }, [open, onClose]);

  if (!open) return null;
  const wide = size === 'wide';
  return (
    <div className="modal-overlay show" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={boxRef}
        tabIndex={-1}
        className={`modal-box${wide ? ' modal-box--wide' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
      >
        {(title || headerIcon || subtitle) && (
          <div className={`modal-box-head${headerIcon ? ' modal-box-head--with-icon' : ''}`}>
            {headerIcon && <span className="modal-box-head__icon" aria-hidden="true">{headerIcon}</span>}
            <div className="modal-box-head__text">
              {eyebrow && <span className="modal-box-eyebrow">{eyebrow}</span>}
              <h3 id="modal-title">{title}</h3>
              {subtitle && <p className="modal-box-subtitle">{subtitle}</p>}
            </div>
            <button className="modal-close" onClick={onClose} aria-label="Close dialog">×</button>
          </div>
        )}
        <div className="modal-box-body">{children}</div>
        {footer && <div className="modal-box-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmModal({ open, onClose, title, body, onConfirm, confirmLabel = 'Confirm', danger = false }) {
  if (!open) return null;
  return (
    <div className="modal-overlay show" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal-box" style={{ width: 'min(380px,100%)' }} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal-box-body confirm-box">
          <h3 id="confirm-title" style={{ color: 'var(--navy)', fontSize: 15 }}>{title}</h3>
          <p>{body}</p>
        </div>
        <div className="modal-box-foot">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            style={danger ? { background: 'var(--danger)' } : undefined}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
