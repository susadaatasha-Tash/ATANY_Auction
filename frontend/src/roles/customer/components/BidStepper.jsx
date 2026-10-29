// frontend/src/roles/customer/components/BidStepper.jsx
// Seller-defined increment stepper: [ − ] amount [ + ] + editable input.
// - Initializes at minimumNextBid (never currentBid — bidding current is invalid).
// - +/− move by exactly the auction's minimum_bid_increment.
// - − clamps at the authoritative minimum and disables there.
// - Manual typing allowed; below-minimum never submits (inline error).
// - Manual values need NOT be increment multiples (minimum, not exact step).
// - Realtime: if the minimum rises past the selected amount, the selector is
//   raised automatically (the old amount can no longer be submitted).
// Backend remains authoritative (BID_TOO_LOW adopts the server minimum).
import { useState, useEffect } from 'react';
import { Minus, Plus } from 'lucide-react';
import { minimumNextBid, incrementOf, formatPeso, DEFAULT_MIN_INCREMENT } from '../../../shared/lib/bidMinimum';

const MAX_BID = 2147483647;

export function BidStepper({ currentBid, startPrice, minIncrement, auction, onPlaceBid, size = 'small', disabled }) {
  const increment = Number.isInteger(Number(minIncrement)) && Number(minIncrement) > 0
    ? Number(minIncrement)
    : incrementOf(auction);
  const base = Number(currentBid ?? startPrice ?? 0) || 0;
  const minBid = minimumNextBid(base, increment);

  const [text, setText] = useState(String(minBid));
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState(null);
  const [serverFloor, setServerFloor] = useState(null);
  const [placing, setPlacing] = useState(false);

  const floor = serverFloor != null ? Math.max(serverFloor, minBid) : minBid;
  const numericText = (() => {
    const t = String(text ?? '').trim().replace(/[₱,\s]/g, '');
    const n = Number(t);
    return t !== '' && Number.isFinite(n) ? n : NaN;
  })();

  // Minimum moves (realtime / new current bid): untouched input tracks it;
  // a touched amount below the new floor is raised automatically since the
  // old amount can no longer be submitted.
  useEffect(() => {
    setServerFloor(null);
    setText((prev) => {
      if (!touched) return String(minBid);
      const n = Number(String(prev ?? '').trim().replace(/[₱,\s]/g, ''));
      if (prev === '' || !Number.isFinite(n) || n < minBid) return String(minBid);
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minBid]);

  function validate(raw) {
    const t = String(raw ?? '').trim().replace(/[₱,\s]/g, '');
    if (!t) return { ok: false, message: 'Enter your bid amount.' };
    const n = Number(t);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, message: 'Enter a valid whole-peso amount.' };
    if (n < floor) return { ok: false, message: `Your bid must be at least ${formatPeso(floor)}.` };
    if (n > MAX_BID) return { ok: false, message: 'Bid amount is too large.' };
    return { ok: true, value: n };
  }

  const liveError = (() => {
    if (!touched && error == null) return null;
    const v = validate(text);
    return v.ok ? null : v.message;
  })();

  const stepDown = () => {
    const cur = Number.isFinite(numericText) ? numericText : floor;
    setText(String(Math.max(floor, cur - increment)));
    setTouched(true);
    setError(null);
  };
  const stepUp = () => {
    const cur = Number.isFinite(numericText) ? numericText : floor;
    setText(String(Math.min(MAX_BID, cur + increment)));
    setTouched(true);
    setError(null);
  };

  const atMin = !Number.isFinite(numericText) || numericText <= floor;
  const plusCapped = Number.isFinite(numericText) && numericText + increment > MAX_BID;

  const handlePlace = async () => {
    const v = validate(text);
    if (!v.ok) { setError(v.message); return; }
    setError(null);
    setPlacing(true);
    try {
      await onPlaceBid(v.value);
      setTouched(false);
      setText(String(minBid));
    } catch (e) {
      if (e?.code === 'BID_TOO_LOW' && Number.isFinite(Number(e.minimum_bid))) {
        setServerFloor(Number(e.minimum_bid));
        setError(e.message || `Your bid is too low. The minimum next bid is ${formatPeso(e.minimum_bid)}.`);
      } else {
        setError(e?.message || 'Bid failed. Please try again.');
      }
    } finally {
      setPlacing(false);
    }
  };

  const isSmall = size === 'small';
  const btnSize = isSmall ? 34 : 46;
  const stepBtn = (disabledNow, extra) => ({
    width: btnSize,
    height: btnSize,
    display: 'grid',
    placeItems: 'center',
    border: 'none',
    background: disabledNow ? '#f5f5f0' : '#fff',
    color: disabledNow ? '#b0a99a' : '#142A4A',
    cursor: disabledNow ? 'not-allowed' : 'pointer',
    flexShrink: 0,
    ...extra,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
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
            onClick={stepDown}
            disabled={disabled || placing || atMin}
            aria-label={`Decrease bid by ${formatPeso(increment)}`}
            style={stepBtn(disabled || placing || atMin, { borderRight: '1px solid rgba(200,155,60,0.25)' })}
          >
            <Minus size={isSmall ? 14 : 16} />
          </button>
          <input
            type="text"
            inputMode="numeric"
            value={text}
            disabled={disabled || placing}
            aria-label="Your bid amount"
            onChange={(e) => { setText(e.target.value); setTouched(true); setError(null); }}
            style={{
              flex: 1,
              minWidth: isSmall ? 64 : 86,
              height: btnSize,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              textAlign: 'center',
              fontSize: isSmall ? 12.5 : 14,
              fontWeight: 700,
              color: '#142A4A',
              padding: '0 6px',
            }}
          />
          <button
            type="button"
            onClick={stepUp}
            disabled={disabled || placing || plusCapped}
            aria-label={`Increase bid by ${formatPeso(increment)}`}
            style={stepBtn(disabled || placing || plusCapped, { borderLeft: '1px solid rgba(200,155,60,0.25)' })}
          >
            <Plus size={isSmall ? 14 : 16} />
          </button>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handlePlace}
          disabled={disabled || placing || (!Number.isFinite(numericText) || numericText < floor)}
          style={{ height: btnSize, padding: isSmall ? '0 12px' : '0 20px', whiteSpace: 'nowrap', opacity: disabled ? 0.5 : 1, flexShrink: 0 }}
        >
          {placing ? 'Placing…' : isSmall ? 'Bid' : 'Place Bid'}
        </button>
      </div>
      {(liveError || error) && (
        <div role="alert" style={{ fontSize: 11.5, fontWeight: 600, color: '#b45252' }}>{error || liveError}</div>
      )}
    </div>
  );
}

export const BID_INCREMENT = DEFAULT_MIN_INCREMENT;
