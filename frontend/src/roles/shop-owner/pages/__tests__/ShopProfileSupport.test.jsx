// frontend/src/roles/shop-owner/pages/__tests__/ShopProfileSupport.test.jsx
// The Shop Owner support entry point.
//
// A seller asks for help from Shop Profile → Contact ATANY Support. The request
// goes to the shared backend support service (POST /support/account), which
// persists it and notifies the official ATANY inbox. The seller never has to
// leave the portal, and the request is never a fake success.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

import ShopProfile from '../ShopProfile';

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (url) => {
    if (url === '/shop-owner/shop') return { shop_name: 'Golden Heritage', user_email: 'seller@goldenheritage.ph' };
    if (url === '/branches') return [];
    return {};
  });
});

describe('Shop Owner — Contact ATANY Support', () => {
  it('shows the official ATANY support address', async () => {
    render(<ShopProfile />);
    await waitFor(() => expect(screen.getByText(/goldjewelryauction@gmail.com/)).toBeInTheDocument());
  });

  it('opens a real support request form', async () => {
    render(<ShopProfile />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Contact ATANY Support/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Contact ATANY Support/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
  });

  it('submits to the shared support endpoint', async () => {
    apiFetch.mockImplementation(async (url, opts) => {
      if (url === '/support/account' && opts?.method === 'POST') {
        return { success: true, request: { id: 'r1', reference: 'SUP-SELLER1', status: 'new' }, email_notification: { sent: true } };
      }
      if (url === '/shop-owner/shop') return { shop_name: 'Golden Heritage' };
      if (url === '/branches') return [];
      return {};
    });
    render(<ShopProfile />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Contact ATANY Support/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Contact ATANY Support/i }));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'My payout is missing.' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Support Request/i }));

    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url, opts]) => url === '/support/account' && opts?.method === 'POST');
      expect(call).toBeTruthy();
      const body = JSON.parse(call[1].body);
      expect(body.message).toBe('My payout is missing.');
      // The seller identity is resolved server-side.
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('user_id');
    });
    await waitFor(() => expect(screen.getByText('SUP-SELLER1')).toBeInTheDocument());
  });
});
