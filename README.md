# BudgetWise — Family Plan

A Netflix-style household budget planner. Each family member gets a private,
PIN-protected dashboard under one family subscription.

This repository is the working implementation that backs the BudgetWise
specification documents (Architecture, Use Cases, Requirements, Data Storage,
External API). It is intended for local development and class demonstration.

---

## Architecture (three-tier)

```
┌─────────────────────┐   HTTP/JSON    ┌──────────────────────┐   SQL   ┌──────────────┐
│   React frontend    │ ─────────────▶ │  Node/Express API    │ ──────▶ │  PostgreSQL  │
│   (Vite dev server) │                │  (auth, services)    │         │     16       │
│   localhost:5173    │ ◀───────────── │  localhost:3000      │ ◀────── │  port 5432   │
└─────────────────────┘                └──────────────────────┘         └──────────────┘
       Phase 3 ✓                            Phase 2 ✓                      Phase 1 ✓
```

Layer mapping back to the architecture document:

| Spec layer                       | Implementation                                  |
| -------------------------------- | ----------------------------------------------- |
| 1. Actor                         | Browser users (Admin/Member/Teen/Junior)        |
| 2. Presentation                  | `frontend/src/components/`                      |
| 3. Application (services)        | `backend/src/services/`, `backend/src/routes/`  |
| 4. Domain                        | `backend/src/domain/rules.js` + SQL constraints |
| 5. Infrastructure (DB/Cache/Auth)| `backend/sql/`, `auth.*` schema, in-memory cache|
| 6. External services             | Stubbed for MVP                                 |

---

## Prerequisites

