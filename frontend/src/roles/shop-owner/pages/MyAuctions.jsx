// frontend/src/roles/shop-owner/pages/MyAuctions.jsx
// Shop owner runs their own auctions: create (item + auction together), and edit/cancel while scheduled with no bids.
// GET/POST/PUT/DELETE /shop-owner/auctions — admin only monitors these (view-only on their side).
import { useState, useEffect, useMemo } from 'react';
import { formatCountdown, useAuctionCountdown } from '../../../shared/hooks/useAuctionCountdown';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { CreateAuctionModal } from '../components/CreateAuctionModal';

function peso(n) { return '₱' + Number(n).toLocaleString(); }
function statusLabel(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function LiveEnds({ sec, status }) {
  const liveSec = useAuctionCountdown(sec);
  const text = status === 'scheduled' ? `Starts in ${formatCountdown(liveSec)}` : status === 'ended' ? 'Ended' : formatCountdown(liveSec);
  return <span>{text}</span>;
}
// Owner can edit/cancel only before the auction starts and before any bids (fair to bidders).
function isEditable(a) { return a.status === 'scheduled' && (a.bids ?? 0) === 0; }

export default function MyAuctions() {
  const [auctions, setAuctions] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const showToast = useToast();

  const fetchAuctions = async () => {
    try {
      const rows = await apiFetch('/shop-owner/auctions');
      setAuctions(Array.isArray(rows) ? rows : []);
    } catch {
      setAuctions([]);
    }
  };

  useEffect(() => { fetchAuctions(); }, []);

  const handleSave = async (data) => {
    try {
      if (editing?.id) {
        await apiFetch(`/shop-owner/auctions/${editing.id}`, { method: 'PUT', body: JSON.stringify(data) });
        showToast('Auction updated');
      } else {
        await apiFetch('/shop-owner/auctions', { method: 'POST', body: JSON.stringify(data) });
        showToast('Auction created');
      }
      setOpen(false);
      setEditing(null);
      await fetchAuctions();
    } catch (e) { showToast(e.message || 'Save failed'); }
  };

  const handleCancel = async (a) => {
    if (!confirm('Cancel this auction? The item and its auction will be removed. This only works before any bids.')) return;
    try {
      await apiFetch(`/shop-owner/auctions/${a.id}`, { method: 'DELETE' });
      showToast('Auction cancelled');
      await fetchAuctions();
    } catch (e) { showToast(e.message || 'Cancel failed'); }
  };

  const filtered = useMemo(() => (auctions || []).filter((a) => {
    const name = (a.item || a.name || '').toLowerCase();
    const id = (a.auction_code || a.id || '').toLowerCase();
    return (name.includes(q.toLowerCase()) || id.includes(q.toLowerCase())) && (!statusFilter || a.status === statusFilter);
  }), [auctions, q, statusFilter]);

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your auctions..." />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Status</option>
            <option value="live">Live</option>
            <option value="scheduled">Scheduled</option>
            <option value="ended">Ended</option>
          </select>
          <button className="btn btn-primary" onClick={() => { setEditing(null); setOpen(true); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14"/></svg>
            Create Auction
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Item</th><th>Starting Price</th><th>Current Bid</th><th>Bids</th><th>Ends</th><th>Status</th><th /></tr></thead>
          <tbody>{filtered.length ? filtered.map((a) => (
              <tr key={a.id}>
                <td><div className="cell-main">{a.item || a.name}</div><div className="cell-sub">{a.auction_code || a.id.slice(0,8)}</div></td>
                <td>{peso(a.startPrice ?? a.start_price)}</td>
                <td className="cell-main">{peso(a.currentBid ?? a.current_bid)}</td>
                <td>{a.bids ?? 0}</td>
                <td><LiveEnds sec={a.endsInSec} status={a.status} /></td>
                <td><span className={`badge ${a.status}`}>{statusLabel(a.status)}</span></td>
                <td>
                  {isEditable(a) ? (
                    <div className="row-actions">
                      <button className="btn-ghost" onClick={() => { setEditing(a); setOpen(true); }}>Edit</button>
                      <button className="btn-danger-ghost" onClick={() => handleCancel(a)}>Cancel</button>
                    </div>
                  ) : <span className="cell-sub">—</span>}
                </td>
              </tr>
            )) : <tr><td colSpan={7}><div className="empty-state"><p>No auctions match your filters.</p></div></td></tr>}</tbody>
        </table>
      </div>
      <div className="pager"><span>{filtered.length} auction{filtered.length===1?'':'s'}</span></div>
      <CreateAuctionModal open={open} onClose={() => { setOpen(false); setEditing(null); }} initial={editing} onSubmit={handleSave} />
    </div>
  );
}
