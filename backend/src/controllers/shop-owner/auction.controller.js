import { pool } from '../../db/pool.js';
import { listAuctions as listAuctionsService } from '../../services/auctionService.js';
import { validateBidIncrement, DEFAULT_MIN_INCREMENT } from '../../services/bidLogic.js';

const VALID_CATEGORIES = ['Rings', 'Necklaces', 'Bracelets', 'Earrings', 'Pendants', 'Chains', 'Watches', 'Other'];

export const listAuctions = async (req, res) => {
  let shop = (await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
  if (!shop) {
    try {
      const { rows: u } = await pool.query('SELECT name,email FROM users WHERE id=$1', [req.user.id]);
      const name = u[0]?.name || u[0]?.email || 'My Shop';
      await pool.query('INSERT INTO shops (user_id, shop_name) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, name]);
      shop = (await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
    } catch {}
  }
  const rows = await listAuctionsService({ shopId: shop?.id });
  res.json(rows);
};

// Shop owner creates the item + auction together (no separate listing/approval step).
// Product is stored as 'approved' so it appears immediately on Live Auctions.
export const createAuction = async (req, res) => {
  const shop = (await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
  if (!shop) return res.status(404).json({ message: 'Shop not found' });

  const { name, category, karat, price, desc, description, image_url, start_price, startPrice, start_time, end_time, duration, minimum_bid_increment } = req.body;
  // Input validation
  if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ message: 'Item name is required' });
  if (name.length > 200) return res.status(400).json({ message: 'Item name must be at most 200 characters' });
  if (category && !VALID_CATEGORIES.includes(category)) return res.status(400).json({ message: `Category must be one of: ${VALID_CATEGORIES.join(', ')}` });
  if (desc && typeof desc === 'string' && desc.length > 2000) return res.status(400).json({ message: 'Description must be at most 2000 characters' });
  if (description && typeof description === 'string' && description.length > 2000) return res.status(400).json({ message: 'Description must be at most 2000 characters' });
  // One "Starting Price" drives both the product price and the auction opening bid.
  const startBid = Math.round(Number(start_price ?? startPrice ?? price));
  if (!startBid || startBid <= 0) return res.status(400).json({ message: 'Starting price required' });
  // Seller-defined minimum bid increment — independently validated server-side
  // (never trusted from frontend display). Missing → platform default (legacy).
  let minIncrement = DEFAULT_MIN_INCREMENT;
  if (minimum_bid_increment !== undefined && minimum_bid_increment !== null && minimum_bid_increment !== '') {
    const incCheck = validateBidIncrement(minimum_bid_increment);
    if (!incCheck.ok) return res.status(400).json({ message: incCheck.message, code: incCheck.code });
    minIncrement = incCheck.value;
  }

  // Derive schedule — mirror listing.controller: explicit start/end preferred, duration (hours) as fallback.
  const start = start_time ? new Date(start_time) : new Date();
  let end = end_time ? new Date(end_time) : null;
  if (!end && duration) end = new Date(start.getTime() + Number(duration) * 3600 * 1000);
  if (!end) end = new Date(start.getTime() + 7 * 86400000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return res.status(400).json({ message: 'Invalid start or end time' });
  if (end <= start) return res.status(400).json({ message: 'Auction end must be after start' });
  const status = start <= new Date() ? 'live' : 'scheduled';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // RETURNING * so the create response can include product display fields (name, image_url)
    // for immediate My Auctions refresh without a second round-trip guess.
    const { rows: prod } = await client.query(
      "INSERT INTO products (shop_id, name, category, karat_weight, price, stock, status, description, image_url) VALUES ($1,$2,$3,$4,$5,1,'approved',$6,$7) RETURNING *",
      [shop.id, name, category || 'Rings', karat || null, startBid, (desc ?? description) || null, image_url || null]
    );
    const { rows: auc } = await client.query(
      'INSERT INTO auctions (product_id, start_price, current_bid, status, start_time, end_time, minimum_bid_increment) VALUES ($1,$2,$2,$3,$4,$5,$6) RETURNING *',
      [prod[0].id, startBid, status, start, end, minIncrement]
    );
    await client.query('COMMIT');

    // Branch auction notification: notify customers whose preferred branch matches the shop's branch
    try {
      const shopRow = await pool.query('SELECT home_branch_id FROM shops WHERE id = $1', [shop.id]);
      const branchId = shopRow.rows[0]?.home_branch_id;
      if (branchId) {
        const branchRow = await pool.query('SELECT name FROM branches WHERE id = $1', [branchId]);
        const branchName = branchRow.rows[0]?.name || 'Branch';
        const notifMsg = `New Auction at ${branchName}\n\nA new ${name || 'jewelry'} auction has started.\nStarting price: ₱${startBid.toLocaleString()}.\n\nView Auction`;
        // Notify customers whose preferred branch matches.
        // Duplicate guard is keyed to this auction (auction_id + broadcast prefix) so
        // reprocessing the same auction never duplicates, while different auctions pass.
        // Message wording unchanged.
        const customers = await pool.query(
          'SELECT id FROM users WHERE preferred_branch_id = $1 AND role = $2',
          [branchId, 'customer']
        );
        for (const cust of customers.rows) {
          let dupB = [];
          try {
            const { rows } = await pool.query(
              `SELECT id FROM notifications WHERE user_id=$1 AND auction_id=$2 AND message LIKE $3 LIMIT 1`,
              [cust.id, auc[0].id, 'New Auction at%']
            );
            dupB = rows;
          } catch (gErr) {
            // notifications.auction_id column absent: fall back to legacy unguarded insert
            if (gErr.code !== '42703') throw gErr;
          }
          if (dupB.length) continue;
          try {
            await pool.query(
              'INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1, $2, $3, $4)',
              [cust.id, 'auction', notifMsg, auc[0].id]
            );
          } catch (insErr) {
            if (insErr.code !== '42703') throw insErr;
            await pool.query(
              'INSERT INTO notifications (user_id, type, message) VALUES ($1, $2, $3)',
              [cust.id, 'auction', notifMsg]
            );
          }
        }
        // Other-branch live auction notification: notify customers with different preferred branch (popup)
        if (status === 'live') {
          const otherNotifMsg = `New Live Auction at ${branchName}\n\nA new auction is now live at ${branchName}.\n${name || 'Jewelry'} — Starting price: ₱${startBid.toLocaleString()}\n\nView Auction`;
          const otherCustomers = await pool.query(
            'SELECT id FROM users WHERE preferred_branch_id IS NOT NULL AND preferred_branch_id != $1 AND role = $2',
            [branchId, 'customer']
          );
          for (const cust of otherCustomers.rows) {
            let dupOB = [];
            try {
              const { rows } = await pool.query(
                `SELECT id FROM notifications WHERE user_id=$1 AND auction_id=$2 AND message LIKE $3 LIMIT 1`,
                [cust.id, auc[0].id, 'New Live Auction at%']
              );
              dupOB = rows;
            } catch (gErr) {
              if (gErr.code !== '42703') throw gErr;
            }
            if (dupOB.length) continue;
            try {
              await pool.query(
                'INSERT INTO notifications (user_id, type, message, auction_id) VALUES ($1, $2, $3, $4)',
                [cust.id, 'auction', otherNotifMsg, auc[0].id]
              );
            } catch (insErr) {
              if (insErr.code !== '42703') throw insErr;
              await pool.query(
                'INSERT INTO notifications (user_id, type, message) VALUES ($1, $2, $3)',
                [cust.id, 'auction', otherNotifMsg]
              );
            }
          }
        }
      }
    } catch (notifErr) {
      console.warn('[branch notification] failed:', notifErr.message);
    }

    // Audit log
    try {
      await pool.query(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'auction_created', 'auction', auc[0].id, JSON.stringify({ name, start_price: startBid, status })]
      );
    } catch (logErr) {
      console.warn('[audit log] failed:', logErr.message);
    }

    // Include product display fields so the shop-owner UI can immediately show
// the new lot (name + stored image_url) after publish without hardcoding assets.
    const product = prod[0] || {};
    res.status(201).json({
      ...auc[0],
      productId: product.id,
      name: product.name,
      category: product.category,
      karat_weight: product.karat_weight,
      image_url: product.image_url || null,
      img: product.image_url || null,
      startPrice: auc[0].start_price,
      currentBid: auc[0].current_bid,
      startTime: auc[0].start_time,
      endTime: auc[0].end_time,
      minimum_bid_increment: Number(auc[0].minimum_bid_increment) || minIncrement,
      bids: 0,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[shop-owner/createAuction]', e.message);
    res.status(500).json({ message: 'Failed to create auction' });
  } finally {
    client.release();
  }
};

// Load an auction and confirm it belongs to the caller's shop and is still editable (scheduled + no bids).
async function loadOwnEditableAuction(req) {
  const shop = (await pool.query('SELECT id FROM shops WHERE user_id=$1', [req.user.id])).rows[0];
  if (!shop) return { error: { code: 404, message: 'Shop not found' } };
  const auction = (await pool.query('SELECT * FROM auctions WHERE id=$1', [req.params.id])).rows[0];
  if (!auction) return { error: { code: 404, message: 'Auction not found' } };
  const product = (await pool.query('SELECT shop_id FROM products WHERE id=$1', [auction.product_id])).rows[0];
  if (!product || product.shop_id !== shop.id) return { error: { code: 404, message: 'Auction not found' } };
  const bidCount = (await pool.query('SELECT COUNT(*)::int as cnt FROM bids WHERE auction_id=$1', [req.params.id])).rows[0]?.cnt || 0;
  if (auction.status !== 'scheduled' || bidCount > 0) {
    return { error: { code: 409, message: 'Only scheduled auctions with no bids can be changed' } };
  }
  return { auction };
}

// Edit own scheduled/no-bid auction — opening price and schedule only.
export const updateAuction = async (req, res) => {
  const { auction, error } = await loadOwnEditableAuction(req);
  if (error) return res.status(error.code).json({ message: error.message });

  const { start_price, startPrice, start_time, end_time, duration } = req.body;
  const price = start_price ?? startPrice;
  const start = start_time ? new Date(start_time) : new Date(auction.start_time);
  let end = end_time ? new Date(end_time) : (auction.end_time ? new Date(auction.end_time) : null);
  if (start_time && !end_time && duration) end = new Date(start.getTime() + Number(duration) * 3600 * 1000);
  if (end && start && end <= start) return res.status(400).json({ message: 'Auction end must be after start' });

  const fields = [];
  const params = [];
  let idx = 1;
  if (price != null && price !== '') {
    const p = Math.round(Number(price));
    fields.push(`start_price=$${idx++}`); params.push(p);
    fields.push(`current_bid=$${idx++}`); params.push(p);
  }
  if (start_time) { fields.push(`start_time=$${idx++}`); params.push(start); }
  if (end_time || (start_time && duration)) { fields.push(`end_time=$${idx++}`); params.push(end); }
  if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
  params.push(req.params.id);
  const { rows } = await pool.query(`UPDATE auctions SET ${fields.join(', ')} WHERE id=$${idx} RETURNING *`, params);
  // Audit log (best-effort — never blocks the response)
  try {
    if (rows[0]) {
      await pool.query(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'auction_updated', 'auction', rows[0].id, JSON.stringify({ start_price: rows[0].start_price })]
      );
    }
  } catch (logErr) {
    console.warn('[audit log] failed:', logErr.message);
  }
  res.json(rows[0]);
};

// Delete own scheduled/no-bid auction — removes only the auction record; the product remains.
export const deleteAuction = async (req, res) => {
  const { auction, error } = await loadOwnEditableAuction(req);
  if (error) return res.status(error.code).json({ message: error.message });

  try {
    await pool.query('DELETE FROM auctions WHERE id=$1', [req.params.id]);
    // Audit log (best-effort — never blocks the response)
    try {
      await pool.query(
        'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [req.user.id, 'auction_deleted', 'auction', req.params.id, JSON.stringify({ product_id: auction.product_id })]
      );
    } catch (logErr) {
      console.warn('[audit log] failed:', logErr.message);
    }
    res.status(204).end();
  } catch (e) {
    console.error('[shop-owner/deleteAuction]', e.message);
    res.status(500).json({ message: 'Failed to delete auction' });
  }
};
