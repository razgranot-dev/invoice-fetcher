import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getInvoices } from "@/lib/data/invoices";

function escapeCsv(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function field(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().split("T")[0];
  return String(value);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const orgId = (session as any).organizationId as string | undefined;
  if (!orgId) {
    return new Response("No organization", { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const invoices = await getInvoices(
    orgId,
    {
      search: searchParams.get("search") || undefined,
      tier: searchParams.get("tier") || undefined,
      company: searchParams.get("company") || undefined,
      reportStatus: searchParams.get("reportStatus") || "INCLUDED",
    },
    10000
  );

  const headers = [
    "Invoice ID",
    "Company",
    "Subject",
    "Amount",
    "Currency",
    "Classification",
    "Date",
    "Sender Email",
    "Has Attachment",
    "Scan ID",
  ];

  const rows = invoices.map((inv) => [
    inv.id,
    field(inv.company),
    field(inv.subject),
    inv.amount != null ? String(inv.amount) : "",
    inv.currency,
    inv.classificationTier,
    inv.date ? new Date(inv.date).toISOString().split("T")[0] : "",
    field(inv.sender),
    inv.hasAttachment ? "Yes" : "No",
    inv.scanId,
  ]);

  // UTF-8 BOM for Excel compatibility
  const csv =
    "\uFEFF" +
    [
      headers.map(escapeCsv).join(","),
      ...rows.map((row) => row.map(escapeCsv).join(",")),
    ].join("\r\n");

  const date = new Date().toISOString().split("T")[0];

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="invoices-${date}.csv"`,
    },
  });
}
