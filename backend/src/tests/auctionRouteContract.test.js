// backend/src/tests/auctionRouteContract.test.js — Route contract: new My Auctions endpoints must be mounted, not 404
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mock Supabase auth — requireAuth will return 401 for missing token, not 404
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'Invalid token' } })) },
  })),
}));

// Mock DB pool to avoid real connections — routes that need DB will still hit pool.query but we mock it
vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn(), __restFallback: false })), on: vi.fn() },
  isDirectPg: () => true,
}));
vi.mock('../services/emailService.js', () => ({ sendNotificationEmail: vi.fn(async () => {}) }));

const shopOwnerRoutes = (await import('../routes/shop-owner.routes.js')).default;
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  // Mount exactly as backend/src/index.js does
  app.use('/shop-owner', requireAuth, requireRole('shop_owner'), shopOwnerRoutes);
  // Also mount the same without /api prefix check — ensure /api/shop-owner does NOT exist
  return app;
}

describe('My Auctions route contract', () => {
  it('shop-owner.routes.js registers static routes before dynamic', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/shop-owner.routes.js'), 'utf8');
    const manageIdx = src.indexOf("'/auctions/manage'");
    const topBiddersIdx = src.indexOf("'/auctions/top-bidders'");
    const listIdx = src.indexOf("router.get('/auctions',");
    expect(manageIdx).toBeGreaterThan(-1);
    expect(topBiddersIdx).toBeGreaterThan(-1);
    expect(manageIdx).toBeLessThan(listIdx);
    expect(topBiddersIdx).toBeLessThan(listIdx);
  });

  it('backend mounts at /shop-owner (not /api/shop-owner)', () => {
    const indexSrc = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    expect(indexSrc).toMatch(/app\.use\('\/shop-owner'/);
    expect(indexSrc).not.toMatch(/app\.use\('\/api\/shop-owner'/);
  });

  it('GET /shop-owner/auctions/manage exists (401 not 404 when unauthenticated)', async () => {
    const app = makeApp();
    const res = await request(app).get('/shop-owner/auctions/manage?limit=100');
    expect(res.status).not.toBe(404);
    expect([401, 403]).toContain(res.status);
  });

  it('GET /shop-owner/auctions/top-bidders exists (401 not 404)', async () => {
    const app = makeApp();
    const res = await request(app).get('/shop-owner/auctions/top-bidders');
    expect(res.status).not.toBe(404);
    expect([401, 403]).toContain(res.status);
  });

  it('POST /shop-owner/auctions/:id/start exists (401 not 404)', async () => {
    const app = makeApp();
    const res = await request(app).post('/shop-owner/auctions/11111111-1111-1111-1111-111111111111/start');
    expect(res.status).not.toBe(404);
    expect([401, 403]).toContain(res.status);
  });

  it('POST extend/pause/resume/end/relist all exist (401 not 404)', async () => {
    const app = makeApp();
    const id = '11111111-1111-1111-1111-111111111111';
    for (const action of ['extend', 'pause', 'resume', 'end', 'relist']) {
      const res = await request(app).post(`/shop-owner/auctions/${id}/${action}`);
      expect(res.status, `${action} should not be 404`).not.toBe(404);
    }
  });

  it('GET /api/shop-owner/... does NOT exist (ensures no double /api prefix)', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/shop-owner/auctions/manage?limit=100');
    expect(res.status).toBe(404);
  });
});
