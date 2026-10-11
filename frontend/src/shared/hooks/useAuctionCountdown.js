// frontend/src/shared/hooks/useAuctionCountdown.js
// Extracted from repeated countdown logic:
// atany-landing-page.html:1504, admin.html:2260, customer-dashboard.html:1081, shop-owner-dashboard.html:778
// Spec 5.2: client countdown is cosmetic only — winner decided server-side.
import { useEffect, useState } from 'react';

export function useAuctionCountdown(initialSec) {
  const [sec, setSec] = useState(Number(initialSec) || 0);
  useEffect(() => {
    setSec(Number(initialSec) || 0);
  }, [initialSec]);
  useEffect(() => {
    if (sec <= 0) return;
    const id = setInterval(() => setSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [sec]);
  return sec;
}

export function formatCountdown(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const secRem = Math.floor(s % 60);
  if (d > 0) return `${d}d ${h}h ${m}m ${secRem}s`;
  return `${h}h ${m}m ${secRem}s`;
}

// Shared scheduled-auction countdown — single source of truth for Customer
// Auctions and Seller My Auctions. Input is milliseconds until start_time
// (same authoritative auction.start_time on both pages, parsed via new Date()).
// Never shows 0h/0m units or negative values.
export function formatOpensIn(diffMs) {
  const ms = Number(diffMs);
  if (!Number.isFinite(ms) || ms <= 0) return 'Opens now';
  const totalSec = Math.floor(ms / 1000);
  if (totalSec <= 0) return 'Opens now';
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `Opens in ${d}d ${h}h ${m}m`;
  if (h > 0) return `Opens in ${h}h ${m}m ${String(s).padStart(2, '0')}s`;
  if (m > 0) return `Opens in ${m}m ${String(s).padStart(2, '0')}s`;
  return `Opens in ${String(s).padStart(2, '0')}s`;
}
