import { formatCurrency, normalizeCurrency } from "@/lib/utils";

/**
 * Compact currency formatter for headline stats (KPI cards).
 *
 * The dashboard "Total Amount" card renders at text-4xl inside a fixed
 * 4-column grid — a full "1,234,567.89 ₪" string overflows the card. Large
 * values therefore render compactly (₪1.2M / ₪150K); callers are expected to
 * surface the FULL formatCurrency() value via a title/tooltip (see StatCard's
 * valueTitle prop). Small values delegate to formatCurrency unchanged so
 * everyday amounts keep their exact appearance.
 *
 *   |amount| >= 100,000 → compact notation, 1 fraction digit  (₪1.2M, ₪150K)
 *   |amount| >= 10,000  → full digits, no decimals            (45,231 ₪)
 *   |amount| <  10,000  → formatCurrency as-is                 (842.50 ₪)
 *
 * The compact branch uses the en-US locale on purpose: he-IL compact
 * notation renders verbal Hebrew magnitude suffixes ("מיליון") that are
 * longer than the number they abbreviate and mix RTL text into the LTR
 * card layout.
 */
export function formatCurrencyCompact(amount: number, currency = "ILS"): string {
  const abs = Math.abs(amount);
  if (abs < 10_000) return formatCurrency(amount, currency);

  const code = normalizeCurrency(currency ?? "ILS").toUpperCase();
  const compact = abs >= 100_000;
  const locale = compact ? "en-US" : "he-IL";
  const options: Intl.NumberFormatOptions = compact
    ? { style: "currency", currency: code, notation: "compact", maximumFractionDigits: 1 }
    : { style: "currency", currency: code, maximumFractionDigits: 0 };

  try {
    return new Intl.NumberFormat(locale, options).format(amount);
  } catch {
    // Invalid/unknown currency code — fall back to ILS (same posture as formatCurrency)
    return new Intl.NumberFormat(locale, { ...options, currency: "ILS" }).format(amount);
  }
}
