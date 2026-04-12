import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { auth } from "@/lib/auth";
import { getInvoices } from "@/lib/data/invoices";
import { createExport, getExports, updateExportStatus, updateExportProgress } from "@/lib/data/exports";
import { dispatchWordExport, dispatchScreenshotZip } from "@/lib/worker";
import { db } from "@/lib/db";

// Vercel serverless: process.cwd() is read-only, use /tmp for ephemeral files
const EXPORTS_DIR = process.env.VERCEL
  ? path.join("/tmp", "exports")
  : path.join(process.cwd(), "exports");

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId as string | undefined;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const exports = await getExports(orgId);
  return NextResponse.json({ exports });
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

  const body = await req.json();
  const format = body.format as "WORD" | "ZIP_SCREENSHOTS";
  const filters = body.filters ?? {};
  const includeScreenshots = body.includeScreenshots === true;

  if (format !== "WORD" && format !== "ZIP_SCREENSHOTS") {
    return NextResponse.json(
      { error: "Supported formats: WORD, ZIP_SCREENSHOTS" },
      { status: 400 }
    );
  }

  // Query invoices matching filters — default to INCLUDED only for exports
  if (!filters.reportStatus) filters.reportStatus = "INCLUDED";
  const invoices = await getInvoices(orgId, filters, 10000);

  if (invoices.length === 0) {
    return NextResponse.json(
      { error: "No invoices match the current filters" },
      { status: 400 }
    );
  }

  // Get org name for the report header
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });

  // Create export record
  const exp = await createExport(orgId, {
    format,
    invoiceCount: invoices.length,
  });

  // Process async — response returns immediately
  after(async () => {
    try {
      await updateExportStatus(orgId, exp.id, { status: "PROCESSING" });

      const progressCb = async (progress: number, message: string) => {
        await updateExportProgress(orgId, exp.id, progress, message);
      };

      let result: Awaited<ReturnType<typeof dispatchWordExport>>;
      let fileExt: string;

      if (format === "ZIP_SCREENSHOTS") {
        result = await dispatchScreenshotZip(
          invoices as unknown as Array<Record<string, unknown>>,
          progressCb
        );
        fileExt = "zip";
      } else {
        result = await dispatchWordExport(
          invoices as unknown as Array<Record<string, unknown>>,
          org?.name ?? "Organization",
          includeScreenshots,
          progressCb
        );
        fileExt = "docx";
      }

      await mkdir(EXPORTS_DIR, { recursive: true });
      const filePath = path.join(EXPORTS_DIR, `${exp.id}.${fileExt}`);
      await writeFile(filePath, result.file);

      // Build a human-readable failure summary for the UI
      let completionMessage = "Complete";
      if (result.failures && result.failures.length > 0) {
        const byReason = new Map<string, string[]>();
        for (const f of result.failures) {
          const list = byReason.get(f.reason) ?? [];
          list.push(f.supplier);
          byReason.set(f.reason, list);
        }
        const parts: string[] = [];
        for (const [reason, suppliers] of byReason) {
          parts.push(`${suppliers.length}x ${reason} (${suppliers.slice(0, 3).join(", ")}${suppliers.length > 3 ? "..." : ""})`);
        }
        completionMessage = `${result.failures.length} screenshot(s) failed: ${parts.join("; ")}`;
      }

      await updateExportProgress(orgId, exp.id, 100, completionMessage);
      await updateExportStatus(orgId, exp.id, {
        status: "COMPLETED",
        filePath,
        fileSize: result.file.length,
        completedAt: new Date(),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Export generation failed";
      await updateExportStatus(orgId, exp.id, {
        status: "FAILED",
        errorMessage: msg,
      });
    }
  });

  return NextResponse.json(
    { export: { id: exp.id, status: "PENDING", format } },
    { status: 201 }
  );
}
