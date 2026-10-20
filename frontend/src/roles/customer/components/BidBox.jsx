// frontend/src/roles/customer/components/BidBox.jsx
// Reusable bid input — now delegates to BidStepper (kept for backward compat)
import { BidStepper } from './BidStepper';

export function BidBox({ minBid, currentBid, startPrice, onBid }) {
  // Prefer explicit currentBid/startPrice over legacy minBid
  const baseBid = currentBid ?? (minBid != null ? minBid - 1000 : undefined) ?? startPrice;
  return (
    <BidStepper
      currentBid={baseBid}
      startPrice={startPrice}
      onPlaceBid={onBid}
      size="large"
    />
  );
}
