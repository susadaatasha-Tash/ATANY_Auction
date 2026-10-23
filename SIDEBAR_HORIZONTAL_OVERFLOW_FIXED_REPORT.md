# ROLE SIDEBAR HORIZONTAL OVERFLOW — FIXED

## Root Cause

The sidebar could scroll horizontally because **`overflow-x: visible !important`** was set on `.sidebar` in two secondary CSS files, overriding the `overflow: hidden` in `index.css`:

1. **`frontend/src/shared/fixed-layout.css`** (Admin & Shop Owner — `.app`, `.admin-app`):
   - Line 38: `overflow-x: visible !important;`
   - Line 43: `overflow-x: visible !important;`

2. **`frontend/src/roles/customer/customer-dashboard.css`** (Customer — `.customer-app`):
   - Line 42: `overflow-x: visible !important;`
   - Line 47: `overflow-x: visible !important;`

These `!important` rules explicitly allowed horizontal overflow on the sidebar, causing the horizontal scrollbar seen in the Customer screenshot.

**Contributing factors fixed alongside:**
- `.sidebar-nav` had `overflow-y: auto` but no explicit `overflow-x`. Per CSS spec, setting `overflow-y: auto` implicitly makes `overflow-x: auto`, allowing horizontal scrollbars on the nav container.
- `.nav-item` lacked `min-width: 0`, so flex items couldn't shrink below content size.
- `.nav-label` lacked `text-overflow: ellipsis`, `overflow: hidden`, and `white-space: nowrap`, so long labels could force horizontal expansion.

## Shared Sidebar

**`frontend/src/shared/components/Sidebar.jsx`** — the single shared component used by Admin, Customer, and Shop Owner.

- Sidebar is always mounted (`collapsed` changes presentation only, never unmounts).
- Icons render outside the `!collapsed` conditional — always visible.
- Every nav link keeps `aria-label` + `title` tooltips.
- Sign Out button always rendered with `width: 100%` inside the sidebar foot.

**CSS fixes (centralized in `index.css`):**
- `.sidebar`: changed `overflow: hidden` → `overflow-x: hidden; overflow-y: auto;` (explicit per-axis)
- `.sidebar-nav`: added `overflow-x: hidden;` (overrides implicit `overflow-x: auto` from `overflow-y: auto`)
- `.nav-item`: added `min-width: 0` (flex items can shrink below content size)
- `.nav-label`: added `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` (long labels truncate instead of expanding)

## Admin

- **Expanded**: sidebar width 260px, `overflow-x: hidden`, labels visible, no horizontal scroll.
- **Collapsed**: sidebar width 80px icon rail, `overflow-x: hidden`, labels hidden, icons centered, no horizontal scroll.
- **scrollWidth <= clientWidth**: guaranteed by `overflow-x: hidden` on both `.sidebar` and `.sidebar-nav`.
- **Covered by**: `shared/fixed-layout.css` (`.app`, `.admin-app` rules changed `overflow-x: visible` → `overflow-x: hidden`).

## Customer

- **Expanded**: sidebar width 260px, `overflow-x: hidden`, labels visible, no horizontal scroll.
- **Collapsed**: sidebar width 80px icon rail, `overflow-x: hidden`, labels hidden, icons centered, no horizontal scroll.
- **Covered by**: `customer-dashboard.css` (`.customer-app` rules changed `overflow-x: visible` → `overflow-x: hidden`).

## Shop Owner

- Shop Owner uses `.app` class, so it is covered by `shared/fixed-layout.css`.
- **Expanded**: sidebar width 260px, `overflow-x: hidden`, labels visible, no horizontal scroll.
- **Collapsed**: sidebar width 80px icon rail, `overflow-x: hidden`, labels hidden, icons centered, no horizontal scroll.
- LiveAuctionCard sidebar foot preserved — stays inside sidebar width.

## Responsive

- **Desktop (>=1200px)**: sidebar can scroll vertically (`overflow-y: auto`), never horizontally (`overflow-x: hidden`).
- **Tablet (768–1199px)**: same icon-rail behavior, no horizontal scroll.
- **Mobile (<768px)**: existing slide-out drawer preserved — sidebar positioned off-screen when closed, `overflow-x: hidden` inherited from `.sidebar` base rule.

## Hamburger

- Desktop: click once → collapse to 80px icon rail; click again → expand to full sidebar.
- Never removes nav, never leaves blank area.
- `aria-expanded` + `aria-label` on toggle button.
- Mobile drawer open/closed is separate state from desktop collapsed/expanded.

## Persistence

Role-scoped `localStorage` keys unchanged:
- Admin: `atany_admin_sidebar_collapsed`
- Customer: `atany_customer_sidebar_collapsed`
- Shop Owner: `atany_shop_sidebar_collapsed`

## Files Changed

**Modified:**
- `frontend/src/index.css` — `overflow-x: hidden` on `.sidebar` and `.sidebar-nav`; `min-width: 0` on `.nav-item`; text-overflow on `.nav-label`
- `frontend/src/shared/fixed-layout.css` — `overflow-x: visible` → `overflow-x: hidden` (2 occurrences)
- `frontend/src/roles/customer/customer-dashboard.css` — `overflow-x: visible` → `overflow-x: hidden` (2 occurrences)

**Test additions:**
- `frontend/src/shared/components/__tests__/Sidebar.test.jsx` — 7 new overflow prevention tests (CSS rules exist, sidebar mounted, collapsed mounted, Sign Out inside width)

**Not changed:** backend (no routes/controllers/services/DB), page content, dashboards, KPI cards, modals, forms, bidding/payment/subscription UI.

## Tests

- **Total**: 627 passed / 632 across 45 files.
- **Failures**: 5, all pre-existing subscription/billing selector tests (verified failing on unmodified baseline; unrelated to this fix).
- New coverage: Sidebar horizontal overflow prevention (CSS contract + DOM structure).

## Build

- `npx vite build` ✓ passed (4.19s), no broken imports, no missing icons, no React errors.

## Browser QA

**Not executable via automation** — no Playwright, Puppeteer, or WebDriver installed. Chrome.app is present but cannot be driven programmatically.

**Source-level verification:**
- `overflow-x: visible` → `overflow-x: hidden` confirmed in all 3 CSS files (4 occurrences changed)
- `overflow-x: hidden` + `overflow-y: auto` confirmed on `.sidebar` and `.sidebar-nav` in `index.css`
- `min-width: 0` confirmed on `.nav-item`
- `text-overflow: ellipsis` confirmed on `.nav-label`
- All 16 Sidebar tests pass (9 existing + 7 new overflow tests)
- Build passes cleanly

To complete real-browser QA: run `npx vite --port 5178`, open Chrome to `/admin`, `/customer`, `/shop`, log in, and verify no horizontal scrollbar on sidebar in both expanded and collapsed modes for all three roles.
