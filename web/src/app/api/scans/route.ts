import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { createScan, getScans, updateScanStatus, updateScanProgress } from "@/lib/data/scans";
import { getActiveConnection } from "@/lib/data/connections";
import { bulkCreateInvoices } from "@/lib/data/invoices";
import { dispatchScan } from "@/lib/worker";

/** Extract clean domain from an email like "Name <user@domain.com>" or "user@domain.com" */
function extractDomain(sender?: string): string | undefined {
  if (!sender) return undefined;
  // Extract email from "Display Name <email@domain.com>" format
  const match = sender.match(/<([^>]+)>/) || sender.match(/[\w.+-]+@[\w.-]+/);
  const email = match ? match[1] || match[0] : sender;
  const parts = email.split("@");
  return parts.length > 1 ? parts[1].replace(/[^a-zA-Z0-9.-]/g, "") : undefined;
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
      const INCLUDED_TIERS = new Set(["confirmed_invoice", "likely_invoice"]);

      function shouldPersist(inv: any): boolean {
        const tier = inv.classification_tier ?? "not_invoice";
        if (tier !== "not_invoice") return true;
        const score = inv.classification_score ?? 0;
        if (score < 0) return false;
        const signals: any[] = inv.classification_signals ?? [];
        return signals.some((s: any) => s.score > 0);
      }

      const persistable = result.invoices.filter(shouldPersist);

      if (persistable.length > 0) {
        await bulkCreateInvoices(
          orgId,
          scan.id,
          persistable.map((inv) => ({
            gmailMessageId: inv.uid ?? `unknown-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            subject: inv.subject ?? "(no subject)",
            sender: inv.sender ?? "",
            senderDomain: extractDomain(inv.sender),
            company: inv.company || undefined,
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
            reportStatus: INCLUDED_TIERS.has(inv.classification_tier ?? "")
              ? ("INCLUDED" as const)
              : ("EXCLUDED" as const),
          }))
        );
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
