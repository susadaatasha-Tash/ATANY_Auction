// frontend/src/roles/admin/pages/Auctions.jsx
// Admin auction monitor — exact columns: Jewelry | Branch | Starting Price | Current Bid | Bids | Participants | Start | End | Status | Actions
import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { formatCountdown, useAuctionCountdown } from '../../../shared/hooks/useAuctionCountdown';

function peso(n) { return '₱' + Number(n).toLocaleString(); }
function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '\n' + dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function displayStatus(s) {
  if (s === 'scheduled') return 'Upcoming';
  if (s === 'live') return 'Live';
  if (s === 'ended') return 'Completed';
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
}
function badgeClass(s) {
  if (s === 'live') return 'live';
  if (s === 'scheduled') return 'scheduled';
  if (s === 'ended') return 'ended';
  return 'pending';
}

function LiveEnds({ sec, status }) {
  const liveSec = useAuctionCountdown(sec);
  const text = status === 'scheduled' ? `Starts in ${formatCountdown(liveSec)}` : status === 'ended' ? 'Ended' : formatCountdown(liveSec);
  return <span>{text}</span>;
}

function ActionMenu({ auction, onNavigate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const items = useMemo(() => {
    const base = [
      { label: 'View Details', action: () => onNavigate(`/admin/auctions/${auction.id}`) },
    ];
    if (auction.status === 'live') {
      return [
        ...base,
        { label: 'View Bids', action: () => onNavigate(`/admin/auctions/${auction.id}`) },
        { label: 'View Jewelry', action: () => onNavigate(`/admin/products/${auction.productId}`) },
        { label: 'View Seller', action: () => onNavigate(`/admin/products/${auction.productId}`) },
        { label: 'View Branch', action: () => onNavigate(`/admin/auctions/${auction.id}`) },
        { divider: true },
        { label: 'Stop Auction', action: () => {}, danger: true },
      ];
    }
    if (auction.status === 'scheduled') {
      return [
        ...base,
        { label: 'Edit Auction', action: () => {} },
        { label: 'View Jewelry', action: () => onNavigate(`/admin/products/${auction.productId}`) },
        { label: 'View Seller', action: () => onNavigate(`/admin/products/${auction.productId}`) },
        { label: 'View Branch', action: () => onNavigate(`/admin/auctions/${auction.id}`) },
        { divider: true },
        { label: 'Cancel Auction', action: () => {}, danger: true },
      ];
    }
    if (auction.status === 'ended') {
      return [
        ...base,
        { label: 'View Winner', action: () => onNavigate(`/admin/auctions/${auction.id}`) },
        { label: 'View Bids', action: () => onNavigate(`/admin/auctions/${auction.id}`) },
        { label: 'View Jewelry', action: () => onNavigate(`/admin/products/${auction.productId}`) },
        { label: 'View Seller', action: () => onNavigate(`/admin/products/${auction.productId}`) },
        { label: 'View Branch', action: () => onNavigate(`/admin/auctions/${auction.id}`) },
      ];
    }
    return base;
  }, [auction, onNavigate]);

  return (
    <div className="admin-action-menu-wrap" ref={ref}>
      <button className="admin-action-trigger" onClick={() => setOpen(!open)} title="Actions">
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && (
        <div className="admin-action-dropdown">
          {items.map((item, i) => item.divider
            ? <div key={i} className="admin-action-divider" />
            : <button key={i} className={`admin-action-item ${item.danger ? 'danger' : ''}`} onClick={() => { item.action(); setOpen(false); }}>{item.label}</button>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminAuctions() {
  const [auctions, setAuctions] = useState([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const navigate = useNavigate();
  const showToast = useToast();

  const refresh = async () => {
    try {
      const aRows = await apiFetch('/admin/auctions?status=all');
      setAuctions(Array.isArray(aRows) ? aRows : []);
    } catch (e) { showToast(e.message || 'Failed to load auctions'); }
  };

  useEffect(() => { refresh(); }, []);

  const branches = useMemo(() => {
    const map = new Map();
    auctions.forEach(a => { if (a.branch_id && a.branch_name) map.set(a.branch_id, a.branch_name); });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [auctions]);

  const filtered = useMemo(() => auctions.filter(a => {
    const name = (a.name || '').toLowerCase();
    const code = (a.auction_code || '').toLowerCase();
    const branch = (a.branch_name || '').toLowerCase();
    const shop = (a.shop_name || '').toLowerCase();
    const matchesQ = !q || name.includes(q.toLowerCase()) || code.includes(q.toLowerCase()) || branch.includes(q.toLowerCase()) || shop.includes(q.toLowerCase());
    const matchesStatus = !statusFilter || a.status === statusFilter;
    const matchesBranch = !branchFilter || a.branch_id === branchFilter;
    return matchesQ && matchesStatus && matchesBranch;
  }), [auctions, q, statusFilter, branchFilter]);

  return (
    <>
      <div className="panel">
        <div className="toolbar">
          <div className="search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by jewelry, code, branch, or shop..." />
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              <option value="live">Live</option>
              <option value="scheduled">Upcoming</option>
              <option value="ended">Completed</option>
            </select>
            <select className="filter-select" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="">All Branches</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Jewelry</th>
                <th>Branch</th>
                <th>Starting Price</th>
                <th>Current Bid</th>
                <th>Bids</th>
                <th>Participants</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length ? filtered.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      {a.img && <img src={a.img} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} onError={(e) => e.target.style.display = 'none'} />}
                      <div>
                        <div className="cell-main">{a.name || 'Untitled'}</div>
                        <div className="cell-sub">{a.auction_code || a.id.slice(0, 8)}</div>
                      </div>
                    </div>
                  </td>
                  <td><div className="cell-main">{a.branch_name || '—'}</div><div className="cell-sub">{a.branch_address || ''}</div></td>
                  <td>{peso(a.startPrice ?? a.start_price)}</td>
                  <td className="cell-main">{(a.currentBid ?? a.current_bid) > 0 ? peso(a.currentBid ?? a.current_bid) : '—'}</td>
                  <td>{a.bids ?? 0}</td>
                  <td>{a.participants ?? 0}</td>
                  <td style={{ whiteSpace: 'pre-line', fontSize: 12 }}>{formatDate(a.startTime ?? a.start_time)}</td>
                  <td style={{ whiteSpace: 'pre-line', fontSize: 12 }}>{formatDate(a.endTime ?? a.end_time)}</td>
                  <td><span className={`badge ${badgeClass(a.status)}`}>{displayStatus(a.status)}</span></td>
                  <td><ActionMenu auction={a} onNavigate={navigate} /></td>
                </tr>
              )) : (
                <tr><td colSpan={10}><div className="empty-state"><p>No auctions match your filters.</p></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pager"><span>{filtered.length} auction{filtered.length === 1 ? '' : 's'}</span></div>
      </div>
    </>
  );
}
