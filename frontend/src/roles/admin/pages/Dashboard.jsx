// frontend/src/roles/admin/pages/Dashboard.jsx
// Admin dashboard — multi-branch focused (simplified scope)
import { useEffect } from 'react';
import { KpiCard } from '../../../shared/ui/Card';
import { Skeleton, SkeletonCircle, SkeletonKpiRow, SkeletonList } from '../../../shared/ui/Skeleton';
import { ActivityText } from '../../../shared/components/SafeHtml';
import { useAdminData } from '../hooks/useAdminData';

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
  // `loading` = first load (show skeletons); `refreshing` = background poll
  // (keep existing content). The hook already fetches on mount, so we no longer
  // fire a second identical refresh here.
  const { users, txns, branches, refresh, loadAnalytics, loading, refreshing } = useAdminData();

  useEffect(() => {
    const interval = setInterval(() => { refresh(); }, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  const totalBranches = (branches || []).length;
  const activeBranches = (branches || []).filter(b => (b.status || 'Open') === 'Open').length;
  const shopOwners = (users || []).filter(u => u.role === 'shop_owner').length;
  const customers = (users || []).filter(u => u.role === 'customer').length;
  const revenue = (txns || []).filter(t => t.status === 'paid').reduce((s, t) => s + Number(t.amount || 0), 0);

  const activity = [
    ...(users || []).slice(0, 5).map(u => ({ type: 'user', text: `<b>${u.name}</b> signed up as ${u.role}`, time: u.created_at })),
    ...(txns || []).slice(0, 5).map(t => ({ type: 'sale', text: `<b>${t.customer}</b> purchased ${t.item} — ${peso(t.amount)}`, time: t.date })),
  ].filter(a => a.time).sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 8);

  const branchImages = {
    'Davao City Branch': 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=400&q=70',
    'Abreeza Branch': 'https://images.unsplash.com/photo-1555529771-7888783a18da?auto=format&fit=crop&w=400&q=70',
    'SM Lanang Branch': 'https://images.unsplash.com/photo-1519566335946-e6f65f0f4ff7?auto=format&fit=crop&w=400&q=70',
    'Gmall Branch': 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=400&q=70',
  };
  const getBranchImage = (b) => b.branch_image_url || b.image_url || branchImages[b.name] || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=400&q=70';

  return (
    <>
      {/* Four KPI skeletons mirror .kpi-card (icon+label / divider / value /
          badge) so the grid keeps identical geometry and shows no fake 0/₱0. */}
      <div className="kpi-grid" aria-busy={loading ? 'true' : undefined}>
        {loading ? (
          <SkeletonKpiRow count={4} />
        ) : (
          <>
            <KpiCard icon={<BranchIcon />} value={totalBranches} label="Total Branches" badge={`${activeBranches} active`} badgeVariant="positive" />
            <KpiCard icon={<ShopIcon />} value={shopOwners} label="Shop Owners / Sellers" badge="active" badgeVariant="neutral" />
            <KpiCard icon={<UsersIcon />} value={customers} label="Total Customers" badge={`${(users || []).length} users`} badgeVariant="neutral" />
            <KpiCard icon={<RevenueIcon />} value={(txns || []).length} label="Orders / Transactions" badge={peso(revenue)} badgeVariant="positive" />
          </>
        )}
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head"><div><h2>Branches</h2></div></div>
          <div className="explore-branches-grid admin-branches-grid" style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px' }} aria-busy={loading ? 'true' : undefined}>
            {loading ? (
              /* 4 branch-card skeletons: 140px image area + name/address/status */
              [0, 1, 2, 3].map((i) => (
                <div key={i} style={{ background: '#fff', border: '1px solid #EEE8DC', borderRadius: '12px', overflow: 'hidden' }}>
                  <Skeleton w="100%" h={140} r={0} />
                  <div style={{ padding: '14px 16px' }}>
                    <Skeleton w="64%" h={14} />
                    <Skeleton w="90%" h={11} style={{ marginTop: 8 }} />
                    <Skeleton w="36%" h={11} style={{ marginTop: 8 }} />
                    <Skeleton w="52%" h={11} style={{ marginTop: 12 }} />
                  </div>
                </div>
              ))
            ) : (branches || []).slice(0, 4).map(b => (
              <div key={b.id} style={{ background: '#fff', border: '1px solid #EEE8DC', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(22,43,77,0.06)' }}>
                <div style={{ height: '140px', overflow: 'hidden', background: '#F7F3EA' }}>
                  <img src={getBranchImage(b)} alt={b.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ padding: '14px 16px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#162B4D', marginBottom: '4px' }}>{b.name}</div>
                  <div style={{ fontSize: '12px', color: '#718096', lineHeight: 1.4, marginBottom: '10px', minHeight: '34px' }}>{b.address || '—'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: (b.status || 'Open').toLowerCase() === 'open' ? '#5D9B78' : '#C9963E' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: (b.status || 'Open').toLowerCase() === 'open' ? '#5D9B78' : '#C9963E', display: 'inline-block' }}></span>
                    {b.status || 'Open'}
                  </div>
                </div>
              </div>
            ))}
            {/* Confirmed-empty only — never while the request is in flight. */}
            {!loading && !(branches || []).length && (
              <div className="empty-state" style={{ gridColumn: '1/-1' }}><p>No branches found.</p></div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><div><h2>Recent Activity</h2></div></div>
          <div className="activity-list" aria-busy={loading ? 'true' : undefined}>
            {loading ? (
              <SkeletonList
                count={6}
                render={() => (
                  <>
                    <SkeletonCircle size={30} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <Skeleton w="84%" h={12} />
                      <Skeleton w="32%" h={10} style={{ marginTop: 6 }} />
                    </span>
                  </>
                )}
              />
            ) : activity.length ? activity.map((a, i) => (
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
        <div className="panel-head"><div><h2>Recent Orders</h2></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Transaction ID</th><th>Customer</th><th>Item</th><th>Branch</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {loading ? (
                /* Rows live inside the real <table> so column widths match. */
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`skel-${i}`} aria-hidden="true">
                    {['18%', '22%', '20%', '16%', '12%', '10%', '12%'].map((w, j) => (
                      <td key={j}><Skeleton w={w} h={13} /></td>
                    ))}
                  </tr>
                ))
              ) : (txns || []).slice(0, 6).map(t => (
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
              {!loading && !(txns || []).length && (
                <tr><td colSpan={7}><div className="empty-state"><p>No transactions recorded yet.</p></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
