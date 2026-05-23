// .mjs mirror of web/src/lib/supplier-canonical.ts for use by maintenance
// scripts. Keep the alias table in lock-step with the TS source — there are
// unit tests in web/src/lib/__tests__/supplier-canonical.test.ts that pin
// the canonical behaviour against this list.

const BUSINESS_SUFFIXES = new Set([
  "inc", "inc.", "llc", "ltd", "ltd.", "pbc", "gmbh",
  "sa", "s.a.", "bv", "b.v.", "pvt", "pte", "corp", "corp.",
  "co", "co.", "limited", "international", "ag", "holdings",
  "technologies", "platforms",
]);

const ALIAS_GROUPS = {
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
  microsoft: ["microsoft", "azure", "xbox", "microsoft 365", "office 365", "microsoft.com"],
  amazon: ["amazon", "amazon web services", "aws", "amazon.com", "aws.amazon.com",
           "amazonaws.com", "amazon prime"],
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
  aliexpress: ["aliexpress", "aliexpress.seller", "ali express", "aliexpress.com"],
  alibaba: ["alibaba", "alibaba remind", "alibaba.com", "alibaba group"],
  ebay: ["ebay", "ebay.com"],
  etsy: ["etsy", "etsy.com"],
  temu: ["temu", "temuemail", "temu.com"],
  shein: ["shein", "shein.com"],
  uber: ["uber", "uber eats", "uber one", "uber technologies", "uber.com",
         "receipts.uber.com"],
  lyft: ["lyft", "lyftmail", "lyft inc", "marketing.lyftmail.com"],
  gett: ["gett", "gett receipts", "gett receipt", "gett.com"],
  bolt: ["bolt", "bolt eu", "bolt.eu"],
  bird: ["bird", "bird rides", "bird.co"],
  wolt: ["wolt", "wolt israel", "wolt.com"],
  doordash: ["doordash", "doordash inc", "doordash.com"],
  deliveroo: ["deliveroo", "deliveroo.com"],
  grubhub: ["grubhub", "grubhub.com"],
  "10bis": ["10bis", "tenbis", "תן ביס", "10bis.co.il", "tenbis.co.il"],
  cibus: ["cibus", "סיבוס", "cibus.co.il"],
  lazada: ["lazada", "lazada customer care", "lazada thailand", "lazada singapore",
           "support.lazada.co.th"],
  booking: ["booking", "booking.com"],
  airbnb: ["airbnb", "airbnb.com"],
  expedia: ["expedia", "expedia.com"],
  hotels: ["hotels", "hotels.com"],
  agoda: ["agoda", "agoda.com"],
  wizzair: ["wizzair", "wizz air", "wizzair.com"],
  elal: ["elal", "el al", "el al matmid program", "el al matmid", "elal.co.il"],
  hilton: ["hilton", "hilton honors", "hilton.com"],
  marriott: ["marriott", "marriott bonvoy", "marriott.com"],
  ihg: ["ihg", "ihg.com"],
  hyatt: ["hyatt", "hyatt.com"],
  accor: ["accor", "accor.com"],
  bezeq: ["bezeq", "בזק", "bezeq international", "bezeq.co.il"],
  cellcom: ["cellcom", "סלקום", "cellcom israel", "cellcom.co.il"],
  partner: ["partner", "פרטנר", "partner communications", "partner.co.il"],
  pelephone: ["pelephone", "פלאפון", "pelephone.co.il"],
  hot: ["hot", "הוט", "hot.net.il"],
  "electric-company": ["electric company", "חברת החשמל", "חברת חשמל", "electric.co.il"],
  yad2: ["yad2", "יד2", "mail.yad2.co.il"],
  wetransfer: ["wetransfer", "we transfer", "wetransfer.com"],
};

const DISPLAY_NAMES = {
  anthropic: "Anthropic", google: "Google", apple: "Apple", meta: "Meta",
  microsoft: "Microsoft", amazon: "Amazon", github: "GitHub", hostinger: "Hostinger",
  adobe: "Adobe", vercel: "Vercel", render: "Render", netlify: "Netlify",
  cloudflare: "Cloudflare", openai: "OpenAI", stripe: "Stripe", paypal: "PayPal",
  shopify: "Shopify", notion: "Notion", canva: "Canva", wix: "Wix",
  squarespace: "Squarespace", godaddy: "GoDaddy", namecheap: "Namecheap",
  dropbox: "Dropbox", spotify: "Spotify", netflix: "Netflix", zoom: "Zoom",
  linkedin: "LinkedIn", digitalocean: "DigitalOcean", heroku: "Heroku",
  aliexpress: "AliExpress", alibaba: "Alibaba", ebay: "eBay", etsy: "Etsy",
  temu: "Temu", shein: "Shein", uber: "Uber", lyft: "Lyft", gett: "Gett",
  bolt: "Bolt", bird: "Bird Rides", wolt: "Wolt", doordash: "DoorDash",
  deliveroo: "Deliveroo", grubhub: "GrubHub", "10bis": "10bis", cibus: "Cibus",
  lazada: "Lazada", booking: "Booking.com", airbnb: "Airbnb", expedia: "Expedia",
  hotels: "Hotels.com", agoda: "Agoda", wizzair: "Wizz Air", elal: "El Al",
  hilton: "Hilton", marriott: "Marriott", ihg: "IHG", hyatt: "Hyatt", accor: "Accor",
  bezeq: "Bezeq", cellcom: "Cellcom", partner: "Partner", pelephone: "Pelephone",
  hot: "HOT", "electric-company": "Israel Electric", yad2: "Yad2",
  wetransfer: "WeTransfer",
};

