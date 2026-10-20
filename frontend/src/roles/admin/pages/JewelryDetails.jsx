// frontend/src/roles/admin/pages/JewelryDetails.jsx
// Admin jewelry detail — full product info, auction info, bid history, seller/branch, sales info
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { formatCountdown, useAuctionCountdown } from '../../../shared/hooks/useAuctionCountdown';

function peso(n) { return '₱' + Number(n).toLocaleString(); }
function displayStatus(s) { return s === 'scheduled' ? 'Upcoming' : s === 'live' ? 'Live' : s === 'ended' ? 'Completed' : s || '—'; }
function formatDate(d) { return d ? new Date(d).toLocaleString() : '—'; }
function productStatus(p, auctionStatus) {
  if (auctionStatus === 'live' || auctionStatus === 'scheduled') return 'In Auction';
  if (p.status === 'pending') return 'Pending';
  if (p.status === 'approved') return 'Available';
  if (p.status === 'rejected') return 'Rejected';
  return p.status || '—';
}
function badgeClass(p, auctionStatus) {
  if (auctionStatus === 'live') return 'live';
  if (auctionStatus === 'scheduled') return 'scheduled';
  if (p.status === 'pending') return 'pending';
  if (p.status === 'approved') return 'active';
  if (p.status === 'rejected') return 'dismissed';
  return 'pending';
}

