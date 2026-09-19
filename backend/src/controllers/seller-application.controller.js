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
    const { rows: apps } = await pool.query('SELECT * FROM seller_applications WHERE applicant_id=$1 ORDER BY created_at DESC LIMIT 1', [req.user.id]);
    if (!apps[0]) return res.status(404).json({ message: 'No application found' });
    const a = apps[0];
    let branch = null;
    if (a.branch_id) {
      const { rows: branches } = await pool.query('SELECT * FROM branches WHERE id=$1', [a.branch_id]);
      branch = branches[0] || null;
    }
    res.json({ ...a, branch_name: branch?.name || null });
  } catch (e) {
    console.error('getMyApplication failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch application' });
  }
};

export const listApplications = async (req, res) => {
  try {
    const { status } = req.query;
    let whereClause = '';
    const params = [];
    if (status) {
      params.push(status);
      whereClause = `WHERE status = $1`;
    }
    const { rows: apps } = await pool.query(`SELECT * FROM seller_applications ${whereClause} ORDER BY created_at DESC`, params);
    if (!apps.length) return res.json([]);
    const applicantIds = [...new Set(apps.map(a => a.applicant_id).filter(Boolean))];
    const branchIds = [...new Set(apps.map(a => a.branch_id).filter(Boolean))];
    const reviewerIds = [...new Set(apps.map(a => a.reviewed_by).filter(Boolean))];
    let userMap = {};
    if (applicantIds.length || reviewerIds.length) {
      const allUserIds = [...new Set([...applicantIds, ...reviewerIds])];
      const { rows: users } = await pool.query(`SELECT id, name, email FROM users WHERE id IN (${allUserIds.map((_,i)=>`$${i+1}`).join(',')})`, allUserIds);
      userMap = Object.fromEntries(users.map(u => [u.id, u]));
    }
    let branchMap = {};
    if (branchIds.length) {
      const { rows: branches } = await pool.query(`SELECT * FROM branches WHERE id IN (${branchIds.map((_,i)=>`$${i+1}`).join(',')})`, branchIds);
      branchMap = Object.fromEntries(branches.map(b => [b.id, b]));
    }
    const rows = apps.map(a => ({
      ...a,
      applicant_name: userMap[a.applicant_id]?.name || null,
      applicant_email: userMap[a.applicant_id]?.email || null,
      branch_name: branchMap[a.branch_id]?.name || null,
      reviewer_name: userMap[a.reviewed_by]?.name || null,
    }));
    res.json(rows);
  } catch (e) {
    console.error('listApplications failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch applications' });
  }
};

export const getApplication = async (req, res) => {
  try {
    const { rows: apps } = await pool.query('SELECT * FROM seller_applications WHERE id=$1', [req.params.id]);
    if (!apps[0]) return res.status(404).json({ message: 'Application not found' });
    const a = apps[0];
    const { rows: users } = await pool.query(`SELECT id, name, email FROM users WHERE id IN ($1, $2)`, [a.applicant_id, a.reviewed_by].filter(Boolean));
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));
    let branch = null;
    if (a.branch_id) {
      const { rows: branches } = await pool.query('SELECT * FROM branches WHERE id=$1', [a.branch_id]);
      branch = branches[0] || null;
    }
    res.json({
      ...a,
      applicant_name: userMap[a.applicant_id]?.name || null,
      applicant_email: userMap[a.applicant_id]?.email || null,
      branch_name: branch?.name || null,
      reviewer_name: userMap[a.reviewed_by]?.name || null,
    });
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

    // Create initial seller subscription (pending) if none exists
    try {
      const { rows: existingBill } = await pool.query(
        `SELECT id FROM billing_records WHERE seller_id=$1 AND status IN ('pending','paid') ORDER BY created_at DESC LIMIT 1`,
        [app.applicant_id]
      );
      if (!existingBill.length) {
        const now = new Date();
        const next = new Date(now);
        next.setMonth(next.getMonth() + 1);
        const period = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + ' – ' + next.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const due = next.toISOString().split('T')[0];
        const startStr = now.toISOString().split('T')[0];
        const endStr = due;
        await pool.query(
          `INSERT INTO billing_records (seller_id, amount, billing_period, status, due_date, current_period_start, current_period_end) VALUES ($1,$2,$3,'pending',$4,$5,$6)`,
          [app.applicant_id, 1000, period, due, startStr, endStr]
        );
      }
    } catch {}

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
