/**
 * Company / supplier-name extraction helpers for the scan pipeline.
 *
 * Extracted out of `app/api/scans/route.ts` so they can be unit-tested in
 * isolation. The original inline versions caused a production outage: the
 * "unify duplicate suppliers" commit used `cleanCompanyName(...)` inside
 * `extractCompany` without importing it, so every scan threw
 * `ReferenceError: cleanCompanyName is not defined` during finalization —
 * and no test exercised the real code path, so it shipped. Keeping these as
 * a small, imported, tested module removes that footgun.
 */
import { cleanCompanyName, NOISE_SUBDOMAINS, COMPOUND_TLDS } from "@/lib/utils";

// Noise words + compound TLDs come from the shared brand-data.json (via
// utils.ts) — the single source of truth also consumed by the Python worker.
const NOISE = NOISE_SUBDOMAINS;

/** Extract a clean domain from "Name <user@domain.com>" or "user@domain.com". */
export function extractDomain(sender?: string): string | undefined {
  if (!sender) return undefined;
  const match = sender.match(/<([^>]+)>/) || sender.match(/[\w.+-]+@[\w.-]+/);
  const email = match ? match[1] || match[0] : sender;
  const parts = email.split("@");
  return parts.length > 1 ? parts[1].replace(/[^a-zA-Z0-9.-]/g, "") : undefined;
}

/** Extract company/supplier name from sender.
 *  Priority: display name from "Company Name <email>" → cleaned domain brand.
 *  Strips common noise words like "noreply", "billing", "info".
 */
