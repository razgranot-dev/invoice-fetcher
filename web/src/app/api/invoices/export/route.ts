import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getInvoices } from "@/lib/data/invoices";
import { db } from "@/lib/db";
import { normalizeDomain, cleanCompanyName } from "@/lib/utils";

function escapeCsv(value: string): string {
  // Prevent CSV formula injection: prefix dangerous leading chars with a
  // single-quote so Excel/Sheets treats the cell as plain text.  The tab
  // prefix alone is insufficient — some spreadsheet software still evaluates
  // formulas inside quoted cells when preceded only by whitespace.
  const DANGEROUS_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];
  let safe = value;
  if (safe.length > 0 && DANGEROUS_PREFIXES.includes(safe[0])) {
    safe = "'" + safe;
  }
  if (
    safe.includes(",") ||
    safe.includes('"') ||
    safe.includes("\n") ||
    safe.includes("\r")
  ) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
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

  // Validate and sanitize query parameters
  const rawSearch = searchParams.get("search") || undefined;
  const rawTier = searchParams.get("tier") || undefined;
  const rawCompany = searchParams.get("company") || undefined;
  const rawScanId = searchParams.get("scanId") || undefined;
  const rawReportStatus = searchParams.get("reportStatus") || "INCLUDED";

  const search = rawSearch && rawSearch.length <= 500 ? rawSearch : undefined;
  const company = rawCompany && rawCompany.length <= 500 ? rawCompany : undefined;

  // Validate tier enum
  const VALID_TIERS = new Set(["confirmed_invoice", "likely_invoice", "possible_invoice", "not_invoice"]);
  const tier = rawTier && VALID_TIERS.has(rawTier) ? rawTier : undefined;

  // Validate scanId format (cuid)
  const scanId = rawScanId && /^c[a-z0-9]{20,}$/i.test(rawScanId) && rawScanId.length <= 100
    ? rawScanId : undefined;

  // Validate reportStatus enum
  const reportStatus = rawReportStatus === "INCLUDED" || rawReportStatus === "EXCLUDED"
    ? rawReportStatus : "INCLUDED";

  const rawInvoices = await getInvoices(
    orgId,
    { search, tier, company, scanId, reportStatus },
    10000
  );

  // Enforce supplier relevance — filter out invoices from excluded suppliers
  const excludedSuppliers = await db.supplier.findMany({
    where: { organizationId: orgId, isRelevant: false },
    select: { name: true },
  });
  const excludedBrands = new Set(
    excludedSuppliers.map((s) => s.name.toLowerCase())
  );
  const invoices =
    excludedBrands.size > 0
      ? rawInvoices.filter((inv) => {
          const brand =
            cleanCompanyName(inv.company?.trim().toLowerCase() ?? "") ||
            (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null);
          return !(brand && excludedBrands.has(brand));
        })
      : rawInvoices;

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
