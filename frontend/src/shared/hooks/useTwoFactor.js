// frontend/src/shared/hooks/useTwoFactor.js
// Extension d) — optional TOTP 2FA (beyond spec). Backend stores totp_secret per user (schema.sql).
// Flow: POST /auth/2fa/setup -> returns otpauth_url, user scans with Authenticator then POST /auth/2fa/verify
import { apiFetch } from '../lib/apiClient';

export function useTwoFactor() {
  const setup = async () => apiFetch('/auth/2fa/setup', { method: 'POST' });
  const verify = async (token) => apiFetch('/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ token }) });
  const disable = async () => apiFetch('/auth/2fa/disable', { method: 'POST' });
  return { setup, verify, disable };
}
