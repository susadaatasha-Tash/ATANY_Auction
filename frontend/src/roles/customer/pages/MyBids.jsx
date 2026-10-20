// frontend/src/roles/customer/pages/MyBids.jsx
import { useState, useEffect } from 'react';
import { Badge } from '../../../shared/components/Badge';
import { formatCountdown } from '../../../shared/hooks/useAuctionCountdown';
import { apiFetch } from '../../../shared/lib/apiClient';

function peso(n) { const num = Number(n); if (!Number.isFinite(num)) return '₱—'; return '₱' + num.toLocaleString(); }

export default function MyBids() {
  const [bids, setBids] = useState([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try { setError(null); setLoading(true); const rows = await apiFetch('/customer/bids'); setBids(Array.isArray(rows) ? rows : []); } catch (e) { console.error('MyBids fetch failed', e); setError(e.message || 'Failed to load bids'); setBids([]); } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  const filtered = (bids || []).filter((b) => {
    const name = (b.item || '').toLowerCase();
    return name.includes(q.toLowerCase()) && (!statusFilter || b.status === statusFilter);
  });

  if (loading) return <div className="panel"><div className="empty-state"><p>Loading your bids…</p></div></div>;
  if (error) return <div className="panel"><div className="empty-state" style={{ color: 'var(--danger)' }}><p>Error loading bids: {error}</p><button className="btn btn-outline" onClick={refresh} style={{ marginTop: 8 }}>Retry</button></div></div>;

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="search-box"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your bids…" /></div>
        <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="winning">Winning</option>
          <option value="outbid">Outbid</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Item</th><th>Your Bid</th><th>Current Bid</th><th>Bids</th><th>Ends</th><th>Status</th></tr></thead>
          <tbody>
            {filtered.length ? filtered.map((b) => (
              <tr key={b.id}>
                <td className="cell-main">{b.item}</td>
                <td>{peso(b.yourBid)}</td>
                <td className="cell-main">{peso(b.currentBid)}</td>
                <td>{b.bidsCount}</td>
                <td>{formatCountdown(b.endsInSec)}</td>
                <td><Badge status={b.status} />{b.flagged && <span className="badge medium">Under Review</span>}</td>
              </tr>
            )) : <tr><td colSpan={6}><div className="empty-state"><p>No bids yet — place a bid on a live auction to see it here.</p></div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
