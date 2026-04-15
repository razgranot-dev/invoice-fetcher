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
    <header className="flex h-16 items-center justify-between border-b border-border/40 px-4 lg:px-6 glass sticky top-0 z-30">
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

        <div className="hidden sm:flex items-center gap-2.5 rounded-xl border border-border/50 bg-muted/15 px-4 py-2 text-sm text-muted-foreground w-80 transition-all duration-250 hover:border-primary/20 hover:bg-muted/25 focus-within:border-primary/40 focus-within:shadow-lg focus-within:shadow-primary/10 focus-within:bg-muted/30 group">
          <Search className="h-4 w-4 text-muted-foreground/50 group-focus-within:text-primary transition-colors" />
          <span className="text-xs text-muted-foreground/40 font-medium">Search invoices...</span>
          <kbd className="ml-auto text-[10px] font-mono font-bold bg-muted/50 text-muted-foreground/40 px-2 py-0.5 rounded-md border border-border/30">
            /
          </kbd>
        </div>
      </div>

      {/* Right: notifications + avatar */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="relative group">
          <Bell className="h-4 w-4 group-hover:text-primary transition-colors duration-200" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-accent shadow-sm shadow-accent/50" />
        </Button>

        {userImage ? (
          <div className="relative">
            <img
              src={userImage}
              alt={userName}
              className="h-9 w-9 rounded-xl border-2 border-primary/20 shadow-lg shadow-primary/10 transition-all duration-250 hover:scale-110 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/20"
            />
            <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-secondary border-2 border-background shadow-sm shadow-secondary/30" />
          </div>
        ) : (
          <div className="relative">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10 border-2 border-primary/25 flex items-center justify-center text-xs font-bold text-primary shadow-lg shadow-primary/15 transition-all duration-250 hover:scale-110 hover:shadow-xl hover:shadow-primary/25">
              {userInitial}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-secondary border-2 border-background shadow-sm shadow-secondary/30" />
          </div>
        )}
      </div>
    </header>
  );
}
