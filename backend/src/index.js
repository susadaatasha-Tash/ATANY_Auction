// backend/src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import customerRoutes from './routes/customer.routes.js';
import shopOwnerRoutes from './routes/shop-owner.routes.js';
import adminRoutes from './routes/admin.routes.js';
import { requireAuth } from './middleware/requireAuth.js';
import { requireRole } from './middleware/requireRole.js';
import { pool, getPoolHealth } from './db/pool.js';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cron from 'node-cron';
import { createSocketAuth } from './services/socketAuth.js';
import { closeExpiredAuctions } from './services/auctionCloser.js';
import { startScheduledAuctions } from './services/auctionStarter.js';
import { checkAndExpireWinners } from './services/winnerExpiration.js';
import { sendPaymentReminders } from './services/paymentReminder.js';
import { listAuctions as listAuctionsService } from './services/auctionService.js';
import { createUploadUrl } from './services/storageService.js';
import { chatbotReply } from './services/chatbotService.js';
import reviewRoutes from './routes/review.routes.js';
import messageRoutes from './routes/message.routes.js';
import billingRoutes from './routes/billing.routes.js';
import subscriptionPlansRoutes from './routes/subscription-plans.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import { rateLimit } from './middleware/rateLimit.js';
import { validateProductionEnv, warnMissingDevEnv, formatEnvReport } from './config/validateEnv.js';
import { runExclusiveJob } from './services/jobLock.js';

// ── Production env fail-fast (H2 / production readiness) ────────────────────
const envCheck = validateProductionEnv(process.env);
if (!envCheck.ok) {
  console.error('[startup] FATAL: production environment validation failed');
  console.error('[startup]', formatEnvReport(envCheck));
  console.error('[startup] Refusing to start. Fix env vars (values are never logged).');
  process.exit(1);
}
if (envCheck.ok && envCheck.mode === 'production') {
  console.log('[startup] production env validation OK (secrets not logged)');
} else {
  for (const w of warnMissingDevEnv(process.env)) console.warn('[startup] env:', w);
}

const app = express();
const corsOrigin = (origin, callback) => {
  if (!origin || /^http:\/\/localhost:\d+$/.test(origin)) return callback(null, true);
  // Allowed non-localhost origins: FRONTEND_URL plus optional comma-separated
  // FRONTEND_URLS (e.g. a Dev Tunnel frontend origin for phone testing).
  // No wildcard is used because credentials/JWT auth require explicit origins.
  const allowed = [process.env.FRONTEND_URL, ...(process.env.FRONTEND_URLS || '').split(',')]
    .map((s) => (s || '').trim())
    .filter(Boolean);
  if (allowed.includes(origin)) return callback(null, true);
  callback(new Error('Not allowed by CORS'));
};
app.use(cors({ origin: corsOrigin, credentials: true }));
// Webhook must be mounted before global json to capture raw body for signature
// H2 note: PayMongo webhook endpoint is NOT rate-limited (legitimate provider retries).
app.use('/webhooks', webhookRoutes);
app.use(express.json());

// Inject io into req for controllers (bidLogic broadcast)
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: corsOrigin } });
app.use((req, _res, next) => { req.io = io; next(); });
// Priority 1 / H1: authenticate every Socket.io handshake via Supabase JWT.
// join:user ignores client-supplied ids — private room is joined in middleware.
io.use(createSocketAuth());
io.on('connection', (socket) => {
  // Spec 1: live bidding updates — client subscribes via socketClient.js
  // Auction rooms are public observation channels (no private data).
  socket.on('join:auction', (auctionId) => {
    if (auctionId) socket.join(`auction:${auctionId}`);
  });
  // Deprecated client event — identity room already joined by socketAuth middleware.
  socket.on('join:user', () => {
    /* no-op: authenticated user room is automatic */
  });
});

