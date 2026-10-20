#!/usr/bin/env node
// backend/scripts/testResendDev.mjs
// SAFE development-only test for existing Resend integration.
// - Uses existing backend/src/services/emailService.js (no second service)
// - Reads RESEND_API_KEY and RESEND_FROM_EMAIL from process.env (never logs keys)
// - Default: sends via onboarding@resend.dev (works without domain verification)
// - With --verified or --use-configured: sends via RESEND_FROM_EMAIL (requires verified domain)
// - To: CLI arg 1 (your verified Resend account email for test mode)
// - Dev-only: refuses to run in production unless --force
// Usage:
//   node --env-file=.env scripts/testResendDev.mjs recipient@example.com
//   node --env-file=.env scripts/testResendDev.mjs recipient@example.com --verified

import 'dotenv/config';
import { sendNotificationEmail, resolveFromEmail } from '../src/services/emailService.js';

const recipient = process.argv.find(arg => arg.includes('@'));
const isProduction = process.env.NODE_ENV === 'production';
const force = process.argv.includes('--force');
const useConfigured = process.argv.includes('--verified') || process.argv.includes('--use-configured') || process.argv.includes('--from-configured');

if (isProduction && !force) {
  console.error('[testResendDev] Refusing to run in production. Use --force if you really want to.');
  process.exit(1);
}

const key = process.env.RESEND_API_KEY;
if (!key) {
  console.error('[testResendDev] RESEND_API_KEY missing in backend/.env — add it first.');
  process.exit(1);
}

// Safe key logging: never expose full key
const keyPrefix = key.slice(0, 3);
const keyLen = key.length;
console.log(`[testResendDev] RESEND_API_KEY present: ${keyPrefix}*** (length ${keyLen})`);
console.log(`[testResendDev] Node env: ${process.env.NODE_ENV || 'development'}`);
const configuredFrom = process.env.RESEND_FROM_EMAIL || '';
console.log(`[testResendDev] RESEND_FROM_EMAIL: ${configuredFrom ? configuredFrom : '(not set, will fallback in dev)'}`);
console.log(`[testResendDev] Resolved from (emailService): ${resolveFromEmail() || '(none — would fail in production)'}`);

if (!recipient) {
  console.log(`
Usage:
  node --env-file=.env scripts/testResendDev.mjs recipient@example.com
  node --env-file=.env scripts/testResendDev.mjs recipient@example.com --verified

Notes:
  - recipient must be the email associated with your Resend account unless sender domain is verified
  - This script reuses backend/src/services/emailService.js (no second service)
  - Default test sender: ATANY Test <onboarding@resend.dev> (works in dev without domain verification)
  - With --verified: uses RESEND_FROM_EMAIL (${configuredFrom || 'ATANY <noreply@atany.ph> example'}) — requires verified domain
  - Existing service sender is now configured via RESEND_FROM_EMAIL env, not hardcoded
`);
  process.exit(0);
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(recipient)) {
  console.error(`[testResendDev] Invalid recipient email: ${recipient}`);
  process.exit(1);
}

// Determine sender for direct test
let directFrom;
if (useConfigured) {
  directFrom = resolveFromEmail();
  if (!directFrom) {
    console.error('[testResendDev] --verified requested but RESEND_FROM_EMAIL is not configured and no fallback in production.');
    process.exit(1);
  }
  console.log(`[testResendDev] Sending test email via configured sender (${directFrom}) to ${recipient} ...`);
} else {
  // Development default — always use onboarding to avoid domain requirement
  directFrom = 'ATANY Test <onboarding@resend.dev>';
  console.log(`[testResendDev] Sending test email via onboarding@resend.dev to ${recipient} ...`);
}

try {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: directFrom,
      to: recipient,
      subject: 'ATANY Email Test',
      html: `
        <div style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif; max-width:600px;">
          <h2 style="color:#0f3d2e;">ATANY Email Test ✓</h2>
          <p>This is a development test of the existing ATANY Resend integration.</p>
          <p><strong>Sent via:</strong> ${directFrom}</p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
          <p><strong>Backend service:</strong> backend/src/services/emailService.js (RESEND_FROM_EMAIL env)</p>
          <p style="color:#6b7280; font-size:13px;">If you received this, Resend authentication succeeded. For production, verify sender domain in Resend Dashboard.</p>
        </div>
      `,
    }),
  });
  const body = await res.text();
  if (res.ok) {
    console.log('[testResendDev] ✓ Resend authenticated successfully');
    try {
      const json = JSON.parse(body);
      console.log('[testResendDev] Resend response:', JSON.stringify({ id: json.id }, null, 2));
      console.log('[testResendDev] Email queued for delivery to', recipient);
      console.log('[testResendDev] Check inbox (and spam). Resend dashboard: https://resend.com/emails');
    } catch {
      console.log('[testResendDev] Resend response (raw):', body.slice(0, 500));
    }
  } else {
    console.error('[testResendDev] ✗ Resend error:', res.status, body.slice(0, 1000));
    if (res.status === 401) console.error('[testResendDev] → Invalid RESEND_API_KEY. Regenerate in Resend dashboard.');
    if (res.status === 403) console.error('[testResendDev] → Sender domain not verified. onboarding@resend.dev can only send to your own Resend account email in test mode. For configured sender, verify domain at resend.com/domains.');
    if (body.includes('Domain is not verified')) console.error('[testResendDev] → Verify domain in Resend Dashboard > Domains, or use onboarding@resend.dev for tests (default).');
    if (!useConfigured && body.includes('Domain is not verified')) {
      console.error('[testResendDev] Hint: try with --verified only after domain is verified.');
    }
    process.exit(1);
  }
} catch (e) {
  console.error('[testResendDev] Network error:', e.message);
  process.exit(1);
}

// 2) Also exercise existing emailService (uses RESEND_FROM_EMAIL env or dev fallback)
console.log(`\n[testResendDev] Also testing existing emailService.js (sender: ${resolveFromEmail() || 'none'}) ...`);
if (!resolveFromEmail() && isProduction) {
  console.log('[testResendDev] Skipped — no sender configured and in production (would fail clearly).');
} else {
  console.log('[testResendDev] Note: This uses RESEND_FROM_EMAIL env if set, otherwise dev fallback onboarding@resend.dev.');
  try {
    await sendNotificationEmail({
      to: recipient,
      subject: 'ATANY Email Test (via emailService)',
      html: `<p>Test via existing <code>sendNotificationEmail</code> using <code>${resolveFromEmail()}</code> at ${new Date().toISOString()}</p>`,
    });
    console.log('[testResendDev] sendNotificationEmail call completed — check logs above for "Resend error" if domain unverified.');
  } catch (e) {
    console.error('[testResendDev] sendNotificationEmail threw:', e.message);
  }
}

console.log('\n[testResendDev] Done. Summary:');
console.log('- If onboarding@resend.dev test succeeded: RESEND_API_KEY is valid');
console.log('- If configured sender test failed with domain error: verify domain in Resend before production');
console.log('- No API key was logged');
