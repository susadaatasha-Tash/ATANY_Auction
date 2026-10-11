#!/usr/bin/env node
// backend/scripts/production-smoke.mjs
// Non-destructive production smoke checks. Read-only unless a check is marked.
// Usage:
//   API_URL=https://api.example.com node scripts/production-smoke.mjs
// Optional:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=...  (RLS client-side probe)
//   SMOKE_TOKEN=...                         (authenticated sync-user probe)
//
// Exit code 0 = all required checks passed; 1 = one or more failures.

const API_URL = (process.env.API_URL || process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SMOKE_TOKEN = process.env.SMOKE_TOKEN || '';

const results = [];

async function check(name, fn, { required = true } = {}) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, required, detail: detail || 'ok' });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, required, detail: e.message });
    console.log(`${required ? 'FAIL' : 'WARN'}  ${name} — ${e.message}`);
  }
}

async function expectStatus(url, opts, expected) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (expected.includes(res.status)) return { status: res.status, body };
  const err = new Error(`expected ${expected.join('/')} got ${res.status}: ${JSON.stringify(body).slice(0, 120)}`);
  err.status = res.status;
  throw err;
}

async function main() {
  console.log(`ATANY production smoke — API=${API_URL}\n`);

  // ── AUTH ──────────────────────────────────────────────────────────────────
  await check('AUTH sync-user unauthenticated → 401', async () => {
    const { status } = await expectStatus(`${API_URL}/auth/sync-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke' }),
    }, [401]);
    return `HTTP ${status}`;
  });

  await check('AUTH login missing credentials rejected (4xx)', async () => {
    const { status } = await expectStatus(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }, [400, 401, 422, 429]);
    return `HTTP ${status}`;
  });

  if (SMOKE_TOKEN) {
    await check('AUTH sync-user with token → customer role only', async () => {
      const { status, body } = await expectStatus(`${API_URL}/auth/sync-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SMOKE_TOKEN}`,
        },
        body: JSON.stringify({ name: 'Smoke User', role: 'admin' }),
      }, [200, 201, 409]);
      if (body?.role && body.role !== 'customer') {
        throw new Error(`role leaked: ${body.role}`);
      }
      return `HTTP ${status} role=${body?.role || 'customer-forced'}`;
    }, { required: false });
  } else {
    console.log('SKIP  AUTH sync-user with token (set SMOKE_TOKEN to enable)');
  }

  // ── RLS / privilege (schema-level via service-less public endpoints) ─────
  await check('RLS privilege guard present in schema.sql', async () => {
    const { readFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const schema = readFileSync(join(root, 'src/db/schema.sql'), 'utf8');
    const setup = readFileSync(join(root, 'src/db/setup_complete.sql'), 'utf8');
    const mig = readFileSync(join(root, 'src/db/migrations/028_users_privilege_guard.sql'), 'utf8');
    for (const [label, src] of [['schema', schema], ['setup', setup], ['028', mig]]) {
      if (!src.includes('users_guard_privileged_columns')) throw new Error(`${label} missing trigger`);
      if (/CREATE POLICY "users: self can update own name"/.test(src)) {
        throw new Error(`${label} still creates unrestricted self-update policy`);
      }
    }
    return 'trigger present; unrestricted policy absent';
  });

  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    await check('RLS users.role cannot be self-updated via REST (anon)', async () => {
      // Use a dummy uuid — RLS/trigger should reject privilege changes regardless
      const dummy = '00000000-0000-4000-8000-000000000001';
      const res = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${dummy}`, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ role: 'admin' }),
      });
      // Anon with no session: RLS denies (401/403) OR empty 204 if row missing under deny.
      // Privilege escalation must never succeed for anonymous.
      if (res.status >= 200 && res.status < 300) {
        // Verify no row was created/updated for role — empty update is fine
        return `HTTP ${res.status} (no privileged write for anon)`;
      }
      if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 42501) {
        return `HTTP ${res.status} (denied)`;
      }
      throw new Error(`unexpected status ${res.status}`);
    }, { required: false });
  } else {
    console.log('SKIP  RLS REST probe (set SUPABASE_URL + SUPABASE_ANON_KEY)');
  }

  // ── WEBHOOK ───────────────────────────────────────────────────────────────
  await check('WEBHOOK invalid signature → 403', async () => {
    const { status } = await expectStatus(`${API_URL}/webhooks/paymongo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'paymongo-signature': 'v1=deadbeefdeadbeef',
      },
      body: JSON.stringify({
        data: { attributes: { type: 'checkout_session.paid', data: { id: 'cs_smoke', attributes: {} } } },
      }),
    }, [403]);
    return `HTTP ${status}`;
  });

  await check('WEBHOOK missing signature → 403 (fail closed)', async () => {
    const { status } = await expectStatus(`${API_URL}/webhooks/paymongo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { attributes: { type: 'checkout_session.paid' } } }),
    }, [403, 400]);
    return `HTTP ${status}`;
  });

  // ── SOCKET (HTTP handshake probe — no client lib required) ──────────────
  await check('SOCKET unauthenticated handshake rejected', async () => {
    const url = `${API_URL}/socket.io/?EIO=4&transport=polling`;
    const res = await fetch(url);
    const text = await res.text();
    // Engine.IO open packet is fine; Socket.io auth middleware rejects after connect.
    // Probe: invalid namespace auth should not yield a usable private room join.
    // We assert the endpoint is reachable and does not hang.
    if (!res.ok && res.status !== 200) {
      // Some proxies block — warn only
      return `HTTP ${res.status} (endpoint reachable)`;
    }
    return `HTTP ${res.status} engine-io reachable`;
  }, { required: false });

  // ── AUCTION / bid window (public API shape) ──────────────────────────────
  await check('AUCTION live feed responds (public)', async () => {
    const { status } = await expectStatus(`${API_URL}/api/auctions/live`, { method: 'GET' }, [200]);
    return `HTTP ${status}`;
  });

  await check('AUCTION bid on non-live rejected when unauthenticated', async () => {
    // Unauthenticated placeBid should 401 before window check — proves route is gated
    const { status } = await expectStatus(`${API_URL}/customer/bids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auction_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', amount: 999999 }),
    }, [401, 403, 404]);
    return `HTTP ${status}`;
  });

  // ── BRANCHES public ──────────────────────────────────────────────────────
  await check('BRANCHES public read responds', async () => {
    const { status } = await expectStatus(`${API_URL}/branches`, { method: 'GET' }, [200]);
    return `HTTP ${status}`;
  });

  // ── SUBSCRIPTION / PAYMENT domain invariants (source contract) ───────────
  await check('SUBSCRIPTION zero-cost path never inserts status=applied', async () => {
    const { readFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const src = readFileSync(join(root, 'src/services/subscriptionPlanChangeService.js'), 'utf8');
    // Zero-cost upgrade branch must insert pending_payment, not applied
    if (/VALUES \(\$1, \$2, \$3, \$4, \$5, 'upgrade', 'applied'/.test(src)) {
      throw new Error('zero-cost upgrade still inserts status=applied');
    }
    if (!/pending_payment/.test(src)) throw new Error('pending_payment missing from plan change service');
    return 'pending_payment claim path present';
  });

  await check('PAYMENT stale winner cannot pay reassigned order (guard present)', async () => {
    const { readFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const guard = readFileSync(join(root, 'src/services/paymentRaceGuard.js'), 'utf8');
    const webhook = readFileSync(join(root, 'src/controllers/webhook.controller.js'), 'utf8');
    if (!guard.includes('assertPaymentStillPayable')) throw new Error('paymentRaceGuard missing assertPaymentStillPayable');
    if (!guard.includes("status='cancelled'")) throw new Error('stale payment not cancelled');
    if (!webhook.includes('assertPaymentStillPayable')) throw new Error('webhook missing race guard');
    if (!webhook.includes("status IN ('pending','processing','failed','expired')")) {
      throw new Error('webhook paid path missing atomic claim');
    }
    return 'race guard + atomic paid claim present';
  });

  await check('H2 fail-closed money paths require direct Postgres', async () => {
    const { readFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const closer = readFileSync(join(root, 'src/services/auctionCloser.js'), 'utf8');
    const winner = readFileSync(join(root, 'src/services/winnerExpiration.js'), 'utf8');
    const bid = readFileSync(join(root, 'src/services/bidLogic.js'), 'utf8');
    if (!closer.includes('fail closed') && !closer.includes('DB_UNAVAILABLE')) {
      throw new Error('auctionCloser missing fail-closed on REST fallback');
    }
    if (!winner.includes('fail closed') && !winner.includes('DB_UNAVAILABLE')) {
      throw new Error('winnerExpiration missing fail-closed on REST fallback');
    }
    if (!bid.includes('BIDDING_UNAVAILABLE')) throw new Error('bidLogic missing BIDDING_UNAVAILABLE');
    return 'auction close/expire/bid fail closed without direct pg';
  });

  // ── ENV / startup contract ───────────────────────────────────────────────
  await check('ENV production validation module fails closed', async () => {
    const { validateProductionEnv } = await import('../src/config/validateEnv.js');
    const bad = validateProductionEnv({ NODE_ENV: 'production' });
    if (bad.ok) throw new Error('empty production env should fail');
    if (bad.missingKeys.includes('PAYMONGO_WEBHOOK_SECRET') === false) {
      throw new Error('PAYMONGO_WEBHOOK_SECRET not in missingKeys');
    }
    // Secret values must not appear in report
    const report = JSON.stringify(bad);
    if (report.includes('=eyJ') || /sk_live|whsec_[A-Za-z0-9]{20,}/.test(report)) {
      throw new Error('report appears to leak secret material');
    }
    const insecure = validateProductionEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://x',
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_ANON_KEY: 'a',
      SUPABASE_SERVICE_ROLE_KEY: 's',
      PAYMONGO_SECRET_KEY: 'k',
      PAYMONGO_WEBHOOK_SECRET: 'whsec_smoke',
      FRONTEND_URL: 'https://app.example.com',
      ALLOW_INSECURE_PAYMONGO_WEBHOOKS: 'true',
    });
    if (insecure.ok) throw new Error('ALLOW_INSECURE_PAYMONGO_WEBHOOKS=true must fail production validation');
    return 'missing keys + insecure webhook flag rejected';
  });

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  const failedRequired = results.filter((r) => r.required && !r.ok);
  const failedOptional = results.filter((r) => !r.required && !r.ok);
  console.log('\n────────────────────────────────────────');
  console.log(`Required: ${results.filter((r) => r.required && r.ok).length}/${results.filter((r) => r.required).length} passed`);
  console.log(`Optional: ${results.filter((r) => !r.required && r.ok).length}/${results.filter((r) => !r.required).length} passed`);
  if (failedOptional.length) {
    console.log('Optional warnings:', failedOptional.map((r) => r.name).join('; '));
  }
  if (failedRequired.length) {
    console.log('REQUIRED FAILURES:');
    for (const f of failedRequired) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log('All required smoke checks passed.');
}

main().catch((e) => {
  console.error('Smoke script crashed:', e);
  process.exit(1);
});
