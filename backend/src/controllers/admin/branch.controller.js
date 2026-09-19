// backend/src/controllers/admin/branch.controller.js
// Thin handlers — DB via pool. Public GET /branches (no auth) serves customer locator + shop pickers
import { pool } from '../../db/pool.js';

export const listBranches = async (_req, res) => res.json((await pool.query('SELECT * FROM branches ORDER BY name')).rows);
export const createBranch = async (req, res) => {
  const { name, address, lat, lng, hours, phone, status } = req.body;
  // Input validation
  if (!name || typeof name !== 'string' || !name.trim()) return res.status(400).json({ message: 'Branch name is required' });
  if (name.length > 200) return res.status(400).json({ message: 'Branch name must be at most 200 characters' });
  if (address && typeof address === 'string' && address.length > 500) return res.status(400).json({ message: 'Address must be at most 500 characters' });
  if (lat !== undefined && lat !== null && lat !== '' && (Number(lat) < -90 || Number(lat) > 90)) return res.status(400).json({ message: 'Latitude must be between -90 and 90' });
  if (lng !== undefined && lng !== null && lng !== '' && (Number(lng) < -180 || Number(lng) > 180)) return res.status(400).json({ message: 'Longitude must be between -180 and 180' });
  const allowedStatus = ['Open', 'Temporarily Closed'];
  const branchStatus = status || 'Open';
  if (!allowedStatus.includes(branchStatus)) return res.status(400).json({ message: `Status must be one of: ${allowedStatus.join(', ')}` });
  try {
    const { rows } = await pool.query('INSERT INTO branches (name, address, lat, lng, hours, phone, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [name.trim(), address || null, lat || null, lng || null, hours || null, phone || null, branchStatus]);
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('[admin/branches:create]', e.message);
    res.status(500).json({ message: 'Failed to create branch' });
  }
};
export const updateBranch = async (req, res) => {
  const { name, address, lat, lng, hours, phone, status } = req.body;
  // Input validation
  if (name !== undefined && (!name || typeof name !== 'string' || !name.trim())) return res.status(400).json({ message: 'Branch name cannot be empty' });
  if (name && name.length > 200) return res.status(400).json({ message: 'Branch name must be at most 200 characters' });
  if (address !== undefined && address && typeof address === 'string' && address.length > 500) return res.status(400).json({ message: 'Address must be at most 500 characters' });
  if (lat !== undefined && lat !== null && lat !== '' && (Number(lat) < -90 || Number(lat) > 90)) return res.status(400).json({ message: 'Latitude must be between -90 and 90' });
  if (lng !== undefined && lng !== null && lng !== '' && (Number(lng) < -180 || Number(lng) > 180)) return res.status(400).json({ message: 'Longitude must be between -180 and 180' });
  const allowedStatus = ['Open', 'Temporarily Closed'];
  if (status && !allowedStatus.includes(status)) return res.status(400).json({ message: `Status must be one of: ${allowedStatus.join(', ')}` });
  try {
    const { rows } = await pool.query('UPDATE branches SET name=$1, address=$2, lat=$3, lng=$4, hours=$5, phone=$6, status=$7 WHERE id=$8 RETURNING *', [name?.trim() || null, address || null, lat || null, lng || null, hours || null, phone || null, status || null, req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Branch not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[admin/branches:update]', e.message);
    res.status(500).json({ message: 'Failed to update branch' });
  }
};
export const deleteBranch = async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM branches WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Branch not found' });
    res.status(204).end();
  } catch (e) {
    console.error('[admin/branches:delete]', e.message);
    res.status(500).json({ message: 'Failed to delete branch' });
  }
};
