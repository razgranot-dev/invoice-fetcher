import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const symbolToCode: Record<string, string> = {
  "₪": "ILS",
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
};

export function formatCurrency(amount: number, currency = "ILS"): string {
  const code = symbolToCode[currency] ?? currency?.toUpperCase() ?? "ILS";

  try {
    return new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Invalid/unknown currency code — fall back to ILS
    return new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: "ILS",
      minimumFractionDigits: 2,
    }).format(amount);
  }
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Derive a clean, human-readable supplier name from a sender domain.
 *
 * Examples:
 *   info.hostinger.com   → Hostinger
 *   billing.amazon.com   → Amazon
 *   invoices.microsoft.com → Microsoft
 *   noreply@paypal.com   → Paypal (handles full email too)
 *   mail.google.com      → Google
 *   some-company.co.il   → Some Company
 */
const NOISE_SUBDOMAINS = new Set([
  "info", "billing", "invoices", "invoice", "mail", "email", "e-mail",
  "noreply", "no-reply", "donotreply", "support", "help", "contact",
  "notifications", "notification", "notify", "alerts", "alert",
  "accounts", "account", "payments", "payment", "orders", "order",
  "receipts", "receipt", "service", "services", "mailer", "news",
  "newsletter", "updates", "www", "smtp", "mx", "bounce", "postmaster",
]);

/** Canonical brand aliases — merge related domains under one supplier name */
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

/**
 * Normalize a sender domain/email to a lowercase brand key.
 * Used for deduplication: info.hostinger.com & billing.hostinger.com → "hostinger"
 */
export function normalizeDomain(raw: string): string {
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

/**
 * Derive a clean, human-readable supplier display name.
 * Capitalizes the normalized brand: "hostinger" → "Hostinger"
 */
export function cleanDomainName(raw: string): string {
  if (!raw) return raw;
  const brand = normalizeDomain(raw);
  if (!brand) return raw;
  return brand
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
