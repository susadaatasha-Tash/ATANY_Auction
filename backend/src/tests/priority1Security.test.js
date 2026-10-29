// backend/src/tests/priority1Security.test.js
// Priority 1 security + correctness regression suite (C1–C6, H1, H3, H4).
// Covers AUTHZ, WEBHOOK, SOCKET, AUCTIONS, PAYMENTS, SUBSCRIPTIONS, SCHEMA.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(__dirname, '../db');

const poolQuery = vi.fn();
const poolConnect = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: {
    query: (...args) => poolQuery(...args),
    connect: (...args) => poolConnect(...args),
    on: () => {},
  },
  isDirectPg: () => true,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'not used' } })),
      admin: { createUser: vi.fn() },
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
  })),
}));

vi.mock('../services/emailService.js', () => ({
  sendNotificationEmail: vi.fn(async () => ({ ok: true })),
}));

// Import real verifyWebhookSignature (not mocked) for C4 unit tests.
// Controllers under test that need signature mocks will set env or use real fn via unmocked import path.
// paymentRaceGuard + bidLogic + socketAuth + auth controllers use mocked pool.

const { getMe, syncUser } = await import('../controllers/auth.controller.js');
const { verifyWebhookSignature } = await import('../services/paymongoService.js');
const {
  validateAuctionBidWindow,
  placeBid,
} = await import('../services/bidLogic.js');
const {
  isPaymentStillValid,
  assertPaymentStillPayable,
  markStalePayment,
} = await import('../services/paymentRaceGuard.js');
const { createSocketAuth } = await import('../services/socketAuth.js');
const {
  applyUpgradeChange,
  confirmPlanChange,
} = await import('../services/subscriptionPlanChangeService.js');
const { paymongoWebhook } = await import('../controllers/webhook.controller.js');

const SELLER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BUYER_A = '11111111-1111-1111-1111-111111111111';
const BUYER_B = '22222222-2222-2222-2222-222222222222';
const ORDER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PAYMENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const AUCTION_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function futureISO(days = 30) {
  return new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
}

beforeEach(() => {
  poolQuery.mockReset();
  poolConnect.mockReset();
  poolQuery.mockResolvedValue({ rows: [] });
  process.env.PAYMONGO_WEBHOOK_SECRET = 'test_webhook_secret_priority1';
  process.env.ALLOW_INSECURE_PAYMONGO_WEBHOOKS = '';
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  delete process.env.PAYMONGO_WEBHOOK_SECRET;
  delete process.env.ALLOW_INSECURE_PAYMONGO_WEBHOOKS;
});

