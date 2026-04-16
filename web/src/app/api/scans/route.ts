import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createScan, getScans, updateScanStatus, updateScanProgress } from "@/lib/data/scans";
import { getActiveConnection } from "@/lib/data/connections";
import { bulkCreateInvoices } from "@/lib/data/invoices";
import { db } from "@/lib/db";
import { normalizeDomain, cleanCompanyName, normalizeCurrency } from "@/lib/utils";
import { dispatchScan } from "@/lib/worker";

/** Extract clean domain from an email like "Name <user@domain.com>" or "user@domain.com" */
function extractDomain(sender?: string): string | undefined {
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
function extractCompany(sender?: string): string | undefined {
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
  const COMPOUND_TLDS = [
    "co.il", "co.uk", "co.jp", "co.kr", "co.in", "co.za", "co.nz",
    "com.au", "com.br", "com.mx", "com.ar", "com.tw", "com.sg",
    "org.uk", "org.il", "net.il", "ac.il", "ac.uk", "gov.il",
  ];
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
  // Must match NOISE_SUBDOMAINS in utils.ts to avoid brand divergence
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
  const parts = base.split(".").filter((p) => p && !NOISE.has(p));
  const brand = parts.length > 0 ? parts[parts.length - 1] : base;
  if (!brand || brand.length < 2) return undefined;
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

/** For PayPal receipts, extract the actual vendor from the subject line.
 *  e.g. "Receipt for Your Payment to Shopify International" → "Shopify"
 *  Works for ALL PayPal vendors, not just hardcoded names.
 */
function extractVendorFromSubject(subject?: string, sender?: string): string | undefined {
  if (!subject || !sender) return undefined;
  const domain = extractDomain(sender);
  if (!domain) return undefined;
  const domainLower = domain.toLowerCase();
  // Only apply to PayPal senders
  if (!domainLower.includes("paypal")) return undefined;

  // Match PayPal receipt subject formats:
  //   "Receipt for Your Payment to [VENDOR]"
  //   "Receipt for Payment to [VENDOR]"
  //   "You sent a payment to [VENDOR]"
  //   "You paid [VENDOR]"
  const m = subject.match(/(?:payment\s+to|paid\s+to|you\s+paid)\s+(.+)/i);
  if (!m) return undefined;

  // Clean vendor name: strip trailing "International", "Inc.", "Ltd.", etc.
  let vendor = m[1]
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

/** Normalize known company name variants to canonical brand names */
function normalizeCompanyName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("facebookmail") || lower === "facebook" ||
      lower === "instagram" ||
      lower.includes("meta for business") || lower.includes("meta platforms")) {
    return "Meta";
  }
  return name;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const scans = await getScans(orgId);
  return NextResponse.json({ scans });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  // Get active Gmail connection
  const connection = await getActiveConnection(orgId);
  if (!connection) {
    return NextResponse.json(
      { error: "No Gmail account connected" },
      { status: 400 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const keywords = Array.isArray(body.keywords)
    ? body.keywords
        .filter((k: unknown) => typeof k === "string" && k.length <= 200)
        .map((k: string) => k.trim())
        .filter((k: string) => k.length > 0)
        .slice(0, 20)
    : [];
  const daysBack = typeof body.daysBack === "number" && Number.isInteger(body.daysBack) && body.daysBack >= 1 && body.daysBack <= 365
    ? body.daysBack
    : 30;
  const unreadOnly = typeof body.unreadOnly === "boolean" ? body.unreadOnly : true;

  // Duplicate scan prevention: block if a RUNNING scan already exists for this org
  const runningScan = await db.scan.findFirst({
    where: { organizationId: orgId, status: { in: ["PENDING", "RUNNING"] } },
    select: { id: true },
  });
  if (runningScan) {
    return NextResponse.json(
      { error: "A scan is already in progress. Please wait for it to complete or cancel it first." },
      { status: 429 }
    );
  }

  const scan = await createScan(orgId, connection.id, {
    keywords,
    daysBack,
    unreadOnly,
  });

  // Set scan to RUNNING immediately
  await updateScanStatus(orgId, scan.id, {
    status: "RUNNING",
    startedAt: new Date(),
  });

  // Run the heavy dispatch in the background so the POST returns immediately
  after(async () => {
    try {
      // Check if scan was cancelled before processing even starts
      const preCheck = await db.scan.findUnique({ where: { id: scan.id }, select: { status: true } });
      if (preCheck?.status === "CANCELLED") return;

      const result = await dispatchScan(
        scan.id,
        {
          accessToken: connection.accessToken,
          refreshToken: connection.refreshToken,
          tokenExpiry: connection.tokenExpiry,
        },
        { keywords, daysBack, unreadOnly },
        async (progress, message) => {
          await updateScanProgress(scan.id, progress, message);
        }
      );

      if (result.error) {
        await updateScanStatus(orgId, scan.id, {
          status: "FAILED",
          progress: 100,
          progressMessage: result.error,
          errorMessage: result.error,
          completedAt: new Date(),
        });
        return;
      }

      // Check if scan was cancelled while worker was running
      const midCheck = await db.scan.findUnique({ where: { id: scan.id }, select: { status: true } });
      if (midCheck?.status === "CANCELLED") return;

      // ── Scan-time quality filter ────────────────────────────────────

      function shouldPersist(inv: any): boolean {
        const tier = inv.classification_tier ?? "not_invoice";
        // confirmed/likely/possible always persist
        if (tier !== "not_invoice") return true;
        // not_invoice: only persist if score shows real invoice evidence
        // (sender domain alone is not enough — need subject/body/attachment signal)
        const score = inv.classification_score ?? 0;
        if (score < 5) return false;
        const signals: any[] = inv.classification_signals ?? [];
        const hasContentSignal = signals.some((s: any) =>
          s.score > 0 && s.signal !== "sender_invoice_domain"
        );
        return hasContentSignal;
      }

      const persistable = result.invoices.filter(shouldPersist);

      if (persistable.length > 0) {
        const invoiceRows = persistable.map((inv) => ({
          gmailMessageId: inv.uid ?? `unknown-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          subject: inv.subject ?? "(no subject)",
          sender: inv.sender ?? "",
          senderDomain: extractDomain(inv.sender),
          company: extractVendorFromSubject(inv.subject, inv.sender)
            || normalizeCompanyName(inv.company || extractCompany(inv.sender) || "")
            || undefined,
          date: inv.date ? new Date(inv.date) : undefined,
          amount: inv.amount ?? undefined,
          currency: normalizeCurrency(inv.currency ?? "ILS"),
          classificationTier: inv.classification_tier ?? "not_invoice",
          classificationScore: inv.classification_score ?? 0,
          classificationSignals: inv.classification_signals,
          bodyHtml: inv.body_html || undefined,
          hasAttachment: (inv.attachments?.length ?? 0) > 0,
          attachmentPath: inv.saved_path || undefined,
          notes: inv.notes || undefined,
          reportStatus: "INCLUDED" as const,
        }));

        // Insert new invoices (skipDuplicates for idempotency)
        const createResult = await bulkCreateInvoices(orgId, scan.id, invoiceRows);
        console.log(`[Scan ${scan.id}] bulkCreate: ${createResult.count} new, ${invoiceRows.length} total`);

        // ALWAYS re-associate ALL matching invoices to this scan.
        // createMany with skipDuplicates does NOT update existing rows,
        // so we must explicitly set scanId on duplicates.
        const messageIds = invoiceRows
          .map((r) => r.gmailMessageId)
          .filter((id) => !id.startsWith("unknown-"));
        if (messageIds.length > 0) {
          // Batch in chunks of 500 to avoid oversized IN clauses
          for (let i = 0; i < messageIds.length; i += 500) {
            const chunk = messageIds.slice(i, i + 500);
            const reassocResult = await db.invoice.updateMany({
              where: {
                organizationId: orgId,
                gmailMessageId: { in: chunk },
              },
              data: { scanId: scan.id, reportStatus: "INCLUDED" },
            });
            console.log(`[Scan ${scan.id}] re-associated chunk ${i}-${i + chunk.length}: ${reassocResult.count} rows`);
          }
        }

        // Backfill bodyHtml for existing invoices that were missing it.
        // createMany with skipDuplicates does NOT update existing rows,
        // so invoices from older scans may have NULL bodyHtml.
        const htmlBackfills = invoiceRows.filter(
          (r) => r.bodyHtml && !r.gmailMessageId.startsWith("unknown-")
        );
        if (htmlBackfills.length > 0) {
          const backfillResult = await db.$transaction(
            htmlBackfills.map((r) =>
              db.invoice.updateMany({
                where: {
                  organizationId: orgId,
                  gmailMessageId: r.gmailMessageId,
                  bodyHtml: null,
                },
                data: { bodyHtml: r.bodyHtml },
              })
            )
          );
          const filled = backfillResult.reduce((sum, r) => sum + r.count, 0);
          if (filled > 0) {
            console.log(`[Scan ${scan.id}] backfilled bodyHtml for ${filled} existing invoices`);
          }
        }

        // Backfill company for existing invoices that were scanned before
        // vendor extraction was improved (e.g., PayPal receipts with Meta/Shopify).
        const companyBackfills = invoiceRows.filter(
          (r) => r.company && !r.gmailMessageId.startsWith("unknown-")
        );
        if (companyBackfills.length > 0) {
          const companyResult = await db.$transaction(
            companyBackfills.map((r) =>
              db.invoice.updateMany({
                where: {
                  organizationId: orgId,
                  gmailMessageId: r.gmailMessageId,
                  company: { not: r.company },
                },
                data: { company: r.company },
              })
            )
          );
          const filled = companyResult.reduce((sum, r) => sum + r.count, 0);
          if (filled > 0) {
            console.log(`[Scan ${scan.id}] backfilled company for ${filled} existing invoices`);
          }
        }
      }

      // ── Honour existing supplier exclusions ───────────────────────
      // If the user previously unchecked a supplier, re-exclude its invoices
      // so a re-scan doesn't silently re-include them.
      // Uses company-first brand logic to avoid over-excluding shared domains
      // (e.g., paypal.co.il serves Meta, Shopify, and generic PayPal invoices).
      const excludedSuppliers = await db.supplier.findMany({
        where: { organizationId: orgId, isRelevant: false },
        select: { name: true },
      });
      if (excludedSuppliers.length > 0) {
        const excludedBrands = new Set(
          excludedSuppliers.map((s) => s.name.toLowerCase())
        );
        const scanInvs = await db.invoice.findMany({
          where: { organizationId: orgId, scanId: scan.id },
          select: { id: true, company: true, senderDomain: true },
        });
        const idsToExclude = scanInvs
          .filter((inv) => {
            const brand =
              cleanCompanyName(inv.company?.trim().toLowerCase() ?? "") ||
              (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null);
            return brand != null && excludedBrands.has(brand);
          })
          .map((inv) => inv.id);
        for (let i = 0; i < idsToExclude.length; i += 500) {
          await db.invoice.updateMany({
            where: { id: { in: idsToExclude.slice(i, i + 500) } },
            data: { reportStatus: "EXCLUDED" },
          });
        }
      }

      // Atomically mark complete ONLY if still RUNNING — no TOCTOU gap.
      // Guards against both user cancellation AND recoverStuckScans race.
      await db.scan.updateMany({
        where: { id: scan.id, organizationId: orgId, status: "RUNNING" },
        data: {
          status: "COMPLETED",
          totalMessages: result.total_messages,
          processedCount: result.invoices.length,
          invoiceCount: persistable.length,
          progress: 100,
          progressMessage: `Complete — ${persistable.length} saved from ${result.total_messages} emails`,
          completedAt: new Date(),
        },
      });

      // Invalidate cached invoices page so new scan appears in dropdown
      revalidatePath("/invoices");
      revalidatePath("/scans");
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "Worker dispatch failed";
      // Log the full error server-side for debugging
      console.error(`[Scan ${scan.id}] dispatch error:`, raw);
      // Sanitize: strip internal paths, connection strings, and stack traces
      // before persisting — this message is returned to the client.
      const safeMsg = raw
        .replace(/(?:\/[^\s:]+)+/g, "[path]")           // file paths
        .replace(/(?:postgres|mysql|redis|mongodb)\S+/gi, "[redacted]") // connection URIs
        .slice(0, 300);
      await updateScanStatus(orgId, scan.id, {
        status: "FAILED",
        progress: 100,
        progressMessage: safeMsg,
        errorMessage: safeMsg,
        completedAt: new Date(),
      });
    }
  });

  // Return immediately — scan is RUNNING, client will poll for progress
  return NextResponse.json(
    { scan: { ...scan, status: "RUNNING" } },
    { status: 201 }
  );
}
