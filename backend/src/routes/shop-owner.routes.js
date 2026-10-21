// backend/src/routes/shop-owner.routes.js
import { Router } from 'express';
import { listListings, createListing, resubmitListing, updateListing, getListingDetail, deleteListing } from '../controllers/shop-owner/listing.controller.js';
import { listAuctions, createAuction, updateAuction, deleteAuction } from '../controllers/shop-owner/auction.controller.js';
import { listSales, updateOrderStatus, getSalesSummary } from '../controllers/shop-owner/sales.controller.js';
import { getShop, updateShop, branchImageUploadUrl, updateBranchImage } from '../controllers/shop-owner/shop.controller.js';
import { listNotifications as listShopNotifications, markAllRead as markShopRead, markOneRead as markShopOneRead } from '../controllers/shop-owner/notification.controller.js';
import { listActivity } from '../controllers/shop-owner/activity.controller.js';
import { createUploadUrl } from '../services/storageService.js';
import {
  manageAuctions,
  getTopBidders,
  getAuctionResult,
  startAuction,
  extendAuction,
  pauseAuction,
  resumeAuction,
  endAuction,
  relistAuction,
} from '../controllers/shop-owner/auctionManage.controller.js';

const router = Router();
router.get('/auctions/manage', manageAuctions);
router.get('/auctions/top-bidders', getTopBidders);
router.get('/auctions/:id/result', getAuctionResult); // seller-owned auction result (winner, final bid, leaderboard)
router.post('/auctions/:id/start', startAuction);
router.post('/auctions/:id/extend', extendAuction);
router.post('/auctions/:id/pause', pauseAuction);
router.post('/auctions/:id/resume', resumeAuction);
router.post('/auctions/:id/end', endAuction);
router.post('/auctions/:id/relist', relistAuction);
router.get('/listings', listListings);
router.post('/listings', createListing); // products.status = pending (spec 4.3)
router.get('/listings/:id', getListingDetail); // seller-owned listing detail (modal)
router.put('/listings/:id', updateListing); // edit rejected -> pending (Edit & Resubmit with changes)
router.patch('/listings/:id/resubmit', resubmitListing); // rejected -> pending (legacy direct resubmit)
router.delete('/listings/:id', deleteListing); // delete own listing with restrictions
router.post('/upload-url', async (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ message: 'filename required' });
  // Must always respond: on Express 4 a thrown async error becomes an unhandledRejection and
  // NO response is sent, so the client hangs forever (modal stuck on "Saving…"). Catch and 500 so
  // the frontend's upload fallback can kick in (see CreateAuctionModal image try/catch).
  try {
    const data = await createUploadUrl(filename);
    res.json(data);
  } catch (e) {
    console.error('[shop-owner/upload-url]', e.message);
    res.status(500).json({ message: 'Could not create upload URL (check storage bucket exists)' });
  }
});
router.get('/auctions', listAuctions); // only own products' auctions
router.post('/auctions', createAuction); // create item + auction together (spec: shop owner runs auctions)
router.put('/auctions/:id', updateAuction); // edit own scheduled auction (no bids yet)
router.delete('/auctions/:id', deleteAuction); // cancel own scheduled auction (no bids yet)
router.get('/sales', listSales); // order table (Won Lots & Orders)
router.get('/sales/summary', getSalesSummary); // sales analytics (Sales & Payouts dashboard)
router.patch('/orders/:id/status', updateOrderStatus);
router.get('/shop', getShop);
router.put('/shop', updateShop);
router.post('/shop/branch-image/upload-url', branchImageUploadUrl);
router.put('/shop/branch-image', updateBranchImage);
router.get('/activity', listActivity); // own audit_logs only, newest first
router.get('/notifications', listShopNotifications);
router.put('/notifications/read', markShopRead);
router.put('/notifications/:id/read', markShopOneRead);
export default router;
