// backend/src/validation/authValidation.js
// Reusable validators — must stay in sync with frontend, but never trust frontend.

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  const trimmed = String(email || '').trim();
  if (!trimmed) return false;
  if (/\s/.test(trimmed)) return false;
  const atCount = (trimmed.match(/@/g) || []).length;
  if (atCount !== 1) return false;
  const [local, domain] = trimmed.split('@');
  if (!local || !domain) return false;
  if (local.startsWith('.') || local.endsWith('.')) return false;
  if (local.includes('..')) return false;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.startsWith('-') || domain.endsWith('-')) return false;
  if (!domain.includes('.')) return false;
  if (domain.includes('..')) return false;
  const tld = domain.split('.').pop();
  if (!tld || tld.length < 2) return false;
  const emailRegex = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
  if (!emailRegex.test(trimmed)) return false;
  for (const label of domain.split('.')) {
    if (!label || label.startsWith('-') || label.endsWith('-')) return false;
  }
  return true;
}

export function validateEmail(email) {
  if (!isValidEmail(String(email || '').trim())) return 'Please enter a valid email address.';
  return '';
}

export function normalizePhilippinePhone(input) {
  if (input == null) return '';
  let s = String(input).trim().replace(/[\s\-\(\)\.]/g, '');
  if (s.startsWith('+63')) {
    const rest = s.slice(3).replace(/\D/g, '');
    return '+63' + rest;
  }
  if (s.startsWith('09')) {
    const rest = s.slice(1).replace(/\D/g, '');
    return '+63' + rest;
  }
  if (s.startsWith('9')) {
    const digits = s.replace(/\D/g, '');
    return '+63' + digits;
  }
  if (s.startsWith('+')) {
    const digits = s.replace(/[^\d]/g, '');
    if (digits.startsWith('63')) return '+' + digits;
    return '+' + digits;
  }
  const digits = s.replace(/\D/g, '');
  if (digits.startsWith('09')) return '+63' + digits.slice(1);
  if (digits.startsWith('9')) return '+63' + digits;
  if (digits.startsWith('63')) return '+' + digits;
  return digits ? '+63' + digits : '';
}

export function isValidPhilippinePhone(input) {
  const raw = String(input || '').trim();
  if (!raw) return false;
  if (/[A-Za-z]/.test(raw)) return false;
  const normalized = normalizePhilippinePhone(raw);
  if (!/^\+639\d{9}$/.test(normalized)) return false;
  const local = normalized.slice(3);
  return /^\d{10}$/.test(local) && local.startsWith('9');
}

export function validatePhilippinePhone(input) {
  const raw = String(input || '').trim();
  if (!raw) return 'Mobile number is required.';
  if (/[A-Za-z]/.test(raw)) return 'Enter a valid Philippine mobile number.';
  const normalized = normalizePhilippinePhone(raw);
  if (!/^\+639\d+$/.test(normalized)) {
    const digitsAfter63 = normalized.replace(/^\+63/, '').replace(/\D/g, '');
    if (digitsAfter63.length < 10) return 'Mobile number is incomplete. Enter 10 digits after +63.';
    if (digitsAfter63.length > 10) return 'Mobile number is too long. Enter only 10 digits after +63.';
    return 'Enter a valid Philippine mobile number.';
  }
  const local = normalized.slice(3);
  if (local.length < 10) return 'Mobile number is incomplete. Enter 10 digits after +63.';
  if (local.length > 10) return 'Mobile number is too long. Enter only 10 digits after +63.';
  if (!local.startsWith('9')) return 'Enter a valid Philippine mobile number.';
  if (!/^\d{10}$/.test(local)) return 'Enter a valid Philippine mobile number.';
  return '';
}

export function calculatePasswordStrength(password) {
  const pwd = String(password || '');
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (pwd.length >= 12) score += 1;
  if (/[a-z]/.test(pwd)) score += 1;
  if (/[A-Z]/.test(pwd)) score += 1;
  if (/[0-9]/.test(pwd)) score += 1;
  if (/[^A-Za-z0-9]/.test(pwd)) score += 1;
  let label = 'Very Weak';
  if (score <= 1) label = 'Very Weak';
  else if (score === 2) label = 'Weak';
  else if (score === 3) label = 'Fair';
  else if (score >= 4 && score <= 5) label = 'Strong';
  else if (score >= 6) label = 'Very Strong';
  return { score, label, max: 6 };
}

export function validatePassword(password) {
  const pwd = String(password || '');
  if (!pwd) return 'Password is required.';
  if (pwd.length < 8) return 'Password must be at least 8 characters.';
  return '';
}

export function validatePasswordMatch(password, confirmPassword) {
  const confirm = String(confirmPassword || '');
  if (!confirm) return 'Please confirm your password.';
  if (String(password) !== confirm) return 'Passwords do not match.';
  return '';
}

export function validateName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'This field is required.';
  if (trimmed.length > 50) return 'Name is too long.';
  if (!/^[A-Za-zÀ-ÿ\u00C0-\u024F' -]+$/.test(trimmed)) return 'Name contains invalid characters.';
  return '';
}

export function validateSignupPayload({ firstName, lastName, email, phone, password, confirmPassword, termsAgreed }) {
  const errors = {
    firstName: validateName(firstName),
    lastName: validateName(lastName),
    email: validateEmail(email),
    phone: validatePhilippinePhone(phone),
    password: validatePassword(password),
    confirmPassword: validatePasswordMatch(password, confirmPassword),
    terms: termsAgreed ? '' : 'Please agree to the Terms & Privacy Policy.',
  };
  const isValid = Object.values(errors).every((e) => !e);
  return { errors, isValid };
}
