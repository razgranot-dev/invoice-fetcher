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
import { cleanCompanyName } from "@/lib/utils";

/** Noise subdomains/words to skip when deriving a brand from a domain.
 *  MUST stay in sync with NOISE_SUBDOMAINS in utils.ts to avoid brand divergence. */
const NOISE = new Set([
  "info", "billing", "invoices", "invoice", "mail", "email", "e-mail",
  "noreply", "no-reply", "donotreply", "support", "help", "contact",
  "notifications", "notification", "notify", "alerts", "alert",
  "accounts", "account", "payments", "payment", "orders", "order",
  "receipts", "receipt", "reciept", "reciepts", "service", "services", "mailer", "news",
  "newsletter", "updates", "www", "smtp", "mx", "bounce", "postmaster",
  // Hotel loyalty program suffixes — prevent "Marriott Bonvoy" vs "Marriott" duplicates
  "bonvoy", "honors",
]);

/** Compound TLDs that must be stripped as a unit (paypal.co.il → paypal). */
const COMPOUND_TLDS = [
  "co.il", "co.uk", "co.jp", "co.kr", "co.in", "co.za", "co.nz",
  "com.au", "com.br", "com.mx", "com.ar", "com.tw", "com.sg",
  "org.uk", "org.il", "net.il", "ac.il", "ac.uk", "gov.il",
];

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

/** For PayPal receipts, extract the actual vendor from the subject line.
 *  e.g. "Receipt for Your Payment to Shopify International" → "Shopify".
 *  Works for ALL PayPal vendors, not just hardcoded names.
 */
export function extractVendorFromSubject(subject?: string, sender?: string): string | undefined {
  if (!subject || !sender) return undefined;
  const domain = extractDomain(sender);
  if (!domain) return undefined;
  const domainLower = domain.toLowerCase();
  // Only apply to PayPal senders
  if (!domainLower.includes("paypal")) return undefined;

  // Match PayPal receipt subject formats (EN). The amount may sit between the
  // verb and the merchant ("You paid $9.99 to Spotify", "You sent a payment of
  // $29.00 USD to Shopify"), so we accept an optional amount inside the match
  // AND strip any leading amount from the captured vendor below.
  //   "Receipt for Your Payment to [VENDOR]"
  //   "You sent a payment (of $X) to [VENDOR]"
  //   "You paid ($X to) [VENDOR]"
  const m = subject.match(
    /(?:payment\s+to|paid\s+to|sent\s+(?:a\s+payment\s+)?(?:of\s+\S+\s+)?(?:\S+\s+)?to|you\s+paid)\s+(.+)/i
  );
  if (!m) return undefined;

  // Clean vendor name: drop a leading amount ("$9.99 to ", "29.00 USD to "),
  // then strip trailing "International", "Inc.", "Ltd.", etc.
  const vendor = m[1]
    .replace(/^(?:US)?[$₪€£]?\s?[\d,]+\.\d{2}\s*(?:USD|ILS|EUR|GBP|CAD|AUD)?\s*(?:to\s+)?/i, "")
    .replace(/\s+international\s*$/i, "")
    .replace(/,?\s*(?:inc\.?|ltd\.?|llc\.?|gmbh|s\.?a\.?|b\.?v\.?|pvt\.?)\s*$/i, "")
    .trim();
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
