"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Camera, CheckCircle2, Images } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExportWordButtonProps {
  filters: { search?: string; tier?: string; company?: string; scanId?: string; reportStatus?: string };
  disabled?: boolean;
}

export function ExportWordButton({ filters, disabled }: ExportWordButtonProps) {
  const router = useRouter();
  const [exportId, setExportId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "starting" | "processing" | "done" | "failed">("idle");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for progress when exporting
  useEffect(() => {
    if (!exportId || status === "done" || status === "failed") return;

    intervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/exports/${exportId}?t=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        const exp = data.export;
        if (!exp) return;

        setProgress(exp.progress ?? 0);
        if (exp.progressMessage) setMessage(exp.progressMessage);

        if (exp.status === "COMPLETED") {
          setStatus("done");
          setProgress(100);
          // Keep the server's completion message (includes failure summary) if meaningful
          const serverMsg = exp.progressMessage ?? "";
          setMessage(serverMsg !== "Complete" && serverMsg ? serverMsg : "Export ready!");
          if (intervalRef.current) clearInterval(intervalRef.current);
          // Give more time to read failure summary before redirect
          const delay = serverMsg.includes("failed") ? 4000 : 1200;
          setTimeout(() => router.push("/exports"), delay);
        } else if (exp.status === "FAILED") {
          setStatus("failed");
          setMessage(exp.errorMessage ?? "Export failed");
          if (intervalRef.current) clearInterval(intervalRef.current);
          setTimeout(() => {
            setStatus("idle");
            setExportId(null);
          }, 3000);
        }
      } catch {
        // Ignore polling errors
      }
    }, 800);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [exportId, status, router]);

  const handleExport = async (format: "WORD" | "ZIP_SCREENSHOTS", includeScreenshots = false) => {
    setStatus("starting");
    setProgress(0);
    const labels: Record<string, string> = {
      WORD: includeScreenshots ? "Starting export with screenshots..." : "Starting export...",
      ZIP_SCREENSHOTS: "Starting screenshot package...",
    };
    setMessage(labels[format] ?? "Starting...");

    try {
      const res = await fetch("/api/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, filters, includeScreenshots }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Export failed");
        setStatus("idle");
        return;
      }

      const data = await res.json();
      setExportId(data.export.id);
      setStatus("processing");
    } catch {
      alert("Export request failed");
      setStatus("idle");
    }
  };

  const isActive = status !== "idle";

  if (isActive) {
    return (
      <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg border border-border bg-card min-w-[280px] max-w-[500px]">
        {status === "done" ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium line-clamp-2">
              {message || "Processing..."}
            </span>
            <span className="text-xs font-bold tabular-nums text-blue-600 dark:text-blue-400 shrink-0">
              {progress}%
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                status === "done" ? "bg-emerald-500" : status === "failed" ? "bg-red-500" : "bg-blue-500"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleExport("WORD")}
        disabled={disabled}
      >
        <FileText className="h-3.5 w-3.5" />
        Export Word
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleExport("WORD", true)}
        disabled={disabled}
        className="border-blue-500/30 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-950"
      >
        <Camera className="h-3.5 w-3.5" />
        Word + Screenshots
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleExport("ZIP_SCREENSHOTS")}
        disabled={disabled}
        className="border-emerald-500/30 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950"
      >
        <Images className="h-3.5 w-3.5" />
        Screenshots ZIP
      </Button>
    </div>
  );
}
