# Invoice Fetcher — SaaS Migration

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Next.js (Vercel)                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  React UI    │  │  API Routes  │  │  Auth.js     │  │
│  │  (Tailwind)  │  │  (Next.js)   │  │  (Google)    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│  ┌──────┴─────────────────┴─────────────────┴───────┐  │
│  │              Prisma ORM                           │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │                               │
└─────────────────────────┼───────────────────────────────┘
                          │
                   ┌──────┴──────┐
                   │  PostgreSQL  │
                   │  (Vercel/    │
                   │   Neon/      │
                   │   Supabase)  │
                   └─────────────┘
                          │
              ┌───────────┴───────────┐
              │  Python Worker        │
              │  (Vercel Serverless   │
              │   or separate API)    │
              │                       │
              │  - Gmail API client   │
              │  - Invoice classifier │
              │  - Amount extractor   │
              │  - Body parser        │
              │  - Attachment handler │
              └───────────────────────┘
```

## Current Streamlit App → SaaS Mapping

### Business Logic (kept in Python)

| Module | Purpose | Migration Status |
|--------|---------|-----------------|
| `core/gmail_connector.py` | Gmail OAuth + API | Keep as Python worker |
| `core/invoice_classifier.py` | Multi-signal scoring (500+ lines) | Keep — too complex to rewrite |
| `core/amount_extractor.py` | Hebrew+English amount regex | Keep |
| `core/body_parser.py` | HTML/text extraction | Keep |
| `core/attachment_handler.py` | File dedup + save | Keep |
| `core/email_filter.py` | IMAP filtering (legacy) | Deprecate — Gmail API replaced this |
| `core/screenshot_renderer.py` | Chrome headless screenshots | Keep (optional) |
| `core/word_exporter.py` | Word doc generation | Keep |

### UI (rebuilt in React)

| Streamlit Component | Next.js Equivalent |
|--------------------|--------------------|
| `dashboard/welcome_screen.py` | `(auth)/login/page.tsx` |
| `dashboard/components.py` (scan composer) | `(app)/scans/page.tsx` |
| `dashboard/components.py` (results table) | `(app)/invoices/page.tsx` |
| `dashboard/analytics.py` | `(app)/dashboard/page.tsx` (charts) |
| `dashboard/export_workbench.py` | `(app)/exports/page.tsx` |
| `dashboard/_styles.py` | `globals.css` + Tailwind |

### New SaaS Features (not in Streamlit)

- Multi-tenant organizations
- Persistent scan history
- Team member management
- Billing / plans
- API access
- Settings page

## Python Worker Strategy

**Recommendation: Keep Python as a separate microservice.**

Reasons:
1. Gmail API Python client is production-tested
2. Invoice classifier is 471 lines of Hebrew+English regex/scoring — rewriting in TS would be error-prone
3. Amount extractor relies on Hebrew currency patterns tuned for ILS/NIS
4. Can deploy as Vercel Python serverless function or separate FastAPI service

### Worker API (Phase 2)

```
POST /api/worker/scan
  Body: { connectionId, keywords, daysBack, unreadOnly }
  Returns: { scanId }

GET  /api/worker/scan/:id/status
  Returns: { status, progress, processedCount, totalMessages }

GET  /api/worker/scan/:id/results
  Returns: { invoices: [...] }

POST /api/worker/export
  Body: { invoiceIds, format: "csv" | "word" | "zip" }
  Returns: { exportId, downloadUrl }
```

## Phase Plan

### Phase 1 (done)
- [x] Audit current codebase
- [x] Scaffold Next.js app in `web/`
- [x] Prisma schema for multi-tenant SaaS
- [x] App shell: sidebar, topbar, mobile nav
- [x] All product pages (dashboard, scans, invoices, exports, settings, billing)
- [x] Design system: tokens, components, typography
- [x] Empty states and layout structure

### Phase 2
- [ ] Auth.js setup with Google provider
- [ ] Prisma database connection (Neon/Supabase)
- [ ] Gmail OAuth flow (store tokens in DB)
- [ ] Python worker FastAPI service
- [ ] Scan API route → Python worker
- [ ] Real-time scan progress (SSE or polling)

### Phase 3
- [ ] Invoice list with real data
- [ ] Search and filtering
- [ ] Company-based grouping
- [ ] Invoice detail view
- [ ] Charts / analytics

### Phase 4
- [ ] Export center (CSV, Word, ZIP)
- [ ] Scan history
- [ ] Team invites and roles
- [ ] Billing integration (Stripe)
- [ ] API key management

## File Structure

```
web/
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── .env.example
├── .gitignore
├── MIGRATION.md
├── prisma/
│   └── schema.prisma
└── src/
    ├── app/
    │   ├── layout.tsx          # Root layout
    │   ├── page.tsx            # Redirect → /dashboard
    │   ├── globals.css         # Design tokens + Tailwind
    │   ├── (auth)/
    │   │   ├── layout.tsx      # Centered auth layout
    │   │   └── login/page.tsx  # Google login
    │   └── (app)/
    │       ├── layout.tsx      # Sidebar + topbar shell
    │       ├── dashboard/page.tsx
    │       ├── scans/page.tsx
    │       ├── invoices/page.tsx
    │       ├── exports/page.tsx
    │       ├── settings/page.tsx
    │       └── billing/page.tsx
    ├── components/
    │   ├── ui/
    │   │   ├── button.tsx
    │   │   └── badge.tsx
    │   ├── layout/
    │   │   ├── sidebar.tsx
    │   │   ├── topbar.tsx
    │   │   └── mobile-nav.tsx
    │   └── shared/
    │       ├── stat-card.tsx
    │       ├── empty-state.tsx
    │       └── page-header.tsx
    └── lib/
        ├── utils.ts
        └── db.ts
```

## Database

PostgreSQL via Neon (recommended for Vercel) or Supabase.

```bash
cd web
cp .env.example .env
# Set DATABASE_URL, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_SECRET
npx prisma db push
```

## Development

```bash
cd web
npm install
npm run dev
# → http://localhost:3000
```
