/**
 * Canonical supplier resolution — single source of truth used by:
 *   1. Invoice persistence (route.ts) to store a clean `company` value
 *   2. Invoices page supplier panel + Companies filter (derive visible brands)
 *   3. Supplier exclusion sweep (apply user's excluded brands on re-scan)
 *   4. Maintenance backfill (re-normalize historical invoices)
 *
 * Why this exists:
 * Without canonical mapping the DB ends up with duplicates like:
 *   "Anthropic" / "Anthropic, PBC" / "Claude Team"
 *   "Lazada Customer Care" / "Lazada Thailand"
 *   "AliExpress" / "AliExpress.seller"
 *   "Apple" / "Apple Services" (PayPal-to-Apple receipts)
 *   "Hostinger" / "Hostinger US"
 *   "Adobe" / "Adobe Creative Cloud"
 *   "Wix" / "Wix Studio"
 *   "Lyft" / "Lyftmail"
 *   "Gett" / "Gett Receipts"
 *   "Uber" / "Uber Eats" / "Uber One"
 *   "Google" / "Google Play" / "Google Cloud..." / "יומן Google"
 *   "Bezeq" / "בזק"; "Cellcom" / "סלקום"; "Partner" / "פרטנר"; "10bis" / "תן ביס"
 *
 * The supplier panel showed all of these as separate chips with split counts.
 * This module reduces every variant to one canonical key + one display name.
 */

import { normalizeDomain, cleanCompanyName } from "./utils";
import brandData from "./brand-data.json";

/**
 * Canonical key for invoices whose (company, senderDomain) yields no brand at
 * all. Persisted into Invoice.supplierKey so the "Unknown" supplier chip can
 * be excluded/filtered exactly like a real brand. Must never collide with a
 * real canonical key ("unknown" appears in no alias group — guarded by test).
 */
export const UNKNOWN_KEY = "unknown";

// Business suffixes stripped during canonicalization. Sourced from the shared
// brand-data.json (single source of truth with the Python worker). The set
// holds each suffix plus its dotted variants ("inc." / "s.a." / "b.v.") so
// token-membership checks keep matching punctuation-carrying forms.
const BUSINESS_SUFFIXES: ReadonlySet<string> = (() => {
  const s = new Set<string>();
  for (const suffix of brandData.businessSuffixes) {
    s.add(suffix);
    s.add(`${suffix}.`);
    if (/^[a-z]{2,3}$/.test(suffix)) {
      const dotted = suffix.split("").join(".");
      s.add(dotted);
      s.add(`${dotted}.`);
    }
  }
  return s;
})();

/**
 * Brand-alias map: canonical key (lowercase) → variants we should fold in.
 * Each entry lists the variant strings we expect to see in either the
 * `company` field or via the senderDomain-normalised brand path.
 *
 * Hebrew variants live alongside English so that "בזק" resolves to the
 * same canonical "bezeq" as "Bezeq International".
 */
const ALIAS_GROUPS: Record<string, string[]> = brandData.aliasGroups;

// Display names (canonical key → user-visible string).
const DISPLAY_NAMES: Record<string, string> = brandData.displayNames;

// Reverse-lookup map: any alias variant (lowercased) → canonical key
const ALIAS_TO_KEY: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(ALIAS_GROUPS)) {
    m.set(canonical, canonical);
    for (const a of aliases) {
      m.set(a.toLowerCase().trim(), canonical);
    }
  }
  return m;
})();

/**
 * Normalize Hebrew gershayim (״ U+05F4) / geresh (׳ U+05F3) and typographic
 * quotes to plain ASCII quotes so 'בע"מ', 'בע״מ' and 'בע”מ' all hit the same
 * suffix token, and quoted display names compare consistently (M10).
 */
function normalizeQuotes(s: string): string {
  return s.replace(/[״”“]/g, '"').replace(/[׳’‘]/g, "'");
}

/**
 * Strip business suffixes from a name. "Anthropic, PBC" → "anthropic",
 * "Stripe Inc." → "stripe", "Meta Platforms" → "meta", 'אקמי בע"מ' → 'אקמי'.
 * Also drops the App Store's "via TestFlight" tail that PayPal/Apple receipts
 * append to vendor names (M8).
 */
