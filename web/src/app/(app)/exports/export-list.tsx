"use client";

import { useState, useEffect, useRef } from "react";
import {
  Download,
  FileSpreadsheet,
  FileText,
  Images,
  Loader2,
  XCircle,
  CheckCircle2,
  Clock,
  Ban,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ExportItem {
  id: string;
  format: string;
  status: string;
  invoiceCount: number;
  progress: number;
  progressMessage: string | null;
  fileSize: number | null;
  errorMessage: string | null;
  createdAt: string;
}

const formatIcon: Record<string, typeof FileText> = {
  CSV: FileSpreadsheet,
  WORD: FileText,
  ZIP_SCREENSHOTS: Images,
};

const formatLabel: Record<string, string> = {
  CSV: "CSV Spreadsheet",
  WORD: "Word Document",
  ZIP_SCREENSHOTS: "Screenshot Package",
};

const statusConfig: Record<
  string,
  {
    icon: typeof Clock;
    label: string;
    variant: "secondary" | "default" | "destructive" | "outline";
  }
> = {
  PENDING: { icon: Clock, label: "Queued", variant: "outline" },
  PROCESSING: { icon: Loader2, label: "Generating...", variant: "default" },
  COMPLETED: { icon: CheckCircle2, label: "Ready", variant: "secondary" },
  FAILED: { icon: XCircle, label: "Failed", variant: "destructive" },
  CANCELLED: { icon: Ban, label: "Cancelled", variant: "outline" },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExportList({ initial }: { initial: ExportItem[] }) {
  const [exports, setExports] = useState<ExportItem[]>(initial);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasActive = exports.some(
    (e) => e.status === "PENDING" || e.status === "PROCESSING"
  );

  useEffect(() => {
    if (!hasActive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Use adaptive polling: 1.5s when exports are actively processing,
    // but stop entirely when nothing is active (hasActive guard above).
    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/exports?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.exports) setExports(data.exports);
      } catch {
        // ignore polling errors
      }
    }, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [hasActive]);

  // Also update from initial when it changes (page re-navigations)
  useEffect(() => {
    setExports(initial);
  }, [initial]);

  const handleCancel = async (exportId: string) => {
    setCancellingIds((prev) => new Set(prev).add(exportId));
    try {
      const res = await fetch(`/api/exports/${exportId}`, { method: "DELETE" });
      if (res.ok) {
        setExports((prev) =>
          prev.map((e) =>
            e.id === exportId
              ? { ...e, status: "CANCELLED", progress: 100, progressMessage: "Cancelled" }
              : e
          )
        );
      }
    } catch {
      // ignore
    } finally {
      setCancellingIds((prev) => {
        const next = new Set(prev);
        next.delete(exportId);
        return next;
      });
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card divide-y divide-border">
      {exports.map((exp) => {
        const Icon =
          formatIcon[exp.format as keyof typeof formatIcon] || Download;
        const status = statusConfig[exp.status] ?? statusConfig.PENDING;
        const StatusIcon = status.icon;
        const pct = exp.progress ?? 0;
        const isCancellable = exp.status === "PENDING" || exp.status === "PROCESSING";

        return (
          <div
            key={exp.id}
            className="flex items-center justify-between px-5 py-4 hover:bg-muted/20 transition-colors"
          >
            <div className="flex items-center gap-4 min-w-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/8 border border-secondary/12 shrink-0">
                <Icon className="h-4 w-4 text-secondary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {formatLabel[exp.format] ?? exp.format} Export
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {exp.invoiceCount} invoices &middot;{" "}
                  {new Date(exp.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {exp.fileSize ? ` \u00b7 ${formatBytes(exp.fileSize)}` : ""}
                </p>

                {/* Live progress bar for active exports */}
                {isCancellable && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="h-1.5 flex-1 max-w-[220px] rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold tabular-nums text-blue-600 dark:text-blue-400 shrink-0">
                      {pct}%
                    </span>
                  </div>
                )}

                {/* Progress message for active exports */}
                {isCancellable && exp.progressMessage && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-sm">
                    {exp.progressMessage}
                  </p>
                )}

                {/* Completion message with warnings */}
                {exp.status === "COMPLETED" &&
                  exp.progressMessage &&
                  exp.progressMessage !== "Complete" && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 max-w-md">
                      {exp.progressMessage}
                    </p>
                  )}

                {/* Error message */}
                {exp.status === "FAILED" && exp.errorMessage && (
                  <p className="text-xs text-destructive mt-0.5 truncate max-w-xs">
                    {exp.errorMessage}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0 ml-4">
              {exp.status === "COMPLETED" && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`/api/exports/${exp.id}/download`}>
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </a>
                </Button>
              )}
              {isCancellable && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCancel(exp.id)}
                  disabled={cancellingIds.has(exp.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  {cancellingIds.has(exp.id) ? "Cancelling..." : "Cancel"}
                </Button>
              )}
              <Badge variant={status.variant}>
                <StatusIcon
                  className={`h-3 w-3 mr-1 ${
                    exp.status === "PROCESSING" ? "animate-spin" : ""
                  }`}
                />
                {status.label}
              </Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}
