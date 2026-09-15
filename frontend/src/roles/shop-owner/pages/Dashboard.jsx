// frontend/src/roles/shop-owner/pages/Dashboard.jsx
// Shop owner dashboard — premium KPI cards, auction table, sales, shop info
import { useEffect } from 'react';
import { KpiCard } from '../../../shared/ui/Card';
import { ActivityText } from '../../../shared/components/SafeHtml';
import { formatCountdown } from '../../../shared/hooks/useAuctionCountdown';
import { useShopData } from '../hooks/useShopData';
import bannerImg from '../../../assests/seller-banner-jewelry.jpg';

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

  useEffect(() => { refresh(); }, [refresh]);

  const dashAuctions = (auctions || []).slice(0, 4);
  const dashSales = (sales || []).slice(0, 4);

  const stats = {
    listings: listings.length,
    liveAuctions: (auctions || []).filter(a => a.status === 'live').length,
    sales: sales.reduce((sum, s) => sum + (s.amount || 0), 0),
    payout: sales.filter(s => s.status === 'paidout').reduce((sum, s) => sum + (s.payout || 0), 0),
  };

  return (
    <>
      {branchName && (
        <div className="seller-branch-banner" style={{ '--seller-banner': `url(${bannerImg})` }}>
          <div className="seller-branch-banner-content">
            <div className="seller-branch-banner-pin">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <div className="seller-branch-banner-label">{branchName}</div>
            <div className="seller-branch-banner-shop">{shop?.shop_name || 'Your Shop'}</div>
            <div className="seller-branch-banner-address">Shop · {shop?.branch_address || homeBranch?.address || ''}</div>
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
            <div className="empty-state"><p>No recent activity.</p></div>
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
