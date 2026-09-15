// frontend/src/roles/admin/pages/AuditLogs.jsx
// System audit logs viewer — GET /admin/audit-logs with pagination & filters
import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';

const ACTION_TYPES = [
  'login', 'logout', 'user_updated', 'user_status_toggled',
  'seller_application_submitted', 'seller_application_approved', 'seller_application_rejected',
  'auction_created', 'bid_placed', 'order_status_changed'
];

const ENTITY_TYPES = ['user', 'seller_application', 'auction', 'bid', 'order'];

const LIMIT = 20;

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatAction(action) {
  if (!action) return '—';
  return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function DetailsCell({ details }) {
  if (!details) return <span style={{ color: 'var(--muted, #999)' }}>—</span>;
  let parsed = details;
  if (typeof details === 'string') {
    try { parsed = JSON.parse(details); } catch { return <span style={{ fontSize: 12, wordBreak: 'break-all' }}>{details}</span>; }
  }
  return (
    <details style={{ cursor: 'pointer', fontSize: 12, maxWidth: 280 }}>
      <summary style={{ color: 'var(--accent, #b8860b)', userSelect: 'none' }}>View</summary>
      <pre style={{
        margin: '4px 0 0', padding: 8, borderRadius: 6,
        background: 'var(--panel-bg, #f9f6f0)', border: '1px solid var(--border, #e8e0d0)',
        fontSize: 11, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap',
        fontFamily: 'ui-monospace, monospace', lineHeight: 1.4
      }}>
        {JSON.stringify(parsed, null, 2)}
      </pre>
    </details>
  );
}

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const showToast = useToast();

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (actionFilter) params.set('action', actionFilter);
      if (entityFilter) params.set('entity_type', entityFilter);
      const data = await apiFetch(`/admin/audit-logs?${params}`);
      setLogs(Array.isArray(data.logs) ? data.logs : Array.isArray(data) ? data : []);
      setTotalPages(data.totalPages || data.total_pages || 1);
      setTotal(data.total || 0);
    } catch (e) {
      showToast(e.message || 'Failed to load audit logs');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, entityFilter, showToast]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => { setPage(1); }, [actionFilter, entityFilter]);

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>Audit Logs</h2>
          <p>System activity and security audit trail</p>
        </div>
      </div>

      <div className="toolbar">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <select
            className="filter-select"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value="">All Actions</option>
            {ACTION_TYPES.map(a => (
              <option key={a} value={a}>{formatAction(a)}</option>
            ))}
          </select>
          <select
            className="filter-select"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
          >
            <option value="">All Entities</option>
            {ENTITY_TYPES.map(e => (
              <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted, #999)' }}>Loading audit logs...</div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <p>No audit logs found.</p>
          {(actionFilter || entityFilter) && (
            <button className="btn-ghost" onClick={() => { setActionFilter(''); setEntityFilter(''); }}>
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
                <th>Date/Time</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={log.id || i}>
                  <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {log.user_email || log.user_id?.slice(0, 8) || '—'}
                  </td>
                  <td>
                    <span className="badge" style={{
                      textTransform: 'capitalize',
                      background: log.action?.includes('approved') ? 'var(--success-bg, #e6f9e6)'
                        : log.action?.includes('rejected') || log.action?.includes('toggled') ? 'var(--warn-bg, #fff8e1)'
                        : 'var(--panel-bg, #f9f6f0)',
                      color: log.action?.includes('approved') ? 'var(--success, #2e7d32)'
                        : log.action?.includes('rejected') || log.action?.includes('toggled') ? 'var(--warn, #e65100)'
                        : 'inherit'
                    }}>
                      {formatAction(log.action)}
                    </span>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{log.entity_type || '—'}</td>
                  <td><DetailsCell details={log.details} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(log.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="pager">
          <button
            className="btn-ghost"
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span style={{ margin: '0 12px', fontSize: 13, color: 'var(--muted, #666)' }}>
            Page {page} of {totalPages} ({total} total)
          </span>
          <button
            className="btn-ghost"
            disabled={page >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
