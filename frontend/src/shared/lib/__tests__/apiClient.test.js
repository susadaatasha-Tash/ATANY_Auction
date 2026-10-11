import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetSession = vi.fn();
const mockRefreshSession = vi.fn();
const mockFetch = vi.fn();

vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...args) => mockGetSession(...args),
      refreshSession: (...args) => mockRefreshSession(...args),
    },
  },
}));

// Mock fetch globally
global.fetch = mockFetch;

import { apiFetch, ApiError, publicFetch } from '../apiClient';

describe('apiClient — protected vs public', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'valid-token-123', expires_at: Math.floor(Date.now()/1000)+3600 } } });
    mockRefreshSession.mockResolvedValue({ data: { session: null } });
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      clone: () => ({ json: async () => ({}) }),
      json: async () => ({ message: 'ok' }),
      text: async () => JSON.stringify({ ok: true }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('1. protected request with valid session sends Bearer token', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'valid-token-123', expires_at: Math.floor(Date.now()/1000)+3600 } } });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, clone: () => ({ json: async () => ({}) }),
      text: async () => JSON.stringify({ ok: true }),
    });
    await apiFetch('/customer/orders');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/customer/orders'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer valid-token-123' }) })
    );
  });

  it('2. protected request with no session does NOT call backend (throws AUTH_REQUIRED)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockRefreshSession.mockResolvedValue({ data: { session: null } });
    await expect(apiFetch('/customer/orders')).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('3. public request still works without session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockRefreshSession.mockResolvedValue({ data: { session: null } });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, clone: () => ({ json: async () => ({}) }),
      text: async () => JSON.stringify({ branches: [] }),
    });
    const res = await apiFetch('/branches', { public: true });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/branches'),
      expect.objectContaining({ headers: expect.not.objectContaining({ Authorization: expect.anything() }) })
    );
    expect(res).toEqual({ branches: [] });
  });

  it('public via publicFetch helper also works without session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, clone: () => ({ json: async () => ({}) }),
      text: async () => JSON.stringify({ ok: true }),
    });
    await publicFetch('/api/auctions/live');
    expect(mockFetch).toHaveBeenCalled();
  });

  it('does not warn spam on every protected request without session', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockRefreshSession.mockResolvedValue({ data: { session: null } });
    await expect(apiFetch('/customer/orders')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(apiFetch('/customer/bids')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    // Should not have called console.warn at all (or only once, not per request)
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('[apiClient] No supabase session'));
    warnSpy.mockRestore();
  });

  it('seeded public.users without Supabase session is not treated as authenticated', async () => {
    // Simulate: Supabase session null, but public.users has row (should still be unauthenticated)
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockRefreshSession.mockResolvedValue({ data: { session: null } });
    // Even if we try to fetch protected, it should throw, not use public.users
    await expect(apiFetch('/customer/preferred-branch')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
