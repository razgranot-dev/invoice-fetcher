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
  Sparkles,
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

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col border-r border-sidebar-border bg-sidebar",
        "transition-all duration-300 ease-out",
        collapsed ? "w-[72px]" : "w-[250px]"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-4 border-b border-sidebar-border">
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 shadow-lg shadow-primary/10">
          <Receipt className="h-4.5 w-4.5 text-primary" />
          <div className="absolute -inset-1 rounded-xl bg-primary/5 blur-md -z-10" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-foreground">
              Invoice Fetcher
            </span>
            <span className="text-[10px] text-muted-foreground/60 font-medium tracking-wider uppercase">
              Pro
            </span>
          </div>
        )}
      </div>

      {/* Primary nav */}
      <nav className="flex-1 space-y-1 px-3 pt-4">
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
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200",
                isActive
                  ? "bg-primary/10 text-foreground border border-primary/15 shadow-sm shadow-primary/5"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground border border-transparent"
              )}
            >
              <item.icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0 transition-colors duration-200",
                  isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground/70"
                )}
              />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Secondary nav */}
      <div className="space-y-1 px-3 pb-4">
        <div className="my-3 border-t border-sidebar-border/60" />
        {secondaryNav.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-200",
                isActive
                  ? "bg-primary/10 text-foreground border border-primary/15 shadow-sm shadow-primary/5"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground border border-transparent"
              )}
            >
              <item.icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0 transition-colors duration-200",
                  isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground/70"
                )}
              />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          );
        })}

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-all duration-200"
        >
          <ChevronLeft
            className={cn(
              "h-[18px] w-[18px] shrink-0 text-muted-foreground transition-transform duration-300",
              collapsed && "rotate-180"
            )}
          />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