// ─────────────────────────────────────────────────────────────
// C1 — RLS / privilege guard (schema + migration evidence)
// ─────────────────────────────────────────────────────────────
describe('C1 users RLS privilege guard', () => {
  it('schema.sql no longer allows unrestricted self UPDATE policy', () => {
    const schema = fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8');
    expect(schema).not.toMatch(/users: self can update own name"/);
    expect(schema).toMatch(/users: self can update own profile/);
  });

  it('migration 028 creates privileged-column trigger and drops old policy', () => {
    const m028 = fs.readFileSync(path.join(dbDir, 'migrations/028_users_privilege_guard.sql'), 'utf8');
    expect(m028).toMatch(/users_guard_privileged_columns/);
    expect(m028).toMatch(/trg_users_guard_privileged/);
    expect(m028).toMatch(/DROP POLICY IF EXISTS "users: self can update own name"/);
    expect(m028).toMatch(/role IS DISTINCT FROM OLD\.role/);
    expect(m028).toMatch(/password_hash IS DISTINCT FROM OLD\.password_hash/);
    expect(m028).toMatch(/totp_secret/);
  });

  it('setup_complete.sql installs the same privilege trigger', () => {
    const setup = fs.readFileSync(path.join(dbDir, 'setup_complete.sql'), 'utf8');
    expect(setup).toMatch(/users_guard_privileged_columns/);
    expect(setup).toMatch(/trg_users_guard_privileged/);
    // DROP of old policy name is expected cleanup; CREATE of unrestricted policy is not allowed
    expect(setup).not.toMatch(/CREATE POLICY "users: self can update own name"/);
    expect(setup).toMatch(/CREATE POLICY "users: self can update own profile"/);
  });

  it('trigger blocks role change for non-service contexts (SQL logic contract)', () => {
    // Static contract: trusted paths are service_role/postgres only; else role must be unchanged.
    const m028 = fs.readFileSync(path.join(dbDir, 'migrations/028_users_privilege_guard.sql'), 'utf8');
    expect(m028).toMatch(/jwt_role = 'service_role'/);
    expect(m028).toMatch(/current_user IN \('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin'\)/);
    expect(m028).toMatch(/users\.role cannot be changed by client update/);
  });
});

// ─────────────────────────────────────────────────────────────
// C2 — /auth/me auto-sync never trusts metadata role
// ─────────────────────────────────────────────────────────────
describe('C2 /auth/me auto-sync role', () => {
  it('metadata role admin → created as customer', async () => {
    let insertedRole = null;
    poolQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM public.users WHERE id')) {
        if (insertedRole) return { rows: [{ id: params[0], role: insertedRole, status: 'active' }] };
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO public.users')) {
        insertedRole = params[4];
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });
    const res = mockRes();
    await getMe({ user: { id: SELLER, email: 'evil@x.com', user_metadata: { role: 'admin' } } }, res);
    expect(insertedRole).toBe('customer');
  });

  it('metadata role shop_owner → created as customer', async () => {
    let insertedRole = null;
    poolQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM public.users WHERE id')) {
        if (insertedRole) return { rows: [{ id: params[0], role: insertedRole }] };
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO public.users')) {
        insertedRole = params[4];
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });
    const res = mockRes();
    await getMe({ user: { id: SELLER, email: 'seller@x.com', user_metadata: { role: 'shop_owner' } } }, res);
    expect(insertedRole).toBe('customer');
  });

  it('metadata role customer → customer', async () => {
    let insertedRole = null;
    poolQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM public.users WHERE id')) {
        if (insertedRole) return { rows: [{ id: params[0], role: insertedRole }] };
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO public.users')) {
        insertedRole = params[4];
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });
    const res = mockRes();
    await getMe({ user: { id: SELLER, email: 'c@x.com', user_metadata: { role: 'customer' } } }, res);
    expect(insertedRole).toBe('customer');
  });

  it('missing metadata → customer', async () => {
    let insertedRole = null;
    poolQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM public.users WHERE id')) {
        if (insertedRole) return { rows: [{ id: params[0], role: insertedRole }] };
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO public.users')) {
        insertedRole = params[4];
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });
    const res = mockRes();
    await getMe({ user: { id: SELLER, email: 'n@x.com', user_metadata: {} } }, res);
    expect(insertedRole).toBe('customer');
  });

  it('does not create shop rows during auto-sync', async () => {
    const inserts = [];
    poolQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('INSERT INTO')) {
        inserts.push(sql);
        if (sql.includes('INSERT INTO public.users')) {
          return { rows: [], rowCount: 1 };
        }
      }
      if (sql.includes('FROM public.users WHERE id')) {
        if (inserts.some((s) => s.includes('INSERT INTO public.users'))) {
          return { rows: [{ id: params[0], role: 'customer' }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    });
    const res = mockRes();
    await getMe({ user: { id: SELLER, email: 's@x.com', user_metadata: { role: 'shop_owner' } } }, res);
    expect(inserts.some((s) => s.includes('INSERT INTO shops'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// C3 — sync-user authentication + customer-only
// ─────────────────────────────────────────────────────────────
describe('C3 /auth/sync-user', () => {
  it('unauthenticated request rejected', async () => {
    const res = mockRes();
    await syncUser({ user: null, body: { role: 'admin' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('user cannot submit another user id — id comes from JWT', async () => {
    let insertParams = null;
    poolQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('INSERT INTO public.users')) insertParams = params;
      return { rows: [], rowCount: 1 };
    });
    const res = mockRes();
    await syncUser(
      {
        user: { id: BUYER_A, email: 'a@x.com', user_metadata: { name: 'Alice' } },
        body: { id: BUYER_B, email: 'b@x.com', role: 'admin' },
      },
      res
    );
    expect(insertParams[0]).toBe(BUYER_A);
    expect(insertParams[4]).toBe('customer');
  });

  it('user cannot request admin or shop_owner', async () => {
    let insertParams = null;
    poolQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('INSERT INTO public.users')) insertParams = params;
      return { rows: [], rowCount: 1 };
    });
    const res1 = mockRes();
    await syncUser({ user: { id: BUYER_A, email: 'a@x.com' }, body: { role: 'admin' } }, res1);
    expect(insertParams[4]).toBe('customer');

    const res2 = mockRes();
    await syncUser({ user: { id: BUYER_A, email: 'a@x.com' }, body: { role: 'shop_owner' } }, res2);
    expect(insertParams[4]).toBe('customer');
  });

  it('normal sync still results in customer', async () => {
    let insertParams = null;
    poolQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('INSERT INTO public.users')) insertParams = params;
      return { rows: [], rowCount: 1 };
    });
    const res = mockRes();
    await syncUser({ user: { id: BUYER_A, email: 'a@x.com', user_metadata: { name: 'Alice' } }, body: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, role: 'customer' }));
    expect(insertParams[4]).toBe('customer');
  });

  it('route file mounts sync-user behind requireAuth', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/auth.routes.js'), 'utf8');
    expect(routes).toMatch(
      /router\.post\('\/sync-user',\s*requireAuth,\s*rateLimit\([^)]*\),\s*syncUser\)/
    );
  });

  it('admin promotion path still exists via requireRole admin signup', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../routes/auth.routes.js'), 'utf8');
    expect(routes).toMatch(
      /router\.post\('\/signup',\s*requireAuth,\s*requireRole\(\['admin'\]\),\s*rateLimit\([^)]*\),\s*signup\)/
    );
  });
});

