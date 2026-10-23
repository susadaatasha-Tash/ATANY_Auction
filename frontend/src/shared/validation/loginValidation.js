// frontend/src/shared/validation/loginValidation.js
// Pure helpers for the Login form — deterministic, tested, no DOM.
//
// Login validation is intentionally lighter than signup:
//  - email: required + valid structure
//  - password: required only (no signup-style strength rules — a historical
//    password that is valid for the account must never be rejected here)

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function validateEmail(email) {
  const raw = String(email || '');
  const trimmed = raw.trim();
  if (!trimmed) return 'Email address is required.';
  if (/\s/.test(trimmed)) return 'Please enter a valid email address.';
  const atCount = (trimmed.match(/@/g) || []).length;
  if (atCount !== 1) return 'Please enter a valid email address.';
  const [local, domain] = trimmed.split('@');
  if (!local || !domain) return 'Please enter a valid email address.';
  if (local.startsWith('.') || local.endsWith('.')) return 'Please enter a valid email address.';
  if (local.includes('..')) return 'Please enter a valid email address.';
  if (domain.startsWith('.') || domain.endsWith('.') || domain.startsWith('-') || domain.endsWith('-')) {
    return 'Please enter a valid email address.';
  }
  if (!domain.includes('.')) return 'Please enter a valid email address.';
  if (domain.includes('..')) return 'Please enter a valid email address.';
  const domainParts = domain.split('.');
  const tld = domainParts[domainParts.length - 1];
  if (!tld || tld.length < 2) return 'Please enter a valid email address.';
  const emailRegex = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
  if (!emailRegex.test(trimmed)) return 'Please enter a valid email address.';
  for (const label of domainParts) {
    if (!label) return 'Please enter a valid email address.';
    if (label.startsWith('-') || label.endsWith('-')) return 'Please enter a valid email address.';
  }
  return '';
}

export function validatePassword(password) {
  const pwd = String(password || '');
  if (!pwd) return 'Password is required.';
  return '';
}
