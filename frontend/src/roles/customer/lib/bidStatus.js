// frontend/src/roles/customer/lib/bidStatus.js
// My Bids status helpers — one source of truth for how a bid row is presented.
//
// The facts come from the backend (GET /customer/bids):
//   auction_status  effective auction state (live | scheduled | ended | paused)
//   is_leading      the customer is the current highest (unflagged) bidder
//   won             the customer is the order's buyer and the order is valid
//
// A live auction is NEVER "won"/"lost" — only "winning"/"outbid". An ended
// auction is decided by the authoritative order state (the winner can change
// when a payment deadline expires), never by comparing bid amounts.

export const BID_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'winning', label: 'Winning' },
  { value: 'outbid', label: 'Outbid' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

export const BID_STATUS_META = {
  winning: { label: 'Winning', tone: 'green' },
  outbid: { label: 'Outbid', tone: 'amber' },
  won: { label: 'Won', tone: 'green' },
  lost: { label: 'Lost', tone: 'slate' },
  active: { label: 'Active', tone: 'blue' },
};

/** The display status of one My Bids row. */
export function bidDisplayStatus(row) {
  if (!row) return 'active';
  const ended = String(row.auction_status || '').toLowerCase() === 'ended';
  if (ended) return row.won ? 'won' : 'lost';
  const live = String(row.auction_status || '').toLowerCase() === 'live';
  if (live) return row.is_leading ? 'winning' : 'outbid';
  // scheduled / paused — the customer participates but the auction is not running
  return 'active';
}

/** 'active' = the customer participates in a running auction, 'past' = ended. */
export function bidScope(row) {
  if (!row) return 'active';
  return String(row.auction_status || '').toLowerCase() === 'ended' ? 'past' : 'active';
}

export function bidStatusMeta(status) {
  return BID_STATUS_META[status] || BID_STATUS_META.active;
}

/** Text searched by the My Bids search box (item, category, branch, code). */
export function bidSearchText(row) {
  if (!row) return '';
  return [row.item, row.category, row.karat_weight, row.branch_name, row.auction_code]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
