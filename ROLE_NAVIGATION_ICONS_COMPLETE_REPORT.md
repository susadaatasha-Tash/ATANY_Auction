# ATANY ROLE NAVIGATION ICONS — COMPLETE

## A. Admin
**Navigation items (actual routes):**
- OVERVIEW → Dashboard (`/admin`, `LayoutDashboard`)
- BRANCH OPERATIONS → Branches (`/admin/branches`, `Store`), Users & Roles (`/admin/users`, `Users`), Orders (`/admin/transactions`, `ShoppingBag`)
- PLATFORM MANAGEMENT → Subscriptions (`/admin/billing`, `CreditCard`), Reports (`/admin/analytics`, `BarChart3`), Security Alerts (`/admin/security`, `ShieldAlert`)
- BOTTOM → Sign Out (`LogOut`)

**Icons:** lucide-react outline icons, 15px in sidebar (20–22px equivalent visual weight via container padding), one consistent family.

**Expanded behavior:** icon + label, section headings visible, full brand (`ATANY` / `ADMIN`).

**Collapsed behavior:** icon-only rail (~80px wide), section headings + labels hidden via CSS, brand collapses to the compact ATANY gem mark only (no clipped/half-visible words), icons remain visible, clickable, centered, and active-highlighted.

## B. Customer
**Navigation items (actual routes):**
- OVERVIEW → Dashboard (`/customer`, `Home`)
- SHOP → Auctions (`/customer/auctions`, `Gavel`), My Bids (`/customer/bids`, `Tag`), Favorites (`/customer/favorites`, `Heart`), Watchlist (`/customer/watchlist`, `Eye`), Branch Locator (`/customer/branch-locator`, `MapPin`)
- ORDERS → My Purchases (`/customer/purchases`, `ShoppingBag`)

**Expanded behavior:** icon + label.

**Collapsed/drawer behavior:** icon-only rail on desktop/tablet; mobile (<768px) preserves the existing slide-out drawer (icons + labels while open). The hamburger (`menu-toggle`) drawer behavior is unchanged.

## C. Shop Owner
**Navigation architecture:** existing left-sidebar layout preserved (no conversion to topbar). Uses the same shared `Sidebar` component.

**Navigation items (actual routes):**
- OVERVIEW → Dashboard (`/shop`, `LayoutDashboard`)
- INVENTORY → My Listings (`/shop/listings`, `Gem`), My Auctions (`/shop/auctions`, `Gavel`), Won Lots & Orders (`/shop/orders`, `Package`)
- EARNINGS → Sales & Payouts (`/shop/sales`, `Receipt`), Subscription (`/shop/billing`, `CreditCard`)
- SETTINGS → Shop Profile (`/shop/profile`, `Store`)
- BOTTOM → Sign Out (`LogOut`)

**Collapsed/drawer behavior:** same icon-only rail (~80px) as Admin/Customer on desktop/tablet; live `LiveAuctionCard` sidebar foot preserved.

## D. Hamburger Logic
**Admin / Customer / Shop Owner:**
- Each layout renders the shared `Topbar` → `PortalPageHeader`, which shows a `sidebar-toggle` button on desktop.
- Click once → `sidebarCollapsed` toggles to true → sidebar becomes icon rail.
- Click again → `sidebarCollapsed` toggles to false → labels return.
- The navigation is NEVER removed (`display: none` was removed from the desktop collapsed rule); it always stays as a compact icon rail.
- No page reload, no route reset, no data-fetch reset — collapse is pure local UI state.
- On mobile (<768px), `sidebar-toggle` is hidden and the existing `menu-toggle` slide-out drawer is preserved.

**Toggle button accessibility:** `aria-expanded={!sidebarCollapsed}`, `aria-label="Collapse navigation"` / `"Expand navigation"`, `title` reflects the action.

## E. Active Route Matching
Implemented in `Sidebar.jsx` via `isItemActive(pathname, item)`:
- `end: true` → exact match (e.g. `/admin` → Dashboard only).
- `matchPrefixes` → explicit prefix list for nested routes (e.g. `/admin/users` matches `/admin/users/:id` → Users & Roles stays highlighted).
- Default → `pathname === to || pathname.startsWith(to + '/')` so a parent stays highlighted while a child route is open.

