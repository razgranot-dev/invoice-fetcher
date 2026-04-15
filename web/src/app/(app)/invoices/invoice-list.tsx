"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Check, Minus, FileCheck, FileX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

const tierBadge: Record<
  string,
  { label: string; variant: "secondary" | "default" | "accent" | "outline" }
> = {
  confirmed_invoice: { label: "Confirmed", variant: "secondary" },
  likely_invoice: { label: "Likely", variant: "default" },
  possible_financial_email: { label: "Possible", variant: "accent" },
  not_invoice: { label: "Not Invoice", variant: "outline" },
};

interface Invoice {
  id: string;
  company: string | null;
  subject: string;
  sender: string;
  amount: number | null;
  currency: string;
  date: string | null;
  classificationTier: string;
  classificationScore: number;
  hasAttachment: boolean;
  reportStatus: string;
}

function getReviewReason(inv: Invoice): string {
  if (inv.reportStatus !== "EXCLUDED") return "";
  if (inv.classificationTier === "possible_financial_email") {
    if (inv.amount != null) return "Payment signal";
    if (inv.hasAttachment) return "PDF-only invoice";
    return "Weak billing signal";
  }
  if (inv.classificationTier === "not_invoice") {
    return "Insufficient content";
  }
  return "";
}

interface InvoiceListProps {
  invoices: Invoice[];
}

