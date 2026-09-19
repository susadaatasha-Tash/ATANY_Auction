// frontend/src/roles/shop-owner/pages/Dashboard.jsx
// Shop owner dashboard — premium KPI cards, auction table, sales, shop info
import { useEffect, useState } from 'react';
import { KpiCard } from '../../../shared/ui/Card';
import { ActivityText } from '../../../shared/components/SafeHtml';
import { formatCountdown } from '../../../shared/hooks/useAuctionCountdown';
import { useShopData } from '../hooks/useShopData';
import { apiFetch } from '../../../shared/lib/apiClient';
import bannerImg from '../../../assests/seller-banner-jewelry.jpg';

const ACTIVITY_META = {
  auction_created: { title: 'Auction Created', desc: (d) => `${d?.name || 'An auction'} was created` },
  auction_updated: { title: 'Auction Updated', desc: (d) => `${d?.name || 'An auction'} was updated` },
  auction_cancelled: { title: 'Auction Cancelled', desc: () => 'A scheduled auction was cancelled' },
  listing_created: { title: 'Jewelry Added', desc: (d) => `${d?.name || 'A jewelry item'} was submitted for review` },
  listing_updated: { title: 'Jewelry Updated', desc: (d) => `${d?.name || 'A jewelry item'} details were updated` },
  listing_resubmitted: { title: 'Jewelry Resubmitted', desc: (d) => `${d?.name || 'A jewelry item'} was resubmitted for review` },
  order_preparing: { title: 'Order Preparing', desc: (d) => `${d?.name || 'An order'} is being prepared` },
  order_ready_pickup: { title: 'Ready for Pickup', desc: (d) => `${d?.name || 'An order'} is ready for pickup` },
  order_completed: { title: 'Order Completed', desc: (d) => `${d?.name || 'An order'} was picked up` },
  subscription_paid: { title: 'Subscription Paid', desc: (d) => `${d?.billing_period || 'Subscription'} payment confirmed` },
};

function peso(n) { return '₱' + Number(n || 0).toLocaleString(); }

const ListingsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" />
  </svg>
);

const AuctionIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
  </svg>
);

const SalesIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const PayoutIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);