// Public — branch locator read-only (spec 4.5) + chatbot (spec 4.8 Groq server-only)
app.get('/branches', rateLimit({ name: 'branches', windowMs: 60_000, max: 60 }), async (_req, res) => {
  try { res.json((await pool.query('SELECT * FROM branches')).rows); }
  catch (e) {
    // Fallback to Supabase REST when direct pg (IPv6) is unreachable — keeps Dashboard branch badge alive
    try {
      const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/branches?select=*`, {
        headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }
      });
      res.json(await r.json());
    } catch (err2) { res.status(500).json({ message: 'Failed to load branches' }); }
  }
});
app.post('/chat', rateLimit({ name: 'chat', windowMs: 60_000, max: 20 }), async (req, res) => {
  const { query, message, history, mode, userId } = req.body;
  const text = query || message;
  // mode: 'customer' or 'seller' — from frontend page context (Landing/Login/Signup/Customer vs Shop Owner)
  const result = await chatbotReply(text, { userId: req.user?.id, mode: mode || 'customer', history: history || [] });
  // Chatbot conversation persistence (internal). Failure-safe: logging must
  // never break the chatbot response, so errors are swallowed inside the service.
  // userId is client-supplied (route is public); the service validates it against
  // users and falls back to NULL (guest) for missing/invalid ids — no fake accounts.
  try {
    const replyText = result?.reply || result?.response || '';
    if (text && replyText) {
      const { logChatTurn } = await import('./services/chatbotLogService.js');
      const escalated = /human|agent|support/i.test(String(text));
      logChatTurn({ userId: userId || req.user?.id, mode: mode || 'customer', query: text, reply: replyText, escalated }).catch((e) => console.warn('[chatbotLog] async persist failed:', e.message));
    }
  } catch (e) {
    console.warn('[chatbotLog] persist skipped:', e.message);
  }
  res.json(result);
});
app.use(reviewRoutes); // extension d) product reviews: GET/POST /products/:id/reviews

// Neutral public feed: /api/auctions (Live+Scheduled, branch-scoped) — canonical; /api/auctions/live kept as compatibility alias
async function handlePublicAuctions(req, res) {
  try {
    const { branch_id, status } = req.query;
    const rows = await listAuctionsService({ branchId: branch_id, status });
    res.json(rows);
  } catch (e) { console.error('live feed error', e.message); res.json([]); }
}
app.get('/api/auctions', rateLimit({ name: 'auctions', windowMs: 60_000, max: 120 }), handlePublicAuctions);
app.get('/api/auctions/live', rateLimit({ name: 'auctions-live', windowMs: 60_000, max: 120 }), handlePublicAuctions);

// Sanitized database health for development diagnostics — pool counters, connection
// mode, and last success/failure timestamps only. No credentials, no hostnames,
// no DATABASE_URL. Admin-only in production.
if (process.env.NODE_ENV === 'production') {
  app.get('/api/health/database', requireAuth, requireRole(['admin']), (_req, res) => res.json(getPoolHealth()));
} else {
  app.get('/api/health/database', (_req, res) => res.json(getPoolHealth()));
}

app.use('/auth', authRoutes);
// Seller application feature removed from product scope (admin portal + landing).
// Public submission endpoint returns 410 Gone; admin review routes unmounted.
// Existing seller accounts, subscriptions, billing, and shops are unaffected.
app.use('/seller-applications', (req, res) => {
  res.status(410).json({ message: 'Seller application is no longer available.' });
});
app.use('/customer', requireAuth, requireRole('customer'), customerRoutes);
app.use('/shop-owner', requireAuth, requireRole('shop_owner'), shopOwnerRoutes);
app.use('/messages', messageRoutes);
app.use('/admin', requireAuth, requireRole(['admin']), adminRoutes);
// Admin Audit Logs viewer API removed from product scope.
// Backend audit logging (INSERT INTO audit_logs) remains for security/history.
app.use('/billing', billingRoutes);
// Backend plan catalog (same source used by billing checkout / admin list)
app.use('/subscription-plans', subscriptionPlansRoutes);
// Admin-only signed upload URL for product images (spec 1: Supabase Storage)
app.post('/admin/products/upload-url', requireAuth, requireRole(['admin']), async (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ message: 'filename required' });
  // Always respond — an uncaught async throw here sends no response and hangs the client (see shop-owner/upload-url).
  try {
    const data = await createUploadUrl(filename);
    res.json(data);
  } catch (e) {
    console.error('[admin/products/upload-url]', e.message);
    res.status(500).json({ message: 'Could not create upload URL (check storage bucket exists)' });
  }
});

// Guard against overlapping ticks: if a previous run is still holding DB
// connections when the next minute fires, skip instead of piling up and
// exhausting the pg pool (max 10, 5s connect timeout).
const onceAtATime = (name, fn) => {
  let running = false;
  return () => {
    if (running) {
      console.warn(`[cron] ${name} previous run still active; skipping this tick.`);
      return;
    }
    running = true;
    Promise.resolve()
      .then(fn)
      .catch((e) => console.error(`[cron] ${name} error:`, e?.message || e))
      .finally(() => { running = false; });
  };
};

// Spec 5.2: cron closes auctions every minute, creates orders pending
// H2 multi-instance: PostgreSQL advisory lock + atomic auction claim
// Staggered by seconds: all four jobs firing at second 0 bursts the pg pool
// (4 lock clients + per-item clients at once → 'timeout exceeded' → false
// fallback). Offsets keep the same every-minute cadence without the burst.
cron.schedule('10 * * * * *', onceAtATime('closeExpiredAuctions', () =>
  runExclusiveJob('auction_close', closeExpiredAuctions)
));
// Notify watchers when scheduled auctions go live (start_time reached)
cron.schedule('25 * * * * *', onceAtATime('startScheduledAuctions', () =>
  runExclusiveJob('auction_start', startScheduledAuctions)
));
// Problem 1: 7-day winner expiration / next-bidder (backend source of truth)
cron.schedule('40 * * * * *', onceAtATime('checkAndExpireWinners', () =>
  runExclusiveJob('winner_expire', checkAndExpireWinners)
));
// Problem 4A: payment reminders before the 7-day deadline (3d / 1d / 6h, once per stage)
cron.schedule('55 * * * * *', onceAtATime('sendPaymentReminders', () =>
  runExclusiveJob('payment_reminder', sendPaymentReminders)
));
// Billing subscription: mark pending as overdue after due_date + apply scheduled plan changes (daily 2am)
cron.schedule('0 2 * * *', () => {
  runExclusiveJob('billing_jobs', async () => {
    const { runBillingJobs } = await import('./services/billingExpiration.js');
    return runBillingJobs();
  }).catch(console.error);
});

// Prevent direct pg IPv6 ETIMEDOUT from crashing the process (pool emits unhandled)
pool.on('error', (err) => console.error('pg pool error', err.message));
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err?.stack || err?.message || err));
process.on('uncaughtException', (err) => console.error('uncaughtException', err?.stack || err?.message || err));

const port = process.env.PORT || 4000;
httpServer.listen(port, () => console.log(`ATANY API + Socket.io on :${port}`));
