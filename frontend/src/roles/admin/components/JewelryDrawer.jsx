// frontend/src/roles/admin/components/JewelryDrawer.jsx
// Admin — Jewelry details drawer (read-only listing inspection).
//
// Fields come straight from the branch-scoped listing payload. The drawer has
// NO heart, favourite, watchlist, reserve, buy, checkout or bid control: admin
// inspects inventory, it does not act on it. The fixed footer states that.
import { Gavel, ShieldCheck, Store, Users } from 'lucide-react';
import { Drawer } from '../../../shared/components/Drawer';
import { fmtMoney, fmtWhen, capitaliseStatus } from '../lib/branchFormatters';
import '../pages/admin-branches.css';

export function JewelryDrawer({ listing, branch, onClose }) {
  if (!listing) return null;
  const auction = listing.auction;
  const status = listing.status === 'pending' ? 'Draft' : listing.status === 'rejected' ? 'Rejected' : 'Live';
  const ended = auction?.status === 'ended';

  return (
    <Drawer
      open={!!listing}
      onClose={onClose}
      labelledBy="jewelry-drawer-title"
      className="abx-drawer"
      footer={
        <p className="abx-drawer__foot">
          <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" />
          Read-only listing inspection. No customer actions available.
        </p>
      }
    >
      <div className="abx-drawer__hero">
        {listing.image_url ? (
          <img src={listing.image_url} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        ) : <span className="abx-drawer__ph" aria-hidden="true" />}
        <div className="abx-drawer__hero-text">
          <span className="abx-drawer__lot">{auction?.lot_id || listing.id.slice(0, 8)}</span>
          <span className={`abx-badge${status === 'Live' ? ' is-open' : ''}`}><i aria-hidden="true" />{status}</span>
          <span className="abx-drawer__monitor"><ShieldCheck size={13} strokeWidth={2} aria-hidden="true" />Admin monitor</span>
          <h2 id="jewelry-drawer-title" className="abx-drawer__title">{listing.name}</h2>
        </div>
      </div>

      <section className="abx-dsec">
        <h3>Item</h3>
        <div className="abx-fields">
          <Field k="Lot name" v={listing.name} wide />
          <Field k="Category" v={listing.category} icon={<Store size={13} strokeWidth={2} aria-hidden="true" />} />
          <Field k="Lot / listing ID" v={auction?.lot_id || listing.id.slice(0, 8)} />
          <Field k="Listing status" v={status} wide />
        </div>
      </section>

      <section className="abx-dsec">
        <h3>Seller / shop</h3>
        <div className="abx-fields">
          <Field k="Shop / seller" v={listing.seller_name} icon={<Users size={13} strokeWidth={2} aria-hidden="true" />} />
          <Field k="Branch" v={listing.branch_name || branch?.name} icon={<Store size={13} strokeWidth={2} aria-hidden="true" />} />
        </div>
      </section>

      <section className="abx-dsec">
        <h3>Valuation &amp; pricing</h3>
        <div className="abx-fields">
          <Field k="Estimated value" v={fmtMoney(listing.estimate)} wide />
          <Field k="Starting price" v={auction ? fmtMoney(auction.start_price) : '—'} />
          <Field k={ended ? 'Final price' : 'Current bid'} v={auction ? fmtMoney(auction.current_bid) : '—'} gold />
        </div>
      </section>

      <section className="abx-dsec">
        <h3>Auction</h3>
        <div className="abx-fields">
          <Field k="Auction ID" v={auction?.lot_id || '—'} />
          <Field k="Auction status" v={auction ? capitaliseStatus(auction.status) : 'No auction'} />
          <Field k="Total bids" v={String(auction?.bid_count ?? 0)} icon={<Gavel size={13} strokeWidth={2} aria-hidden="true" />} />
          <Field k="Start / end" v={auction ? `${fmtWhen(auction.start_time)} → ${fmtWhen(auction.end_time)}` : '—'} />
        </div>
      </section>
    </Drawer>
  );
}

function Field({ k, v, icon, gold, wide }) {
  return (
    <div className={`abx-field${wide ? ' abx-field--wide' : ''}${gold ? ' abx-field--gold' : ''}`}>
      <span className="abx-field__k">{k}</span>
      <span className="abx-field__v">{icon}{v ?? '—'}</span>
    </div>
  );
}

export default JewelryDrawer;