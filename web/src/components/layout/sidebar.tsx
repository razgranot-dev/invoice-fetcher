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
  ChevronLeft,
} from "lucide-react";
import { useState, useEffect } from "react";

const FILTER_STORAGE_KEY = "invoice-filters";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Scans", href: "/scans", icon: ScanSearch },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Exports", href: "/exports", icon: Download },
];

const secondaryNav = [
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "Billing", href: "/billing", icon: CreditCard },
];

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [invoicesHref, setInvoicesHref] = useState("/invoices");

  // On mount, restore saved invoice URL from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(FILTER_STORAGE_KEY);
      if (saved) setInvoicesHref(`/invoices?${saved}`);
    } catch {}
  }, []);

  // When on /invoices, persist current filter params to localStorage
  // and keep the sidebar link href in sync
  useEffect(() => {
    if (!pathname.startsWith("/invoices")) return;
    const qs = searchParams.toString();
    if (qs) {
      try { localStorage.setItem(FILTER_STORAGE_KEY, qs); } catch {}
    }
    // Always sync href with current URL; never clear localStorage here —
    // only the explicit "Clear" button should reset saved filters.
    setInvoicesHref(qs ? `/invoices?${qs}` : "/invoices");
  }, [pathname, searchParams]);

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col border-r border-sidebar-border bg-sidebar",
        "transition-all duration-200 ease-out",
        collapsed ? "w-[68px]" : "w-[240px]"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 px-4 border-b border-sidebar-border">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
          <Receipt className="h-4 w-4 text-primary" />
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Invoice Fetcher
          </span>
        )}
      </div>

      {/* Primary nav */}
      <nav className="flex-1 space-y-0.5 px-2 pt-3">
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
                      // Force full page load when navigating TO invoices from
                      // another page — avoids Next.js router cache serving stale data.
                      e.preventDefault();
                      let target = "/invoices";
                      try {
                        const saved = localStorage.getItem(FILTER_STORAGE_KEY);
                        if (saved) target = `/invoices?${saved}`;
                      } catch {}
                      window.location.href = target;
                    }
                  : undefined
              }
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
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
              {!collapsed && <span>{item.name}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Secondary nav */}
      <div className="space-y-0.5 px-2 pb-3">
        <div className="my-2 border-t border-sidebar-border" />
        {secondaryNav.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
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
              {!collapsed && <span>{item.name}</span>}
            </Link>
          );
        })}

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-colors"
        >
          <ChevronLeft
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              collapsed && "rotate-180"
            )}
          />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
