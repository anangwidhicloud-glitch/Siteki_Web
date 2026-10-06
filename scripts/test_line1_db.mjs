import pg from 'pg';
import { readFile } from 'node:fs/promises';

async function test() {
  const envFile = await readFile('.env', 'utf8');
  const DATABASE_URL = envFile.split(/\r?\n/).find(v => /^\s*DATABASE_URL\s*=/.test(v)).split('=')[1].trim().replace(/^['"]|['"]$/g, '');
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const res = await client.query(`
    SELECT DISTINCT ci.name
    FROM maintenance_inspections i
    JOIN maintenance_check_results cr ON cr.inspection_id = i.id
    JOIN maintenance_check_items ci ON ci.id = cr.item_id
    WHERE lower(i.machine_name) = 'line 01'
    ORDER BY ci.name
  `);

  console.log('Line 01 items in database:', res.rows.map(r => r.name));
  await client.end();
}

test().catch(console.error);
