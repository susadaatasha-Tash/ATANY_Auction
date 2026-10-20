# ATANY — Gold Jewelry Auction Sale Portal

Role-organized full-stack port of the `ATANY/` legacy flat HTML prototype into `frontend/src/roles/{customer,shop-owner,admin}` + `frontend/src/shared` + `backend/src/{routes,controllers,middleware,services,db}` per requested structure and `atany-system-spec.md`.

## Stack (spec 1)
Frontend: React 18 + Vite + Tailwind + lucide-react + recharts + Leaflet + Supabase JS + socket.io-client
Backend: Node 22 + Express 4 + pg + Supabase + Socket.io + node-cron
DB/Auth/Storage/Realtime: Supabase (PostgreSQL + Auth + RLS)

## Structure

```
frontend/src/
  roles/customer/{pages,components,hooks,routes.jsx}          # 7 pages: Dashboard, LiveAuctions, MyBids, Watchlist, MyPurchases, AccountSettings, BranchLocator
  roles/shop-owner/{pages,components,hooks,routes.jsx}         # 6 pages: Dashboard, MyListings, MyAuctions, SalesPayouts, Notifications, ShopProfile
  roles/admin/{pages,components,hooks,routes.jsx}              # 10 pages: Dashboard, Products, Auctions, Users, Transactions, Analytics, SecurityAlerts, Branches, Notifications, ChatbotLogs
  shared/{components,hooks,lib,ui}                            # Toast, Modal, Sidebar, Topbar, Badge, DataTable, AssistantWidget; useAuth, useAuctionCountdown, useChatbot; apiClient, supabaseClient
  layouts/  CustomerLayout, ShopOwnerLayout, AdminLayout
  pages/    LandingPage (port of atany-landing-page.html), Login, Signup
  App.jsx   RequireRole guards mirroring backend requireRole
backend/src/
  routes/{auth,customer,shop-owner,admin}.routes.js          # mounted behind requireAuth + requireRole
  controllers/{customer,shop-owner,admin}/                    # thin handlers → services
  middleware/{requireAuth.js,requireRole.js}
  services/{bidLogic.js (SERIALIZABLE FOR UPDATE), fraudCheck.js, auctionCloser.js (cron), chatbotService.js (Groq server-only)}
  db/{schema.sql,migrations/001_seed_branches.sql,pool.js}
```

## Build order (spec 6)
1. Auth + roles (single `users` table, `role` enum, RLS) — `Login.jsx`, `Signup.jsx`, `requireAuth/Role`
2. Branches + Products — `admin/pages/Branches` is single source of truth (spec 4.5); `BranchLocator` Haversine client-side
3. Auctions + Bids + Realtime + auctionCloser cron — `bidLogic.js` min increment server-side, winner server-side only (spec 5.1/5.2)
4. Orders + PayMongo sandbox — `ready_pickup` pickup-only, no delivery anywhere (spec 5.5)
5. Notifications (in-app + Resend) — `admin/notification` + `shop-owner/notification`
6. Chatbot — rule KB + Groq fallback server-side only (key never in frontend spec 5.6)
7. Analytics + Security Alerts — real SQL aggregates (spec 4.7), `fraudCheck` server-side (spec 4.2)
8. Polish — legacy CSS fully preserved in `src/index.css` (2134 lines, extracted verbatim from 4 HTML + atany-assistant.js)

## Quick start
```bash
# env
cp frontend/.env.example frontend/.env  # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL=http://localhost:4000
cp backend/.env.example backend/.env    # DATABASE_URL, SUPABASE_*, GROQ_API_KEY, PAYMONGO_*, RESEND_API_KEY

# db
psql $DATABASE_URL -f backend/src/db/schema.sql
psql $DATABASE_URL -f backend/src/db/migrations/001_seed_branches.sql

# dev
cd frontend && npm install && npm run dev  # :5173
cd backend  && npm install && npm run dev  # :4000
```

## Hosting
Frontend on Vercel (`frontend/vercel.json` rewrites SPA), Backend on Render (`backend/render.yaml`), DB/Auth/Storage on Supabase. GitHub push auto-deploys.

## Legacy reference
Original flat files retained at repo root: `admin.html`, `customer-dashboard.html`, `shop-owner-dashboard.html`, `atany-landing-page.html`, `branches.html`, `login.html`, `signup.html`, `atany-assistant.js` — all behaviour preserved and re-assembled into role folders.
