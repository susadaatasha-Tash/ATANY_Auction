// frontend/src/roles/admin/pages/AuctionDetails.jsx
// Admin auction detail — full jewelry, branch, seller, bid history, winner for completed
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { formatCountdown, useAuctionCountdown } from '../../../shared/hooks/useAuctionCountdown';

function peso(n) { return '₱' + Number(n).toLocaleString(); }
function displayStatus(s) { return s === 'scheduled' ? 'Upcoming' : s === 'live' ? 'Live' : s === 'ended' ? 'Completed' : s || '—'; }
function formatDate(d) { return d ? new Date(d).toLocaleString() : '—'; }
function badgeClass(s) { return s === 'live' ? 'live' : s === 'scheduled' ? 'scheduled' : s === 'ended' ? 'ended' : 'pending'; }

export default function AuctionDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const [auction, setAuction] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAuction = async () => {
    try {
      const data = await apiFetch(`/admin/auctions/${id}`);
      setAuction(data);
    } catch (e) {
      showToast(e.message || 'Failed to load auction');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAuction(); }, [id]);
  const liveSec = useAuctionCountdown(auction?.endsInSec || 0);

  if (loading) return <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading auction details...</div>;
  if (!auction) return (
    <div className="panel" style={{ padding: 40, textAlign: 'center' }}>
      <p>Auction not found.</p>
      <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => navigate('/admin/auctions')}>Back to Auctions</button>
    </div>
  );

  const isLive = auction.status === 'live';
  const isEnded = auction.status === 'ended';
  const isScheduled = auction.status === 'scheduled';

  return (
    <>
      <button className="btn btn-outline" style={{ marginBottom: 16 }} onClick={() => navigate('/admin/auctions')}>← Back to Auctions</button>

      <div className="two-col" style={{ alignItems: 'start' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div style={{ position: 'relative' }}>
              {auction.product?.image_url && (
                <img src={auction.product.image_url} alt={auction.product.name} style={{ width: '100%', height: 300, objectFit: 'cover', borderRadius: 'var(--radius) var(--radius) 0 0' }} onError={(e) => e.target.style.display = 'none'} />
              )}
              <span className={`badge ${badgeClass(auction.status)}`} style={{ position: 'absolute', top: 12, right: 12, padding: '6px 14px', fontSize: 12 }}>{displayStatus(auction.status)}</span>
            </div>
            <div style={{ padding: '20px 24px 24px' }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--navy)', marginBottom: 4 }}>{auction.product?.name || 'Untitled'}</h2>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{auction.auction_code || auction.id.slice(0, 8)}</p>
              {auction.product?.description && <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.65, marginBottom: 16 }}>{auction.product.description}</p>}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
                {auction.product?.category && <span style={{ color: 'var(--muted)' }}>Category: <strong style={{ color: 'var(--text)' }}>{auction.product.category}</strong></span>}
                {auction.product?.karat_weight && <span style={{ color: 'var(--muted)' }}>Karat/Weight: <strong style={{ color: 'var(--text)' }}>{auction.product.karat_weight}</strong></span>}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><div><h2>Bid History</h2><p>{auction.total_bids} bid{auction.total_bids === 1 ? '' : 's'} · {auction.participants} participant{auction.participants === 1 ? '' : 's'}</p></div></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Bidder</th><th>Amount</th><th>Time</th></tr></thead>
                <tbody>
                  {auction.bids?.length ? auction.bids.map((b) => (
                    <tr key={b.rank}>
                      <td>{b.rank}</td>
                      <td className="cell-main">{b.bidder_name}</td>
                      <td style={{ fontWeight: b.rank === 1 ? 700 : 400, color: b.rank === 1 ? 'var(--success)' : 'var(--text)' }}>{peso(b.amount)}</td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{formatDate(b.created_at)}</td>
                    </tr>
                  )) : <tr><td colSpan={4}><div className="empty-state"><p>No bids yet.</p></div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {isEnded && auction.order && (
            <div className="panel">
              <div className="panel-head"><div><h2>Winner & Order</h2></div></div>
              <div style={{ padding: '0 24px 20px' }}>
                <div className="admin-detail-grid">
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Winner</span>
                    <span className="admin-detail-value">{auction.order.buyer?.name || '—'}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Winning Bid</span>
                    <span className="admin-detail-value" style={{ color: 'var(--success)' }}>{peso(auction.order.amount)}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Order ID</span>
                    <span className="admin-detail-value">{auction.order.transaction_code || auction.order.id?.slice(0, 8)}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Payment Status</span>
                    <span className="admin-detail-value"><span className={`badge ${auction.order.status === 'completed' ? 'active' : auction.order.status === 'ready_pickup' ? 'scheduled' : 'pending'}`}>{auction.order.status}</span></span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Pickup Status</span>
                    <span className="admin-detail-value">{auction.order.status === 'completed' ? 'Picked Up' : auction.order.status === 'ready_pickup' ? 'Ready for Pickup' : 'Awaiting Payment'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-head"><div><h2>Auction Info</h2></div></div>
            <div style={{ padding: '0 24px 20px' }}>
              <div className="admin-detail-grid">
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Starting Price</span>
                  <span className="admin-detail-value">{peso(auction.start_price)}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Current Bid</span>
                  <span className="admin-detail-value" style={{ color: isLive ? 'var(--success)' : 'var(--navy)' }}>{peso(auction.current_bid)}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Total Bids</span>
                  <span className="admin-detail-value">{auction.total_bids}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Participants</span>
                  <span className="admin-detail-value">{auction.participants}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">{isEnded ? 'Final Price' : isLive ? 'Time Left' : 'Starts In'}</span>
                  <span className="admin-detail-value">
                    {isEnded ? peso(auction.current_bid) : <span style={{ color: isLive ? 'var(--success)' : 'var(--gold)', fontWeight: 700 }}>{formatCountdown(liveSec)}</span>}
                  </span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Status</span>
                  <span className="admin-detail-value"><span className={`badge ${badgeClass(auction.status)}`}>{displayStatus(auction.status)}</span></span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Start Time</span>
                  <span className="admin-detail-value" style={{ fontSize: 12 }}>{formatDate(auction.start_time)}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">End Time</span>
                  <span className="admin-detail-value" style={{ fontSize: 12 }}>{formatDate(auction.end_time)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><div><h2>Jewelry</h2></div></div>
            <div style={{ padding: '0 24px 20px' }}>
              <div className="admin-detail-grid">
                <div className="admin-detail-item" style={{ gridColumn: '1 / -1' }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {auction.product?.image_url && <img src={auction.product.image_url} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />}
                    <div>
                      <div className="admin-detail-value">{auction.product?.name || '—'}</div>
                      <div className="admin-detail-label">{auction.product?.id?.slice(0, 8)}</div>
                    </div>
                  </div>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Category</span>
                  <span className="admin-detail-value">{auction.product?.category || '—'}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Karat / Weight</span>
                  <span className="admin-detail-value">{auction.product?.karat_weight || '—'}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Listed Price</span>
                  <span className="admin-detail-value">{peso(auction.product?.price)}</span>
                </div>
              </div>
              <button className="btn btn-outline" style={{ marginTop: 12, fontSize: 12 }} onClick={() => navigate(`/admin/products/${auction.product?.id}`)}>View Jewelry Details →</button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><div><h2>Seller & Branch</h2></div></div>
            <div style={{ padding: '0 24px 20px' }}>
              <div className="admin-detail-grid">
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Shop</span>
                  <span className="admin-detail-value">{auction.shop?.name || '—'}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Seller</span>
                  <span className="admin-detail-value">{auction.shop?.owner_name || '—'}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Email</span>
                  <span className="admin-detail-value" style={{ fontSize: 12 }}>{auction.shop?.owner_email || '—'}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Branch</span>
                  <span className="admin-detail-value">{auction.branch?.name || '—'}</span>
                </div>
                <div className="admin-detail-item" style={{ gridColumn: '1 / -1' }}>
                  <span className="admin-detail-label">Address</span>
                  <span className="admin-detail-value" style={{ fontSize: 12 }}>{auction.branch?.address || '—'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
