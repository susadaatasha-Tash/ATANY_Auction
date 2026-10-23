// frontend/src/shared/config/__tests__/supportAddress.test.js
// The official ATANY support destination — goldjewelryauction@gmail.com
//
// This suite guards the whole user-facing surface:
//  1. The address is declared in exactly ONE frontend module.
//  2. No outdated official support mailbox remains in any ATANY UI.
//  3. The mailto fallback is properly URL-encoded.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SUPPORT_EMAIL, supportMailto, SUPPORT_CATEGORIES } from '../support';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../../..');

/** Every user-facing source file (pages, layouts, roles, shared). */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, out);
      continue;
    }
    if (/\.(jsx?|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('the official ATANY support address', () => {
  it('is goldjewelryauction@gmail.com', () => {
    expect(SUPPORT_EMAIL).toBe('goldjewelryauction@gmail.com');
  });

  it('is declared in exactly ONE frontend module', () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      if (file.endsWith(path.join('config', 'support.js'))) continue;
      if (file.includes(`${path.sep}__tests__${path.sep}`)) continue;
      if (fs.readFileSync(file, 'utf8').includes('goldjewelryauction@gmail.com')) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no outdated official support mailbox remains in the user-facing ATANY UI', () => {
    const outdated = ['support@atany.ph', 'hello@atany.ph', 'partnerships@atany.ph'];
    const offenders = [];
    for (const file of walk(SRC)) {
      if (file.includes(`${path.sep}__tests__${path.sep}`)) continue;
      const src = fs.readFileSync(file, 'utf8');
      for (const mail of outdated) {
        if (src.includes(mail)) offenders.push(`${path.relative(SRC, file)} → ${mail}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the mailto fallback is properly URL-encoded', () => {
    const href = supportMailto('Account Suspension — Maria Santos', 'Line one\nLine two & more');
    expect(href.startsWith('mailto:goldjewelryauction@gmail.com?')).toBe(true);
    expect(href).toContain('subject=Account%20Suspension');
    expect(href).toContain('%26');
    expect(href).not.toContain('\n');
    // The raw subject must never leak into the query string unencoded.
    expect(decodeURIComponent(href.split('?')[1])).toContain('Account Suspension — Maria Santos');
  });

  it('exposes the whitelisted support categories', () => {
    expect(SUPPORT_CATEGORIES).toContain('General Inquiry');
    expect(SUPPORT_CATEGORIES).toContain('Account Issue');
    expect(SUPPORT_CATEGORIES).toContain('Billing / Subscription');
    expect(SUPPORT_CATEGORIES).toContain('Auction / Payment Support');
  });

  it('never exposes a credential to the frontend', () => {
    const src = fs.readFileSync(path.join(SRC, 'shared', 'config', 'support.js'), 'utf8');
    expect(src).not.toMatch(/RESEND_API_KEY|SMTP_PASSWORD|APP_PASSWORD|re_[a-zA-Z0-9]{10}/);
    expect(src).not.toMatch(/service_role/i);
  });
});
