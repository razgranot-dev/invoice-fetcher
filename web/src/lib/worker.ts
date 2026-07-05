/**
 * Python worker client.
 *
 * Calls the FastAPI worker to execute Gmail scans.
 * Default: http://localhost:8000 for local development.
 */

import { extractCompany, normalizeCompanyName } from "@/lib/scan-company";

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8000";
const WORKER_SECRET = process.env.WORKER_SECRET ?? "";

/** Build auth headers for worker requests. When WORKER_SECRET is set,
 *  includes a Bearer token so the worker can reject unauthorized callers. */
function workerHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...extra };
  if (WORKER_SECRET) {
    headers["Authorization"] = `Bearer ${WORKER_SECRET}`;
  }
  return headers;
}

interface WorkerScanRequest {
  access_token: string;
  refresh_token: string | null;
  token_expiry: string | null;
  keywords: string[];
  days_back: number;
  unread_only: boolean;
  scan_id: string;
}

interface WorkerScanResult {
  scan_id: string;
  total_messages: number;
  invoices: Array<{
    uid?: string;
    subject?: string;
    sender?: string;
    date?: string;
    company?: string;
    amount?: number;
    currency?: string;
    classification_tier?: string;
    classification_score?: number;
    classification_signals?: Record<string, unknown>;
    notes?: string;
    body_html?: string;
    saved_path?: string;
    attachments?: Array<{ filename?: string }>;
  }>;
  error: string | null;
}

/**
 * Distinct worker-health states so callers can tell WHY the worker is not
 * usable, not just that it isn't:
 *   • "healthy"     — /health answered 2xx.
 *   • "unhealthy"   — /health answered, but non-2xx (process up, failing).
 *   • "unreachable" — no HTTP response at all (probe timed out / connection
 *                     refused). On Render's free tier this is almost always a
 *                     spun-down cold instance, but also covers a hard-down or
 *                     network-partitioned worker.
 */
export type WorkerHealthState = "healthy" | "unhealthy" | "unreachable";

export async function checkWorkerHealth(): Promise<{
  ok: boolean;
  state: WorkerHealthState;
  error?: string;
  version?: string;
  paypalDiscoveryAnchor?: boolean;
}> {
  try {
    const res = await fetch(`${WORKER_URL}/health`, {
      headers: workerHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { ok: false, state: "unhealthy", error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return {
      ok: true,
      state: "healthy",
      version: data.version,
      paypalDiscoveryAnchor: data.paypal_discovery_anchor,
    };
  } catch (e: unknown) {
    // fetch threw → never got an HTTP response. AbortSignal.timeout yields a
    // TimeoutError; a refused/reset connection or DNS failure yields a
    // TypeError. We cannot distinguish "waking" from "dead" without waiting,
    // so report the honest ambiguous state rather than a bare "unavailable".
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, state: "unreachable", error: msg };
  }
}

/**
 * Keep-alive ping for the worker. The Render free tier spins the service down
 * after ~15min of inactivity, so the first scan after idle hits a ~30-60s cold
 * start (or times out). A cron hits this every few minutes to keep it warm.
 * Unlike checkWorkerHealth()'s 3s probe, this uses a generous timeout so that
 * if the worker HAS gone cold, the ping actually waits for it to wake.
 */
export async function keepWorkerWarm(): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(`${WORKER_URL}/health`, {
      headers: workerHeaders(),
      signal: AbortSignal.timeout(55_000),
    });
    return { ok: res.ok, status: res.status };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, status: 0, error: msg };
  }
}