export function extractCompany(sender?: string): string | undefined {
  if (!sender) return undefined;

  // Try display name from "Company Name <email>" format
  const nameMatch = sender.match(/^(.+?)\s*</);
  if (nameMatch) {
    const name = nameMatch[1].replace(/^["']|["']$/g, "").trim();
    // Skip if the display name is just an email address
    if (name && !name.includes("@") && name.length > 1) {
      // Strip noise words like "receipt", "billing" from display names
      const cleaned = cleanCompanyName(name);
      if (cleaned) return cleaned;
      // All words were noise — fall through to domain extraction
    }
  }

  // Fall back to domain brand name
  const domain = extractDomain(sender);
  if (!domain) return undefined;

  // Handle compound TLDs: paypal.co.il → paypal, example.com.au → example
  let base = domain.toLowerCase();
  let tldStripped = false;
  for (const tld of COMPOUND_TLDS) {
    if (base.endsWith("." + tld)) {
      base = base.slice(0, -(tld.length + 1));
      tldStripped = true;
      break;
    }
  }
  if (!tldStripped) {
    base = base.replace(/\.[a-z]{2,6}$/, "");
  }

  // Take the last meaningful part as the brand, skip noise subdomains
  const parts = base.split(".").filter((p) => p && !NOISE.has(p));
  const brand = parts.length > 0 ? parts[parts.length - 1] : base;
  if (!brand || brand.length < 2) return undefined;
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

/** Clean a captured merchant string: drop a leading amount, truncate at
 *  free-text connectors, strip business suffixes and surrounding
 *  punctuation/bidi marks. Returns "" (reject) for subject-like captures —
 *  PayPal's "payment to X" grammar is greedy, so without these guards a
 *  subject tail like "刘云 for Detailed Payment Request 0085" becomes a
 *  supplier name verbatim (M8). */
function cleanCapturedVendor(raw: string): string {
  let vendor = raw
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .replace(/^(?:US)?[$₪€£]?\s?[\d,]+\.\d{2}\s*(?:USD|ILS|EUR|GBP|CAD|AUD)?\s*(?:to\s+|ל[-־]?\s*)?/i, "")
    .trim();
  // Truncate at connector tokens / punctuation breaks — everything after
  // "for" / "via" / "regarding" / a comma / a spaced dash is payment free
  // text, not the merchant name.
  vendor = (vendor.split(/\s+(?:for|via|regarding|re:)\s+|\s+[-–—]\s+|,/i)[0] ?? "").trim();
  vendor = vendor
    .replace(/\s+international\s*$/i, "")
    .replace(/,?\s*(?:inc\.?|ltd\.?|llc\.?|pbc|gmbh|s\.?a\.?|b\.?v\.?|pvt\.?|pte\.?|ab)\s*$/i, "")
    .replace(/[."'\s־-]+$/u, "")
    .trim();
  // Subject-like heuristics: real vendor names are short and don't carry
  // long digit runs (order/request numbers do).
  const tokens = vendor.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length > 5 || /\d{3,}/.test(vendor)) return "";
  if (tokens.length > 4) vendor = tokens.slice(0, 4).join(" ");
  if (vendor.length > 40) return "";
  return vendor;
}

/** For payment-PROCESSOR receipts (PayPal, Stripe), the sender domain is the
 *  processor, not the real merchant — extract the merchant from the subject.
 *    "Receipt for Your Payment to Shopify International"  → "Shopify"   (PayPal)
 *    "You paid $9.99 to Spotify"                          → "Spotify"   (PayPal)
 *    "קבלה עבור התשלום שלך ל-Higgsfield"                  → "Higgsfield" (PayPal HE)
 *    "Your receipt from Anthropic, PBC"                   → "Anthropic" (Stripe)
 *  Returns undefined for non-processor senders (their domain brand is correct).
 */
export function extractVendorFromSubject(subject?: string, sender?: string): string | undefined {
  if (!subject || !sender) return undefined;
  const domain = extractDomain(sender);
  if (!domain) return undefined;
  const domainLower = domain.toLowerCase();
  const isPayPal = domainLower.includes("paypal");
  const isStripe = domainLower.includes("stripe");
  if (!isPayPal && !isStripe) return undefined;

  const patterns: RegExp[] = isPayPal
    ? [
        // English: "...payment to X", "you paid ($amt to) X", "sent (a payment of $amt) to X"
        /(?:payment\s+to|paid\s+to|sent\s+(?:a\s+payment\s+)?(?:of\s+\S+\s+)?(?:\S+\s+)?to|you\s+paid)\s+(.+)/i,
        // Hebrew: "...ל-VENDOR" at end ("התשלום שלך ל-X", "שילמת ל-X", "קבלה ... ל-X")
        /(?:ל[-־]\s*)([^\n,]+)$/,
      ]
    : [
        // Stripe: "receipt from X", "your receipt from X", "invoice from X"
        /(?:receipt|invoice)\s+from\s+(.+)/i,
      ];

  let vendor = "";
  for (const re of patterns) {
    const m = subject.match(re);
    if (m && m[1]) {
      vendor = cleanCapturedVendor(m[1]);
      if (vendor) break;
    }
  }
  if (!vendor) return undefined;

  // Normalize known brand variants
  const vendorLower = vendor.toLowerCase();
  if (vendorLower.includes("meta") || vendorLower.includes("facebook")) return "Meta";
  if (vendorLower.includes("shopify")) return "Shopify";
  return vendor;
}

/** Normalize known company name variants to canonical brand names. */
export function normalizeCompanyName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("facebookmail") || lower === "facebook" ||
      lower === "instagram" ||
      lower.includes("meta for business") || lower.includes("meta platforms")) {
    return "Meta";
  }
  return name;
}

// ── Forwarded-email attribution (M11) ────────────────────────────────────────
// A forwarded receipt ("Fwd: Your receipt from Anthropic") arrives FROM the
// forwarder (an accountant's Gmail), so sender-based company extraction would
// attribute the invoice to the forwarder. These helpers detect the forward and
// recover the ORIGINAL sender from the embedded forwarded-header block.

const FWD_PREFIX_RE = /^\s*(?:fwd|fw|הועבר|העבר)\s*:\s*/i;

/** True when the subject carries a forward prefix (English or Hebrew). */
export function isForwarded(subject?: string): boolean {
  return !!subject && FWD_PREFIX_RE.test(subject);
}

/** Remove leading forward prefixes ("Fwd: Fwd: X" → "X"). */
export function stripForwardPrefix(subject: string): string {
  let s = subject;
  while (FWD_PREFIX_RE.test(s)) {
    s = s.replace(FWD_PREFIX_RE, "");
  }
  return s.trim();
}

const TAG_RE = /<(?!\/?\s*[a-z0-9@._+-]+@)[^>]*>/gi;

/** Minimal HTML→text for forwarded-header parsing: drop tags (but keep
 *  "<user@domain>" address brackets), decode the entities Gmail emits. */
function htmlToText(html: string): string {
  return html
    .replace(/<(?:style|script)[^>]*>[\s\S]*?<\/(?:style|script)>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr)>/gi, "\n")
    .replace(TAG_RE, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

// First "From:" / "מאת:" header line of the embedded forwarded block.
// Handles Gmail ("---------- Forwarded message ---------\nFrom: X <y@z>"),
// Outlook ("From: X <y@z>") and Hebrew ("מאת: X <y@z>") formats, including
// quote-prefixed ("> From:") and bold-marker ("*From:*") variants.
const FWD_FROM_RE = /(?:^|[\n\r])[\s>*]*(?:from|מאת)\s*:\s*([^\n\r]+)/i;

/**
 * Extract the original sender ("Name <user@domain>") from a forwarded email's
 * body. Returns undefined when no embedded From-header with a real address is
 * found — callers then fall back to the forwarder (last-resort attribution).
 */
export function extractForwardedOriginalSender(
  bodyText?: string | null,
  bodyHtml?: string | null
): string | undefined {
  // Bound the scan: forwarded headers sit at the top of the body.
  const sources = [
    bodyText ? bodyText.slice(0, 20_000) : "",
    bodyHtml ? htmlToText(bodyHtml.slice(0, 60_000)) : "",
  ];
  for (const src of sources) {
    if (!src) continue;
    const cleaned = src.replace(/[‎‏‪-‮⁦-⁩]/g, "");
    const m = cleaned.match(FWD_FROM_RE);
    if (m && m[1]) {
      const candidate = m[1].replace(/\*+/g, "").trim();
      // Must contain a real address — a bare display name can't be resolved
      // to a domain and could be arbitrary prose.
      if (candidate.includes("@") && extractDomain(candidate)) {
        return candidate.slice(0, 300);
      }
    }
  }
  return undefined;
}
