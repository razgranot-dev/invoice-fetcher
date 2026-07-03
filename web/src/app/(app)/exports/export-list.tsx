"use client";

import { useState, useEffect } from "react";
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
import {
  downloadResponseAsFile,
  mapDownloadFailure,
  nextPollDelay,
} from "@/lib/export-payload";

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

/** Per-export download UI state (M19): a 410 from the download proxy means
 *  the worker-side file's TTL lapsed — the card flips to a disabled
 *  "Expired" button instead of dead-clicking into raw error text. */
type DownloadState = "downloading" | "expired" | "error";

const fallbackFilename: Record<string, string> = {
  CSV: "invoices.csv",
  WORD: "invoices-report.docx",
  ZIP_SCREENSHOTS: "invoice-screenshots.zip",
};

export function ExportList({ initial }: { initial: ExportItem[] }) {
  const [exports, setExports] = useState<ExportItem[]>(initial);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const [downloadStates, setDownloadStates] = useState<
    Record<string, DownloadState>
  >({});

  const hasActive = exports.some(
    (e) => e.status === "PENDING" || e.status === "PROCESSING"
  );

  // Poll while any export is in flight (S8): self-scheduling timeout with
  // backoff on unchanged polls (2s base, ×1.5, 10s cap, reset on any change),
  // paused while the tab is hidden (immediate refresh on return), stopped
  // once every export reaches a terminal status.
  useEffect(() => {
    if (!hasActive) return;
    const BASE_DELAY = 2000;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = BASE_DELAY;
    let lastSnapshot = "";

    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") {
        // Don't hit the network while hidden; visibilitychange resumes us.
        timer = setTimeout(tick, delay);
        return;
      }
      let changed = false;
      let stillActive = true;
      try {
        const res = await fetch(`/api/exports?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          if (data.exports) {
            const next = data.exports as ExportItem[];
            const snapshot = next
              .map((e) => `${e.id}:${e.status}:${e.progress}:${e.progressMessage ?? ""}`)
              .join("|");
            changed = snapshot !== lastSnapshot;
            lastSnapshot = snapshot;
            stillActive = next.some(
              (e) => e.status === "PENDING" || e.status === "PROCESSING"
            );
            setExports(next);
          }
        }
      } catch {
        // ignore polling errors — next tick retries with backoff
      }
      if (cancelled || !stillActive) return;
      delay = nextPollDelay(delay, BASE_DELAY, changed);
      timer = setTimeout(tick, delay);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        if (timer) clearTimeout(timer);
        delay = BASE_DELAY;
        timer = setTimeout(tick, 0);
      }
    };

    timer = setTimeout(tick, BASE_DELAY);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasActive]);

  useEffect(() => {
    setExports(initial);
  }, [initial]);

  // Fetch-based download (M19). The old plain <a href> navigated the tab to
  // raw "Gone" text when the worker-side file had expired; now a 410 flips
  // the card to a disabled Expired state and other failures surface a
  // retryable error message.
  const handleDownload = async (exp: ExportItem) => {
    const current = downloadStates[exp.id];
    if (current === "downloading" || current === "expired") return;
    setDownloadStates((prev) => ({ ...prev, [exp.id]: "downloading" }));
    try {
      const res = await fetch(`/api/exports/${exp.id}/download`);
      const failure = mapDownloadFailure(res.status);
      if (failure) {
        setDownloadStates((prev) => ({ ...prev, [exp.id]: failure }));
        return;
      }
      await downloadResponseAsFile(
        res,
        fallbackFilename[exp.format] ?? "export.bin"
      );
      setDownloadStates((prev) => {
        const next = { ...prev };
        delete next[exp.id];
        return next;
      });
    } catch {
      setDownloadStates((prev) => ({ ...prev, [exp.id]: "error" }));
    }
  };

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
    <div className="card-glow divide-y divide-border/30 overflow-hidden">
      {exports.map((exp) => {
        const Icon =
          formatIcon[exp.format as keyof typeof formatIcon] || Download;
        const status = statusConfig[exp.status] ?? statusConfig.PENDING;
        const StatusIcon = status.icon;
        const pct = exp.progress ?? 0;
        const isCancellable = exp.status === "PENDING" || exp.status === "PROCESSING";
        const downloadState = downloadStates[exp.id];

        return (
          <div
            key={exp.id}
            className="row-indicator flex items-center justify-between px-6 py-5 hover:bg-muted/10 transition-all duration-250 group"
          >
            <div className="flex items-center gap-4 min-w-0">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary/12 border border-secondary/20 shrink-0 shadow-md shadow-secondary/8 group-hover:shadow-lg group-hover:shadow-secondary/15 transition-all duration-250 group-hover:scale-105">
                <Icon className="h-4.5 w-4.5 text-secondary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {formatLabel[exp.format] ?? exp.format} Export
                </p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {exp.invoiceCount} invoices &middot;{" "}
                  {new Date(exp.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {exp.fileSize ? ` \u00b7 ${formatBytes(exp.fileSize)}` : ""}
                </p>

                {isCancellable && (
                  <div className="flex items-center gap-2.5 mt-2">
                    <div className="h-2.5 flex-1 max-w-[240px] rounded-full bg-muted/30 overflow-hidden border border-border/30">
                      <div
                        className="h-full rounded-full progress-gradient transition-all duration-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold tabular-nums text-primary shrink-0">
                      {pct}%
                    </span>
                  </div>
                )}

                {isCancellable && exp.progressMessage && (
                  <p className="text-xs text-muted-foreground/60 mt-1 truncate max-w-sm">
                    {exp.progressMessage}
                  </p>
                )}

                {exp.status === "COMPLETED" &&
                  exp.progressMessage &&
                  exp.progressMessage !== "Complete" && (
                    <p className="text-xs text-accent mt-1 max-w-md">
                      {exp.progressMessage}
                    </p>
                  )}

                {exp.status === "FAILED" && exp.errorMessage && (
                  <p className="text-xs text-destructive mt-1 truncate max-w-xs">
                    {exp.errorMessage}
                  </p>
                )}

                {downloadState === "expired" && (
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Download expired &mdash; re-run the export from the
                    Invoices page.
                  </p>
                )}

                {downloadState === "error" && (
                  <p className="text-xs text-destructive mt-1 max-w-sm">
                    Download failed &mdash; please try again.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0 ml-4">
              {exp.status === "COMPLETED" &&
                (downloadState === "expired" ? (
                  <Button variant="outline" size="sm" disabled>
                    <Clock className="h-3.5 w-3.5" />
                    Expired
                  </Button>
                ) : (
                  <Button
                    variant="glow"
                    size="sm"
                    onClick={() => handleDownload(exp)}
                    disabled={downloadState === "downloading"}
                  >
                    {downloadState === "downloading" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Download
                  </Button>
                ))}
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
