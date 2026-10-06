import { readFile } from 'node:fs/promises';
import pg from 'pg';

async function main() {
  const envFile = await readFile('.env', 'utf8');
  const DATABASE_URL = envFile.split(/\r?\n/).find(v => /^\s*DATABASE_URL\s*=/.test(v)).split('=')[1].trim().replace(/^['"]|['"]$/g, '');

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const dbLakopBRes = await client.query(`
    SELECT DISTINCT ci.name AS item_name, i.schedule_code, i.maintenance_type
    FROM maintenance_inspections i
    JOIN maintenance_check_results cr ON cr.inspection_id = i.id
    JOIN maintenance_check_items ci ON ci.id = cr.item_id
    WHERE lower(i.machine_name) LIKE '%lakop b%'
  `);

  console.log('Lakop B items count in DB:', dbLakopBRes.rows.length);
  dbLakopBRes.rows.forEach(r => console.log('  DB Item:', r.item_name, '| Schedule:', r.schedule_code || r.maintenance_type));

  await client.end();
}

main().catch(console.error);
