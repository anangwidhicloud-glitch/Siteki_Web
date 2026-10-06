import { readFile } from 'node:fs/promises';
import pg from 'pg';

async function run() {
  const envFile = await readFile('.env', 'utf8');
  const line = envFile.split(/\r?\n/).find(v => /^\s*DATABASE_URL\s*=/.test(v));
  const DATABASE_URL = line.split('=')[1].trim().replace(/^['"]|['"]$/g, '');
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const sampleInspection = await client.query('SELECT id FROM maintenance_inspections LIMIT 1');
  const id = sampleInspection.rows[0].id;

  const start = performance.now();
  const rows = await client.query(`
    SELECT 
      item.name,
      item.sort_order,
      result.status,
      coalesce(result.raw_status,
        CASE result.status
          WHEN 'good' THEN 'Bagus'
          WHEN 'repair_needed' THEN 'Perbaikan'
          WHEN 'not_applicable' THEN 'T.A'
          ELSE result.status
        END) AS raw_status
    FROM maintenance_check_results result
    JOIN maintenance_check_items item ON item.id = result.item_id
    WHERE result.inspection_id = $1
    ORDER BY item.sort_order, item.name
  `, [id]);
  const end = performance.now();
  console.log(`Single inspection query took ${(end - start).toFixed(1)}ms. Checks count:`, rows.rows.length);
  console.log('Sample checks:', rows.rows.slice(0, 5));

  await client.end();
}

run().catch(console.error);
