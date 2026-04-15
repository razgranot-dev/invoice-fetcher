"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ScanProgressProps {
  scanId: string;
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
      <div className="flex items-center gap-2.5 text-xs">
        <div className="w-28 h-2.5 rounded-full bg-muted/50 overflow-hidden border border-border/40">
          <div
            className="h-full rounded-full progress-gradient transition-all duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-muted-foreground tabular-nums font-bold">{pct}%</span>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleCancel();
          }}
          disabled={cancelling}
          className="text-muted-foreground/40 hover:text-destructive transition-colors duration-200"
          title="Cancel scan"
        >
          <XCircle className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6 card-glow !border-primary/20 animate-border-glow">
      <div className="flex items-center gap-3">
        <div className="relative orb-glow">
          <Loader2 className="h-6 w-6 animate-spin text-primary relative" />
        </div>
        <span className="text-sm font-bold text-foreground">Scanning inbox...</span>
        <span className="text-base tabular-nums font-black text-primary ml-auto">
          {pct}%
        </span>
      </div>
      <div className="w-full h-3 rounded-full bg-muted/40 overflow-hidden border border-border/40">
        <div
          className="h-full rounded-full progress-gradient transition-all duration-700 ease-out"
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
