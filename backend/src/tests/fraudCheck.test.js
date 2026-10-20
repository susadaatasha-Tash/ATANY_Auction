import { describe, test, expect } from 'vitest';
import { checkFraud } from '../services/fraudCheck.js';

function mockClient(bidTimes) {
  return {
    query: async () => ({ rows: bidTimes.map((t) => ({ created_at: t })) }),
  };
}

describe('fraudCheck (spec 4.2 server-side)', () => {
  test('flags large jump ratio >=2.5x', async () => {
    const res = await checkFraud({ client: mockClient([]), amount: 100000, previousBid: 30000 });
    expect(res.flagged).toBe(true);
    expect(res.reason).toMatch(/large bid jump/);
  });

  test('flags absolute jump >=50000', async () => {
    const res = await checkFraud({ client: mockClient([]), amount: 80000, previousBid: 20000 });
    expect(res.flagged).toBe(true);
  });

  test('flags 4 bids in 60s', async () => {
    const now = new Date();
    const times = [now, now, now]; // 3 existing + current = 4
    const res = await checkFraud({ client: mockClient(times), amount: 31000, previousBid: 30000 });
    expect(res.flagged).toBe(true);
    expect(res.reason).toMatch(/rapid/);
  });

  test('does not flag normal bid', async () => {
    const res = await checkFraud({ client: mockClient([]), amount: 31000, previousBid: 30000 });
    expect(res.flagged).toBe(false);
  });
});
