"use client";

import { useState } from "react";
import { Loader2, Play, RefreshCw, CheckCircle2, XCircle, AlertTriangle, DownloadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProbeResult {
  result_size_estimate?: number;
  returned_ids?: number;
  samples?: Array<{ sender?: string; subject?: string; date?: string; error?: string }>;
  error?: string;
}
interface DiagnosticResponse {
  role?: string;
  worker?: { ok?: boolean; url?: string; version?: string; paypalDiscoveryAnchor?: boolean; error?: string | null };
  gmailConnection?: {
    email?: string; hasRefreshToken?: boolean; hasGmailScope?: boolean;
    grantedScopes?: string[]; tokenExpiry?: string | null;
  };
  daysBack?: number;
  discovery?: {
    auth_ok?: boolean; auth_error?: string; worker_version?: string;
    full_scan_query?: string;
    probes?: Record<string, ProbeResult>;
    paypal_classification_sample?: Array<{
      sender?: string; subject?: string; tier?: string; score?: number;
      is_transaction?: boolean; merchant?: string; amount?: number; currency?: string; error?: string;
    }>;
  } | null;
  error?: string | null;
}

function Row({ label, value, good }: { label: string; value: React.ReactNode; good?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 border-b border-border/40 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={good === true ? "text-emerald-600 font-semibold" : good === false ? "text-red-600 font-semibold" : "font-medium"}>
        {value}
      </span>
    </div>
  );
}

export function DiagnosticRunner() {
  const [days, setDays] = useState(730);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DiagnosticResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [importData, setImportData] = useState<any>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setErr(null);
    setData(null);
    try {
      const res = await fetch(`/api/debug/paypal-discovery?days=${days}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || `HTTP ${res.status}`);
        setData(json);
      } else {
        setData(json);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function runImport() {
    setImporting(true);
    setImportErr(null);
    setImportData(null);
    try {
      const res = await fetch(`/api/debug/paypal-import?days=${days}`, { method: "POST", cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setImportErr(json.error || `HTTP ${res.status}`);
        setImportData(json);
      } else {
        setImportData(json);
      }
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const conn = data?.gmailConnection;
  const disco = data?.discovery;
  const probes = disco?.probes ?? {};
  const ppFrom = probes["from:paypal"];
  const needsReconnect =
    (conn && conn.hasGmailScope === false) ||
    (conn && conn.hasRefreshToken === false) ||
    disco?.auth_ok === false;

  // Verdict logic
  let verdict: { tone: "ok" | "warn" | "bad"; text: string } | null = null;
  if (data && !err) {
    const anchor = data.worker?.paypalDiscoveryAnchor;
    const rawPaypal = ppFrom?.result_size_estimate;
    if (data.worker?.ok === false) {
      verdict = { tone: "bad", text: "Worker is unreachable from the web app — check WORKER_URL / Render service." };
    } else if (anchor === false) {
      verdict = { tone: "bad", text: "Worker is running OLD code (no from:paypal anchor). Redeploy the worker with Clear Build Cache." };
    } else if (disco?.auth_ok === false || needsReconnect) {
      verdict = { tone: "warn", text: "Gmail connection needs a clean reconnect (scope missing or token expired). Click Reconnect Gmail below." };
    } else if (typeof rawPaypal === "number" && rawPaypal === 0) {
      verdict = { tone: "warn", text: `No PayPal email reachable in the last ${data.daysBack} days for ${conn?.email ?? "this account"}. Confirm this is the Gmail account that receives PayPal.` };
    } else if (typeof rawPaypal === "number" && rawPaypal > 0) {
      const persistable = (disco?.paypal_classification_sample ?? []).filter((s) => s.tier && s.tier !== "not_invoice").length;
      verdict = { tone: "ok", text: `PayPal discovery works: ~${rawPaypal} PayPal emails found; ${persistable}/${(disco?.paypal_classification_sample ?? []).length} sampled classify as transactions. Run a real scan to import them.` };
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <label className="text-sm font-semibold">Days back</label>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
        >
          <option value={365}>365</option>
          <option value={540}>540</option>
          <option value={730}>730</option>
        </select>
        <Button onClick={run} disabled={loading || importing} variant="glow" size="sm">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {loading ? "Running probe…" : "Run PayPal Diagnostic"}
        </Button>
        <Button onClick={runImport} disabled={importing || loading} variant="outline" size="sm"
          className="border-emerald-500/40 text-emerald-700">
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
          {importing ? "Importing…" : "Emergency PayPal Import"}
        </Button>
      </div>

      {importErr && (
        <div className="rounded-xl border border-red-300 bg-red-50 text-red-700 px-4 py-3 text-sm">
          <strong>Import error:</strong> {importErr}
        </div>
      )}

      {importData && (
        <section className="rounded-xl border border-emerald-300 bg-emerald-50/40 p-4">
          <h2 className="font-bold mb-2 text-emerald-800">Emergency PayPal Import — result</h2>
          {importData.authError ? (
            <div className="text-sm text-amber-800">
              Gmail auth problem: {importData.authError}.{" "}
              <a href="/login" className="underline font-semibold">Reconnect Gmail</a>
              {importData.gmailConnection?.email ? ` (connected: ${importData.gmailConnection.email})` : ""}
            </div>
          ) : (
            <>
              <Row label="Connected Gmail" value={importData.gmailConnection?.email ?? "—"} good={!!importData.gmailConnection?.email} />
              <Row label="Worker version" value={importData.workerVersion ?? "—"} />
              <div className="mt-3 mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Where did it become zero?</div>
              {importData.funnel && Object.entries(importData.funnel).map(([k, v]) => (
                <Row key={k} label={k} value={String(v)} good={
                  ["newlyCreated", "dashboardVisibleForScan", "orgPaypalSenderRows", "raw_from_paypal", "fetched", "paypal_candidates", "persistable"].includes(k)
                    ? (Number(v) > 0 ? true : Number(v) === 0 ? false : undefined)
                    : undefined
                } />
              ))}
              {importData.scanId && (
                <a href={importData.invoicesUrl} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white">
                  View imported PayPal invoices →
                </a>
              )}
              {Array.isArray(importData.skipReasons) && importData.skipReasons.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold">Skip reasons ({importData.skipReasons.length})</summary>
                  <div className="mt-2 text-xs space-y-1">
                    {importData.skipReasons.map((s: any, i: number) => (
                      <div key={i} className="truncate text-muted-foreground">• {s.subject || s.sender || ""} — {s.reason}</div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </section>
      )}

      {err && (
        <div className="rounded-xl border border-red-300 bg-red-50 text-red-700 px-4 py-3 text-sm">
          <strong>Error:</strong> {err}
          {err.toLowerCase().includes("unauthor") && (
            <> — your session may have expired. <a className="underline" href="/login">Log in again</a>.</>
          )}
        </div>
      )}

      {verdict && (
        <div className={
          "flex items-start gap-3 rounded-xl px-4 py-3 text-sm border " +
          (verdict.tone === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : verdict.tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-800"
            : "border-red-300 bg-red-50 text-red-800")
        }>
          {verdict.tone === "ok" ? <CheckCircle2 className="h-5 w-5 shrink-0" />
            : verdict.tone === "warn" ? <AlertTriangle className="h-5 w-5 shrink-0" />
            : <XCircle className="h-5 w-5 shrink-0" />}
          <span>{verdict.text}</span>
        </div>
      )}

      {data && (
        <>
          <section className="rounded-xl border border-border p-4">
            <h2 className="font-bold mb-2">Worker</h2>
            <Row label="Reachable" value={String(data.worker?.ok)} good={data.worker?.ok} />
            <Row label="Version" value={data.worker?.version ?? "—"} />
            <Row label="PayPal discovery anchor" value={String(data.worker?.paypalDiscoveryAnchor)} good={data.worker?.paypalDiscoveryAnchor} />
            <Row label="Your role" value={data.role ?? "—"} />
          </section>

          <section className="rounded-xl border border-border p-4">
            <h2 className="font-bold mb-2">Gmail connection</h2>
            <Row label="Account" value={conn?.email ?? "— none connected —"} good={!!conn?.email} />
            <Row label="Has gmail.readonly scope" value={String(conn?.hasGmailScope)} good={conn?.hasGmailScope} />
            <Row label="Has refresh token" value={String(conn?.hasRefreshToken)} good={conn?.hasRefreshToken} />
            <Row label="Token expiry" value={conn?.tokenExpiry ?? "—"} />
            {disco?.auth_error && <Row label="Auth error" value={disco.auth_error} good={false} />}
            {needsReconnect && (
              <a href="/login" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white">
                <RefreshCw className="h-4 w-4" /> Reconnect Gmail
              </a>
            )}
          </section>

          {disco?.probes && (
            <section className="rounded-xl border border-border p-4">
              <h2 className="font-bold mb-2">Gmail discovery probes (last {data.daysBack} days)</h2>
              <div className="space-y-1">
                {Object.entries(probes).map(([label, p]) => (
                  <Row
                    key={label}
                    label={label}
                    value={p.error ? `error: ${p.error}` : `~${p.result_size_estimate ?? "?"} found`}
                    good={p.error ? false : (p.result_size_estimate ?? 0) > 0 ? true : undefined}
                  />
                ))}
              </div>
              {ppFrom?.samples && ppFrom.samples.length > 0 && (
                <div className="mt-3 text-xs text-muted-foreground">
                  <div className="font-semibold mb-1">Sample PayPal senders/subjects:</div>
                  {ppFrom.samples.map((s, i) => (
                    <div key={i} className="truncate">• {s.sender} — {s.subject}</div>
                  ))}
                </div>
              )}
            </section>
          )}

          {disco?.paypal_classification_sample && disco.paypal_classification_sample.length > 0 && (
            <section className="rounded-xl border border-border p-4">
              <h2 className="font-bold mb-2">Classification sample (from:paypal)</h2>
              <div className="space-y-2 text-xs">
                {disco.paypal_classification_sample.map((s, i) => (
                  <div key={i} className="border-b border-border/40 pb-2">
                    <div className="truncate font-medium">{s.subject}</div>
                    <div className="text-muted-foreground">
                      tier=<b>{s.tier}</b> · score={s.score} · txn={String(s.is_transaction)}
                      {s.merchant ? ` · ${s.merchant}` : ""}{s.amount ? ` · ${s.amount} ${s.currency}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <details className="rounded-xl border border-border p-4">
            <summary className="cursor-pointer font-bold text-sm">Raw JSON (copy for support)</summary>
            <pre className="mt-3 overflow-auto text-xs bg-muted/40 p-3 rounded-lg max-h-96">
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}
