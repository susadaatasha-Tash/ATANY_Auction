// frontend/src/shared/hooks/useFraudCheck.js
// Client-side preview only — spec 4.2 mandates server-side fraudCheck is authoritative.
// Mirrors customer-dashboard.html:754-793 checkSuspicious() but must NOT be trusted as security.
import { useRef } from 'react';

export function useFraudCheck() {
  const times = useRef([]);
  return (amount, previousBid) => {
    const now = Date.now();
    times.current = times.current.filter((t) => now - t < 60000);
    times.current.push(now);
    const jumpRatio = previousBid > 0 ? amount / previousBid : 1;
    const jumpAmount = amount - previousBid;
    if (jumpRatio >= 2.5 || jumpAmount >= 50000) return { flagged: true, reason: 'unusually large bid jump' };
    if (times.current.length >= 4) return { flagged: true, reason: 'rapid bidding activity' };
    return { flagged: false };
  };
}
