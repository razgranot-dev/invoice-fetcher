import { DiagnosticRunner } from "./diagnostic-runner";

export const metadata = { title: "Diagnostics — Invoice Fetcher" };

export default function DiagnosticsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-black text-foreground">Diagnostics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Run a live PayPal discovery probe against your connected Gmail. This
          uses your existing login — no credentials are entered here. It shows
          which worker version is running, whether the PayPal discovery anchor is
          active, how many PayPal emails Gmail returns, and how a sample is
          classified.
        </p>
      </div>
      <DiagnosticRunner />
    </div>
  );
}
