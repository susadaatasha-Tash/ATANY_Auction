import { pool } from '../../db/pool.js';

// Helpers for Supabase REST fallback when direct pg IPv6 is unreachable (e.g. local network without IPv6)
async function fetchShopViaRest(userId) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const shopRes = await fetch(`${base}/rest/v1/shops?user_id=eq.${userId}&select=*`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const shops = await shopRes.json();
  const shop = shops[0] || null;
  if (!shop?.home_branch_id) return shop;
  const brRes = await fetch(`${base}/rest/v1/branches?id=eq.${shop.home_branch_id}&select=name,address`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const br = (await brRes.json())[0];
  return br ? { ...shop, branch_name: br.name, branch_address: br.address } : shop;
}

export const getShop = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, b.name AS branch_name, b.address AS branch_address
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
          `SELECT s.*, b.name AS branch_name FROM shops s LEFT JOIN branches b ON b.id=s.home_branch_id WHERE s.user_id=$1`, [req.user.id]);
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