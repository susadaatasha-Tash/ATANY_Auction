// frontend/src/roles/shop-owner/components/CreateAuctionWizard.jsx
// Create Auction Lot wizard — thin wrapper over the shared AuctionWizard.
// The wizard itself (steps, schedule picker, validation, stepper) lives in
// AuctionWizard.jsx and is shared with the Relist flow (mode="relist"), so
// there is only ONE auction wizard implementation.
//
// Edit mode stays on CreateAuctionModal (PUT: opening price + schedule only).
import { AuctionWizard } from './AuctionWizard';

export function CreateAuctionWizard({ open, onClose, onSubmit }) {
  return <AuctionWizard mode="create" open={open} onClose={onClose} onSubmit={onSubmit} />;
}

export default CreateAuctionWizard;
