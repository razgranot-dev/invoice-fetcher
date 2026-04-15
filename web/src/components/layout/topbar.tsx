"use client";

import { cn } from "@/lib/utils";
import { Menu, Bell, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";

interface TopbarProps {
  onMenuClick?: () => void;
}

export function Topbar({ onMenuClick }: TopbarProps) {
  const { data: session } = useSession();

  const userName = session?.user?.name ?? "User";
  const userInitial = userName[0]?.toUpperCase() ?? "U";
  const userImage = session?.user?.image;

  return (
    <header className="flex h-16 items-center justify-between border-b border-border/60 px-4 lg:px-6 glass-strong sticky top-0 z-30">
      {/* Left: mobile menu + search */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div className="hidden sm:flex items-center gap-2.5 rounded-xl border border-border/60 bg-muted/20 px-4 py-2 text-sm text-muted-foreground w-72 transition-all duration-200 hover:border-primary/20 hover:bg-muted/30 focus-within:border-primary/30 focus-within:shadow-md focus-within:shadow-primary/5 group">
          <Search className="h-4 w-4 text-muted-foreground/60 group-focus-within:text-primary/70 transition-colors" />
          <span className="text-xs text-muted-foreground/50">Search invoices...</span>
          <kbd className="ml-auto text-[10px] font-mono bg-muted/60 text-muted-foreground/50 px-2 py-0.5 rounded-md border border-border/40">
            /
          </kbd>
        </div>
      </div>

      {/* Right: notifications + avatar */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="relative group">
          <Bell className="h-4 w-4 group-hover:text-primary transition-colors" />
        </Button>

        {userImage ? (
          <div className="relative">
            <img
              src={userImage}
              alt={userName}
              className="h-9 w-9 rounded-xl border border-border/60 shadow-md shadow-black/10 transition-transform duration-200 hover:scale-105"
            />
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-secondary border-2 border-background" />
          </div>
        ) : (
          <div className="relative">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center text-xs font-semibold text-primary shadow-md shadow-primary/10">
              {userInitial}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-secondary border-2 border-background" />
          </div>
        )}
      </div>
    </header>
  );
}
