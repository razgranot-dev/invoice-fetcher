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
        <main className="flex-1 overflow-y-auto">
          {/* Ambient aurora glow */}
          <div className="pointer-events-none fixed top-0 right-0 w-[600px] h-[600px] opacity-30 aurora-bg -z-10" />
          <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8 lg:py-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
