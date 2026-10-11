import { pool } from '../../db/pool.js';
import { createBranchUploadUrl, deleteBranchImageByUrl } from '../../services/storageService.js';

// Helpers for Supabase REST fallback when direct pg IPv6 is unreachable (e.g. local network without IPv6)
// Bounded (10s): a stalled REST call must fail fast instead of parking the request.
async function fetchShopViaRest(userId) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const shopRes = await fetch(`${base}/rest/v1/shops?user_id=eq.${userId}&select=*`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
  const shops = await shopRes.json();
  const shop = shops[0] || null;
  if (!shop?.home_branch_id) return shop;
  const brRes = await fetch(`${base}/rest/v1/branches?id=eq.${shop.home_branch_id}&select=name,address,branch_image_url`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
  const br = (await brRes.json())[0];
  return br ? { ...shop, branch_name: br.name, branch_address: br.address, branch_image_url: br.branch_image_url || null } : shop;
}

export const getShop = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, b.name AS branch_name, b.address AS branch_address, b.branch_image_url AS branch_image_url
       FROM shops s LEFT JOIN branches b ON b.id = s.home_branch_id
       WHERE s.user_id=$1`, [req.user.id]);
    if (rows[0]) return res.json(rows[0]);
    // Empty from REST fallback (complex JOIN) — try dedicated REST helper
    return res.json(await fetchShopViaRest(req.user.id));
  } catch (e) {
    console.error('getShop pg failed, fallback REST', e.message);
    try { res.json(await fetchShopViaRest(req.user.id)); }
    catch (e2) { res.status(500).json({ message: 'Failed to load shop' }); }
  }
};
export const updateShop = async (req, res) => {
  const { shop_name, payout_method, home_branch_id } = req.body;
  // Build the SET clause with plain `col = $N` (no COALESCE) — pool.js's REST-fallback
  // translator matches `col = $N` literally and can't parse COALESCE(...)-wrapped
  // expressions, which silently dropped every field and broke saves in fallback mode.
  const fields = [];
  const params = [];
  let idx = 1;
  if (shop_name != null) { fields.push(`shop_name=$${idx++}`); params.push(shop_name); }
  if (payout_method != null) { fields.push(`payout_method=$${idx++}`); params.push(payout_method); }
  if (home_branch_id != null) { fields.push(`home_branch_id=$${idx++}`); params.push(home_branch_id || null); }
  if (!fields.length) return res.status(400).json({ message: 'No fields to update' });
  params.push(req.user.id);

  try {
    const { rows } = await pool.query(
      `UPDATE shops SET ${fields.join(', ')} WHERE user_id=$${idx} RETURNING *`, params);
    if (rows[0]) {
      // Try to enrich with branch name (may fail if complex JOIN returns empty)
      try {
        const { rows: joined } = await pool.query(
          `SELECT s.*, b.name AS branch_name, b.branch_image_url AS branch_image_url FROM shops s LEFT JOIN branches b ON b.id=s.home_branch_id WHERE s.user_id=$1`, [req.user.id]);
        if (joined[0]) return res.json(joined[0]);
      } catch (_) { /* ignore */ }
      return res.json(rows[0]);
    }
  } catch (e) {
    console.error('updateShop pg failed, fallback REST', e.message);
  }
  // Fallback to direct Supabase REST — now checks the response instead of assuming success.
  try {
    const base = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const patchBody = {};
    if (shop_name != null) patchBody.shop_name = shop_name;
    if (payout_method != null) patchBody.payout_method = payout_method;
    if (home_branch_id != null) patchBody.home_branch_id = home_branch_id || null;
    const patchRes = await fetch(`${base}/rest/v1/shops?user_id=eq.${req.user.id}`, {
      method: 'PATCH', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patchBody)
    });
    if (!patchRes.ok) {
      const errText = await patchRes.text().catch(() => '');
      throw new Error(`Supabase PATCH failed (${patchRes.status}): ${errText}`);
    }
    res.json(await fetchShopViaRest(req.user.id));
  } catch (e2) { res.status(500).json({ message: e2.message }); }
};

async function getOwnBranchId(userId) {
  const { rows } = await pool.query('SELECT home_branch_id FROM shops WHERE user_id=$1', [userId]);
  return rows[0]?.home_branch_id || null;
}

function isAllowedBranchImageUrl(imageUrl) {
  try {
    if (!imageUrl || typeof imageUrl !== 'string') return false;
    const u = new URL(imageUrl);
    if (u.protocol !== 'https:') return false;
    const base = new URL(process.env.SUPABASE_URL);
    // Must be a public URL from our own Supabase project's atany-products bucket
    if (u.host !== base.host) return false;
    return u.pathname.includes('/storage/v1/object/public/atany-products/branch-images/');
  } catch { return false; }
}

// POST /shop-owner/shop/branch-image/upload-url — signed URL for seller's OWN branch only
export const branchImageUploadUrl = async (req, res) => {
  const { filename } = req.body || {};
  if (!filename) return res.status(400).json({ message: 'filename required' });
  try {
    const branchId = await getOwnBranchId(req.user.id);
    if (!branchId) return res.status(400).json({ message: 'No assigned branch for this shop' });
    const data = await createBranchUploadUrl(filename);
    res.json({ ...data, branch_id: branchId });
  } catch (e) {
    console.error('[shop-owner/branch-image/upload-url]', e.message);
    const status = /JPG|PNG|WEBP|filename/i.test(e.message) ? 400 : 500;
    res.status(status).json({ message: status === 400 ? e.message : 'Could not create upload URL (check storage bucket exists)' });
  }
};

// PUT /shop-owner/shop/branch-image { imageUrl } — save to seller's OWN branch only
export const updateBranchImage = async (req, res) => {
  const { imageUrl, branch_id } = req.body || {};
  if (!imageUrl) return res.status(400).json({ message: 'imageUrl required' });
  if (!isAllowedBranchImageUrl(imageUrl)) {
    return res.status(400).json({ message: 'Please upload a JPG, PNG, or WEBP image under 5 MB.' });
  }
  try {
    // Ownership derived from authenticated user — never trust frontend branch_id/shopId
    const ownBranchId = await getOwnBranchId(req.user.id);
    if (!ownBranchId) return res.status(400).json({ message: 'No assigned branch for this shop' });
    if (branch_id && branch_id !== ownBranchId) {
      return res.status(403).json({ message: 'You can only update your assigned branch' });
    }
    // Fetch current image so we can clean up the old file only after the new save succeeds
    let oldUrl = null;
    try {
      const { rows: cur } = await pool.query('SELECT branch_image_url FROM branches WHERE id=$1', [ownBranchId]);
      oldUrl = cur[0]?.branch_image_url || null;
    } catch (_) { /* ignore */ }
    const { rows } = await pool.query(
      'UPDATE branches SET branch_image_url=$1 WHERE id=$2 RETURNING id, name, branch_image_url',
      [imageUrl, ownBranchId]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Branch not found' });
    // Best-effort cleanup of replaced file (never blocks success)
    if (oldUrl && oldUrl !== imageUrl) {
      deleteBranchImageByUrl(oldUrl).catch((e) => console.warn('[branch-image cleanup]', e.message));
    }
    // Return refreshed shop (same shape as getShop)
    try {
      const { rows: joined } = await pool.query(
        `SELECT s.*, b.name AS branch_name, b.address AS branch_address, b.branch_image_url AS branch_image_url FROM shops s LEFT JOIN branches b ON b.id=s.home_branch_id WHERE s.user_id=$1`, [req.user.id]);
      if (joined[0]) return res.json({ ...joined[0], branch: rows[0] });
    } catch (_) { /* ignore */ }
    res.json({ branch: rows[0] });
  } catch (e) {
    console.error('[shop-owner/branch-image]', e.message);
    res.status(500).json({ message: 'Failed to save branch image' });
  }
};