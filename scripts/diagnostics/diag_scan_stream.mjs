// Hit the local worker /scan endpoint and timestamp every NDJSON line.
// Goal: see if the stream stops dead at 70% (worker hang / silent crash)
// or if the stream just slows due to a long blocking call between phases.
// Tokens never printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const credsPath = path.join(os.tmpdir(), 'invoice_fetcher_diag_creds.json');
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

const WORKER_URL = process.env.WORKER_URL || 'http://127.0.0.1:8000';
const DAYS_BACK = parseInt(process.env.DAYS_BACK || '7', 10);

const body = {
  access_token: creds.access_token,
  refresh_token: creds.refresh_token,
  token_expiry: creds.token_expiry,
  keywords: [],
  days_back: DAYS_BACK,
  unread_only: false,
  scan_id: 'diag-' + Date.now().toString(36),
};

const t0 = Date.now();
function ts() { return ((Date.now() - t0) / 1000).toFixed(2) + 's'; }

console.log(`[${ts()}] POST ${WORKER_URL}/scan days_back=${DAYS_BACK} unread_only=false`);

const res = await fetch(`${WORKER_URL}/scan`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(900_000), // 15 min
});

console.log(`[${ts()}] HTTP ${res.status} headers received`);

if (!res.ok) {
  const text = await res.text();
  console.log(text.slice(0, 500));
  process.exit(1);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let lastChunkTime = Date.now();
let finalSeen = false;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunkTime = Date.now();
  const gap = ((chunkTime - lastChunkTime) / 1000).toFixed(2);
  lastChunkTime = chunkTime;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.trim()) continue;
    let data;
    try { data = JSON.parse(line); } catch { console.log(`[${ts()}] (gap=${gap}s) MALFORMED:`, line.slice(0, 120)); continue; }
    const hasResult = !!data.result;
    if (hasResult) {
      finalSeen = true;
      const r = data.result;
      console.log(`[${ts()}] (gap=${gap}s) progress=${data.progress} stage=${data.stage} message="${data.message?.slice(0,80) ?? ''}" ← FINAL RESULT total=${r.total_messages} invoices=${r.invoices?.length} error=${r.error ?? 'null'}`);
    } else {
      console.log(`[${ts()}] (gap=${gap}s) progress=${data.progress} stage=${data.stage} message="${(data.message ?? '').slice(0,100)}"`);
    }
  }
}

if (buffer.trim()) {
  console.log(`[${ts()}] residual buffer: ${buffer.slice(0, 200)}`);
}

console.log(`[${ts()}] STREAM ENDED. finalResultSeen=${finalSeen}`);
