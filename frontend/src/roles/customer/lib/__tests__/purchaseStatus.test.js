// frontend/src/roles/customer/lib/__tests__/purchaseStatus.test.js
import { describe, expect, it } from 'vitest';
import {
  buildDirectionsUrl,
  getPaymentStatusBadge,
  getPurchaseActions,
  getPurchaseProgress,
  getPurchaseStatusBadge,
  normalizePurchaseStatus,
  PURCHASE_STATES,
} from '../purchaseStatus';

const base = {
  id: 1,
  transaction_code: 'TXN-1001',
  amount: 25000,
  status: 'pending',
  payment_status: null,
  is_expired: false,
  branch: 'SM City North EDSA',
  branch_address: 'Quezon City',
  branch_lat: 14.6097,
  branch_lng: 121.0368,
  payment_method: null,
};

describe('normalizePurchaseStatus', () => {
  it('maps pending unpaid to PAYMENT_PENDING', () => {
    expect(normalizePurchaseStatus(base)).toBe(PURCHASE_STATES.PAYMENT_PENDING);
  });

  it('maps paid pending to PAID', () => {
    expect(normalizePurchaseStatus({ ...base, payment_status: 'paid' })).toBe(PURCHASE_STATES.PAID);
  });

  it('maps preparing status', () => {
    expect(normalizePurchaseStatus({ ...base, status: 'preparing', payment_status: 'paid' })).toBe(PURCHASE_STATES.PREPARING);
  });

  it('maps ready_pickup', () => {
    expect(normalizePurchaseStatus({ ...base, status: 'ready_pickup', payment_status: 'paid' })).toBe(PURCHASE_STATES.READY_FOR_PICKUP);
  });

  it('maps completed to COLLECTED', () => {
    expect(normalizePurchaseStatus({ ...base, status: 'completed', payment_status: 'paid' })).toBe(PURCHASE_STATES.COLLECTED);
  });

  it('maps is_expired unpaid to PAYMENT_EXPIRED', () => {
    expect(normalizePurchaseStatus({ ...base, is_expired: true })).toBe(PURCHASE_STATES.PAYMENT_EXPIRED);
  });

  it('maps cancelled', () => {
    expect(normalizePurchaseStatus({ ...base, status: 'cancelled' })).toBe(PURCHASE_STATES.CANCELLED);
  });
});

describe('getPurchaseStatusBadge', () => {
  it('shows Payment pending for unpaid order', () => {
    expect(getPurchaseStatusBadge(base).label).toBe('Payment pending');
  });

  it('shows Ready for pickup', () => {
    expect(getPurchaseStatusBadge({ ...base, status: 'ready_pickup', payment_status: 'paid' }).label).toBe('Ready for pickup');
  });

  it('shows Collected', () => {
    expect(getPurchaseStatusBadge({ ...base, status: 'completed', payment_status: 'paid' }).label).toBe('Collected');
  });

  it('shows Payment expired', () => {
    expect(getPurchaseStatusBadge({ ...base, is_expired: true }).label).toBe('Payment expired');
  });
});

describe('getPurchaseProgress', () => {
  it('reports 1 of 4 for unpaid pending', () => {
    const p = getPurchaseProgress(base);
    expect(p.doneCount).toBe(1);
    expect(p.percent).toBe(25);
    expect(p.text).toBe('1 of 4 steps · 25%');
    expect(p.stages[1].done).toBe(false);
  });

  it('does not mark payment confirmed while pending', () => {
    const p = getPurchaseProgress({ ...base, payment_status: 'processing' });
    expect(p.stages[1].done).toBe(false);
  });

  it('reports 3 of 4 for ready for pickup', () => {
    const p = getPurchaseProgress({ ...base, status: 'ready_pickup', payment_status: 'paid' });
    expect(p.doneCount).toBe(3);
    expect(p.text).toBe('3 of 4 steps · 75%');
  });

  it('reports 4 of 4 when collected', () => {
    const p = getPurchaseProgress({ ...base, status: 'completed', payment_status: 'paid' });
    expect(p.doneCount).toBe(4);
    expect(p.percent).toBe(100);
  });
});

describe('getPurchaseActions', () => {
  it('includes Pay now for unpaid pending', () => {
    const keys = getPurchaseActions(base).map((a) => a.key);
    expect(keys).toContain('pay');
  });

  it('hides Pay now after payment', () => {
    const keys = getPurchaseActions({ ...base, payment_status: 'paid' }).map((a) => a.key);
    expect(keys).not.toContain('pay');
  });

  it('hides Pay now when expired', () => {
    const keys = getPurchaseActions({ ...base, is_expired: true }).map((a) => a.key);
    expect(keys).not.toContain('pay');
  });

  it('includes directions when branch coordinates exist', () => {
    const actions = getPurchaseActions(base);
    const dir = actions.find((a) => a.key === 'directions');
    expect(dir).toBeTruthy();
  });
});

describe('buildDirectionsUrl', () => {
  it('uses lat/lng when available', () => {
    const url = buildDirectionsUrl(base);
    expect(url).toContain('14.6097');
    expect(url).toContain('121.0368');
    expect(url).toContain('google.com/maps');
  });

  it('falls back to branch address', () => {
    const url = buildDirectionsUrl({ branch_lat: null, branch_lng: null, branch_address: 'Quezon City' });
    expect(url).toContain('Quezon%20City');
  });

  it('returns null without address or coords', () => {
    expect(buildDirectionsUrl({ branch_lat: null, branch_lng: null })).toBeNull();
  });
});

describe('getPaymentStatusBadge', () => {
  it('shows Paid when order is paid', () => {
    expect(getPaymentStatusBadge({ ...base, payment_status: 'paid', status: 'preparing', payment_method: 'gcash' }).label).toBe('Paid · GCash');
  });

  it('shows Payment pending when unpaid', () => {
    expect(getPaymentStatusBadge(base).label).toBe('Payment pending');
  });
});
