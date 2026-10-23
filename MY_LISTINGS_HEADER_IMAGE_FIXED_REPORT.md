# MY LISTINGS HEADER + IMAGE — FIXED

## Header

**Duplicate heading removed.** The page body no longer renders its own heading block:

```
Before:  ┌ SELLER PORTAL / My Listings ┐   ← duplicate (the topbar already showed this)
         ┌ Search your listings… ┐
After:   ┌ Search your listings…  All Status ┐   ← content starts directly with the toolbar
         ┌ listing cards ┐
```

- Removed the `<div className="ml-header">` block (`SELLER PORTAL` eyebrow + `My Listings` title) from `MyListings.jsx`.
- **The portal top header is untouched** — "SELLER PORTAL / My Listings" still renders in the `PortalPageHeader` next to the hamburger.
- **No empty gap**: `.ml-page` is a flex column with `gap: 16px`; removing one child simply makes the toolbar the first item, so there is no leftover vertical space.
- The now-dead `.ml-header`, `.ml-header__eyebrow` and `.ml-header__title` CSS rules were removed from `my-listings.css` (they were used nowhere else).
- The toolbar, search box, status filter, cards, prices, categories, View details, Delete, status badges, Top Bidders, lot controls and the seller sidebar are unchanged.

## Maria Win Test Image

