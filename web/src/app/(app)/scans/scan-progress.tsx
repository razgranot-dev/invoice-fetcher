"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ScanProgressProps {
  scanId: string;
  /** Compact mode for scan list rows, expanded mode for detail page */
  compact?: boolean;
}

interface ProgressData {
  status: string;
  progress: number;
  progressMessage: string | null;
}

export function ScanProgress({ scanId, compact = false }: ScanProgressProps) {
  const router = useRouter();
  const [data, setData] = useState<ProgressData>({
    status: "RUNNING",
    progress: 0,
    progressMessage: "Starting...",
  });
  const [cancelling, setCancelling] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/scans/${scanId}/progress?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      const json = await res.json();
      setData(json);
      return json;
    } catch {
      return null;
    }
  }, [scanId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let mounted = true;

    async function tick() {
      const result = await poll();
      if (!mounted) return;

      if (
        result?.status === "COMPLETED" ||
        result?.status === "FAILED" ||
        result?.status === "CANCELLED"
      ) {
        router.refresh();
        return;
      }

      timer = setTimeout(tick, 2000);
    }

    tick();
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [poll, router]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`/api/scans/${scanId}`, { method: "DELETE" });
      if (res.ok) {
        setData((prev) => ({
          ...prev,
          status: "CANCELLED",
          progress: 100,
          progressMessage: "Cancelled",
        }));
        router.refresh();
      }
    } catch {
      // ignore
    } finally {
      setCancelling(false);
    }
  };

  const pct = data.progress;
  const isDone =
    data.status === "COMPLETED" ||
    data.status === "FAILED" ||
    data.status === "CANCELLED";

  if (isDone) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-muted-foreground tabular-nums">{pct}%</span>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleCancel();
          }}
          disabled={cancelling}
          className="text-muted-foreground/50 hover:text-destructive transition-colors"
          title="Cancel scan"
        >
          <XCircle className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm font-medium">Scanning inbox...</span>
        <span className="text-sm tabular-nums text-muted-foreground ml-auto">
          {pct}%
        </span>
      </div>
      <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        {data.progressMessage && (
          <p className="text-xs text-muted-foreground">{data.progressMessage}</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={cancelling}
          className="text-muted-foreground hover:text-destructive ml-auto"
        >
          <XCircle className="h-3.5 w-3.5" />
          {cancelling ? "Cancelling..." : "Cancel"}
        </Button>
      </div>
    </div>
  );
}
