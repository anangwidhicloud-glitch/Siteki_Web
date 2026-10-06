import { readFile } from 'node:fs/promises';
import worker from '../worker/siteki-api.js';

async function test() {
  const envFile = await readFile('.env', 'utf8');
  const DATABASE_URL = envFile.split(/\r?\n/).find(v => /^\s*DATABASE_URL\s*=/.test(v)).split('=')[1].trim().replace(/^['"]|['"]$/g, '');
  const env = { DATABASE_URL, ALLOWED_ORIGIN: 'https://siteki.xo.je' };

  // Call print data which has inspection records with their check results!
  const resPrint = await worker.fetch(new Request('https://api.test/?resource=maintenance&action=getPrintData', { headers: { Origin: 'https://siteki.xo.je' } }), env);
  
  // Wait, getPrintData requires session token or session bypass in test. Let's check direct database query using pg or postgres!
  import('pg').then(async ({ default: pg }) => {
    const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();

    const itemsRes = await client.query('SELECT * FROM maintenance_check_items ORDER BY machine_category, sort_order, name');
    console.log('Total maintenance_check_items in DB:', itemsRes.rows.length);
    console.log('Sample check items:', itemsRes.rows.slice(0, 15));

    const insRes = await client.query('SELECT count(*) FROM maintenance_inspections');
    console.log('Total maintenance_inspections in DB:', insRes.rows[0].count);

    const resRes = await client.query('SELECT count(*) FROM maintenance_check_results');
    console.log('Total maintenance_check_results in DB:', resRes.rows[0].count);

    await client.end();
  }).catch(err => {
    console.error('PG Error:', err);
  });
}

test().catch(console.error);
