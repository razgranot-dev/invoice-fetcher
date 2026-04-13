"use client";

import { useState, useTransition } from "react";
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
    // Optimistic UI
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
      <div className="hidden md:block rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="w-10 px-3 py-3">
                <button
                  onClick={toggleAll}
                  className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                    allSelected
                      ? "bg-primary border-primary"
                      : someSelected
                        ? "bg-primary/50 border-primary"
                        : "border-muted-foreground/30 hover:border-muted-foreground/60"
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
              <th className="w-10 px-2 py-3 text-xs font-medium text-muted-foreground">
                Report
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                Company
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                Subject
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">
                Amount
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                Date
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invoices.map((inv) => {
              const badge =
                tierBadge[inv.classificationTier] ?? tierBadge.not_invoice;
              const isSelected = selected.has(inv.id);
              const status = statuses[inv.id] ?? "INCLUDED";
              const isExcluded = status === "EXCLUDED";

              return (
                <tr
                  key={inv.id}
                  className={`transition-colors ${
                    isExcluded
                      ? "bg-muted/10 opacity-60"
                      : "hover:bg-muted/20"
                  } ${isSelected ? "bg-primary/5" : ""}`}
                >
                  <td className="px-3 py-3">
                    <button
                      onClick={() => toggleOne(inv.id)}
                      className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                        isSelected
                          ? "bg-primary border-primary"
                          : "border-muted-foreground/30 hover:border-muted-foreground/60"
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
                      className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                        isExcluded
                          ? "text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10"
                          : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                      }`}
                    >
                      {isExcluded ? (
                        <FileX className="h-3.5 w-3.5" />
                      ) : (
                        <FileCheck className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {inv.company ?? "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                    {inv.subject}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {inv.amount
                      ? formatCurrency(inv.amount, inv.currency)
                      : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
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
                          <span className="text-[10px] font-medium text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 px-1.5 py-0.5 rounded whitespace-nowrap">
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
              className={`rounded-xl border bg-card p-4 space-y-2 transition-colors ${
                isExcluded
                  ? "border-border/50 opacity-60"
                  : "border-border"
              } ${isSelected ? "border-primary/30 bg-primary/5" : ""}`}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <button
                  onClick={() => toggleOne(inv.id)}
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                    isSelected
                      ? "bg-primary border-primary"
                      : "border-muted-foreground/30"
                  }`}
                >
                  {isSelected && (
                    <Check className="h-3 w-3 text-primary-foreground" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium truncate">
                      {inv.company ?? inv.sender}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Report toggle */}
                      <button
                        onClick={() => toggleSingle(inv.id, status)}
                        className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                          isExcluded
                            ? "text-muted-foreground/40 hover:text-destructive"
                            : "text-emerald-600 hover:text-emerald-700"
                        }`}
                      >
                        {isExcluded ? (
                          <FileX className="h-3.5 w-3.5" />
                        ) : (
                          <FileCheck className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {inv.subject}
                  </p>
                  {(() => {
                    const reason = getReviewReason(inv);
                    return reason ? (
                      <span className="inline-block text-[10px] font-medium text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 px-1.5 py-0.5 rounded mt-1">
                        {reason}
                      </span>
                    ) : null;
                  })()}
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1.5">
                    <span>
                      {inv.date
                        ? new Date(inv.date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })
                        : ""}
                    </span>
                    <span className="font-mono font-medium text-foreground">
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-3 shadow-xl animate-in">
          <span className="text-sm font-medium tabular-nums">
            {selectedIds.length} selected
          </span>
          <div className="h-5 w-px bg-border" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReportStatus(selectedIds, "INCLUDED")}
            className="text-emerald-600 border-emerald-200 hover:bg-emerald-50"
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
            className="text-xs text-muted-foreground hover:text-foreground ml-1"
          >
            Clear
          </button>
        </div>
      )}
    </>
  );
}