export default function JewelryDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const fetchProduct = async () => {
    try {
      const data = await apiFetch(`/admin/products/${id}`);
      setProduct(data);
    } catch (e) {
      showToast(e.message || 'Failed to load product');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchProduct(); }, [id]);
  const liveSec = useAuctionCountdown(product?.auction?.endsInSec || 0);

  const handleApprove = async () => {
    setApproving(true);
    try {
      await apiFetch(`/admin/products/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'approved' }) });
      showToast('Item approved');
      await fetchProduct();
    } catch (e) { showToast(e.message || 'Failed to approve'); }
    setApproving(false);
  };

  const handleReject = async () => {
    setRejecting(true);
    try {
      await apiFetch(`/admin/products/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'rejected' }) });
      showToast('Item rejected');
      await fetchProduct();
    } catch (e) { showToast(e.message || 'Failed to reject'); }
    setRejecting(false);
  };

  if (loading) return <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading jewelry details...</div>;
  if (!product) return (
    <div className="panel" style={{ padding: 40, textAlign: 'center' }}>
      <p>Product not found.</p>
      <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => navigate('/admin/products')}>Back to Jewelry</button>
    </div>
  );

  const auction = product.auction;
  const order = product.order;
  const isPending = product.status === 'pending';
  const auctionStatus = auction?.status || null;
  const isSold = auctionStatus === 'ended' && order;

  return (
    <>
      <button className="btn btn-outline" style={{ marginBottom: 16 }} onClick={() => navigate('/admin/products')}>← Back to Jewelry</button>

      <div className="two-col" style={{ alignItems: 'start' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div style={{ position: 'relative' }}>
              {product.image_url && (
                <img src={product.image_url} alt={product.name} style={{ width: '100%', height: 300, objectFit: 'cover', borderRadius: 'var(--radius) var(--radius) 0 0' }} onError={(e) => e.target.style.display = 'none'} />
              )}
              <span className={`badge ${badgeClass(product, auctionStatus)}`} style={{ position: 'absolute', top: 12, right: 12, padding: '6px 14px', fontSize: 12 }}>{productStatus(product, auctionStatus)}</span>
            </div>
            <div style={{ padding: '20px 24px 24px' }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--navy)', marginBottom: 4 }}>{product.name || 'Untitled'}</h2>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Product ID: {product.id.slice(0, 8)}</p>
              {product.description && <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.65, marginBottom: 16 }}>{product.description}</p>}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
                {product.category && <span style={{ color: 'var(--muted)' }}>Category: <strong style={{ color: 'var(--text)' }}>{product.category}</strong></span>}
                {product.karat_weight && <span style={{ color: 'var(--muted)' }}>Karat/Weight: <strong style={{ color: 'var(--text)' }}>{product.karat_weight}</strong></span>}
                <span style={{ color: 'var(--muted)' }}>Price: <strong style={{ color: 'var(--text)' }}>{peso(product.price)}</strong></span>
              </div>
            </div>
          </div>

          {isPending && (
            <div className="panel">
              <div className="panel-head"><div><h2>Admin Actions</h2><p>Approve or reject this submission per spec 4.3.</p></div></div>
              <div style={{ padding: '0 24px 20px', display: 'flex', gap: 10 }}>
                <button className="btn btn-primary" disabled={approving} onClick={handleApprove}>{approving ? 'Approving...' : 'Approve Item'}</button>
                <button className="btn btn-outline" disabled={rejecting} onClick={handleReject} style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{rejecting ? 'Rejecting...' : 'Reject Item'}</button>
              </div>
            </div>
          )}

          {auction && (
            <div className="panel">
              <div className="panel-head"><div><h2>Auction Information</h2></div></div>
              <div style={{ padding: '0 24px 20px' }}>
                <div className="admin-detail-grid">
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Auction ID</span>
                    <span className="admin-detail-value">{auction.auction_code || auction.id?.slice(0, 8)}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Status</span>
                    <span className="admin-detail-value"><span className={`badge ${auction.status}`}>{displayStatus(auction.status)}</span></span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Starting Price</span>
                    <span className="admin-detail-value">{peso(auction.start_price)}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Current Bid</span>
                    <span className="admin-detail-value" style={{ color: auction.status === 'live' ? 'var(--success)' : 'var(--navy)' }}>{peso(auction.current_bid)}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Bids</span>
                    <span className="admin-detail-value">{auction.total_bids}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Participants</span>
                    <span className="admin-detail-value">{auction.participants}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">{auction.status === 'ended' ? 'Final Price' : auction.status === 'live' ? 'Time Left' : 'Starts In'}</span>
                    <span className="admin-detail-value">
                      {auction.status === 'ended' ? peso(auction.current_bid) : <span style={{ color: auction.status === 'live' ? 'var(--success)' : 'var(--gold)', fontWeight: 700 }}>{formatCountdown(liveSec)}</span>}
                    </span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Start</span>
                    <span className="admin-detail-value" style={{ fontSize: 12 }}>{formatDate(auction.start_time)}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">End</span>
                    <span className="admin-detail-value" style={{ fontSize: 12 }}>{formatDate(auction.end_time)}</span>
                  </div>
                </div>
                <button className="btn btn-outline" style={{ marginTop: 12, fontSize: 12 }} onClick={() => navigate(`/admin/auctions/${auction.id}`)}>View Auction Details →</button>
              </div>
            </div>
          )}

          {isSold && order && (
            <div className="panel">
              <div className="panel-head"><div><h2>Sales Information</h2></div></div>
              <div style={{ padding: '0 24px 20px' }}>
                <div className="admin-detail-grid">
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Buyer</span>
                    <span className="admin-detail-value">{order.buyer?.name || '—'}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Order ID</span>
                    <span className="admin-detail-value">{order.transaction_code || order.id?.slice(0, 8)}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Sold Price</span>
                    <span className="admin-detail-value" style={{ color: 'var(--success)' }}>{peso(order.amount)}</span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Payment Status</span>
                    <span className="admin-detail-value"><span className={`badge ${order.status === 'completed' ? 'active' : order.status === 'ready_pickup' ? 'scheduled' : 'pending'}`}>{order.status}</span></span>
                  </div>
                  <div className="admin-detail-item">
                    <span className="admin-detail-label">Pickup Status</span>
                    <span className="admin-detail-value">{order.status === 'completed' ? 'Picked Up' : order.status === 'ready_pickup' ? 'Ready for Pickup' : 'Awaiting Payment'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <div className="panel-head"><div><h2>Jewelry Details</h2></div></div>
            <div style={{ padding: '0 24px 20px' }}>
              <div className="admin-detail-grid">
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Category</span>
                  <span className="admin-detail-value">{product.category || '—'}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Karat</span>
                  <span className="admin-detail-value">{product.karat_weight || '—'}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Price</span>
                  <span className="admin-detail-value">{peso(product.price)}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Status</span>
                  <span className="admin-detail-value"><span className={`badge ${badgeClass(product, auctionStatus)}`}>{productStatus(product, auctionStatus)}</span></span>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><div><h2>Seller</h2></div></div>
            <div style={{ padding: '0 24px 20px' }}>
              <div className="admin-detail-grid">
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Shop</span>
                  <span className="admin-detail-value">{product.shop?.name || '—'}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Owner</span>
                  <span className="admin-detail-value">{product.shop?.owner_name || '—'}</span>
                </div>
                <div className="admin-detail-item" style={{ gridColumn: '1 / -1' }}>
                  <span className="admin-detail-label">Email</span>
                  <span className="admin-detail-value" style={{ fontSize: 12 }}>{product.shop?.owner_email || '—'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><div><h2>Branch</h2></div></div>
            <div style={{ padding: '0 24px 20px' }}>
              <div className="admin-detail-grid">
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Branch</span>
                  <span className="admin-detail-value">{product.branch?.name || '—'}</span>
                </div>
                <div className="admin-detail-item">
                  <span className="admin-detail-label">Address</span>
                  <span className="admin-detail-value" style={{ fontSize: 12 }}>{product.branch?.address || '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {auction?.bids?.length > 0 && (
            <div className="panel">
              <div className="panel-head"><div><h2>Bid History</h2><p>{auction.total_bids} bid{auction.total_bids === 1 ? '' : 's'}</p></div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>#</th><th>Bidder</th><th>Amount</th><th>Time</th></tr></thead>
                  <tbody>
                    {auction.bids.map((b) => (
                      <tr key={b.rank}>
                        <td>{b.rank}</td>
                        <td className="cell-main">{b.bidder_name}</td>
                        <td style={{ fontWeight: b.rank === 1 ? 700 : 400, color: b.rank === 1 ? 'var(--success)' : 'var(--text)' }}>{peso(b.amount)}</td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>{formatDate(b.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
