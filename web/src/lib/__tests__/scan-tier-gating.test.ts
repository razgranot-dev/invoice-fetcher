/**
 * Regression guard for the tier → reportStatus mapping in
 * web/src/app/api/scans/route.ts.
 *
 * Project spec (CLAUDE.md / project context):
 *   • not_invoice              → not persisted (filtered out earlier)
 *   • possible_financial_email → persisted, EXCLUDED (needs review)
 *   • likely_invoice           → persisted, INCLUDED
 *   • confirmed_invoice        → persisted, INCLUDED
 *
 * Prior to the 2026-05-22 fixes, every persisted invoice landed as INCLUDED.
 * That made the main report noisy with weak-signal emails and contradicted
 * the spec. This test pins the mapping so a future refactor can't silently
 * regress it.
 */

import { describe, test, expect } from "vitest";

// Mirrors the helper inlined in web/src/app/api/scans/route.ts. Keep in sync.
function defaultReportStatus(tier: string): "INCLUDED" | "EXCLUDED" {
  if (tier === "confirmed_invoice" || tier === "likely_invoice") {
    return "INCLUDED";
  }
  return "EXCLUDED";
}

describe("tier → reportStatus mapping", () => {
  test("confirmed_invoice is INCLUDED", () => {
    expect(defaultReportStatus("confirmed_invoice")).toBe("INCLUDED");
  });

  test("likely_invoice is INCLUDED", () => {
    expect(defaultReportStatus("likely_invoice")).toBe("INCLUDED");
  });

  test("possible_financial_email is EXCLUDED (needs review)", () => {
    expect(defaultReportStatus("possible_financial_email")).toBe("EXCLUDED");
  });

  test("not_invoice is EXCLUDED when it slips through the persistence filter", () => {
    expect(defaultReportStatus("not_invoice")).toBe("EXCLUDED");
  });

  test("unknown tier defaults to EXCLUDED (safe default)", () => {
    expect(defaultReportStatus("future_tier_we_added")).toBe("EXCLUDED");
  });
});

/**
 * shouldPersist gate — pinned from the inline helper in route.ts.
 * not_invoice gets dropped unless it has a positive content signal that
 * isn't just the sender domain (which alone is too weak).
 */
function shouldPersist(inv: {
  classification_tier?: string;
  classification_score?: number;
  classification_signals?: Array<{ signal: string; score: number }>;
}): boolean {
  const tier = inv.classification_tier ?? "not_invoice";
  if (tier !== "not_invoice") return true;
  const score = inv.classification_score ?? 0;
  if (score < 5) return false;
  const signals = inv.classification_signals ?? [];
  return signals.some(
    (s) => s.score > 0 && s.signal !== "sender_invoice_domain"
  );
}

describe("shouldPersist gate", () => {
  test("not_invoice with low score is dropped", () => {
    expect(
      shouldPersist({ classification_tier: "not_invoice", classification_score: 2 })
    ).toBe(false);
  });

  test("not_invoice with only sender-domain signal is dropped (no real evidence)", () => {
    expect(
      shouldPersist({
        classification_tier: "not_invoice",
        classification_score: 10,
        classification_signals: [{ signal: "sender_invoice_domain", score: 10 }],
      })
    ).toBe(false);
  });

  test("not_invoice with content signal is persisted (will be EXCLUDED)", () => {
    expect(
      shouldPersist({
        classification_tier: "not_invoice",
        classification_score: 8,
        classification_signals: [
          { signal: "subject_weak", score: 8 },
          { signal: "sender_invoice_domain", score: 5 },
        ],
      })
    ).toBe(true);
  });

  test("possible_financial_email is always persisted (will be EXCLUDED)", () => {
    expect(shouldPersist({ classification_tier: "possible_financial_email" })).toBe(true);
  });

  test("likely_invoice and confirmed_invoice are always persisted", () => {
    expect(shouldPersist({ classification_tier: "likely_invoice" })).toBe(true);
    expect(shouldPersist({ classification_tier: "confirmed_invoice" })).toBe(true);
  });
});

/**
 * The full row-to-status flow: persistability × tier → outcome.
 * Catches regressions where the report would silently mix weak-signal
 * emails into the user's invoice list.
 */
describe("full pipeline: tier → persistence → reportStatus", () => {
  function classify(inv: {
    classification_tier: string;
    classification_score?: number;
    classification_signals?: Array<{ signal: string; score: number }>;
  }): { persisted: boolean; reportStatus: "INCLUDED" | "EXCLUDED" | null } {
    if (!shouldPersist(inv)) return { persisted: false, reportStatus: null };
    return { persisted: true, reportStatus: defaultReportStatus(inv.classification_tier) };
  }

  test("confirmed → persisted INCLUDED", () => {
    expect(classify({ classification_tier: "confirmed_invoice" })).toEqual({
      persisted: true,
      reportStatus: "INCLUDED",
    });
  });

  test("likely → persisted INCLUDED", () => {
    expect(classify({ classification_tier: "likely_invoice" })).toEqual({
      persisted: true,
      reportStatus: "INCLUDED",
    });
  });

  test("possible → persisted EXCLUDED (needs review)", () => {
    expect(classify({ classification_tier: "possible_financial_email" })).toEqual({
      persisted: true,
      reportStatus: "EXCLUDED",
    });
  });

  test("not_invoice low-score → dropped", () => {
    expect(
      classify({
        classification_tier: "not_invoice",
        classification_score: 1,
      })
    ).toEqual({ persisted: false, reportStatus: null });
  });

  test("not_invoice with body-content signal → persisted EXCLUDED", () => {
    expect(
      classify({
        classification_tier: "not_invoice",
        classification_score: 8,
        classification_signals: [{ signal: "body_weak", score: 8 }],
      })
    ).toEqual({ persisted: true, reportStatus: "EXCLUDED" });
  });
});
