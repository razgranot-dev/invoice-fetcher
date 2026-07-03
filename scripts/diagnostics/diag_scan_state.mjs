// Diagnose end-to-end scan state without printing tokens.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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

const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const conns = await client.query(`
  SELECT id, email, "isActive", "connectedAt", "lastUsedAt", "tokenExpiry",
         array_length(scopes,1) AS scope_count,
         length("accessToken") AS at_len,
         length("refreshToken") AS rt_len
  FROM gmail_connections
  ORDER BY "lastUsedAt" DESC NULLS LAST
`);
console.log('=== gmail_connections ===');
for (const r of conns.rows) {
  console.log({
    id: r.id,
    email: r.email,
    isActive: r.isActive,
    connectedAt: r.connectedAt,
    lastUsedAt: r.lastUsedAt,
    tokenExpiry: r.tokenExpiry,
    scope_count: r.scope_count,
    accessToken_len: r.at_len,
    refreshToken_len: r.rt_len,
    expiryExpired: r.tokenExpiry ? new Date(r.tokenExpiry) < new Date() : null,
  });
}

const scans = await client.query(`
  SELECT id, status, "createdAt", "startedAt", "completedAt",
         "totalMessages", "invoiceCount", progress,
         left("progressMessage", 200) AS progress_message,
         left("errorMessage", 400) AS error_message,
         "connectionId"
  FROM scans
  ORDER BY "createdAt" DESC
  LIMIT 10
`);
console.log('\n=== last 10 scans ===');
for (const s of scans.rows) {
  console.log({
    id: s.id,
    status: s.status,
    createdAt: s.createdAt,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    progress: s.progress,
    totalMessages: s.totalMessages,
    invoiceCount: s.invoiceCount,
    progressMessage: s.progress_message,
    errorMessage: s.error_message,
    connectionId: s.connectionId,
  });
}

console.log('\n=== environment sanity ===');
console.log({
  AUTH_GOOGLE_ID_set: !!process.env.AUTH_GOOGLE_ID,
  AUTH_GOOGLE_SECRET_set: !!process.env.AUTH_GOOGLE_SECRET,
  WORKER_URL: process.env.WORKER_URL ?? '(default localhost:8000)',
  WORKER_SECRET_set: !!process.env.WORKER_SECRET,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? '(unset)',
  AUTH_URL: process.env.AUTH_URL ?? '(unset)',
  NOW: new Date().toISOString(),
});

await client.end();
