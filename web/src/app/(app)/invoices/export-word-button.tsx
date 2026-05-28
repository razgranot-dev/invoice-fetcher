"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, CheckCircle2, Images, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInvoiceSelection } from "./selection-context";

interface ExportWordButtonProps {
  filters: { search?: string; tier?: string; company?: string; scanId?: string; reportStatus?: string };
  disabled?: boolean;
}

type ExportFormat = "WORD" | "ZIP_SCREENSHOTS";

interface ActiveExport {
  format: ExportFormat;
  exportId: string | null;
  progress: number;
  message: string;
  status: "starting" | "processing" | "done" | "failed";
}

export function ExportWordButton({ filters, disabled }: ExportWordButtonProps) {
  const router = useRouter();
  const { selectedIds, clear: clearSelection } = useInvoiceSelection();
  const [activeExports, setActiveExports] = useState<ActiveExport[]>([]);
  const [checked, setChecked] = useState<Set<ExportFormat>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queueRef = useRef<ExportFormat[]>([]);
  const runningRef = useRef(false);

  const currentExport = activeExports.find(
    (e) => e.status === "starting" || e.status === "processing"
  );
  const isActive = activeExports.length > 0;
  const hasManualSelection = selectedIds.length > 0;

  // Snapshot the selection at click time. The user's checkbox set must drive
  // the export even if they keep clicking rows while the export is in
  // flight, and even if Word + Screenshots run as two sequential jobs.
  const selectionSnapshotRef = useRef<string[] | null>(null);

  const startExport = useCallback(async (format: ExportFormat) => {
    runningRef.current = true;
    const label = format === "WORD" ? "Starting Word export..." : "Starting screenshot package...";

    setActiveExports((prev) => [
      ...prev.filter((e) => e.format !== format || e.status === "done" || e.status === "failed"),
      { format, exportId: null, progress: 0, message: label, status: "starting" },
    ]);

    try {
      const snapshot = selectionSnapshotRef.current;
      const payload: Record<string, unknown> = {
        format,
        filters,
        includeScreenshots: false,
      };
      // Sending an explicit invoiceIds list switches the server to
      // selection-mode: it bypasses supplier-exclusion and the INCLUDED
      // default so the Word file contains EXACTLY the checked rows.
      if (snapshot && snapshot.length > 0) {
        payload.invoiceIds = snapshot;
      }

      const res = await fetch("/api/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActiveExports((prev) =>
          prev.map((e) =>
            e.format === format && e.status === "starting"
              ? { ...e, status: "failed", message: data.error ?? "Export failed" }
              : e
          )
        );
        runningRef.current = false;
        return;
      }

      const data = await res.json();
      setActiveExports((prev) =>
        prev.map((e) =>
          e.format === format && e.status === "starting"
            ? { ...e, exportId: data.export.id, status: "processing" }
            : e
        )
      );
    } catch {
      setActiveExports((prev) =>
        prev.map((e) =>
          e.format === format && e.status === "starting"
            ? { ...e, status: "failed", message: "Export request failed" }
            : e
        )
      );
    }
    runningRef.current = false;
  }, [filters]);

  // Poll for progress on the currently processing export
  useEffect(() => {
    const polling = activeExports.find(
      (e) => e.exportId && (e.status === "processing" || e.status === "starting")
    );
    if (!polling?.exportId) return;

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/exports/${polling.exportId}?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        const exp = data.export;
        if (!exp) return;

        setActiveExports((prev) =>
          prev.map((e) => {
            if (e.exportId !== polling.exportId) return e;
            const updated = { ...e, progress: exp.progress ?? e.progress };
            if (exp.progressMessage) updated.message = exp.progressMessage;

            if (exp.status === "COMPLETED") {
              updated.status = "done";
              updated.progress = 100;
              const serverMsg = exp.progressMessage ?? "";
              updated.message = serverMsg !== "Complete" && serverMsg ? serverMsg : "Export ready!";
            } else if (exp.status === "FAILED") {
              updated.status = "failed";
              updated.message = exp.errorMessage ?? "Export failed";
            } else if (exp.status === "CANCELLED") {
              updated.status = "failed";
              updated.message = "Export was cancelled";
            }
            return updated;
          })
        );

        if (exp.status === "COMPLETED" || exp.status === "FAILED" || exp.status === "CANCELLED") {
          if (intervalRef.current) clearInterval(intervalRef.current);
        }
      } catch {
        // Ignore polling errors
      }
    }, 800);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeExports]);

  // Process queue: when current export finishes, start the next one
  useEffect(() => {
    const allDone = activeExports.length > 0 && activeExports.every(
      (e) => e.status === "done" || e.status === "failed"
    );

    // Check if we should start the next queued item
    const hasRunning = activeExports.some(
      (e) => e.status === "starting" || e.status === "processing"
    );

    if (!hasRunning && queueRef.current.length > 0 && !runningRef.current) {
      const next = queueRef.current.shift()!;
      startExport(next);
    }

    // All exports finished — redirect after delay.
    // Guard: only navigate if activeExports is still populated when the timer fires,
    // preventing a race where the user clicks a new export during the delay.
    if (allDone) {
      const hasFailure = activeExports.some((e) => e.status === "failed");
      const delay = hasFailure ? 4000 : 1200;
      const timer = setTimeout(() => {
        setActiveExports((current) => {
          // Re-check: if new exports were started during the delay, bail out
          const stillDone = current.length > 0 && current.every(
            (e) => e.status === "done" || e.status === "failed"
          );
          if (!stillDone) return current;
          // Safe to navigate — all exports are still finished
          setChecked(new Set());
          selectionSnapshotRef.current = null;
          clearSelection();
          router.push("/exports");
          return [];
        });
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [activeExports, router, startExport, clearSelection]);

  const snapshotSelection = () => {
    // De-duplicate via Set so a stale toggle never sends the same ID twice.
    selectionSnapshotRef.current =
      selectedIds.length > 0 ? Array.from(new Set(selectedIds)) : null;
  };

  const handleSingleExport = (format: ExportFormat) => {
    queueRef.current = [];
    setActiveExports([]);
    snapshotSelection();
    startExport(format);
  };

  const handleExportSelected = () => {
    if (checked.size === 0) return;
    const ordered: ExportFormat[] = [];
    if (checked.has("WORD")) ordered.push("WORD");
    if (checked.has("ZIP_SCREENSHOTS")) ordered.push("ZIP_SCREENSHOTS");

    // Start the first, queue the rest
    queueRef.current = ordered.slice(1);
    setActiveExports([]);
    snapshotSelection();
    startExport(ordered[0]);
  };

  const toggleCheck = (format: ExportFormat) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(format)) next.delete(format);
      else next.add(format);
      return next;
    });
  };

  const formatLabel = (format: ExportFormat) =>
    format === "WORD" ? "Word" : "Screenshots ZIP";

  if (isActive) {
    return (
      <div className="flex flex-col gap-2 min-w-[280px] max-w-[500px]">
        {activeExports.map((exp) => (
          <div
            key={exp.format}
            className="flex items-center gap-3 px-3 py-1.5 rounded-lg border border-border bg-card"
          >
            {exp.status === "done" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
            ) : exp.status === "failed" ? (
              <span className="h-4 w-4 text-red-500 shrink-0 text-xs font-bold">!</span>
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium line-clamp-2">
                  <span className="font-semibold">{formatLabel(exp.format)}:</span>{" "}
                  {exp.message || "Processing..."}
                </span>
                <span className="text-xs font-bold tabular-nums text-blue-600 dark:text-blue-400 shrink-0">
                  {exp.progress}%
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    exp.status === "done"
                      ? "bg-emerald-500"
                      : exp.status === "failed"
                        ? "bg-red-500"
                        : "bg-blue-500"
                  }`}
                  style={{ width: `${exp.progress}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // When the user has manually checked rows, surface that in the buttons and
  // ignore the upstream `disabled` flag (which is gated on includedCount —
  // not meaningful when the export targets explicit IDs that may include
  // EXCLUDED rows). When nothing is selected we fall back to the previous
  // filter-based behaviour.
  const buttonsDisabled = hasManualSelection ? false : disabled;
  const selectedLabel = hasManualSelection ? ` (${selectedIds.length})` : "";

  return (
    <div className="flex items-center gap-2">
      {/* Individual buttons */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleSingleExport("WORD")}
        disabled={buttonsDisabled}
        title={hasManualSelection ? `Export ${selectedIds.length} selected invoice(s) to Word` : undefined}
      >
        <FileText className="h-3.5 w-3.5" />
        Export Word{selectedLabel}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleSingleExport("ZIP_SCREENSHOTS")}
        disabled={buttonsDisabled}
        title={hasManualSelection ? `Export screenshots ZIP of ${selectedIds.length} selected invoice(s)` : undefined}
        className="border-emerald-500/30 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950"
      >
        <Images className="h-3.5 w-3.5" />
        Screenshots ZIP{selectedLabel}
      </Button>

      {/* Separator */}
      <div className="h-6 w-px bg-border mx-1" />

      {/* Checkboxes for multi-select */}
      <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
        <input
          type="checkbox"
          checked={checked.has("WORD")}
          onChange={() => toggleCheck("WORD")}
          disabled={buttonsDisabled}
          className="rounded border-muted-foreground/30 h-3.5 w-3.5 accent-blue-600"
        />
        Word
      </label>
      <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
        <input
          type="checkbox"
          checked={checked.has("ZIP_SCREENSHOTS")}
          onChange={() => toggleCheck("ZIP_SCREENSHOTS")}
          disabled={buttonsDisabled}
          className="rounded border-muted-foreground/30 h-3.5 w-3.5 accent-emerald-600"
        />
        ZIP
      </label>
      <Button
        variant="default"
        size="sm"
        onClick={handleExportSelected}
        disabled={buttonsDisabled || checked.size === 0}
        title={hasManualSelection ? `Export ${selectedIds.length} selected invoice(s) in the chosen formats` : undefined}
        className="text-xs"
      >
        <Play className="h-3 w-3" />
        Export Selected{selectedLabel}
      </Button>
    </div>
  );
}
