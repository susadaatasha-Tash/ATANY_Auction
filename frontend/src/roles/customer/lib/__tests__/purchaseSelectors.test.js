// frontend/src/roles/customer/lib/__tests__/purchaseSelectors.test.js
import { describe, expect, it } from 'vitest';
import {
  computePurchaseStats,
  countTabs,
  filterOrdersByTab,
  mapOrderRow,
  searchOrders,
  sortOrders,
  tabKeyForOrder,
} from '../purchaseSelectors';

const orders = [
  {
    id: 1,
    transaction_code: 'TXN-1001',
    item: 'Gold Ring',
    amount: 25000,
    status: 'pending',
    payment_status: null,
    branch: 'SM North',
    auction_code: 'AUC-001',
    date: '2026-09-18T10:00:00Z',
  },
  {
    id: 2,
    transaction_code: 'TXN-1002',
    item: 'Diamond Necklace',
    amount: 80000,
    status: 'ready_pickup',
    payment_status: 'paid',
    branch: 'Trinoma',
    date: '2026-09-10T10:00:00Z',
  },
  {
    id: 3,
    transaction_code: 'TXN-1003',
    item: 'Silver Bracelet',
    amount: 15000,
    status: 'completed',
    payment_status: 'paid',
    branch: 'SM North',
    date: '2026-08-01T10:00:00Z',
  },
];

describe('computePurchaseStats', () => {
  it('computes lots won, awaiting pickup, collected, total spent', () => {
    const s = computePurchaseStats(orders);
    expect(s.lotsWon).toBe(3);
    expect(s.awaitingPickup).toBe(1);
    expect(s.collected).toBe(1);
    // total spent = paid/collected amounts only (25000 unpaid pending excluded)
    expect(s.totalSpent).toBe(95000);
  });

  it('handles empty list', () => {
    expect(computePurchaseStats([])).toEqual({ lotsWon: 0, totalSpent: 0, awaitingPickup: 0, collected: 0 });
  });
});

describe('tab helpers', () => {
  it('maps tab keys', () => {
    expect(tabKeyForOrder(orders[0])).toBe('awaiting');
    expect(tabKeyForOrder(orders[1])).toBe('ready');
    expect(tabKeyForOrder(orders[2])).toBe('collected');
  });

  it('counts tabs', () => {
    expect(countTabs(orders)).toEqual({ all: 3, awaiting: 1, ready: 1, collected: 1 });
  });

  it('filters by tab', () => {
    expect(filterOrdersByTab(orders, 'ready')).toHaveLength(1);
    expect(filterOrdersByTab(orders, 'all')).toHaveLength(3);
  });
});

describe('searchOrders', () => {
  it('matches invoice, item, branch, lot', () => {
    expect(searchOrders(orders, 'TXN-1002')).toHaveLength(1);
    expect(searchOrders(orders, 'Necklace')).toHaveLength(1);
    expect(searchOrders(orders, 'SM North')).toHaveLength(2);
    expect(searchOrders(orders, 'AUC-001')).toHaveLength(1);
  });

  it('returns all when query empty', () => {
    expect(searchOrders(orders, '')).toHaveLength(3);
  });
});

describe('sortOrders', () => {
  it('sorts newest first by default', () => {
    const sorted = sortOrders(orders, 'newest');
    expect(sorted[0].id).toBe(1);
    expect(sorted[2].id).toBe(3);
  });

  it('sorts oldest first', () => {
    expect(sortOrders(orders, 'oldest')[0].id).toBe(3);
  });

  it('sorts by amount', () => {
    expect(sortOrders(orders, 'highest')[0].id).toBe(2);
    expect(sortOrders(orders, 'lowest')[0].id).toBe(3);
  });
});

describe('mapOrderRow', () => {
  it('adds displayId from transaction_code', () => {
    const m = mapOrderRow({ id: 'abc', transaction_code: 'TXN-9', date: '2026-01-01' });
    expect(m.displayId).toBe('TXN-9');
    expect(m.wonDate).toBe('2026-01-01');
  });
});
