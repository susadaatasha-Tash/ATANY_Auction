// frontend/src/roles/customer/pages/Dashboard.jsx
// Customer dashboard — luxury glass premium redesign matching reference
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { KpiCard } from '../../../shared/ui/Card';
import { Skeleton, SkeletonCircle, SkeletonKpiRow, SkeletonList, SkeletonRegion } from '../../../shared/ui/Skeleton';
import { ActivityText } from '../../../shared/components/SafeHtml';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useBranch } from '../../../shared/hooks/useBranch';
import { useAuth } from '../../../shared/hooks/useAuth';
import bannerRing from '../../../assests/customer-banner-ring.jpg';
import { Gavel, Trophy, Wallet, Heart } from 'lucide-react';

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }

export default function Dashboard({ stats: propStats, activeBids: propBids, recentOrders: propOrders, activity: propActivity }) {
  const { branchName, branches: contextBranches } = useBranch();
  const { preferredBranchId } = useAuth();
  const [stats, setStats] = useState(propStats || null);
  const [activeBids, setActiveBids] = useState(propBids || []);
  const [recentOrders, setRecentOrders] = useState(propOrders || []);
  const [activity, setActivity] = useState(propActivity || []);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(!propStats && !propBids);
  const [error, setError] = useState(null);

  const branchImages = {
    'Davao City Branch': 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=400&q=70',
    'Abreeza Branch': 'https://images.unsplash.com/photo-1555529771-7888783a18da?auto=format&fit=crop&w=400&q=70',
    'SM Lanang Branch': 'https://images.unsplash.com/photo-1519566335946-e6f65f0f4ff7?auto=format&fit=crop&w=400&q=70',
    'Gmall Branch': 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=400&q=70',
  };
  const getBranchImage = (b) => b.branch_image_url || b.image_url || branchImages[b.name] || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=400&q=70';

  useEffect(() => {
    if (propStats || propBids) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        // Only the auxiliary lists degrade silently; a failed primary request
        // must reach the error branch instead of masquerading as "no data".
        const [bids, orders, watchlist, notifications, branchesData] = await Promise.all([
          apiFetch('/customer/bids'),
          apiFetch('/customer/orders').catch(() => []),
          apiFetch('/customer/watchlist').catch(() => []),
          apiFetch('/customer/notifications').catch(() => []),
          apiFetch('/branches').catch(() => []),
        ]);
        if (cancelled) return;
        const allBids = Array.isArray(bids) ? bids : [];
        const allOrders = Array.isArray(orders) ? orders : [];
        const allWatchlist = Array.isArray(watchlist) ? watchlist : [];
        const activeBidsData = allBids.filter(b => b.status === 'winning' || b.status === 'outbid').slice(0, 4);
        const wonCount = allBids.filter(b => b.status === 'won').length;
        const spent = allOrders.reduce((s, o) => s + Number(o.amount || 0), 0);
        const watching = allWatchlist.length;
        // Real values only — a genuine 0 stays 0 (never replaced by a sample).
        setStats({ activeBids: activeBidsData.length, won: wonCount, spent, watching });
        setActiveBids(activeBidsData.length ? activeBidsData : []);
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
        const openBranches = Array.isArray(branchesData) ? branchesData.filter(b => (b.status || 'Open') === 'Open').slice(0, 4) : [];
        setBranches(openBranches);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [propStats, propBids]);

  // Real data only: null while loading, otherwise the actual figures (including 0).
  const displayStats = stats || { activeBids: 0, won: 0, spent: 0, watching: 0 };
  const displayActivity = activity;

  const selectedBranch = [...(contextBranches || []), ...branches].find(
    (b) => String(b.id ?? b._id) === String(preferredBranchId)
  );
  const displayBranchName = branchName || selectedBranch?.name || '';

  // Initial load: mirror the real layout (hero → KPI row → branches → activity)
  // so the page does not jump when data lands. Real request state only.
  if (loading) {
    return (
      <SkeletonRegion label="Loading your dashboard" className="customer-dash-skeleton">
        <div className="customer-hero" aria-hidden="true">
          <div className="customer-hero-left">
            <Skeleton w="140px" h={11} />
            <Skeleton w="58%" h={30} style={{ marginTop: 10 }} />
            <Skeleton w="72%" h={12} style={{ marginTop: 10 }} />
          </div>
        </div>

        <div className="kpi-grid customer-kpi-grid">
          <SkeletonKpiRow count={4} />
        </div>

        <div className="panel">
          <div className="panel-head"><h2>Explore Branches</h2></div>
          <div
            className="explore-branches-grid"
            style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px' }}
          >
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ border: '1px solid #E8E5DE', borderRadius: '12px', overflow: 'hidden', background: '#fff' }}>
                <Skeleton w="100%" h={140} r={0} />
                <div style={{ padding: '14px 16px' }}>
                  <Skeleton w="62%" h={14} />
                  <Skeleton w="88%" h={11} style={{ marginTop: 8 }} />
                  <Skeleton w="34%" h={11} style={{ marginTop: 8 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h2>Recent Activity</h2></div>
          <SkeletonList
            count={4}
            render={() => (
              <>
                <SkeletonCircle size={28} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <Skeleton w="76%" h={12} />
                  <Skeleton w="30%" h={10} style={{ marginTop: 6 }} />
                </span>
              </>
            )}
          />
        </div>
      </SkeletonRegion>
    );
  }
  if (error) return <div className="panel"><div className="empty-state" style={{ color: 'var(--danger)' }}><p>Error loading dashboard: {error}</p><p className="form-hint">Please try refreshing. If this persists, check your connection.</p></div></div>;

  return (
    <>
      {/* Hero — one continuous banner with customer-banner-ring.jpg background */}
      <div className="customer-hero" style={{ '--hero-image': `url(${bannerRing})` }}>
        <div className="customer-hero-left">
          <div className="customer-hero-eyebrow">YOUR PREFERRED BRANCH</div>
          <h2 className="customer-hero-title">{displayBranchName || 'Select a branch'}</h2>
          <p className="customer-hero-desc">Browse auctions and jewelry from your selected branch.</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="kpi-grid customer-kpi-grid">
        <KpiCard icon={<Gavel size={18} />} value={displayStats.activeBids} label="Active Bids" badge="Live" badgeVariant="active" />
        <KpiCard icon={<Trophy size={18} />} value={displayStats.won} label="Auctions Won" badge="+1" badgeVariant="positive" />
        <KpiCard icon={<Wallet size={18} />} value={peso(displayStats.spent)} label="Total Spent" badge="YTD" badgeVariant="neutral" />
        <KpiCard icon={<Heart size={18} />} value={displayStats.watching} label="Watchlist" badge="Following" badgeVariant="neutral" />
      </div>

      {/* Branch Cards */}
      {branches.length > 0 && (
        <div className="panel">
          <div className="panel-head"><div><h2>Explore Branches</h2></div></div>
          <div className="explore-branches-grid" style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px' }}>
            {branches.map(b => (
              <div key={b.id} style={{ background: '#fff', border: '1px solid #E8E5DE', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(20,42,74,0.06)' }}>
                <div style={{ height: '140px', overflow: 'hidden', background: '#F7F3EA' }}>
                  <img src={getBranchImage(b)} alt={b.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ padding: '14px 16px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#142A4A', marginBottom: '4px' }}>{b.name}</div>
                  <div style={{ fontSize: '12px', color: '#7B8493', lineHeight: 1.4, marginBottom: '10px', minHeight: '34px' }}>{b.address || '—'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: (b.status || 'Open').toLowerCase() === 'open' ? '#5D9B78' : '#C9963E' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: (b.status || 'Open').toLowerCase() === 'open' ? '#5D9B78' : '#C9963E', display: 'inline-block' }}></span>
                    {b.status || 'Open'}
                  </div>
                  <a href="/branches" style={{ display: 'inline-flex', marginTop: '10px', fontSize: '12px', fontWeight: 600, color: '#162B4D' }}>View Branch →</a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><div><h2>Recent Activity</h2></div></div>
        <div className="activity-list">
          {displayActivity.length ? displayActivity.map((a, i) => (
            <div key={i} className="activity-item">
              <div className="activity-dot" aria-hidden="true"><Gavel size={12} /></div>
              <div style={{ flex: 1, minWidth: 0 }}><ActivityText text={a.text} /><div className="activity-time">{a.time}</div></div>
            </div>
          )) : (
            // Confirmed empty response only — never shown while loading.
            <div className="empty-state"><p>No activity yet.</p></div>
          )}
        </div>
      </div>
    </>
  );
}
