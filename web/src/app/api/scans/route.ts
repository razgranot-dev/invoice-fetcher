import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createScan, getScans, updateScanStatus, updateScanProgress } from "@/lib/data/scans";
import { getActiveConnection } from "@/lib/data/connections";
import { bulkCreateInvoices } from "@/lib/data/invoices";
import { getDomainsForBrand } from "@/lib/data/suppliers";
import { db } from "@/lib/db";
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
      return name;
    }
  }

  // Fall back to domain brand name
  const domain = extractDomain(sender);
  if (!domain) return undefined;

  // Strip subdomains and TLD to get brand: "billing.hostinger.com" → "hostinger"
  const parts = domain.split(".");
  if (parts.length < 2) return undefined;
  // Take the second-to-last part (brand), capitalize first letter
  const brand = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  if (!brand || brand.length < 2) return undefined;
  return brand.charAt(0).toUpperCase() + brand.slice(1);
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

  const body = await req.json();
  const keywords = body.keywords ?? [];
  const daysBack = body.daysBack ?? 30;
  const unreadOnly = body.unreadOnly ?? true;

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
          company: inv.company || extractCompany(inv.sender) || undefined,
          date: inv.date ? new Date(inv.date) : undefined,
          amount: inv.amount ?? undefined,
          currency: inv.currency ?? "ILS",
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
      }

      // ── Honour existing supplier exclusions ───────────────────────
      // If the user previously unchecked a supplier, re-exclude its invoices
      // so a re-scan doesn't silently re-include them.
      const excludedSuppliers = await db.supplier.findMany({
        where: { organizationId: orgId, isRelevant: false },
        select: { name: true },
      });
      for (const { name } of excludedSuppliers) {
        const domains = await getDomainsForBrand(orgId, name);
        if (domains.length > 0) {
          await db.invoice.updateMany({
            where: { organizationId: orgId, scanId: scan.id, senderDomain: { in: domains } },
            data: { reportStatus: "EXCLUDED" },
          });
        }
        await db.invoice.updateMany({
          where: {
            organizationId: orgId,
            scanId: scan.id,
            company: { equals: name, mode: "insensitive" },
            ...(domains.length > 0 ? { senderDomain: { notIn: domains } } : {}),
          },
          data: { reportStatus: "EXCLUDED" },
        });
      }

      await updateScanStatus(orgId, scan.id, {
        status: "COMPLETED",
        totalMessages: result.total_messages,
        processedCount: result.invoices.length,
        invoiceCount: persistable.length,
        progress: 100,
        progressMessage: `Complete — ${persistable.length} saved from ${result.total_messages} emails`,
        completedAt: new Date(),
      });

      // Invalidate cached invoices page so new scan appears in dropdown
      revalidatePath("/invoices");
      revalidatePath("/scans");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Worker dispatch failed";
      await updateScanStatus(orgId, scan.id, {
        status: "FAILED",
        progress: 100,
        progressMessage: msg,
        errorMessage: msg,
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
