// backend/src/routes/customer.routes.js
// Role-isolated — only handlers from controllers/customer/*
// Mounted as app.use('/customer', requireAuth, requireRole('customer'), customerRoutes)
import { Router } from 'express';
import { listAuctions, listLiveAuctions, getAuction } from '../controllers/customer/auction.controller.js';
import { placeBidController, listBids } from '../controllers/customer/bid.controller.js';
import { getWatchlist, addToWatchlist, removeFromWatchlist } from '../controllers/customer/watchlist.controller.js';
import { getFavorites, addToFavorites, removeFromFavorites } from '../controllers/customer/favorites.controller.js';
import { getReminders, addReminder, removeReminder } from '../controllers/customer/reminder.controller.js';
import { getOrders, payOrder } from '../controllers/customer/order.controller.js';
import { getOrderDetails, createCheckout } from '../controllers/customer/payment.controller.js';
import { getAccount, updateAccount, getPreferredBranch, setPreferredBranch } from '../controllers/customer/account.controller.js';
import { submitSupportRequest } from '../controllers/customer/support.controller.js';
import { listNotifications, markAllRead, markOneRead, deleteNotification } from '../controllers/customer/notification.controller.js';

const router = Router();
router.get('/auctions', listAuctions);
router.get('/auctions/live', listLiveAuctions); // spec: GET /api/auctions/live?branch_id=X
router.get('/auctions/:id', getAuction);
router.get('/bids', listBids);
router.post('/bids', placeBidController); // -> services/bidLogic.js SERIALIZABLE TX
router.get('/watchlist', getWatchlist);
router.post('/watchlist', addToWatchlist);
router.delete('/watchlist/:id', removeFromWatchlist);
router.get('/favorites', getFavorites);
router.post('/favorites', addToFavorites);
router.delete('/favorites/:id', removeFromFavorites);
router.get('/reminders', getReminders);
router.post('/reminders', addReminder);
router.delete('/reminders/:id', removeReminder);
router.get('/orders', getOrders);
router.get('/orders/:id', getOrderDetails);
router.post('/orders/:id/payment', createCheckout);
router.post('/orders/:id/pay', payOrder); // legacy: Pay at Branch Counter fallback
router.get('/account', getAccount);
router.put('/account', updateAccount);
router.post('/support', submitSupportRequest); // authenticated customer support request
router.get('/preferred-branch', getPreferredBranch);
router.put('/preferred-branch', setPreferredBranch);
router.get('/notifications', listNotifications);
router.put('/notifications/read', markAllRead);
router.put('/notifications/:id/read', markOneRead);
router.delete('/notifications/:id', deleteNotification);
export default router;
