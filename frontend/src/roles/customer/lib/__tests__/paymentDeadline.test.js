// frontend/src/roles/customer/lib/__tests__/paymentDeadline.test.js
import {
  formatDeadlineDateTime, describe, expect, it } from 'vitest';
import {
  formatLongDate,
  getPaymentDeadlinePolicyText,
  getPaymentDeadlineState,
  getRemainingPaymentTime,
  PAYMENT_POLICY_DAYS,
  resolvePaymentDeadline,
} from '../paymentDeadline';

const won = new Date('2026-09-18T10:00:00Z').toISOString();

describe('resolvePaymentDeadline', () => {
  it('uses stored payment_deadline when present', () => {
    const d = resolvePaymentDeadline({ payment_deadline: '2026-09-25T10:00:00Z', winner_confirmed_at: won });
    expect(d.toISOString()).toBe('2026-09-25T10:00:00.000Z');
  });

  it('derives deadline as winner + 7 days when missing', () => {
    const d = resolvePaymentDeadline({ winner_confirmed_at: won });
    expect(d).toBeInstanceOf(Date);
    const expected = new Date(new Date(won).getTime() + PAYMENT_POLICY_DAYS * 24 * 60 * 60 * 1000);
    expect(d.getTime()).toBe(expected.getTime());
  });

  it('returns null without dates', () => {
    expect(resolvePaymentDeadline({})).toBeNull();
  });
});

describe('getRemainingPaymentTime', () => {
  const now = new Date('2026-09-22T10:00:00Z').getTime();
  const deadline = '2026-09-25T10:00:00Z';

  it('formats days remaining', () => {
    const r = getRemainingPaymentTime({ payment_deadline: deadline, status: 'pending' }, now);
    expect(r.expired).toBe(false);
    expect(r.text).toMatch(/days remaining/);
  });

  it('marks expired when past deadline', () => {
    const r = getRemainingPaymentTime({ payment_deadline: '2026-09-20T10:00:00Z', status: 'pending' }, now);
    expect(r.expired).toBe(true);
    expect(r.text).toBe('Payment expired');
  });

  it('uses due tomorrow inside 24h', () => {
    const r = getRemainingPaymentTime({ payment_deadline: '2026-09-23T10:00:00Z', status: 'pending' }, now);
    expect(r.text).toBe('Due tomorrow');
    expect(r.tone).toBe('strong');
  });
});

describe('getPaymentDeadlineState', () => {
  const now = new Date('2026-09-22T10:00:00Z').getTime();

  it('is visible for unpaid pending orders', () => {
    const s = getPaymentDeadlineState({
      status: 'pending',
      payment_status: null,
      payment_deadline: '2026-09-25T10:00:00Z',
      winner_confirmed_at: won,
    }, now);
    expect(s.visible).toBe(true);
    expect(s.collapsedLabel).toContain('Payment due');
  });

  it('is hidden for paid orders', () => {
    const s = getPaymentDeadlineState({
      status: 'pending',
      payment_status: 'paid',
      payment_deadline: '2026-09-25T10:00:00Z',
      winner_confirmed_at: won,
    }, now);
    expect(s.visible).toBe(false);
  });

  it('is hidden for completed orders', () => {
    const s = getPaymentDeadlineState({
      status: 'completed',
      payment_status: 'paid',
      payment_deadline: '2026-09-25T10:00:00Z',
    }, now);
    expect(s.visible).toBe(false);
  });
});

describe('copy helpers', () => {
  it('formats long date from ISO', () => {
    expect(formatLongDate('2026-09-25T10:00:00Z')).toContain('September');
  });

  it('returns policy text', () => {
    expect(getPaymentDeadlinePolicyText(false)).toContain('7 days');
    expect(getPaymentDeadlinePolicyText(true)).toContain('expired');
  });
});
