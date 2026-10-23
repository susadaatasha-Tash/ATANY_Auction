// frontend/src/shared/components/__tests__/SupportRequestForm.test.jsx
// The ONE frontend implementation of the ATANY support request.
//
// It posts to the shared backend support service (which persists the request
// and notifies the official inbox) and it NEVER fabricates a success state.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock('../Toast', () => ({ useToast: () => vi.fn() }));

import SupportRequestForm from '../SupportRequestForm';

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({
    success: true,
    request: { id: 'r1', reference: 'SUP-ABC123', status: 'new' },
    email_notification: { sent: true },
  });
});

describe('SupportRequestForm — the official ATANY support destination', () => {
  it('states the official support address', () => {
    render(<SupportRequestForm />);
    expect(screen.getByText('goldjewelryauction@gmail.com')).toBeInTheDocument();
  });

  it('submits to the real support endpoint with the right payload', async () => {
    render(<SupportRequestForm endpoint="/support/account" initialSubject="Shop Owner Support" />);
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Billing / Subscription' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'My renewal failed.' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Support Request/i }));

    await waitFor(() => {
      const call = apiFetch.mock.calls.find(([url, opts]) => url === '/support/account' && opts?.method === 'POST');
      expect(call).toBeTruthy();
      const body = JSON.parse(call[1].body);
      expect(body.category).toBe('Billing / Subscription');
      expect(body.message).toBe('My renewal failed.');
      // Identity is derived server-side — never sent by the client.
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('name');
      expect(body).not.toHaveProperty('user_id');
    });
  });

  it('shows the support reference on success', async () => {
    render(<SupportRequestForm />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Support Request/i }));
    await waitFor(() => expect(screen.getByText('SUP-ABC123')).toBeInTheDocument());
    expect(screen.getByText('Support request sent')).toBeInTheDocument();
  });

  it('disables the submit button while the request is sending', async () => {
    let resolveCall;
    apiFetch.mockImplementation(() => new Promise((res) => { resolveCall = res; }));
    render(<SupportRequestForm />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Support Request/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Sending…/ })).toBeDisabled());
    resolveCall?.({ success: true, request: { reference: 'SUP-X' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Send Support Request/ })).toBeEnabled());
  });

  it('validates an empty message before calling the API', async () => {
    render(<SupportRequestForm />);
    fireEvent.click(screen.getByRole('button', { name: /Send Support Request/i }));
    await waitFor(() => expect(screen.getByText('Please enter a message.')).toBeInTheDocument());
    expect(apiFetch.mock.calls.some(([, opts]) => opts?.method === 'POST')).toBe(false);
  });

  it('on failure it shows the error AND the official address as a fallback', async () => {
    apiFetch.mockRejectedValue(new Error('Unable to send your support request. Please try again.'));
    render(<SupportRequestForm />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Support Request/i }));
    await waitFor(() =>
      expect(screen.getByText('Unable to send your support request. Please try again.')).toBeInTheDocument()
    );
    // The official address stays visible as the fallback channel.
    expect(screen.getByText('goldjewelryauction@gmail.com')).toBeInTheDocument();
  });

  it('is honest when the email notification was delayed', async () => {
    apiFetch.mockResolvedValue({
      success: true,
      request: { id: 'r1', reference: 'SUP-DELAY1', status: 'new' },
      email_notification: { sent: false, reason: 'provider_not_configured' },
    });
    render(<SupportRequestForm />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /Send Support Request/i }));
    await waitFor(() => expect(screen.getByText('SUP-DELAY1')).toBeInTheDocument());
    expect(screen.getByText(/Email notification is temporarily delayed/i)).toBeInTheDocument();
  });

  it('offers only the whitelisted categories', () => {
    render(<SupportRequestForm />);
    const options = [...screen.getByLabelText('Category').querySelectorAll('option')].map((o) => o.value);
    expect(options).toEqual([
      'General Inquiry',
      'Bid Support',
      'Payout Question',
      'Account Issue',
      'Partnership',
      'Billing / Subscription',
      'Auction / Payment Support',
    ]);
  });
});
