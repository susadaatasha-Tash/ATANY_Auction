// backend/src/routes/admin.routes.js
// Full CRUD — mounted as app.use('/admin', requireAuth, requireRole(['admin']), adminRoutes)
import { Router } from 'express';
import { crud as productCrud } from '../controllers/admin/product.controller.js';
import { crud as auctionCrud } from '../controllers/admin/auction.controller.js';
import { listUsers, createUser, updateUser, suspendUser } from '../controllers/admin/user.controller.js';
import { listTransactions, markPaid, updateOrderStatus } from '../controllers/admin/transaction.controller.js';
import { getAnalytics, exportCsv } from '../controllers/admin/analytics.controller.js';
import { listAlerts, updateAlert } from '../controllers/admin/security.controller.js';
import { listBranches, createBranch, updateBranch, deleteBranch } from '../controllers/admin/branch.controller.js';
import * as branchMonitor from '../controllers/admin/branchMonitor.controller.js';
import { listHistory, markAllRead, markOneRead, deleteNotification } from '../controllers/admin/notification.controller.js';

const router = Router();
// Products — approve/reject is part of update (status pending->approved/rejected, spec 4.3)
router.get('/products', productCrud.list); router.get('/products/:id', productCrud.get); router.post('/products', productCrud.create); router.post('/products/bulk', productCrud.bulk); router.put('/products/:id', productCrud.update); router.delete('/products/:id', productCrud.remove);
// Auctions — monitor-only (shop owners create/manage their own via /shop-owner/auctions)
router.get('/auctions', auctionCrud.list); router.get('/auctions/:id', auctionCrud.get);
// Users
router.get('/users', listUsers); router.post('/users', createUser); router.put('/users/:id', updateUser); router.patch('/users/:id/suspend', suspendUser);
// Transactions / Orders
router.get('/transactions', listTransactions); router.patch('/transactions/:id/pay', markPaid);
router.patch('/orders/:id/status', updateOrderStatus);
// Analytics — spec 4.7 real SQL aggregates + CSV export from same queries
router.get('/analytics', getAnalytics); router.get('/analytics/export', exportCsv);
// Security — spec 4.2 alerts
router.get('/security-alerts', listAlerts); router.patch('/security-alerts/:id', updateAlert);
// Branches — single source of truth spec 4.5
router.get('/branches', listBranches);
// Branch-centric monitoring (READ-ONLY): branch-scoped jewelry, auctions, monitor drawer.
// Registered BEFORE the /:id-style branch routes below is irrelevant (no such route), and all
// sit behind the existing app-level requireAuth + requireRole(['admin']).
router.get('/branches/monitor', branchMonitor.listBranchMonitorOverview);
router.get('/branches/:id/overview', branchMonitor.getBranchOverview);
router.get('/branches/:id/listings', branchMonitor.listBranchListings);
router.get('/branches/:id/auctions', branchMonitor.listBranchAuctions);
router.get('/branches/:id/auctions/:auctionId', branchMonitor.getBranchAuctionMonitor); router.post('/branches', createBranch); router.put('/branches/:id', updateBranch); router.delete('/branches/:id', deleteBranch);
// Notifications — automatic system-generated only (manual POST removed)
// Mutations are scoped to the authenticated admin's own rows (see controller).
router.get('/notifications/history', listHistory);
router.put('/notifications/read', markAllRead);
router.put('/notifications/:id/read', markOneRead);
router.delete('/notifications/:id', deleteNotification);
// Admin Chatbot Logs viewer API removed from product scope.
// Chatbot functionality itself (chatbotService + chatbotLogService persistence) remains.
export default router;
