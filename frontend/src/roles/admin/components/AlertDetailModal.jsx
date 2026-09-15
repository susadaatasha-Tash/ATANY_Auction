// frontend/src/roles/admin/components/AlertDetailModal.jsx
// admin.html:1313-1322 alertModal + 1516-1568 — pixel-close to legacy, wired to real data
import { Modal } from '../../../shared/components/Modal';

export function AlertDetailModal({ alert, open, onClose, onDismiss, onResolve, onSuspend }) {
  if (!open || !alert) return null;
  const isOpen = alert.status === 'new' || alert.status === 'investigating';
  const severityLabel = alert.severity ? `${alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)} Severity` : '';
  const statusLabel = alert.status ? alert.status.charAt(0).toUpperCase() + alert.status.slice(1) : '';
  return (
    <Modal open={open} onClose={onClose} title="Alert Details"
      footer={isOpen ? (
        <><button className="btn btn-outline" onClick={() => onDismiss(alert.id)}>Dismiss</button><button className="btn btn-outline" onClick={() => onResolve(alert.id)}>Mark Resolved</button><button className="btn btn-primary" style={{ background: 'var(--danger)' }} onClick={() => onSuspend(alert.id)}>Suspend Customer</button></>
      ) : <button className="btn btn-outline" onClick={onClose}>Close</button>}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          {alert.severity && <span className={`badge ${alert.severity}`}>{severityLabel}</span>}
          {alert.status && <span className={`badge ${alert.status}`}>{statusLabel}</span>}
        </div>
        <p style={{ fontSize: 13, color: 'var(--navy)', fontWeight: 700, marginBottom: 4 }}>{alert.type}</p>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Customer: <b style={{ color: 'var(--text)' }}>{alert.customer}</b> · Detected {alert.time}</p>
        <p style={{ fontSize: 12.5, margin: '12px 0', lineHeight: 1.5 }}>{alert.detail}</p>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: 'var(--navy)', textTransform: 'uppercase', marginBottom: 8 }}>Activity Trail</div>
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', background: 'var(--soft)' }}>
          {(alert.trail && alert.trail.length ? alert.trail : [alert.detail]).map((t, i) => <div key={i} style={{ fontSize: 11.5, color: 'var(--text)', padding: '4px 0' }}>{t}</div>)}
        </div>
      </div>
    </Modal>
  );
}
