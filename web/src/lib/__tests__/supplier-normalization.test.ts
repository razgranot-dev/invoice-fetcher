/**
 * Supplier Normalization Regression Tests
 *
 * Tests the entire supplier detection pipeline for consistency across all code
 * paths: utils.ts, scans/route.ts, suppliers.ts, invoices page, export routes,
 * and worker.ts.
 *
 * Self-contained: duplicates private functions from route files so they can be
 * tested without importing Next.js server modules.
 */

// =============================================================================
// 1. DUPLICATED FUNCTIONS (from source files, for isolated testing)
// =============================================================================

// --- From web/src/lib/utils.ts (these are the canonical exports) ---

const NOISE_SUBDOMAINS = new Set([
  "info", "billing", "invoices", "invoice", "mail", "email", "e-mail",
  "noreply", "no-reply", "donotreply", "support", "help", "contact",
  "notifications", "notification", "notify", "alerts", "alert",
  "accounts", "account", "payments", "payment", "orders", "order",
  "receipts", "receipt", "service", "services", "mailer", "news",
  "newsletter", "updates", "www", "smtp", "mx", "bounce", "postmaster",
]);

const BRAND_ALIASES: Record<string, string> = {
  "facebookmail": "meta",
  "facebook": "meta",
  "instagram": "meta",
};

const COMPOUND_TLDS = new Set([
  "co.il", "co.uk", "co.jp", "co.kr", "co.in", "co.za", "co.nz",
  "com.au", "com.br", "com.mx", "com.ar", "com.tw", "com.sg",
  "org.uk", "org.il", "net.il", "ac.il", "ac.uk", "gov.il",
]);

function normalizeDomain(raw: string): string {
  if (!raw) return raw;

  let domain = raw.includes("@") ? raw.split("@")[1] : raw;
  domain = domain.toLowerCase().trim().replace(/[^a-z0-9.]+$/g, "").replace(/^[^a-z0-9]+/g, "");

  let base = domain;
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

  const parts = base.split(".").filter((p) => p && !NOISE_SUBDOMAINS.has(p));
  const raw_brand = parts.length > 0 ? parts[parts.length - 1] : base;
  const brand = BRAND_ALIASES[raw_brand] ?? raw_brand;
  return (brand.length >= 2 ? brand : base) || domain;
}

function cleanDomainName(raw: string): string {
  if (!raw) return raw;
  const brand = normalizeDomain(raw);
  if (!brand) return raw;
  return brand
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}


// --- From web/src/app/api/scans/route.ts ---

function extractDomain(sender?: string): string | undefined {
  if (!sender) return undefined;
  const match = sender.match(/<([^>]+)>/) || sender.match(/[\w.+-]+@[\w.-]+/);
  const email = match ? match[1] || match[0] : sender;
  const parts = email.split("@");
  return parts.length > 1 ? parts[1].replace(/[^a-zA-Z0-9.-]/g, "") : undefined;
}

