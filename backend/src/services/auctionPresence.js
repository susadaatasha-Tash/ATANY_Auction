// backend/src/services/auctionPresence.js
// Live viewer presence for a running auction.
//
// WHAT COUNTS AS A WATCHER (see spec: admin branch monitoring):
//   A CURRENT UNIQUE AUTHENTICATED CUSTOMER USER that is viewing the auction.
//
// WHAT DOES NOT COUNT:
//   • the number of sockets (one customer may have several tabs open)
//   • bid count, watchlist/reminder rows, lifetime views
//   • admins or shop owners opening the same auction (they are not bidders)
//
// Storage: auctionId -> Map<userId, Set<socketId>>. A user is present while at
// least one of their sockets is still in the room; when their last socket
// leaves they are removed (no ghost watchers).

// auctionId -> (userId -> Set<socketId>)
const presence = new Map();
// userId -> { role, at }  (short-lived cache to avoid a DB hit per join)
const roleCache = new Map();
const ROLE_TTL_MS = 60_000;

async function resolveRole(userId) {
  const cached = roleCache.get(userId);
  if (cached && Date.now() - cached.at < ROLE_TTL_MS) return cached.role;
  try {
    const { pool } = await import('../db/pool.js');
    const { rows } = await pool.query('SELECT role FROM users WHERE id=$1', [userId]);
    const role = rows[0]?.role || null;
    roleCache.set(userId, { role, at: Date.now() });
    return role;
  } catch {
    return null;
  }
}

function getRoom(auctionId) {
  if (!presence.has(auctionId)) presence.set(auctionId, new Map());
  return presence.get(auctionId);
}

/** Number of unique customer users currently viewing the auction. */
export function getWatcherCount(auctionId) {
  const room = presence.get(auctionId);
  if (!room) return 0;
  let count = 0;
  for (const [, sockets] of room) if (sockets.size > 0) count += 1;
  return count;
}

/** Watcher counts for many auctions at once (batch friendly). */
export function getWatcherCounts(auctionIds = []) {
  const out = {};
  auctionIds.forEach((id) => { out[id] = getWatcherCount(id); });
  return out;
}

/**
 * Resolve the Socket.IO server/namespace emitter for a socket.
 * socket.io (v4) exposes the namespace as `socket.nsp`; the namespace owns the
 * server. `socket.io` / `socket.server` are kept as fallbacks.
 */
function emitterFor(socket) {
  if (!socket) return null;
  if (socket.nsp) return socket.nsp;
  if (socket.io) return socket.io;
  if (socket.server) return socket.server;
  return null;
}

function emitCount(socket, auctionId) {
  if (!socket || !auctionId) return;
  const emitter = emitterFor(socket);
  if (!emitter || typeof emitter.to !== 'function') return;
  const count = getWatcherCount(auctionId);
  try {
    emitter.to(`auction:${auctionId}`).emit('auction:presence', { auctionId, watchers: count });
  } catch { /* the room may be gone */ }
}

/**
 * A socket starts viewing an auction. Only authenticated CUSTOMERS are counted.
 * The socket still joins the public auction room (observation channel) for
 * everyone — that is how admins/sellers receive live bid + presence updates.
 */
export async function joinAuction(socket, auctionId) {
  if (!socket || !auctionId) return;
  if (!socket.rooms?.has(`auction:${auctionId}`)) socket.join(`auction:${auctionId}`);
  const userId = socket.data?.userId;
  if (!userId) return;
  const role = await resolveRole(userId);
  if (role !== 'customer') return; // admins / shop owners are observers, not watchers
  const room = getRoom(auctionId);
  if (!room.has(userId)) room.set(userId, new Set());
  room.get(userId).add(socket.id);
  socket.data.presenceAuctions = socket.data.presenceAuctions || new Set();
  socket.data.presenceAuctions.add(auctionId);
  emitCount(socket, auctionId);
}

/** A socket stops viewing an auction (detail closed / auction changed). */
export function leaveAuction(socket, auctionId) {
  if (!socket || !auctionId) return;
  const userId = socket.data?.userId;
  const room = presence.get(auctionId);
  if (room && userId && room.has(userId)) {
    const sockets = room.get(userId);
    sockets.delete(socket.id);
    if (sockets.size === 0) room.delete(userId); // last tab left → not a watcher anymore
    if (room.size === 0) presence.delete(auctionId);
  }
  try { socket.leave(`auction:${auctionId}`); } catch { /* noop */ }
  if (socket.data?.presenceAuctions) socket.data.presenceAuctions.delete(auctionId);
  emitCount(socket, auctionId);
}

/** A socket disconnected (tab closed / network drop) → remove it everywhere. */
export function handleDisconnect(socket) {
  const auctions = socket.data?.presenceAuctions;
  if (auctions && auctions.size) {
    for (const auctionId of auctions) leaveAuction(socket, auctionId);
  }
  const userId = socket.data?.userId;
  if (userId) {
    for (const [auctionId, room] of presence.entries()) {
      const sockets = room.get(userId);
      if (!sockets) continue;
      sockets.delete(socket.id);
      if (sockets.size === 0) room.delete(userId);
      if (room.size === 0) presence.delete(auctionId);
    }
  }
}

/**
 * Remove a user's presence from EVERY auction (used when an account is
 * suspended — a suspended account must not keep a live watcher presence).
 */
export function removeUserFromAllAuctions(userId) {
  if (!userId) return 0;
  let removed = 0;
  for (const [auctionId, room] of presence.entries()) {
    const sockets = room.get(userId);
    if (!sockets) continue;
    sockets.clear();
    room.delete(userId);
    removed += 1;
    if (room.size === 0) presence.delete(auctionId);
  }
  return removed;
}

/** Test helper — clear all presence state. */
export function __resetPresence() {
  presence.clear();
  roleCache.clear();
}

export default {
  joinAuction,
  leaveAuction,
  handleDisconnect,
  removeUserFromAllAuctions,
  getWatcherCount,
  getWatcherCounts,
  __resetPresence,
};
