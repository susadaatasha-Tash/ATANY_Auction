// backend/src/middleware/validate.js
// Lightweight input validation — no external dependencies.
// Returns an array of error strings. Empty array = valid.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function required(val, label) {
  if (val === undefined || val === null || val === '') return `${label} is required`;
  return null;
}

export function isUuid(val, label) {
  if (val && !UUID_RE.test(val)) return `${label} must be a valid UUID`;
  return null;
}

export function isEmail(val, label) {
  if (val && !EMAIL_RE.test(val)) return `${label} must be a valid email`;
  return null;
}

export function isNumber(val, label) {
  if (val !== undefined && val !== null && val !== '' && Number(val) !== Number(val)) return `${label} must be a number`;
  return null;
}

export function maxLength(val, max, label) {
  if (val && typeof val === 'string' && val.length > max) return `${label} must be at most ${max} characters`;
  return null;
}

export function minLength(val, min, label) {
  if (val && typeof val === 'string' && val.length < min) return `${label} must be at least ${min} characters`;
  return null;
}

export function oneOf(val, allowed, label) {
  if (val && !allowed.includes(val)) return `${label} must be one of: ${allowed.join(', ')}`;
  return null;
}

// Run multiple checks, return first error or null
export function validate(...checks) {
  for (const err of checks) {
    if (err) return err;
  }
  return null;
}

// Express middleware factory — calls next() with 400 + errors if validation fails
export function requireValid(validationFn) {
  return (req, res, next) => {
    const errors = validationFn(req.body, req.params, req.query);
    if (errors && errors.length) {
      return res.status(400).json({ message: errors[0] });
    }
    next();
  };
}
