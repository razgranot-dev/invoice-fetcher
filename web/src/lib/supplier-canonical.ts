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

// Business suffixes stripped during canonicalization
const BUSINESS_SUFFIXES = new Set([
  "inc", "inc.", "llc", "ltd", "ltd.", "pbc", "gmbh",
  "sa", "s.a.", "bv", "b.v.", "pvt", "pte", "corp", "corp.",
  "co", "co.", "limited", "international", "ag", "holdings",
  "technologies", "platforms",
]);

/**
 * Brand-alias map: canonical key (lowercase) → variants we should fold in.
 * Each entry lists the variant strings we expect to see in either the
 * `company` field or via the senderDomain-normalised brand path.
 *
 * Hebrew variants live alongside English so that "בזק" resolves to the
 * same canonical "bezeq" as "Bezeq International".
 */
const ALIAS_GROUPS: Record<string, string[]> = {
  // ── Tech / SaaS ──────────────────────────────────────────────
  anthropic: ["anthropic", "anthropic pbc", "anthropic, pbc", "claude", "claude team",
              "claude.com", "mail.anthropic.com"],
  google: ["google", "google play", "google llc", "google cloud", "google cloud platform",
           "google cloud platform firebase and apis", "google one", "google workspace",
           "google ai", "youtube", "youtube premium", "gmail",
           "יומן google", "google calendar", "payments.google.com", "pay.google.com"],
  apple: ["apple", "apple services", "apple inc", "icloud", "itunes", "app store",
          "apple.com", "email.apple.com", "apple pay"],
  meta: ["meta", "facebook", "meta platforms", "meta for business",
         "facebookmail", "instagram", "whatsapp", "facebook.com"],
  microsoft: ["microsoft", "azure", "xbox", "microsoft 365", "office 365",
              "microsoft.com"],
  amazon: ["amazon", "amazon web services", "aws", "amazon.com",
           "aws.amazon.com", "amazonaws.com", "amazon prime"],
  github: ["github", "github inc", "github, inc", "github, inc.", "noreply.github.com",
           "github copilot", "github sponsors"],
  hostinger: ["hostinger", "hostinger us", "mailer.hostinger.com"],
  adobe: ["adobe", "adobe creative cloud", "adobe acrobat", "adobe.com"],
  vercel: ["vercel", "vercel inc", "vercel.com"],
  render: ["render", "render.com"],
  netlify: ["netlify", "netlify.com"],
  cloudflare: ["cloudflare", "cloudflare inc", "cloudflare.com"],
  openai: ["openai", "openai inc", "chatgpt", "openai ads", "openai ads gpt opco llc",
           "openai ads gpt opco,llc via testflight", "gpt opco", "tm.openai.com",
           "email.openai.com"],
  stripe: ["stripe", "stripe inc", "stripe.com"],
  paypal: ["paypal", "paypal europe", "paypal inc", "paypal pte", "paypal.co.il",
           "paypal.com"],
  shopify: ["shopify", "shopify international", "shopify inc", "shopify.com"],
  notion: ["notion", "notion labs", "notion.so"],
  canva: ["canva", "canva pro", "canva.com"],
  wix: ["wix", "wix studio", "wix.com"],
  squarespace: ["squarespace", "squarespace.com"],
  godaddy: ["godaddy", "godaddy.com"],
  namecheap: ["namecheap", "namecheap.com"],
  dropbox: ["dropbox", "dropbox.com"],
  spotify: ["spotify", "spotify ab", "spotify.com"],
  netflix: ["netflix", "netflix.com"],
  zoom: ["zoom", "zoom.us", "zoom video"],
  linkedin: ["linkedin", "linkedin premium", "linkedin.com"],
  digitalocean: ["digitalocean", "digital ocean", "digitalocean.com"],
  heroku: ["heroku", "heroku.com"],

  // ── E-commerce ──────────────────────────────────────────────
  aliexpress: ["aliexpress", "aliexpress.seller", "ali express", "aliexpress.com",
               "alibaba.com",  // intentionally NOT — see below
              ].filter((v) => v !== "alibaba.com"),
  alibaba: ["alibaba", "alibaba remind", "alibaba.com", "alibaba group"],
  ebay: ["ebay", "ebay.com"],
  etsy: ["etsy", "etsy.com"],
  temu: ["temu", "temuemail", "temu.com"],
  shein: ["shein", "shein.com"],

  // ── Ride-sharing / delivery ──────────────────────────────────
  uber: ["uber", "uber eats", "uber one", "uber technologies", "uber.com",
         "receipts.uber.com"],
  lyft: ["lyft", "lyftmail", "lyft inc", "marketing.lyftmail.com"],
  gett: ["gett", "gett receipts", "gett receipt", "gett.com"],
  bolt: ["bolt", "bolt eu", "bolt.eu"],
  bird: ["bird", "bird rides", "bird.co"],

  // ── Food delivery ────────────────────────────────────────────
  wolt: ["wolt", "wolt israel", "wolt.com"],
  doordash: ["doordash", "doordash inc", "doordash.com"],
  deliveroo: ["deliveroo", "deliveroo.com"],
  grubhub: ["grubhub", "grubhub.com"],
  "10bis": ["10bis", "tenbis", "תן ביס", "10bis.co.il", "tenbis.co.il"],
  cibus: ["cibus", "סיבוס", "cibus.co.il"],
  lazada: ["lazada", "lazada customer care", "lazada thailand", "lazada singapore",
           "support.lazada.co.th"],

  // ── Travel / OTAs ────────────────────────────────────────────
  booking: ["booking", "booking.com"],
  airbnb: ["airbnb", "airbnb.com"],
  expedia: ["expedia", "expedia.com"],
  hotels: ["hotels", "hotels.com"],
  agoda: ["agoda", "agoda.com"],
  wizzair: ["wizzair", "wizz air", "wizzair.com"],
  elal: ["elal", "el al", "el al matmid program", "el al matmid", "elal.co.il"],

  // ── Hotel chains ─────────────────────────────────────────────
  hilton: ["hilton", "hilton honors", "hilton.com"],
  marriott: ["marriott", "marriott bonvoy", "marriott.com"],
  ihg: ["ihg", "ihg.com"],
  hyatt: ["hyatt", "hyatt.com"],
  accor: ["accor", "accor.com"],

  // ── Israeli telecom / utilities (English + Hebrew names map together) ──
  bezeq: ["bezeq", "בזק", "bezeq international", "bezeq.co.il"],
  cellcom: ["cellcom", "סלקום", "cellcom israel", "cellcom.co.il"],
  partner: ["partner", "פרטנר", "partner communications", "partner.co.il"],
  pelephone: ["pelephone", "פלאפון", "pelephone.co.il"],
  hot: ["hot", "הוט", "hot.net.il"],
  "electric-company": ["electric company", "חברת החשמל", "חברת חשמל", "electric.co.il"],
  yad2: ["yad2", "יד2", "mail.yad2.co.il"],

  // ── Transfer / misc ──────────────────────────────────────────
  wetransfer: ["wetransfer", "we transfer", "wetransfer.com"],
};

