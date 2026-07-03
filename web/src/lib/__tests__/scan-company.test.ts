import { describe, it, expect } from "vitest";
import {
  extractDomain,
  extractCompany,
  extractVendorFromSubject,
  normalizeCompanyName,
  isForwarded,
  stripForwardPrefix,
  extractForwardedOriginalSender,
} from "../scan-company";

/**
 * REGRESSION GUARD for the 2026-05 production outage.
 *
 * The "unify duplicate suppliers" commit called `cleanCompanyName(...)` inside
 * the scan route's `extractCompany` without importing it. Every scan threw
 * `ReferenceError: cleanCompanyName is not defined` during finalization and was
 * marked FAILED with 0 invoices saved. The existing tests re-implemented
 * `cleanCompanyName` locally, so they never exercised the real import chain and
 * couldn't catch it.
 *
 * These tests import the REAL module so that any broken/missing import in the
 * company-resolution path fails the suite (and `next build`) instead of every
 * production scan. The first block asserts the functions are callable; the rest
 * pin behaviour the scan route relies on.
 */

describe("scan-company module — import integrity (outage regression)", () => {
  it("exports callable helpers (would throw at import/call if a dep import is missing)", () => {
    expect(typeof extractDomain).toBe("function");
    expect(typeof extractCompany).toBe("function");
    expect(typeof extractVendorFromSubject).toBe("function");
    expect(typeof normalizeCompanyName).toBe("function");
  });

  it("extractCompany runs the cleanCompanyName path without throwing", () => {
    // This exact call shape (display name → cleanCompanyName) is what threw
    // ReferenceError in production. It must return a string, not blow up.
    expect(() => extractCompany("Anthropic, PBC <invoice@mail.anthropic.com>")).not.toThrow();
    expect(typeof extractCompany("Gett Receipts <noreply@gett.com>")).toBe("string");
  });
});

describe("extractDomain", () => {
  it("pulls domain from 'Name <user@domain>'", () => {
    expect(extractDomain("Anthropic <invoice@mail.anthropic.com>")).toBe("mail.anthropic.com");
  });
  it("pulls domain from a bare address", () => {
    expect(extractDomain("billing@stripe.com")).toBe("stripe.com");
  });
  it("returns undefined for empty input", () => {
    expect(extractDomain(undefined)).toBeUndefined();
    expect(extractDomain("")).toBeUndefined();
  });
});

describe("extractCompany — noise stripping + domain fallback", () => {
  it("strips trailing noise words from display names", () => {
    expect(extractCompany("Gett Receipts <noreply@gett.com>")).toBe("Gett");
    expect(extractCompany("Amazon Billing <auto@amazon.com>")).toBe("Amazon");
  });
  it("falls back to the domain brand when there is no usable display name", () => {
    expect(extractCompany("noreply@hostinger.com")).toBe("Hostinger");
  });
  it("handles compound TLDs (paypal.co.il → Paypal)", () => {
    expect(extractCompany("service@paypal.co.il")).toBe("Paypal");
  });
  it("skips noise subdomains when deriving brand from domain", () => {
    expect(extractCompany("noreply@billing.microsoft.com")).toBe("Microsoft");
  });
});

describe("extractVendorFromSubject — PayPal vendor extraction", () => {
  it("extracts the vendor a PayPal payment went to", () => {
    expect(
      extractVendorFromSubject("Receipt for your payment to Shopify International", "service@paypal.com")
    ).toBe("Shopify");
  });
  it("normalizes Meta/Facebook variants", () => {
    expect(
      extractVendorFromSubject("You sent a payment to Facebook", "service@paypal.com")
    ).toBe("Meta");
  });
  it("returns undefined for non-PayPal senders", () => {
    expect(
      extractVendorFromSubject("Receipt for your payment to Shopify", "billing@stripe.com")
    ).toBeUndefined();
  });
  it("strips a leading amount in 'You paid $X to VENDOR'", () => {
    expect(
      extractVendorFromSubject("You paid $9.99 USD to Spotify", "service@paypal.com")
    ).toBe("Spotify");
  });
  it("handles 'You sent a payment of $X to VENDOR'", () => {
    expect(
      extractVendorFromSubject("You sent a payment of $29.00 USD to Shopify", "service@paypal.com")
    ).toBe("Shopify");
  });
  it("extracts the merchant from a Hebrew PayPal subject", () => {
    expect(
      extractVendorFromSubject("קבלה עבור התשלום שלך ל-Higgsfield", "service@paypal.com")
    ).toBe("Higgsfield");
  });
  it("extracts the merchant from a STRIPE 'receipt from X' subject (not just PayPal)", () => {
    expect(
      extractVendorFromSubject("Your receipt from Vercel", "receipts@stripe.com")
    ).toBe("Vercel");
    expect(
      extractVendorFromSubject("Receipt from Higgsfield", "invoice+statements@stripe.com")
    ).toBe("Higgsfield");
  });
  it("returns undefined for non-processor senders (their domain brand is correct)", () => {
    expect(extractVendorFromSubject("Your invoice", "billing@vercel.com")).toBeUndefined();
  });
});