// ─────────────────────────────────────────────────────────────
// C4 — PayMongo webhook fail closed + timing-safe
// ─────────────────────────────────────────────────────────────
describe('C4 PayMongo webhook verification', () => {
  const raw = JSON.stringify({ data: { id: 'cs_1', attributes: { type: 'checkout.payment.paid' } } });

  function hmac(secret, body) {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  afterEach(() => {
    delete process.env.PAYMONGO_WEBHOOK_SECRET;
    delete process.env.ALLOW_INSECURE_PAYMONGO_WEBHOOKS;
    process.env.NODE_ENV = 'test';
  });

  it('production missing secret rejected', () => {
    delete process.env.PAYMONGO_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_INSECURE_PAYMONGO_WEBHOOKS = 'true';
    expect(verifyWebhookSignature(raw, 'whatever')).toBe(false);
  });

  it('missing secret without opt-in rejected in test/dev', () => {
    delete process.env.PAYMONGO_WEBHOOK_SECRET;
    process.env.ALLOW_INSECURE_PAYMONGO_WEBHOOKS = '';
    expect(verifyWebhookSignature(raw, 'x')).toBe(false);
  });

  it('missing secret with ALLOW_INSECURE_PAYMONGO_WEBHOOKS=true accepted outside production', () => {
    delete process.env.PAYMONGO_WEBHOOK_SECRET;
    process.env.ALLOW_INSECURE_PAYMONGO_WEBHOOKS = 'true';
    process.env.NODE_ENV = 'test';
    expect(verifyWebhookSignature(raw, 'x')).toBe(true);
  });

  it('invalid signature rejected', () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = 's3cret';
    expect(verifyWebhookSignature(raw, 'deadbeef')).toBe(false);
    expect(verifyWebhookSignature(raw, '')).toBe(false);
  });

  it('valid signature accepted (bare hex)', () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = 's3cret';
    const sig = hmac('s3cret', raw);
    expect(verifyWebhookSignature(raw, sig)).toBe(true);
  });

  it('valid signature accepted (v1= prefixed list)', () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = 's3cret';
    const sig = `t=123,v1=${hmac('s3cret', raw)}`;
    expect(verifyWebhookSignature(raw, sig)).toBe(true);
  });

  it('substring/forged signatures rejected (no includes() bypass)', () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = 's3cret';
    const sig = hmac('s3cret', raw);
    expect(verifyWebhookSignature(raw, `xx${sig}yy`)).toBe(false);
    expect(verifyWebhookSignature(raw, sig.slice(0, -2))).toBe(false);
  });

  it('webhook controller rejects invalid signature with 403 and does not process', async () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = 's3cret';
    // Force verification failure via wrong body vs secret
    const res = mockRes();
    await paymongoWebhook(
      {
        rawBody: raw,
        body: JSON.parse(raw),
        headers: { 'paymongo-signature': 'invalid' },
      },
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
    // No payments UPDATE should have been issued
    const paidUpdates = poolQuery.mock.calls.filter(([sql]) => /UPDATE payments SET status='paid'/.test(sql));
    expect(paidUpdates.length).toBe(0);
  });

  it('webhook controller rejects when secret missing (fail closed)', async () => {
    delete process.env.PAYMONGO_WEBHOOK_SECRET;
    delete process.env.ALLOW_INSECURE_PAYMONGO_WEBHOOKS;
    process.env.NODE_ENV = 'test';
    const res = mockRes();
    await paymongoWebhook({ rawBody: raw, body: JSON.parse(raw), headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('secret never appears in 403 response body', async () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = 'super_secret_value_xyz';
    const res = mockRes();
    await paymongoWebhook({ rawBody: raw, body: JSON.parse(raw), headers: { 'paymongo-signature': 'bad' } }, res);
    const body = JSON.stringify(res.json.mock.calls[0]?.[0] || {});
    expect(body).not.toContain('super_secret_value_xyz');
  });

  it('valid signed webhook still processes (idempotent paid already)', async () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = 's3cret';
    const body = {
      data: {
        id: 'cs_ok',
        attributes: {
          type: 'checkout.payment.paid',
          data: { id: PAYMENT_ID, attributes: { status: 'paid', payments: [{ attributes: { status: 'paid' } }] } },
        },
      },
    };
    const rawOk = JSON.stringify(body);
    poolQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM payments WHERE checkout_session_id')) {
        return { rows: [{ id: PAYMENT_ID, order_id: ORDER_ID, customer_id: BUYER_A, status: 'paid' }] };
      }
      return { rows: [] };
    });
    const res = mockRes();
    await paymongoWebhook(
      {
        rawBody: rawOk,
        body,
        headers: { 'paymongo-signature': `t=1,v1=${hmac('s3cret', rawOk)}` },
      },
      res
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ already_paid: true }));
  });
});

