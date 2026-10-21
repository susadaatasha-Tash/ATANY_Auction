import { pool } from '../../db/pool.js';
import { listAuctions as listAuctionsService, effectiveStatus } from '../../services/auctionService.js';
import { getWatcherCount } from '../../services/auctionPresence.js';
// Admin is monitor-only for auctions — shop owners create/manage their own (see shop-owner/auction.controller.js).
// This controller intentionally exposes read-only listing; create/update/delete were removed.
export const crud = {
  list: async (req, res) => {
    const { status, branch_id } = req.query;
    const listStatus = status || 'all';
    res.json(await listAuctionsService({ status: listStatus, branchId: branch_id }));
  },
  get: async (req, res) => {
    try {
      const { id } = req.params;
      const { rows: auctions } = await pool.query('SELECT * FROM auctions WHERE id=$1', [id]);
      if (!auctions.length) return res.status(404).json({ message: 'Auction not found' });
      const auction = auctions[0];

      const { rows: products } = await pool.query('SELECT * FROM products WHERE id=$1', [auction.product_id]);
      const product = products[0] || {};

      const { rows: shops } = product.shop_id
        ? await pool.query('SELECT * FROM shops WHERE id=$1', [product.shop_id])
        : { rows: [] };
      const shop = shops[0] || {};

      const { rows: branches } = shop.home_branch_id
        ? await pool.query('SELECT * FROM branches WHERE id=$1', [shop.home_branch_id])
        : { rows: [] };
      const branch = branches[0] || {};

      const { rows: userRows } = shop.user_id
        ? await pool.query('SELECT id, name, email FROM users WHERE id=$1', [shop.user_id])
        : { rows: [] };
      const seller = userRows[0] || {};

      const { rows: bidRows } = await pool.query('SELECT * FROM bids WHERE auction_id=$1 ORDER BY amount DESC', [id]);
      const bidderIds = [...new Set(bidRows.map(b => b.user_id).filter(Boolean))];
      let bidderMap = {};
      if (bidderIds.length) {
        const { rows: bidders } = await pool.query(`SELECT id, name FROM users WHERE id IN (${bidderIds.map((_,i)=>`$${i+1}`).join(',')})`, bidderIds);
        bidderMap = Object.fromEntries(bidders.map(u => [u.id, u.name]));
      }
      const bids = bidRows.map(b => ({ ...b, bidder_name: bidderMap[b.user_id] || null }));
      const uniqueBidders = new Set(bids.map(b => b.user_id)).size;

      const { rows: orders } = await pool.query('SELECT * FROM orders WHERE auction_id=$1', [id]);
      const order = orders[0] || null;
      let orderInfo = null;
      if (order) {
        const { rows: buyerRows } = order.buyer_id
          ? await pool.query('SELECT id, name, email FROM users WHERE id=$1', [order.buyer_id])
          : { rows: [] };
        orderInfo = {
          id: order.id,
          transaction_code: order.transaction_code,
          amount: order.amount,
          status: order.status,
          payment_method: order.payment_method,
          created_at: order.created_at,
          buyer: buyerRows[0] || null,
        };
      }

      const now = new Date();
      const computedStatus = effectiveStatus(auction.start_time, auction.end_time, auction.status);

      res.json({
        id: auction.id,
        auction_code: auction.auction_code,
        start_price: auction.start_price,
        current_bid: auction.current_bid,
        minimum_bid_increment: auction.minimum_bid_increment,
        status: computedStatus,
        start_time: auction.start_time,
        end_time: auction.end_time,
        paused_at: auction.paused_at,
        endsInSec: Math.max(0, Math.floor((new Date(auction.end_time) - now) / 1000)),
        product: {
          id: product.id,
          name: product.name,
          category: product.category,
          karat_weight: product.karat_weight,
          description: product.description,
          image_url: product.image_url,
          price: product.price,
        },
        shop: {
          id: shop.id,
          name: shop.shop_name,
          owner_name: seller.name,
          owner_email: seller.email,
        },
        branch: {
          id: branch.id,
          name: branch.name,
          address: branch.address,
        },
        bids: bids.map((b, i) => ({
          rank: i + 1,
          amount: b.amount,
          bidder_name: b.bidder_name || 'Anonymous',
          created_at: b.created_at,
        })),
        total_bids: bids.length,
        participants: uniqueBidders,
        // Live viewer presence — unique authenticated CUSTOMERS viewing now.
        watchers: getWatcherCount(id),
        // The current leader (highest eligible bid). Only an ended auction has
        // a winner; for a live auction this is the leader, never "the winner".
        leader: bids.length ? { name: bids[0].bidder_name || 'Anonymous', amount: bids[0].amount } : null,
        order: orderInfo,
      });
    } catch (e) {
      console.error('[admin/auctions:get]', e.message);
      res.status(500).json({ message: 'Failed to load auction' });
    }
  },
};
