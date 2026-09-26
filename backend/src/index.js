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
import { pool } from './db/pool.js';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cron from 'node-cron';
import { closeExpiredAuctions } from './services/auctionCloser.js';
import { startScheduledAuctions } from './services/auctionStarter.js';
import { expireOverdueBillings } from './services/billingExpiration.js';
import { checkAndExpireWinners } from './services/winnerExpiration.js';
import { sendPaymentReminders } from './services/paymentReminder.js';
import { listAuctions as listAuctionsService } from './services/auctionService.js';
import { createUploadUrl } from './services/storageService.js';
import { chatbotReply } from './services/chatbotService.js';
import reviewRoutes from './routes/review.routes.js';
import sellerApplicationRoutes from './routes/seller-application.routes.js';
import adminSellerAppRoutes from './routes/admin-seller-applications.routes.js';
import messageRoutes from './routes/message.routes.js';
import adminAuditRoutes from './routes/admin-audit.routes.js';
import billingRoutes from './routes/billing.routes.js';
import webhookRoutes from './routes/webhook.routes.js';

const app = express();
const corsOrigin = (origin, callback) => {
  if (!origin || /^http:\/\/localhost:\d+$/.test(origin)) return callback(null, true);
  if (origin === process.env.FRONTEND_URL) return callback(null, true);
  callback(new Error('Not allowed by CORS'));
};
app.use(cors({ origin: corsOrigin, credentials: true }));
// Webhook must be mounted before global json to capture raw body for signature
app.use('/webhooks', webhookRoutes);
app.use(express.json());

// Inject io into req for controllers (bidLogic broadcast)
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: corsOrigin } });
app.use((req, _res, next) => { req.io = io; next(); });
io.on('connection', (socket) => {
  // Spec 1: live bidding updates — client subscribes via socketClient.js
  socket.on('join:auction', (auctionId) => socket.join(`auction:${auctionId}`));
  // Messaging: join user-specific room for real-time message delivery
  socket.on('join:user', (userId) => socket.join(`user:${userId}`));
});

// Public — branch locator read-only (spec 4.5) + chatbot (spec 4.8 Groq server-only)
app.get('/branches', async (_req, res) => {
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
app.post('/chat', async (req, res) => {
  const { query, message, history, mode } = req.body;
  const text = query || message;
  // mode: 'customer' or 'seller' — from frontend page context (Landing/Login/Signup/Customer vs Shop Owner)
  const result = await chatbotReply(text, { userId: req.user?.id, mode: mode || 'customer', history: history || [] });
  res.json(result);
});
app.use(reviewRoutes); // extension d) product reviews: GET/POST /products/:id/reviews

// Spec alias: /api/auctions/live should also work without /customer prefix (public live feed with branch filter)
app.get('/api/auctions/live', async (req, res) => {
  try {
    const { branch_id } = req.query;
    const rows = await listAuctionsService({ branchId: branch_id });
    res.json(rows);
  } catch (e) { console.error('live feed error', e.message); res.json([]); }
});

app.use('/auth', authRoutes);
app.use('/seller-applications', sellerApplicationRoutes);
app.use('/customer', requireAuth, requireRole('customer'), customerRoutes);
app.use('/shop-owner', requireAuth, requireRole('shop_owner'), shopOwnerRoutes);
app.use('/messages', messageRoutes);
app.use('/admin', requireAuth, requireRole(['admin']), adminRoutes);
app.use('/admin/seller-applications', requireAuth, requireRole(['admin']), adminSellerAppRoutes);
app.use('/admin/audit-logs', requireAuth, requireRole(['admin']), adminAuditRoutes);
app.use('/billing', billingRoutes);
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

// Spec 5.2: cron closes auctions every minute, creates orders pending
cron.schedule('* * * * *', () => closeExpiredAuctions().catch(console.error));
// Notify watchers when scheduled auctions go live (start_time reached)
cron.schedule('* * * * *', () => startScheduledAuctions().catch(console.error));
// Problem 1: 7-day winner expiration / next-bidder (backend source of truth)
cron.schedule('* * * * *', () => checkAndExpireWinners().catch(console.error));
// Problem 4A: payment reminders before the 7-day deadline (3d / 1d / 6h, once per stage)
cron.schedule('* * * * *', () => sendPaymentReminders().catch(console.error));
// Billing subscription: mark pending as overdue after due_date (daily 2am)
cron.schedule('0 2 * * *', () => expireOverdueBillings().catch(console.error));

// Prevent direct pg IPv6 ETIMEDOUT from crashing the process (pool emits unhandled)
pool.on('error', (err) => console.error('pg pool error', err.message));
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err?.stack || err?.message || err));
process.on('uncaughtException', (err) => console.error('uncaughtException', err?.stack || err?.message || err));

const port = process.env.PORT || 4000;
httpServer.listen(port, () => console.log(`ATANY API + Socket.io on :${port}`));
