// frontend/src/roles/admin/components/AdminJewelryDrawer.jsx
// Admin → branch → Jewelry → listing inspector.
//
// READ-ONLY BY DESIGN: the admin may inspect a listing, its seller, its
// pricing and its auction state. There is deliberately no favourite, no
// watchlist, no reserve, no buy and no bid control anywhere in this drawer.
import { ShieldCheck, MapPin, Store, Gem } from 'lucide-react';
import { AdminDrawer } from './AdminDrawer';
import {
  peso, listingStatus, listingStatusLabel, lotCode, formatDateTime, auctionStatusLabel,
} from '../lib/adminBranchLabels';

function Field({ label, value }) {
  return (
    <div className="adm-field">
      <div className="adm-field__label">{label}</div>
      <div className="adm-field__value">{value ?? '—'}</div>
    </div>
  );
}

export function AdminJewelryDrawer({ listing, branch, onClose }) {
  const open = Boolean(listing);
  if (!open) return null;

  const auction = listing.auction || null;
  const status = listingStatus(listing);
  const isEnded = status === 'ended';
  const code = lotCode(listing);

  return (
    <AdminDrawer open={open} onClose={onClose} label={`Listing details — ${listing.name}`}>
      <div className="adm-drawer__hero">
        {listing.image_url && <img src={listing.image_url} alt="" />}
        <div className="adm-drawer__hero-scrim" />
        <div className="adm-drawer__hero-body">
          <div className="adm-drawer__tags">
            <span className="adm-drawer__lot">{code}</span>
            <span className="adm-drawer__tag">
              <i
                style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: status === 'live' ? 'var(--success)' : 'var(--muted)', display: 'block',
                }}
              />
              {listingStatusLabel(status)}
            </span>
            <span className="adm-drawer__tag adm-drawer__tag--dark">
              <ShieldCheck size={11} /> Admin monitor
            </span>
          </div>
          <h2 className="adm-drawer__title">{listing.name}</h2>
        </div>
      </div>

      <div className="adm-drawer__body">
        <section>
          <h3 className="adm-section__title">Item</h3>
          <div className="adm-field-grid">
            <Field label="Lot name" value={listing.name} />
            <Field label="Category" value={listing.category || '—'} />
            <Field label="Lot · listing id" value={code} />
            <Field label="Listing status" value={listingStatusLabel(status)} />
          </div>
        </section>

        <section>
          <h3 className="adm-section__title">Seller / shop</h3>
          <div className="adm-field-grid">
            <Field label="Shop · seller" value={listing.shop?.name || listing.shop?.owner_name || '—'} />
            <Field label="Branch" value={listing.branch?.name || branch?.name || '—'} />
          </div>
        </section>

        <section>
          <h3 className="adm-section__title">Valuation &amp; pricing</h3>
          <div className="adm-field-grid">
            <Field label="Estimated value" value={listing.price != null ? peso(listing.price) : '—'} />
            <Field label="Starting price" value={auction?.start_price != null ? peso(auction.start_price) : '—'} />
            {isEnded ? (
              <Field label="Final price" value={listing.final_price != null ? peso(listing.final_price) : '—'} />
            ) : (
              <Field label="Current bid" value={auction?.current_bid != null ? peso(auction.current_bid) : '—'} />
            )}
          </div>
        </section>

        <section>
          <h3 className="adm-section__title">Auction</h3>
          {auction ? (
            <div className="adm-field-grid">
              <Field label="Auction id" value={auction.auction_code || code} />
              <Field label="Auction status" value={auctionStatusLabel(auction.status)} />
              <Field label="Total bids" value={auction.total_bids ?? 0} />
              <Field label="Start · end" value={`${formatDateTime(auction.start_time)} → ${formatDateTime(auction.end_time)}`} />
            </div>
          ) : (
            <div className="adm-empty">No auction has been created for this listing yet.</div>
          )}
        </section>

        {listing.shop?.owner_name && (
          <div className="adm-meta-rows">
            <div className="adm-meta-row"><Store size={13} /> Seller account · <b>{listing.shop.owner_name}</b></div>
            <div className="adm-meta-row"><MapPin size={13} /> Pickup branch · <b>{listing.branch?.name || branch?.name}</b></div>
            {listing.karat_weight && <div className="adm-meta-row"><Gem size={13} /> Karat weight · <b>{listing.karat_weight}</b></div>}
          </div>
        )}
      </div>

      <div className="adm-drawer__foot">
        <ShieldCheck size={15} />
        <span>Read-only listing inspection. No customer actions available.</span>
      </div>
    </AdminDrawer>
  );
}

export default AdminJewelryDrawer;
