import { readFile } from 'node:fs/promises';
import worker from '../worker/siteki-api.js';

async function test() {
  const envFile = await readFile('.env', 'utf8');
  const DATABASE_URL = envFile.split(/\r?\n/).find(v => /^\s*DATABASE_URL\s*=/.test(v)).split('=')[1].trim().replace(/^['"]|['"]$/g, '');
  const env = { DATABASE_URL, ALLOWED_ORIGIN: 'https://siteki.xo.je' };

  import('pg').then(async ({ default: pg }) => {
    const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();

    // Query distinct (machine_name, schedule_code/maintenance_type, check_item_name) from actual inspection results
    const q1 = await client.query(`
      SELECT 
        i.machine_category,
        i.machine_type,
        i.machine_name,
        i.schedule_code,
        i.maintenance_type,
        ci.name AS item_name,
        ci.sort_order
      FROM maintenance_inspections i
      JOIN maintenance_check_results cr ON cr.inspection_id = i.id
      JOIN maintenance_check_items ci ON ci.id = cr.item_id
      GROUP BY i.machine_category, i.machine_type, i.machine_name, i.schedule_code, i.maintenance_type, ci.name, ci.sort_order
      ORDER BY i.machine_category, i.machine_name, ci.sort_order, ci.name
    `);

    console.log('Distinct (Machine, Schedule, Item) count in DB:', q1.rows.length);
    console.log('Sample rows:', q1.rows.slice(0, 10));

    // Also query actual check results per inspection date!
    const q2 = await client.query(`
      SELECT 
        i.machine_name,
        i.schedule_code,
        i.maintenance_type,
        to_char(i.inspected_on, 'DD/MM/YYYY') AS tanggal_formatted,
        ci.name AS item_name,
        ci.sort_order,
        cr.status,
        coalesce(cr.raw_status,
          CASE cr.status
            WHEN 'good' THEN 'Bagus'
            WHEN 'repair_needed' THEN 'Perbaikan'
            WHEN 'not_applicable' THEN 'T.A'
            ELSE cr.status
          END) AS status_text
      FROM maintenance_inspections i
      JOIN maintenance_check_results cr ON cr.inspection_id = i.id
      JOIN maintenance_check_items ci ON ci.id = cr.item_id
      ORDER BY i.inspected_on DESC, i.machine_name, ci.sort_order, ci.name
      LIMIT 20
    `);

    console.log('Sample inspection result items with dates:', q2.rows);

    await client.end();
  }).catch(console.error);
}

test().catch(console.error);
