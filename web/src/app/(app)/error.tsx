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
      <div className="relative mb-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 border border-destructive/20 shadow-lg shadow-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <div className="absolute -inset-3 rounded-3xl bg-destructive/5 blur-xl -z-10" />
      </div>
      <h2 className="text-lg font-bold text-foreground mb-2">
        Something went wrong
      </h2>
      <p className="text-sm text-muted-foreground/70 max-w-md mb-8 leading-relaxed">
        An unexpected error occurred while loading this page. Please try again.
      </p>
      <Button variant="outline" size="sm" onClick={reset}>
        <RotateCcw className="h-3.5 w-3.5" />
        Try again
      </Button>
    </div>
  );
}