// ─────────────────────────────────────────────────────────────
// C5 — products.proposed_* schema
// ─────────────────────────────────────────────────────────────
describe('C5 products proposed_* columns', () => {
  it('migration 029 creates proposed_start_time / proposed_end_time / proposed_duration_days', () => {
    const m029 = fs.readFileSync(path.join(dbDir, 'migrations/029_products_proposed_schedule.sql'), 'utf8');
    expect(m029).toMatch(/ADD COLUMN IF NOT EXISTS proposed_start_time TIMESTAMPTZ/);
    expect(m029).toMatch(/ADD COLUMN IF NOT EXISTS proposed_end_time TIMESTAMPTZ/);
    expect(m029).toMatch(/ADD COLUMN IF NOT EXISTS proposed_duration_days INTEGER/);
  });

  it('schema.sql products table includes proposed columns', () => {
    const schema = fs.readFileSync(path.join(dbDir, 'schema.sql'), 'utf8');
    const productsBlock = schema.slice(schema.indexOf('CREATE TABLE products'), schema.indexOf('CREATE TABLE auctions'));
    expect(productsBlock).toMatch(/proposed_start_time TIMESTAMPTZ/);
    expect(productsBlock).toMatch(/proposed_end_time TIMESTAMPTZ/);
    expect(productsBlock).toMatch(/proposed_duration_days INTEGER/);
  });

  it('setup_complete.sql products table includes proposed columns', () => {
    const setup = fs.readFileSync(path.join(dbDir, 'setup_complete.sql'), 'utf8');
    const start = setup.indexOf('CREATE TABLE IF NOT EXISTS products');
    const productsBlock = setup.slice(start, start + 600);
    expect(productsBlock).toMatch(/proposed_start_time TIMESTAMPTZ/);
    expect(productsBlock).toMatch(/proposed_end_time TIMESTAMPTZ/);
    expect(productsBlock).toMatch(/proposed_duration_days INTEGER/);
  });

  it('listing controller still writes proposed fields (unchanged app contract)', () => {
    const listing = fs.readFileSync(path.join(__dirname, '../controllers/shop-owner/listing.controller.js'), 'utf8');
    expect(listing).toMatch(/proposed_start_time/);
    expect(listing).toMatch(/INSERT INTO products \([^)]*proposed_start_time/);
  });
});

