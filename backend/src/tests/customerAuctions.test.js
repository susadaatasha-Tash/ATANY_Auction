import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: vi.fn(), on: vi.fn() },
  isDirectPg: () => true,
}));

import { listAuctions, effectiveStatus } from '../services/auctionService.js';

describe('customer Auctions effectiveStatus', () => {
  it('scheduled stored but time in live window is effectively live', () => {
    const now = Date.now();
    const start = new Date(now - 1000).toISOString();
    const end = new Date(now + 3600000).toISOString();
    expect(effectiveStatus(start, end, 'scheduled')).toBe('live');
  });
  it('paused is authoritative regardless of time', () => {
    const start = new Date(Date.now() - 1000).toISOString();
    const end = new Date(Date.now() + 100000).toISOString();
    expect(effectiveStatus(start, end, 'paused')).toBe('paused');
  });
  it('stored ended stays ended even with future end_time (manual end)', () => {
    // Manual End keeps the original future end_time — time-only computation
    // would resurrect the row as live in every feed. Ended is terminal.
    const start = new Date(Date.now() - 3600000).toISOString();
    const end = new Date(Date.now() + 3600000).toISOString();
    expect(effectiveStatus(start, end, 'ended')).toBe('ended');
    expect(effectiveStatus(start, end, 'ENDED')).toBe('ended');
  });
  it('stored live in window stays live; past end stays ended', () => {
    const now = Date.now();
    expect(effectiveStatus(new Date(now - 1000).toISOString(), new Date(now + 3600000).toISOString(), 'live')).toBe('live');
    expect(effectiveStatus(new Date(now - 7200000).toISOString(), new Date(now - 1000).toISOString(), 'live')).toBe('ended');
  });
});

describe('customer Auctions listAuctions', () => {
  beforeEach(() => poolQuery.mockReset());

  function setupMocks({ auctions, products, shops }) {
    poolQuery.mockImplementation(async (sql, params) => {
      if (/FROM auctions WHERE/.test(sql)) return { rows: auctions };
      if (/FROM products WHERE id IN/.test(sql)) return { rows: products };
      if (/FROM shops WHERE id IN/.test(sql)) return { rows: shops };
      if (/FROM branches WHERE id IN/.test(sql)) return { rows: [] };
      if (/FROM bids WHERE auction_id IN/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
  }

  it('default (no status) includes Live+Scheduled, excludes Ended and Paused', async () => {
    const now = Date.now();
    const auctions = [
      { id: 'live', product_id: 'p1', status: 'live', start_time: new Date(now - 1000).toISOString(), end_time: new Date(now + 100000).toISOString() },
      { id: 'sched', product_id: 'p1', status: 'scheduled', start_time: new Date(now + 100000).toISOString(), end_time: new Date(now + 200000).toISOString() },
      { id: 'ended', product_id: 'p1', status: 'ended', start_time: new Date(now - 200000).toISOString(), end_time: new Date(now - 1000).toISOString() },
      { id: 'paused', product_id: 'p1', status: 'paused', start_time: new Date(now - 1000).toISOString(), end_time: new Date(now + 100000).toISOString() },
    ];
    const products = [{ id: 'p1', shop_id: 's1', name: 'Ring', category: 'Rings' }];
    const shops = [{ id: 's1', home_branch_id: 'b1' }];
    setupMocks({ auctions, products, shops });
    const rows = await listAuctions({ branchId: 'b1' });
    const ids = rows.map(r => r.id);
    expect(ids).toContain('live');
    expect(ids).toContain('sched');
    expect(ids).not.toContain('ended');
    expect(ids).not.toContain('paused');
  });

  it('status=live only shows live', async () => {
    const now = Date.now();
    const auctions = [
      { id: 'live', product_id: 'p1', status: 'live', start_time: new Date(now - 1000).toISOString(), end_time: new Date(now + 100000).toISOString() },
      { id: 'sched', product_id: 'p1', status: 'scheduled', start_time: new Date(now + 100000).toISOString(), end_time: new Date(now + 200000).toISOString() },
    ];
    const products = [{ id: 'p1', shop_id: 's1', name: 'Ring', category: 'Rings' }];
    const shops = [{ id: 's1', home_branch_id: 'b1' }];
    setupMocks({ auctions, products, shops });
    const rows = await listAuctions({ branchId: 'b1', status: 'live' });
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('live');
  });

  it('status=scheduled only shows scheduled', async () => {
    const now = Date.now();
    const auctions = [
      { id: 'live', product_id: 'p1', status: 'live', start_time: new Date(now - 1000).toISOString(), end_time: new Date(now + 100000).toISOString() },
      { id: 'sched', product_id: 'p1', status: 'scheduled', start_time: new Date(now + 100000).toISOString(), end_time: new Date(now + 200000).toISOString() },
    ];
    const products = [{ id: 'p1', shop_id: 's1', name: 'Ring', category: 'Rings' }];
    const shops = [{ id: 's1', home_branch_id: 'b1' }];
    setupMocks({ auctions, products, shops });
    const rows = await listAuctions({ branchId: 'b1', status: 'scheduled' });
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('sched');
  });

  it('status=all means Live+Scheduled only (not ended/paused)', async () => {
    const now = Date.now();
    const auctions = [
      { id: 'live', product_id: 'p1', status: 'live', start_time: new Date(now - 1000).toISOString(), end_time: new Date(now + 100000).toISOString() },
      { id: 'sched', product_id: 'p1', status: 'scheduled', start_time: new Date(now + 100000).toISOString(), end_time: new Date(now + 200000).toISOString() },
      { id: 'ended', product_id: 'p1', status: 'ended', start_time: new Date(now - 200000).toISOString(), end_time: new Date(now - 1000).toISOString() },
    ];
    const products = [{ id: 'p1', shop_id: 's1', name: 'Ring', category: 'Rings' }];
    const shops = [{ id: 's1', home_branch_id: 'b1' }];
    setupMocks({ auctions, products, shops });
    const rows = await listAuctions({ branchId: 'b1', status: 'all' });
    expect(rows.map(r=>r.id)).toEqual(expect.arrayContaining(['live','sched']));
    expect(rows.map(r=>r.id)).not.toContain('ended');
  });

  it('branch filtering preserved', async () => {
    const now = Date.now();
    const auctions = [
      { id: 'a1', product_id: 'p1', status: 'live', start_time: new Date(now - 1000).toISOString(), end_time: new Date(now + 100000).toISOString() },
      { id: 'a2', product_id: 'p2', status: 'live', start_time: new Date(now - 1000).toISOString(), end_time: new Date(now + 100000).toISOString() },
    ];
    const products = [{ id: 'p1', shop_id: 's1', name: 'Ring' }, { id: 'p2', shop_id: 's2', name: 'Necklace' }];
    const shops = [{ id: 's1', home_branch_id: 'branch-1' }, { id: 's2', home_branch_id: 'branch-2' }];
    setupMocks({ auctions, products, shops });
    const rows = await listAuctions({ branchId: 'branch-1' });
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('a1');
  });
});