export default function ShopDashboard() {
  const { listings, auctions, sales, shop, branches, refresh } = useShopData();
  const homeBranch = branches.find((b) => b.id === shop?.home_branch_id);
  const branchName = shop?.branch_name || homeBranch?.name || '';
  const [activities, setActivities] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState(null);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setActivityLoading(true);
        setActivityError(null);
        const rows = await apiFetch('/shop-owner/activity');
        if (!cancelled) setActivities(Array.isArray(rows) ? rows : []);
      } catch (e) {
        if (!cancelled) { setActivityError(e.message || 'Unable to load recent activity.'); setActivities([]); }
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dashAuctions = (auctions || []).slice(0, 4);
  const dashSales = (sales || []).slice(0, 4);

  const stats = {
    listings: listings.length,
    liveAuctions: (auctions || []).filter(a => a.status === 'live').length,
    sales: sales.reduce((sum, s) => sum + (s.amount || 0), 0),
    payout: sales.filter(s => s.status === 'paidout').reduce((sum, s) => sum + (s.payout || 0), 0),
  };

  const branchImages = {
    'Davao City Branch': 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=400&q=70',
    'Abreeza Branch': 'https://images.unsplash.com/photo-1555529771-7888783a18da?auto=format&fit=crop&w=400&q=70',
    'SM Lanang Branch': 'https://images.unsplash.com/photo-1519566335946-e6f65f0f4ff7?auto=format&fit=crop&w=400&q=70',
    'Gmall Branch': 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=400&q=70',
  };
  const getBranchImage = (b) => b?.branch_image_url || b?.image_url || branchImages[b?.name] || 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=400&q=70';
  const displayBranch = homeBranch || (branchName ? { name: branchName, address: shop?.branch_address || '', status: 'Open' } : null);

  return (
    <>
      {displayBranch && (
        <div className="customer-hero" style={{ '--hero-image': `url(${bannerImg})` }}>
          <div className="customer-hero-left">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(200,155,60,0.12)', display: 'grid', placeItems: 'center', color: '#C89B3C', flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              </span>
              <span className="customer-hero-eyebrow" style={{ marginBottom: 0 }}>{displayBranch.name.replace('Gmall', 'G Mall').toUpperCase()}</span>
            </div>
            <div className="customer-hero-title" style={{ fontFamily: '"Plus Jakarta Sans", sans-serif', fontSize: '20px', fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.2, color: '#142A4A' }}>{shop?.shop_name || 'Golden Heritage — Gmall'}</div>
            <div style={{ fontSize: '12px', fontWeight: 400, color: '#7B8493', marginTop: '6px', lineHeight: 1.4 }}>Shop · {displayBranch.address || 'Gmall Davao, J.P. Laurel Ave, Davao City'}</div>
          </div>
        </div>
      )}

      <div className="kpi-grid">
        <KpiCard icon={<ListingsIcon />} value={stats.listings} label="Active Listings" delta="+2" />
        <KpiCard icon={<AuctionIcon />} value={stats.liveAuctions} label="Live Auctions" delta="Live" />
        <KpiCard icon={<SalesIcon />} value={peso(stats.sales)} label="Total Sales (YTD)" delta="+9.1%" />
        <KpiCard icon={<PayoutIcon />} value={peso(stats.payout)} label="Pending Payout" />
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <div><h2>Your Auctions Ending Soon</h2><p>High-activity lots requiring attention.</p></div>
            <button className="btn btn-outline" onClick={() => window.location.href = '/shop/auctions'}>View all</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Item</th><th>Current Bid</th><th>Bids</th><th>Ends</th><th>Status</th></tr></thead>
              <tbody>
                {dashAuctions.length ? dashAuctions.map((a) => (
                  <tr key={a.id}>
                    <td className="cell-main">{a.item}</td>
                    <td>{peso(a.currentBid)}</td>
                    <td>{a.bids}</td>
                    <td>{formatCountdown(a.endsInSec)}</td>
                    <td><span className={`badge ${a.status}`}>{a.status}</span></td>
                  </tr>
                )) : <tr><td colSpan={5}><div className="empty-state"><p>No auctions ending soon.</p></div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><div><h2>Recent Activity</h2><p>Updates on your shop.</p></div></div>
          <div className="activity-list">
            {activityLoading ? (
              <div className="empty-state"><p>Loading recent activity...</p></div>
            ) : activityError ? (
              <div className="empty-state"><p>Unable to load recent activity.</p></div>
            ) : activities.length ? activities.map((a) => {
              const meta = ACTIVITY_META[a.action] || { title: a.action, desc: () => '' };
              let details = {};
              try { details = typeof a.details === 'string' ? JSON.parse(a.details) : (a.details || {}); } catch {}
              const time = a.created_at ? new Date(a.created_at).toLocaleString() : '';
              return (
                <div key={a.id} className="activity-item">
                  <div className="activity-dot" aria-hidden="true">●</div>
                  <div><ActivityText text={`<b>${meta.title}</b> — ${meta.desc(details)}`} /><div className="activity-time">{time}</div></div>
                </div>
              );
            }) : (
              <div className="empty-state"><p>No recent activity</p><p className="form-hint">Your latest shop activities will appear here.</p></div>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div><h2>Recent Sales</h2><p>Latest completed orders from your shop.</p></div>
          <button className="btn btn-outline" onClick={() => window.location.href = '/shop/sales'}>View all</button>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order ID</th><th>Item</th><th>Buyer</th><th>Amount</th><th>Payout</th><th>Date</th></tr></thead>
            <tbody>
              {dashSales.length ? dashSales.map((s) => (
                <tr key={s.id}>
                  <td className="cell-main">{s.id}</td>
                  <td>{s.item}</td>
                  <td>{s.buyer}</td>
                  <td>{peso(s.amount)}</td>
                  <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                  <td>{s.date}</td>
                </tr>
              )) : <tr><td colSpan={6}><div className="empty-state"><p>No sales yet — completed orders will appear here.</p></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
