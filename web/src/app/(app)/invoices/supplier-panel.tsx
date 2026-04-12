"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Building2 } from "lucide-react";
import { cleanDomainName } from "@/lib/utils";

interface Supplier {
  id: string;
  name: string;
  isRelevant: boolean;
  invoiceCount: number;
}

interface SupplierPanelProps {
  suppliers: Supplier[];
}

export function SupplierPanel({ suppliers: initial }: SupplierPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [suppliers, setSuppliers] = useState(initial);

  const reportFilter = searchParams.get("report") ?? "";

  const toggle = async (name: string, current: boolean) => {
    // Optimistic UI
    setSuppliers((prev) =>
      prev.map((s) =>
        s.name === name ? { ...s, isRelevant: !current } : s
      )
    );

    await fetch("/api/suppliers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, isRelevant: !current }),
    });

    startTransition(() => router.refresh());
  };

  const setReportFilter = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "") {
      params.delete("report");
    } else {
      params.set("report", value);
    }
    router.push(`/invoices?${params.toString()}`);
  };

  const included = suppliers.filter((s) => s.isRelevant);
  const excluded = suppliers.filter((s) => !s.isRelevant);
  const includedInvoices = included.reduce((n, s) => n + s.invoiceCount, 0);

  return (
    <div className="rounded-xl border-2 border-emerald-500/30 bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10">
              <Building2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <span className="text-sm font-bold text-foreground">
              Suppliers included in the export report
            </span>
          </div>
          <span className="text-xs text-muted-foreground ml-9">
            {suppliers.length === 0
              ? "Run a scan to detect suppliers automatically."
              : `Only suppliers marked as included will appear in the export report. ${included.length} included (${includedInvoices} invoices)${excluded.length > 0 ? ` \u00b7 ${excluded.length} excluded` : ""}`}
          </span>
        </div>

        {/* Filter toggle */}
        {suppliers.length > 0 && (
          <div className="flex gap-0.5 bg-muted/50 rounded-lg p-0.5">
            {[
              { key: "", label: "All" },
              { key: "INCLUDED", label: "In Report" },
              { key: "EXCLUDED", label: "Excluded" },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setReportFilter(opt.key)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  reportFilter === opt.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Supplier cards */}
      {suppliers.length > 0 && (
        <div className="flex flex-wrap gap-2.5">
          {suppliers.map((s) => {
            const displayName = cleanDomainName(s.name);
            return (
              <button
                key={s.id}
                onClick={() => toggle(s.name, s.isRelevant)}
                title={
                  s.isRelevant
                    ? `${displayName} (${s.name}): in report \u2014 click to exclude`
                    : `${displayName} (${s.name}): excluded \u2014 click to include`
                }
                className={`group flex items-center gap-2 pl-2.5 pr-3.5 py-2 rounded-lg text-sm font-medium transition-all border-2 ${
                  s.isRelevant
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 hover:bg-emerald-500/20 hover:border-emerald-500/50 dark:text-emerald-300"
                    : "bg-muted/20 border-muted-foreground/15 text-muted-foreground/70 hover:bg-muted/40 hover:border-muted-foreground/30"
                }`}
              >
                {/* Checkbox */}
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded transition-colors shrink-0 ${
                    s.isRelevant
                      ? "bg-emerald-600 border-2 border-emerald-600"
                      : "border-2 border-muted-foreground/30 bg-transparent group-hover:border-muted-foreground/50"
                  }`}
                >
                  {s.isRelevant && (
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  )}
                </span>

                {/* Name */}
                <span
                  className={
                    s.isRelevant
                      ? "font-semibold"
                      : "line-through decoration-muted-foreground/40"
                  }
                >
                  {displayName}
                </span>

                {/* Invoice count badge */}
                <span
                  className={`ml-0.5 text-xs tabular-nums px-1.5 py-0.5 rounded-full ${
                    s.isRelevant
                      ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-muted/50 text-muted-foreground/50"
                  }`}
                >
                  {s.invoiceCount}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
