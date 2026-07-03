"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { nextPollDelay } from "./scan-poll";

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
  // The scan was deleted server-side (404) — stop polling permanently.
  const [gone, setGone] = useState(false);
  const failuresRef = useRef(0);

  const poll = useCallback(async (): Promise<
    ProgressData | { gone: true } | null
  > => {
    try {
      const res = await fetch(`/api/scans/${scanId}/progress?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (res.status === 404) return { gone: true };
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

    function schedule(delay: number | null) {
      if (delay != null) timer = setTimeout(tick, delay);
    }

    async function tick() {
      if (!mounted) return;

      // Hidden tab: skip the fetch entirely and idle at a slow cadence —
      // the visibilitychange listener below polls immediately on return.
      if (typeof document !== "undefined" && document.hidden) {
        schedule(
          nextPollDelay({ gone: false, ok: true, failures: failuresRef.current, hidden: true })
        );
        return;
      }

      const result = await poll();
      if (!mounted) return;

      if (result && "gone" in result) {
        // Scan deleted — stop for good and let the server page re-render.
        setGone(true);
        router.refresh();
        return;
      }

      if (
        result?.status === "COMPLETED" ||
        result?.status === "FAILED" ||
        result?.status === "CANCELLED"
      ) {
        router.refresh();
        return;
      }

      // Healthy polls run every second (matches the route handler's 1s
      // DB-write throttle); consecutive failures back off exponentially
      // so an expired session or network outage doesn't hammer the API.
      failuresRef.current = result ? 0 : failuresRef.current + 1;
      schedule(
        nextPollDelay({ gone: false, ok: result != null, failures: failuresRef.current, hidden: false })
      );
    }

    function onVisibilityChange() {
      if (document.hidden) return;
      // Back from a hidden tab: cancel the slow idle timer, poll right away.
      clearTimeout(timer);
      tick();
    }

    tick();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mounted = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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

  // The scan row was deleted server-side (progress endpoint 404s). Polling
  // has already stopped permanently; show a quiet note until the triggered
  // router.refresh() re-renders the page without this component.
  if (gone) {
    return (
      <span className="text-xs text-muted-foreground/60">
        This scan no longer exists.
      </span>
    );
  }

  // Surface a FAILED scan instead of silently vanishing. Previously this
  // component returned null for ANY terminal status, so a scan that failed
  // mid-flight just made the spinner disappear with no explanation — the
  // error only showed if the user happened to be on the scan detail page
  // when the server re-rendered. Now the failure (and its reason) is shown
  // in both the list (compact) and detail views.
  if (data.status === "FAILED") {
    const msg = data.progressMessage || "The scan failed unexpectedly. Open the scan for details.";
    if (compact) {
      return (
        <div className="flex items-center gap-2 text-xs text-destructive" title={msg}>
          <XCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate max-w-[240px]">Scan failed: {msg}</span>
        </div>
      );
    }
    return (
      <div className="space-y-3 p-5 rounded-xl border border-destructive/30 bg-destructive/10">
        <div className="flex items-center gap-2 text-sm font-bold text-destructive">
          <XCircle className="h-5 w-5" />
          Scan failed
        </div>
        <p className="text-xs text-destructive/90 break-words">{msg}</p>
        <Button variant="outline" size="sm" onClick={() => router.refresh()}>
          Reload
        </Button>
      </div>
    );
  }

  // COMPLETED / CANCELLED → let the server-rendered page show the results.
  if (data.status === "COMPLETED" || data.status === "CANCELLED") return null;

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
