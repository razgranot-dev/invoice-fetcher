// Write the current tokens to a temp file readable only by us, so the Python
// diag script can reproduce the OAuth refresh failure with the real creds.
// Tokens are NEVER printed to stdout.
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

if (c.rows.length === 0) {
  console.error('NO ACTIVE CONNECTION');
  process.exit(1);
}

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
console.log('Wrote creds to', outPath);
console.log('Scopes from DB:', row.scopes);
console.log('Token expiry:', row.tokenExpiry, 'expired:', new Date(row.tokenExpiry) < new Date());
console.log('AccessToken length:', row.accessToken.length, 'RefreshToken length:', row.refreshToken.length);
