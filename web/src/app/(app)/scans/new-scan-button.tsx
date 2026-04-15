"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NewScanButton() {
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  async function handleScan(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const keywords = (formData.get("keywords") as string)
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const daysBack = parseInt(formData.get("daysBack") as string) || 30;
    const unreadOnly = formData.get("unreadOnly") === "on";

    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, daysBack, unreadOnly }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to create scan");
        return;
      }

      setShowForm(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (!showForm) {
    return (
      <Button size="sm" variant="glow" onClick={() => setShowForm(true)}>
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
            <input
              name="daysBack"
              type="number"
              defaultValue={30}
              min={1}
              max={365}
              className="mt-2 w-full rounded-xl border border-border/60 bg-white/60 backdrop-blur-sm px-4 py-3 text-sm outline-none transition-all duration-300 focus:border-primary/30 focus:ring-2 focus:ring-primary/10 focus:bg-white focus:shadow-md focus:shadow-primary/5 text-foreground"
            />
          </div>

          <div className="flex items-center gap-2.5">
            <input
              name="unreadOnly"
              type="checkbox"
              defaultChecked
              id="unreadOnly"
              className="rounded-md border-border h-4 w-4 accent-primary"
            />
            <label
              htmlFor="unreadOnly"
              className="text-sm text-muted-foreground"
            >
              Unread only
            </label>
          </div>

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
