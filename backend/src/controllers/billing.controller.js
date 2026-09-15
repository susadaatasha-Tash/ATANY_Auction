import { pool } from '../db/pool.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Seller views their own billing records
export const listMyBilling = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM billing_records WHERE seller_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error('listMyBilling failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch billing records' });
  }
};

// Admin views all billing records
export const listAllBilling = async (req, res) => {
  try {
    const { status, seller_id } = req.query;
    let where = [];
    let params = [];
    const allowedStatuses = ['pending', 'paid', 'overdue'];
    if (status) {
      if (!allowedStatuses.includes(status)) return res.status(400).json({ message: `Status must be one of: ${allowedStatuses.join(', ')}` });
      params.push(status); where.push(`br.status = $${params.length}`);
    }
    if (seller_id) {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(seller_id)) return res.status(400).json({ message: 'Invalid seller ID' });
      params.push(seller_id); where.push(`br.seller_id = $${params.length}`);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT br.*, u.name as seller_name, s.shop_name
       FROM billing_records br
       JOIN users u ON u.id = br.seller_id
       JOIN shops s ON s.user_id = br.seller_id
       ${whereClause}
       ORDER BY br.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error('listAllBilling failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch billing records' });
  }
};

// Admin creates a billing record for a seller
export const createBillingRecord = async (req, res) => {
  const { seller_id, amount, billing_period, due_date } = req.body;
  // Input validation
  if (!seller_id) return res.status(400).json({ message: 'seller_id is required' });
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(seller_id)) return res.status(400).json({ message: 'Invalid seller ID' });
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return res.status(400).json({ message: 'Valid amount is required' });
  if (!billing_period || typeof billing_period !== 'string' || !billing_period.trim()) return res.status(400).json({ message: 'billing_period is required' });
  if (billing_period.length > 50) return res.status(400).json({ message: 'billing_period must be at most 50 characters' });
  if (due_date && isNaN(Date.parse(due_date))) return res.status(400).json({ message: 'Invalid due_date format' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO billing_records (seller_id, amount, billing_period, due_date)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [seller_id, Number(amount), billing_period.trim(), due_date || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('createBillingRecord failed:', e.message);
    res.status(500).json({ message: 'Failed to create billing record' });
  }
};

// Admin marks a billing record as paid
export const markBillingPaid = async (req, res) => {
  const { payment_reference } = req.body;
  if (payment_reference && typeof payment_reference === 'string' && payment_reference.length > 100) return res.status(400).json({ message: 'payment_reference must be at most 100 characters' });
  try {
    const { rows } = await pool.query(
      `UPDATE billing_records SET status = 'paid', paid_at = now(), payment_reference = $1, updated_at = now()
       WHERE id = $2 RETURNING *`,
      [payment_reference || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Billing record not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('markBillingPaid failed:', e.message);
    res.status(500).json({ message: 'Failed to update billing record' });
  }
};
