"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Run again" — re-runs a scan with the same parameters. Surfaced on terminal
 * scans (FAILED/COMPLETED/CANCELLED) so a user who hit a transient failure (a
 * cold worker, a momentary Gmail blip, a token that needed reconnecting) can
 * retry in one click instead of reconstructing the scan form. Reuses the same
 * RECONNECT_GMAIL handling as the new-scan flow so an expired/revoked Google
 * grant is surfaced clearly rather than silently retried into the same failure.
 */
export function RetryScanButton({
  keywords,
  daysBack,
  unreadOnly,
}: {
  keywords: string[];
  daysBack: number;
  unreadOnly: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function retry() {
    setLoading(true);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, daysBack, unreadOnly }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.action === "RECONNECT_GMAIL") {
          if (confirm(`${data.error}\n\nClick OK to reconnect Google now.`)) {
            window.location.href = "/login";
          }
        } else {
          alert(data.error || "Failed to start scan");
        }
        return;
      }
      const newScanId = data?.scan?.id;
      if (newScanId) router.push(`/scans/${newScanId}`);
      else router.refresh();
    } catch {
      alert("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={retry} disabled={loading}>
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      {loading ? "Starting…" : "Run again"}
    </Button>
  );
}
