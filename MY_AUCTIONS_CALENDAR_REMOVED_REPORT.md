# MY AUCTIONS CALENDAR — REMOVED

## UI

**Calendar removed.** The toolbar's view-mode group is gone entirely:

```
Before:  Search your auctions…            [ ☰ List ][ 📅 Calendar ][ + Create Auction ]
After:   Search your auctions…                                    [ + Create Auction ]
```

- The `📅 Calendar` button (a *disabled* "coming soon" placeholder rendered with an emoji, not a lucide icon) is deleted — no control, no label, no `aria-label`.
- The `☰ List` button is **also removed**: with Calendar gone it was a pure List/Calendar selector whose only possible value was already `list`, so it could never change anything. Leaving it would have been a useless button.
- The now-empty `.mauc-toggle` wrapper and its CSS rules were deleted, so **no blank gap** is left where the toggle used to sit. `.mauc-toolbar__right` simply holds the Create Auction button with the existing `gap: 8px` flex spacing — the same ATANY styling and spacing as before.
- `+ Create Auction` is untouched: same route, same modal/wizard, same backend logic, still top-right.

The removed "Calendar" control was never a real view — it was a disabled placeholder, so **no live calendar view was ever removed** and nothing regressed.

## List View

- The list layout is now **permanent and unconditional** — there is no view mode state left to select anything else, so the page always renders the auction list.
- Preserved exactly: search, status pills (All status / Live / Scheduled / Paused / Ended), category filters, auction cards, current bid, starting bid, bid count, watchers, auction status, Top Bidders leaderboard, Relist, View result and the lot controls.
- The `viewMode` React state was removed — it existed **only** to switch between List and Calendar and was permanently `'list'` (the Calendar button was disabled), so it was dead state. With it gone there is no unused Calendar-specific state left.
- `AuctionCalendar.jsx` was **not** deleted: it is shared with the Create Auction wizard's schedule step (`AuctionScheduleStep.jsx`), so only the My Auctions usage was removed. `CalendarDays` icons in My Listings / Seller Dashboard are unrelated date icons and were left alone.

## Old Calendar State

- My Auctions never persisted a view mode: there is **no** `localStorage`, `sessionStorage`, `useSearchParams` or URL handling for it anywhere in `MyAuctions.jsx`.
- Therefore no stored `calendar` preference and no `?view=calendar` URL can reach the page — an old bookmark or link simply renders the list, with no error and no blank page. No normalization code was needed.
- The `viewMode` state was hard-coded to `'list'` with no setter path other than the removed button, so it could never have been anything else.

## Files Changed

- `frontend/src/roles/shop-owner/pages/MyAuctions.jsx` — removed the `.mauc-toggle` group (List + Calendar buttons) and the dead `viewMode` state
- `frontend/src/roles/shop-owner/my-auctions.css` — removed the now-unused `.mauc-toggle`, `.mauc-toggle__btn`, `.mauc-toggle__btn.is-active` and `.mauc-toggle__btn:disabled` rules
- `frontend/src/roles/shop-owner/pages/__tests__/MyAuctionsHardening.test.jsx` — replaced the "calendar button is disabled and accessible" test with three tests covering the removal and the intact list behaviour

**Not touched:** auction cards, status/category filters, Top Bidders, lot controls, Relist, View result, Create Auction wizard, auction logic, backend routes, bidding, scheduling, the seller sidebar, and the customer/admin portals. **No backend changes were required.**

## Tests

- **Frontend: 695 passed / 700 (49 files)** — 5 failures, all pre-existing (admin `subscriptionSelectors` ×2, admin `Billing`, `SellerBilling` selectors + page) and unrelated to this change.
- Replaced test coverage in `MyAuctionsHardening.test.jsx` (now 7 tests, all passing):
  1. *the calendar view is completely removed* — no calendar button, no `aria-label` containing "calendar", no "calendar" text, no "View mode" tablist, no "List" button
  2. *the toolbar keeps only Create Auction* — the Create Auction button and the search input are present
  3. *the list layout stays permanent and functional* — both auction cards render, the Live status filter still filters, and the search box still filters

## Build

`npx vite build` ✓ passed (3.35s) — no unused-import errors, no missing-state errors, no broken conditional rendering, and the My Auctions page renders normally.
