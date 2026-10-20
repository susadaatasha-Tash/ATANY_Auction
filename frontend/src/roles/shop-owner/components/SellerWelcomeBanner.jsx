// frontend/src/roles/shop-owner/components/SellerWelcomeBanner.jsx
// Presentation-only welcome hero — real shop/branch/stats from outlet context.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Gavel, Gem, Plus, Store } from 'lucide-react';
import fallbackBanner from '../../../assests/seller-banner-jewelry.jpg';

function peso(n) {
  return '₱' + Number(n || 0).toLocaleString();
}

function isSoldSale(sale) {
  return sale?.payment_status === 'paid' || sale?.status === 'completed';
}

export function SellerWelcomeBanner({ shop, listings = [], auctions = [], sales = [], loading = false }) {
  const shopName = shop?.shop_name || 'Seller';
  const branchName = shop?.branch_name || null;
  const bannerSrc = shop?.branch_image_url || fallbackBanner;

  const stats = useMemo(() => {
    const activeListings = listings.filter((l) => {
      const st = l.computed_status || l.status;
      return st !== 'ended' && st !== 'rejected';
    }).length;
    const liveAuctions = auctions.filter((a) => a.status === 'live').length;
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const ytd = sales.filter((s) => {
      if (!isSoldSale(s)) return false;
      const when = new Date(s.date);
      return !Number.isNaN(when.getTime()) && when >= yearStart;
    });
    const ytdTotal = ytd.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const pending = sales.filter(
      (s) => s.payment_status === 'paid' && ['pending', 'preparing', 'ready_pickup'].includes(s.status)
    );
    const pendingTotal = pending.reduce((sum, s) => sum + (Number(s.payout) || 0), 0);
    return { activeListings, liveAuctions, ytdTotal, pendingTotal };
  }, [listings, auctions, sales]);

  return (
    <section className="sdash-welcome" aria-label="Seller welcome">
      <div className="sdash-welcome__hero">
        <div className="sdash-welcome__copy">
          <div className="sdash-welcome__badge" aria-hidden="true">
            <Gem /> ATANY · SHOP OWNER
          </div>
          <h1 className="sdash-welcome__title">
            Welcome back, <span className="sdash-welcome__title-accent">{shopName}</span>
          </h1>
          <p className="sdash-welcome__desc">
            Run your jewelry store from one premium workspace — listings, live auctions, orders and payouts in real time.
          </p>
          <div className="sdash-welcome__actions">
            <Link to="/shop/listings" className="sdash-welcome-btn sdash-welcome-btn--gold">
              <Plus aria-hidden="true" />
              Create new listing
            </Link>
            <Link to="/shop/profile" className="sdash-welcome-btn sdash-welcome-btn--outline">
              <Store aria-hidden="true" />
              View shop profile
            </Link>
          </div>
        </div>
        <div className="sdash-welcome__media">
          <img src={bannerSrc} alt="" aria-hidden="true" loading="lazy" />
          <div className="sdash-welcome__media-overlay">
            <div className="sdash-welcome__media-label">YOUR PRIMARY BRANCH</div>
            <div className="sdash-welcome__media-branch">{branchName || 'Primary branch not set'}</div>
          </div>
        </div>
      </div>
      <div className="sdash-welcome__stats" role="group" aria-label="Shop performance">
        <div className="sdash-welcome__stat">
          <div className="sdash-welcome__stat-icon" aria-hidden="true"><Gem /></div>
          <div className="sdash-welcome__stat-body">
            <div className="sdash-welcome__stat-label">ACTIVE LISTINGS</div>
            <div className="sdash-welcome__stat-value">{loading ? '—' : stats.activeListings}</div>
          </div>
        </div>
        <div className="sdash-welcome__stat">
          <div className="sdash-welcome__stat-icon" aria-hidden="true"><Gavel /></div>
          <div className="sdash-welcome__stat-body">
            <div className="sdash-welcome__stat-label">LIVE AUCTIONS</div>
            <div className="sdash-welcome__stat-value">{loading ? '—' : stats.liveAuctions}</div>
          </div>
        </div>
        <div className="sdash-welcome__stat">
          <div className="sdash-welcome__stat-icon" aria-hidden="true"><ArrowRight /></div>
          <div className="sdash-welcome__stat-body">
            <div className="sdash-welcome__stat-label">TOTAL SALES YTD</div>
            <div className="sdash-welcome__stat-value">{loading ? '—' : peso(stats.ytdTotal)}</div>
          </div>
        </div>
        <div className="sdash-welcome__stat">
          <div className="sdash-welcome__stat-icon" aria-hidden="true"><Store /></div>
          <div className="sdash-welcome__stat-body">
            <div className="sdash-welcome__stat-label">PENDING PAYOUT</div>
            <div className="sdash-welcome__stat-value">{loading ? '—' : peso(stats.pendingTotal)}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default SellerWelcomeBanner;
