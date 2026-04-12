/**
 * Python worker client.
 *
 * Calls the FastAPI worker to execute Gmail scans.
 * Default: http://localhost:8000 for local development.
 */

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8000";

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

export async function checkWorkerHealth(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(`${WORKER_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { ok: false, error: msg };
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
  }
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

  const res = await fetch(`${WORKER_URL}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000), // 10 min timeout for large scans (4+ months back)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Worker error ${res.status}: ${text}`);
  }

  return res.json();
}

export interface ExportResult {
  file: Buffer;
  failures?: Array<{ supplier: string; date: string; reason: string }>;
  failedCount?: number;
}

export async function dispatchWordExport(
  invoices: Array<Record<string, unknown>>,
  organizationName: string,
  includeScreenshots = false,
  onProgress?: (progress: number, message: string) => Promise<void>
): Promise<ExportResult> {
  const mapped = invoices.map((inv) => ({
    id: inv.id ?? "",
    company: inv.company ?? "",
    subject: inv.subject ?? "",
    sender: inv.sender ?? "",
    amount: inv.amount ?? null,
    currency: inv.currency ?? "ILS",
    date: inv.date
      ? new Date(inv.date as string).toISOString().split("T")[0]
      : "",
    classification_tier: inv.classificationTier ?? "",
    has_attachment: inv.hasAttachment ?? false,
    scan_id: inv.scanId ?? "",
    notes: inv.notes ?? "",
    ...(includeScreenshots && inv.bodyHtml ? { body_html: inv.bodyHtml } : {}),
  }));

  const timeout = includeScreenshots ? 300_000 : 60_000;

  const res = await fetch(`${WORKER_URL}/export/word`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invoices: mapped,
      organization_name: organizationName,
      format: "word",
      include_screenshots: includeScreenshots,
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Worker export error ${res.status}: ${text}`);
  }

  // Read streaming NDJSON response
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.trim());

  let fileData: Buffer | null = null;
  let lastError: string | null = null;
  let failures: Array<{ supplier: string; date: string; reason: string }> | undefined;

  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      if (data.progress != null && onProgress) {
        await onProgress(data.progress, data.message ?? "");
      }
      if (data.file) {
        fileData = Buffer.from(data.file, "base64");
      }
      if (data.failures) {
        failures = data.failures;
      }
      if (data.error) {
        lastError = data.error;
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (!fileData) {
    throw new Error(lastError ?? "Worker returned no file data");
  }

  return { file: fileData, failures, failedCount: failures?.length };
}

export async function dispatchScreenshotZip(
  invoices: Array<Record<string, unknown>>,
  onProgress?: (progress: number, message: string) => Promise<void>
): Promise<ExportResult> {
  const mapped = invoices.map((inv) => ({
    id: inv.id ?? "",
    company: inv.company ?? "",
    subject: inv.subject ?? "",
    sender: inv.sender ?? "",
    amount: inv.amount ?? null,
    currency: inv.currency ?? "ILS",
    date: inv.date
      ? new Date(inv.date as string).toISOString().split("T")[0]
      : "",
    classification_tier: inv.classificationTier ?? "",
    scan_id: inv.scanId ?? "",
    ...(inv.bodyHtml ? { body_html: inv.bodyHtml } : {}),
  }));

  const res = await fetch(`${WORKER_URL}/export/screenshots-zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invoices: mapped,
      include_screenshots: true,
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Worker screenshot-zip error ${res.status}: ${text}`);
  }

  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.trim());

  let fileData: Buffer | null = null;
  let lastError: string | null = null;
  let failures: Array<{ supplier: string; date: string; reason: string }> | undefined;

  for (const line of lines) {
    try {
      const data = JSON.parse(line);
      if (data.progress != null && onProgress) {
        await onProgress(data.progress, data.message ?? "");
      }
      if (data.file) {
        fileData = Buffer.from(data.file, "base64");
      }
      if (data.failures) {
        failures = data.failures;
      }
      if (data.error) {
        lastError = data.error;
      }
    } catch {
      // Skip malformed lines
    }
  }

  if (!fileData) {
    throw new Error(lastError ?? "Worker returned no ZIP data");
  }

  return { file: fileData, failures, failedCount: failures?.length };
}
