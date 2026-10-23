// backend/src/tests/listingDisplayImage.test.js
// The image a seller listing displays.
//
// The seller's own upload always wins. A product that genuinely has no photo
// falls back to the ATANY default product photo instead of rendering an empty
// placeholder box. The raw stored `image_url` is never overwritten, and no
// listing is special-cased by name.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: { query: (...args) => poolQuery(...args), connect: vi.fn(), on: vi.fn() },
  isDirectPg: () => true,
}));

const { DEFAULT_PRODUCT_IMAGE_URL, resolveDisplayImage } =
  await import('../config/defaultProductImage.js');

const { listListings, getListingDetail } =
  await import('../controllers/shop-owner/listing.controller.js');

const SELLER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SHOP = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const UPLOAD_URL =
  'https://yypjomqybhuuvkgkcqwm.supabase.co/storage/v1/object/public/atany-products/products/alpha.jpg';

function product(overrides = {}) {
  return {
    id: 'p-1',
    shop_id: SHOP,
    name: 'Alpha test',
    category: 'Rings',
    price: 1000,
    status: 'approved',
    image_url: UPLOAD_URL,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function mockRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  poolQuery.mockImplementation(async (sql) => {
    if (/FROM shops WHERE user_id/i.test(sql)) return { rows: [{ id: SHOP, home_branch_id: null }] };
    if (/FROM products WHERE shop_id/i.test(sql)) return { rows: [product()] };
    if (/FROM products WHERE id=\$1 AND shop_id=\$2/i.test(sql)) return { rows: [product()] };
    if (/FROM auctions WHERE product_id IN/i.test(sql)) {
      return { rows: [{ id: 'a-1', product_id: 'p-1', start_time: new Date().toISOString(), end_time: new Date().toISOString() }] };
    }
    if (/FROM auctions WHERE product_id=\$1/i.test(sql)) {
      return { rows: [{ id: 'a-1', product_id: 'p-1', start_time: new Date().toISOString(), end_time: new Date().toISOString() }] };
    }
    if (/FROM bids/i.test(sql)) return { rows: [{ cnt: 0 }] };
    if (/FROM orders/i.test(sql)) return { rows: [{ cnt: 0 }] };
    return { rows: [] };
  });
});

describe('resolveDisplayImage', () => {
  it('returns the real uploaded image when there is one', () => {
    expect(resolveDisplayImage({ image_url: UPLOAD_URL })).toBe(UPLOAD_URL);
  });

  it('returns the ATANY default when the product has no image', () => {
    expect(resolveDisplayImage({ image_url: null })).toBe(DEFAULT_PRODUCT_IMAGE_URL);
    expect(resolveDisplayImage({ image_url: '' })).toBe(DEFAULT_PRODUCT_IMAGE_URL);
    expect(resolveDisplayImage({ image_url: '   ' })).toBe(DEFAULT_PRODUCT_IMAGE_URL);
    expect(resolveDisplayImage(null)).toBe(DEFAULT_PRODUCT_IMAGE_URL);
  });

  it('prefers the backend-resolved display image over the raw column', () => {
    expect(
      resolveDisplayImage({ image_url: null, display_image_url: UPLOAD_URL })
    ).toBe(UPLOAD_URL);
  });
});

describe('GET /shop-owner/listings — the display image', () => {
  it('includes a display image for every listing', async () => {
    const res = mockRes();
    await listListings({ user: { id: SELLER } }, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    const rows = res.json.mock.calls[0][0];
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      expect(row.display_image_url).toBeTruthy();
    }
  });

  it('gives a photo-less listing the ATANY default without touching the stored value', async () => {
    poolQuery.mockImplementation(async (sql) => {
      if (/FROM shops WHERE user_id/i.test(sql)) return { rows: [{ id: SHOP, home_branch_id: null }] };
      if (/FROM products WHERE shop_id/i.test(sql)) {
        return { rows: [product({ name: 'Maria Win Test 1789800317255', image_url: null })] };
      }
      if (/FROM auctions WHERE product_id IN/i.test(sql)) {
        return { rows: [{ id: 'a-1', product_id: 'p-1', start_time: new Date().toISOString(), end_time: new Date().toISOString() }] };
      }
      if (/FROM bids/i.test(sql)) return { rows: [{ cnt: 0 }] };
      if (/FROM orders/i.test(sql)) return { rows: [{ cnt: 0 }] };
      return { rows: [] };
    });
    const res = mockRes();
    await listListings({ user: { id: SELLER } }, res);
    const rows = res.json.mock.calls[0][0];
    const row = rows[0];
    // The card gets a real image…
    expect(row.display_image_url).toBe(DEFAULT_PRODUCT_IMAGE_URL);
    // …while the stored value stays truthful (no other product's image copied).
    expect(row.image_url).toBeNull();
  });

  it('never special-cases a listing by name', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/controllers/shop-owner/listing.controller.js'),
      'utf8'
    );
    expect(src).not.toMatch(/Maria Win Test/i);
    expect(src).not.toMatch(/1789800317255/);
  });
});

describe('GET /shop-owner/listings/:id — the display image', () => {
  it('includes the same resolved display image in the detail payload', async () => {
    const res = mockRes();
    await getListingDetail({ user: { id: SELLER }, params: { id: 'p-1' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.listing.display_image_url).toBe(UPLOAD_URL);
    // The raw stored value is preserved for the edit form.
    expect(body.listing.image_url).toBe(UPLOAD_URL);
  });
});
