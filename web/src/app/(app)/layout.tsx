"use client";

import { Suspense, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileNav } from "@/components/layout/mobile-nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Suspense>
        <Sidebar />
        <MobileNav
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
        />
      </Suspense>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto aurora">
          <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8 lg:py-10 relative">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
