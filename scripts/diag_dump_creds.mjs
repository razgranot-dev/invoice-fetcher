// Dump current DB creds to a 0600 temp file (no stdout).
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', 'web', '.env');
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
const c = await client.query(`
  SELECT "accessToken", "refreshToken", "tokenExpiry", scopes
  FROM gmail_connections
  WHERE "isActive" = true
  ORDER BY "lastUsedAt" DESC NULLS LAST
  LIMIT 1
`);
await client.end();

const row = c.rows[0];
const outPath = path.join(os.tmpdir(), 'invoice_fetcher_diag_creds.json');
fs.writeFileSync(outPath, JSON.stringify({
  access_token: row.accessToken,
  refresh_token: row.refreshToken,
  token_expiry: row.tokenExpiry,
  scopes: row.scopes,
  client_id: process.env.AUTH_GOOGLE_ID,
  client_secret: process.env.AUTH_GOOGLE_SECRET,
}), { mode: 0o600 });

console.log('Wrote creds.');
console.log('Scopes:', row.scopes);
console.log('Has gmail.readonly?', (row.scopes || []).includes('https://www.googleapis.com/auth/gmail.readonly'));
console.log('Token expiry:', row.tokenExpiry, 'expired:', new Date(row.tokenExpiry) < new Date());
