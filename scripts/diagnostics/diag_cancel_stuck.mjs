// Clear any stuck RUNNING scans so the user can start a new one immediately.
// Only marks scans that have been RUNNING > 5 min to avoid stomping on a
// scan actively in flight.
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

const result = await client.query(`
  UPDATE scans
  SET status = 'CANCELLED',
      progress = 100,
      "progressMessage" = 'Reset by ops — scan was hung past the 70% regex backtracking bug',
      "completedAt" = NOW()
  WHERE status = 'RUNNING'
    AND "startedAt" < NOW() - INTERVAL '5 minutes'
  RETURNING id, "startedAt"
`);
console.log('Cleared scans:', result.rows);

await client.end();
