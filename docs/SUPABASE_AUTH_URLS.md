# Supabase Authentication — URL Configuration for ATANY

This project uses Supabase Auth email confirmation with canonical public URL:

```js
const appOrigin = import.meta.env.VITE_APP_URL || window.location.origin;
await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo: `${appOrigin.replace(/\/$/, '')}/auth/callback`
  }
})
```

- `VITE_APP_URL` (set in `frontend/.env` / `.env.example`) is the **canonical public origin** that will appear in confirmation emails.
- Falls back to `window.location.origin` if `VITE_APP_URL` not set — still no hardcoded `localhost`.
- `replace(/\/$/, '')` prevents double slash (`http://localhost:5178/` → `http://localhost:5178/auth/callback`).

Why not just `window.location.origin`?
- Signup on `localhost` → email opened on phone → link points to `localhost` → phone points to itself → **fails**.
- With `VITE_APP_URL`, signup on desktop still generates a link that works on any device if `VITE_APP_URL` is the public URL.

Configure `VITE_APP_URL` per environment:

- Desktop development: `VITE_APP_URL=http://localhost:5178`
- LAN/mobile testing: `VITE_APP_URL=http://192.168.1.xxx:5178` (your machine IP, no hardcoded example IP)
- Production: `VITE_APP_URL=https://atany.ph` (or `https://your-domain.com`)

Supabase Dashboard → Authentication → URL Configuration must allow all origins that will send confirmation emails.

---

## 1. Site URL

Set to your canonical production URL:

```
https://your-domain.com
```

For local development, Site URL can remain production — Redirect URLs (below) handle localhost.

---

## 2. Redirect URLs (Allow List)

Add **all** URLs that Supabase may redirect to after email confirmation. Must include:

### Localhost (desktop)
```
http://localhost:5178/auth/callback
http://localhost:5178
http://localhost:3000/auth/callback   # if you ever run on 3000
```

### LAN / Mobile Testing (Vite --host)
Vite exposes your LAN IP when run as `npm run dev -- --host`. Find your IP via `ipconfig getifaddr en0` (macOS) or `ipconfig` (Windows).

Example if your machine is `192.168.1.100`:
```
http://192.168.1.100:5178/auth/callback
http://192.168.1.100:5178
http://192.168.0.15:5178/auth/callback   # add each IP you test with
```

Wildcards are **not** supported — list each IP/port explicitly.

### Production
```
https://your-domain.com/auth/callback
https://your-domain.com
https://www.your-domain.com/auth/callback  # if you use www
```

### Current ATANY settings
- Frontend dev: `VITE_APP_URL=http://localhost:5178` (`frontend/.env.example`)
- LAN/mobile: `VITE_APP_URL=http://192.168.1.xxx:5178` (set to your LAN IP, e.g. `http://192.168.1.50:5178`)
- Production: `VITE_APP_URL=https://atany.ph`
- Callback route: `/auth/callback` (public, no auth required)
- `VITE_API_URL` stays as API base (`http://localhost:4000` or tunnel URL) — **not** used for `emailRedirectTo`

---

## 3. How to update in Supabase

1. Supabase Dashboard → Your project → Authentication → URL Configuration
2. Set **Site URL** to production
3. Under **Redirect URLs**, add the list above (one per line)
4. Save

---

## 4. Verification

After configuring:

1. Sign up as new customer on desktop (`http://localhost:5178/signup`) — check email link points to `http://localhost:5178/auth/callback?code=...` (not `localhost:4000`)
2. Same on mobile via LAN IP (`http://192.168.1.100:5178/signup`) — link should be `http://192.168.1.100:5178/auth/callback`
3. Click link → should land on ATANY `/auth/callback` loading state, then redirect to `/login`
4. Invalid/expired link → shows `Confirmation failed` with links to `/login` and `/signup` (no raw token logged)

---

## 5. Why `window.location.origin`?

- No hardcoded `http://localhost:4000/auth/callback` (was backend URL, wrong)
- No hardcoded `http://localhost:5178` (fails on mobile/production)
- Uses current browser origin, so same build works on desktop, phone via LAN, and production
- Supabase validates `emailRedirectTo` against Redirect URLs allow-list — if not listed, Supabase falls back to Site URL

---

## 6. Do not configure Resend SMTP here

This task is Supabase Auth email confirmation flow only. Resend transactional `emailService.js` (`RESEND_FROM_EMAIL`) stays separate and is not Supabase Auth SMTP.

