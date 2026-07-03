/**
 * M28/S2 — brand-data.json is the SINGLE source of truth for brand/alias/
 * noise data. These parity tests replace the old "MUST stay in sync" comments
 * that guarded (and failed to prevent) drift between the four TS copies and
 * the Python worker's lists.
 */

import { describe, test, expect } from "vitest";
import brandData from "../brand-data.json";
import { NOISE_SUBDOMAINS, COMPOUND_TLDS, normalizeDomain, cleanCompanyName } from "../utils";
import { toCanonicalKey, canonicalDisplayName, UNKNOWN_KEY } from "../supplier-canonical";
import { extractCompany } from "../scan-company";

describe("TS consumers read from brand-data.json", () => {
  test("utils NOISE_SUBDOMAINS equals the JSON noiseWords", () => {
    expect(new Set(brandData.noiseWords)).toEqual(new Set(NOISE_SUBDOMAINS));
  });

  test("utils COMPOUND_TLDS equals the JSON compoundTlds", () => {
    expect([...COMPOUND_TLDS]).toEqual(brandData.compoundTlds);
  });

  test("every alias in every alias group resolves to its canonical key", () => {
    for (const [key, aliases] of Object.entries(brandData.aliasGroups)) {
      expect(toCanonicalKey(key)).toBe(key);
      for (const alias of aliases) {
        expect(toCanonicalKey(alias), `alias "${alias}"`).toBe(key);
      }
    }
  });

  test("every alias-group key has a display name (and vice versa, minus 'unknown')", () => {
    const groupKeys = new Set(Object.keys(brandData.aliasGroups));
    for (const key of groupKeys) {
      expect(brandData.displayNames, `display name for "${key}"`).toHaveProperty(key);
    }
    for (const key of Object.keys(brandData.displayNames)) {
      if (key === UNKNOWN_KEY) continue;
      expect(groupKeys.has(key), `alias group for display name "${key}"`).toBe(true);
    }
  });

  test("UNKNOWN_KEY collides with no alias group or alias", () => {
    expect(brandData.aliasGroups).not.toHaveProperty(UNKNOWN_KEY);
    for (const aliases of Object.values(brandData.aliasGroups)) {
      expect(aliases).not.toContain(UNKNOWN_KEY);
    }
  });

  test("scan-company + utils share the same noise/TLD behaviour end-to-end", () => {
    // A noise subdomain from the shared list is stripped identically by the
    // domain normalizer and the sender-based company extractor.
    expect(normalizeDomain("billing.hostinger.com")).toBe("hostinger");
    expect(extractCompany("noreply@billing.hostinger.com")).toBe("Hostinger");
    // Compound TLD from the shared list.
    expect(normalizeDomain("paypal.co.il")).toBe("paypal");
    expect(extractCompany("service@paypal.co.il")).toBe("Paypal");
  });

  test("Hebrew noise words from the shared list are stripped from company names", () => {
    expect(cleanCompanyName("וולט קבלה")).toBe("וולט");
  });

  test("display names render for known keys", () => {
    expect(canonicalDisplayName("anthropic")).toBe("Anthropic");
    expect(canonicalDisplayName(UNKNOWN_KEY)).toBe("Unknown");
  });
});

describe("brand-data.json shape guards (Python loader contract)", () => {
  test("all fields the Python worker consumes exist and are non-empty", () => {
    expect(brandData.noiseWords.length).toBeGreaterThan(30);
    expect(brandData.compoundTlds.length).toBeGreaterThan(10);
    expect(brandData.businessSuffixes.length).toBeGreaterThan(10);
    expect(brandData.queryBrandTokens.length).toBeGreaterThan(30);
  });

  test("business suffixes include the Hebrew legal forms (M10)", () => {
    expect(brandData.businessSuffixes).toContain('בע"מ');
    expect(brandData.businessSuffixes).toContain("בעמ");
  });

  test("query brand tokens keep the anchors the Gmail query builder asserts on", () => {
    for (const tok of ["stripe", "apple", "openai", "anthropic", "higgsfield", "bezeq"]) {
      expect(brandData.queryBrandTokens).toContain(tok);
    }
  });
});
