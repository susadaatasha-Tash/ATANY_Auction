// backend/src/services/auctionPresence.js
// Authoritative in-memory presence for LIVE auction viewers ("WATCHERS").
// Distinct from watchlists/favorites (historical saves) and bid counts.
// Structure: Map<auctionId, Map<userId, Set<socketId>>> — unique users,
// multi-tab safe (same user, N sockets, counted once), disconnect-cleaned.
// Counts reset on backend restart (correct for active-presence semantics).
// Pure logic (no sockets/DB here) so it is unit-testable; wiring lives in
// index.js (join/leave/disconnect) and auctionClosingService (end cleanup).

const byAuction = new Map(); // auctionId -> Map<userId, Set<socketId>>
const bySocket = new Map(); // socketId -> Set<auctionId>
const listeners = new Set(); // (auctionId, count) => void — e.g. socket emit

/** Subscribe to count changes (index.js fans out to rooms). Returns unsubscribe. */
export function onPresenceChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(auctionId, count) {
  for (const fn of listeners) {
    try { fn(auctionId, count); } catch {}
  }
}

const AUCTION_ID_RE = /^[0-9a-fA-F-]{1,64}$/;

export function isValidAuctionId(id) {
  return typeof id === 'string' && AUCTION_ID_RE.test(id);
}

function normId(v) {
  return String(v || '').trim();
}

/** Register a watching socket. Returns unique watcher count (-1 if rejected). */
export function joinWatcher({ auctionId, userId, socketId }) {
  auctionId = normId(auctionId);
  userId = normId(userId);
  socketId = normId(socketId);
  if (!isValidAuctionId(auctionId) || !userId || !socketId) return -1;
  let users = byAuction.get(auctionId);
  if (!users) {
    users = new Map();
    byAuction.set(auctionId, users);
  }
  let sockets = users.get(userId);
  if (!sockets) {
    sockets = new Set();
    users.set(userId, sockets);
  }
  sockets.add(socketId);
  let auctions = bySocket.get(socketId);
  if (!auctions) {
    auctions = new Set();
    bySocket.set(socketId, auctions);
  }
  auctions.add(auctionId);
  notify(auctionId, users.size);
  return users.size;
}

/**
 * Remove one socket from one auction. Returns { count, removed } where count
 * is the remaining unique watcher count (-1 if the auction was unknown).
 */
export function leaveWatcher({ auctionId, socketId }) {
  auctionId = normId(auctionId);
  socketId = normId(socketId);
  const users = byAuction.get(auctionId);
  if (!users) return { count: -1, removed: false };
  let removed = false;
  for (const [userId, sockets] of users) {
    if (sockets.delete(socketId)) {
      removed = true;
      if (!sockets.size) users.delete(userId);
    }
  }
  const auctions = bySocket.get(socketId);
  if (auctions) {
    auctions.delete(auctionId);
    if (!auctions.size) bySocket.delete(socketId);
  }
  if (!users.size) byAuction.delete(auctionId);
  if (removed) notify(auctionId, users.size);
  return { count: users.size, removed };
}

/**
 * Remove a socket from EVERY auction (disconnect). Returns the list of
 * { auctionId, count } for auctions whose unique count changed.
 */
export function removeSocket(socketId) {
  socketId = normId(socketId);
  const auctions = bySocket.get(socketId);
  if (!auctions) return [];
  const changed = [];
  for (const auctionId of [...auctions]) {
    const before = watcherCount(auctionId);
    leaveWatcher({ auctionId, socketId });
    const after = watcherCount(auctionId);
    if (after !== before) changed.push({ auctionId, count: after });
  }
  return changed;
}

/**
 * Remove a USER (all of their sockets, i.e. every tab) from EVERY auction they
 * are currently watching. Used when an admin suspends the account: presence
 * eligibility is `role === customer AND status === active`, so a suspended user
 * must disappear from the count everywhere at once — never a ghost watcher.
 *
 * Returns the list of { auctionId, count } whose unique count changed so the
 * caller can broadcast the fresh numbers.
 */
export function removeUser(userId) {
  userId = normId(userId);
  if (!userId) return [];
  const changed = [];
  for (const [auctionId, users] of [...byAuction]) {
    const sockets = users.get(userId);
    if (!sockets) continue;
    for (const socketId of sockets) {
      const auctions = bySocket.get(socketId);
      if (auctions) {
        auctions.delete(auctionId);
        if (!auctions.size) bySocket.delete(socketId);
      }
    }
    users.delete(userId);
    changed.push({ auctionId, count: users.size });
    if (!users.size) byAuction.delete(auctionId);
  }
  return changed;
}

/** Every auction id a user is currently watching (all tabs). */
export function auctionsForUser(userId) {
  userId = normId(userId);
  const out = [];
  for (const [auctionId, users] of byAuction) {
    if (users.has(userId)) out.push(auctionId);
  }
  return out;
}

/** Unique watcher count for an auction (0 when nobody is watching). */
export function watcherCount(auctionId) {
  const users = byAuction.get(normId(auctionId));
  return users ? users.size : 0;
}

/** Clear all presence for an auction (auction ended). Returns true if any existed. */
export function clearAuction(auctionId) {
  auctionId = normId(auctionId);
  const users = byAuction.get(auctionId);
  if (!users) return false;
  for (const [, sockets] of users) {
    for (const socketId of sockets) {
      const auctions = bySocket.get(socketId);
      if (auctions) {
        auctions.delete(auctionId);
        if (!auctions.size) bySocket.delete(socketId);
      }
    }
  }
  byAuction.delete(auctionId);
  notify(auctionId, 0);
  return true;
}

/** Test-only: reset all presence state. */
export function __resetPresence() {
  byAuction.clear();
  bySocket.clear();
}
