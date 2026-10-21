// backend/src/services/auditLog.js
// Shared admin audit logging.
//
// ATANY keeps an append-only audit trail in public.audit_logs
// (admin id, action, entity type, entity id, details). Every admin
// action that changes platform state is recorded here — no passwords,
// tokens or other secrets are ever written.
import { pool } from '../db/pool.js';

/**
 * Write one audit entry. Auditing must NEVER break the action it describes,
 * so failures are swallowed (the admin action itself stays successful).
 */
export async function writeAuditLog({ adminId, action, entityType = 'user', entityId = null, details = {} }) {
  try {
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [adminId, action, entityType, entityId, JSON.stringify(details || {})]
    );
  } catch (_) {
    /* audit must never break the admin action */
  }
}

export default writeAuditLog;
