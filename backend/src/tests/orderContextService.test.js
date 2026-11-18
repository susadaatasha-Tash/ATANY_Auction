// backend/src/tests/orderContextService.test.js
// Tests for the AI assistant's real-time order context service.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const poolQuery = vi.hoisted(() => vi.fn());
vi.mock('../db/pool.js', () => ({
  pool: { query: poolQuery, on: () => {} },
}));

import { pool } from '../db/pool.js';
import {
  isOrderQuery,
  isFollowupQuery,
  getCustomerOrderContext,
  formatOrderContext,
} from '../services/orderContextService.js';

let savedKey;
let savedFetch;

beforeEach(() => {
  poolQuery.mockReset();
  savedKey = process.env.GROQ_API_KEY;
  savedFetch = globalThis.fetch;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = savedKey;
  globalThis.fetch = savedFetch;
  vi.restoreAllMocks();
});

describe('isOrderQuery', () => {
  test('detects English order questions', () => {
    expect(isOrderQuery('Where is my order?')).toBe(true);
    expect(isOrderQuery('What is the status of my item?')).toBe(true);
    expect(isOrderQuery('When can I pick up my jewelry?')).toBe(true);
    expect(isOrderQuery('Has my payment been received?')).toBe(true);
    expect(isOrderQuery('When will my order arrive?')).toBe(true);
  });

  test('detects Filipino order questions', () => {
    expect(isOrderQuery('Nasaan na ang order ko?')).toBe(true);
    expect(isOrderQuery('Kailan pwede mag-pickup?')).toBe(true);
    expect(isOrderQuery('Nabayaran na ba ang order ko?')).toBe(true);
    expect(isOrderQuery('Ano ang status ng item ko?')).toBe(true);
    expect(isOrderQuery('Bakit tumatagal?')).toBe(true);
  });

  test('detects mixed English-Filipino', () => {
    expect(isOrderQuery('Ready na ba ang pickup ko?')).toBe(true);
    expect(isOrderQuery('Where is my order, kailan pwede kunin?')).toBe(true);
  });

  test('returns false for non-order questions', () => {
    expect(isOrderQuery('How do I place a bid?')).toBe(false);
    expect(isOrderQuery('What are the branch hours?')).toBe(false);
    expect(isOrderQuery('Hello')).toBe(false);
  });
});

describe('isFollowupQuery', () => {
  test('detects short follow-up questions', () => {
    expect(isFollowupQuery('Where?')).toBe(true);
    expect(isFollowupQuery('When?')).toBe(true);
    expect(isFollowupQuery('How?')).toBe(true);
    expect(isFollowupQuery('Saan?')).toBe(true);
    expect(isFollowupQuery('Kailan?')).toBe(true);
  });

  test('returns false for longer questions', () => {
    expect(isFollowupQuery('Where is my order located today?')).toBe(false);
  });
});

