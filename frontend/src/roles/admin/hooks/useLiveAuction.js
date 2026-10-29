// frontend/src/roles/admin/hooks/useLiveAuction.js
// Admin live-monitoring subscription.
//
// REUSES the existing ATANY realtime infrastructure — this adds no new event
// names and no new transport. The admin listens to the same four server events
// the customer detail screen and the seller auction screen already consume:
//   bid:update        (customer/bid.controller.js)  → current/highest bid
//   auction:update    (shop-owner/auctionManage)    → start / pause / resume / end
//   auction:watchers  (services/auctionPresence)    → unique-customer watchers
//
// Admin is an OBSERVER:
// - it emits `join:auction` only (room subscription). It never emits
//   `auction:watch`, and the server only counts customers, so an admin opening a
//   monitor drawer cannot change the watcher count;
// - a `bid:update` payload updates bids/price ONLY — it never touches watchers;
// - every listener is removed on unmount and whenever the watched id set changes,
//   so reopening the tab can never double-register a handler.
import { useCallback, useEffect, useRef } from 'react';
import { socket } from '../../../shared/lib/socketClient';

function pickId(payload) {
  return payload?.auctionId ?? payload?.auction_id ?? payload?.id ?? null;
}

/** Merge a realtime patch into one auction row without inventing fields. */
export function applyPatch(auction, payload) {
  if (!auction || !payload) return auction;
  const status = payload.status ?? auction.status;
  return {
    ...auction,
    status,
    current_bid: Number(payload.currentBid ?? payload.current_bid ?? auction.current_bid ?? 0),
    start_price: Number(payload.startPrice ?? payload.start_price ?? auction.start_price ?? 0),
    bid_count: Number(payload.bid_count ?? auction.bid_count ?? 0),
    watchers: payload.watcherCount ?? payload.watcher_count ?? auction.watcher_count,
    watcher_count: Number(payload.watcherCount ?? payload.watcher_count ?? auction.watcher_count ?? 0),
    start_time: payload.start_time ?? payload.startTime ?? auction.start_time,
    end_time: payload.end_time ?? payload.endTime ?? auction.end_time,
    paused_at: payload.paused_at ?? auction.paused_at ?? null,
  };
}

export function useLiveAuction(auctions, setAuctions, onPatched) {
  const idsRef = useRef([]);
  idsRef.current = auctions.map((a) => a.id).filter(Boolean);

  const patchAuction = useCallback((auction) => {
    const found = auctions.find((a) => a.id === auction.id);
    const merged = found ? { ...found, ...auction } : auction;
    setAuctions((prev) => prev.map((a) => (a.id === merged.id ? merged : a)));
    onPatched?.(merged.id, merged);
    return merged;
  }, [auctions, setAuctions, onPatched]);

  // shared/lib/socketClient is created with autoConnect:false, so the admin
  // branch screens must open the connection themselves. We only disconnect what
  // we opened, so a customer/seller session elsewhere is never dropped.
  useEffect(() => {
    const ownsConnection = !socket.connected;
    try { socket.connect(); } catch { /* transport unavailable */ }
    return () => { if (ownsConnection) { try { socket.disconnect(); } catch { /* noop */ } } };
  }, []);

  useEffect(() => {
    const onBid = (payload) => {
      // Unrelated auction traffic is ignored (no cross-branch leakage).
      const id = pickId(payload);
      if (!id || !idsRef.current.includes(id)) return;
      const currentBid = Number(payload.currentBid ?? payload.current_bid ?? 0);
      setAuctions((prev) => prev.map((a) => (a.id === id ? { ...a, current_bid: currentBid } : a)));
      onPatched?.(id, { current_bid: currentBid });
    };
    const onAuction = (payload) => {
      const id = pickId(payload);
      if (!id || !idsRef.current.includes(id)) return;
      const merged = applyPatch(auctions.find((a) => a.id === id), payload);
      setAuctions((prev) => prev.map((a) => (a.id === id ? merged : a)));
      onPatched?.(id, {
        status: payload.status, current_bid: merged.current_bid,
        watcher_count: merged.watcher_count, bid_count: merged.bid_count,
        end_time: merged.end_time, start_time: merged.start_time,
      });
    };
    const onWatchers = (payload) => {
      const id = pickId(payload);
      if (!id || !idsRef.current.includes(id)) return;
      // Watcher counts are UNIQUE customers and are never touched by bids.
      const n = Number(payload.watcherCount ?? payload.watcher_count ?? 0);
      setAuctions((prev) => prev.map((a) => (a.id === id ? { ...a, watcher_count: n, watchers: n } : a)));
      onPatched?.(id, { watcher_count: n });
    };

    socket.on('bid:update', onBid);
    socket.on('auction:update', onAuction);
    socket.on('auction:watchers', onWatchers);
    return () => {
      socket.off('bid:update', onBid);
      socket.off('auction:update', onAuction);
      socket.off('auction:watchers', onWatchers);
    };
  }, [auctions, setAuctions, onPatched]);

  return { patchAuction };
}

export default useLiveAuction;