describe("extractCompany — noise display names fall through to the domain brand", () => {
  it("'Billing' display name does not shadow the real domain", () => {
    expect(extractCompany('"Billing" <noreply@acmecorp.com>')).toBe("Acmecorp");
  });
  it("'Receipts' display name resolves to the real brand, not a phantom 'Receipts' supplier", () => {
    expect(extractCompany('"Receipts" <receipts@higgsfield.ai>')).toBe("Higgsfield");
  });
  it("a real display name is still used", () => {
    expect(extractCompany('"Higgsfield AI" <team@higgsfield.ai>')).toContain("Higgsfield");
  });
});

describe("extractVendorFromSubject — subject-like capture guards (M8)", () => {
  it("truncates the PayPal capture at 'for' free text", () => {
    expect(
      extractVendorFromSubject(
        "You sent a payment of $4.00 USD to 刘云 for Detailed Payment Request 0085",
        "PayPal <service@paypal.com>"
      )
    ).toBe("刘云");
  });
  it("rejects captures with long digit runs (order/request numbers)", () => {
    expect(
      extractVendorFromSubject(
        "Receipt for your payment to order number 000123456789",
        "service@paypal.com"
      )
    ).toBeUndefined();
  });
  it("rejects sentence-length captures (> 5 tokens)", () => {
    expect(
      extractVendorFromSubject(
        "Receipt for your payment to the awesome shop that ships worldwide always",
        "service@paypal.com"
      )
    ).toBeUndefined();
  });
  it("still extracts normal multi-word vendors", () => {
    expect(
      extractVendorFromSubject(
        "Receipt for your payment to Beigel Bake",
        "service@paypal.com"
      )
    ).toBe("Beigel Bake");
  });
  it("truncates at commas (legal-suffix tails)", () => {
    expect(
      extractVendorFromSubject(
        "Your receipt from Anthropic, PBC",
        "receipts@stripe.com"
      )
    ).toBe("Anthropic");
  });
});

describe("forwarded-email attribution (M11)", () => {
  it("detects English and Hebrew forward prefixes", () => {
    expect(isForwarded("Fwd: Your receipt from Anthropic")).toBe(true);
    expect(isForwarded("FW: invoice")).toBe(true);
    expect(isForwarded("הועבר: קבלה")).toBe(true);
    expect(isForwarded("Your receipt from Anthropic")).toBe(false);
    expect(isForwarded(undefined)).toBe(false);
  });

  it("strips stacked forward prefixes from the subject", () => {
    expect(stripForwardPrefix("Fwd: Fwd: Your receipt")).toBe("Your receipt");
    expect(stripForwardPrefix("הועבר: קבלה על תשלום")).toBe("קבלה על תשלום");
  });

  it("extracts the original sender from a plain-text forwarded block", () => {
    const body =
      "---------- Forwarded message ---------\n" +
      "From: Anthropic <invoicing@anthropic.com>\n" +
      "Date: Tue, Jun 30, 2026\n" +
      "Subject: Your receipt from Anthropic, PBC\n";
    expect(extractForwardedOriginalSender(body, null)).toBe(
      "Anthropic <invoicing@anthropic.com>"
    );
  });

  it("extracts the original sender from Gmail-style forwarded HTML", () => {
    const html =
      "<div>---------- Forwarded message ---------<br>" +
      'From: <b>Anthropic</b> &lt;<a href="mailto:invoicing@anthropic.com">invoicing@anthropic.com</a>&gt;<br>' +
      "Date: Tue, Jun 30, 2026<br></div>";
    const sender = extractForwardedOriginalSender(null, html);
    expect(sender).toBeDefined();
    expect(extractDomain(sender)).toBe("anthropic.com");
    expect(extractCompany(sender)).toContain("Anthropic");
  });

  it("extracts the original sender from a Hebrew מאת: header", () => {
    const body = "הודעה שהועברה\nמאת: בזק <billing@bezeq.co.il>\nתאריך: 30.6.2026\n";
    const sender = extractForwardedOriginalSender(body, null);
    expect(sender).toBeDefined();
    expect(extractDomain(sender)).toBe("bezeq.co.il");
  });

  it("returns undefined when no embedded From header carries an address", () => {
    expect(extractForwardedOriginalSender("From: my accountant\n", null)).toBeUndefined();
    expect(extractForwardedOriginalSender("no headers here", null)).toBeUndefined();
    expect(extractForwardedOriginalSender(null, null)).toBeUndefined();
  });

  it("end-to-end: forwarded receipt resolves to the ORIGINAL brand, not the forwarder", () => {
    // Mirrors the scans-route wiring: effectiveSender feeds extractCompany.
    const body = "From: Anthropic <invoicing@anthropic.com>\n";
    const forwarder = "Accountant <acc@gmail.com>";
    const effectiveSender = extractForwardedOriginalSender(body, null) ?? forwarder;
    expect(extractCompany(effectiveSender)).toBe("Anthropic");
  });
});

describe("normalizeCompanyName — brand variants", () => {
  it("folds Meta-family names to 'Meta'", () => {
    expect(normalizeCompanyName("facebookmail")).toBe("Meta");
    expect(normalizeCompanyName("Meta Platforms")).toBe("Meta");
    expect(normalizeCompanyName("instagram")).toBe("Meta");
  });
  it("leaves unrelated names unchanged", () => {
    expect(normalizeCompanyName("Anthropic")).toBe("Anthropic");
  });
});
