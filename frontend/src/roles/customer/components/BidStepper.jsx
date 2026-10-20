// frontend/src/roles/customer/components/BidStepper.jsx
// Reusable stepper for bidding — supports seller-defined per-auction minimum bid increment.
// The center amount is a real editable input; +/- steps by the auction's minimum_bid_increment.
// Customers may manually type any amount >= minimumNextBid (not restricted to exact multiples).
import { useState, useEffect, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';

export function BidStepper({ currentBid, startPrice, minimumBidIncrement = 1000, onPlaceBid, size = 'small', disabled }) {
  const increment = Number.isFinite(Number(minimumBidIncrement)) && Number(minimumBidIncrement) > 0
    ? Math.round(Number(minimumBidIncrement))
    : 1000;
  const base = Number(currentBid ?? startPrice ?? 0) || 0;
  const minBid = base + increment;

  const [amount, setAmount] = useState(String(minBid));
  const [inputError, setInputError] = useState(null);
  const isManualEdit = useRef(false);

  // Recompute minBid when currentBid or increment changes.
  // If the user is not actively editing, reset the amount to the new minimum
  // and clear any stale validation error. If the user IS editing, keep their
  // typed value; it will be re-validated on next interaction (blur or submit).
  useEffect(() => {
    if (!isManualEdit.current) {
      setAmount(String(minBid));
      setInputError(null);
    }
  }, [minBid, increment]);

  const handleAmountChange = (e) => {
    const raw = e.target.value;
    isManualEdit.current = true;
    setAmount(raw);
    // Validate while typing: show error if below minimum (but allow empty for editing)
    if (raw === '') {
      setInputError(null);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setInputError('Enter a valid amount.');
      return;
    }
    if (n < minBid) {
      setInputError(`Your bid must be at least ₱${minBid.toLocaleString()}.`);
      return;
    }
    setInputError(null);
  };

  const handleAmountBlur = () => {
    // On blur, if empty or invalid, snap to minimum
    const raw = amount.trim();
    if (raw === '') {
      setAmount(String(minBid));
      setInputError(null);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < minBid) {
      setAmount(String(minBid));
      setInputError(`Your bid must be at least ₱${minBid.toLocaleString()}.`);
      return;
    }
    setInputError(null);
  };

  const incrementBid = () => {
    const current = Number(amount);
    const next = Number.isFinite(current) ? current + increment : minBid;
    setAmount(String(Math.max(minBid, next)));
    setInputError(null);
    isManualEdit.current = true;
  };

  const decrementBid = () => {
    const current = Number(amount);
    const next = Number.isFinite(current) ? current - increment : minBid;
    setAmount(String(Math.max(minBid, next)));
    setInputError(null);
    isManualEdit.current = true;
  };

  const handlePlace = () => {
    const raw = amount.trim();
    if (raw === '') {
      setInputError('Enter a valid amount.');
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setInputError('Enter a valid amount.');
      return;
    }
    if (n < minBid) {
      setInputError(`Your bid must be at least ₱${minBid.toLocaleString()}.`);
      return;
    }
    setInputError(null);
    onPlaceBid(n);
  };

  const isAtMin = Number(amount) <= minBid;
  const isSmall = size === 'small';
  const btnSize = isSmall ? 34 : 46;
  const amountWidth = isSmall ? 86 : 110;

  const formatPeso = (n) => '₱' + Number(n).toLocaleString();

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
          onClick={decrementBid}
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
            cursor: isAtMin || disabled ? 'not-allowed' : 'pointer',
            flexShrink: 0,
          }}
        >
          <Minus size={isSmall ? 14 : 16} />
        </button>
        <input
          type="text"
          value={amount}
          onChange={handleAmountChange}
          onBlur={handleAmountBlur}
          aria-label="Your bid amount"
          style={{
            minWidth: amountWidth,
            textAlign: 'center',
            fontSize: isSmall ? 12.5 : 14,
            fontWeight: 700,
            color: '#142A4A',
            padding: '0 8px',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            width: '100%',
          }}
        />
        <button
          type="button"
          onClick={incrementBid}
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
            cursor: disabled ? 'not-allowed' : 'pointer',
            flexShrink: 0,
          }}
        >
          <Plus size={isSmall ? 14 : 16} />
        </button>
      </div>
      {inputError && (
        <span style={{ fontSize: 11, color: '#dc2626', marginLeft: 6, whiteSpace: 'nowrap' }}>{inputError}</span>
      )}
      <button
        type="button"
        className="btn btn-primary"
        onClick={handlePlace}
        disabled={disabled || !!inputError}
        style={{
          height: btnSize,
          padding: isSmall ? '0 12px' : '0 20px',
          whiteSpace: 'nowrap',
          opacity: disabled || !!inputError ? 0.5 : 1,
          flexShrink: 0,
        }}
      >
        {isSmall ? 'Bid' : 'Place Bid'}
      </button>
    </div>
  );
}
