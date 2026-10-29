// frontend/src/roles/customer/components/BidBox.jsx
// Reusable bid input — delegates to BidStepper (kept for backward compat)
import { BidStepper } from './BidStepper';

export function BidBox({ minBid, currentBid, startPrice, minIncrement, auction, onBid }) {
  return (
    <BidStepper
      currentBid={currentBid ?? minBid ?? startPrice}
      startPrice={startPrice}
      minIncrement={minIncrement}
      auction={auction}
      onPlaceBid={onBid}
      size="large"
    />
  );
}
