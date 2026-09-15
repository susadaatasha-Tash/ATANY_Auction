// frontend/src/roles/admin/pages/Analytics.jsx — wired to GET /admin/analytics?bucket=day|week|month|year (spec 4.7)
// Matches legacy _legacy_html_backup/admin.html layout: 4 KPIs + 4 charts + table, real Supabase data
import { useState, useEffect } from 'react';
import { RevenueTrendChart, CategoryBarChart, BranchRevenueChart, NewUsersBarChart } from '../components/AnalyticsCharts';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';

function peso(n) { return '₱' + Number(n).toLocaleString(); }

// Bucket options for the "Group by" filter — value maps to backend ?bucket=
const BUCKETS = [
  { value: 'day', label: 'Per Day (last 30 days)', word: 'day' },
  { value: 'week', label: 'Per Week (last 12 weeks)', word: 'week' },
  { value: 'month', label: 'Per Month (last 6 months)', word: 'month' },
  { value: 'year', label: 'Per Year (last 5 years)', word: 'year' },
];

function KpiCard({ icon, value, label, delta }) {
  return (
    <div className="kpi-card">
      <div className="kpi-top"><div className="kpi-icon">{icon}</div><span className={`kpi-delta ${delta && delta.toString().startsWith('+') ? 'up' : ''}`}>{delta || ''}</span></div>
      <div className="kpi-value">{value}</div><div className="kpi-label">{label}</div>
    </div>
  );
}

export default function Analytics({ analytics: propAnalytics, onRangeChange, onDownload: propDownload }) {
  const [bucket, setBucket] = useState('month');
  const [analytics, setAnalytics] = useState(propAnalytics || null);
  const showToast = useToast();

  const fetchAnalytics = async (b = bucket) => {
    try {
      const data = await apiFetch(`/admin/analytics?bucket=${b}`);
      setAnalytics(data);
    } catch (e) { showToast(e.message || 'Failed to load analytics'); }
  };
  useEffect(() => {
    if (propAnalytics && propAnalytics.revenueTrend) setAnalytics(propAnalytics);
    else fetchAnalytics(bucket);
  }, [propAnalytics]);
  const handleBucket = (v) => {
    setBucket(v);
    if (onRangeChange) onRangeChange(v);
    else fetchAnalytics(v);
  };
  const handleDownload = async () => {
    if (propDownload) return propDownload();
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/admin/analytics/export?bucket=${bucket}`, {
        headers: { Authorization: `Bearer ${(await (await import('../../../shared/lib/supabaseClient')).supabase.auth.getSession()).data.session?.access_token || ''}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'atany-analytics-report.csv'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { showToast(e.message); }
  };
  const { revenueTrend = [], categoryData = [], branchRevenue = [], topItems = [], userGrowthTrend = [], kpis = {} } = analytics || {};
  const per = (BUCKETS.find((b) => b.value === bucket) || BUCKETS[2]).word;
  const hasRevenue = revenueTrend.length > 0;
  const hasUsers = userGrowthTrend.length > 0;
  const hasCategory = categoryData.length > 0;
  const hasBranch = branchRevenue.length > 0;

  return (
    <>
      <div className="toolbar" style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--ivory)', boxShadow: 'var(--shadow)', marginBottom: 22 }}>
        <select className="filter-select" value={bucket} onChange={(e) => handleBucket(e.target.value)}>
          {BUCKETS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
        <button className="btn btn-primary" onClick={handleDownload}>Download Report (CSV)</button>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 22 }}>
        <KpiCard icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2.5" y="5" width="19" height="14" rx="2"/></svg>} value={peso(kpis.totalRevenue || 0)} label="Total Revenue" delta={`${kpis.revenueDelta >=0 ? '+' : ''}${kpis.revenueDelta || 0}%`} />
        <KpiCard icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 13l5-5 5 5-5 5-5-5Z"/></svg>} value={kpis.auctionsCompleted ?? 0} label="Auctions Completed" delta={`+${kpis.auctionsCompleted || 0}`} />
        <KpiCard icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 5 19 10M6 13l5-5 5 5-5 5-5-5Z"/><path d="M4 21 9 16M15 4l5 5"/></svg>} value={kpis.bidsPlaced ?? 0} label="Bids Placed" delta="Total" />
        <KpiCard icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3.3"/><path d="M2.5 20c1-4 3.6-6 6.5-6s5.5 2 6.5 6"/><circle cx="18" cy="9" r="2.6"/><path d="M15.5 14c2.4.2 4.3 1.9 5 5.6"/></svg>} value={kpis.newUsers ?? 0} label="New Users" delta={`+${(userGrowthTrend[userGrowthTrend.length-1]?.value) || 0}`} />
      </div>

      <div className="two-col">
        <div className="panel"><div className="panel-head"><div><h2>Revenue Trend</h2><p>Completed sales by {per}.</p></div></div><div style={{ padding: 20 }}>{hasRevenue ? <RevenueTrendChart data={revenueTrend} /> : <div className="empty-state"><p>No data yet for this period</p></div>}</div></div>
        <div className="panel"><div className="panel-head"><div><h2>New Users</h2><p>Sign-ups by {per}.</p></div></div><div style={{ padding: 20 }}>{hasUsers ? <NewUsersBarChart data={userGrowthTrend} /> : <div className="empty-state"><p>No data yet for this period</p></div>}</div></div>
      </div>

      <div className="two-col">
        <div className="panel"><div className="panel-head"><div><h2>Auctions by Category</h2><p>Where bidding activity concentrates.</p></div></div><div style={{ padding: 20 }}>{hasCategory ? <CategoryBarChart data={categoryData} /> : <div className="empty-state"><p>No data yet for this period</p></div>}</div></div>
        <div className="panel"><div className="panel-head"><div><h2>Revenue by Branch</h2><p>Pickup branch performance.</p></div></div><div style={{ padding: 20 }}>{hasBranch ? <BranchRevenueChart data={branchRevenue} /> : <div className="empty-state"><p>No data yet for this period</p></div>}</div></div>
      </div>

      <div className="panel">
        <div className="panel-head"><div><h2>Top Performing Items</h2><p>Highest revenue this period.</p></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Category</th><th>Units Sold</th><th>Revenue</th><th>Avg. Sale Price</th></tr></thead>
            <tbody>{(topItems || []).length ? (topItems || []).map((t) => <tr key={t.name}><td className="cell-main">{t.name}</td><td>{t.category}</td><td>{t.units}</td><td className="cell-main">{peso(t.revenue)}</td><td>{peso(Math.round(t.revenue / (t.units || 1)))}</td></tr>) : <tr><td colSpan={5}><div className="empty-state"><p>No sales data yet.</p></div></td></tr>}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}
