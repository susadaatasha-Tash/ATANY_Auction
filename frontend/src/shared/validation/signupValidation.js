// frontend/src/shared/validation/signupValidation.js
// Pure helpers for Signup form — deterministic, tested, no DOM.

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function validateEmail(email) {
  const raw = String(email || '');
  const trimmed = raw.trim();
  if (!trimmed) return 'Please enter a valid email address.';
  if (/\s/.test(trimmed)) return 'Please enter a valid email address.';
  const atCount = (trimmed.match(/@/g) || []).length;
  if (atCount !== 1) return 'Please enter a valid email address.';
  const [local, domain] = trimmed.split('@');
  if (!local || !domain) return 'Please enter a valid email address.';
  if (local.startsWith('.') || local.endsWith('.')) return 'Please enter a valid email address.';
  if (local.includes('..')) return 'Please enter a valid email address.';
  if (domain.startsWith('.') || domain.endsWith('.') || domain.startsWith('-') || domain.endsWith('-')) return 'Please enter a valid email address.';
  if (!domain.includes('.')) return 'Please enter a valid email address.';
  if (domain.includes('..')) return 'Please enter a valid email address.';
  const domainParts = domain.split('.');
  const tld = domainParts[domainParts.length - 1];
  if (!tld || tld.length < 2) return 'Please enter a valid email address.';
  // Allow + addressing, dots, underscores, percent, hyphen
  const emailRegex = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
  if (!emailRegex.test(trimmed)) return 'Please enter a valid email address.';
  // Domain labels must not start/end with hyphen
  for (const label of domainParts) {
    if (!label) return 'Please enter a valid email address.';
    if (label.startsWith('-') || label.endsWith('-')) return 'Please enter a valid email address.';
  }
  return '';
}

export function validateName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'This field is required.';
  if (trimmed.length > 50) return 'Name is too long.';
  // Allow letters, spaces, hyphens, apostrophes (including Unicode letters for Filipino names)
  // Disallow digits and most symbols
  if (!/^[A-Za-zÀ-ÿ\u00C0-\u024F' -]+$/.test(trimmed)) return 'Name contains invalid characters.';
  return '';
}

// Philippine mobile helpers — canonical +639XXXXXXXXX
export function normalizePhilippinePhone(input) {
  if (input == null) return '';
  let s = String(input).trim();
  // Remove spaces, hyphens, parentheses, dots
  s = s.replace(/[\s\-\(\)\.]/g, '');
  // If input was like +63 951 ... with spaces already removed, keep +
  // Handle leading 09, 9, +639
  if (s.startsWith('+63')) {
    // Already +63..., remove any duplicate +63 handling — ensure only one +
    // Normalize to +63 + 10 digits (if originally had +63, keep)
    const rest = s.slice(3).replace(/\D/g, '');
    return '+63' + rest;
  }
  if (s.startsWith('09')) {
    // 09XXXXXXXXX -> +639XXXXXXXXX
    const rest = s.slice(1).replace(/\D/g, ''); // remove leading 0
    return '+63' + rest;
  }
  if (s.startsWith('9')) {
    const digits = s.replace(/\D/g, '');
    return '+63' + digits;
  }
  if (s.startsWith('+')) {
    // Unknown + prefix, keep digits after +
    const digits = s.replace(/[^\d]/g, '');
    // If it was +639..., digits will be 639..., we want +639...
    if (digits.startsWith('63')) return '+' + digits;
    return '+' + digits;
  }
  // Fallback: extract digits
  const digits = s.replace(/\D/g, '');
  if (digits.startsWith('09')) return '+63' + digits.slice(1);
  if (digits.startsWith('9')) return '+63' + digits;
  if (digits.startsWith('63')) return '+' + digits;
  return digits ? '+63' + digits : '';
}

export function validatePhilippinePhone(input) {
  const raw = String(input || '').trim();
  if (!raw) return 'Mobile number is required.';
  // Reject letters
  if (/[A-Za-z]/.test(raw)) return 'Enter a valid Philippine mobile number.';
  const normalized = normalizePhilippinePhone(raw);
  // Normalized should be +639XXXXXXXXX
  if (!/^\+639\d+$/.test(normalized)) {
    // Check if it's incomplete vs too long vs wrong start
    const digitsAfter63 = normalized.replace(/^\+63/, '').replace(/\D/g, '');
    if (digitsAfter63.length < 10) return 'Mobile number is incomplete. Enter 10 digits after +63.';
    if (digitsAfter63.length > 10) return 'Mobile number is too long. Enter only 10 digits after +63.';
    return 'Enter a valid Philippine mobile number.';
  }
  const local = normalized.slice(3); // after +63
  if (local.length < 10) return 'Mobile number is incomplete. Enter 10 digits after +63.';
  if (local.length > 10) return 'Mobile number is too long. Enter only 10 digits after +63.';
  if (!local.startsWith('9')) return 'Enter a valid Philippine mobile number.';
  if (!/^\d{10}$/.test(local)) return 'Enter a valid Philippine mobile number.';
  return '';
}

// Phone input helper for pasted full numbers — extracts local 10 digits after +63
export function extractLocalDigits(input) {
  const normalized = normalizePhilippinePhone(input);
  const local = normalized.replace(/^\+63/, '');
  if (/^\d{10}$/.test(local) && local.startsWith('9')) return local;
  // Try to extract from raw
  const digits = String(input).replace(/\D/g, '');
  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    if (last10.startsWith('9')) return last10;
  }
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

export function validateSignupForm({ firstName, lastName, email, phone, password, confirmPassword, termsAgreed }) {
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
