// frontend/src/roles/admin/pages/Products.jsx
// Admin jewelry management — exact columns: Jewelry | Category | Karat | Weight | Branch | Seller | Price | Status | Actions
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { useRealtimeProducts } from '../../../shared/hooks/useRealtimeProducts';

function peso(n) { return '₱' + Number(n).toLocaleString(); }
function displayStatus(s, auctionStatus) {
  if (auctionStatus === 'live') return 'In Auction';
  if (auctionStatus === 'scheduled') return 'In Auction';
  if (s === 'pending') return 'Pending';
  if (s === 'approved') return 'Available';
  if (s === 'rejected') return 'Rejected';
  return s || '—';
}
function badgeClass(s, auctionStatus) {
  if (auctionStatus === 'live') return 'live';
  if (auctionStatus === 'scheduled') return 'scheduled';
  if (s === 'pending') return 'pending';
  if (s === 'approved') return 'active';
  if (s === 'rejected') return 'dismissed';
  return 'pending';
}

function parseKarat(kw) {
  if (!kw) return '—';
  const m = String(kw).match(/(\d+)\s*[kK]/);
  return m ? m[1] + 'K' : kw;
}
function parseWeight(kw) {
  if (!kw) return '—';
  const m = String(kw).match(/([\d.]+)\s*g/i);
  return m ? m[1] + ' g' : kw;
}

function ActionMenu({ product, onNavigate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const items = useMemo(() => {
    const base = [
      { label: 'View Details', action: () => onNavigate(`/admin/products/${product.id}`) },
    ];
    const hasAuction = !!product.auction_id;
    const isSold = product.computed_status === 'ended' && hasAuction;

    if (product.status === 'pending') {
      return [
        ...base,
        { label: 'View Seller', action: () => onNavigate(`/admin/products/${product.id}`) },
        { label: 'View Branch', action: () => onNavigate(`/admin/products/${product.id}`) },
      ];
    }
    if (hasAuction && product.auction_status === 'live') {
      return [
        ...base,
        { label: 'View Auction', action: () => onNavigate(`/admin/auctions/${product.auction_id}`) },
        { label: 'View Bids', action: () => onNavigate(`/admin/auctions/${product.auction_id}`) },
        { label: 'View Seller', action: () => onNavigate(`/admin/products/${product.id}`) },
        { label: 'View Branch', action: () => onNavigate(`/admin/products/${product.id}`) },
      ];
    }
    if (hasAuction && product.auction_status === 'scheduled') {
      return [
        ...base,
        { label: 'View Auction', action: () => onNavigate(`/admin/auctions/${product.auction_id}`) },
        { label: 'View Seller', action: () => onNavigate(`/admin/products/${product.id}`) },
        { label: 'View Branch', action: () => onNavigate(`/admin/products/${product.id}`) },
      ];
    }
    if (isSold) {
      return [
        ...base,
        { label: 'View Order', action: () => onNavigate(`/admin/products/${product.id}`) },
        { label: 'View Buyer', action: () => onNavigate(`/admin/products/${product.id}`) },
      ];
    }
    return [
      ...base,
      { label: 'View Seller', action: () => onNavigate(`/admin/products/${product.id}`) },
      { label: 'View Branch', action: () => onNavigate(`/admin/products/${product.id}`) },
      { label: 'Archive', action: () => {}, danger: true },
    ];
  }, [product, onNavigate]);

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

export default function Products({ products: propProducts }) {
  const [products, setProducts] = useState(propProducts || []);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [highlightId, setHighlightId] = useState(null);
  const highlightTimeout = useRef(null);
  const navigate = useNavigate();
  const showToast = useToast();

  const refresh = async () => {
    try { const rows = await apiFetch('/admin/products'); setProducts(rows); } catch (e) { showToast(e.message); }
  };
  useEffect(() => { if (propProducts && propProducts.length) setProducts(propProducts); else refresh(); }, [propProducts]);

  const triggerHighlight = (id) => {
    setHighlightId(id);
    clearTimeout(highlightTimeout.current);
    highlightTimeout.current = setTimeout(() => setHighlightId(null), 2500);
  };

  useRealtimeProducts({
    onInsert: (row) => {
      setProducts((prev) => { if (prev.some(p => p.id === row.id)) return prev; return [row, ...prev]; });
      triggerHighlight(row.id);
      showToast(`New item submitted: ${row.name}`);
    },
    onUpdate: (row) => {
      setProducts((prev) => prev.map(p => p.id === row.id ? { ...p, ...row } : p));
      triggerHighlight(row.id);
    },
    onDelete: (row) => setProducts((prev) => prev.filter(p => p.id !== row.id)),
  });

  const categories = useMemo(() => {
    const set = new Set(products.map(p => p.category).filter(Boolean));
    return [...set].sort();
  }, [products]);

  const filtered = useMemo(() => products.filter(p => {
    const name = (p.name || '').toLowerCase();
    const cat = (p.category || '').toLowerCase();
    const branch = (p.branch_name || '').toLowerCase();
    const seller = (p.seller_name || '').toLowerCase();
    const matchesQ = !q || name.includes(q.toLowerCase()) || cat.includes(q.toLowerCase()) || branch.includes(q.toLowerCase()) || seller.includes(q.toLowerCase());
    const matchesStatus = !statusFilter || (statusFilter === 'in_auction' ? (p.auction_status === 'live' || p.auction_status === 'scheduled') : p.status === statusFilter);
    const matchesCategory = !categoryFilter || p.category === categoryFilter;
    return matchesQ && matchesStatus && matchesCategory;
  }), [products, q, statusFilter, categoryFilter]);

  return (
    <>
      <div className="panel">
        <div className="toolbar">
          <div className="search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, category, branch, or seller..." />
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="in_auction">In Auction</option>
              <option value="rejected">Rejected</option>
            </select>
            <select className="filter-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Jewelry</th>
                <th>Category</th>
                <th>Karat</th>
                <th>Weight</th>
                <th>Branch</th>
                <th>Seller</th>
                <th>Price</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length ? filtered.map((p) => {
                const dStatus = displayStatus(p.status, p.auction_status);
                return (
                  <tr
                    key={p.id}
                    style={{
                      ...(highlightId === p.id ? { background: 'rgba(199,166,106,.12)', transition: 'background .3s ease' } : undefined),
                    }}
                  >
                    <td>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        {p.image_url && <img src={p.image_url} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }} onError={(e) => e.target.style.display = 'none'} />}
                        <div>
                          <div className="cell-main">{p.name}</div>
                          <div className="cell-sub">{p.id.slice(0, 8)}</div>
                        </div>
                      </div>
                    </td>
                    <td>{p.category || '—'}</td>
                    <td>{parseKarat(p.karat_weight)}</td>
                    <td>{parseWeight(p.karat_weight)}</td>
                    <td><div className="cell-main">{p.branch_name || '—'}</div><div className="cell-sub">{p.branch_address || ''}</div></td>
                    <td><div className="cell-main">{p.seller_name || '—'}</div><div className="cell-sub">{p.seller_email || ''}</div></td>
                    <td>{peso(p.price)}</td>
                    <td><span className={`badge ${badgeClass(p.status, p.auction_status)}`}>{dStatus}</span></td>
                    <td><ActionMenu product={p} onNavigate={navigate} /></td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={9}><div className="empty-state"><p>No jewelry items match your filters.</p></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pager"><span>{filtered.length} item{filtered.length === 1 ? '' : 's'}</span></div>
      </div>
    </>
  );
}
