// Diagnostic: test DB connection without exposing secrets
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '..', 'web', '.env');
const text = fs.readFileSync(envPath, 'utf8');
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2];
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

const url = process.env.DATABASE_URL || '';
if (!url) {
  console.log('DATABASE_URL: MISSING');
  process.exit(1);
}

// Parse host without exposing credentials
let host = 'unknown';
try {
  const u = new URL(url.replace(/^postgresql:/, 'http:'));
  host = u.host;
} catch (e) {
  console.log('DATABASE_URL: parse error', e.message);
}

console.log(`DATABASE_URL: SET, host=${host}, length=${url.length}`);

const start = Date.now();
try {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, statement_timeout: 5000 });
  await client.connect();
  const res = await client.query('SELECT 1 as ok, current_database() as db');
  console.log(`DB CONNECT OK in ${Date.now() - start}ms`, res.rows[0]);
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  console.log('TABLES:', tables.rows.map(r => r.tablename).join(', '));
  await client.end();
} catch (e) {
  console.log(`DB CONNECT FAILED in ${Date.now() - start}ms:`, e.code || '', e.message);
  if (e.stack) console.log(e.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(2);
}
