"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
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
      } else if (data.scan?.status === "FAILED") {
        alert(data.scan.errorMessage || "Scan failed");
      }

      setShowForm(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (!showForm) {
    return (
      <Button size="sm" onClick={() => setShowForm(true)}>
        <Plus className="h-3.5 w-3.5" />
        New Scan
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 animate-in">
        <h2 className="text-base font-semibold mb-4">New Inbox Scan</h2>

        <form onSubmit={handleScan} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Keywords (comma-separated, or leave empty for defaults)
            </label>
            <input
              name="keywords"
              type="text"
              placeholder="חשבונית, קבלה, invoice, receipt..."
              className="mt-1.5 w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Days back
            </label>
            <input
              name="daysBack"
              type="number"
              defaultValue={30}
              min={1}
              max={365}
              className="mt-1.5 w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              name="unreadOnly"
              type="checkbox"
              defaultChecked
              id="unreadOnly"
              className="rounded border-border"
            />
            <label
              htmlFor="unreadOnly"
              className="text-sm text-muted-foreground"
            >
              Unread only
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? "Starting..." : "Start Scan"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
