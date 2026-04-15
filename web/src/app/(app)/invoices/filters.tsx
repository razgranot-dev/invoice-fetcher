"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search, Filter, X, SlidersHorizontal } from "lucide-react";
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
    try { localStorage.removeItem("invoice-filters"); } catch {}
    router.push("/invoices");
  };

  const hasFilters =
    currentTier || currentCompany || currentReport || currentScan || searchParams.get("search");

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <form
          onSubmit={handleSearch}
          className="flex items-center gap-2.5 flex-1 rounded-xl border border-border/60 bg-muted/15 px-4 py-2.5 text-sm transition-all duration-200 focus-within:border-primary/25 focus-within:bg-muted/25 focus-within:shadow-md focus-within:shadow-primary/5 group"
        >
          <Search className="h-4 w-4 text-muted-foreground/50 shrink-0 group-focus-within:text-primary/60 transition-colors" />
          <input
            type="text"
            placeholder="Search by company, subject, sender..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent outline-none text-sm w-full placeholder:text-muted-foreground/40"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                updateParams({ search: null });
              }}
              className="text-muted-foreground/50 hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>

        {scans.length > 0 && (
          <select
            value={currentScan}
            onChange={(e) =>
              updateParams({ scan: e.target.value || null })
            }
            className="rounded-xl border border-border/60 bg-muted/15 px-4 py-2.5 text-sm outline-none min-w-[180px] transition-all duration-200 focus:border-primary/25 focus:shadow-md focus:shadow-primary/5"
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
            className={showFilters ? "border-primary/30 bg-primary/5" : ""}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {hasFilters && (
              <span className="ml-1.5 h-5 w-5 rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center shadow-sm shadow-primary/20">
                !
              </span>
            )}
          </Button>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground">
              Clear
            </Button>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm p-5 flex flex-wrap gap-5 animate-scale-in">
          {/* Report inclusion filter */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground/70 tracking-wider uppercase block mb-2">
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
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    currentReport === opt.value
                      ? "bg-primary/15 text-primary border border-primary/20 shadow-sm shadow-primary/5"
                      : "bg-muted/30 text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground border border-transparent"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tier filter */}
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground/70 tracking-wider uppercase block mb-2">
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
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    (currentTier ?? "") === opt.value
                      ? "bg-primary/15 text-primary border border-primary/20 shadow-sm shadow-primary/5"
                      : "bg-muted/30 text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground border border-transparent"
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
              <label className="text-[11px] font-semibold text-muted-foreground/70 tracking-wider uppercase block mb-2">
                Company
              </label>
              <select
                value={currentCompany ?? ""}
                onChange={(e) =>
                  updateParams({ company: e.target.value || null })
                }
                className="rounded-lg border border-border/60 bg-muted/20 px-3 py-1.5 text-xs outline-none transition-all duration-200 focus:border-primary/25"
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
