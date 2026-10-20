import { describe, it, expect } from 'vitest';
import {
  normalizeEmail,
  validateEmail,
  normalizePhilippinePhone,
  validatePhilippinePhone,
  extractLocalDigits,
  calculatePasswordStrength,
  validatePassword,
  validatePasswordMatch,
  validateName,
  validateSignupForm,
} from '../signupValidation';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Test@Email.COM  ')).toBe('test@email.com');
    expect(normalizeEmail('KLane.Cruz@Gmail.COM')).toBe('klane.cruz@gmail.com');
  });
});

describe('validateEmail', () => {
  it('rejects empty', () => expect(validateEmail('')).toBe('Please enter a valid email address.'));
  it('rejects spaces inside', () => expect(validateEmail('klane @gmail.com')).toBe('Please enter a valid email address.'));
  it('rejects missing @', () => expect(validateEmail('klane')).toBe('Please enter a valid email address.'));
  it('rejects missing local', () => expect(validateEmail('@gmail.com')).toBe('Please enter a valid email address.'));
  it('rejects missing domain', () => expect(validateEmail('klane@')).toBe('Please enter a valid email address.'));
  it('rejects klane@gmail (no TLD)', () => expect(validateEmail('klane@gmail')).toBe('Please enter a valid email address.'));
  it('rejects klane@gmail. (trailing dot)', () => expect(validateEmail('klane@gmail.')).toBe('Please enter a valid email address.'));
  it('rejects multiple @', () => expect(validateEmail('a@b@c.com')).toBe('Please enter a valid email address.'));
  it('accepts valid', () => expect(validateEmail('klane.cruz@gmail.com')).toBe(''));
  it('accepts valid .ph domain', () => expect(validateEmail('person@company.ph')).toBe(''));
  it('accepts plus addressing', () => expect(validateEmail('test+demo@email.com')).toBe(''));
});

describe('normalizePhilippinePhone', () => {
  it('9514118324 -> +639514118324', () => expect(normalizePhilippinePhone('9514118324')).toBe('+639514118324'));
  it('09514118324 -> +639514118324', () => expect(normalizePhilippinePhone('09514118324')).toBe('+639514118324'));
  it('+639514118324 -> same', () => expect(normalizePhilippinePhone('+639514118324')).toBe('+639514118324'));
  it('formatted +63 951 411 8324 -> +639514118324', () => expect(normalizePhilippinePhone('+63 951 411 8324')).toBe('+639514118324'));
  it('0951-411-8324 -> +639514118324', () => expect(normalizePhilippinePhone('0951-411-8324')).toBe('+639514118324'));
  it('does not double +63', () => expect(normalizePhilippinePhone('+639514118324')).toBe('+639514118324'));
});

describe('validatePhilippinePhone', () => {
  it('9 digits after +63 is incomplete', () => expect(validatePhilippinePhone('951411832')).toBe('Mobile number is incomplete. Enter 10 digits after +63.'));
  it('11 digits after +63 is too long', () => expect(validatePhilippinePhone('95141183244')).toBe('Mobile number is too long. Enter only 10 digits after +63.'));
  it('local not starting 9 is invalid', () => expect(validatePhilippinePhone('8514118324')).toBe('Enter a valid Philippine mobile number.'));
  it('letters rejected', () => expect(validatePhilippinePhone('95141abc24')).toBe('Enter a valid Philippine mobile number.'));
  it('valid 10 digits starting 9 passes', () => expect(validatePhilippinePhone('9514118324')).toBe(''));
  it('valid +639... passes', () => expect(validatePhilippinePhone('+639514118324')).toBe(''));
});

describe('extractLocalDigits', () => {
  it('extracts from +639...', () => expect(extractLocalDigits('+639514118324')).toBe('9514118324'));
  it('extracts from 095...', () => expect(extractLocalDigits('09514118324')).toBe('9514118324'));
});

describe('calculatePasswordStrength', () => {
  it('short invalid scores Very Weak', () => {
    const r = calculatePasswordStrength('123');
    expect(r.label).toBe('Very Weak');
  });
  it('12345678 scores Weak (only length+number)', () => {
    const r = calculatePasswordStrength('12345678');
    expect(r.score).toBe(2);
    expect(r.label).toBe('Weak');
  });
  it('stronger mixed scores higher', () => {
    const weak = calculatePasswordStrength('abcdefgh');
    const strong = calculatePasswordStrength('Klane@2026Strong');
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.label).toMatch(/Strong|Very Strong/);
  });
  it('deterministic', () => {
    expect(calculatePasswordStrength('Abc123!@#').score).toBe(calculatePasswordStrength('Abc123!@#').score);
  });
});

describe('validatePassword', () => {
  it('short invalid', () => expect(validatePassword('1234567')).toBe('Password must be at least 8 characters.'));
  it('8 chars valid', () => expect(validatePassword('12345678')).toBe(''));
});

describe('validatePasswordMatch', () => {
  it('mismatch rejected', () => expect(validatePasswordMatch('abc12345', 'abc12346')).toBe('Passwords do not match.'));
  it('empty confirm required', () => expect(validatePasswordMatch('abc12345', '')).toBe('Please confirm your password.'));
  it('matching valid', () => expect(validatePasswordMatch('abc12345', 'abc12345')).toBe(''));
  it('revalidates when original changes', () => {
    expect(validatePasswordMatch('newpass123', 'oldpass123')).toBe('Passwords do not match.');
  });
});

describe('validateName', () => {
  it('trims and requires', () => expect(validateName('   ')).toBe('This field is required.'));
  it('allows hyphen', () => expect(validateName('Anne-Marie')).toBe(''));
  it("allows apostrophe", () => expect(validateName("D'Costa")).toBe(''));
  it('allows space', () => expect(validateName('Juan Miguel')).toBe(''));
  it('rejects too long', () => expect(validateName('a'.repeat(51))).toBe('Name is too long.'));
});

describe('validateSignupForm', () => {
  it('invalid form not valid', () => {
    const { isValid } = validateSignupForm({ firstName: '', lastName: '', email: 'bad', phone: '123', password: '123', confirmPassword: '456', termsAgreed: false });
    expect(isValid).toBe(false);
  });
  it('valid form is valid', () => {
    const { isValid } = validateSignupForm({ firstName: 'Isabella', lastName: 'Reyes', email: 'test@example.com', phone: '9514118324', password: 'Klane@2026Strong', confirmPassword: 'Klane@2026Strong', termsAgreed: true });
    expect(isValid).toBe(true);
  });
});
