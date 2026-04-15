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
    <header className="flex h-16 items-center justify-between border-b border-border/50 px-4 lg:px-6 glass sticky top-0 z-30">
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

        <div className="hidden sm:flex items-center gap-2.5 rounded-xl border border-border/60 bg-white/60 backdrop-blur-sm px-4 py-2 text-sm text-muted-foreground w-80 transition-all duration-300 hover:border-primary/15 hover:bg-white/80 focus-within:border-primary/30 focus-within:shadow-lg focus-within:shadow-primary/8 focus-within:bg-white group">
          <Search className="h-4 w-4 text-muted-foreground/50 group-focus-within:text-primary transition-colors duration-300" />
          <span className="text-xs text-muted-foreground/50 font-medium">Search invoices...</span>
          <kbd className="ml-auto text-[10px] font-mono font-bold bg-muted/50 text-muted-foreground/50 px-2 py-0.5 rounded-md border border-border/40">
            /
          </kbd>
        </div>
      </div>

      {/* Right: notifications + avatar */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="relative group">
          <Bell className="h-4 w-4 group-hover:text-primary transition-colors duration-200" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-accent shadow-sm shadow-accent/40" />
        </Button>

        {userImage ? (
          <div className="relative">
            <img
              src={userImage}
              alt={userName}
              className="h-9 w-9 rounded-xl border-2 border-primary/15 shadow-md shadow-primary/8 transition-all duration-300 hover:scale-110 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/15"
            />
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-secondary border-2 border-white shadow-sm shadow-secondary/30" />
          </div>
        ) : (
          <div className="relative">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 border-2 border-primary/15 flex items-center justify-center text-xs font-bold text-primary shadow-md shadow-primary/8 transition-all duration-300 hover:scale-110 hover:shadow-lg hover:shadow-primary/15">
              {userInitial}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-secondary border-2 border-white shadow-sm shadow-secondary/30" />
          </div>
        )}
      </div>
    </header>
  );
}
