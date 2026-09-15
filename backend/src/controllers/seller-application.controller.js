import { pool } from '../db/pool.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const createApplication = async (req, res) => {
  const { shop_name, contact_number, email, shop_address, branch_id, business_description, application_reason } = req.body;
  // Input validation
  if (!shop_name || typeof shop_name !== 'string' || !shop_name.trim()) return res.status(400).json({ message: 'Shop name is required' });
  if (shop_name.length > 200) return res.status(400).json({ message: 'Shop name must be at most 200 characters' });
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ message: 'Valid email is required' });
  if (contact_number && typeof contact_number === 'string' && contact_number.length > 20) return res.status(400).json({ message: 'Contact number must be at most 20 characters' });
  if (shop_address && typeof shop_address === 'string' && shop_address.length > 500) return res.status(400).json({ message: 'Shop address must be at most 500 characters' });
  if (branch_id) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(branch_id)) return res.status(400).json({ message: 'Invalid branch ID' });
  }
  if (business_description && typeof business_description === 'string' && business_description.length > 1000) return res.status(400).json({ message: 'Business description must be at most 1000 characters' });
  if (application_reason && typeof application_reason === 'string' && application_reason.length > 1000) return res.status(400).json({ message: 'Application reason must be at most 1000 characters' });
  try {
    // Check if user already has a pending or approved application
    const existing = await pool.query(
      'SELECT id, status FROM seller_applications WHERE applicant_id = $1 AND status IN ($2, $3)',
      [req.user.id, 'pending', 'approved']
    );
    if (existing.rows[0]) {
      return res.status(400).json({ message: `You already have a ${existing.rows[0].status} application` });
    }
    const { rows } = await pool.query(
      `INSERT INTO seller_applications (applicant_id, shop_name, contact_number, email, shop_address, branch_id, business_description, application_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.id, shop_name.trim(), contact_number || null, email, shop_address || null, branch_id || null, business_description || null, application_reason || null]
    );
    // Log audit
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'seller_application_submitted', 'seller_application', rows[0].id, JSON.stringify({ shop_name: shop_name.trim() })]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('createApplication failed:', e.message);
    res.status(500).json({ message: 'Failed to submit application' });
  }
};

export const getMyApplication = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sa.*, b.name as branch_name
       FROM seller_applications sa
       LEFT JOIN branches b ON b.id = sa.branch_id
       WHERE sa.applicant_id = $1
       ORDER BY sa.created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'No application found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('getMyApplication failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch application' });
  }
};

export const listApplications = async (req, res) => {
  try {
    const { status } = req.query;
    let query = `SELECT sa.*, u.name as applicant_name, u.email as applicant_email, b.name as branch_name,
      reviewer.name as reviewer_name
      FROM seller_applications sa
      JOIN users u ON u.id = sa.applicant_id
      LEFT JOIN branches b ON b.id = sa.branch_id
      LEFT JOIN users reviewer ON reviewer.id = sa.reviewed_by`;
    const params = [];
    if (status) {
      params.push(status);
      query += ` WHERE sa.status = $${params.length}`;
    }
    query += ' ORDER BY sa.created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    console.error('listApplications failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch applications' });
  }
};

export const getApplication = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sa.*, u.name as applicant_name, u.email as applicant_email, b.name as branch_name,
       reviewer.name as reviewer_name
       FROM seller_applications sa
       JOIN users u ON u.id = sa.applicant_id
       LEFT JOIN branches b ON b.id = sa.branch_id
       LEFT JOIN users reviewer ON reviewer.id = sa.reviewed_by
       WHERE sa.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Application not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('getApplication failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch application' });
  }
};

export const approveApplication = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE seller_applications SET status = 'approved', reviewed_by = $1, reviewed_at = now(), updated_at = now()
       WHERE id = $2 AND status = 'pending' RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Pending application not found' });

    const app = rows[0];

    // Create shop for the approved seller
    const existingShop = await pool.query('SELECT id FROM shops WHERE user_id = $1', [app.applicant_id]);
    if (!existingShop.rows[0]) {
      await pool.query(
        'INSERT INTO shops (user_id, shop_name, home_branch_id) VALUES ($1, $2, $3)',
        [app.applicant_id, app.shop_name, app.branch_id]
      );
    } else {
      await pool.query(
        'UPDATE shops SET shop_name = $1, home_branch_id = COALESCE($2, home_branch_id) WHERE user_id = $3',
        [app.shop_name, app.branch_id, app.applicant_id]
      );
    }

    // Update user role to shop_owner
    await pool.query('UPDATE users SET role = $1 WHERE id = $2 AND role = $3', ['shop_owner', app.applicant_id, 'customer']);

    // Create notification for applicant
    await pool.query(
      `INSERT INTO notifications (user_id, type, message) VALUES ($1, $2, $3)`,
      [app.applicant_id, 'seller_application', 'Your JewelryHub seller application has been approved! You can now access the Seller Dashboard.']
    );

    // Log audit
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'seller_application_approved', 'seller_application', app.id, JSON.stringify({ applicant_id: app.applicant_id, shop_name: app.shop_name })]
    );

    res.json(rows[0]);
  } catch (e) {
    console.error('approveApplication failed:', e.message);
    res.status(500).json({ message: 'Failed to approve application' });
  }
};

export const rejectApplication = async (req, res) => {
  const { rejection_reason } = req.body;
  if (!rejection_reason || typeof rejection_reason !== 'string' || !rejection_reason.trim()) return res.status(400).json({ message: 'Rejection reason is required' });
  if (rejection_reason.length > 1000) return res.status(400).json({ message: 'Rejection reason must be at most 1000 characters' });
  try {
    const { rows } = await pool.query(
      `UPDATE seller_applications SET status = 'rejected', rejection_reason = $1, reviewed_by = $2, reviewed_at = now(), updated_at = now()
       WHERE id = $3 AND status = 'pending' RETURNING *`,
      [rejection_reason.trim(), req.user.id, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Pending application not found' });

    const app = rows[0];

    // Create notification for applicant
    await pool.query(
      `INSERT INTO notifications (user_id, type, message) VALUES ($1, $2, $3)`,
      [app.applicant_id, 'seller_application', `Your seller application was rejected. Reason: ${rejection_reason.trim()}`]
    );

    // Log audit
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, 'seller_application_rejected', 'seller_application', app.id, JSON.stringify({ applicant_id: app.applicant_id, reason: rejection_reason.trim() })]
    );

    res.json(rows[0]);
  } catch (e) {
    console.error('rejectApplication failed:', e.message);
    res.status(500).json({ message: 'Failed to reject application' });
  }
};
