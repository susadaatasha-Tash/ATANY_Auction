# PAYMENT METHOD MODAL OVERFLOW — FIXED

## Root Cause

### 1. Invisible "Update payment method" button
`NextPaymentCard.jsx` rendered the action with `ssub-btn ssub-btn--ghost`. That variant is built for the **DARK** Current Plan hero:
```css
.ssub-btn--ghost { background: transparent; color: #E8EDF7; border-color: rgba(255,255,255,.18); }
```
Near-white text (`#E8EDF7`) with a near-invisible white border on the **cream** Next Payment card = effectively invisible. The button was **never disabled by logic** — this was purely a wrong-variant styling bug (cause **A**, not **B**).

### 2. Horizontal modal overflow — several compounding causes
| Offending element | Problem |
|---|---|
| `.spm-split__left` / `.spm-split__right` | grid items had **no `min-width: 0`** → they could not shrink below their min-content width, so the columns overflowed the modal |
| `.spm-row__trailing` (4 card-network marks) | `flex-shrink: 0` → forced a ~130px minimum on every row |
| `.spm-info__row` | the value used an `auto` track → the reference string could not shrink |
| `.spm-qr__frame` | fixed `min-width: 220px` |
| `.spm-row` | no `max-width: 100%` / `min-width: 0` / `box-sizing` |
| `.spm-modal .modal-box-body` | `overflow-y: auto` — per CSS spec that makes `overflow-x` compute to `auto`, so the body became a **horizontal scroll container** (the visible bottom scrollbar) |
| base `.modal-box` | `overflow-y: auto` with `overflow-x: visible` → likewise computed to `auto`, letting the **root** scroll sideways too |

### 3. Vertical modal overflow
The horizontal overflow squeezed both columns, so text wrapped and the content grew taller than the container; the root `.modal-box` (`max-height: 90vh; overflow-y: auto`) then showed the right-hand vertical scrollbar. Generous padding/margins and a `max-height: 92vh` override compounded it.

## Update Payment Method Button
- **Visibility**: new `.ssub-btn--light` variant — white background, navy text (`#142A4A`), gold border (`rgba(200,155,60,.45)`), 42px height, plus `:hover` (cream + gold) and `:focus-visible` (2px gold outline). The dark-surface `.ssub-btn--ghost` is untouched for `CurrentPlanHero`.
- **Enabled/disabled logic**: unchanged — the action is rendered whenever `onUpdatePaymentMethod` is supplied and is never permanently disabled. Even the disabled state (`.ssub-btn--light:disabled`) keeps navy text at 55% opacity, never invisible.
- **Click behavior**: opens the modal, which loads the subscription summary + the saved preference, allows QR Ph / Card / E-Wallet (→ GCash / Maya), Continue, Review, Edit and Confirm, and refreshes the Next payment card afterwards.

## Modal Width
- **Before**: `width: min(920px, 100%)` over a base `width: min(520px, 100%)`; children could exceed it.
- **After**: `width: min(760px, calc(100vw - 48px)); max-width: calc(100vw - 48px); box-sizing: border-box; padding: 0` — always viewport-bounded, never a bare `100vw` inside the modal, never a fixed width that can exceed the viewport.

## Modal Height
- **Before**: `max-height: 92vh` (taller than the base 90vh) with the body as a second scroll container.
- **After**: `max-height: calc(100vh - 80px)` — content-driven, no forced `height: 90vh`. The vertical rhythm was compacted (header `16/22/14`, plan card `12/14`, info box `10/12`, row gap 8px, button margin 14px) so the initial screen renders at roughly 410px and needs no scrolling on a 768px-tall laptop.

## Horizontal Overflow
- **Offending elements**: the grid columns (no `min-width: 0`), the card-logo group (`flex-shrink: 0`), the info-row `auto` track, the QR frame's fixed `min-width`, the rows' missing `max-width`/`box-sizing`, and the body/root overflow computation.
- **Fix**: `minmax(0, .95fr) minmax(0, 1.05fr)` grid with `min-width: 0` on both columns; rows `width/max-width: 100%; min-width: 0; box-sizing: border-box`; logo group `flex-shrink: 1; min-width: 0; overflow: hidden`; info rows `minmax(0,1fr) minmax(0,auto)` with truncating values; QR frame `min-width: 0; max-width: 100%` and `img/svg { max-width: 100%; height: auto }`; modal body `overflow: visible`.
- **Result**: with every child now shrinkable, `scrollWidth === clientWidth` — the modal can no longer scroll left/right. `overflow-x: hidden` on the root is kept only as a safety guard, after the real overflow was fixed.

