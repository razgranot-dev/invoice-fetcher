"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Above this many days back, warn that the scan may hit the serverless
 *  function timeout (soft warning only — submission is never blocked). */
export const HUGE_SCAN_DAYS = 240;

export function NewScanButton() {
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [daysBack, setDaysBack] = useState(90);
  const router = useRouter();

  async function handleScan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const keywords = (formData.get("keywords") as string)
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const unreadOnly = formData.get("unreadOnly") === "on";

    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords,
          // Controlled input can transiently hold 0 while the user clears
          // the field — fall back to the server default range in that case.
          daysBack: daysBack >= 1 && daysBack <= 730 ? daysBack : 90,
          unreadOnly,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        // When the server tells us to reconnect, offer a one-click path.
        // confirm() returns true if the user clicks OK, false on Cancel.
        if (data.action === "RECONNECT_GMAIL") {
          const goSignIn = confirm(
            `${data.error}\n\nClick OK to reconnect now.`
          );
          if (goSignIn) {
            window.location.href = "/login";
          }
        } else {
          // Inline, non-blocking — the dialog stays open so the user can
          // adjust inputs and retry (previously a blocking alert()).
          setError(data.error || "Failed to create scan");
        }
        return;
      }

      setError(null);
      setShowForm(false);
      // Navigate to the scan detail page so the user sees live progress
      // (phase, percent, current status) instead of staring at a closed
      // dialog. The /scans/{id} page already renders <ScanProgress>.
      const newScanId = data?.scan?.id;
      if (newScanId) {
        router.push(`/scans/${newScanId}`);
      } else {
        router.refresh();
      }
    } catch {
      // Network-level failure (server down, connection lost) — previously an
      // unhandled rejection that left the dialog open with zero feedback.
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!showForm) {
    return (
      <Button
        size="sm"
        variant="glow"
        onClick={() => {
          setError(null);
          setShowForm(true);
        }}
      >
        <Plus className="h-3.5 w-3.5" />
        New Scan
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/15 backdrop-blur-lg p-4">
      <div className="w-full max-w-md card-glow p-8 shadow-2xl shadow-primary/8 animate-scale-in">
        <div className="flex items-center justify-between mb-7">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/15 shadow-lg shadow-primary/8">
              <Sparkles className="h-4.5 w-4.5 text-primary" />
            </div>
            <h2 className="text-lg font-black text-foreground">New Inbox Scan</h2>
          </div>
          <button
            onClick={() => setShowForm(false)}
            className="p-2 rounded-xl hover:bg-muted/60 transition-colors"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleScan} className="space-y-5">
          <div>
            <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase">
              Keywords
            </label>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5 mb-2">Comma-separated, or leave empty for defaults</p>
            <input
              name="keywords"
              type="text"
              placeholder="invoice, receipt..."
              className="w-full rounded-xl border border-border/60 bg-white/60 backdrop-blur-sm px-4 py-3 text-sm outline-none transition-all duration-300 focus:border-primary/30 focus:ring-2 focus:ring-primary/10 focus:bg-white focus:shadow-md focus:shadow-primary/5 placeholder:text-muted-foreground/40 text-foreground"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-muted-foreground tracking-wider uppercase">
              Days back
            </label>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">
              30–180 days completes reliably on busy inboxes.
            </p>
            <input
              name="daysBack"
              type="number"
              value={daysBack}
              onChange={(e) => setDaysBack(parseInt(e.target.value) || 0)}
              min={1}
              max={730}
              className="mt-2 w-full rounded-xl border border-border/60 bg-white/60 backdrop-blur-sm px-4 py-3 text-sm outline-none transition-all duration-300 focus:border-primary/30 focus:ring-2 focus:ring-primary/10 focus:bg-white focus:shadow-md focus:shadow-primary/5 text-foreground"
            />
            {daysBack > HUGE_SCAN_DAYS && (
              <p className="mt-2 text-[11px] text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                Scans over {HUGE_SCAN_DAYS} days may time out on the hosted
                worker — consider splitting into shorter ranges.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <input
              name="unreadOnly"
              type="checkbox"
              id="unreadOnly"
              className="rounded-md border-border h-4 w-4 accent-primary"
            />
            <label
              htmlFor="unreadOnly"
              className="text-sm text-muted-foreground"
            >
              Unread only <span className="text-muted-foreground/50">— off by default scans your full inbox</span>
            </label>
          </div>

          {error && (
            <p className="text-xs text-destructive bg-destructive/8 border border-destructive/15 rounded-lg px-3 py-2 break-words">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="glow" className="flex-1" disabled={loading}>
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? "Starting..." : "Start Scan"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
