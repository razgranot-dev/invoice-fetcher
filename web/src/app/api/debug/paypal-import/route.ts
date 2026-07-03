import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createScan, updateScanStatus } from "@/lib/data/scans";
import { getActiveConnection } from "@/lib/data/connections";
import { bulkCreateInvoices } from "@/lib/data/invoices";
import { normalizeCurrency } from "@/lib/utils";
import { canonicalSupplierKey, canonicalDisplayName, UNKNOWN_KEY } from "@/lib/supplier-canonical";
import {
  extractDomain,
  extractCompany,
  extractVendorFromSubject,
  normalizeCompanyName,
} from "@/lib/scan-company";
import { dispatchPaypalImport } from "@/lib/worker";

/**
 * Emergency PayPal direct import.
 *   POST /api/debug/paypal-import?days=730
 *
 * Bypasses the general scan query: runs `from:paypal OR paypal` on the worker,
 * persists valid PayPal transactions with the SAME idempotent dedup as a normal
 * scan (unique on organizationId+gmailMessageId → no duplicates), and returns a
 * full "where did it become zero" funnel + dashboard-visible counts.
 *
 * Authenticated org member only; touches only the caller's own org/mailbox.
 */
export const maxDuration = 300;

function shouldPersist(inv: any): boolean {
  const tier = inv.classification_tier ?? "not_invoice";
  if (tier !== "not_invoice") return true;
  const score = inv.classification_score ?? 0;
  if (score < 5) return false;
  const signals: any[] = inv.classification_signals ?? [];
  return signals.some((s: any) => s.score > 0 && s.signal !== "sender_invoice_domain");
}

function defaultReportStatus(tier: string): "INCLUDED" | "EXCLUDED" {
  return tier === "confirmed_invoice" || tier === "likely_invoice" ? "INCLUDED" : "EXCLUDED";
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = (session as any).organizationId as string | undefined;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? "730");
  const daysBack = Number.isFinite(daysParam)
    ? Math.min(Math.max(Math.trunc(daysParam), 1), 730)
    : 730;

  const connection = await getActiveConnection(orgId);
  if (!connection) {
    return NextResponse.json({ error: "No active Gmail connection. Connect Gmail first." }, { status: 200 });
  }

  // 1. Run the worker's PayPal-only discovery + classification.
  let workerResult;
  try {
    workerResult = await dispatchPaypalImport(
      {
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        tokenExpiry: connection.tokenExpiry,
      },
      daysBack
    );
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "worker import failed" },
      { status: 200 }
    );
  }

  if (workerResult.auth_ok === false) {
    return NextResponse.json({
      gmailConnection: { email: connection.email, hasGmailScope: connection.scopes?.includes("https://www.googleapis.com/auth/gmail.readonly") ?? false },
      authError: workerResult.auth_error,
      hint: "Reconnect Gmail (tick the Gmail box on Google's consent screen).",
    });
  }

  const invoices = workerResult.invoices ?? [];
  const persistable = invoices.filter(shouldPersist);

  // 2. Persist with the SAME mapping + canonical resolver as the normal scan.
  const scan = await createScan(orgId, connection.id, {
    keywords: ["paypal-emergency-import"],
    daysBack,
    unreadOnly: false,
  });
  await updateScanStatus(orgId, scan.id, { status: "RUNNING", startedAt: new Date() });

  const invoiceRows = persistable.map((inv: any) => {
    const senderDomain = extractDomain(inv.sender);
    const rawCompany =
      extractVendorFromSubject(inv.subject, inv.sender) ||
      normalizeCompanyName(inv.company || extractCompany(inv.sender) || "") ||
      undefined;
    const canonicalKey = canonicalSupplierKey({
      company: rawCompany ?? null,
      senderDomain: senderDomain ?? null,
    });
    const canonicalCompany = canonicalKey ? canonicalDisplayName(canonicalKey) : rawCompany || undefined;
    const tier = inv.classification_tier ?? "not_invoice";
    return {
      gmailMessageId: inv.uid ?? `unknown-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      subject: inv.subject ?? "(no subject)",
      sender: inv.sender ?? "",
      senderDomain,
      company: canonicalCompany,
      // S1: same write-time canonical identity as the normal scan path.
      supplierKey: canonicalKey || UNKNOWN_KEY,
      date: inv.date ? new Date(inv.date) : undefined,
      amount: inv.amount ?? undefined,
      currency: normalizeCurrency(inv.currency ?? "USD"),
      classificationTier: tier,
      classificationScore: inv.classification_score ?? 0,
      classificationSignals: inv.classification_signals,
      bodyHtml: inv.body_html || undefined,
      hasAttachment: (inv.attachments?.length ?? 0) > 0,
      notes: inv.notes || undefined,
      reportStatus: defaultReportStatus(tier),
    };
  });

  let created = 0;
  if (invoiceRows.length > 0) {
    const createResult = await bulkCreateInvoices(orgId, scan.id, invoiceRows);
    created = createResult.count;
    // Re-associate duplicates (already-existing rows) to this scan so the
    // count reflects all PayPal rows, and refresh their report status.
    const ids = invoiceRows
      .filter((r) => !r.gmailMessageId.startsWith("unknown-"))
      .map((r) => r.gmailMessageId);
    for (let i = 0; i < ids.length; i += 500) {
      await db.invoice.updateMany({
        where: { organizationId: orgId, gmailMessageId: { in: ids.slice(i, i + 500) } },
        data: { scanId: scan.id },
      });
    }
  }

  await updateScanStatus(orgId, scan.id, {
    status: "COMPLETED",
    totalMessages: workerResult.funnel?.fetched ?? invoices.length,
    processedCount: invoices.length,
    invoiceCount: invoiceRows.filter((r) => r.reportStatus === "INCLUDED").length,
    progress: 100,
    progressMessage: `PayPal emergency import — ${invoiceRows.length} saved`,
    completedAt: new Date(),
  });

  // 3. Dashboard-visible counts (prove the rows are queryable).
  const [rowsForScan, paypalSenderRows, includedForScan] = await Promise.all([
    db.invoice.count({ where: { organizationId: orgId, scanId: scan.id } }),
    db.invoice.count({ where: { organizationId: orgId, senderDomain: { contains: "paypal" } } }),
    db.invoice.count({ where: { organizationId: orgId, scanId: scan.id, reportStatus: "INCLUDED" } }),
  ]);

  return NextResponse.json({
    workerVersion: workerResult.worker_version,
    importQuery: workerResult.import_query,
    gmailConnection: {
      email: connection.email,
      hasGmailScope: connection.scopes?.includes("https://www.googleapis.com/auth/gmail.readonly") ?? false,
    },
    funnel: {
      ...workerResult.funnel,
      persistable: persistable.length,
      newlyCreated: created,
      dashboardVisibleForScan: rowsForScan,
      dashboardIncludedForScan: includedForScan,
      orgPaypalSenderRows: paypalSenderRows,
    },
    skipReasons: workerResult.skip_reasons ?? [],
    scanId: scan.id,
    invoicesUrl: `/invoices?scanId=${scan.id}`,
  });
}