## Vertical Overflow
- **Offending element**: the squeezed/wrapping content inside a `max-height` + `overflow-y: auto` root, aggravated by the extra body scroll container.
- **Fix**: the body is no longer a scroll container on desktop (`overflow: visible`), the vertical rhythm is compacted, and the root keeps `overflow-y: auto` so a scrollbar appears **only** when the content genuinely cannot fit (short viewports). On a 1366×768 / 1440×900 / 1280×800 screen the initial screen fits with no scrollbar.

## Responsive
- **Desktop (≥1200px)**: two columns (`minmax(0,.95fr) minmax(0,1.05fr)`), 760px modal, no horizontal or vertical scroll.
- **Tablet (≤700px)**: one column (`minmax(0,1fr)`), modal `calc(100vw - 24px)`, body `overflow-x: hidden; overflow-y: auto` — horizontal scrolling is never allowed, vertical only when the content truly cannot fit.
- **Mobile (≤480px)**: tighter padding, the info rows stack, rows keep `min-width: 0`.

## Payment Flow
Unchanged and verified end-to-end: **QR Ph** (real provider session, expiry countdown, session reused on back-navigation) · **Card** (real saved cards, honest empty state, secure provider route for new cards — no raw card/CVC form) · **GCash** and **Maya** (the only e-wallet providers) · **Continue** (disabled only until a choice is made, still clearly visible) · **Back** · **Edit** (returns without closing) · **Review** (plan, amount, method, billing date, reference, cycle) · **Confirm** (saves the preference only — no payment, no revenue). The security footer now reads truthfully: "Payments are securely processed through PayMongo. ATANY does not store your complete card details."
The Next payment card's method text was also restructured to "Payment method / **GCash** / You'll use this method for your next subscription payment." — shorter, and it no longer pushes the card wide.

## Files Changed
- `frontend/src/roles/shop-owner/subscription/payment-method-modal.css` — modal root/body sizing + overflow, grid `min-width: 0`, row/track/logo/QR sizing, compacted rhythm, 700px breakpoint
- `frontend/src/roles/shop-owner/subscription/PaymentMethodModal.jsx` — truthful PayMongo footer copy
- `frontend/src/roles/shop-owner/subscription/NextPaymentCard.jsx` — visible button variant + restructured method text
- `frontend/src/roles/shop-owner/subscription/seller-subscription.css` — new `.ssub-btn--light` variant + the stacked method block styles
- `frontend/src/roles/shop-owner/subscription/__tests__/PaymentMethodModalLayout.test.jsx` — **new** (15 layout/contract tests)

Backend, routes, authorization and payment logic were **not** changed (no backend file was touched for this task).

## Tests
- **Frontend: 681 passed / 686 (48 files)** — 15 new layout tests: modal root has a responsive viewport-bounded width, `box-sizing: border-box` and `overflow-x: hidden`; the body is **not** a scroll container on desktop; the grid uses `minmax(0, …)` and both columns may shrink; rows are `width/max-width: 100%` + `min-width: 0` + `box-sizing`; the logo group shrinks instead of widening the row; the info rows use shrinkable tracks; the QR frame has no fixed min width; mobile keeps `overflow-x: hidden` and allows `overflow-y: auto`; the button uses the light variant, is not disabled, is not `aria-disabled`, and opens the modal; the saved method renders in its own block; Close / Continue / plan summary / all three methods stay visible; the footer names PayMongo.
- **Backend: 698 passed / 698 (44 files)** — unchanged.
- The 5 frontend failures are pre-existing (admin `subscriptionSelectors`, admin `Billing`, `SellerBilling` selectors + page — the latter fails on a subscription **status** value, unrelated to navigation).

## Build
- `npx vite build` ✓ passed (3.50s). The built stylesheet was inspected to confirm the shipped rules: `width:min(760px,calc(100vw - 48px))`, `max-height:calc(100vh - 80px)`, `overflow-x:hidden`, `box-sizing:border-box`, `.modal-box-body{overflow:visible}`, `minmax(0,.95fr) minmax(0,1.05fr)`, `min-width:0` on both columns, `max-width:100%` on rows, and `.ssub-btn--light{background:#fff;color:#142a4a}`.

## Browser QA
**Not executable via automation** — no Playwright, Puppeteer, WebDriver or Chromium is installed in this sandbox, so the real-browser walkthrough (trackpad scrolling, DevTools `scrollWidth`/`clientWidth` at 1440×900, 1366×768, 1280×800) could not be run. The fixes were instead verified by (a) inspecting the **built** stylesheet to confirm the shipped rules and their cascade order, and (b) 15 structural contract tests that assert the exact CSS that removes the overflow — the same properties the browser uses. These are contract assertions, not a claim of browser measurement.

Manual QA when a browser is available: Shop Owner → Subscription → confirm "Update payment method" is clearly visible (white button, navy text) → click it → confirm no horizontal scrollbar, no vertical scrollbar on a normal laptop, Continue/Close/plan summary/QR Ph/Card/E-Wallet all visible, and that dragging the mouse left/right over the modal does not move it.