/** Call the worker's emergency PayPal-only import. Returns funnel + invoices. */
export async function dispatchPaypalImport(
  connection: { accessToken: string; refreshToken: string | null; tokenExpiry: Date | null },
  daysBack: number,
): Promise<{
  auth_ok?: boolean;
  auth_error?: string;
  funnel?: Record<string, number | null>;
  skip_reasons?: Array<{ sender?: string; subject?: string; reason?: string }>;
  invoices?: Array<Record<string, unknown>>;
  import_query?: string;
  worker_version?: string;
}> {
  const res = await fetch(`${WORKER_URL}/debug/paypal-import`, {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify({
      access_token: connection.accessToken,
      refresh_token: connection.refreshToken,
      token_expiry: connection.tokenExpiry?.toISOString() ?? null,
      days_back: daysBack,
    }),
    signal: AbortSignal.timeout(280_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Worker paypal-import error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Call the worker's real-Gmail PayPal discovery probe. Returns raw JSON. */
export async function dispatchDiscoveryDebug(
  connection: { accessToken: string; refreshToken: string | null; tokenExpiry: Date | null },
  daysBack: number,
): Promise<unknown> {
  const res = await fetch(`${WORKER_URL}/debug/discovery`, {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify({
      access_token: connection.accessToken,
      refresh_token: connection.refreshToken,
      token_expiry: connection.tokenExpiry?.toISOString() ?? null,
      days_back: daysBack,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Worker discovery-debug error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Scan dispatch timeout. MUST stay below the route's `maxDuration` (300s in
 * web/src/app/api/scans/route.ts) so the fetch aborts — and the catch block
 * writes FAILED — while the after() callback is still alive. At 600s the
 * old timeout could never fire on Vercel: the function was killed at 300s
 * and the scan was stranded in RUNNING with no error written.
 * Guarded by web/src/lib/__tests__/scan-timeouts.test.ts.
 */
export const SCAN_DISPATCH_TIMEOUT_MS = 270_000;

/**
 * Best-effort request for the worker to stop an in-flight scan at its next
 * batch boundary (contract: POST /scan/cancel/{id} → {"status":
 * "cancel_requested"}). The CANCELLED DB write is the source of truth — if
 * the worker is unreachable it just finishes a scan whose results the
 * dispatch loop will discard, so failures are swallowed and returned as
 * `false` rather than thrown.
 */
export async function dispatchScanCancel(scanId: string): Promise<boolean> {
  try {
    const res = await fetch(`${WORKER_URL}/scan/cancel/${encodeURIComponent(scanId)}`, {
      method: "POST",
      headers: workerHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function dispatchScan(
  scanId: string,
  connection: {
    accessToken: string;
    refreshToken: string | null;
    tokenExpiry: Date | null;
  },
  params: {
    keywords: string[];
    daysBack: number;
    unreadOnly: boolean;
  },
  onProgress?: (progress: number, message: string, stage: string) => Promise<void>,
  // External abort hook — the scans route aborts this when the user cancels,
  // so the streaming fetch (and the worker's effort) stops mid-scan instead
  // of running to completion against a CANCELLED scan.
  signal?: AbortSignal
): Promise<WorkerScanResult> {
  const body: WorkerScanRequest = {
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
    token_expiry: connection.tokenExpiry?.toISOString() ?? null,
    keywords: params.keywords,
    days_back: params.daysBack,
    unread_only: params.unreadOnly,
    scan_id: scanId,
  };

  const timeoutSignal = AbortSignal.timeout(SCAN_DISPATCH_TIMEOUT_MS);
  const res = await fetch(`${WORKER_URL}/scan`, {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Worker error ${res.status}: ${text}`);
  }

  // Stream NDJSON, emit progress, return final result
  let finalResult: WorkerScanResult | null = null;

  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.result) {
            finalResult = data.result;
          }
          if (data.progress != null && onProgress) {
            await onProgress(data.progress, data.message ?? "", data.stage ?? "");
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer);
        if (data.result) finalResult = data.result;
        if (data.progress != null && onProgress) {
          await onProgress(data.progress, data.message ?? "", data.stage ?? "");
        }
      } catch {
        // skip
      }
    }
  } else {
    // Fallback: non-streaming
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.result) finalResult = data.result;
        if (data.progress != null && onProgress) {
          await onProgress(data.progress, data.message ?? "", data.stage ?? "");
        }
      } catch {
        // skip
      }
    }
  }

  if (!finalResult) {
    throw new Error("Worker returned no final result");
  }

  return finalResult;
}

export interface ExportResult {
  file: Buffer | null;
  fileSize: number;
  fileCached: boolean;
  failures?: Array<{ supplier: string; date: string; reason: string }>;
  failedCount?: number;
}

/**
 * Read an NDJSON response body as a stream, calling onProgress for each line
 * as it arrives from the worker — not after the entire response buffers.
 */
async function readNdjsonStream(
  res: Response,
  onProgress?: (progress: number, message: string) => Promise<void>
): Promise<ExportResult> {
  let fileData: Buffer | null = null;
  let fileSize: number | null = null;
  let fileCached = false;
  let lastError: string | null = null;
  let failures: Array<{ supplier: string; date: string; reason: string }> | undefined;

  function processLine(line: string) {
    if (!line.trim()) return;
    try {
      const data = JSON.parse(line);
      if (data.file) {
        fileData = Buffer.from(data.file, "base64");
        fileSize = fileData.length;
      }
      if (data.file_cached) {
        fileCached = true;
        fileSize = data.file_size ?? null;
      }
      if (data.failures) {
        failures = data.failures;
      }
      if (data.error) {
        lastError = data.error;
      }
      return data;
    } catch {
      return null;
    }
  }

  // Stream the response body line-by-line so progress DB writes happen in real time
  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (possibly incomplete) chunk in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const data = processLine(line);
        if (data?.progress != null && onProgress) {
          await onProgress(data.progress, data.message ?? "");
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim()) {
      const data = processLine(buffer);
      if (data?.progress != null && onProgress) {
        await onProgress(data.progress, data.message ?? "");
      }
    }
  } else {
    // Fallback: no streaming body (shouldn't happen in Node.js)
    const text = await res.text();
    for (const line of text.split("\n")) {
      const data = processLine(line);
      if (data?.progress != null && onProgress) {
        await onProgress(data.progress, data.message ?? "");
      }
    }
  }

  if (!fileData && !fileCached) {
    throw new Error(lastError ?? "Worker returned no file data");
  }

  return { file: fileData, fileSize: fileSize ?? 0, fileCached, failures, failedCount: failures?.length };
}

/** Normalize a currency symbol or code to ISO 4217. */
const SYMBOL_TO_ISO: Record<string, string> = { "₪": "ILS", "$": "USD", "€": "EUR", "£": "GBP" };
function normCurrency(raw: unknown): string {
  const s = typeof raw === "string" && raw ? raw : "ILS";
  return SYMBOL_TO_ISO[s] ?? s;
}

/** Extract a display-friendly company name from sender for export fallback.
 *  Delegates to the SAME extraction the scan pipeline uses (scan-company.ts,
 *  backed by the shared brand-data.json) — this file used to carry a third
 *  drifted copy of the noise/TLD/Meta-alias logic. */
function companyFromSender(sender: unknown): string {
  if (!sender || typeof sender !== "string") return "";
  const company = extractCompany(sender);
  return company ? normalizeCompanyName(company) : "";
}

/** Word export never renders screenshots (that flag was removed end-to-end;
 *  the worker ignores and warns on it), so a fixed budget is enough. */
export const WORD_EXPORT_TIMEOUT_MS = 60_000;

/**
 * Screenshot-ZIP dispatch timeout, sized by invoice count. Worker budget:
 * default concurrency 3 pages, 45s hard cap per screenshot → worst-case
 * amortized 15s per invoice, plus a 120s base for browser launch and ZIP
 * assembly, capped at 15 min. Guarantees the client never aborts before the
 * worker's own per-screenshot cap can fire.
 */
export function screenshotZipTimeoutMs(invoiceCount: number): number {
  return Math.min(120_000 + invoiceCount * 15_000, 900_000);
}

export async function dispatchWordExport(
  invoices: Array<Record<string, unknown>>,
  organizationName: string,
  onProgress?: (progress: number, message: string) => Promise<void>,
  jobId?: string,
  // True when the user explicitly hand-picked these invoices — the worker's
  // screenshot-worthiness heuristics defer to an explicit selection.
  selectionMode = false,
): Promise<ExportResult> {
  const mapped = invoices.map((inv) => ({
    id: inv.id ?? "",
    company: (inv.company as string) || companyFromSender(inv.sender),
    subject: inv.subject ?? "",
    sender: inv.sender ?? "",
    amount: inv.amount ?? null,
    currency: normCurrency(inv.currency),
    date: inv.date
      ? new Date(inv.date as string).toISOString().split("T")[0]
      : "",
    classification_tier: inv.classificationTier ?? "",
    has_attachment: inv.hasAttachment ?? false,
    scan_id: inv.scanId ?? "",
    notes: inv.notes ?? "",
    ...(selectionMode ? { explicitly_selected: true } : {}),
  }));

  const res = await fetch(`${WORKER_URL}/export/word`, {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify({
      invoices: mapped,
      organization_name: organizationName,
      format: "word",
      job_id: jobId ?? "",
    }),
    signal: AbortSignal.timeout(WORD_EXPORT_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Worker export error ${res.status}: ${text}`);
  }

  return readNdjsonStream(res, onProgress);
}

export async function dispatchScreenshotZip(
  invoices: Array<Record<string, unknown>>,
  onProgress?: (progress: number, message: string) => Promise<void>,
  jobId?: string,
  // True when the user explicitly hand-picked these invoices — the worker's
  // is_screenshot_worthy() always renders explicitly-selected rows.
  selectionMode = false,
): Promise<ExportResult> {
  const mapped = invoices.map((inv) => ({
    id: inv.id ?? "",
    company: (inv.company as string) || companyFromSender(inv.sender),
    subject: inv.subject ?? "",
    sender: inv.sender ?? "",
    amount: inv.amount ?? null,
    currency: normCurrency(inv.currency),
    date: inv.date
      ? new Date(inv.date as string).toISOString().split("T")[0]
      : "",
    classification_tier: inv.classificationTier ?? "",
    scan_id: inv.scanId ?? "",
    ...(inv.bodyHtml ? { body_html: inv.bodyHtml } : {}),
    ...(selectionMode ? { explicitly_selected: true } : {}),
  }));

  const res = await fetch(`${WORKER_URL}/export/screenshots-zip`, {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify({
      invoices: mapped,
      include_screenshots: true,
      job_id: jobId ?? "",
    }),
    signal: AbortSignal.timeout(screenshotZipTimeoutMs(mapped.length)),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Worker screenshot-zip error ${res.status}: ${text}`);
  }

  return readNdjsonStream(res, onProgress);
}

/**
 * Proxy a file download from the worker's in-memory cache.
 * Returns the raw fetch Response for streaming to the browser.
 *
 * The jobId is validated to be a safe CUID before interpolation into the URL
 * to prevent path traversal or SSRF via crafted identifiers.
 */
export async function proxyWorkerDownload(jobId: string): Promise<Response> {
  // Validate jobId format — must be a CUID (starts with 'c', alphanumeric, 20-30 chars)
  if (!/^c[a-z0-9]{20,30}$/i.test(jobId)) {
    throw new Error("Invalid export ID format");
  }
  return fetch(`${WORKER_URL}/export/${jobId}/download`, {
    headers: workerHeaders(),
    signal: AbortSignal.timeout(30_000),
  });
}