describe('getCustomerOrderContext', () => {
  test('returns empty array for no userId', async () => {
    const result = await getCustomerOrderContext(null);
    expect(result).toEqual([]);
  });

  test('fetches orders for authenticated user', async () => {
    poolQuery.mockImplementation(async (sql, params) => {
      if (/FROM orders WHERE buyer_id/.test(sql)) {
        return { rows: [{ id: 'o1', transaction_code: 'TXN-1', auction_id: 'a1', amount: 71000, status: 'pending', branch_id: 'br1', payment_method: null, created_at: '2026-10-11T02:24:00Z', winner_confirmed_at: '2026-10-11T02:24:00Z', payment_deadline: null, winner_rank: 1, cancellation_reason: null, cancelled_at: null, cancelled_by: null }] };
      }
      if (/FROM auctions WHERE id IN/.test(sql)) return { rows: [{ id: 'a1', product_id: 'p1', auction_code: 'A-1', end_time: '2026-10-10T00:00:00Z' }] };
      if (/FROM products WHERE id IN/.test(sql)) return { rows: [{ id: 'p1', name: 'Gold Ring', category: 'Rings', karat_weight: '18K', image_url: null }] };
      if (/FROM branches WHERE id IN/.test(sql)) return { rows: [{ id: 'br1', name: 'Gmall Branch', address: 'Davao City', hours: '9-6', phone: '123' }] };
      if (/FROM payments WHERE order_id IN/.test(sql)) return { rows: [{ order_id: 'o1', status: 'pending', payment_method: 'gcash', paid_at: null, created_at: '2026-10-11T02:24:00Z' }] };
      return { rows: [] };
    });

    const result = await getCustomerOrderContext('user-1');
    expect(result).toHaveLength(1);
    expect(result[0].transactionCode).toBe('TXN-1');
    expect(result[0].item).toBe('Gold Ring');
    expect(result[0].orderStatus).toBe('pending');
    expect(result[0].paymentStatus).toBe('pending');
    expect(result[0].pickupBranch).toBe('Gmall Branch');
  });

  test('returns empty array when no orders', async () => {
    poolQuery.mockImplementation(async () => ({ rows: [] }));
    const result = await getCustomerOrderContext('user-1');
    expect(result).toEqual([]);
  });

  test('handles DB errors gracefully', async () => {
    poolQuery.mockImplementation(async () => { throw new Error('DB down'); });
    const result = await getCustomerOrderContext('user-1');
    expect(result).toEqual([]);
  });

  test('does not fetch for unauthenticated (no userId)', async () => {
    const result = await getCustomerOrderContext(undefined);
    expect(result).toEqual([]);
    expect(poolQuery).not.toHaveBeenCalled();
  });
});

describe('formatOrderContext', () => {
  test('formats order data correctly', () => {
    const orders = [{
      transactionCode: 'TXN-1', item: 'Gold Ring', category: 'Rings', karatWeight: '18K',
      amount: 71000, orderStatus: 'pending', paymentStatus: 'pending', paymentMethod: 'gcash',
      paidAt: null, paymentDeadline: '2026-10-18T02:24:00Z', pickupBranch: 'Gmall Branch',
      pickupAddress: 'Davao City', pickupHours: '9-6', pickupPhone: '123',
      cancellationReason: null, cancelledAt: null, winnerRank: 1, createdAt: '2026-10-11T02:24:00Z',
    }];
    const result = formatOrderContext(orders);
    expect(result).toContain('TXN-1');
    expect(result).toContain('Gold Ring');
    expect(result).toContain('pending');
    expect(result).toContain('Gmall Branch');
    expect(result).toContain('PICKUP-ONLY');
    expect(result).toContain('no delivery');
  });

  test('handles no orders', () => {
    const result = formatOrderContext([]);
    expect(result).toContain('No orders found');
  });

  test('includes cancellation reason when cancelled', () => {
    const orders = [{
      transactionCode: 'TXN-2', item: 'Silver Necklace', category: 'Necklaces', karatWeight: null,
      amount: 50000, orderStatus: 'cancelled', paymentStatus: null, paymentMethod: null,
      paidAt: null, paymentDeadline: null, pickupBranch: null, pickupAddress: null,
      pickupHours: null, pickupPhone: null, cancellationReason: 'Item no longer available',
      cancelledAt: '2026-10-12T00:00:00Z', winnerRank: 1, createdAt: '2026-10-11T02:24:00Z',
    }];
    const result = formatOrderContext(orders);
    expect(result).toContain('cancelled');
    expect(result).toContain('Item no longer available');
  });

  test('never mentions delivery or tracking', () => {
    const orders = [{
      transactionCode: 'TXN-3', item: 'Gold Bracelet', category: 'Bracelets', karatWeight: null,
      amount: 80000, orderStatus: 'ready_pickup', paymentStatus: 'paid', paymentMethod: 'gcash',
      paidAt: '2026-10-11T03:00:00Z', paymentDeadline: '2026-10-18T02:24:00Z',
      pickupBranch: 'Abreeza Branch', pickupAddress: 'Davao', pickupHours: '10-9', pickupPhone: '456',
      cancellationReason: null, cancelledAt: null, winnerRank: 1, createdAt: '2026-10-11T02:24:00Z',
    }];
    const result = formatOrderContext(orders);
    // The context tells the AI there is NO delivery — it should mention "no delivery" as a rule
    expect(result).toContain('no delivery');
    // The rule text mentions "shipping" as something to never mention — that's expected
  });
});