export function InvoiceList({ invoices }: InvoiceListProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, string>>(() =>
    Object.fromEntries(invoices.map((inv) => [inv.id, inv.reportStatus]))
  );

  useEffect(() => {
    setStatuses(Object.fromEntries(invoices.map((inv) => [inv.id, inv.reportStatus])));
    setSelected(new Set());
  }, [invoices]);

  const allIds = invoices.map((i) => i.id);
  const allSelected = invoices.length > 0 && selected.size === invoices.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  };

  const setReportStatus = async (
    ids: string[],
    status: "INCLUDED" | "EXCLUDED"
  ) => {
    setStatuses((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = status;
      return next;
    });
    setSelected(new Set());

    await fetch("/api/invoices/report-status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, reportStatus: status }),
    });

    startTransition(() => router.refresh());
  };

  const toggleSingle = async (id: string, current: string) => {
    const next = current === "INCLUDED" ? "EXCLUDED" : "INCLUDED";
    await setReportStatus([id], next as "INCLUDED" | "EXCLUDED");
  };

  const selectedIds = Array.from(selected);

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block card-glow overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 bg-gradient-to-r from-primary/8 via-muted/20 to-secondary/5">
              <th className="w-10 px-3 py-3.5">
                <button
                  onClick={toggleAll}
                  className={`flex h-4.5 w-4.5 items-center justify-center rounded-md border transition-all duration-200 ${
                    allSelected
                      ? "bg-primary border-primary shadow-sm shadow-primary/20"
                      : someSelected
                        ? "bg-primary/50 border-primary shadow-sm shadow-primary/10"
                        : "border-muted-foreground/20 hover:border-muted-foreground/40"
                  }`}
                >
                  {allSelected && (
                    <Check className="h-3 w-3 text-primary-foreground" />
                  )}
                  {someSelected && (
                    <Minus className="h-3 w-3 text-primary-foreground" />
                  )}
                </button>
              </th>
              <th className="w-10 px-2 py-3.5 text-[11px] font-semibold text-muted-foreground/60 tracking-wider uppercase">
                Report
              </th>
              <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-muted-foreground/60 tracking-wider uppercase">
                Company
              </th>
              <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-muted-foreground/60 tracking-wider uppercase">
                Subject
              </th>
              <th className="text-right px-4 py-3.5 text-[11px] font-semibold text-muted-foreground/60 tracking-wider uppercase">
                Amount
              </th>
              <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-muted-foreground/60 tracking-wider uppercase">
                Date
              </th>
              <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-muted-foreground/60 tracking-wider uppercase">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {invoices.map((inv) => {
              const badge =
                tierBadge[inv.classificationTier] ?? tierBadge.not_invoice;
              const isSelected = selected.has(inv.id);
              const status = statuses[inv.id] ?? "INCLUDED";
              const isExcluded = status === "EXCLUDED";

              return (
                <tr
                  key={inv.id}
                  className={`row-indicator transition-all duration-200 ${
                    isExcluded
                      ? "bg-muted/5 opacity-40"
                      : "hover:bg-muted/10"
                  } ${isSelected ? "bg-primary/8 hover:bg-primary/12" : ""}`}
                >
                  <td className="px-3 py-3">
                    <button
                      onClick={() => toggleOne(inv.id)}
                      className={`flex h-4.5 w-4.5 items-center justify-center rounded-md border transition-all duration-200 ${
                        isSelected
                          ? "bg-primary border-primary shadow-sm shadow-primary/20"
                          : "border-muted-foreground/20 hover:border-muted-foreground/40"
                      }`}
                    >
                      {isSelected && (
                        <Check className="h-3 w-3 text-primary-foreground" />
                      )}
                    </button>
                  </td>
                  <td className="px-2 py-3">
                    <button
                      onClick={() => toggleSingle(inv.id, status)}
                      title={
                        isExcluded
                          ? "Click to include in report"
                          : "Click to exclude from report"
                      }
                      className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200 ${
                        isExcluded
                          ? "text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10"
                          : "text-secondary hover:text-secondary hover:bg-secondary/10"
                      }`}
                    >
                      {isExcluded ? (
                        <FileX className="h-4 w-4" />
                      ) : (
                        <FileCheck className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-semibold">
                    {inv.company ?? "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground/70 max-w-xs truncate">
                    {inv.subject}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                    {inv.amount
                      ? formatCurrency(inv.amount, inv.currency)
                      : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground/70 text-xs">
                    {inv.date
                      ? new Date(inv.date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "\u2014"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {(() => {
                        const reason = getReviewReason(inv);
                        return reason ? (
                          <span className="text-[10px] font-semibold text-accent bg-accent/10 border border-accent/15 px-1.5 py-0.5 rounded-md whitespace-nowrap">
                            {reason}
                          </span>
                        ) : null;
                      })()}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {invoices.map((inv) => {
          const badge =
            tierBadge[inv.classificationTier] ?? tierBadge.not_invoice;
          const isSelected = selected.has(inv.id);
          const status = statuses[inv.id] ?? "INCLUDED";
          const isExcluded = status === "EXCLUDED";

          return (
            <div
              key={inv.id}
              className={`rounded-2xl border bg-card/80 backdrop-blur-sm p-4 space-y-2 transition-all duration-200 ${
                isExcluded
                  ? "border-border/30 opacity-50"
                  : "border-border/60"
              } ${isSelected ? "border-primary/30 bg-primary/5 shadow-md shadow-primary/5" : ""}`}
            >
              <div className="flex items-start gap-3">
                <button
                  onClick={() => toggleOne(inv.id)}
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-200 ${
                    isSelected
                      ? "bg-primary border-primary shadow-sm shadow-primary/20"
                      : "border-muted-foreground/20"
                  }`}
                >
                  {isSelected && (
                    <Check className="h-3 w-3 text-primary-foreground" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold truncate">
                      {inv.company ?? inv.sender}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => toggleSingle(inv.id, status)}
                        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200 ${
                          isExcluded
                            ? "text-muted-foreground/30 hover:text-destructive"
                            : "text-secondary hover:text-secondary"
                        }`}
                      >
                        {isExcluded ? (
                          <FileX className="h-4 w-4" />
                        ) : (
                          <FileCheck className="h-4 w-4" />
                        )}
                      </button>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground/60 line-clamp-2 mt-0.5">
                    {inv.subject}
                  </p>
                  {(() => {
                    const reason = getReviewReason(inv);
                    return reason ? (
                      <span className="inline-block text-[10px] font-semibold text-accent bg-accent/10 border border-accent/15 px-1.5 py-0.5 rounded-md mt-1.5">
                        {reason}
                      </span>
                    ) : null;
                  })()}
                  <div className="flex items-center justify-between text-xs text-muted-foreground/60 pt-2">
                    <span>
                      {inv.date
                        ? new Date(inv.date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : ""}
                    </span>
                    <span className="font-mono font-semibold text-foreground">
                      {inv.amount
                        ? formatCurrency(inv.amount, inv.currency)
                        : "\u2014"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-2xl border border-primary/20 glass px-6 py-3.5 shadow-2xl shadow-primary/15 animate-float-up">
          <span className="text-sm font-bold tabular-nums text-primary">
            {selectedIds.length} selected
          </span>
          <div className="h-5 w-px bg-border/40" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReportStatus(selectedIds, "INCLUDED")}
            className="text-secondary border-secondary/25 hover:bg-secondary/10 hover:border-secondary/40"
          >
            <FileCheck className="h-3.5 w-3.5" />
            Include
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReportStatus(selectedIds, "EXCLUDED")}
            className="text-muted-foreground"
          >
            <FileX className="h-3.5 w-3.5" />
            Exclude
          </Button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-muted-foreground/50 hover:text-foreground ml-1 transition-colors"
          >
            Clear
          </button>
        </div>
      )}
    </>
  );
}