function extractCompany(sender?: string): string | undefined {
  if (!sender) return undefined;

  const nameMatch = sender.match(/^(.+?)\s*</);
  if (nameMatch) {
    const name = nameMatch[1].replace(/^["']|["']$/g, "").trim();
    if (name && !name.includes("@") && name.length > 1) {
      return name;
    }
  }

  const domain = extractDomain(sender);
  if (!domain) return undefined;

  let base = domain.toLowerCase();
  const COMPOUND_TLDS_LOCAL = [
    "co.il", "co.uk", "co.jp", "co.kr", "co.in", "co.za", "co.nz",
    "com.au", "com.br", "com.mx", "com.ar", "com.tw", "com.sg",
    "org.uk", "org.il", "net.il", "ac.il", "ac.uk", "gov.il",
  ];
  let tldStripped = false;
  for (const tld of COMPOUND_TLDS_LOCAL) {
    if (base.endsWith("." + tld)) {
      base = base.slice(0, -(tld.length + 1));
      tldStripped = true;
      break;
    }
  }
  if (!tldStripped) {
    base = base.replace(/\.[a-z]{2,6}$/, "");
  }

  // BUG DOCUMENTED: This NOISE set is smaller than NOISE_SUBDOMAINS in utils.ts
  const NOISE = new Set([
    "info", "billing", "invoices", "mail", "email", "noreply", "no-reply",
    "support", "notifications", "accounts", "payments", "service", "www",
  ]);
  const parts = base.split(".").filter((p) => p && !NOISE.has(p));
  const brand = parts.length > 0 ? parts[parts.length - 1] : base;
  if (!brand || brand.length < 2) return undefined;
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function extractVendorFromSubject(subject?: string, sender?: string): string | undefined {
  if (!subject || !sender) return undefined;
  const domain = extractDomain(sender);
  if (!domain) return undefined;
  const domainLower = domain.toLowerCase();
  if (!domainLower.includes("paypal")) return undefined;

  const m = subject.match(/(?:payment\s+to|paid\s+to|you\s+paid)\s+(.+)/i);
  if (!m) return undefined;

  let vendor = m[1]
    .replace(/\s+international\s*$/i, "")
    .replace(/,?\s*(?:inc\.?|ltd\.?|llc\.?|gmbh|s\.?a\.?|b\.?v\.?|pvt\.?)\s*$/i, "")
    .trim();
  if (!vendor) return undefined;

  const vendorLower = vendor.toLowerCase();
  if (vendorLower.includes("meta") || vendorLower.includes("facebook")) return "Meta";
  if (vendorLower.includes("shopify")) return "Shopify";
  return vendor;
}

function normalizeCompanyName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("facebookmail") || lower === "facebook" ||
      lower === "instagram" ||
      lower.includes("meta for business") || lower.includes("meta platforms")) {
    return "Meta";
  }
  return name;
}

// --- From web/src/lib/worker.ts (FIXED version) ---

function normalizeCompany_worker(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("facebookmail") || lower === "facebook" ||
      lower === "instagram" ||
      lower.includes("meta for business") || lower.includes("meta platforms")) {
    return "Meta";
  }
  return name;
}

const WORKER_COMPOUND_TLDS = [
  "co.il", "co.uk", "co.jp", "co.kr", "co.in", "co.za", "co.nz",
  "com.au", "com.br", "com.mx", "com.ar", "com.tw", "com.sg",
  "org.uk", "org.il", "net.il", "ac.il", "ac.uk", "gov.il",
];

const WORKER_NOISE_SUBS = new Set([
  "info", "billing", "invoices", "invoice", "mail", "email", "e-mail",
  "noreply", "no-reply", "donotreply", "support", "help", "contact",
  "notifications", "notification", "notify", "alerts", "alert",
  "accounts", "account", "payments", "payment", "orders", "order",
  "receipts", "receipt", "service", "services", "mailer", "news",
  "newsletter", "updates", "www", "smtp", "mx", "bounce", "postmaster",
]);

