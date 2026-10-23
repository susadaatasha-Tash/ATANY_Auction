// frontend/src/roles/shop-owner/pages/__tests__/MyListingsHeaderImage.test.jsx
// My Listings — duplicate heading removal + listing image resolution.
//
//  • the page title lives in the portal topbar only (no duplicate in the body)
//  • every listing card renders a real image: the seller's own upload wins,
//    a photo-less listing falls back to the ATANY default photo
//  • the fix is generic — no listing-name special casing
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));
vi.mock('../../../../shared/lib/socketClient', () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), removeAllListeners: vi.fn() },
}));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));
vi.mock('../../../components/StatusBadge', () => ({
  StatusBadge: ({ status, label }) => <span data-testid="status-badge">{label || status}</span>,
}));
vi.mock('../../../components/SubmitListingModal', () => ({ SubmitListingModal: () => null }));

import MyListings from '../MyListings';
import { DEFAULT_PRODUCT_IMAGE_URL } from '../../../../shared/lib/defaultProductImage';

const withImage = {
  id: 'l-1',
  name: 'Alpha test',
  category: 'Rings',
  karat_weight: '18K',
  price: 1000,
  status: 'approved',
  computed_status: 'ended',
  image_url: 'https://yypjomqybhuuvkgkcqwm.supabase.co/storage/v1/object/public/atany-products/products/alpha.jpg',
  display_image_url: 'https://yypjomqybhuuvkgkcqwm.supabase.co/storage/v1/object/public/atany-products/products/alpha.jpg',
  can_delete: true,
};
const withoutImage = {
  id: 'l-2',
  name: 'Maria Win Test 1789800317255',
  category: 'Rings',
  karat_weight: '18K',
  price: 20000,
  status: 'approved',
  computed_status: 'ended',
  image_url: null,
  display_image_url: DEFAULT_PRODUCT_IMAGE_URL,
  can_delete: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockImplementation((p) => {
    if (p === '/shop-owner/listings') return Promise.resolve([withImage, withoutImage]);
    if (String(p).includes('/shop-owner/listings/')) return Promise.resolve({ listing: withoutImage, auction: null, branch: null });
    return Promise.resolve([]);
  });
});

describe('MyListings — the duplicate body heading is gone', () => {
  it('does not render a second "SELLER PORTAL" / "My Listings" heading in the body', async () => {
    render(<MyListings />);
    await waitFor(() => expect(screen.getByText('Alpha test')).toBeInTheDocument());
    // No duplicate heading inside the page content.
    expect(screen.queryByText('SELLER PORTAL')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'My Listings' })).not.toBeInTheDocument();
  });

  it('starts the content with the search bar and the status filter', async () => {
    render(<MyListings />);
    await waitFor(() => expect(screen.getByText('Alpha test')).toBeInTheDocument());
    expect(screen.getByLabelText('Search your listings')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter listings by status')).toBeInTheDocument();
  });
});

describe('MyListings — listing images', () => {
  it('renders the real uploaded image for a listing that has one', async () => {
    render(<MyListings />);
    await waitFor(() => expect(screen.getByText('Alpha test')).toBeInTheDocument());
    const img = screen.getByAltText('Alpha test');
    expect(img.getAttribute('src')).toBe(withImage.image_url);
  });

  it('renders the storage-resolved image for a listing', async () => {
    render(<MyListings />);
    await waitFor(() => expect(screen.getByText('Alpha test')).toBeInTheDocument());
    const img = screen.getByAltText('Alpha test');
    expect(img.getAttribute('src')).toContain('/storage/v1/object/public/atany-products/');
  });

  it('falls back to the ATANY default photo for a listing with no image at all', async () => {
    render(<MyListings />);
    await waitFor(() => expect(screen.getByText('Alpha test')).toBeInTheDocument());
    const img = screen.getByAltText('Maria Win Test 1789800317255');
    expect(img.getAttribute('src')).toBe(DEFAULT_PRODUCT_IMAGE_URL);
    expect(img.getAttribute('src')).not.toBe('');
  });

  it('falls back even when the API returns no display_image_url', async () => {
    apiFetch.mockImplementation((p) => {
      if (p === '/shop-owner/listings') {
        return Promise.resolve([{ ...withoutImage, display_image_url: undefined }]);
      }
      return Promise.resolve([]);
    });
    render(<MyListings />);
    await waitFor(() => expect(screen.getByText('Maria Win Test 1789800317255')).toBeInTheDocument());
    const img = screen.getByAltText('Maria Win Test 1789800317255');
    expect(img.getAttribute('src')).toBe(DEFAULT_PRODUCT_IMAGE_URL);
  });
});

describe('MyListings — no listing-name special casing', () => {
  it('the source contains no per-listing-name image logic', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../MyListings.jsx'),
      'utf8'
    );
    expect(src).not.toMatch(/Maria Win Test/i);
    expect(src).not.toMatch(/1789800317255/);
    // The image comes from the shared resolver, not an inline conditional.
    expect(src).toContain('resolveDisplayImage');
  });
});

describe('MyListings — existing behaviour still works', () => {
  it('renders the listing cards', async () => {
    render(<MyListings />);
    await waitFor(() => expect(screen.getByText('Alpha test')).toBeInTheDocument());
    expect(screen.getByText('Maria Win Test 1789800317255')).toBeInTheDocument();
    expect(screen.getAllByText('Rings').length).toBeGreaterThan(0);
  });

  it('search still filters the listings', async () => {
    render(<MyListings />);
    await waitFor(() => expect(screen.getByText('Alpha test')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Search your listings'), { target: { value: 'Alpha' } });
    await waitFor(() => expect(screen.queryByText('Maria Win Test 1789800317255')).not.toBeInTheDocument());
    expect(screen.getByText('Alpha test')).toBeInTheDocument();
  });

  it('the status filter still works', async () => {
    render(<MyListings />);
    await waitFor(() => expect(screen.getByText('Alpha test')).toBeInTheDocument());
    const select = screen.getByLabelText('Filter listings by status');
    expect(select).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'live' } });
    await waitFor(() => {
      expect(screen.queryByText('Alpha test')).not.toBeInTheDocument();
    });
  });

  it('View details still opens the listing detail', async () => {
    render(<MyListings />);
    await waitFor(() => expect(screen.getByText('Alpha test')).toBeInTheDocument());
    const viewButtons = screen.getAllByRole('button', { name: /view details/i });
    expect(viewButtons.length).toBeGreaterThan(0);
    fireEvent.click(viewButtons[0]);
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
  });
});