// Display names (canonical key → user-visible string).
const DISPLAY_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  google: "Google",
  apple: "Apple",
  meta: "Meta",
  microsoft: "Microsoft",
  amazon: "Amazon",
  github: "GitHub",
  hostinger: "Hostinger",
  adobe: "Adobe",
  vercel: "Vercel",
  render: "Render",
  netlify: "Netlify",
  cloudflare: "Cloudflare",
  openai: "OpenAI",
  stripe: "Stripe",
  paypal: "PayPal",
  shopify: "Shopify",
  notion: "Notion",
  canva: "Canva",
  wix: "Wix",
  squarespace: "Squarespace",
  godaddy: "GoDaddy",
  namecheap: "Namecheap",
  dropbox: "Dropbox",
  spotify: "Spotify",
  netflix: "Netflix",
  zoom: "Zoom",
  linkedin: "LinkedIn",
  digitalocean: "DigitalOcean",
  heroku: "Heroku",
  aliexpress: "AliExpress",
  alibaba: "Alibaba",
  ebay: "eBay",
  etsy: "Etsy",
  temu: "Temu",
  shein: "Shein",
  uber: "Uber",
  lyft: "Lyft",
  gett: "Gett",
  bolt: "Bolt",
  bird: "Bird Rides",
  wolt: "Wolt",
  doordash: "DoorDash",
  deliveroo: "Deliveroo",
  grubhub: "GrubHub",
  "10bis": "10bis",
  cibus: "Cibus",
  lazada: "Lazada",
  booking: "Booking.com",
  airbnb: "Airbnb",
  expedia: "Expedia",
  hotels: "Hotels.com",
  agoda: "Agoda",
  wizzair: "Wizz Air",
  elal: "El Al",
  hilton: "Hilton",
  marriott: "Marriott",
  ihg: "IHG",
  hyatt: "Hyatt",
  accor: "Accor",
  bezeq: "Bezeq",
  cellcom: "Cellcom",
  partner: "Partner",
  pelephone: "Pelephone",
  hot: "HOT",
  "electric-company": "Israel Electric",
  yad2: "Yad2",
  wetransfer: "WeTransfer",
};

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
 * Strip business suffixes from a name. "Anthropic, PBC" → "anthropic",
 * "Stripe Inc." → "stripe", "Meta Platforms" → "meta".
 */
function stripBusinessSuffix(name: string): string {
  const lower = name.toLowerCase().trim();
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
  const lower = stripBidiMarks(String(raw)).toLowerCase().trim();
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

  // 4. First-word fallback: "Apple TV+" → "apple"
  //    Only triggers if first word alone is a known canonical key.
  const firstWord = stripped.split(/\s+/)[0];
  if (firstWord && firstWord !== stripped && ALIAS_TO_KEY.has(firstWord)) {
    return ALIAS_TO_KEY.get(firstWord)!;
  }

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
        return suffixStripped;
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
