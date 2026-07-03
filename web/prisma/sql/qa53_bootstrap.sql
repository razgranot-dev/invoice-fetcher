-- qa53_bootstrap.sql
-- Idempotent, out-of-band DDL that `prisma generate` (the Vercel build step)
-- does NOT apply. Run against the target DATABASE_URL at/before every deploy:
--
--     npm run db:push        # syncs columns declared in schema.prisma
--     npm run db:bootstrap   # applies this file (partial index + belt-and-suspenders columns)
--
-- Every statement is guarded with IF NOT EXISTS so it is safe to re-run on an
-- already-migrated database (e.g. the existing Neon prod DB). PostgreSQL only.

-- ── (a) Columns declared in schema.prisma ────────────────────────────────
-- Canonical source of these columns is schema.prisma (reproduced by db:push).
-- Re-declared here defensively so a fresh env that only ran `prisma generate`
-- (Vercel build) does not 500 with P2022 "column does not exist".

-- Invoice.supplierKey  String?  → nullable text
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "supplierKey" TEXT;

-- Invoice.reportStatusManual  Boolean @default(false)
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "reportStatusManual" BOOLEAN NOT NULL DEFAULT false;

-- Scan.updatedAt  DateTime @default(now()) @updatedAt  → timestamp(3), not null
ALTER TABLE "scans" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ── (b) Partial unique index (NOT expressible in Prisma DSL) ──────────────
-- Backs the M2 atomic dedupe: at most one PENDING/RUNNING scan per org.
-- This exists in NO Prisma artifact — schema.prisma only documents it in a
-- comment — so it MUST be applied here.
CREATE UNIQUE INDEX IF NOT EXISTS "one_active_scan_per_org"
  ON "scans" ("organizationId")
  WHERE status IN ('PENDING', 'RUNNING');
