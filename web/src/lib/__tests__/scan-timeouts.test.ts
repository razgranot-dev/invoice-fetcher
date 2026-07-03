/**
 * H6 regression guard — the scan timeout chain must stay ordered:
 *
 *   progress-write throttle (1s)
 *     < STALE_PROGRESS_MS (3 min recovery cutoff)
 *     < SCAN_DISPATCH_TIMEOUT_MS (270s fetch abort)
 *     < route maxDuration (300s Vercel deadline)
 *     < SCAN_HARD_TIMEOUT_MS (15 min startedAt fallback)
 *
 * If the dispatch timeout ever creeps back above maxDuration, Vercel kills
 * the after() callback before the abort fires and failed scans strand in
 * RUNNING with no error written — the original H6 bug.
 */

import { describe, test, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// data/scans.ts imports @/lib/db which constructs a PrismaClient — stub it
// out so this pure-logic test never touches a database.
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  SCAN_DISPATCH_TIMEOUT_MS,
  WORD_EXPORT_TIMEOUT_MS,
  screenshotZipTimeoutMs,
} from "@/lib/worker";
import {
  stuckScanWhere,
  STALE_PROGRESS_MS,
  SCAN_HARD_TIMEOUT_MS,
} from "@/lib/data/scans";

/**
 * The route file exports `maxDuration` for Vercel, but importing the route
 * module would drag in next/server + auth + Prisma. Read the source instead —
 * the declaration is a literal, so a regex is reliable.
 */
function routeMaxDurationSeconds(): number {
  const src = readFileSync(
    fileURLToPath(new URL("../../app/api/scans/route.ts", import.meta.url)),
    "utf8"
  );
  const m = src.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
  if (!m) throw new Error("maxDuration declaration not found in scans route");
  return Number(m[1]);
}

describe("scan timeout chain (H6)", () => {
  test("dispatch timeout fires BELOW the route's maxDuration", () => {
    const maxDurationMs = routeMaxDurationSeconds() * 1000;
    expect(SCAN_DISPATCH_TIMEOUT_MS).toBeLessThan(maxDurationMs);
    // …with enough headroom for the FAILED write to complete (>= 10s).
    expect(maxDurationMs - SCAN_DISPATCH_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
  });

  test("stale-progress recovery cutoff is 3 minutes, hard fallback 15", () => {
    expect(STALE_PROGRESS_MS).toBe(3 * 60 * 1000);
    expect(SCAN_HARD_TIMEOUT_MS).toBe(15 * 60 * 1000);
    expect(STALE_PROGRESS_MS).toBeLessThan(SCAN_HARD_TIMEOUT_MS);
  });

  test("recovery keys on updatedAt staleness with a startedAt fallback", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    const where = stuckScanWhere("org_1", now);

    expect(where.organizationId).toBe("org_1");
    // Only RUNNING scans are ever recovered — cancelled/completed stay put.
    expect(where.status).toBe("RUNNING");

    const [progressClause, startedClause] = where.OR;
    // Primary: no progress write (Scan.updatedAt is @updatedAt) for 3 min.
    expect(progressClause.updatedAt!.lt.toISOString()).toBe("2026-01-01T11:57:00.000Z");
    // Fallback: scans that died before their first progress write.
    expect(startedClause.startedAt!.lt.toISOString()).toBe("2026-01-01T11:45:00.000Z");
  });
});

describe("export dispatch budgets (H8/H11)", () => {
  test("Word export uses a fixed 60s budget (screenshots flag removed)", () => {
    expect(WORD_EXPORT_TIMEOUT_MS).toBe(60_000);
  });

  test("screenshot-ZIP budget scales with invoice count: 120s base + 15s each", () => {
    // Worker budget: concurrency 3, 45s hard cap per screenshot → 15s
    // amortized worst case per invoice (see wave-1 sizing rationale).
    expect(screenshotZipTimeoutMs(0)).toBe(120_000);
    expect(screenshotZipTimeoutMs(1)).toBe(135_000);
    expect(screenshotZipTimeoutMs(50)).toBe(870_000);
  });

  test("screenshot-ZIP budget is capped at 15 minutes", () => {
    expect(screenshotZipTimeoutMs(200)).toBe(900_000);
    expect(screenshotZipTimeoutMs(10_000)).toBe(900_000);
  });
});