// ─────────────────────────────────────────────────────────────
// C6 — zero-cost upgrade correctness
// ─────────────────────────────────────────────────────────────
describe('C6 zero-cost subscription upgrade', () => {
  it('source no longer inserts status=applied for zero-cost path', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/subscriptionPlanChangeService.js'),
      'utf8'
    );
    // The zero-cost branch must insert pending_payment, not applied
    const zeroCostSection = src.slice(src.indexOf('amountDueNow === 0'), src.indexOf('Upgrade with proration charge'));
    expect(zeroCostSection).toMatch(/pending_payment/);
    expect(zeroCostSection).not.toMatch(/'upgrade', 'applied'/);
  });

  it('applyUpgradeChange on pending_payment applies billing then marks applied', async () => {
    const change = {
      id: 'chg_zc',
      seller_id: SELLER,
      status: 'pending_payment',
      target_plan_code: 'gold',
      target_billing_interval: 'monthly',
      current_plan_code: 'bronze',
      current_billing_interval: 'monthly',
      proration_amount: 0,
    };
    const goldBilling = {
      id: 'bill_gold',
      seller_id: SELLER,
      plan_code: 'gold',
      billing_interval: 'monthly',
      status: 'paid',
      amount: 1500,
    };
    const billingInserts = [];
    poolQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM subscription_changes WHERE id')) {
        return { rows: [{ ...change }] };
      }
      if (sql.includes("UPDATE subscription_changes") && sql.includes("status IN ('pending_payment', 'scheduled')")) {
        return { rows: [{ ...change, status: 'applied' }] };
      }
      if (sql.includes('INSERT INTO billing_records')) {
        billingInserts.push(params);
        return { rows: [goldBilling] };
      }
      if (sql.includes('UPDATE subscription_changes') && sql.includes('billing_record_id')) {
        return { rows: [{ ...change, status: 'applied', billing_record_id: 'bill_gold' }] };
      }
      if (sql.includes('FROM billing_records WHERE subscription_change_id')) {
        return { rows: [goldBilling] };
      }
      if (sql.includes('INSERT INTO audit_logs') || sql.includes('INSERT INTO notifications')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });

    const result = await applyUpgradeChange({ change, source: 'zero_cost_upgrade' });
    expect(result.alreadyApplied).toBe(false);
    expect(billingInserts.length).toBe(1);
    // plan_code gold + interval monthly written to billing
    expect(billingInserts[0]).toContain('gold');
    expect(billingInserts[0]).toContain('monthly');
    expect(result.change.status).toBe('applied');
    expect(result.billing?.plan_code).toBe('gold');
  });

  it('duplicate apply after applied is a no-op (idempotent)', async () => {
    const change = {
      id: 'chg_zc',
      seller_id: SELLER,
      status: 'applied',
      target_plan_code: 'gold',
      target_billing_interval: 'monthly',
    };
    poolQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM subscription_changes WHERE id')) {
        return { rows: [{ ...change }] };
      }
      if (sql.includes('FROM billing_records WHERE subscription_change_id')) {
        return { rows: [{ id: 'bill_gold', plan_code: 'gold' }] };
      }
      return { rows: [] };
    });
    const result = await applyUpgradeChange({ change, source: 'zero_cost_upgrade' });
    expect(result.alreadyApplied).toBe(true);
    const inserts = poolQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO billing_records'));
    expect(inserts.length).toBe(0);
  });

  it('confirmPlanChange zero-cost path inserts pending_payment then applies billing', async () => {
    const bronzeRecord = {
      id: 'br1',
      seller_id: SELLER,
      amount: 1000,
      status: 'paid',
      plan_code: 'bronze',
      billing_interval: 'monthly',
      billing_type: 'subscription',
      // Period already ended → remaining fraction 0 → amount_due_now = 0 (zero-cost upgrade)
      current_period_start: new Date(Date.now() - 40 * 86400000).toISOString().split('T')[0],
      current_period_end: new Date(Date.now() - 10 * 86400000).toISOString().split('T')[0],
      due_date: new Date(Date.now() - 10 * 86400000).toISOString().split('T')[0],
      created_at: new Date(Date.now() - 40 * 86400000).toISOString(),
    };
    const changeRow = {
      id: 'chg_confirm',
      seller_id: SELLER,
      current_plan_code: 'bronze',
      target_plan_code: 'gold',
      current_billing_interval: 'monthly',
      target_billing_interval: 'monthly',
      change_type: 'upgrade',
      status: 'pending_payment',
      effective_at: futureISO(0),
      proration_amount: 0,
      created_at: new Date().toISOString(),
    };
    const appliedBilling = {
      id: 'bill_applied_gold',
      seller_id: SELLER,
      plan_code: 'gold',
      billing_interval: 'monthly',
      status: 'paid',
      amount: 1500,
      subscription_change_id: changeRow.id,
    };

    const insertChangeSql = [];
    poolQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM billing_records WHERE seller_id')) {
        return { rows: [bronzeRecord] };
      }
      if (sql.includes('FROM shops WHERE user_id')) {
        return { rows: [{ id: 'shop1', user_id: SELLER, shop_name: 'S' }] };
      }
      if (sql.includes('FROM subscription_changes') && sql.includes("status = 'scheduled'")) {
        return { rows: [] };
      }
      if (sql.includes('FROM subscription_changes') && sql.includes("status = 'pending_payment'")) {
        return { rows: [] };
      }
      if (sql.includes('FROM subscription_changes') && sql.includes('id = $1')) {
        // applyUpgradeChange re-read
        return { rows: [{ ...changeRow }] };
      }
      if (sql.includes('INSERT INTO subscription_changes')) {
        insertChangeSql.push(sql);
        expect(sql).toMatch(/'pending_payment'/);
        return { rows: [changeRow] };
      }
      if (sql.includes("UPDATE subscription_changes") && sql.includes("status IN ('pending_payment', 'scheduled')")) {
        return { rows: [{ ...changeRow, status: 'applied' }] };
      }
      if (sql.includes('INSERT INTO billing_records')) {
        return { rows: [appliedBilling] };
      }
      if (sql.includes('UPDATE subscription_changes') && sql.includes('billing_record_id')) {
        return { rows: [{ ...changeRow, status: 'applied', billing_record_id: appliedBilling.id }] };
      }
      if (sql.includes('FROM billing_records WHERE subscription_change_id')) {
        return { rows: [appliedBilling] };
      }
      if (sql.includes('COUNT(*)') || sql.includes('FROM products WHERE shop_id')) {
        return { rows: [{ n: 0 }] };
      }
      return { rows: [] };
    });

    const result = await confirmPlanChange({
      sellerId: SELLER,
      planCode: 'gold',
      billingInterval: 'monthly',
    });

    expect(insertChangeSql.length).toBeGreaterThanOrEqual(1);
    expect(result.mode).toBe('applied_immediately');
    expect(result.amount_due_now).toBe(0);
    expect(result.change.status).toBe('applied');
    expect(result.billing?.plan_code).toBe('gold');
  });
});

