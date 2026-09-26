// frontend/src/roles/customer/components/BidStepper.jsx
// Reusable stepper for bidding — replaces manual numeric input
// Uses backend increment (MIN_INCREMENT = 1000) to stay in sync with server validation
import { useState, useEffect } from 'react';
import { Minus, Plus } from 'lucide-react';

const MIN_INCREMENT = 1000;

function formatPeso(n) {
  return '₱' + Number(n).toLocaleString();
}

export function BidStepper({ currentBid, startPrice, onPlaceBid, size = 'small', disabled }) {
  const base = Number(currentBid ?? startPrice ?? 0) || 0;
  const minBid = base + MIN_INCREMENT;

  const [amount, setAmount] = useState(minBid);

  useEffect(() => {
    setAmount(minBid);
  }, [minBid]);

  const increment = () => setAmount((prev) => prev + MIN_INCREMENT);
  const decrement = () => setAmount((prev) => Math.max(minBid, prev - MIN_INCREMENT));

  const isAtMin = amount <= minBid;

  const handlePlace = () => {
    const val = Math.max(minBid, Math.round(Number(amount) / MIN_INCREMENT) * MIN_INCREMENT);
    // Ensure no decimal, no below min
    if (!Number.isFinite(val) || val < minBid) return;
    onPlaceBid(val);
  };

  const isSmall = size === 'small';
  const btnSize = isSmall ? 34 : 46;
  const amountWidth = isSmall ? 86 : 110;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: isSmall ? 6 : 8, width: '100%' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0,
          border: '1px solid #C89B3C',
          borderRadius: 8,
          background: '#fffefa',
          overflow: 'hidden',
          flex: isSmall ? '1' : '0 0 auto',
          height: btnSize,
          boxShadow: '0 0 6px rgba(200,155,60,0.12)',
        }}
      >
        <button
          type="button"
          onClick={decrement}
          disabled={isAtMin || disabled}
          aria-label="Decrease bid"
          style={{
            width: btnSize,
            height: btnSize,
            display: 'grid',
            placeItems: 'center',
            border: 'none',
            borderRight: '1px solid rgba(200,155,60,0.25)',
            background: isAtMin ? '#f5f5f0' : '#fff',
            color: isAtMin ? '#b0a99a' : '#142A4A',
            cursor: isAtMin ? 'not-allowed' : 'pointer',
            flexShrink: 0,
          }}
        >
          <Minus size={isSmall ? 14 : 16} />
        </button>
        <span
          style={{
            minWidth: amountWidth,
            textAlign: 'center',
            fontSize: isSmall ? 12.5 : 14,
            fontWeight: 700,
            color: '#142A4A',
            padding: '0 8px',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          {formatPeso(amount)}
        </span>
        <button
          type="button"
          onClick={increment}
          disabled={disabled}
          aria-label="Increase bid"
          style={{
            width: btnSize,
            height: btnSize,
            display: 'grid',
            placeItems: 'center',
            border: 'none',
            borderLeft: '1px solid rgba(200,155,60,0.25)',
            background: '#fff',
            color: '#142A4A',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <Plus size={isSmall ? 14 : 16} />
        </button>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={handlePlace}
        disabled={disabled}
        style={{
          height: btnSize,
          padding: isSmall ? '0 12px' : '0 20px',
          whiteSpace: 'nowrap',
          opacity: disabled ? 0.5 : 1,
          flexShrink: 0,
        }}
      >
        {isSmall ? 'Bid' : 'Place Bid'}
      </button>
    </div>
  );
}

export const BID_INCREMENT = MIN_INCREMENT;