- **Docker Desktop** (for PostgreSQL) — [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
- **Node.js 20+** (for backend and frontend) — [nodejs.org](https://nodejs.org/)

That's it. Postgres runs in a container so nothing native installs on your host.
The backend uses `bcryptjs` (pure JavaScript) so there are no compile tools
needed on Windows/Mac/Linux.

---

## Quick start (full stack)

You'll need **three terminal windows** open.

### Terminal 1 — Database

```bash
cd budgetwise
docker compose up -d              # starts Postgres on :5432
docker compose ps                 # verify "healthy"
```

The schema in `backend/sql/001_schema.sql` is auto-applied on first start.
To wipe and re-apply: `docker compose down -v` then `docker compose up -d`.

### Terminal 2 — Backend API

```bash
cd budgetwise/backend
cp .env.example .env              # first run only
npm install                       # first run only
npm run seed                      # creates the demo Johnson family
npm run dev                       # API on :3000 with hot reload
```

You should see:

```
[startup] DB connection OK (localhost:5432/budgetwise)
[startup] BudgetWise API listening on http://localhost:3000
```

### Terminal 3 — Frontend

```bash
cd budgetwise/frontend
npm install                       # first run only
npm run dev                       # Vite on :5173 with hot reload
```

Open **http://localhost:5173** and you should see the profile selector with
Mom (admin), Dad, Jordan (teen), Sam (junior).

**Default PIN for every member: `1234`**

Mom is admin and bypasses PIN entry per spec §2.1. The other three need
their PIN.

---

## Demo flow walkthrough

1. **Profile selector** — pick any family member's card.
2. **PIN entry** (non-admin only) — enter `1234`. Wrong PIN gives a
   shake animation and counter; 5 wrong attempts triggers a 15-minute
   lockout (verified via integration test).
3. **Dashboard** — four tabs:
   - **Overview** — hero stats with savings rate, recent transactions,
     active goals (data from `GET /api/dashboard/me`, cached 5 min)
   - **Budget** — categories with spend/limit progress bars and OK/
     Warning/Over status badges
   - **Goals** — personal + shared goals with "Add savings" button
   - **Family** — sibling member cards + shared family goals
4. **Add transaction** — modal with description, amount, type, category,
   date. Junior cannot log; Teen restricted to whitelisted categories.
   Over-limit transactions enqueue a notification to the admin.
5. **Import CSV** (Budget tab) — upload a bank statement export. The
   modal previews parsed rows, lets you map columns to fields, and
   imports atomically. Idempotency keys per row prevent duplicate
   imports if you re-run the same file. Click "Download CSV template"
   to get a starting point.
6. **Admin Panel** (admin only) — hero family stats, **plan badge**
   showing Family Pro · $14.99/mo (newly added per HTML mockup),
   members table with edit-limit and nudge actions, shared goals
   create/list, recent notifications.
7. **Switch profile** — top-right button logs out and returns to selector.

---

## API surface

All endpoints under `/api/*`. Successful responses are JSON; errors return
`{"error":"...","details":"..."}` with the appropriate HTTP status.
Authentication is via `Authorization: Bearer <token>` header.

| Method | Path                              | Purpose                                              | Auth     |
| ------ | --------------------------------- | ---------------------------------------------------- | -------- |
| GET    | `/health`                         | Service & DB health                                  | none     |
| GET    | `/api/public/family-summary`      | Profile selector data (no auth required)             | none     |
| POST   | `/api/auth/login`                 | PIN login → token                                    | none     |
| POST   | `/api/auth/admin-login`           | Admin PIN bypass (spec §2.1) → token                 | none     |
| POST   | `/api/auth/logout`                | Revoke current session                               | bearer   |
| GET    | `/api/auth/me`                    | Current member + family                              | bearer   |
| GET    | `/api/family`                     | Family info (plan tier, max members, billing email)  | bearer   |
| GET    | `/api/profiles`                   | All profiles in caller's family                      | bearer   |
| GET    | `/api/profiles/:id`               | One profile                                          | bearer   |
| POST   | `/api/profiles`                   | Create new member                                    | admin    |
| PATCH  | `/api/profiles/:id`               | Update profile (admin = any field; self = whitelist) | bearer   |
| PATCH  | `/api/profiles/:id/pin`           | Set/change PIN                                       | self/admin |
| DELETE | `/api/profiles/:id`               | Remove member (refuses if only admin)                | admin    |
| GET    | `/api/transactions?memberId=`     | List recent transactions                             | bearer   |
| POST   | `/api/transactions`               | Log a transaction (idempotent via key)               | bearer   |
| POST   | `/api/transactions/bulk`          | Bulk import (CSV) with idempotency-skip per row      | bearer   |
| GET    | `/api/budget/categories?memberId=`| List budget categories                               | bearer   |
| POST   | `/api/budget/categories`          | Create category                                      | bearer   |
| PATCH  | `/api/budget/categories/:id`      | Update category                                      | bearer   |
| DELETE | `/api/budget/categories/:id`      | Delete category                                      | bearer   |
| POST   | `/api/budget/reset`               | Reset all amount_spent (new month)                   | bearer   |
| GET    | `/api/goals?memberId=`            | Goals visible to a member                            | bearer   |
| GET    | `/api/goals/family`               | Family-shared goals                                  | bearer   |
| POST   | `/api/goals`                      | Create goal (set `isShared: true` for family-wide)   | bearer   |
| POST   | `/api/goals/:id/contribute`       | Add to current_amount                                | bearer   |
| PATCH  | `/api/goals/:id/archive`          | Soft-delete (owner only)                             | bearer   |
| GET    | `/api/notifications`              | Caller's inbox                                       | bearer   |
| POST   | `/api/notifications`              | Send a nudge                                         | admin    |
| POST   | `/api/notifications/:id/read`     | Mark read                                            | bearer   |
| GET    | `/api/dashboard/me`               | Personal dashboard payload (cached 5 min)            | bearer   |
| GET    | `/api/dashboard/member/:id`       | Another member's dashboard (admin only)              | admin    |
| GET    | `/api/dashboard/family`           | Family-level rollup (Admin Panel hero stats)         | bearer   |

---

## Verification & testing

Four automated test scripts cover **91 tests total**, all passing:

```bash
# Backend smoke test — exercises every endpoint, role boundary, and edge case
cd backend && bash test-api.sh                      # 33 tests

# Frontend-flow integration test — simulates the full UI workflow against
# the live API to verify request/response shapes match
cd ..                                                # repo root
node test-frontend-flow.mjs                          # 18 tests

# CSV parser unit test — exercises the parsing edge cases (quoted commas,
# escaped quotes, BOM, date formats, currency parsing)
node test-csv-parser.mjs                             # 28 tests

# CSV import end-to-end test — raw CSV → parse → bulk POST → DB verify,
# including idempotency, role enforcement, and atomic rejection
node test-csv-e2e.mjs                                # 12 tests
```

The CSV tests can run any time the API is up. The parser test needs no API.
For the API-dependent tests, run a `npm run reset-and-seed` first for clean state.

What's covered:

- Auth: PIN login, wrong PIN counter, 15-min lockout after 5 attempts,
  admin PIN bypass, logout invalidation
- Member isolation: Dad cannot view Mom's transactions, etc.
- Idempotency: duplicate single-tx returns 409; bulk re-imports skip per row
- Junior cannot log transactions (manual or via CSV); Teen restricted to
  whitelisted categories
- Cache invalidation: dashboard refreshes after a transaction posts
- Plan-tier `max_members` enforcement
- Cascade deletes via FK constraints
- CSV parsing: quoted commas, escaped quotes, UTF-8 BOM, multiple date
  formats, parenthesised negatives, currency symbols
- Bulk import atomicity: any invalid row rejects the whole batch; per-row
  unique-key conflicts use SAVEPOINT to skip cleanly without aborting

---

## Project layout

```
budgetwise/
├── README.md
├── docker-compose.yml
├── test-frontend-flow.mjs           # integration test
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── test-api.sh                  # backend smoke test
│   ├── sql/
│   │   └── 001_schema.sql           # full schema, auto-applied
│   └── src/
│       ├── index.js                 # entry point
│       ├── server.js                # express app construction
│       ├── config.js                # env loading
│       ├── db.js                    # pg pool + tx helper
│       ├── domain/
│       │   └── rules.js             # validation, role config, helpers
│       ├── middleware/
│       │   ├── auth.js              # session token validation
│       │   ├── errors.js            # HttpError class
│       │   └── errorHandler.js      # final JSON error formatter
│       ├── routes/                  # 7 thin HTTP shims
│       │   ├── auth.js · family.js · transactions.js · budget.js
│       │   ├── goals.js · notifications.js · dashboard.js
│       ├── services/                # 8 business-logic modules
│       │   ├── authService.js · familyService.js
│       │   ├── transactionService.js · budgetService.js
│       │   ├── goalsService.js · notificationService.js
│       │   ├── dashboardService.js · cacheService.js
│       └── scripts/
│           └── seed.js              # idempotent demo seeder
└── frontend/
    ├── package.json
    ├── vite.config.js               # API proxy config
    ├── index.html
    ├── .env.example
    └── src/
        ├── main.jsx · App.jsx       # entry + screen router
        ├── api/                     # 8 API client modules
        │   ├── client.js            # fetch wrapper, token mgmt
        │   ├── auth.js · profiles.js · transactions.js
        │   ├── budget.js · goals.js · notifications.js · dashboard.js
        ├── domain/
        │   └── roles.js             # UI role config (colors, icons)
        └── components/              # 6 React components
            ├── ProfileSelector.jsx
            ├── PINScreen.jsx
            ├── OnboardingScreen.jsx
            ├── DashboardScreen.jsx
            ├── AdminPanel.jsx
            └── shared.jsx           # Modal, Toast, FormField
```

---

## Notes on scope

This implementation aims for a faithful match to the BudgetWise specification
documents, with a few pragmatic deviations for a local dev / class context:

- **Row-Level Security** policies (Data Storage spec §6) are enforced at the
  API layer rather than via PostgreSQL `CREATE POLICY` statements. Every
  query filters by `member_id` against the authenticated session and a
  middleware (`assertMemberInFamily`) verifies cross-member access. RLS can
  be layered on later without changing the schema.
- **Redis** (spec §5) is replaced by an in-memory `cacheService` for
  development. Same key shape (`dash:{memberId}`), same TTL semantics, so
  swapping in real Redis is a one-file change later.
- **bcryptjs** is used instead of native **bcrypt** for portability (no
  build tools required). PIN cost factor is still 12 per spec. Login latency
  is ~330ms.
- **AI insights** (OpenAI integration, External API doc §3) are not yet
  implemented. The `insights_cache` table exists; the rule-based fallback
  from the JSX prototype will be ported in a later phase.
- **`shared_goal_contributors`** table exists per spec but is not wired into
  any UI yet — reserved for a future per-member contribution-tracking
  feature.
- **Reset Demo Data** in the UI shows a confirm dialog instructing you to
  run `npm run reset-and-seed` in the backend. Direct frontend wipe would
  need an admin-only `/api/admin/reset` endpoint, which we deliberately
  haven't exposed.

### Things newly added in Phase 3

- **Plan badge on Admin Panel** — was in the HTML mockup but missing from
  the JSX prototype. Now displays plan tier, member cap, price, and "Alerts
  active" status block.
- **Public family-summary endpoint** — needed because the profile selector
  renders before any login, and every other endpoint requires auth. Returns
  only id/name/role/spent (no email, no income, no PII).
- **Server-computed dashboard** — replaces the JSX prototype's per-render
  `reduce()` chains with a single `GET /api/dashboard/me` call that returns
  a fully-shaped payload with totals, status, and progress percentages.

---

## Database connection

Default development credentials (see `docker-compose.yml`):

```
host:     localhost
port:     5432
database: budgetwise
user:     budgetwise
password: budgetwise_dev
```

Direct psql access:

```bash
docker exec -it budgetwise-db psql -U budgetwise -d budgetwise
```

The backend reads these from `backend/.env`.

---

## Demo PINs

| Member  | Role   | PIN          |
| ------- | ------ | ------------ |
| Mom     | admin  | (PIN bypass) |
| Dad     | member | 1234         |
| Jordan  | teen   | 1234         |
| Sam     | junior | 1234         |

Reset and re-seed any time with `npm run reset-and-seed` in `backend/`.