const ALIAS_TO_KEY = (() => {
  const m = new Map();
  for (const [canonical, aliases] of Object.entries(ALIAS_GROUPS)) {
    m.set(canonical, canonical);
    for (const a of aliases) m.set(a.toLowerCase().trim(), canonical);
  }
  return m;
})();

// Mirror of utils.ts NOISE_SUBDOMAINS + COMPOUND_TLDS for normalizeDomain
const NOISE_SUBDOMAINS = new Set([
  "info", "billing", "invoices", "invoice", "mail", "email", "e-mail",
  "noreply", "no-reply", "donotreply", "support", "help", "contact",
  "notifications", "notification", "notify", "alerts", "alert",
  "accounts", "account", "payments", "payment", "orders", "order",
  "receipts", "receipt", "reciept", "reciepts", "service", "services", "mailer", "news",
  "newsletter", "updates", "www", "smtp", "mx", "bounce", "postmaster",
  "bonvoy", "honors",
]);
const BRAND_ALIASES = { "facebookmail": "meta", "facebook": "meta", "instagram": "meta" };
const COMPOUND_TLDS = new Set([
  "co.il", "co.uk", "co.jp", "co.kr", "co.in", "co.za", "co.nz",
  "com.au", "com.br", "com.mx", "com.ar", "com.tw", "com.sg",
  "org.uk", "org.il", "net.il", "ac.il", "ac.uk", "gov.il",
]);

function normalizeDomain(raw) {
  if (!raw) return raw;
  let domain = raw.includes("@") ? raw.split("@")[1] : raw;
  domain = domain.toLowerCase().trim().replace(/[^a-z0-9.]+$/g, "").replace(/^[^a-z0-9]+/g, "");
  let base = domain;
  let tldStripped = false;
  for (const tld of COMPOUND_TLDS) {
    if (base.endsWith("." + tld)) { base = base.slice(0, -(tld.length + 1)); tldStripped = true; break; }
  }
  if (!tldStripped) base = base.replace(/\.[a-z]{2,6}$/, "");
  const parts = base.split(".").filter((p) => p && !NOISE_SUBDOMAINS.has(p));
  const rawBrand = parts.length > 0 ? parts[parts.length - 1] : base;
  const brand = BRAND_ALIASES[rawBrand] ?? rawBrand;
  return (brand.length >= 2 ? brand : base) || domain;
}

function cleanCompanyName(name) {
  if (!name) return "";
  const words = name.split(/[\s\-_]+/).filter((w) => w.length > 0);
  while (words.length > 1 && NOISE_SUBDOMAINS.has(words[words.length - 1].toLowerCase())) words.pop();
  while (words.length > 1 && NOISE_SUBDOMAINS.has(words[0].toLowerCase())) words.shift();
  return words.join(" ");
}

function stripBusinessSuffix(name) {
  const lower = name.toLowerCase().trim();
  const tokens = lower.replace(/[,]/g, " ").split(/\s+/).filter((w) => w.length > 0);
  while (tokens.length > 1 && BUSINESS_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

function stripBidiMarks(s) {
  return s.replace(/[‎‏‪-‮⁦-⁩]/g, "");
}

export function toCanonicalKey(raw) {
  if (!raw) return null;
  const lower = stripBidiMarks(String(raw)).toLowerCase().trim();
  if (!lower) return null;
  if (ALIAS_TO_KEY.has(lower)) return ALIAS_TO_KEY.get(lower);
  const stripped = stripBusinessSuffix(lower);
  if (stripped && stripped !== lower && ALIAS_TO_KEY.has(stripped)) return ALIAS_TO_KEY.get(stripped);
  const noSpaces = lower.replace(/\s+/g, "");
  if (noSpaces && noSpaces !== lower && ALIAS_TO_KEY.has(noSpaces)) return ALIAS_TO_KEY.get(noSpaces);
  const firstWord = stripped.split(/\s+/)[0];
  if (firstWord && firstWord !== stripped && ALIAS_TO_KEY.has(firstWord)) return ALIAS_TO_KEY.get(firstWord);
  return null;
}

export function canonicalSupplierKey({ company, senderDomain }) {
  if (company) {
    const cleaned = cleanCompanyName(company).toLowerCase().trim();
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
  if (senderDomain) {
    const brand = normalizeDomain(senderDomain);
    if (brand) {
      const aliased = toCanonicalKey(brand);
      if (aliased) return aliased;
      return brand;
    }
  }
  return "";
}

export function canonicalDisplayName(key) {
  if (!key) return "";
  if (DISPLAY_NAMES[key]) return DISPLAY_NAMES[key];
  return key.split(/[\s\-_]+/).filter((w) => w.length > 0)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}