function stripBusinessSuffix(name: string): string {
  const lower = normalizeQuotes(stripBidiMarks(name))
    .toLowerCase()
    .replace(/\s+via\s+testflight\s*$/i, "")
    .trim();
  const tokens = lower
    .replace(/[,]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
  while (tokens.length > 1 && BUSINESS_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(" ");
}

/**
 * Strip Unicode directional marks (LRM U+200E, RLM U+200F, LRE/RLE/PDF
 * and the bi-di isolate marks) that Gmail occasionally embeds in display
 * names — they make "‏יומן Google" fail to match "יומן google".
 */
function stripBidiMarks(s: string): string {
  return s.replace(/[‎‏‪-‮⁦-⁩]/g, "");
}

/**
 * Resolve any free-form supplier label to a canonical brand key.
 * Returns null if no alias matches and the raw string is not usable.
 *
 *   "Anthropic, PBC"             → "anthropic"
 *   "Lazada Thailand"            → "lazada"
 *   "AliExpress.seller"          → "aliexpress"
 *   "Apple Services"             → "apple"
 *   "Hostinger US"               → "hostinger"
 *   "בזק"                         → "bezeq"
 *   "מיועד לי / random startup"  → null   (no alias, returns null)
 */
export function toCanonicalKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = normalizeQuotes(stripBidiMarks(String(raw))).toLowerCase().trim();
  if (!lower) return null;

  // 1. Direct alias hit
  if (ALIAS_TO_KEY.has(lower)) return ALIAS_TO_KEY.get(lower)!;

  // 2. Strip business suffix and retry
  const stripped = stripBusinessSuffix(lower);
  if (stripped && stripped !== lower && ALIAS_TO_KEY.has(stripped)) {
    return ALIAS_TO_KEY.get(stripped)!;
  }

  // 3. Try the space-stripped variant — "Beigel Bake" ↔ "beigelbake".
  const noSpaces = lower.replace(/\s+/g, "");
  if (noSpaces && noSpaces !== lower && ALIAS_TO_KEY.has(noSpaces)) {
    return ALIAS_TO_KEY.get(noSpaces)!;
  }

  // NOTE (M9): there is deliberately NO generic first-word fallback here.
  // "Hot Bagels" must not merge into the HOT telecom key, nor "Partner
  // Solutions" into Partner Communications, nor "Bolt Industries" into the
  // Bolt ride-share. Legitimate multi-word brand variants ("Apple TV+",
  // "Google Drive", "Uber Eats") are covered by explicit aliases in
  // brand-data.json instead.

  return null;
}

/**
 * Compute the canonical brand key for an invoice given company + senderDomain.
 * Always returns a non-empty string (falls back to cleaned company / domain
 * if no canonical alias matches), so the supplier list NEVER drops a row.
 *
 * Order of resolution:
 *   1. company → try canonical alias
 *   2. company → cleanCompanyName + strip business suffix (raw fallback)
 *   3. senderDomain → normalizeDomain → try canonical alias
 *   4. senderDomain → normalizeDomain raw fallback
 */
export function canonicalSupplierKey(input: {
  company?: string | null;
  senderDomain?: string | null;
}): string {
  // 1+2. Company path
  if (input.company) {
    const cleaned = cleanCompanyName(input.company).toLowerCase().trim();
    if (cleaned) {
      const aliased = toCanonicalKey(cleaned);
      if (aliased) return aliased;
      const suffixStripped = stripBusinessSuffix(cleaned);
      if (suffixStripped) {
        const aliased2 = toCanonicalKey(suffixStripped);
        if (aliased2) return aliased2;
        // Unknown brand: collapse whitespace so space variants dedupe into
        // ONE deterministic key — "Beigel Bake" and "Beigelbake" must be the
        // same supplier chip (M8). Deterministic (no first-seen state) so the
        // persisted Invoice.supplierKey is stable across scans/backfills.
        return suffixStripped.replace(/\s+/g, "");
      }
    }
  }

  // 3+4. Domain path
  if (input.senderDomain) {
    const brand = normalizeDomain(input.senderDomain);
    if (brand) {
      const aliased = toCanonicalKey(brand);
      if (aliased) return aliased;
      return brand;
    }
  }

  return "";
}

/**
 * User-visible display name for a canonical key. Falls back to title-casing
 * the key for brands we haven't pinned a custom display for.
 */
export function canonicalDisplayName(key: string): string {
  if (!key) return "";
  if (DISPLAY_NAMES[key]) return DISPLAY_NAMES[key];
  return key
    .split(/[\s\-_]+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Resolve a canonical brand + display name for an invoice in one call.
 * Convenience wrapper used by the invoices page and supplier-exclusion sweep.
 */
export function resolveSupplier(input: {
  company?: string | null;
  senderDomain?: string | null;
}): { key: string; displayName: string } {
  const key = canonicalSupplierKey(input);
  return { key, displayName: canonicalDisplayName(key) };
}
