// backend/src/routes/shop-owner.routes.js
import { Router } from 'express';
import { listListings, createListing, resubmitListing, updateListing } from '../controllers/shop-owner/listing.controller.js';
import { listAuctions, createAuction, updateAuction, deleteAuction } from '../controllers/shop-owner/auction.controller.js';
import { listSales, updateOrderStatus } from '../controllers/shop-owner/sales.controller.js';
import { getShop, updateShop, branchImageUploadUrl, updateBranchImage } from '../controllers/shop-owner/shop.controller.js';
import { listNotifications as listShopNotifications, markAllRead as markShopRead, markOneRead as markShopOneRead } from '../controllers/shop-owner/notification.controller.js';
import { listActivity } from '../controllers/shop-owner/activity.controller.js';
import { createUploadUrl } from '../services/storageService.js';

const router = Router();
router.get('/listings', listListings);
router.post('/listings', createListing); // products.status = pending (spec 4.3)
router.put('/listings/:id', updateListing); // edit rejected -> pending (Edit & Resubmit with changes)
router.patch('/listings/:id/resubmit', resubmitListing); // rejected -> pending (legacy direct resubmit)
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
router.get('/sales', listSales);
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
