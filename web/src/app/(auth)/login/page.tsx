"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Receipt, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Suspense } from "react";

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const error = searchParams.get("error");

  return (
    <div className="w-full max-w-sm animate-float-up">
      <div className="flex flex-col items-center text-center mb-8">
        <div className="relative mb-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 shadow-xl shadow-primary/15">
            <Receipt className="h-7 w-7 text-primary" />
          </div>
          <div className="absolute -inset-3 rounded-3xl bg-primary/8 blur-xl -z-10" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          Invoice Fetcher
        </h1>
        <p className="text-sm text-muted-foreground/70 mt-1.5">
          Automated invoice detection from your inbox
        </p>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm p-7 shadow-2xl shadow-black/20">
        {error && (
          <div className="mb-5 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error === "OAuthAccountNotLinked"
              ? "This email is already linked to another account."
              : "Authentication failed. Please try again."}
          </div>
        )}

        <Button
          className="w-full h-12 text-sm font-semibold"
          variant="glow"
          size="lg"
          onClick={() => signIn("google", { callbackUrl })}
        >
          <svg className="h-4.5 w-4.5 mr-2" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continue with Google
        </Button>

        <p className="text-[11px] text-muted-foreground/50 text-center mt-5 leading-relaxed">
          We request read-only access to detect invoices.
          <br />
          No emails are stored — only invoice metadata.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
