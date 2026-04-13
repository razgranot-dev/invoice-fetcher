"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useCallback } from "react";

interface ScanOption {
  id: string;
  createdAt: string | Date;
  totalMessages: number;
  invoiceCount: number;
  daysBack: number;
}

interface InvoiceFiltersProps {
  companies: Array<{ name: string; count: number }>;
  scans: ScanOption[];
}

export function InvoiceFilters({ companies, scans }: InvoiceFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [showFilters, setShowFilters] = useState(false);

  const currentTier = searchParams.get("tier");
  const currentCompany = searchParams.get("company");
  const currentReport = searchParams.get("report") ?? "";
  const currentScan = searchParams.get("scan") ?? "";

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      router.push(`/invoices?${params.toString()}`);
    },
    [router, searchParams]
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateParams({ search: search || null });
  };

  const clearAll = () => {
    setSearch("");
    router.push("/invoices");
  };

  const hasFilters =
    currentTier || currentCompany || currentReport || currentScan || searchParams.get("search");

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <form
          onSubmit={handleSearch}
          className="flex items-center gap-2 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm"
        >
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            placeholder="Search by company, subject, sender..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent outline-none text-sm w-full placeholder:text-muted-foreground"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                updateParams({ search: null });
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>

        {/* Scan selector — always visible */}
        {scans.length > 0 && (
          <select
            value={currentScan}
            onChange={(e) =>
              updateParams({ scan: e.target.value || null })
            }
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none min-w-[180px]"
          >
            <option value="">All scans</option>
            {scans.map((s) => {
              const d = new Date(s.createdAt);
              const label = `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} — ${s.invoiceCount} inv / ${s.totalMessages} emails`;
              return (
                <option key={s.id} value={s.id}>
                  {label}
                </option>
              );
            })}
          </select>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
            {hasFilters && (
              <span className="ml-1 h-4 w-4 rounded-full bg-primary text-[10px] text-primary-foreground flex items-center justify-center">
                !
              </span>
            )}
          </Button>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="rounded-lg border border-border bg-card p-4 flex flex-wrap gap-4 animate-in">
          {/* Report inclusion filter */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">
              Report
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {[
                { value: "", label: "All" },
                { value: "INCLUDED", label: "Included" },
                { value: "EXCLUDED", label: "For Review" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateParams({ report: opt.value || null })}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    currentReport === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tier filter */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">
              Classification
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {[
                { value: "", label: "All" },
                { value: "confirmed_invoice", label: "Confirmed" },
                { value: "likely_invoice", label: "Likely" },
                { value: "possible_financial_email", label: "Possible" },
                { value: "not_invoice", label: "Not Invoice" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateParams({ tier: opt.value || null })}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    (currentTier ?? "") === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Company filter */}
          {companies.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                Company
              </label>
              <select
                value={currentCompany ?? ""}
                onChange={(e) =>
                  updateParams({ company: e.target.value || null })
                }
                className="rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs outline-none"
              >
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.count})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
