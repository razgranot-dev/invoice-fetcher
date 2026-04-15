"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Building2, Sparkles } from "lucide-react";
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

  useEffect(() => {
    setSuppliers(initial);
  }, [initial]);

  const reportFilter = searchParams.get("report") ?? "";

  const toggle = async (name: string, current: boolean) => {
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
    <div className="card-glow-green p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-secondary/15 border border-secondary/25 shadow-md shadow-secondary/10">
              <Building2 className="h-4 w-4 text-secondary" />
            </div>
            <span className="text-sm font-bold text-foreground">
              Suppliers included in export
            </span>
          </div>
          <span className="text-xs text-muted-foreground/70 ml-[42px]">
            {suppliers.length === 0
              ? "Run a scan to detect suppliers automatically."
              : `${included.length} included (${includedInvoices} invoices)${excluded.length > 0 ? ` \u00b7 ${excluded.length} excluded` : ""}`}
          </span>
        </div>

        {/* Filter toggle */}
        {suppliers.length > 0 && (
          <div className="flex gap-0.5 bg-muted/30 rounded-xl p-1 border border-border/40">
            {[
              { key: "", label: "All" },
              { key: "INCLUDED", label: "In Report" },
              { key: "EXCLUDED", label: "Excluded" },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => setReportFilter(opt.key)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                  reportFilter === opt.key
                    ? "bg-card text-foreground shadow-md border border-border/60"
                    : "text-muted-foreground/60 hover:text-foreground"
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
                    ? `${displayName}: in report — click to exclude`
                    : `${displayName}: excluded — click to include`
                }
                className={`group flex items-center gap-2 pl-2.5 pr-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-200 border ${
                  s.isRelevant
                    ? "bg-secondary/8 border-secondary/25 text-secondary hover:bg-secondary/15 hover:border-secondary/40 hover:shadow-md hover:shadow-secondary/10"
                    : "bg-muted/15 border-border/40 text-muted-foreground/50 hover:bg-muted/30 hover:border-border/60 hover:text-muted-foreground/70"
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-md transition-all duration-200 shrink-0 ${
                    s.isRelevant
                      ? "bg-secondary border border-secondary shadow-sm shadow-secondary/20"
                      : "border border-muted-foreground/25 bg-transparent group-hover:border-muted-foreground/40"
                  }`}
                >
                  {s.isRelevant && (
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  )}
                </span>

                <span
                  className={
                    s.isRelevant
                      ? "font-semibold"
                      : "line-through decoration-muted-foreground/30"
                  }
                >
                  {displayName}
                </span>

                <span
                  className={`ml-0.5 text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-md ${
                    s.isRelevant
                      ? "bg-secondary/15 text-secondary"
                      : "bg-muted/30 text-muted-foreground/40"
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
