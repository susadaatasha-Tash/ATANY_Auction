# COLLAPSED SIDEBAR ICON REGRESSION — FIXED

## Root Cause

The sidebar disappeared on desktop collapsed mode because **two secondary CSS files overrode the `index.css` fix with `display: none !important`** for the `sidebar-collapsed` state at the desktop breakpoint (`>=1200px`):

1. **`frontend/src/shared/fixed-layout.css`** (Admin & Shop Owner — `.app`, `.admin-app`):
   ```css
   @media (min-width: 1200px) {
     .app.sidebar-collapsed .sidebar,
     .app.customer-app.sidebar-collapsed .sidebar,
     .admin-app.sidebar-collapsed .sidebar { display: none !important; }
   }
   ```

2. **`frontend/src/roles/customer/customer-dashboard.css`** (Customer — `.customer-app`):
   ```css
   @media (min-width: 1200px) {
     .customer-app.sidebar-collapsed .sidebar { display: none !important; }
   }
   ```

These `!important` rules took precedence over the `index.css` icon-rail fix, so clicking the hamburger on desktop removed the sidebar entirely instead of collapsing it to an 80px icon rail.

**Secondary contributing factor**: the JSX layer was already correct — Sidebar is always mounted (`collapsed` changes presentation only, never unmounts the component), and icons are rendered outside the `!collapsed` conditional. The bug was purely in CSS.

## Fix Applied

Replaced the `display: none !important` desktop collapsed rule with an **80px icon rail** (`width: 80px`, `max-width: 80px`, `display: flex !important`) in all three CSS files, plus matching tablet (768–1199px) rules updated from 68px to 80px for consistency. Collapsed state now:

- Keeps the sidebar mounted as a narrow vertical rail (~80px)
- Hides only labels, section headings, and brand text (icons remain visible)
- Centers icons, keeps them clickable and active-highlighted
- Shows tooltips (`title` + `aria-label`) on hover/focus for collapsed icons
- Keeps Sign Out visible
- Reserves 80px for the rail; main content expands to fill the rest

## Shared Sidebar

**`frontend/src/shared/components/Sidebar.jsx`** — the single shared component used by Admin, Customer, and Shop Owner.

- Sidebar is **always mounted**: `<Sidebar collapsed={sidebarCollapsed} />` — never conditionally removed.
- `collapsed={false}` → full width (260px), icons + labels, brand text visible.
- `collapsed={true}` → 80px icon rail, labels/headings/brand-text hidden via CSS, icons remain.
- Icons are rendered **outside** the `!collapsed` conditional (`<Icon />` always renders; only `<span className="nav-label">` is wrapped in `!collapsed`).
- Every nav link keeps `aria-label={item.name}` and `title={collapsed ? item.name : undefined}` for tooltip/accessibility in collapsed state.
- `aria-current="page"` + `.active` class preserved for active state in both modes.
- Sign Out button always rendered with `aria-label="Sign Out"`; icon always visible.

## Admin

- **Collapsed width**: 80px (desktop >=1200 and tablet 768–1199).
- **Visible icons**: Dashboard (`LayoutDashboard`), Branches (`Store`), Users & Roles (`Users`), Orders (`ShoppingBag`), Subscriptions (`CreditCard`), Reports (`BarChart3`), Security Alerts (`ShieldAlert`), Sign Out (`LogOut`).
- **Brand**: ATANY gem mark centered; `ADMIN` tag hidden when collapsed (no clipped words).
- **Persistence key**: `atany_admin_sidebar_collapsed`.
- **Layout file**: `frontend/src/layouts/AdminLayout.jsx` (dark navy + gold theme via `fixed-layout.css`).

## Customer

- **Collapsed width**: 80px.
- **Visible icons**: Dashboard (`Home`), Auctions (`Gavel`), My Bids (`Tag`), Favorites (`Heart`), Watchlist (`Eye`), Branch Locator (`MapPin`), My Purchases (`ShoppingBag`), Sign Out (`LogOut`).
- **Brand**: ATANY gem mark centered; `JEWELRY AUCTION` tag hidden when collapsed.
- **Persistence key**: `atany_customer_sidebar_collapsed`.
- **Layout file**: `frontend/src/layouts/CustomerLayout.jsx`.

## Shop Owner

