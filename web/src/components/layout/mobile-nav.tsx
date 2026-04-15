"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  ScanSearch,
  FileText,
  Download,
  Settings,
  CreditCard,
  Receipt,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

const FILTER_STORAGE_KEY = "invoice-filters";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Scans", href: "/scans", icon: ScanSearch },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Exports", href: "/exports", icon: Download },
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "Billing", href: "/billing", icon: CreditCard },
];

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNav({ open, onClose }: MobileNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [invoicesHref, setInvoicesHref] = useState("/invoices");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(FILTER_STORAGE_KEY);
      if (saved) setInvoicesHref(`/invoices?${saved}`);
    } catch {}
  }, []);

  useEffect(() => {
    if (!pathname.startsWith("/invoices")) return;
    const qs = searchParams.toString();
    if (qs) {
      try { localStorage.setItem(FILTER_STORAGE_KEY, qs); } catch {}
    }
    setInvoicesHref(qs ? `/invoices?${qs}` : "/invoices");
  }, [pathname, searchParams]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-md lg:hidden"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 left-0 z-50 w-[280px] sidebar-surface lg:hidden animate-slide-in shadow-2xl shadow-black/10">
        <div className="flex h-16 items-center justify-between px-4 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[#5a4bd6] shadow-xl shadow-primary/20">
              <Receipt className="h-5 w-5 text-white" />
            </div>
            <span className="text-sm font-black tracking-tight text-foreground">
              Invoice Fetcher
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-muted/60 transition-colors"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <nav className="space-y-1 px-3 pt-4">
          {navigation.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const href = item.href === "/invoices" ? invoicesHref : item.href;
            return (
              <Link
                key={item.href}
                href={href}
                onClick={
                  item.href === "/invoices" && !pathname.startsWith("/invoices")
                    ? (e) => {
                        e.preventDefault();
                        onClose();
                        let target = "/invoices";
                        try {
                          const saved = localStorage.getItem(FILTER_STORAGE_KEY);
                          if (saved) target = `/invoices?${saved}`;
                        } catch {}
                        window.location.href = target;
                      }
                    : onClose
                }
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3.5 py-3 text-[13px] font-semibold transition-all duration-300",
                  isActive
                    ? "bg-gradient-to-r from-primary/12 to-primary/5 text-foreground border border-primary/20 shadow-md shadow-primary/8"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground border border-transparent hover:border-border/50"
                )}
              >
                <item.icon
                  className={cn(
                    "h-[18px] w-[18px] shrink-0 transition-all duration-300",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
