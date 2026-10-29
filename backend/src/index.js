// backend/src/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import customerRoutes from './routes/customer.routes.js';
import shopOwnerRoutes from './routes/shop-owner.routes.js';
import adminRoutes from './routes/admin.routes.js';
import { requireAuth } from './middleware/requireAuth.js';
import { optionalAuth } from './middleware/optionalAuth.js';
import { requireRole } from './middleware/requireRole.js';
import { requireActiveAccount, isSuspendedStatus } from './middleware/requireActiveAccount.js';
import { pool, getPoolHealth } from './db/pool.js';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { joinWatcher, leaveWatcher, removeSocket, isValidAuctionId, onPresenceChange } from './services/auctionPresence.js';
import cron from 'node-cron';
import { createSocketAuth } from './services/socketAuth.js';
import { closeExpiredAuctions } from './services/auctionCloser.js';
import { startScheduledAuctions } from './services/auctionStarter.js';
import { checkAndExpireWinners } from './services/winnerExpiration.js';
import { sendPaymentReminders } from './services/paymentReminder.js';
import { listAuctions as listAuctionsService } from './services/auctionService.js';
import { createUploadUrl } from './services/storageService.js';
import { chatbotReply } from './services/chatbotService.js';
import { getPublicBranches, getPublicStats, postPublicContact } from './controllers/public.controller.js';
import { createPublicContactUpload } from './controllers/contactUpload.controller.js';
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
  socket.on('leave:auction', (auctionId) => {
    if (auctionId) {
      socket.leave(`auction:${auctionId}`);
      try { leaveWatcher({ auctionId, socketId: socket.id }); } catch {}
    }
  });
  // Active-viewer presence: authenticated CUSTOMERS ONLY (sellers/admins keep
  // room updates but never count) and ACTIVE accounts only. Unique users;
  // multi-tab safe; disconnect and auction-end clean up. Emits
  // auction:watchers { auctionId, watcherCount }.
  // Active-viewer presence eligibility: role === 'customer' AND status === 'active'.
  // The status is read from the AUTHORITATIVE users row (never from the client),
  // so a suspended customer cannot re-register as a watcher even by holding an
  // open socket and re-emitting this event after reconnect.
  socket.on('auction:watch', async (payload) => {
    try {
      const auctionId = typeof payload === 'string' ? payload : payload?.auctionId;
      if (!isValidAuctionId(auctionId)) return;
      if (socket.data?.role !== 'customer' || !socket.data?.statusChecked) {
        try {
          const { rows } = await pool.query('SELECT role, status FROM users WHERE id=$1', [socket.data.userId]);
          socket.data.role = rows[0]?.role || null;
          socket.data.status = rows[0]?.status || null;
          socket.data.statusChecked = true;
        } catch {
          return;
        }
      }
      if (socket.data.role !== 'customer') return;
      if (isSuspendedStatus(socket.data.status)) return;
      socket.join(`auction:${auctionId}`);
      joinWatcher({ auctionId, userId: socket.data.userId, socketId: socket.id });
    } catch {}
  });
  socket.on('auction:unwatch', (payload) => {
    try {
      const auctionId = typeof payload === 'string' ? payload : payload?.auctionId;
      if (auctionId) leaveWatcher({ auctionId, socketId: socket.id });
    } catch {}
  });
  socket.on('disconnect', () => {
    try { removeSocket(socket.id); } catch {}
  });
  // Deprecated client event — identity room already joined by socketAuth middleware.
  socket.on('join:user', () => {
    /* no-op: authenticated user room is automatic */
  });
});

// Presence fan-out: every join/leave/disconnect/end broadcasts the fresh
// unique count to that auction's room (sellers + watching customers).
onPresenceChange((auctionId, watcherCount) => {
  try { io.to(`auction:${auctionId}`).emit('auction:watchers', { auctionId, watcherCount }); } catch {}
});

// Public — branch locator read-only (spec 4.5) + chatbot (spec 4.8 Groq server-only)
// Serves ONLY the published branch fields from the same `branches` table the
// Admin portal manages, so the landing page, /branches, Customer pickup and the
// chatbot can never drift apart. No admin/employee/revenue columns exist here.
app.get('/branches', rateLimit({ name: 'branches', windowMs: 60_000, max: 60 }), getPublicBranches);

// ── Public landing-page reads (no auth, aggregate/public data only) ──
app.get('/api/public/stats', rateLimit({ name: 'public-stats', windowMs: 60_000, max: 60 }), getPublicStats);
app.post('/api/public/contact', rateLimit({ name: 'public-contact', windowMs: 600_000, max: 5 }), postPublicContact);
// Optional image attachment for the public form. Bytes go straight to Supabase
// Storage via the returned signed URL — they never traverse this server.
app.post('/api/public/contact/attachment', rateLimit({ name: 'public-contact-upload', windowMs: 600_000, max: 10 }), createPublicContactUpload);
app.post('/chat', rateLimit({ name: 'chat', windowMs: 60_000, max: 20 }), optionalAuth, async (req, res) => {
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
      // Attribution uses the VERIFIED session identity only. The route is public,
      // so a client-declared userId is never trusted on its own; guests log NULL.
      const verifiedUserId = req.user?.id || null;
      logChatTurn({ userId: verifiedUserId, mode: mode || 'customer', query: text, reply: replyText, escalated }).catch((e) => console.warn('[chatbotLog] async persist failed:', e.message));
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
// requireActiveAccount: a valid token is not enough — a SUSPENDED customer is
// rejected with 403 ACCOUNT_SUSPENDED on every protected customer endpoint.
// NOTE: requireActiveAccount is a FACTORY (it takes options) and MUST be invoked.
// Mounting the bare reference silently returns a middleware that is never called,
// which hangs every /customer request instead of gating it.
app.use('/customer', requireAuth, requireRole('customer'), requireActiveAccount(), customerRoutes);
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

// ── Outgoing email configuration check ───────────────────────────────────
// Fails loudly (server-side only) when the selected provider is not usable, so a
// missing App Password is obvious at boot instead of silently dropping enquiries.
// Only variable NAMES are ever reported — never values, never the App Password.
(async () => {
  try {
    const { describeConfig, verifySmtp } = await import('./services/emailTransport.js');
    const cfg = describeConfig();
    if (cfg.provider === 'gmail') {
      if (!cfg.configured) {
        console.error(
          `[email] Gmail SMTP selected (EMAIL_PROVIDER=gmail) but not configured. ` +
          `Missing: ${cfg.missing.join(', ')}. Contact/support requests will still be saved, ` +
          `but no notification email will be sent until these are set.`
        );
        return;
      }
      console.log(`[email] provider=gmail host=${cfg.host} port=${cfg.port} from=${cfg.from}`);
      // Verification is a live credential check — dev only, never in production.
      if (process.env.NODE_ENV !== 'production' && process.env.EMAIL_VERIFY_ON_BOOT !== 'false') {
        await verifySmtp();
      }
    } else {
      console.log(`[email] provider=${cfg.provider}${cfg.configured ? '' : ' (not configured)'}`);
    }
  } catch (e) {
    console.error('[email] transport configuration check failed:', e?.message || e);
  }
})();