- **Collapsed width**: 80px.
- **Visible icons**: Dashboard (`LayoutDashboard`), My Listings (`Gem`), My Auctions (`Gavel`), Won Lots & Orders (`Package`), Sales & Payouts (`Receipt`), Subscription (`CreditCard`), Shop Profile (`Store`), Sign Out (`LogOut`).
- **Brand**: ATANY gem mark centered; `SHOP OWNER` tag hidden when collapsed.
- **Persistence key**: `atany_shop_sidebar_collapsed`.
- **Layout file**: `frontend/src/layouts/ShopOwnerLayout.jsx` (sidebar-based architecture preserved; LiveAuctionCard sidebar foot retained).
- **Note**: Shop Owner uses `.app` class, so it is covered by the `fixed-layout.css` fix.

## Desktop vs Mobile

- **Desktop (>=1200px)**: expanded = 260px sidebar with labels; collapsed = 80px icon rail, labels hidden, sidebar **never** removed.
- **Tablet (768–1199px)**: same icon-rail behavior (80px).
- **Mobile (<768px)**: existing slide-out drawer preserved unchanged — `sidebar-toggle` hidden, `menu-toggle` opens full drawer (icons + labels). Drawer open/closed is separate state from desktop collapsed/expanded; they do not leak into each other.

## Hamburger Behavior

- Desktop: click once → collapse to 80px icon rail; click again → expand to full sidebar.
- Never removes the nav; never leaves a blank area.
- `aria-expanded={!sidebarCollapsed}`, `aria-label="Collapse navigation"` / `"Expand navigation"`.
- No page reload, no route reset, no data-fetch reset.

## Persistence

Role-scoped `localStorage` keys (no cross-role leakage):
- Admin: `atany_admin_sidebar_collapsed`
- Customer: `atany_customer_sidebar_collapsed`
- Shop Owner: `atany_shop_sidebar_collapsed`

Stored `true` = 80px icon rail (NOT sidebar removed). State restored on layout mount via `useEffect`, saved on every toggle.

## Files Changed

**Modified:**
- `frontend/src/shared/components/Sidebar.jsx` — always-mounted sidebar, collapsed prop, tooltips, aria-labels, active matching
- `frontend/src/layouts/AdminLayout.jsx` — icons on all items, persistence, pass collapsed
- `frontend/src/layouts/CustomerLayout.jsx` — persistence, pass collapsed
- `frontend/src/layouts/ShopOwnerLayout.jsx` — persistence, pass collapsed
- `frontend/src/shared/components/PortalPageHeader.jsx` — toggle aria-expanded / aria-label / title
- `frontend/src/shared/fixed-layout.css` — **root cause fix**: desktop collapsed = 80px rail (was `display: none`)
- `frontend/src/roles/customer/customer-dashboard.css` — **root cause fix**: desktop collapsed = 80px rail (was `display: none`)
- `frontend/src/index.css` — desktop collapsed = 80px rail (consolidated rule)

**Added:**
- `frontend/src/shared/components/__tests__/Sidebar.test.jsx`
- `frontend/src/layouts/__tests__/AdminLayoutNav.test.jsx`
- `frontend/src/layouts/__tests__/ShopOwnerLayoutNav.test.jsx`

**Extended:**
- `frontend/src/layouts/__tests__/CustomerLayoutSidebar.test.jsx`
- `frontend/src/roles/customer/pages/__tests__/MyPurchases.test.jsx`

**Not changed:** backend (no routes/controllers/services/DB), page content, dashboards, KPI cards, modals, forms, bidding/payment/subscription UI.

## Tests

- **Total**: 620 passed / 625 across 45 files.
- **Failures**: 5, all pre-existing subscription/billing selector tests (verified failing on the unmodified baseline; unrelated to navigation).
- New navigation tests cover: Sidebar collapsed/expanded, icons, labels, tooltips, Sign Out, active nested routes, all three layouts' icons/collapse/persistence.

## Build

- `npx vite build` ✓ passed (3.48s), no broken imports, no missing icons, no React errors.

## Browser Verification

**Not executable via automation** — no Playwright, Puppeteer, or WebDriver is installed in this sandbox, so programmatic browser QA (click hamburger, verify icon rail, navigate routes) could not be performed. Google Chrome.app is present but cannot be driven without automation tooling.

**Source-level verification performed:**
- Confirmed Sidebar is always mounted in all three layouts (no `{!collapsed && <Sidebar />}` pattern).
- Confirmed icons render outside the `!collapsed` conditional in `Sidebar.jsx`.
- Confirmed all three CSS files now render an 80px `display: flex` rail for desktop collapsed state (no `display: none`, no `width: 0`, no off-screen transform).
- The app dev server starts cleanly on port 5178 and Chrome loads the admin route without console errors.

To complete real-browser QA, run `npx vite --port 5178`, open Chrome to `/admin`, `/customer`, and `/shop`, log in with test credentials, click the hamburger, and verify an 80px icon rail remains visible on the left for all three roles.
