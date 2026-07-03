/**
 * Regression guard for the 2026-05-23 supplier-duplicate incident.
 *
 * Before the fix the user's Invoices page showed multiple chips for the same
 * real supplier (Anthropic / Anthropic PBC / Claude Team, Lazada Customer
 * Care / Lazada Thailand, AliExpress / AliExpress.seller, Apple / Apple
 * Services, Adobe / Adobe Creative Cloud, Hostinger / Hostinger US, Lyft /
 * Lyftmail, Gett / Gett Receipts, Uber / Uber Eats / Uber One, Google /
 * Google Play / יומן Google, Wix / Wix Studio, etc.). The same set of raw
 * labels was also showing up duplicated in the suppliers table.
 *
 * These tests pin the canonical resolution against every concrete variant
 * the production DB audit surfaced PLUS the broader vendor list the user
 * explicitly called out (Hebrew/English Israeli telcos, payment processors,
 * tech vendors).
 */

import { describe, test, expect } from "vitest";
import {
  toCanonicalKey,
  canonicalSupplierKey,
  canonicalDisplayName,
  resolveSupplier,
  UNKNOWN_KEY,
} from "../supplier-canonical";

describe("toCanonicalKey — vendor aliases", () => {
  test.each([
    // Anthropic family
    ["Anthropic", "anthropic"],
    ["Anthropic, PBC", "anthropic"],
    ["Anthropic PBC", "anthropic"],
    ["Anthropic Inc.", "anthropic"],
    ["Claude Team", "anthropic"],
    ["claude.com", "anthropic"],

    // Google family
    ["Google", "google"],
    ["Google Play", "google"],
    ["Google LLC", "google"],
    ["Google Cloud Platform", "google"],
    ["Google Cloud", "google"],
    ["Google One", "google"],
    ["Google Workspace", "google"],
    ["יומן Google", "google"],
    ["payments.google.com", "google"],

    // Apple family
    ["Apple", "apple"],
    ["Apple Services", "apple"],
    ["Apple Inc.", "apple"],
    ["iCloud", "apple"],
    ["iTunes", "apple"],

    // Meta family
    ["Meta", "meta"],
    ["Facebook", "meta"],
    ["Meta Platforms", "meta"],
    ["Meta for Business", "meta"],
    ["Instagram", "meta"],
    ["facebookmail", "meta"],

    // Payment processors
    ["PayPal", "paypal"],
    ["PayPal Europe", "paypal"],
    ["PayPal Inc.", "paypal"],
    ["paypal.co.il", "paypal"],
    ["paypal.com", "paypal"],
    ["Stripe", "stripe"],
    ["Stripe Inc.", "stripe"],

    // Adobe / GitHub / Vercel / Render
    ["Adobe", "adobe"],
    ["Adobe Creative Cloud", "adobe"],
    ["GitHub", "github"],
    ["GitHub, Inc.", "github"],
    ["GitHub Inc", "github"],
    ["Vercel", "vercel"],
    ["Vercel Inc.", "vercel"],
    ["Render", "render"],

    // Amazon family
    ["Amazon", "amazon"],
    ["Amazon Web Services", "amazon"],
    ["AWS", "amazon"],
    ["aws.amazon.com", "amazon"],

    // Hostinger
    ["Hostinger", "hostinger"],
    ["Hostinger US", "hostinger"],

    // OpenAI family (incl. TestFlight noise variants)
    ["OpenAI", "openai"],
    ["OpenAI Inc.", "openai"],
    ["OpenAI Ads GPT OpCo,LLC via TestFlight", "openai"],

    // AliExpress family
    ["AliExpress", "aliexpress"],
    ["AliExpress.seller", "aliexpress"],
    ["aliexpress.com", "aliexpress"],

    // Alibaba family
    ["Alibaba", "alibaba"],
    ["Alibaba Remind", "alibaba"],
    ["alibaba.com", "alibaba"],

    // Ride-share
    ["Uber", "uber"],
    ["Uber Eats", "uber"],
    ["Uber One", "uber"],
    ["Lyft", "lyft"],
    ["Lyftmail", "lyft"],
    ["Gett", "gett"],
    ["Gett Receipts", "gett"],

    // Food delivery
    ["Wolt", "wolt"],
    ["Wolt Israel", "wolt"],
    ["10bis", "10bis"],
    ["tenbis", "10bis"],
    ["תן ביס", "10bis"],
    ["Cibus", "cibus"],
    ["סיבוס", "cibus"],
    ["Lazada", "lazada"],
    ["Lazada Customer Care", "lazada"],
    ["Lazada Thailand", "lazada"],

    // Israeli telcos & utilities — Hebrew + English fold to same key
    ["Bezeq", "bezeq"],
    ["בזק", "bezeq"],
    ["Bezeq International", "bezeq"],
    ["Cellcom", "cellcom"],
    ["סלקום", "cellcom"],
    ["Partner", "partner"],
    ["פרטנר", "partner"],
    ["Partner Communications", "partner"],
    ["pelephone", "pelephone"],
    ["פלאפון", "pelephone"],

    // Misc
    ["Wix", "wix"],
    ["Wix Studio", "wix"],
    ["WeTransfer", "wetransfer"],
    ["Bird Rides", "bird"],
    ["Bird", "bird"],
    ["Cloudflare", "cloudflare"],
    ["Netlify", "netlify"],
  ])("%s → %s", (input, expected) => {
    expect(toCanonicalKey(input)).toBe(expected);
  });
});