// ─────────────────────────────────────────────────────────────
// H1 — Socket.io authentication
// ─────────────────────────────────────────────────────────────
describe('H1 Socket.io authentication', () => {
  function makeSocket({ auth, headers, query } = {}) {
    return {
      handshake: { auth: auth || {}, headers: headers || {}, query: query || {} },
      data: {},
      joined: [],
      join(room) { this.joined.push(room); },
    };
  }

  it('no token → connection rejected', async () => {
    const authMw = createSocketAuth({
      supabaseClient: { auth: { getUser: vi.fn() } },
    });
    const next = vi.fn();
    await authMw(makeSocket({}), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'unauthorized' }));
  });

  it('invalid token rejected', async () => {
    const authMw = createSocketAuth({
      supabaseClient: {
        auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'bad token' } })) },
      },
    });
    const next = vi.fn();
    await authMw(makeSocket({ auth: { token: 'bad' } }), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'unauthorized' }));
  });

  it('valid customer token accepted and joins own room only', async () => {
    const authMw = createSocketAuth({
      supabaseClient: {
        auth: { getUser: vi.fn(async () => ({ data: { user: { id: BUYER_A, email: 'a@x.com' } }, error: null })) },
      },
    });
    const socket = makeSocket({ auth: { token: 'good' } });
    const next = vi.fn();
    await authMw(socket, next);
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.userId).toBe(BUYER_A);
    expect(socket.joined).toEqual([`user:${BUYER_A}`]);
  });

  it('client cannot choose another user room — join uses authenticated id only', async () => {
    const authMw = createSocketAuth({
      supabaseClient: {
        auth: { getUser: vi.fn(async () => ({ data: { user: { id: BUYER_A } }, error: null })) },
      },
    });
    // Even if handshake query claims victim id, server joins BUYER_A only
    const socket = makeSocket({ auth: { token: 'good' }, query: { userId: BUYER_B } });
    const next = vi.fn();
    await authMw(socket, next);
    expect(socket.joined).not.toContain(`user:${BUYER_B}`);
    expect(socket.joined).toEqual([`user:${BUYER_A}`]);
  });

  it('token from Authorization header accepted', async () => {
    const authMw = createSocketAuth({
      supabaseClient: {
        auth: { getUser: vi.fn(async () => ({ data: { user: { id: BUYER_A } }, error: null })) },
      },
    });
    const socket = makeSocket({ headers: { authorization: 'Bearer hdr_token' } });
    const next = vi.fn();
    await authMw(socket, next);
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.userId).toBe(BUYER_A);
  });

  it('backend index.js installs socket auth middleware and ignores client join:user ids', () => {
    const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    expect(indexSrc).toMatch(/io\.use\(createSocketAuth\(\)\)/);
    expect(indexSrc).not.toMatch(/socket\.on\('join:user', \(userId\) => socket\.join\(`user:\$\{userId\}`\)\)/);
  });
});

