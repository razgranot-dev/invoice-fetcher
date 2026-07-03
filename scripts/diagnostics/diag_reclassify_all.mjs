// Re-classify every invoice in the DB against the CURRENT classifier rules
// and update classificationTier / classificationScore / classificationSignals
// AND reportStatus (using the same tier→status mapping as the scan route).
//
// Use case: when the classifier improves (e.g., we add `was unsuccessful` to
// the instant-disqualify list), historical rows persisted by the OLD
// classifier keep their stale tier and stay INCLUDED, polluting the report.
// This script walks every row once and rewrites them.
//
// Safe to re-run; idempotent.
//
// Invokes the Python classifier via a child_process call to keep the rule
// source-of-truth in one place (core/invoice_classifier.py).

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '..', 'web', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2];
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

const projectRoot = path.join(__dirname, '..', '..');

function defaultReportStatus(tier) {
  return tier === 'confirmed_invoice' || tier === 'likely_invoice'
    ? 'INCLUDED'
    : 'EXCLUDED';
}

// Call Python classifier in one shot — pass an NDJSON stream of emails on
// stdin, get NDJSON of {id, tier, score, signals} back on stdout.
function classifyBatch(emails) {
  return new Promise((resolve, reject) => {
    const py = spawn('python', ['-u', '-m', 'scripts.diag_reclassify_helper'], {
      cwd: projectRoot,
      env: { ...process.env, PYTHONPATH: projectRoot },
    });
    let out = '';
    let err = '';
    py.stdout.on('data', (d) => { out += d.toString(); });
    py.stderr.on('data', (d) => { err += d.toString(); });
    py.on('error', reject);
    py.on('close', (code) => {
      if (code !== 0) return reject(new Error(`python exit ${code}: ${err}`));
      try {
        const result = out
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l));
        resolve(result);
      } catch (e) {
        reject(new Error(`bad JSON from python: ${e.message}\n${out.slice(0, 500)}`));
      }
    });
    for (const e of emails) py.stdin.write(JSON.stringify(e) + '\n');
    py.stdin.end();
  });
}

const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Get all invoices that need re-classification. We don't try to be clever
// about which are stale — just walk everything once.
const rows = (await client.query(`
  SELECT id, "gmailMessageId", subject, sender, "bodyHtml", "hasAttachment",
         "classificationTier", "classificationScore", "reportStatus"
  FROM invoices
  ORDER BY date DESC NULLS LAST
`)).rows;

console.log(`Re-classifying ${rows.length} invoices ...`);

const BATCH = 100;
let changedTier = 0, changedStatus = 0, processed = 0;
for (let bi = 0; bi < rows.length; bi += BATCH) {
  const chunk = rows.slice(bi, bi + BATCH);
  const payload = chunk.map((r) => ({
    id: r.id,
    subject: r.subject || '',
    sender: r.sender || '',
    body_text: '',
    body_html: r.bodyHtml || '',
    attachments: r.hasAttachment ? [{ filename: 'attachment.pdf', content_type: 'application/pdf' }] : [],
  }));

  const results = await classifyBatch(payload);

  for (const res of results) {
    const orig = chunk.find((c) => c.id === res.id);
    if (!orig) continue;
    const newStatus = defaultReportStatus(res.tier);
    const tierChanged = orig.classificationTier !== res.tier;
    const statusChanged = orig.reportStatus !== newStatus;
    if (tierChanged) changedTier++;
    if (statusChanged) changedStatus++;
    if (tierChanged || statusChanged) {
      await client.query(
        `UPDATE invoices SET "classificationTier" = $1, "classificationScore" = $2,
         "classificationSignals" = $3::jsonb, "reportStatus" = $4 WHERE id = $5`,
        [res.tier, res.score, JSON.stringify(res.signals), newStatus, orig.id],
      );
    }
  }
  processed += chunk.length;
  process.stdout.write(`  ${processed}/${rows.length}  (tier changes=${changedTier}, status changes=${changedStatus})\r`);
}
console.log('\n');

console.log(`Done. Tier changes: ${changedTier}, reportStatus changes: ${changedStatus}, total processed: ${processed}`);

await client.end();
