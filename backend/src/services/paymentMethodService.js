// backend/src/services/paymentMethodService.js
// Seller payment methods — PayMongo provider identifiers + display metadata ONLY.
// NEVER store PAN, CVC, or raw card data in ATANY.
//
// PayMongo reality check for this project:
// - Current integration uses hosted Checkout Sessions (cards never touch ATANY).
// - Reusable saved cards for off-session charging require PayMongo.js Elements
//   (client-side tokenization) + VITE_PAYMONGO_PUBLISHABLE_KEY, then attaching a
//   PayMongo payment_method id. Without Elements, full vaulting cannot be enabled
//   securely. These routes still manage any provider method ids the app can obtain.
import { pool } from '../db/pool.js';
import { writeAuditLog, notifyUserOnce } from './subscriptionService.js';

const SAFE_FIELDS = new Set([
  'id',
  'seller_id',
  'provider',
  'provider_payment_method_id',
  'type',
  'brand',
  'last4',
  'exp_month',
  'exp_year',
  'is_default',
  'created_at',
  'updated_at',
]);

/** Reject any payload that looks like raw card data. */
export function assertNoSensitiveCardFields(body = {}) {
  const banned = ['card_number', 'cardNumber', 'cvc', 'cvv', 'pan', 'number', 'security_code'];
  for (const key of banned) {
    if (body[key] != null && body[key] !== '') {
      const err = new Error('Raw card data is not accepted. Use PayMongo tokenization.');
      err.statusCode = 400;
      err.code = 'SENSITIVE_CARD_DATA_REJECTED';
      throw err;
    }
  }
}

export function sanitizeMethodRow(row) {
  if (!row) return null;
  const out = {};
  for (const key of SAFE_FIELDS) {
    if (key in row) out[key] = row[key];
  }
  out.is_default = !!row.is_default;
  return out;
}

export async function listPaymentMethodsForSeller(sellerId) {
  const { rows } = await pool.query(
    `SELECT * FROM seller_payment_methods
     WHERE seller_id = $1
     ORDER BY is_default DESC, created_at DESC`,
    [sellerId]
  );
  return rows.map(sanitizeMethodRow);
}

export async function getDefaultPaymentMethod(sellerId) {
  const { rows } = await pool.query(
    `SELECT * FROM seller_payment_methods WHERE seller_id = $1 AND is_default LIMIT 1`,
    [sellerId]
  );
  return sanitizeMethodRow(rows[0] || null);
}

/**
 * Attach a PayMongo payment method (provider id + safe metadata only).
 * Duplicate provider ids are rejected (unique index + pre-check).
 */
