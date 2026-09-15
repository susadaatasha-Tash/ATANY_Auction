// frontend/src/roles/admin/pages/Dashboard.jsx
// Admin dashboard — multi-branch focused (simplified scope)
import { useEffect, useState } from 'react';
import { KpiCard } from '../../../shared/ui/Card';
import { ActivityText } from '../../../shared/components/SafeHtml';
import { useAdminData } from '../hooks/useAdminData';
import { apiFetch } from '../../../shared/lib/apiClient';

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(dateStr).toLocaleDateString();
}

const BranchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path d="M3 9h6" /><path d="M3 15h6" />
  </svg>
);

const ShopIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l1-5h16l1 5" /><path d="M3 9h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z" /><path d="M12 11v6" /><path d="M8 11v6" /><path d="M16 11v6" />
  </svg>
);

const UsersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const RevenueIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

export default function AdminDashboard() {
  const { users, txns, branches, refresh, loadAnalytics } = useAdminData();
  const [sellerApps, setSellerApps] = useState([]);

  useEffect(() => {
    refresh(); loadAnalytics();
    apiFetch('/admin/seller-applications').then(d => setSellerApps(Array.isArray(d) ? d : [])).catch(() => {});
    const interval = setInterval(() => {
      refresh();
      apiFetch('/admin/seller-applications').then(d => setSellerApps(Array.isArray(d) ? d : [])).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [refresh, loadAnalytics]);

  const totalBranches = (branches || []).length;
  const activeBranches = (branches || []).filter(b => (b.status || 'Open') === 'Open').length;
  const shopOwners = (users || []).filter(u => u.role === 'shop_owner').length;
  const customers = (users || []).filter(u => u.role === 'customer').length;
  const pendingApps = sellerApps.filter(s => s.status === 'pending').length;
  const revenue = (txns || []).filter(t => t.status === 'paid').reduce((s, t) => s + Number(t.amount || 0), 0);

  const activity = [
    ...(users || []).slice(0, 5).map(u => ({ type: 'user', text: `<b>${u.name}</b> signed up as ${u.role}`, time: u.created_at })),
    ...(txns || []).slice(0, 5).map(t => ({ type: 'sale', text: `<b>${t.customer}</b> purchased ${t.item} — ${peso(t.amount)}`, time: t.date })),
    ...(sellerApps || []).slice(0, 5).map(s => ({ type: 'app', text: `Seller application: <b>${s.shop_name}</b> — ${s.status}`, time: s.created_at })),
  ].filter(a => a.time).sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 8);

  return (
    <>
      <div className="kpi-grid">
        <KpiCard icon={<BranchIcon />} value={totalBranches} label="Total Branches" delta={`${activeBranches} active`} deltaDir="up" />
        <KpiCard icon={<ShopIcon />} value={shopOwners} label="Shop Owners / Sellers" delta={pendingApps ? `${pendingApps} pending` : 'active'} />
        <KpiCard icon={<UsersIcon />} value={customers} label="Total Customers" delta={`${(users || []).length} users`} />
        <KpiCard icon={<RevenueIcon />} value={(txns || []).length} label="Orders / Transactions" delta={peso(revenue)} deltaDir="up" />
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head"><div><h2>Branches</h2><p>All ATANY branches and status.</p></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Branch</th><th>Address</th><th>Status</th></tr></thead>
              <tbody>
                {(branches || []).slice(0, 6).map(b => (
                  <tr key={b.id}>
                    <td className="cell-main">{b.name}</td>
                    <td>{b.address || '—'}</td>
                    <td><span className={`badge ${String(b.status || 'Open').toLowerCase()}`}>{b.status || 'Open'}</span></td>
                  </tr>
                ))}
                {!(branches || []).length && <tr><td colSpan={3}><div className="empty-state"><p>No branches found.</p></div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><div><h2>Recent Activity</h2><p>Signups, orders & seller applications — auto-refreshes every 15s.</p></div></div>
          <div className="activity-list">
            {activity.length ? activity.map((a, i) => (
              <div key={i} className="activity-item">
                <div className="activity-dot" aria-hidden="true">
                  {a.type === 'user' ? '👤' : a.type === 'sale' ? '💰' : '🏪'}
                </div>
                <div>
                  <ActivityText text={a.text} />
                  <div className="activity-time">{timeAgo(a.time)}</div>
                </div>
              </div>
            )) : <div className="empty-state"><p>No activity yet.</p></div>}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><div><h2>Recent Orders</h2><p>Latest payments and pickups across branches.</p></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Transaction ID</th><th>Customer</th><th>Item</th><th>Branch</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {(txns || []).slice(0, 6).map(t => (
                <tr key={t.id}>
                  <td className="cell-main">{t.id?.slice ? t.id.slice(0, 8) : t.id}</td>
                  <td>{t.customer}</td>
                  <td>{t.item}</td>
                  <td>{t.branch || '—'}</td>
                  <td>{peso(t.amount)}</td>
                  <td><span className={`badge ${t.status}`}>{t.status}</span></td>
                  <td>{t.date ? new Date(t.date).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
              {!(txns || []).length && <tr><td colSpan={7}><div className="empty-state"><p>No transactions recorded yet.</p></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
