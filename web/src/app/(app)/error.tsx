"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-28 px-4 text-center animate-float-up">
      <div className="relative mb-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-destructive/20 to-destructive/5 border border-destructive/25 shadow-2xl shadow-destructive/15 animate-glow-pulse">
          <AlertTriangle className="h-9 w-9 text-destructive" />
        </div>
        <div className="absolute -inset-6 rounded-full bg-destructive/8 blur-2xl -z-10" />
      </div>
      <h2 className="text-xl font-black text-foreground mb-2.5">
        Something went wrong
      </h2>
      <p className="text-sm text-muted-foreground/60 max-w-md mb-8 leading-relaxed">
        An unexpected error occurred while loading this page. Please try again.
      </p>
      <Button variant="destructive" size="lg" onClick={reset}>
        <RotateCcw className="h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}
