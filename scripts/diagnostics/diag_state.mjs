// Diagnostic: inspect DB state without exposing secrets (tokens redacted)
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
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 10000 });
await client.connect();

console.log('\n=== ORG / USER COUNT ===');
console.log(await client.query('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM organizations) AS orgs, (SELECT COUNT(*) FROM gmail_connections) AS conns, (SELECT COUNT(*) FROM scans) AS scans, (SELECT COUNT(*) FROM invoices) AS invoices').then(r => r.rows[0]));

console.log('\n=== GMAIL CONNECTIONS (token presence only, no values) ===');
const conns = await client.query(`
  SELECT id, "organizationId", email, "isActive",
         "connectedAt", "lastUsedAt", "tokenExpiry",
         CASE WHEN "accessToken" IS NULL OR "accessToken" = '' THEN 'EMPTY'
              ELSE 'SET(' || length("accessToken") || ' chars)' END AS access_token,
         CASE WHEN "refreshToken" IS NULL OR "refreshToken" = '' THEN 'EMPTY'
              ELSE 'SET(' || length("refreshToken") || ' chars)' END AS refresh_token,
         scopes
  FROM gmail_connections
  ORDER BY "connectedAt" DESC
  LIMIT 5
`);
for (const c of conns.rows) {
  const tokenAge = c.tokenExpiry ? Math.round((Date.now() - new Date(c.tokenExpiry).getTime()) / 1000) : null;
  console.log({
    id: c.id,
    email: c.email,
    isActive: c.isActive,
    connectedAt: c.connectedAt,
    lastUsedAt: c.lastUsedAt,
    tokenExpiry: c.tokenExpiry,
    secondsPastExpiry: tokenAge,  // negative = still valid
    access_token: c.access_token,
    refresh_token: c.refresh_token,
    scopes: c.scopes,
  });
}

console.log('\n=== LAST 10 SCANS ===');
const scans = await client.query(`
  SELECT id, "organizationId", status, keywords, "daysBack", "unreadOnly",
         "totalMessages", "processedCount", "invoiceCount", progress,
         "progressMessage", "errorMessage", "startedAt", "completedAt", "createdAt"
  FROM scans
  ORDER BY "createdAt" DESC
  LIMIT 10
`);
for (const s of scans.rows) {
  console.log({
    id: s.id,
    status: s.status,
    createdAt: s.createdAt,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    progress: s.progress,
    progressMessage: s.progressMessage,
    errorMessage: s.errorMessage,
    totalMessages: s.totalMessages,
    invoiceCount: s.invoiceCount,
  });
}

console.log('\n=== STUCK RUNNING SCANS (>15 min old) ===');
const stuck = await client.query(`
  SELECT id, status, "startedAt", "progressMessage", EXTRACT(EPOCH FROM (NOW() - "startedAt")) AS age_seconds
  FROM scans
  WHERE status IN ('RUNNING', 'PENDING') AND "startedAt" < NOW() - INTERVAL '15 minutes'
`);
console.log('stuck count:', stuck.rows.length);
for (const s of stuck.rows) console.log(s);

await client.end();
