// frontend/src/roles/customer/pages/Dashboard.jsx
// Customer dashboard — premium KPI cards, active bids, orders, activity feed
import { useState, useEffect } from 'react';
import { KpiCard } from '../../../shared/ui/Card';
import { Badge } from '../../../shared/components/Badge';
import { formatCountdown } from '../../../shared/hooks/useAuctionCountdown';
import { ActivityText } from '../../../shared/components/SafeHtml';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useBranch } from '../../../shared/hooks/useBranch';
import bannerRing from '../../../assests/customer-banner-ring.jpg';

function peso(n) { return '₱' + Number(n).toLocaleString(); }

export default function Dashboard({ stats: propStats, activeBids: propBids, recentOrders: propOrders, activity: propActivity }) {
  const { branchId, branchName } = useBranch();
  const [stats, setStats] = useState(propStats || null);
  const [activeBids, setActiveBids] = useState(propBids || []);
  const [recentOrders, setRecentOrders] = useState(propOrders || []);
  const [activity, setActivity] = useState(propActivity || []);
  const [loading, setLoading] = useState(!propStats && !propBids);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (propStats || propBids) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [bids, orders, watchlist, notifications] = await Promise.all([
          apiFetch('/customer/bids').catch(() => []),
          apiFetch('/customer/orders').catch(() => []),
          apiFetch('/customer/watchlist').catch(() => []),
          apiFetch('/customer/notifications').catch(() => []),
        ]);
        if (cancelled) return;
        const allBids = Array.isArray(bids) ? bids : [];
        const allOrders = Array.isArray(orders) ? orders : [];
        const allWatchlist = Array.isArray(watchlist) ? watchlist : [];

        const activeBidsData = allBids.filter(b => b.status === 'winning' || b.status === 'outbid').slice(0, 4);
        const wonCount = allBids.filter(b => b.status === 'won').length;
        const spent = allOrders.reduce((s, o) => s + Number(o.amount || 0), 0);
        const watching = allWatchlist.length;

        setStats({ activeBids: activeBidsData.length, won: wonCount, spent, watching });
        setActiveBids(activeBidsData);
        setRecentOrders((Array.isArray(orders) ? orders : []).slice(0, 4).map(o => ({
          ...o,
          displayId: o.transaction_code || o.id,
          date: o.date ? new Date(o.date).toLocaleDateString() : o.created_at ? new Date(o.created_at).toLocaleDateString() : o.date
        })));
        const acts = [
          ...(Array.isArray(notifications) ? notifications.slice(0, 3).map(n => ({ text: n.message, time: new Date(n.created_at).toLocaleString() })) : []),
          ...(Array.isArray(bids) ? bids.slice(0, 2).map(b => ({ text: `You bid <b>${b.item}</b> — ${b.status}`, time: new Date().toLocaleString() })) : []),
        ].slice(0, 4);
        setActivity(acts);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [propStats, propBids, branchId]);

  if (loading) return <div className="panel"><div className="empty-state"><p>Loading your dashboard…</p></div></div>;
  if (error) return <div className="panel"><div className="empty-state" style={{ color: 'var(--danger)' }}><p>Error loading dashboard: {error}</p><p className="form-hint">Please try refreshing. If this persists, check your connection.</p></div></div>;

  return (
    <>
      {branchName && (
        <div className="branch-banner" style={{ '--branch-ring': `url(${bannerRing})` }}>
          <div className="branch-banner-left">
            <div className="branch-banner-eyebrow">
              <span className="branch-banner-pin">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </span>
              <span className="branch-banner-label">Your Preferred Branch</span>
            </div>
            <div className="branch-banner-name">{branchName}</div>
            <div className="branch-banner-desc">Browse auctions and jewelry from your selected branch.</div>
          </div>
        </div>
      )}
      <div className="kpi-grid">
        <KpiCard
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M14.5 9a3.5 2 0 0 0-5 0" /><path d="M14.5 15a3.5 2 0 0 1-5 0" /><path d="M12 9v6" /></svg>}
          value={stats?.activeBids ?? 0}
          label="Active Bids"
          badge="Live"
          badgeVariant="active"
        />
        <KpiCard
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>}
          value={stats?.won ?? 0}
          label="Items Won"
          badge="+1"
          badgeVariant="positive"
        />
        <KpiCard
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}
          value={peso(stats?.spent)}
          label="Total Spent"
          badge="YTD"
          badgeVariant="neutral"
        />
        <KpiCard
          icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>}
          value={stats?.watching ?? 0}
          label="Items Watching"
          badge="Watching"
          badgeVariant="neutral"
        />
      </div>
      <div className="two-col">
        <div className="panel">
          <div className="panel-head"><div><h2>Auctions You're Bidding On</h2><p>Ending soonest first.</p></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Item</th><th>Your Bid</th><th>Current Bid</th><th>Ends</th><th>Status</th></tr></thead>
              <tbody>
                {activeBids.length ? activeBids.map((b) => (
                  <tr key={b.id}>
                    <td className="cell-main">{b.item}</td>
                    <td>{peso(b.yourBid)}</td>
                    <td>{peso(b.currentBid)}</td>
                    <td>{formatCountdown(b.endsInSec)}</td>
                    <td><Badge status={b.status} /></td>
                  </tr>
                )) : <tr><td colSpan={5}><div className="empty-state"><p>You have no active bids right now.</p></div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><div><h2>Recent Activity</h2><p>Updates on your account.</p></div></div>
          <div className="activity-list">
            {activity.length ? activity.map((a, i) => (
              <div key={i} className="activity-item">
                <div className="activity-dot" aria-hidden="true">●</div>
                <div><ActivityText text={a.text} /><div className="activity-time">{a.time}</div></div>
              </div>
            )) : <div className="empty-state"><p>No recent activity — bids and wins will appear here.</p></div>}
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><div><h2>Recent Orders</h2><p>Your latest purchases and pickups.</p></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order ID</th><th>Item</th><th>Amount</th><th>Branch</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {recentOrders.length ? recentOrders.map((o) => (
                <tr key={o.id}>
                  <td className="cell-main">{o.displayId || o.id}</td>
                  <td>{o.item}</td>
                  <td>{peso(o.amount)}</td>
                  <td>{o.branch}</td>
                  <td><Badge status={o.status} /></td>
                  <td>{o.date}</td>
                </tr>
              )) : <tr><td colSpan={6}><div className="empty-state"><p>No orders yet — won auctions will appear here.</p></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
