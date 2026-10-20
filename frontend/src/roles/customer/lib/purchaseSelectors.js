// frontend/src/roles/customer/lib/purchaseSelectors.js
// Summary metrics, tab counts, search/sort from real order rows.

import { normalizePurchaseStatus, PURCHASE_STATES } from './purchaseStatus';

export function mapOrderRow(r) {
  return {
    ...r,
    displayId: r.transaction_code || r.id,
    wonDate: r.winner_confirmed_at || r.date || r.created_at,
  };
}

export function computePurchaseStats(orders) {
  const list = Array.isArray(orders) ? orders : [];
  let totalSpent = 0;
  let awaitingPickup = 0;
  let collected = 0;

  for (const o of list) {
    const state = normalizePurchaseStatus(o);
    if (state === PURCHASE_STATES.COLLECTED) {
      collected += 1;
      totalSpent += Number(o.amount) || 0;
    } else if (
      state === PURCHASE_STATES.PAID ||
      state === PURCHASE_STATES.PREPARING ||
      state === PURCHASE_STATES.READY_FOR_PICKUP
    ) {
      awaitingPickup += 1;
      totalSpent += Number(o.amount) || 0;
    } else if (state === PURCHASE_STATES.PAYMENT_PENDING && o.payment_status === 'paid') {
      awaitingPickup += 1;
      totalSpent += Number(o.amount) || 0;
    }
  }

  return {
    lotsWon: list.length,
    totalSpent,
    awaitingPickup,
    collected,
  };
}

export function tabKeyForOrder(order) {
  const state = normalizePurchaseStatus(order);
  if (state === PURCHASE_STATES.COLLECTED) return 'collected';
  if (state === PURCHASE_STATES.READY_FOR_PICKUP) return 'ready';
  return 'awaiting';
}

export function countTabs(orders) {
  const list = Array.isArray(orders) ? orders : [];
  const counts = { all: list.length, awaiting: 0, ready: 0, collected: 0 };
  for (const o of list) {
    const k = tabKeyForOrder(o);
    if (counts[k] != null) counts[k] += 1;
  }
  return counts;
}

export function filterOrdersByTab(orders, tab) {
  const list = Array.isArray(orders) ? orders : [];
  if (!tab || tab === 'all') return list;
  return list.filter(o => tabKeyForOrder(o) === tab);
}

export function searchOrders(orders, q) {
  const list = Array.isArray(orders) ? orders : [];
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return list;
  return list.filter(o => {
    const hay = [
      o.displayId,
      o.transaction_code,
      o.id,
      o.item,
      o.auction_code,
      o.branch,
      o.branch_address,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(needle);
  });
}

export function sortOrders(orders, sortKey) {
  const list = [...(Array.isArray(orders) ? orders : [])];
  switch (sortKey) {
    case 'oldest':
      return list.sort((a, b) => new Date(a.wonDate || a.date || 0) - new Date(b.wonDate || b.date || 0));
    case 'highest':
      return list.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
    case 'lowest':
      return list.sort((a, b) => (Number(a.amount) || 0) - (Number(b.amount) || 0));
    case 'newest':
    default:
      return list.sort((a, b) => new Date(b.wonDate || b.date || 0) - new Date(a.wonDate || a.date || 0));
  }
}
