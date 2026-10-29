// backend/src/services/winnerRules.js
//
// The ATANY winner lifecycle rules, in ONE place so the three participants in
// the money path can never disagree:
//
//   auctionClosingService  — who is Winner #1, and when their window starts
//   winnerExpiration       — who is the next eligible bidder, and when it rotates
//   manualPayment / checkout — is this buyer still inside their payment window
//
// BUSINESS RULE
// -------------
//   Auction ends -> highest eligible DISTINCT bidder is Winner #1 (rank 1)
//   -> 7-day payment window
//      -> paid  -> assignment is financially secured, no fallback ever
//      -> unpaid -> eligibility expires, the SAME order is reassigned to the
//                   next-highest eligible DISTINCT bidder at THEIR OWN highest
//                   valid bid (rank 2), with a brand-new 7-day window
//                   -> repeats for rank 3, 4, ... until someone pays or no
//                      eligible bidder remains (order becomes 'expired').
//
// One auction = one order. Reassignment MUTATES that order; it never creates a
// second one (enforced by orders_auction_id_unique).

import { pool } from '../db/pool.js';

/** The 7-day payment window. Single constant — never inlined elsewhere. */
export const WINNER_PAYMENT_WINDOW_DAYS = 7;

/**
 * Stable business code for "this winner's window closed". Lives here (not in
 * manualPayment) because the GATEWAY routes answer with the same contract, and
 * the gateway controller must not depend on the manual-payment module.
 */
export const PAYMENT_WINDOW_EXPIRED = 'PAYMENT_WINDOW_EXPIRED';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The canonical payment deadline for a freshly assigned winner.
 * Always a real Date derived from an authoritative timestamp — never a
 * pre-formatted string, never the frontend's arithmetic.
 */
export function deadlineFrom(confirmedAt) {
  return new Date(new Date(confirmedAt).getTime() + WINNER_PAYMENT_WINDOW_DAYS * DAY_MS);
}

/**
 * Deadline resolution for an EXISTING order row.
 * payment_deadline is canonical. The fallbacks only matter for rows written
 * before the column existed, so they degrade safely instead of lying.
 */
export function resolveDeadline(order) {
  if (order?.payment_deadline) return new Date(order.payment_deadline);
  const base = order?.winner_confirmed_at || order?.created_at;
  if (!base) return null;
  return deadlineFrom(base);
}

/** True when the order's payment window has elapsed. */
export function isPastDeadline(order, now = new Date()) {
  const deadline = resolveDeadline(order);
  return !!deadline && now.getTime() >= deadline.getTime();
}

/**
 * Eligible bidders for an auction, best bid first.
 *
 * Eligibility rule (IDENTICAL to the one the original winner is chosen with —
 * deliberately shared so the two can never diverge):
 *   · same auction
 *   · NOT fraud-flagged (flagged = false OR NULL)
 *   · ranked by amount DESC, then created_at ASC as a deterministic tie-break
 *   · deduplicated by user_id, keeping that user's HIGHEST eligible bid
 *
 * @returns {Promise<Array<{user_id:string, amount:number, created_at:*=, position:number}>>}
 *          `position` is 1-based and equals the winner rank this bidder would take.
 */
export async function getEligibleRankedBidders(auctionId, client = pool) {
  const { rows } = await client.query(
    `SELECT user_id, amount, created_at
       FROM bids
      WHERE auction_id = $1
        AND (flagged = false OR flagged IS NULL)
      ORDER BY amount DESC, created_at ASC`,
    [auctionId]
  );
  const seen = new Map();
  for (const bid of rows) {
    const key = String(bid.user_id);
    // ORDER BY amount DESC means the first row for a user IS their highest bid.
    if (!seen.has(key)) seen.set(key, bid);
  }
  return Array.from(seen.values()).map((b, i) => ({ ...b, position: i + 1 }));
}

/**
 * The next eligible bidder after the CURRENT winner, or null when the chain is
 * exhausted. Never returns the current winner or anyone above them.
 *
 * Deterministic rule (winner_rank is the authority, not list position):
 *   nextPosition = max(currentWinnerPosition + 1, winner_rank)
 *
 * Why both terms:
 *   · currentWinnerPosition + 1  — the normal downward walk. Repeated bids from
 *     one user already collapsed to a single position, so one user can never
 *     consume two fallback slots.
 *   · winner_rank                — the persisted count of positions already
 *     consumed. It keeps the walk downward when the current winner is NO LONGER
 *     in the ranking (e.g. every one of their bids was later fraud-flagged), so
 *     we can never restart at position 1 and reselect a previously expired
 *     winner. max() also self-heals any rank/position disagreement by never
 *     moving backwards.
 *
 * @param {{ranked:Array, currentBuyerId:string, winnerRank?:number}} input
 * @returns {object|null}
 */
export function nextEligibleBidder({ ranked, currentBuyerId, winnerRank = 1 }) {
  if (!Array.isArray(ranked) || ranked.length === 0) return null;
  const idx = ranked.findIndex((b) => String(b.user_id) === String(currentBuyerId));
  const consumed = Number.isFinite(Number(winnerRank)) && Number(winnerRank) > 0 ? Number(winnerRank) : 1;
  const nextPosition = Math.max(idx >= 0 ? idx + 2 : consumed, consumed);
  if (nextPosition < 1 || nextPosition > ranked.length) return null;
  return ranked[nextPosition - 1] || null;
}

export default {
  WINNER_PAYMENT_WINDOW_DAYS,
  PAYMENT_WINDOW_EXPIRED,
  deadlineFrom,
  resolveDeadline,
  isPastDeadline,
  getEligibleRankedBidders,
  nextEligibleBidder,
};