Verified:
- Admin: `/admin/users/42` → Users & Roles active; `/admin/branches/9` → Branches active.
- Customer: `/customer/purchases/11` → My Purchases active (prefix).
- `aria-current="page"` set on the active link.

## F. Tooltips / Accessibility
- Every collapsed nav icon carries `title={item.name}` (native hover tooltip) and `aria-label={item.name}`.
- `aria-current="page"` on the active link.
- Sign Out has `aria-label="Sign Out"` + `title` when collapsed.
- Hamburger: `aria-expanded` + `aria-label` (Collapse/Expand navigation).
- All links/buttons remain keyboard operable (native `<a>` / `<button>`).
- The brand collapses to the compact gem mark only — no clipped words.

## G. Persistence
Role-scoped `localStorage` keys (no cross-role leakage):
- Admin: `atany_admin_sidebar_collapsed`
- Customer: `atany_customer_sidebar_collapsed`
- Shop Owner: `atany_shop_sidebar_collapsed`

State is restored on layout mount via `useEffect` and saved on every toggle. Survives route navigation within a role; does not leak to other roles (verified by role-specific keys).

## H. Responsive Behavior
- **Desktop (>=1200px):** expanded = full sidebar (256px); collapsed = 80px icon rail, labels hidden, content expands to fill.
- **Tablet (768–1199px):** collapsed = 80px icon rail; labels hidden.
- **Mobile (<768px):** existing slide-out drawer preserved; `sidebar-toggle` hidden, `menu-toggle` opens drawer (icons + labels).
- No arbitrary new breakpoints; uses the existing `var(--ease)` cubic-bezier transition (~180ms) on sidebar width.

## I. Files Changed
**Modified:**
- `frontend/src/shared/components/Sidebar.jsx` — collapsed prop, matchPrefixes, tooltips, aria-labels, active matching
- `frontend/src/layouts/AdminLayout.jsx` — icons on all items, persistence, pass collapsed
- `frontend/src/layouts/CustomerLayout.jsx` — persistence, pass collapsed
- `frontend/src/layouts/ShopOwnerLayout.jsx` — persistence, pass collapsed
- `frontend/src/shared/components/PortalPageHeader.jsx` — toggle aria-expanded / aria-label / title
- `frontend/src/index.css` — desktop collapsed now = icon rail (was `display: none`); 80px width, transitions, brand centering, label/heading hiding

**Added:**
- `frontend/src/shared/components/__tests__/Sidebar.test.jsx`
- `frontend/src/layouts/__tests__/AdminLayoutNav.test.jsx`
- `frontend/src/layouts/__tests__/ShopOwnerLayoutNav.test.jsx`

**Extended:**
- `frontend/src/layouts/__tests__/CustomerLayoutSidebar.test.jsx` (icons + collapse)
- `frontend/src/roles/customer/pages/__tests__/MyPurchases.test.jsx` (updated to new accessible aria-label)

**Not changed:** backend (no routes/controllers/services/DB), page content, dashboards, KPI cards, modals, forms, bidding/payment/subscription UI.

## J. Tests
- **Total:** 620 passed / 625 across 45 files (was 604; +21 new navigation tests, all passing).
- **Failures:** 5, all pre-existing subscription/billing selectors (verified failing on the unmodified baseline; unrelated to navigation).
- New coverage: Sidebar collapsed/expanded, icons, labels, tooltips, Sign Out, active nested routes, all three layouts' icons/collapse/persistence.

## K. Build
- `npx vite build` ✓ passed (3.58s), no broken imports, no missing icons, no React errors.

## L. Browser QA
**Not executable in this sandbox:** no Chromium, Firefox, Playwright, or Puppeteer is installed, and no browser-automation tooling is available. Real-browser QA (Admin / Customer / Shop Owner through the UI) could therefore not be executed.

**Verified instead by:**
- Unit tests for all three roles (icons, collapse, labels, active routes, persistence, accessibility).
- `vite build` clean.
- Shared `Sidebar` component is the single navigation implementation used by Admin, Customer, and Shop Owner, so behavior is uniform by construction.

To complete browser QA, run the dev server (`npx vite --port 5178`) and, per role: verify expanded = icon+label, click hamburger → icon rail remains (never blank), navigate via icons, confirm active highlight, expand → labels return, confirm Sign Out works, and confirm collapse state survives route changes.