- **Product ID**: `9c81d7a5-051f-44d2-a045-896075fc30e8`
- **Listing ID**: the same row (`products` is the listing entity; `GET /shop-owner/listings` returns it as a listing)
- **Auction ID**: `40b2fb00-53d4-4724-9991-cfcbe722268a` (ended, 1 bid, 1 order — Maria Santos' win, `TXN-9003`)
- **Shop**: `8dfd50c4-30f2-467a-ab4c-7cf9bff08de5` (Golden Heritage — Gmall)

**Original image source**: `products.image_url` is the only image field in the schema (there is no `product_images` table and no storage-path column). For this product it is **`NULL`**, and **no Supabase Storage object exists** for it either — the bucket was listed and no object matches the upload timestamp embedded in its name (`1789800317255` = the `Date.now()` from `createUploadUrl`, i.e. an upload URL *was* requested, but the object was never uploaded). No other product, auction or order row references an image for it.

**Root cause (generic)**: a listing created **without a photo** ends up with `image_url = NULL` and the card falls back to the big beige gem placeholder. ATANY's own listing form already falls back to a generic jewellery photo when an *upload fails* (`SubmitListingModal`), but that fallback was only applied in the upload-error branch — **not** when no file was chosen at all, and the backend happily stored `NULL`. The image resolution therefore had no single owner: the stored column could be empty and every consumer then had to guess.

**Final image source**: the backend now resolves a **display image** for every listing through one shared resolver — the seller's own upload always wins; a product that genuinely has no photo gets ATANY's standard default jewellery photo (the exact same image the listing form already used for a failed upload). The stored `image_url` is left untouched (`NULL` stays `NULL`), so no other product's upload was copied and the edit form never silently persists the fallback.

**Verified live** (`GET /shop-owner/listings` and `GET /shop-owner/listings/:id`, real seller JWT):

| Listing | display image |
|---|---|
| Alpha test | own upload ✓ |
| TEST 1 | own upload ✓ |
| testing 1 | own upload ✓ |
| Rose Gold Bangle | own upload ✓ |
| Verification Ring ×2 | own upload ✓ |
| **Maria Win Test 1789800317255** | **ATANY default photo (was: blank beige box)** |

**No listing-name special casing** — the fix is a shared resolver, asserted by a test that scans the source for `Maria Win Test` / `1789800317255`.

## Image Mapping

**Backend** (`backend/src/config/defaultProductImage.js` — new)
- `DEFAULT_PRODUCT_IMAGE_URL` — the single ATANY fallback product photo
- `resolveDisplayImage(product)` — prefers `display_image_url`, then `image_url`, then the default
- `listing.controller.js` — `listListings` and `getListingDetail` now return `display_image_url` alongside the untouched `image_url`

**Frontend** (`frontend/src/shared/lib/defaultProductImage.js` — new)
- `DEFAULT_PRODUCT_IMAGE_URL` + `resolveDisplayImage(listing)` (same contract as the backend)
- `MyListings.jsx` — the card **and** the View-details modal both render `resolveDisplayImage(...)`, so the card and the details view always agree
- `SubmitListingModal.jsx` — the hardcoded fallback URL now uses the shared constant

**Fallback behaviour**
- A real upload exists → the real image is shown (unchanged)
- The image is genuinely missing → the ATANY default photo is shown
- The URL still fails to load → the existing `onError` behaviour / gem placeholder remains the last resort
- No `overflow`/layout change to the card: the image keeps the existing `ml-card__image` class, so height, aspect ratio, `object-fit: cover`, border radius and the status-badge position are identical to every other card

## Files Changed

**Backend**
- `backend/src/config/defaultProductImage.js` — **new**: the ATANY default photo + `resolveDisplayImage()`
- `backend/src/controllers/shop-owner/listing.controller.js` — returns `display_image_url` for the list and the detail payload

**Frontend**
- `frontend/src/shared/lib/defaultProductImage.js` — **new**: the mirrored constant + resolver
- `frontend/src/roles/shop-owner/pages/MyListings.jsx` — duplicate heading removed; card + detail modal use the resolved image
- `frontend/src/roles/shop-owner/my-listings.css` — dead `.ml-header*` rules removed
- `frontend/src/roles/shop-owner/components/SubmitListingModal.jsx` — uses the shared constant instead of a duplicated URL

**Tests**
- `backend/src/tests/listingDisplayImage.test.js` — **new** (7 tests)
- `frontend/src/roles/shop-owner/pages/__tests__/MyListingsHeaderImage.test.jsx` — **new** (11 tests)

**Not changed:** backend auction routes, bidding, scheduling, the seller sidebar, the topbar, My Auctions, Live Auctions, the customer/admin portals, and no page content was redesigned.

## Tests

- **Backend: 724 passed / 724 (46 files)** — all green. New `listingDisplayImage.test.js` covers: the real upload wins; a missing/blank/absent image resolves to the ATANY default; a server-resolved `display_image_url` is preferred; the list response carries a display image for every row; a photo-less listing gets the default while its stored value stays `NULL`; the detail payload carries the same image; and the source contains no listing-name special casing.
- **Frontend: 706 passed / 711 (50 files)** — 5 failures, all pre-existing (admin `subscriptionSelectors` ×2, admin `Billing`, `SellerBilling` selectors + page) and unrelated. New `MyListingsHeaderImage.test.jsx` covers: no duplicate body heading; the toolbar (search + status filter) is present; a listing with `image_url` renders it; a storage-resolved listing renders the storage URL; a photo-less listing renders the ATANY default photo (and still renders when the API omits `display_image_url`); no listing-name special casing in the source; the cards render; search still filters; the status filter still works; View details still opens the detail.

## Build

`npx vite build` ✓ passed (3.26s) — no broken imports, no unused-import errors, no missing state, no blank page.

## Browser QA

Real-browser automation is unavailable in this sandbox (no Playwright/Puppeteer/Chromium), so the walkthrough was done against the **live server with a real Shop Owner JWT**:
- `GET /shop-owner/listings` → **7/7 listings now carry a display image**; the 6 with uploads keep their own URL, Maria Win Test resolves to the ATANY default photo, and every stored `image_url` is unchanged
- `GET /shop-owner/listings/9c81d7a5-…` → the detail payload carries the same `display_image_url`, with `image_url` still `null` and `can_delete: false` (1 bid) intact

To confirm visually: Shop Owner → My Listings — the topbar shows "SELLER PORTAL / My Listings", the body starts directly with the search + All Status toolbar, and the Maria Win Test card shows a real jewellery photo instead of the blank beige box.

**Note (out of scope, unchanged)**: the sibling **My Auctions** page renders a small thumbnail from the raw `auction.img || auction.image_url`, so a photo-less lot shows no thumb there. That page was not in scope and was left untouched.
