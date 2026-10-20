// backend/src/tests/sellerApplicationRemoval.test.js
// Product scope change: Seller Application removed from Admin Portal + Landing/Public.
// Verifies: public endpoint returns 410 Gone; admin review routes are unmounted;
// DB schema (seller_applications) is preserved; seller/auth paths unaffected.
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');

vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })), on: vi.fn() },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: { createUser: vi.fn(), updateUser: vi.fn() },
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }) }) }) }),
  }),
}));
vi.mock('../services/auctionCloser.js', () => ({ closeExpiredAuctions: vi.fn() }));
vi.mock('../services/auctionStarter.js', () => ({ startScheduledAuctions: vi.fn() }));
vi.mock('../services/winnerExpiration.js', () => ({ checkAndExpireWinners: vi.fn() }));
vi.mock('../services/paymentReminder.js', () => ({ sendPaymentReminders: vi.fn() }));
vi.mock('../services/auctionService.js', () => ({ listAuctions: vi.fn(async () => []) }));
vi.mock('../services/storageService.js', () => ({ createUploadUrl: vi.fn(async () => ({})) }));
vi.mock('../services/chatbotService.js', () => ({ chatbotReply: vi.fn(async () => ({})) }));

// Mirror production mounting decisions from backend/src/index.js after removal.
async function buildApp() {
  const app = express();
  app.use(express.json());
  // Auth routes remain mounted (customer signup path + admin-only /auth/signup)
  const { default: authRoutes } = await import('../routes/auth.routes.js');
  app.use('/auth', authRoutes);
  // Seller application feature removed — public submission endpoint returns 410 Gone
  app.use('/seller-applications', (req, res) => {
    res.status(410).json({ message: 'Seller application is no longer available.' });
  });
  // Admin seller-applications router is NOT mounted
  const { default: adminRoutes } = await import('../routes/admin.routes.js');
  app.use('/admin', (req, res, next) => next());
  app.use('/admin', adminRoutes);
  // Fallback
  app.use((req, res) => res.status(404).json({ message: 'Not found' }));
  return app;
}

describe('Seller Application removal — backend contract', () => {
  it('POST /seller-applications returns 410 Gone (removed public submission endpoint)', async () => {
    const app = await buildApp();
    const res = await request(app).post('/seller-applications').send({
      shop_name: 'Test Shop',
      contact_number: '09171234567',
      email: 'shop@example.com',
      application_reason: 'new shop',
    });
    expect(res.status).toBe(410);
    expect(res.body.message).toMatch(/no longer available/i);
  });

  it('GET /seller-applications/me also returns 410 Gone', async () => {
    const app = await buildApp();
    const res = await request(app).get('/seller-applications/me');
    expect(res.status).toBe(410);
  });

  it('admin review routes are not mounted (/admin/seller-applications is unavailable)', async () => {
    const app = await buildApp();
    const list = await request(app).get('/admin/seller-applications');
    // Admin routes fall through to 404 — no Seller Applications review API
    expect(list.status).toBe(404);
    expect(list.body?.message).not.toMatch(/seller application/i);

    const approve = await request(app).post('/admin/seller-applications/abc/approve');
    expect(approve.status).toBe(404);
  });

  it('index.js no longer imports or mounts seller-application routers', async () => {
    const indexSrc = readFileSync(join(repoRoot, 'src/index.js'), 'utf8');
    expect(indexSrc).not.toMatch(/sellerApplicationRoutes/);
    expect(indexSrc).not.toMatch(/adminSellerAppRoutes/);
    expect(indexSrc).not.toMatch(/routes\/seller-application\.routes\.js/);
    expect(indexSrc).not.toMatch(/routes\/admin-seller-applications\.routes\.js/);
    // 410 handler remains for the public path
    expect(indexSrc).toMatch(/app\.use\('\/seller-applications'/);
    expect(indexSrc).toMatch(/status\(410\)/);
  });

  it('DB schema still contains seller_applications table + enum (historical data preserved)', () => {
    const setup = readFileSync(join(repoRoot, 'src/db/setup_complete.sql'), 'utf8');
    expect(setup).toMatch(/seller_application_status/);
    expect(setup).toMatch(/CREATE TABLE IF NOT EXISTS seller_applications/);

    const migration = readFileSync(join(repoRoot, 'src/db/migrations/012_new_tables_and_features.sql'), 'utf8');
    expect(migration).toMatch(/seller_applications/);
  });

  it('auth routes remain intact (login, sync-user, admin-only signup)', () => {
    // Static check: public signup path is not the seller-application flow
    const authSrc = readFileSync(join(repoRoot, 'src/routes/auth.routes.js'), 'utf8');
    expect(authSrc).toMatch(/router\.post\('\/login'/);
    expect(authSrc).toMatch(/router\.post\('\/sync-user'/);
    expect(authSrc).toMatch(/router\.post\('\/signup',\s*requireAuth,\s*requireRole\(\['admin'\]\)/);
  });

  it('admin user-management routes still exist (existing sellers manageable via Users & Roles)', () => {
    const adminSrc = readFileSync(join(repoRoot, 'src/routes/admin.routes.js'), 'utf8');
    expect(adminSrc).toMatch(/router\.get\('\/users'/);
    expect(adminSrc).toMatch(/router\.put\('\/users\/:id'/);
    expect(adminSrc).not.toMatch(/seller-applications/);
  });

  it('seller-application route files are orphaned (not mounted) but controller kept for history', () => {
    // Route files may still exist on disk but are not imported by index.js
    const indexSrc = readFileSync(join(repoRoot, 'src/index.js'), 'utf8');
    expect(indexSrc).not.toMatch(/seller-application\.routes/);
    // shop-owner routes still mounted — existing sellers keep their portal API
    expect(indexSrc).toMatch(/app\.use\('\/shop-owner'/);
    // billing routes still mounted — existing seller subscriptions untouched
    expect(indexSrc).toMatch(/app\.use\('\/billing'/);
  });
});