// ─────────────────────────────────────────────────────────────
// H4 — Bid live/time window
// ─────────────────────────────────────────────────────────────
describe('H4 auction bid window validation', () => {
  const now = new Date('2026-10-06T12:00:00.000Z');
  const live = {
    id: AUCTION_ID,
    status: 'live',
    start_time: '2026-10-06T10:00:00.000Z',
    end_time: '2026-10-06T14:00:00.000Z',
    current_bid: 10000,
  };

  it('scheduled/future auction rejects bid', () => {
    const res = validateAuctionBidWindow(
      { ...live, status: 'scheduled', start_time: '2026-10-07T10:00:00.000Z' },
      now
    );
    expect(res).toMatchObject({ ok: false, code: 'AUCTION_NOT_LIVE' });
  });

  it('future start_time rejects even if status is live', () => {
    const res = validateAuctionBidWindow(
      { ...live, start_time: '2026-10-08T10:00:00.000Z' },
      now
    );
    expect(res.ok).toBe(false);
  });

  it('live auction within window accepts', () => {
    expect(validateAuctionBidWindow(live, now)).toEqual({ ok: true });
  });

  it('ended auction rejects', () => {
    const res = validateAuctionBidWindow({ ...live, status: 'ended' }, now);
    expect(res).toMatchObject({ ok: false, code: 'AUCTION_NOT_LIVE' });
  });

  it('cancelled auction rejects', () => {
    expect(validateAuctionBidWindow({ ...live, status: 'cancelled' }, now).ok).toBe(false);
    expect(validateAuctionBidWindow({ ...live, status: 'canceled' }, now).ok).toBe(false);
  });

  it('exactly at/after end boundary rejects', () => {
    const end = new Date(live.end_time);
    expect(validateAuctionBidWindow(live, end).ok).toBe(false);
    expect(validateAuctionBidWindow(live, new Date(end.getTime() + 1)).ok).toBe(false);
  });

  it('cron lag: status=scheduled but window open is allowed by time', () => {
    const res = validateAuctionBidWindow({ ...live, status: 'scheduled' }, now);
    expect(res.ok).toBe(true);
  });

  it('placeBid rejects non-live auction with AUCTION_NOT_LIVE', async () => {
    poolConnect.mockResolvedValue({
      query: vi.fn(async (sql) => {
        if (sql.includes('BEGIN')) return { rows: [] };
        if (sql.includes('FROM auctions WHERE id')) {
          return {
            rows: [{ ...live, status: 'ended', end_time: '2026-10-06T11:00:00.000Z' }],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    });
    await expect(
      placeBid({ auctionId: AUCTION_ID, userId: BUYER_A, amount: 20000, now })
    ).rejects.toMatchObject({ code: 'AUCTION_NOT_LIVE' });
  });

  it('placeBid fails closed when pool is on REST fallback', async () => {
    poolConnect.mockResolvedValue({
      __restFallback: true,
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    });
    // No reachable direct pg in this env: the dedicated-client fallback also
    // fails, so the bid fails closed with 503 — never a REST write.
    // (When pg IS reachable, acquireTxClient recovers via dedicated client.)
    await expect(
      placeBid({ auctionId: AUCTION_ID, userId: BUYER_A, amount: 20000, now })
    ).rejects.toMatchObject({ code: 'DB_UNAVAILABLE', statusCode: 503 });
  });

  it('placeBid accepts valid live auction bid', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (sql.includes('BEGIN') || sql.includes('COMMIT')) return { rows: [] };
        if (sql.includes('FROM auctions WHERE id')) return { rows: [live] };
        if (sql.includes('UPDATE auctions SET current_bid')) return { rows: [], rowCount: 1 };
        if (sql.includes('INSERT INTO bids')) return { rows: [{ id: 'b1', amount: 20000 }], rowCount: 1 };
        if (sql.includes('FROM bids')) return { rows: [] };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    poolConnect.mockResolvedValue(client);
    const result = await placeBid({ auctionId: AUCTION_ID, userId: BUYER_A, amount: 20000, now });
    expect(result.bid.amount).toBe(20000);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      [AUCTION_ID]
    );
  });
});

// ─────────────────────────────────────────────────────────────
// H3 — Stale winner payment race
// ─────────────────────────────────────────────────────────────
describe('H3 stale winner payment race', () => {
  it('valid payment + pending order owned by same buyer passes', () => {
    const res = isPaymentStillValid({
      payment: { id: PAYMENT_ID, order_id: ORDER_ID, customer_id: BUYER_A },
      order: { id: ORDER_ID, buyer_id: BUYER_A, status: 'pending' },
    });
    expect(res.ok).toBe(true);
  });

  it('buyer mismatch (reassigned order) fails BUYER_MISMATCH', () => {
    const res = isPaymentStillValid({
      payment: { id: PAYMENT_ID, order_id: ORDER_ID, customer_id: BUYER_A },
      order: { id: ORDER_ID, buyer_id: BUYER_B, status: 'pending' },
    });
    expect(res).toMatchObject({ ok: false, reason: 'BUYER_MISMATCH' });
  });

  it('order no longer pending fails ORDER_NOT_PAYABLE', () => {
    const res = isPaymentStillValid({
      payment: { id: PAYMENT_ID, order_id: ORDER_ID, customer_id: BUYER_A },
      order: { id: ORDER_ID, buyer_id: BUYER_A, status: 'completed' },
    });
    expect(res).toMatchObject({ ok: false, reason: 'ORDER_NOT_PAYABLE' });
  });

  it('missing order fails', () => {
    const res = isPaymentStillValid({
      payment: { id: PAYMENT_ID, order_id: ORDER_ID, customer_id: BUYER_A },
      order: null,
    });
    expect(res.ok).toBe(false);
  });

  it('assertPaymentStillPayable reads current order from DB', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (sql.includes('SELECT * FROM orders WHERE id=$1')) {
        return { rows: [{ id: ORDER_ID, buyer_id: BUYER_B, status: 'pending' }] };
      }
      return { rows: [] };
    });
    const res = await assertPaymentStillPayable({
      id: PAYMENT_ID,
      order_id: ORDER_ID,
      customer_id: BUYER_A,
    });
    expect(res).toMatchObject({ ok: false, reason: 'BUYER_MISMATCH' });
  });

  it('markStalePayment cancels payment and does not touch order', async () => {
    poolQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const result = await markStalePayment(
      { id: PAYMENT_ID, order_id: ORDER_ID, customer_id: BUYER_A },
      { reason: 'BUYER_MISMATCH', eventType: 'checkout.payment.paid' }
    );
    expect(result.ok).toBe(false);
    const cancelSql = poolQuery.mock.calls.find(([sql]) => /UPDATE payments SET status='cancelled'/.test(sql));
    expect(cancelSql).toBeTruthy();
    expect(cancelSql[0]).toMatch(/status <> 'paid'/);
    const orderUpdates = poolQuery.mock.calls.filter(([sql]) => /UPDATE orders/.test(sql));
    expect(orderUpdates.length).toBe(0);
  });

  it('webhook: winner A payment after reassignment to B does not mark order paid', async () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = 's3cret';
    const body = {
      data: {
        id: 'cs_stale',
        attributes: {
          type: 'checkout.payment.paid',
          data: {
            id: PAYMENT_ID,
            attributes: {
              status: 'paid',
              payments: [{ attributes: { status: 'paid' } }],
              reference_number: PAYMENT_ID,
            },
          },
        },
      },
    };
    const rawBody = JSON.stringify(body);
    const paymentRow = {
      id: PAYMENT_ID,
      order_id: ORDER_ID,
      customer_id: BUYER_A,
      status: 'pending',
      checkout_session_id: 'cs_stale',
      provider_reference_id: PAYMENT_ID,
    };
    poolQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM payments WHERE checkout_session_id')) return { rows: [paymentRow] };
      if (sql.includes('SELECT * FROM orders WHERE id=$1')) {
        // Order reassigned to winner B
        return { rows: [{ id: ORDER_ID, buyer_id: BUYER_B, status: 'pending' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = mockRes();
    await paymongoWebhook(
      {
        rawBody,
        body,
        headers: { 'paymongo-signature': `t=1,v1=${crypto.createHmac('sha256', 's3cret').update(rawBody).digest('hex')}` },
      },
      res
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ stale: true, reason: 'BUYER_MISMATCH' }));
    const paidUpdates = poolQuery.mock.calls.filter(([sql]) => /UPDATE payments SET status='paid'/.test(sql));
    expect(paidUpdates.length).toBe(0);
  });

  it('webhook: winner B valid payment still works', async () => {
    process.env.PAYMONGO_WEBHOOK_SECRET = 's3cret';
    const body = {
      data: {
        id: 'cs_valid',
        attributes: {
          type: 'checkout.payment.paid',
          data: {
            id: PAYMENT_ID,
            attributes: {
              status: 'paid',
              payments: [{ attributes: { status: 'paid' } }],
            },
          },
        },
      },
    };
    const rawBody = JSON.stringify(body);
    const paymentRow = {
      id: PAYMENT_ID,
      order_id: ORDER_ID,
      customer_id: BUYER_B,
      status: 'pending',
      checkout_session_id: 'cs_valid',
    };
    // settlePaidPaymentWithOrderLock opens its own transaction client.
    poolConnect.mockResolvedValue({
      query: (...args) => poolQuery(...args),
      release: vi.fn(),
    });
    poolQuery.mockImplementation(async (sql) => {
      if (sql.includes('FROM payments WHERE checkout_session_id')) return { rows: [paymentRow] };
      if (sql.includes('SELECT * FROM orders WHERE id=$1')) {
        return { rows: [{ id: ORDER_ID, buyer_id: BUYER_B, status: 'pending' }] };
      }
      // Shared settlement (services/paymentRaceGuard.js): lock the order row,
      // then claim the payment inside the same transaction.
      if (/BEGIN|COMMIT|ROLLBACK/i.test(String(sql).trim())) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM public.orders WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ id: ORDER_ID, buyer_id: BUYER_B, status: 'pending', amount: 5000 }], rowCount: 1 };
      }
      if (sql.includes("FROM public.payments WHERE order_id = $1 AND status = 'paid'")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('UPDATE public.payments')) {
        return { rows: [{ id: PAYMENT_ID }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = mockRes();
    await paymongoWebhook(
      {
        rawBody,
        body,
        headers: { 'paymongo-signature': `t=1,v1=${crypto.createHmac('sha256', 's3cret').update(rawBody).digest('hex')}` },
      },
      res
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true }));
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ stale: true }));
    // The paid transition now happens inside the shared order-locked settlement
    // (services/paymentRaceGuard.js), in the same transaction that locked the
    // order row — so a concurrent winner rotation cannot interleave.
    const settledUpdates = poolQuery.mock.calls.filter(([sql]) => /UPDATE public\.payments/.test(String(sql)));
    expect(settledUpdates.length).toBe(1);
    expect(poolQuery.mock.calls.some(([sql]) => /FROM public\.orders WHERE id = \$1 FOR UPDATE/.test(String(sql)))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// Migration order documentation
// ─────────────────────────────────────────────────────────────
describe('migration order', () => {
  it('new security/schema migrations follow 026/027', () => {
    const files = fs.readdirSync(path.join(dbDir, 'migrations')).sort();
    const i026 = files.indexOf('026_subscription_plan_change.sql');
    const i027 = files.indexOf('027_subscription_hardening.sql');
    const i028 = files.indexOf('028_users_privilege_guard.sql');
    const i029 = files.indexOf('029_products_proposed_schedule.sql');
    expect(i026).toBeGreaterThanOrEqual(0);
    expect(i027).toBe(i026 + 1);
    expect(i028).toBe(i027 + 1);
    expect(i029).toBe(i028 + 1);
  });
});
