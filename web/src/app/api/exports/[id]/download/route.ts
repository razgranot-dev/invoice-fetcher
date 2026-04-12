import { NextRequest } from "next/server";
import { readFile, stat } from "fs/promises";
import { auth } from "@/lib/auth";
import { getExportById } from "@/lib/data/exports";

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
  const exp = await getExportById(orgId, id);

  if (!exp) {
    return new Response("Export not found", { status: 404 });
  }

  if (exp.status !== "COMPLETED" || !exp.filePath) {
    return new Response("Export not ready", { status: 409 });
  }

  try {
    const [fileBuffer, fileStat] = await Promise.all([
      readFile(exp.filePath),
      stat(exp.filePath),
    ]);

    const ext = exp.format === "WORD" ? "docx" : exp.format === "CSV" ? "csv" : "zip";
    const date = exp.createdAt.toISOString().split("T")[0];
    const filename = `invoices-export-${date}.${ext}`;

    const contentType =
      exp.format === "WORD"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : exp.format === "CSV"
          ? "text/csv"
          : "application/zip";

    return new Response(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(fileStat.size),
      },
    });
  } catch {
    return new Response(
      "Export file is no longer available. On serverless deployments, exported files are ephemeral — re-run the export to generate a fresh download.",
      { status: 410 }
    );
  }
}
