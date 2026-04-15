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
        "hidden lg:flex flex-col border-r border-sidebar-border sidebar-gradient",
        "transition-all duration-300 ease-out",
        collapsed ? "w-[72px]" : "w-[260px]"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-4 border-b border-sidebar-border/60">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 border border-primary/30 shadow-xl shadow-primary/25">
          <Receipt className="h-5 w-5 text-white" />
          <div className="absolute -inset-1.5 rounded-2xl bg-primary/15 blur-lg -z-10 animate-glow-pulse" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-black tracking-tight text-foreground">
              Invoice Fetcher
            </span>
            <span className="text-[10px] text-primary/70 font-bold tracking-[0.2em] uppercase">
              Pro
            </span>
          </div>
        )}
      </div>

      {/* Primary nav */}
      <nav className="flex-1 space-y-1.5 px-3 pt-5">
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
                "group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold transition-all duration-250",
                isActive
                  ? "bg-gradient-to-r from-primary/15 to-primary/5 text-foreground border border-primary/25 shadow-lg shadow-primary/10"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground border border-transparent hover:border-border/30"
              )}
            >
              <item.icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0 transition-all duration-250",
                  isActive ? "text-primary drop-shadow-[0_0_6px_rgba(124,92,255,0.5)]" : "text-muted-foreground group-hover:text-foreground/80"
                )}
              />
              {!collapsed && <span>{item.name}</span>}
              {isActive && !collapsed && (
                <div className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-sm shadow-primary/50" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Secondary nav */}
      <div className="space-y-1.5 px-3 pb-4">
        <div className="my-3 mx-2 border-t border-sidebar-border/40" />
        {secondaryNav.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold transition-all duration-250",
                isActive
                  ? "bg-gradient-to-r from-primary/15 to-primary/5 text-foreground border border-primary/25 shadow-lg shadow-primary/10"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground border border-transparent hover:border-border/30"
              )}
            >
              <item.icon
                className={cn(
                  "h-[18px] w-[18px] shrink-0 transition-all duration-250",
                  isActive ? "text-primary drop-shadow-[0_0_6px_rgba(124,92,255,0.5)]" : "text-muted-foreground group-hover:text-foreground/80"
                )}
              />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          );
        })}

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-all duration-250 border border-transparent hover:border-border/30"
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
