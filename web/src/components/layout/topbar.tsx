"use client";

import { cn } from "@/lib/utils";
import { Menu, Bell, Search } from "lucide-react";
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
    <header className="flex h-14 items-center justify-between border-b border-border px-4 lg:px-6 bg-background/80 backdrop-blur-sm sticky top-0 z-30">
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

        <div className="hidden sm:flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-sm text-muted-foreground w-64 transition-colors hover:border-border/80">
          <Search className="h-3.5 w-3.5" />
          <span className="text-xs">Search invoices...</span>
          <kbd className="ml-auto text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded border border-border">
            /
          </kbd>
        </div>
      </div>

      {/* Right: notifications + avatar */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
        </Button>

        {userImage ? (
          <img
            src={userImage}
            alt={userName}
            className="h-8 w-8 rounded-full border border-border"
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-medium text-primary">
            {userInitial}
          </div>
        )}
      </div>
    </header>
  );
}
