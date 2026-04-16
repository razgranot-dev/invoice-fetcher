import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getExportById } from "@/lib/data/exports";
import { proxyWorkerDownload } from "@/lib/worker";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const orgId = (session as any).organizationId as string | undefined;
  if (!orgId) {
    return new Response("No organization", { status: 403 });
  }

  const { id } = await params;

  // Validate path parameter format (cuid)
  if (!id || typeof id !== "string" || id.length > 100 || !/^c[a-z0-9]{20,}$/i.test(id)) {
    return new Response("Invalid export ID format", { status: 400 });
  }

  const exp = await getExportById(orgId, id);

  if (!exp) {
    return new Response("Export not found", { status: 404 });
  }

  if (exp.status !== "COMPLETED") {
    return new Response("Export not ready", { status: 409 });
  }

  try {
    // Proxy the download from the worker's in-memory cache
    const workerRes = await proxyWorkerDownload(id);

    if (!workerRes.ok) {
      return new Response(
        "Export file has expired. Please re-run the export to generate a fresh download.",
        { status: 410 }
      );
    }

    const ext =
      exp.format === "WORD" ? "docx" : exp.format === "CSV" ? "csv" : "zip";
    const date = exp.createdAt.toISOString().split("T")[0];
    const filename = `invoices-export-${date}.${ext}`;

    const contentType =
      exp.format === "WORD"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : exp.format === "CSV"
          ? "text/csv"
          : "application/zip";

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    };
    const cl = workerRes.headers.get("Content-Length");
    if (cl) headers["Content-Length"] = cl;

    return new Response(workerRes.body, { headers });
  } catch {
    return new Response(
      "Failed to retrieve export file from worker. The file may have expired \u2014 re-run the export.",
      { status: 502 }
    );
  }
}