export async function attachPaymentMethod({
  sellerId,
  providerPaymentMethodId,
  type = 'card',
  brand = null,
  last4 = null,
  expMonth = null,
  expYear = null,
  makeDefault = false,
}) {
  const pmId = String(providerPaymentMethodId || '').trim();
  if (!pmId) {
    const err = new Error('provider_payment_method_id is required');
    err.statusCode = 400;
    err.code = 'INVALID_PAYMENT_METHOD';
    throw err;
  }
  if (pmId.length > 200) {
    const err = new Error('provider_payment_method_id is too long');
    err.statusCode = 400;
    err.code = 'INVALID_PAYMENT_METHOD';
    throw err;
  }

  const { rows: existingDup } = await pool.query(
    `SELECT * FROM seller_payment_methods WHERE seller_id = $1 AND provider_payment_method_id = $2`,
    [sellerId, pmId]
  );
  if (existingDup.length) {
    const err = new Error('This payment method is already saved.');
    err.statusCode = 409;
    err.code = 'DUPLICATE_PAYMENT_METHOD';
    throw err;
  }

  const { rows: existing } = await pool.query(
    `SELECT * FROM seller_payment_methods WHERE seller_id = $1`,
    [sellerId]
  );

  const shouldBeDefault = makeDefault === true || existing.length === 0;

  if (shouldBeDefault) {
    await pool.query(
      `UPDATE seller_payment_methods SET is_default = false, updated_at = now() WHERE seller_id = $1`,
      [sellerId]
    );
  }

  const { rows } = await pool.query(
    `INSERT INTO seller_payment_methods
       (seller_id, provider, provider_payment_method_id, type, brand, last4, exp_month, exp_year, is_default)
     VALUES ($1, 'paymongo', $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      sellerId,
      pmId,
      String(type || 'card').toLowerCase(),
      brand ? String(brand).toLowerCase().slice(0, 40) : null,
      last4 ? String(last4).replace(/\D/g, '').slice(-4) : null,
      expMonth != null && expMonth !== '' ? Number(expMonth) : null,
      expYear != null && expYear !== '' ? Number(expYear) : null,
      shouldBeDefault,
    ]
  );

  const method = sanitizeMethodRow(rows[0]);

  await writeAuditLog({
    userId: sellerId,
    action: 'payment_method_attached',
    entityType: 'seller_payment_method',
    entityId: method.id,
    details: {
      provider: 'paymongo',
      provider_payment_method_id: pmId,
      brand: method.brand,
      last4: method.last4,
      is_default: method.is_default,
    },
  });

  await notifyUserOnce({
    userId: sellerId,
    type: 'payout',
    message: method.is_default
      ? 'Your default payment method has been updated.'
      : 'A payment method has been saved to your billing profile.',
    withinHours: 24,
  });

  return method;
}

export async function setDefaultPaymentMethod({ sellerId, methodId }) {
  const { rows } = await pool.query(
    `SELECT * FROM seller_payment_methods WHERE id = $1 AND seller_id = $2`,
    [methodId, sellerId]
  );
  if (!rows.length) {
    const err = new Error('Payment method not found');
    err.statusCode = 404;
    err.code = 'PAYMENT_METHOD_NOT_FOUND';
    throw err;
  }

  await pool.query(
    `UPDATE seller_payment_methods SET is_default = false, updated_at = now() WHERE seller_id = $1`,
    [sellerId]
  );
  const { rows: updated } = await pool.query(
    `UPDATE seller_payment_methods SET is_default = true, updated_at = now()
     WHERE id = $1 AND seller_id = $2 RETURNING *`,
    [methodId, sellerId]
  );

  const method = sanitizeMethodRow(updated[0]);
  await writeAuditLog({
    userId: sellerId,
    action: 'payment_method_default_changed',
    entityType: 'seller_payment_method',
    entityId: method.id,
    details: { provider_payment_method_id: method.provider_payment_method_id },
  });
  await notifyUserOnce({
    userId: sellerId,
    type: 'payout',
    message: 'Your default payment method has been updated.',
    withinHours: 24,
  });
  return method;
}

export async function deletePaymentMethod({ sellerId, methodId }) {
  const { rows } = await pool.query(
    `SELECT * FROM seller_payment_methods WHERE id = $1 AND seller_id = $2`,
    [methodId, sellerId]
  );
  if (!rows.length) {
    const err = new Error('Payment method not found');
    err.statusCode = 404;
    err.code = 'PAYMENT_METHOD_NOT_FOUND';
    throw err;
  }
  const method = rows[0];
  await pool.query(`DELETE FROM seller_payment_methods WHERE id = $1`, [methodId]);

  // If deleted method was default, promote another
  if (method.is_default) {
    const { rows: remaining } = await pool.query(
      `SELECT id FROM seller_payment_methods WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [sellerId]
    );
    if (remaining[0]) {
      await pool.query(
        `UPDATE seller_payment_methods SET is_default = true, updated_at = now() WHERE id = $1`,
        [remaining[0].id]
      );
    }
  }

  await writeAuditLog({
    userId: sellerId,
    action: 'payment_method_removed',
    entityType: 'seller_payment_method',
    entityId: methodId,
    details: { provider_payment_method_id: method.provider_payment_method_id },
  });
  return { ok: true, id: methodId };
}
