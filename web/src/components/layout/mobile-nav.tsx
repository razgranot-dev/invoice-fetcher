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

  // On mount, restore saved invoice URL from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(FILTER_STORAGE_KEY);
      if (saved) setInvoicesHref(`/invoices?${saved}`);
    } catch {}
  }, []);

  // When on /invoices, persist current filter params and keep href in sync
  useEffect(() => {
    if (!pathname.startsWith("/invoices")) return;
    const qs = searchParams.toString();
    try {
      if (qs) {
        localStorage.setItem(FILTER_STORAGE_KEY, qs);
        setInvoicesHref(`/invoices?${qs}`);
      } else {
        localStorage.removeItem(FILTER_STORAGE_KEY);
        setInvoicesHref("/invoices");
      }
    } catch {}
  }, [pathname, searchParams]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 left-0 z-50 w-72 bg-sidebar border-r border-sidebar-border lg:hidden animate-slide-in">
        <div className="flex h-14 items-center justify-between px-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
              <Receipt className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Invoice Fetcher
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-sidebar-accent transition-colors"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <nav className="space-y-0.5 px-2 pt-3">
          {navigation.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const href = item.href === "/invoices" ? invoicesHref : item.href;
            return (
              <Link
                key={item.href}
                href={href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
                )}
              >
                <item.icon
                  className={cn(
                    "h-4 w-4 shrink-0",
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
