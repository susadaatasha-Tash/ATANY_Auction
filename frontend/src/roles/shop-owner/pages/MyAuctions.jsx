// frontend/src/roles/shop-owner/pages/MyAuctions.jsx
// Shop owner runs their own auctions: create (item + auction together), and edit/cancel while scheduled with no bids.
// GET/POST/PUT/DELETE /shop-owner/auctions — admin only monitors these (view-only on their side).
import { useState, useEffect, useMemo } from 'react';
import { formatCountdown } from '../../../shared/hooks/useAuctionCountdown';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { CreateAuctionModal } from '../components/CreateAuctionModal';

function peso(n) { return '₱' + Number(n).toLocaleString(); }
function statusLabel(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function effectiveStatus(startTime, endTime) {
  const now = new Date();
  const s = new Date(startTime);
  const e = new Date(endTime);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 'scheduled';
  if (now < s) return 'scheduled';
  if (now >= e) return 'ended';
  return 'live';
}
function LiveEnds({ auction }) {
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNowTick(Date.now()), 1000); return () => clearInterval(id); }, []);
  const startRaw = auction.startTime ?? auction.start_time;
  const endRaw = auction.endTime ?? auction.end_time;
  const hasTimes = !!(startRaw && endRaw && !isNaN(new Date(startRaw).getTime()) && !isNaN(new Date(endRaw).getTime()));
  const computedStatus = hasTimes ? effectiveStatus(startRaw, endRaw) : (auction.status || 'scheduled');
  const countdownSec = (() => {
    if (!hasTimes) {
      if (computedStatus === 'ended') return 0;
      if (computedStatus === 'live') return auction.endsInSec ?? 0;
      return auction.startsInSec ?? auction.endsInSec ?? 0;
    }
    const now = new Date(nowTick);
    if (computedStatus === 'ended') return 0;
    if (computedStatus === 'live') return Math.max(0, Math.floor((new Date(endRaw) - now) / 1000));
    return Math.max(0, Math.floor((new Date(startRaw) - now) / 1000));
  })();
  if (computedStatus === 'ended') return <span>Ended</span>;
  if (computedStatus === 'scheduled') return <span>Starts in {formatCountdown(countdownSec)}</span>;
  return <span>Ends in {formatCountdown(countdownSec)}</span>;
}
// Owner can edit/cancel only before the auction starts and before any bids (fair to bidders).
function isEditable(a) {
  const startRaw = a.startTime ?? a.start_time;
  const endRaw = a.endTime ?? a.end_time;
  const hasTimes = !!(startRaw && endRaw && !isNaN(new Date(startRaw).getTime()) && !isNaN(new Date(endRaw).getTime()));
  const st = hasTimes ? effectiveStatus(startRaw, endRaw) : a.status;
  return st === 'scheduled' && (a.bids ?? 0) === 0;
}

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
          <thead><tr><th>Item</th><th>Starting Price</th><th>Current Bid</th><th>Bids</th><th>Time</th><th>Status</th><th /></tr></thead>
          <tbody>{filtered.length ? filtered.map((a) => {
              const st = (() => {
                const sRaw = a.startTime ?? a.start_time;
                const eRaw = a.endTime ?? a.end_time;
                if (sRaw && eRaw && !isNaN(new Date(sRaw).getTime()) && !isNaN(new Date(eRaw).getTime())) return effectiveStatus(sRaw, eRaw);
                return a.status;
              })();
              return (
                <tr key={a.id}>
                  <td><div className="cell-main">{a.item || a.name}</div><div className="cell-sub">{a.auction_code || a.id.slice(0,8)}</div></td>
                  <td>{peso(a.startPrice ?? a.start_price)}</td>
                  <td className="cell-main">{peso(a.currentBid ?? a.current_bid)}</td>
                  <td>{a.bids ?? 0}</td>
                  <td><LiveEnds auction={a} /></td>
                  <td><span className={`badge ${st}`}>{statusLabel(st)}</span></td>
                  <td>
                    {isEditable(a) ? (
                      <div className="row-actions">
                        <button className="btn-ghost" onClick={() => { setEditing(a); setOpen(true); }}>Edit</button>
                        <button className="btn-danger-ghost" onClick={() => handleCancel(a)}>Cancel</button>
                      </div>
                    ) : <span className="cell-sub">—</span>}
                  </td>
                </tr>
              );
            }) : <tr><td colSpan={7}><div className="empty-state"><p>No auctions match your filters.</p></div></td></tr>}</tbody>
        </table>
      </div>
      <div className="pager"><span>{filtered.length} auction{filtered.length===1?'':'s'}</span></div>
      <CreateAuctionModal open={open} onClose={() => { setOpen(false); setEditing(null); }} initial={editing} onSubmit={handleSave} />
    </div>
  );
}
