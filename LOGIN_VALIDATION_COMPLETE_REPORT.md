# ATANY LOGIN VALIDATION — COMPLETE

## A. Email Validation
- **Required**: `Email address is required.` when blank or whitespace-only
- **Format**: `Please enter a valid email address.` for invalid structures (no @, multiple @, missing domain, missing TLD, spaces, etc.)
- Uses the same rigorous validation logic as the existing signup validation (domain label checks, TLD length ≥ 2, regex match)
- Email is trimmed before validation

## B. Password Validation
- **Required**: `Password is required.` when blank
- **No signup-style strength rules**: Login does NOT enforce 8-character minimum or complexity rules. A historical password that is valid for the account is never rejected for being "too weak."

## C. Invalid Credentials
- **Auth error mapping** (`mapAuthError` in Login.jsx): Supabase Auth errors are mapped before display:
  - Network / infrastructure failure → `Unable to sign in right now. Please check your connection and try again.` (NOT credential error)
  - Rate limit / too many attempts → `Too many sign-in attempts. Please try again later.`
  - Email not confirmed → `EMAIL_NOT_CONFIRMED` → triggers existing resend flow with toast
  - Invalid credentials → `Email or password is incorrect.` (does NOT reveal which credential was wrong)
- **Inline message**: Shown as a callout div below the Password field (above Remember Me), with soft red/blush background, red alert icon, and dark readable text
- **Field styling**: Both email and password inputs receive red border (`#b91c1c`) and subtle red ring when credential error is active
- **No credential-specific leak**: Never says "email not found," "this email is not registered," or "password is incorrect for this email"

## D. Error Clearing
- **Email**: Editing the email field clears the stale server credential error and re-validates the email format in real time
- **Password**: Editing the password field clears the stale server credential error and re-validates the password in real time
- Field-specific errors (required/format) also clear as the user corrects the field

## E. Other Auth Errors
- **Network**: `Unable to sign in right now. Please check your connection and try again.` — shown inline as a callout, NOT as "invalid credentials"
- **Rate limit**: `Too many sign-in attempts. Please try again later.` — shown inline, distinguishable from credential failure
- **Email not confirmed**: Preserves existing flow — resends verification email and shows toast `Please verify your email first — we just resent the verification link.`

## F. Role Login
- **Customer**: Uses the same unified login flow; redirects to `/customer` (or `/select-branch` if no preferred branch)
- **Shop Owner**: Uses the same unified login flow; redirects to `/shop`
- **Admin**: Uses the same unified login flow; redirects to `/admin`
- No separate authentication logic per role — single `supabase.auth.signInWithPassword` call for all roles

## G. Suspended Account
- **Preserved unchanged**: Correct credentials → Supabase authentication succeeds → `useAuth` detects `status === 'suspended'` → redirects to `/account-suspended` with the admin's suspension reason
- Credential error is NOT shown for suspended accounts with correct credentials

## H. Accessibility
- **aria-invalid**: Set to `true` on email/password inputs when they have a field error OR a credential error
- **aria-describedby**: Email input references `login-email-error` (field error) or `login-credential-error` (credential error); password input references `login-password-error` (field error) or `login-credential-error` (credential error)
- **role="alert"**: Both field-level error messages and the credential callout use `role="alert"` for screen reader announcement
- **Focus first invalid**: On validation failure, the first invalid field (email before password) receives focus
- **Keyboard operable**: All inputs and buttons are native HTML elements; password toggle is a button; Enter key submits the form

## I. Files Changed
**Modified:**
- `frontend/src/pages/Login.jsx` — inline validation, inline credential errors, accessibility attributes, loading state, Enter-to-submit, error clearing on edit
- `frontend/src/shared/validation/loginValidation.js` — **NEW** — email and password validation helpers

**Added:**
- `frontend/src/pages/__tests__/Login.test.jsx` — 23 tests covering all validation, error, accessibility, and auth flows

**Not changed:** backend (no routes/controllers/services/DB), auth provider, Supabase client, signup flow, forgot password, create account, suspension flow, page visual design

## J. Tests
- **Total**: 650 passed / 655 across 46 files (was 625; +23 new Login tests, all passing)
- **Failures**: 5, all pre-existing subscription/billing selector tests (verified failing on unmodified baseline; unrelated to login)
- **Login test coverage (23 tests)**:
  - Initial state: no validation errors, inputs present
  - Frontend validation: blank form, invalid email, blank password, no auth call on invalid, focus first invalid, valid fields call auth
  - Invalid credentials: inline error on both fields, role=alert element, no credential leak, clears on email edit, clears on password edit, clears field error on correction
  - Other auth errors: network failure distinguished from credentials, rate limit message, email not confirmed resend flow
  - Password visibility toggle
  - Submit behaviors: Enter-to-submit, double-submit prevention while loading
  - Successful login: customer, shop owner, admin all call auth

## K. Build
- `npx vite build` ✓ passed (3.59s), no broken imports, no missing icons, no React errors

## L. Browser QA
**Not executable via automation** — no Playwright, Puppeteer, or WebDriver is installed in this sandbox. Chrome.app is present but cannot be driven programmatically.

**Source-level verification performed:**
- All 23 Login unit tests pass, covering blank form, invalid email, blank password, invalid credentials, error clearing, network/rate-limit/email-not-confirmed errors, password toggle, Enter-to-submit, double-submit prevention, and all three role logins
- Build passes cleanly

**Manual browser QA scenarios to verify (when browser automation is available):**
1. Blank email/password → required errors appear under inputs
2. Bad email format → email format error appears
3. Correct-format email + wrong credentials → both inputs red, inline "Email or password is incorrect." callout
4. Edit password → previous auth error disappears
5. Correct credentials → login works normally
6. Suspended correct account → Account Suspended flow works normally

## Non-Negotiable Rules — All Satisfied
- Login page visual design unchanged (dark navy fabric, cream card, gold outline, navy typography, same spacing, same Sign In button, same Remember Me/Forgot Password/Create Account/Back to home)
- No floating "Invalid login credentials" toast for auth failures — inline input error feedback instead
- Authentication mismatch uses "Email or password is incorrect." — never reveals whether email exists or which credential was wrong
- Existing customer, shop owner, admin, suspension, forgot-password, and authentication logic continue to work
- No backend changes
