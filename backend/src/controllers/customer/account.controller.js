import { pool } from '../../db/pool.js';

export const getAccount = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at, u.preferred_branch_id,
       b.name as preferred_branch_name
       FROM users u
       LEFT JOIN branches b ON b.id = u.preferred_branch_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error('getAccount failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch account' });
  }
};

export const updateAccount = async (req, res) => {
  const { name, home_branch_id } = req.body;
  try {
    if (name) await pool.query('UPDATE users SET name=$1 WHERE id=$2', [name, req.user.id]);
    if (home_branch_id) await pool.query('UPDATE shops SET home_branch_id=$1 WHERE user_id=$2', [home_branch_id, req.user.id]);
    res.json({ message: 'Updated' });
  } catch (e) {
    console.error('updateAccount failed:', e.message);
    res.status(500).json({ message: 'Failed to update account' });
  }
};

export const getPreferredBranch = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.preferred_branch_id, b.name as branch_name, b.address as branch_address
       FROM users u
       LEFT JOIN branches b ON b.id = u.preferred_branch_id
       WHERE u.id = $1`,
      [req.user.id]
    );
    res.json(rows[0] || { preferred_branch_id: null });
  } catch (e) {
    console.error('getPreferredBranch failed:', e.message);
    res.status(500).json({ message: 'Failed to fetch preferred branch' });
  }
};

export const setPreferredBranch = async (req, res) => {
  const { branch_id } = req.body;
  if (!branch_id) return res.status(400).json({ message: 'branch_id required' });
  try {
    // Verify branch exists
    const branch = await pool.query('SELECT id, name FROM branches WHERE id = $1', [branch_id]);
    if (!branch.rows[0]) return res.status(404).json({ message: 'Branch not found' });

    await pool.query('UPDATE users SET preferred_branch_id = $1 WHERE id = $2', [branch_id, req.user.id]);
    res.json({ preferred_branch_id: branch_id, branch_name: branch.rows[0].name });
  } catch (e) {
    console.error('setPreferredBranch failed:', e.message);
    res.status(500).json({ message: 'Failed to set preferred branch' });
  }
};
