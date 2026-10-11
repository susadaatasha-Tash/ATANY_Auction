// backend/src/tests/adminLogsRemoval.test.js
// Product scope change: Audit Logs viewer + Chatbot Logs viewer removed from Admin API/UI.
// Backend audit logging (audit_logs inserts) and chatbot functionality (chatbotService +
// chatbotLogService persistence) are intentionally preserved.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');

vi.mock('../db/pool.js', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })), on: vi.fn() },
}));
vi.mock('../services/chatbotService.js', () => ({ chatbotReply: vi.fn(async () => ({ reply: 'ok' })) }));
vi.mock('../services/auctionCloser.js', () => ({ closeExpiredAuctions: vi.fn() }));
vi.mock('../services/auctionStarter.js', () => ({ startScheduledAuctions: vi.fn() }));
vi.mock('../services/winnerExpiration.js', () => ({ checkAndExpireWinners: vi.fn() }));
vi.mock('../services/paymentReminder.js', () => ({ sendPaymentReminders: vi.fn() }));
vi.mock('../services/auctionService.js', () => ({ listAuctions: vi.fn(async () => []) }));
vi.mock('../services/storageService.js', () => ({ createUploadUrl: vi.fn(async () => ({})) }));

describe('Audit Logs + Chatbot Logs removal — backend contract', () => {
  it('index.js no longer mounts admin audit-logs viewer API', () => {
    const indexSrc = readFileSync(join(repoRoot, 'src/index.js'), 'utf8');
    expect(indexSrc).not.toMatch(/adminAuditRoutes/);
    expect(indexSrc).not.toMatch(/routes\/admin-audit\.routes\.js/);
    expect(indexSrc).not.toMatch(/app\.use\('\/admin\/audit-logs'/);
    // Other admin mounts remain
    expect(indexSrc).toMatch(/app\.use\('\/admin',\s*requireAuth,\s*requireRole\(\['admin'\]\),\s*adminRoutes\)/);
  });

  it('admin.routes.js no longer registers chatbot-logs viewer endpoints', () => {
    const adminSrc = readFileSync(join(repoRoot, 'src/routes/admin.routes.js'), 'utf8');
    expect(adminSrc).not.toMatch(/chatbot-logs/);
    expect(adminSrc).not.toMatch(/chatbot\.controller/);
    // Security alerts + users + branches remain
    expect(adminSrc).toMatch(/security-alerts/);
    expect(adminSrc).toMatch(/\/users/);
    expect(adminSrc).toMatch(/\/branches/);
  });

  it('chatbot functionality (service + log persistence) is preserved', () => {
    const indexSrc = readFileSync(join(repoRoot, 'src/index.js'), 'utf8');
    expect(indexSrc).toMatch(/chatbotService\.js/);
    expect(indexSrc).toMatch(/chatbotLogService\.js/);
    expect(indexSrc).toMatch(/app\.post\('\/chat'/);

    const serviceSrc = readFileSync(join(repoRoot, 'src/services/chatbotService.js'), 'utf8');
    expect(serviceSrc).toMatch(/export async function chatbotReply/);

    const logSrc = readFileSync(join(repoRoot, 'src/services/chatbotLogService.js'), 'utf8');
    expect(logSrc).toMatch(/export async function logChatTurn/);
  });

  it('backend audit logging (audit_logs inserts) is preserved for security/history', () => {
    const userCtrl = readFileSync(join(repoRoot, 'src/controllers/admin/user.controller.js'), 'utf8');
    expect(userCtrl).toMatch(/INSERT INTO audit_logs/);

    const setup = readFileSync(join(repoRoot, 'src/db/setup_complete.sql'), 'utf8');
    expect(setup).toMatch(/CREATE TABLE IF NOT EXISTS audit_logs/);
  });

  it('chatbot DB tables are not dropped (persistence preserved)', () => {
    const migration = readFileSync(join(repoRoot, 'src/db/migrations/023_chatbot_sessions.sql'), 'utf8');
    expect(migration).toMatch(/chatbot_sessions/);
    expect(migration).toMatch(/chatbot_messages/);
  });

  it('Security Alerts admin API routes remain mounted', () => {
    const adminSrc = readFileSync(join(repoRoot, 'src/routes/admin.routes.js'), 'utf8');
    expect(adminSrc).toMatch(/router\.get\('\/security-alerts'/);
    expect(adminSrc).toMatch(/router\.patch\('\/security-alerts\/:id'/);
  });

  it('frontend admin routes files no longer import AuditLogs/ChatbotLogs', () => {
    const routesSrc = readFileSync(join(repoRoot, '../frontend/src/roles/admin/routes.jsx'), 'utf8');
    expect(routesSrc).not.toMatch(/AuditLogs/);
    expect(routesSrc).not.toMatch(/ChatbotLogs/);
    expect(routesSrc).toMatch(/SecurityAlerts/);
  });
});