describe("toCanonicalKey — Gmail-injected RTL/LTR marks are stripped", () => {
  // Gmail sometimes prefixes display names with U+200E (LRM) or U+200F (RLM)
  // when the display name mixes scripts. Without stripping, the alias lookup
  // misses and the brand shows up as its own duplicate supplier chip.
  test.each([
    ["‏יומן Google", "google"],
    ["‎יומן Google", "google"],
    ["‏בזק", "bezeq"],
    ["‏פרטנר", "partner"],
  ])("%s → %s", (input, expected) => {
    expect(toCanonicalKey(input)).toBe(expected);
  });
});

describe("toCanonicalKey — space-variant matching", () => {
  // Variants like "10 bis" vs "10bis" should fold by stripping spaces.
  test.each([
    ["10 bis", "10bis"],
    ["10bis", "10bis"],
    ["Ten Bis", "10bis"],
  ])("%s → %s", (input, expected) => {
    expect(toCanonicalKey(input)).toBe(expected);
  });
});

describe("toCanonicalKey — unknown brands fall through to null", () => {
  test.each([
    ["Some Tiny Random Startup", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])("%s → null", (input, expected) => {
    expect(toCanonicalKey(input as any)).toBe(expected);
  });
});

describe("canonicalSupplierKey — invoice resolution priority", () => {
  test("uses company first when it maps to a canonical brand", () => {
    expect(canonicalSupplierKey({
      company: "Anthropic, PBC",
      senderDomain: "mail.anthropic.com",
    })).toBe("anthropic");
  });

  test("falls back to senderDomain when company is null", () => {
    expect(canonicalSupplierKey({
      company: null,
      senderDomain: "billing.anthropic.com",
    })).toBe("anthropic");
  });

  test("PayPal-to-vendor receipt: company already holds the real vendor → canonical to vendor, not paypal", () => {
    // route.ts's extractVendorFromSubject already sets `company = "Apple Services"`
    // for PayPal-to-Apple receipts. Verify canonical folds that to apple, not paypal.
    expect(canonicalSupplierKey({
      company: "Apple Services",
      senderDomain: "paypal.co.il",
    })).toBe("apple");
  });

  test("PayPal-to-vendor for Shopify resolves to shopify, not paypal", () => {
    expect(canonicalSupplierKey({
      company: "Shopify",
      senderDomain: "paypal.co.il",
    })).toBe("shopify");
  });

  test("PayPal account email with no vendor → paypal itself", () => {
    expect(canonicalSupplierKey({
      company: "PayPal",
      senderDomain: "paypal.co.il",
    })).toBe("paypal");
  });

  test("unknown company falls through to suffix-stripped, space-collapsed key", () => {
    // Space collapse (M8): "Random Boutique" and "Randomboutique" must be ONE
    // supplier, so the deterministic fallback key strips whitespace.
    const k = canonicalSupplierKey({
      company: "Random Boutique Inc.",
      senderDomain: null,
    });
    expect(k).toBe("randomboutique");
  });

  test("unknown company + unknown domain returns domain brand", () => {
    const k = canonicalSupplierKey({
      company: null,
      senderDomain: "weird-vendor.com",
    });
    expect(k).toBe("weird-vendor");
  });

  test("empty input returns empty string", () => {
    expect(canonicalSupplierKey({})).toBe("");
  });
});

describe("canonicalDisplayName", () => {
  test.each([
    ["anthropic", "Anthropic"],
    ["google", "Google"],
    ["apple", "Apple"],
    ["meta", "Meta"],
    ["paypal", "PayPal"],
    ["github", "GitHub"],
    ["aliexpress", "AliExpress"],
    ["openai", "OpenAI"],
    ["wetransfer", "WeTransfer"],
    ["10bis", "10bis"],
    ["bezeq", "Bezeq"],
    ["cellcom", "Cellcom"],
    ["unknown-key", "Unknown Key"],
  ])("%s → %s", (key, expected) => {
    expect(canonicalDisplayName(key)).toBe(expected);
  });
});

describe("resolveSupplier — end-to-end", () => {
  test("Anthropic, PBC → key=anthropic, display=Anthropic", () => {
    const r = resolveSupplier({ company: "Anthropic, PBC", senderDomain: "mail.anthropic.com" });
    expect(r).toEqual({ key: "anthropic", displayName: "Anthropic" });
  });

  test("Apple Services (PayPal) → key=apple, display=Apple", () => {
    const r = resolveSupplier({ company: "Apple Services", senderDomain: "paypal.co.il" });
    expect(r).toEqual({ key: "apple", displayName: "Apple" });
  });

  test("בזק → key=bezeq, display=Bezeq", () => {
    const r = resolveSupplier({ company: "בזק", senderDomain: "bezeq.co.il" });
    expect(r).toEqual({ key: "bezeq", displayName: "Bezeq" });
  });
});

describe("M9 — first-word over-merge is gone (full-token/alias match only)", () => {
  test.each([
    // Multi-word unknown brands must NOT merge into short brand keys.
    ["Hot Bagels", "hot"],
    ["Partner Solutions", "partner"],
    ["Bolt Industries", "bolt"],
    ["Meta Description Agency", "meta"],
    ["Bird Watching Supplies", "bird"],
  ])("company %s does not resolve to brand key %s", (company, brandKey) => {
    const key = canonicalSupplierKey({ company, senderDomain: null });
    expect(key).not.toBe(brandKey);
    expect(key.length).toBeGreaterThan(0);
  });

  test.each([
    // Legit multi-word brand variants are covered by EXPLICIT aliases.
    ["Apple TV+", "apple"],
    ["Apple TV", "apple"],
    ["Apple Music", "apple"],
    ["Google Drive", "google"],
    ["Uber Eats", "uber"],
  ])("%s → %s via explicit alias", (input, expected) => {
    expect(toCanonicalKey(input)).toBe(expected);
  });
});

describe("M10 — Hebrew legal suffixes and gershayim/quote variants", () => {
  test('בע"מ variants and the bare name all produce the SAME key', () => {
    const ascii = canonicalSupplierKey({ company: 'אקמי בע"מ' });
    const gershayim = canonicalSupplierKey({ company: "אקמי בע״מ" });
    const typographic = canonicalSupplierKey({ company: "אקמי בע”מ" });
    const noSuffix = canonicalSupplierKey({ company: "אקמי" });
    const noQuotes = canonicalSupplierKey({ company: "אקמי בעמ" });
    expect(ascii).toBe("אקמי");
    expect(gershayim).toBe(ascii);
    expect(typographic).toBe(ascii);
    expect(noSuffix).toBe(ascii);
    expect(noQuotes).toBe(ascii);
  });

  test("known brand with Hebrew suffix still hits its alias", () => {
    expect(toCanonicalKey("בזק בע״מ")).toBe("bezeq");
    expect(toCanonicalKey('בזק בע"מ')).toBe("bezeq");
  });

  test('ע"ר (registered non-profit) suffix is stripped', () => {
    expect(canonicalSupplierKey({ company: 'עמותת הצלה ע"ר' }))
      .toBe(canonicalSupplierKey({ company: "עמותת הצלה" }));
  });
});

describe("M8 — unknown-brand quality guards", () => {
  test("space variants of unknown brands dedupe into one key", () => {
    const spaced = canonicalSupplierKey({ company: "Beigel Bake" });
    const mashed = canonicalSupplierKey({ company: "Beigelbake" });
    expect(spaced).toBe("beigelbake");
    expect(spaced).toBe(mashed);
  });

  test("'via TestFlight' tail is stripped for any brand", () => {
    expect(toCanonicalKey("OpenAI via TestFlight")).toBe("openai");
    expect(canonicalSupplierKey({ company: "SomeApp via TestFlight" }))
      .toBe(canonicalSupplierKey({ company: "SomeApp" }));
  });
});

describe("UNKNOWN_KEY contract (M12)", () => {
  test("empty resolution + UNKNOWN_KEY fallback buckets under 'unknown'", () => {
    expect(canonicalSupplierKey({}) || UNKNOWN_KEY).toBe("unknown");
    expect(canonicalSupplierKey({ company: null, senderDomain: null }) || UNKNOWN_KEY)
      .toBe(UNKNOWN_KEY);
  });

  test("UNKNOWN_KEY never collides with a real brand alias", () => {
    expect(toCanonicalKey(UNKNOWN_KEY)).toBeNull();
  });

  test("UNKNOWN_KEY has a human display name", () => {
    expect(canonicalDisplayName(UNKNOWN_KEY)).toBe("Unknown");
  });
});

describe("supplier counts aggregate across variants", () => {
  // Mirrors the in-page aggregation logic over canonicalSupplierKey.
  test("AliExpress + AliExpress.seller invoices collapse to one supplier with summed count", () => {
    const invoices = [
      { company: "AliExpress", senderDomain: "mail.aliexpress.com" },
      { company: "AliExpress", senderDomain: "notice.aliexpress.com" },
      { company: "AliExpress.seller", senderDomain: "aliexpress.com" },
    ];
    const counts: Record<string, number> = {};
    for (const inv of invoices) {
      const k = canonicalSupplierKey(inv);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts).toEqual({ aliexpress: 3 });
  });

  test("Anthropic / Anthropic PBC / Claude Team all fold to one supplier", () => {
    const invoices = [
      { company: "Anthropic", senderDomain: "mail.anthropic.com" },
      { company: "Anthropic, PBC", senderDomain: "mail.anthropic.com" },
      { company: "Claude Team", senderDomain: "email.claude.com" },
    ];
    const counts: Record<string, number> = {};
    for (const inv of invoices) {
      const k = canonicalSupplierKey(inv);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts).toEqual({ anthropic: 3 });
  });

  test("Lazada Customer Care + Lazada Thailand fold to one supplier", () => {
    const invoices = [
      { company: "Lazada Customer Care", senderDomain: "support.lazada.co.th" },
      { company: "Lazada Thailand", senderDomain: "support.lazada.co.th" },
    ];
    const counts: Record<string, number> = {};
    for (const inv of invoices) {
      const k = canonicalSupplierKey(inv);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    expect(counts).toEqual({ lazada: 2 });
  });
});