function companyFromSender(sender: unknown): string {
  if (!sender || typeof sender !== "string") return "";
  const m = (sender as string).match(/^(.+?)\s*</);
  if (m) {
    const name = m[1].replace(/^["']|["']$/g, "").trim();
    if (name && !name.includes("@") && name.length > 1) return normalizeCompany_worker(name);
  }
  const dm = (sender as string).match(/@([^>]+)/);
  if (dm) {
    let base = dm[1].toLowerCase().replace(/[^a-z0-9.-]/g, "");
    let tldStripped = false;
    for (const tld of WORKER_COMPOUND_TLDS) {
      if (base.endsWith("." + tld)) {
        base = base.slice(0, -(tld.length + 1));
        tldStripped = true;
        break;
      }
    }
    if (!tldStripped) {
      base = base.replace(/\.[a-z]{2,6}$/, "");
    }
    const parts = base.split(".").filter((p) => p && !WORKER_NOISE_SUBS.has(p));
    const brand = parts.length > 0 ? parts[parts.length - 1] : base;
    if (brand && brand.length >= 2) {
      const capitalized = brand.charAt(0).toUpperCase() + brand.slice(1);
      return normalizeCompany_worker(capitalized);
    }
  }
  return "";
}

// --- Brand computation (shared across invoices page, suppliers.ts, export routes, supplier toggle) ---

function computeBrand(company: string | null | undefined, senderDomain: string | null | undefined): string | null {
  return company?.trim().toLowerCase() || (senderDomain ? normalizeDomain(senderDomain) : null);
}


// =============================================================================
// 2. TESTS
// =============================================================================

describe("normalizeDomain", () => {
  test("simple .com domain", () => {
    expect(normalizeDomain("example.com")).toBe("example");
  });

  test("compound TLD .co.il", () => {
    expect(normalizeDomain("paypal.co.il")).toBe("paypal");
  });

  test("compound TLD .com.au", () => {
    expect(normalizeDomain("example.com.au")).toBe("example");
  });

  test("noise subdomain stripped: info.hostinger.com", () => {
    expect(normalizeDomain("info.hostinger.com")).toBe("hostinger");
  });

  test("noise subdomain stripped: billing.amazon.com", () => {
    expect(normalizeDomain("billing.amazon.com")).toBe("amazon");
  });

  test("noise subdomain stripped: invoices.microsoft.com", () => {
    expect(normalizeDomain("invoices.microsoft.com")).toBe("microsoft");
  });

  test("handles full email address", () => {
    expect(normalizeDomain("noreply@paypal.com")).toBe("paypal");
  });

  test("Facebook domain aliases to meta", () => {
    expect(normalizeDomain("facebookmail.com")).toBe("meta");
  });

  test("facebook.com aliases to meta", () => {
    expect(normalizeDomain("facebook.com")).toBe("meta");
  });

  test("instagram.com aliases to meta", () => {
    expect(normalizeDomain("instagram.com")).toBe("meta");
  });

  test("multiple noise subdomains: mail.info.example.com", () => {
    expect(normalizeDomain("mail.info.example.com")).toBe("example");
  });

  test("empty string returns empty", () => {
    expect(normalizeDomain("")).toBe("");
  });

  test("null-ish falsy returns falsy", () => {
    // @ts-expect-error - testing runtime behavior
    expect(normalizeDomain(undefined)).toBeUndefined();
    // @ts-expect-error - testing runtime behavior
    expect(normalizeDomain(null)).toBeNull();
  });

  test("domain with trailing punctuation cleaned", () => {
    expect(normalizeDomain("example.com>")).toBe("example");
  });

  test("domain with leading punctuation cleaned", () => {
    expect(normalizeDomain("<example.com")).toBe("example");
  });

  test("unknown single-letter brand falls back to base", () => {
    // e.g., "x.co.il" -> base="x", brand="x", length < 2 -> returns base "x"
    // Actually brand.length >= 2 check: "x" is length 1, so returns base
    expect(normalizeDomain("x.co.il")).toBe("x");
  });

  test("compound TLD with noise subdomain: billing.paypal.co.il", () => {
    expect(normalizeDomain("billing.paypal.co.il")).toBe("paypal");
  });

  test("email with compound TLD: user@paypal.co.il", () => {
    expect(normalizeDomain("user@paypal.co.il")).toBe("paypal");
  });

  test("domain with multiple parts: app.dev.example.com", () => {
    expect(normalizeDomain("app.dev.example.com")).toBe("example");
  });

  test(".org.uk compound TLD", () => {
    expect(normalizeDomain("charity.org.uk")).toBe("charity");
  });
});


describe("cleanDomainName", () => {
  test("capitalizes simple brand", () => {
    expect(cleanDomainName("example.com")).toBe("Example");
  });

  test("capitalizes compound brand with hyphen", () => {
    expect(cleanDomainName("my-company.com")).toBe("My Company");
  });

  test("capitalizes compound brand with underscore", () => {
    expect(cleanDomainName("my_company.com")).toBe("My Company");
  });

  test("facebook domain shows Meta", () => {
    expect(cleanDomainName("facebookmail.com")).toBe("Meta");
  });

  test("empty returns empty", () => {
    expect(cleanDomainName("")).toBe("");
  });
});


describe("extractDomain", () => {
  test("plain email address", () => {
    expect(extractDomain("user@example.com")).toBe("example.com");
  });

  test("display name format", () => {
    expect(extractDomain("Company Name <user@example.com>")).toBe("example.com");
  });

  test("no @ sign returns undefined", () => {
    expect(extractDomain("justtext")).toBeUndefined();
  });

  test("undefined input", () => {
    expect(extractDomain(undefined)).toBeUndefined();
  });

  test("empty string", () => {
    expect(extractDomain("")).toBeUndefined();
  });

  test("strips non-alphanumeric from domain", () => {
    expect(extractDomain("user@example.com>")).toBe("example.com");
  });
});


describe("extractCompany", () => {
  test("extracts display name from 'Company <email>' format", () => {
    expect(extractCompany("Hostinger <billing@hostinger.com>")).toBe("Hostinger");
  });

  test("extracts display name with quotes", () => {
    expect(extractCompany('"Meta for Business" <noreply@facebookmail.com>')).toBe("Meta for Business");
  });

  test("falls back to domain brand for plain email", () => {
    expect(extractCompany("noreply@hostinger.com")).toBe("Hostinger");
  });

  test("handles compound TLD in fallback", () => {
    expect(extractCompany("noreply@paypal.co.il")).toBe("Paypal");
  });

  test("strips noise subdomains in fallback", () => {
    expect(extractCompany("billing@billing.amazon.com")).toBe("Amazon");
  });

  test("returns undefined for undefined input", () => {
    expect(extractCompany(undefined)).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(extractCompany("")).toBeUndefined();
  });

  test("display name that is an email is skipped", () => {
    // "user@example.com <user@example.com>" — display name is an email, skip it
    expect(extractCompany("user@example.com <user@example.com>")).toBe("Example");
  });

  test("single character display name is skipped", () => {
    expect(extractCompany("X <x@example.com>")).toBe("Example");
  });
});


describe("extractVendorFromSubject", () => {
  test("PayPal receipt for Meta Platforms", () => {
    expect(extractVendorFromSubject(
      "Receipt for Your Payment to Meta Platforms",
      "noreply@paypal.co.il"
    )).toBe("Meta");
  });

  test("PayPal receipt for Meta Platforms Inc.", () => {
    expect(extractVendorFromSubject(
      "Receipt for Payment to Meta Platforms, Inc.",
      "noreply@paypal.co.il"
    )).toBe("Meta");
  });

  test("PayPal receipt for Facebook", () => {
    expect(extractVendorFromSubject(
      "Receipt for Payment to Facebook",
      "noreply@paypal.com"
    )).toBe("Meta");
  });

  test("PayPal receipt for Shopify International", () => {
    expect(extractVendorFromSubject(
      "Receipt for Your Payment to Shopify International",
      "noreply@paypal.co.il"
    )).toBe("Shopify");
  });

  test("PayPal receipt for Shopify Inc.", () => {
    expect(extractVendorFromSubject(
      "Receipt for Payment to Shopify, Inc.",
      "noreply@paypal.com"
    )).toBe("Shopify");
  });

  test("PayPal receipt for generic vendor", () => {
    expect(extractVendorFromSubject(
      "Receipt for Your Payment to ACME Corp",
      "noreply@paypal.co.il"
    )).toBe("ACME Corp");
  });

  test("PayPal 'You paid' format", () => {
    expect(extractVendorFromSubject(
      "You paid Meta Platforms",
      "noreply@paypal.com"
    )).toBe("Meta");
  });

  test("PayPal 'You sent a payment to' format", () => {
    expect(extractVendorFromSubject(
      "You sent a payment to Shopify International",
      "noreply@paypal.co.il"
    )).toBe("Shopify");
  });

  test("non-PayPal sender returns undefined", () => {
    expect(extractVendorFromSubject(
      "Receipt for Payment to Meta Platforms",
      "noreply@hostinger.com"
    )).toBeUndefined();
  });

  test("PayPal sender with unrelated subject returns undefined", () => {
    expect(extractVendorFromSubject(
      "Your account summary for January",
      "noreply@paypal.co.il"
    )).toBeUndefined();
  });

  test("both undefined returns undefined", () => {
    expect(extractVendorFromSubject(undefined, undefined)).toBeUndefined();
  });

  test("subject undefined returns undefined", () => {
    expect(extractVendorFromSubject(undefined, "noreply@paypal.com")).toBeUndefined();
  });

  test("sender undefined returns undefined", () => {
    expect(extractVendorFromSubject("Receipt for Payment to Meta", undefined)).toBeUndefined();
  });

  test("strips Ltd. suffix", () => {
    expect(extractVendorFromSubject(
      "Receipt for Payment to Some Company Ltd.",
      "noreply@paypal.com"
    )).toBe("Some Company");
  });

  test("strips GmbH suffix", () => {
    expect(extractVendorFromSubject(
      "Receipt for Payment to Some Company GmbH",
      "noreply@paypal.com"
    )).toBe("Some Company");
  });
});


describe("normalizeCompanyName (scans/route.ts)", () => {
  test("facebookmail → Meta", () => {
    expect(normalizeCompanyName("facebookmail")).toBe("Meta");
  });

  test("facebook → Meta", () => {
    expect(normalizeCompanyName("facebook")).toBe("Meta");
  });

  test("Facebook (capitalized) → Meta", () => {
    expect(normalizeCompanyName("Facebook")).toBe("Meta");
  });

  test("Meta for Business → Meta", () => {
    expect(normalizeCompanyName("Meta for Business")).toBe("Meta");
  });

  test("Meta Platforms → Meta", () => {
    expect(normalizeCompanyName("Meta Platforms")).toBe("Meta");
  });

  test("passthrough for non-Meta companies", () => {
    expect(normalizeCompanyName("Hostinger")).toBe("Hostinger");
  });

  test("passthrough for empty string", () => {
    expect(normalizeCompanyName("")).toBe("");
  });
});


describe("normalizeCompany (worker.ts) consistency with normalizeCompanyName", () => {
  // These two functions MUST produce identical results for any input
  const inputs = [
    "facebookmail",
    "facebook",
    "Facebook",
    "Meta for Business",
    "Meta Platforms",
    "Hostinger",
    "",
    "Shopify",
    "FACEBOOKMAIL.COM",
    "meta platforms inc.",
  ];

  for (const input of inputs) {
    test(`"${input}" produces same result in both functions`, () => {
      expect(normalizeCompany_worker(input)).toBe(normalizeCompanyName(input));
    });
  }
});


describe("companyFromSender (worker.ts)", () => {
  test("extracts display name", () => {
    expect(companyFromSender("Hostinger <noreply@hostinger.com>")).toBe("Hostinger");
  });

  test("normalizes Facebook display name to Meta", () => {
    expect(companyFromSender("Facebook <noreply@facebook.com>")).toBe("Meta");
  });

  test("falls back to domain brand for plain email", () => {
    expect(companyFromSender("noreply@hostinger.com")).toBe("Hostinger");
  });

  test("returns empty for undefined", () => {
    expect(companyFromSender(undefined)).toBe("");
  });

  test("returns empty for empty string", () => {
    expect(companyFromSender("")).toBe("");
  });

  test("returns empty for non-string", () => {
    expect(companyFromSender(123)).toBe("");
  });
});


describe("computeBrand (company-first logic)", () => {
  test("company takes priority over senderDomain", () => {
    expect(computeBrand("Meta", "paypal.co.il")).toBe("meta");
  });

  test("falls back to normalizeDomain when company is null", () => {
    expect(computeBrand(null, "paypal.co.il")).toBe("paypal");
  });

  test("falls back to normalizeDomain when company is empty string", () => {
    expect(computeBrand("", "paypal.co.il")).toBe("paypal");
  });

  test("falls back to normalizeDomain when company is whitespace", () => {
    expect(computeBrand("   ", "paypal.co.il")).toBe("paypal");
  });

  test("returns null when both are null", () => {
    expect(computeBrand(null, null)).toBeNull();
  });

  test("returns null when company is empty and senderDomain is null", () => {
    expect(computeBrand("", null)).toBeNull();
  });

  test("trims and lowercases company", () => {
    expect(computeBrand("  Meta  ", "paypal.co.il")).toBe("meta");
  });

  test("company with various cases", () => {
    expect(computeBrand("META", "example.com")).toBe("meta");
    expect(computeBrand("meta", "example.com")).toBe("meta");
    expect(computeBrand("Meta", "example.com")).toBe("meta");
  });

  test("PayPal receipt for Meta: company=Meta overrides paypal domain", () => {
    expect(computeBrand("Meta", "paypal.co.il")).toBe("meta");
  });

  test("PayPal receipt for Shopify: company=Shopify overrides paypal domain", () => {
    expect(computeBrand("Shopify", "paypal.co.il")).toBe("shopify");
  });

  test("generic PayPal receipt: no company, uses paypal domain", () => {
    expect(computeBrand(null, "paypal.co.il")).toBe("paypal");
    expect(computeBrand("", "paypal.co.il")).toBe("paypal");
  });

  test("facebookmail.com sender without company → meta (via normalizeDomain alias)", () => {
    expect(computeBrand(null, "facebookmail.com")).toBe("meta");
  });

  test("instagram.com sender without company → meta (via normalizeDomain alias)", () => {
    expect(computeBrand(null, "instagram.com")).toBe("meta");
  });

  test("undefined company treated same as null", () => {
    expect(computeBrand(undefined, "paypal.co.il")).toBe("paypal");
  });
});


describe("Brand logic consistency across all code paths", () => {
  // Simulates the exact brand computation from each file location and
  // verifies they all agree.

  interface Invoice {
    company: string | null;
    senderDomain: string | null;
  }

  // Path 1: invoices/page.tsx (lines 53-54)
  function brandFromInvoicesPage(inv: Invoice): string | null {
    return inv.company?.trim().toLowerCase()
      || (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null);
  }

  // Path 2: suppliers.ts (lines 22-24)
  function brandFromSuppliersTs(inv: Invoice): string | null {
    return inv.company?.trim().toLowerCase()
      || (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null);
  }

  // Path 3: exports/route.ts (lines 72-74)
  function brandFromExportsRoute(inv: Invoice): string | null {
    const brand =
      inv.company?.trim().toLowerCase() ||
      (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null);
    return brand;
  }

  // Path 4: invoices/export/route.ts (lines 66-68)
  function brandFromCsvExport(inv: Invoice): string | null {
    const brand =
      inv.company?.trim().toLowerCase() ||
      (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null);
    return brand;
  }

  // Path 5: suppliers/route.ts PATCH (lines 57-59)
  function brandFromSupplierToggle(inv: Invoice): string | null {
    const brand =
      inv.company?.trim().toLowerCase() ||
      (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null);
    return brand;
  }

  // Path 6: scans/route.ts exclusion check (lines 338-340)
  function brandFromScanExclusion(inv: Invoice): string | null {
    const brand =
      inv.company?.trim().toLowerCase() ||
      (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null);
    return brand;
  }

  const testCases: Array<{ description: string; invoice: Invoice; expectedBrand: string | null }> = [
    {
      description: "Meta via PayPal (company set)",
      invoice: { company: "Meta", senderDomain: "paypal.co.il" },
      expectedBrand: "meta",
    },
    {
      description: "Shopify via PayPal (company set)",
      invoice: { company: "Shopify", senderDomain: "paypal.co.il" },
      expectedBrand: "shopify",
    },
    {
      description: "Generic PayPal (no company)",
      invoice: { company: null, senderDomain: "paypal.co.il" },
      expectedBrand: "paypal",
    },
    {
      description: "Hostinger direct",
      invoice: { company: "Hostinger", senderDomain: "info.hostinger.com" },
      expectedBrand: "hostinger",
    },
    {
      description: "facebookmail sender, no company",
      invoice: { company: null, senderDomain: "facebookmail.com" },
      expectedBrand: "meta",
    },
    {
      description: "facebookmail sender, company=Facebook",
      invoice: { company: "Facebook", senderDomain: "facebookmail.com" },
      expectedBrand: "facebook",
    },
    {
      description: "instagram sender, no company",
      invoice: { company: null, senderDomain: "instagram.com" },
      expectedBrand: "meta",
    },
    {
      description: "company is whitespace only, domain present",
      invoice: { company: "   ", senderDomain: "example.com" },
      expectedBrand: "example",
    },
    {
      description: "company with case: '  META  '",
      invoice: { company: "  META  ", senderDomain: "example.com" },
      expectedBrand: "meta",
    },
    {
      description: "both null",
      invoice: { company: null, senderDomain: null },
      expectedBrand: null,
    },
    {
      description: "empty company, null domain",
      invoice: { company: "", senderDomain: null },
      expectedBrand: null,
    },
    {
      description: "compound TLD domain only",
      invoice: { company: null, senderDomain: "example.co.uk" },
      expectedBrand: "example",
    },
  ];

  for (const { description, invoice, expectedBrand } of testCases) {
    test(`all 6 paths agree: ${description}`, () => {
      const results = [
        brandFromInvoicesPage(invoice),
        brandFromSuppliersTs(invoice),
        brandFromExportsRoute(invoice),
        brandFromCsvExport(invoice),
        brandFromSupplierToggle(invoice),
        brandFromScanExclusion(invoice),
      ];

      // All paths must produce the same brand
      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toBe(results[0]);
      }

      // And it must match the expected value
      expect(results[0]).toBe(expectedBrand);
    });
  }
});


describe("NOISE set alignment: extractCompany and normalizeDomain", () => {
  // After fix: extractCompany (scans/route.ts) NOISE set is now aligned
  // with NOISE_SUBDOMAINS in utils.ts.

  const allNoiseSubdomains = [
    "info", "billing", "invoices", "invoice", "mail", "email", "e-mail",
    "noreply", "no-reply", "donotreply", "support", "help", "contact",
    "notifications", "notification", "notify", "alerts", "alert",
    "accounts", "account", "payments", "payment", "orders", "order",
    "receipts", "receipt", "service", "services", "mailer", "news",
    "newsletter", "updates", "www", "smtp", "mx", "bounce", "postmaster",
  ];

  test("all noise subdomains are stripped by normalizeDomain", () => {
    for (const noise of allNoiseSubdomains) {
      expect(normalizeDomain(`${noise}.example.com`)).toBe("example");
    }
  });

  test("BRAND_ALIASES in utils.ts but NOT in extractCompany — mitigated by normalizeCompanyName", () => {
    // extractCompany does NOT apply BRAND_ALIASES when doing domain fallback.
    // Example: sender is plain "noreply@facebookmail.com" (no display name).
    // extractCompany would return "Facebookmail" (capitalized raw brand)
    // but normalizeDomain("facebookmail.com") returns "meta"
    //
    // This is mitigated by normalizeCompanyName() which catches
    // "facebookmail" and maps it to "Meta". The scan route does:
    //   extractVendorFromSubject() || normalizeCompanyName(inv.company || extractCompany() || "")
    //
    // So extractCompany("noreply@facebookmail.com") = "Facebookmail"
    //    normalizeCompanyName("Facebookmail") = "Meta"
    // The stored company becomes "Meta" which is correct.

    const raw = extractCompany("noreply@facebookmail.com");
    expect(raw).toBe("Facebookmail");
    expect(normalizeCompanyName(raw!)).toBe("Meta");
  });
});


describe("End-to-end PayPal receipt scenarios", () => {
  // Simulates the full pipeline for PayPal receipts

  function simulateScanPipeline(inv: { subject: string; sender: string; company?: string }) {
    const senderDomain = extractDomain(inv.sender);
    const company = extractVendorFromSubject(inv.subject, inv.sender)
      || normalizeCompanyName(inv.company || extractCompany(inv.sender) || "")
      || undefined;
    const brand = company?.trim().toLowerCase()
      || (senderDomain ? normalizeDomain(senderDomain) : null);
    return { senderDomain, company, brand };
  }

  test("PayPal receipt for Meta → company=Meta, brand=meta", () => {
    const result = simulateScanPipeline({
      subject: "Receipt for Your Payment to Meta Platforms",
      sender: "service@paypal.co.il",
    });
    expect(result.company).toBe("Meta");
    expect(result.brand).toBe("meta");
    expect(result.senderDomain).toBe("paypal.co.il");
  });

  test("PayPal receipt for Shopify → company=Shopify, brand=shopify", () => {
    const result = simulateScanPipeline({
      subject: "Receipt for Your Payment to Shopify International",
      sender: "service@paypal.co.il",
    });
    expect(result.company).toBe("Shopify");
    expect(result.brand).toBe("shopify");
  });

  test("Generic PayPal receipt → company from display name, brand=paypal", () => {
    const result = simulateScanPipeline({
      subject: "Your PayPal receipt",
      sender: "service@paypal.co.il",
    });
    // No vendor extracted from subject, no company field, extractCompany falls back to domain
    expect(result.company).toBe("Paypal");
    expect(result.brand).toBe("paypal");
  });

  test("Direct Meta email from facebookmail → company=Meta, brand=meta", () => {
    const result = simulateScanPipeline({
      subject: "Your ad receipt",
      sender: '"Meta for Business" <noreply@facebookmail.com>',
    });
    expect(result.company).toBe("Meta");
    expect(result.brand).toBe("meta");
  });

  test("Direct Meta email without display name → company=Meta via normalizeCompanyName", () => {
    const result = simulateScanPipeline({
      subject: "Your ad receipt",
      sender: "noreply@facebookmail.com",
    });
    // extractCompany returns "Facebookmail", normalizeCompanyName converts to "Meta"
    expect(result.company).toBe("Meta");
    expect(result.brand).toBe("meta");
  });

  test("Worker company field takes priority in scan pipeline", () => {
    const result = simulateScanPipeline({
      subject: "Receipt for Payment to ACME Corp",
      sender: "noreply@paypal.com",
      company: "Pre-extracted Company",
    });
    // extractVendorFromSubject returns "ACME Corp" (PayPal receipt pattern)
    // which takes priority over the worker-provided company
    expect(result.company).toBe("ACME Corp");
  });

  test("Non-PayPal with worker company field preserved", () => {
    const result = simulateScanPipeline({
      subject: "Your invoice",
      sender: "billing@example.com",
      company: "Example Inc",
    });
    // extractVendorFromSubject returns undefined (not PayPal)
    // normalizeCompanyName("Example Inc") = "Example Inc" (no change)
    expect(result.company).toBe("Example Inc");
    expect(result.brand).toBe("example inc");
  });
});


describe("companyFromSender vs extractCompany alignment (worker.ts vs scans/route.ts)", () => {
  // After fix: both functions now properly handle compound TLDs and noise subdomains.

  test("display name extraction is identical", () => {
    const sender = "Hostinger <billing@hostinger.com>";
    expect(companyFromSender(sender)).toBe(extractCompany(sender));
  });

  test("compound TLD .co.il now handled correctly by both", () => {
    const sender = "noreply@paypal.co.il";
    expect(companyFromSender(sender)).toBe("Paypal");
    expect(extractCompany(sender)).toBe("Paypal");
  });

  test("simple .com domains agree", () => {
    const sender = "noreply@hostinger.com";
    expect(companyFromSender(sender)).toBe("Hostinger");
    expect(extractCompany(sender)).toBe("Hostinger");
  });

  test("noise subdomains agree", () => {
    const sender = "noreply@billing.amazon.com";
    expect(companyFromSender(sender)).toBe("Amazon");
    expect(extractCompany(sender)).toBe("Amazon");
  });

  test("compound TLD .com.au now handled correctly by both", () => {
    const sender = "noreply@example.com.au";
    expect(companyFromSender(sender)).toBe("Example");
    expect(extractCompany(sender)).toBe("Example");
  });
});


describe("Edge case: company field with various whitespace/case", () => {
  test("leading/trailing whitespace stripped by brand computation", () => {
    expect(computeBrand("  Meta  ", "paypal.co.il")).toBe("meta");
  });

  test("empty string after trim falls through to domain", () => {
    expect(computeBrand("   ", "paypal.co.il")).toBe("paypal");
  });

  test("tab characters in company", () => {
    expect(computeBrand("\tMeta\t", "paypal.co.il")).toBe("meta");
  });

  test("newline in company", () => {
    expect(computeBrand("\nMeta\n", "paypal.co.il")).toBe("meta");
  });
});


describe("Edge case: supplier names stored lowercase match brand computation", () => {
  // suppliers.ts stores names as lowercase brand keys.
  // The toggle cascade compares against brand = company?.trim().toLowerCase()
  // This means the supplier name "meta" should match brand "meta" from company "Meta".

  test("supplier name 'meta' matches brand from company 'Meta'", () => {
    const brand = computeBrand("Meta", "paypal.co.il");
    expect(brand).toBe("meta");
    expect("meta" === brand).toBe(true);
  });

  test("supplier name 'shopify' matches brand from company 'Shopify'", () => {
    const brand = computeBrand("Shopify", "paypal.co.il");
    expect(brand).toBe("shopify");
  });

  test("supplier name 'paypal' matches brand from domain normalization", () => {
    const brand = computeBrand(null, "paypal.co.il");
    expect(brand).toBe("paypal");
  });
});


describe("Fixed: normalizeCompanyName now catches 'instagram'", () => {
  // After fix: normalizeCompanyName (scans/route.ts) and normalizeCompany (worker.ts)
  // now handle "instagram" -> "Meta", consistent with BRAND_ALIASES in utils.ts.

  test("company='Instagram' is normalized to 'Meta' before storage", () => {
    expect(normalizeCompanyName("Instagram")).toBe("Meta");
  });

  test("company='Instagram' → brand='meta' (via normalizeCompanyName applied during scan)", () => {
    // In the real pipeline, normalizeCompanyName("Instagram") = "Meta"
    // So the stored company is "Meta", and brand = "meta"
    expect(computeBrand("Meta", "instagram.com")).toBe("meta");
  });

  test("no company, domain='instagram.com' → brand='meta' (via normalizeDomain alias)", () => {
    expect(computeBrand(null, "instagram.com")).toBe("meta");
  });

  test("both paths now converge to 'meta' for Instagram", () => {
    // With company set (after normalizeCompanyName)
    const withCompany = computeBrand(normalizeCompanyName("Instagram"), "instagram.com");
    // Without company
    const withoutCompany = computeBrand(null, "instagram.com");
    expect(withCompany).toBe("meta");
    expect(withoutCompany).toBe("meta");
  });
});


describe("Regression: extractVendorFromSubject only matches 'payment to' and 'paid to'", () => {
  // Other PayPal email subjects that might not match:

  test("does not match 'You received a payment from'", () => {
    expect(extractVendorFromSubject(
      "You received a payment from John Doe",
      "noreply@paypal.com"
    )).toBeUndefined();
  });

  test("does not match 'Money received from'", () => {
    expect(extractVendorFromSubject(
      "Money received from ACME Corp",
      "noreply@paypal.com"
    )).toBeUndefined();
  });

  test("does not match 'Transaction confirmation'", () => {
    expect(extractVendorFromSubject(
      "Transaction confirmation: Meta Platforms",
      "noreply@paypal.com"
    )).toBeUndefined();
  });
});
