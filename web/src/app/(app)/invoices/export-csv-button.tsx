"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInvoiceSelection } from "./selection-context";
import {
  buildCsvExportRequest,
  downloadResponseAsFile,
} from "@/lib/export-payload";

/**
 * CSV export button. Mirrors the Word/ZIP selection contract: when rows are
 * checked it exports ONLY those, labelled "Export CSV (N)"; otherwise it
 * exports the current filter view, labelled "Export CSV by filters" so the
 * behaviour is never ambiguous.
 *
 * Selection-mode is a POST with the ids in the JSON body (H9): a select-all
 * of hundreds of CUIDs as a ?ids= query string blows past Node's 16KB header
 * limit and the request dies before reaching the route. Filter-mode stays a
 * plain <a href> GET so the native download flow is untouched.
 */
export function ExportCsvButton({
  baseQuery,
  disabled,
}: {
  baseQuery: string;
  disabled?: boolean;
}) {
  const { selectedIds } = useInvoiceSelection();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = buildCsvExportRequest(selectedIds, baseQuery);
  const hasSelection = request.mode === "selection";

  const label = hasSelection
    ? `Export CSV (${request.body.ids.length})`
    : "Export CSV by filters";

  const handleSelectionDownload = async () => {
    if (request.mode !== "selection" || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(request.url, {
        method: request.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setError(text.slice(0, 200) || `Export failed (${res.status})`);
        return;
      }
      await downloadResponseAsFile(
        res,
        `invoices-${new Date().toISOString().split("T")[0]}.csv`
      );
    } catch {
      setError("Export request failed — please retry");
    } finally {
      setDownloading(false);
    }
  };

  // Disabled only matters in filter-mode (no exportable rows in the current
  // facet). A manual selection always exports.
  if (!hasSelection && disabled) {
    return (
      <Button variant="outline" size="sm" disabled>
        <Download className="h-3.5 w-3.5" />
        {label}
      </Button>
    );
  }

  if (hasSelection) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleSelectionDownload}
          disabled={downloading}
        >
          {downloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {label}
        </Button>
        {error && (
          <span className="text-xs text-destructive max-w-[220px] truncate" title={error}>
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" asChild>
      <a href={request.url}>
        <Download className="h-3.5 w-3.5" />
        {label}
      </a>
    </Button>
  );
}
