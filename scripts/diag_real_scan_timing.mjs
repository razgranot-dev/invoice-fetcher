// Real-Gmail end-to-end scan via the worker, with per-line timing.
// Replays the dispatchScan path that web/src/lib/worker.ts uses.
// Outputs:
//   - full NDJSON timeline with elapsed-ms per event
//   - per-phase wall time (search / fetch / classify / enrich / done)
//   - tier counts from the final result
//   - max silent gap between progress emissions (to catch a stuck-at-N% regression)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const credsPath = path.join(os.tmpdir(), 'invoice_fetcher_diag_creds.json');
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

const WORKER = process.env.WORKER_URL || 'http://127.0.0.1:8000';
const DAYS_BACK = Number(process.env.DAYS_BACK || 30);

const body = {
  access_token: creds.access_token,
  refresh_token: creds.refresh_token,
  token_expiry: creds.token_expiry,
  keywords: [],
  days_back: DAYS_BACK,
  unread_only: false,
  scan_id: 'diag-realscan-' + Date.now(),
};

console.log(`Worker  : ${WORKER}/scan`);
console.log(`Params  : days_back=${DAYS_BACK} unread_only=false  (broader recall)`);

const t0 = Date.now();
function ms() { return Date.now() - t0; }

const res = await fetch(`${WORKER}/scan`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(600_000),
});

console.log(`[${ms().toString().padStart(6)}ms] HTTP ${res.status}`);
if (!res.ok) {
  console.log(await res.text());
  process.exit(2);
}

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let phaseStart = {};
let phaseDur = {};
let curPhase = null;
let lastEventAt = 0;
let maxGap = 0;
let eventCount = 0;
let finalResult = null;

function processLine(line) {
  if (!line.trim()) return;
  let data;
  try { data = JSON.parse(line); } catch { return; }
  eventCount++;
  const elapsed = ms();
  const gap = elapsed - lastEventAt;
  if (lastEventAt && gap > maxGap) maxGap = gap;
  lastEventAt = elapsed;

  const stage = data.stage || '?';
  if (curPhase !== stage) {
    if (curPhase) phaseDur[curPhase] = (phaseDur[curPhase] || 0) + (elapsed - phaseStart[curPhase]);
    phaseStart[stage] = elapsed;
    curPhase = stage;
  }
  const pct = data.progress?.toString().padStart(3) ?? '???';
  const msg = (data.message ?? '').slice(0, 90);
  console.log(`[${elapsed.toString().padStart(6)}ms] (+${gap.toString().padStart(5)}ms) ${stage.padEnd(8)} ${pct}%  ${msg}`);
  if (data.result) finalResult = data.result;
  if (data.tier_counts) console.log('         tier_counts:', JSON.stringify(data.tier_counts));
}

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const l of lines) processLine(l);
}
if (buffer.trim()) processLine(buffer);
if (curPhase) phaseDur[curPhase] = (phaseDur[curPhase] || 0) + (ms() - phaseStart[curPhase]);

console.log();
console.log('─'.repeat(70));
console.log('SUMMARY');
console.log('─'.repeat(70));
console.log(`Total wall time : ${ms()} ms`);
console.log(`NDJSON events   : ${eventCount}`);
console.log(`Max silent gap  : ${maxGap} ms`);
console.log();
console.log('Phase durations (ms):');
for (const [k, v] of Object.entries(phaseDur).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(6)} ms`);
}
console.log();
if (finalResult) {
  console.log(`Total messages  : ${finalResult.total_messages}`);
  console.log(`Invoices kept   : ${finalResult.invoices.length}`);
  if (finalResult.tier_counts) {
    console.log(`Tier counts     :`, JSON.stringify(finalResult.tier_counts));
  }
  // Per-tier inspection of a few examples
  const byTier = {};
  for (const inv of finalResult.invoices) {
    const t = inv.classification_tier || 'unknown';
    (byTier[t] = byTier[t] || []).push(inv);
  }
  console.log();
  console.log('Sample senders per tier:');
  for (const [t, list] of Object.entries(byTier)) {
    console.log(`  ${t} (${list.length}):`);
    for (const inv of list.slice(0, 8)) {
      const sender = (inv.sender || '').slice(0, 50);
      const subj = (inv.subject || '').slice(0, 60);
      console.log(`    [${(inv.classification_score ?? '?').toString().padStart(4)}] ${sender}  |  ${subj}`);
    }
    if (list.length > 8) console.log(`    ... and ${list.length - 8} more`);
  }
}
