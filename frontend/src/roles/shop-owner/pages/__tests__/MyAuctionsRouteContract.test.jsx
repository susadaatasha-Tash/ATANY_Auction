import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('MyAuctions frontend route contract', () => {
  it('uses /shop-owner/... without double /api prefix', () => {
    const src = fs.readFileSync(path.join(__dirname, '../MyAuctions.jsx'), 'utf8');
    expect(src).toMatch(/apiFetch\('\/shop-owner\/auctions\/manage/);
    expect(src).toMatch(/apiFetch\('\/shop-owner\/auctions\/top-bidders/);
    expect(src).not.toMatch(/\/api\/shop-owner/);
    expect(src).not.toMatch(/http:\/\/localhost:4000\/api/);
  });

  it('all mutation endpoints use /shop-owner/...', () => {
    const src = fs.readFileSync(path.join(__dirname, '../MyAuctions.jsx'), 'utf8');
    for (const action of ['start', 'extend', 'pause', 'resume', 'end', 'relist']) {
      expect(src).toContain(`/shop-owner/auctions/`);
      expect(src).toContain(`/${action}`);
    }
    // Ensure the map uses template literal with auction.id
    expect(src).toMatch(/\/shop-owner\/auctions\/\$\{auction\.id\}\/start/);
  });

  it('apiClient BASE is http://localhost:4000 without /api — ensures no double prefix', () => {
    const apiClient = fs.readFileSync(path.join(__dirname, '../../../../shared/lib/apiClient.js'), 'utf8');
    expect(apiClient).toMatch(/VITE_API_URL \|\| 'http:\/\/localhost:4000'/);
    const envExample = fs.readFileSync(path.join(__dirname, '../../../../../.env.example'), 'utf8');
    expect(envExample).toMatch(/VITE_API_URL=http:\/\/localhost:4000/);
    expect(envExample).not.toMatch(/VITE_API_URL=http:\/\/localhost:4000\/api/);
  });

  it('MyAuctions does not hardcode localhost URL directly', () => {
    const src = fs.readFileSync(path.join(__dirname, '../MyAuctions.jsx'), 'utf8');
    expect(src).not.toMatch(/http:\/\/localhost:4000\/api\/shop-owner/);
    expect(src).not.toMatch(/http:\/\/localhost:4000\/shop-owner/);
    // All fetches go through apiFetch helper
    const directFetchCount = (src.match(/fetch\(/g) || []).length;
    expect(directFetchCount).toBe(0);
  });
});
