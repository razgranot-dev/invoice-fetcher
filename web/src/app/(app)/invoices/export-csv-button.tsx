"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInvoiceSelection } from "./selection-context";

/**
 * CSV export button. Mirrors the Word/ZIP selection contract: when rows are
 * checked it exports ONLY those (via ?ids=), labelled "Export CSV (N)";
 * otherwise it exports the current filter view, labelled "Export CSV by
 * filters" so the behaviour is never ambiguous.
 */
export function ExportCsvButton({
  baseQuery,
  disabled,
}: {
  baseQuery: string;
  disabled?: boolean;
}) {
  const { selectedIds } = useInvoiceSelection();
  const hasSelection = selectedIds.length > 0;

  const href = hasSelection
    ? `/api/invoices/export?ids=${encodeURIComponent(selectedIds.join(","))}`
    : `/api/invoices/export?${baseQuery}`;

  const label = hasSelection
    ? `Export CSV (${selectedIds.length})`
    : "Export CSV by filters";

  // Disabled only matters in filter-mode (no included rows). A manual
  // selection always exports.
  if (!hasSelection && disabled) {
    return (
      <Button variant="outline" size="sm" disabled>
        <Download className="h-3.5 w-3.5" />
        {label}
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" asChild>
      <a href={href}>
        <Download className="h-3.5 w-3.5" />
        {label}
      </a>
    </Button>
  );
}
