import { readFile } from 'node:fs/promises';
import pg from 'pg';

async function main() {
  const pdfItemsJson = await readFile('parsed_pdf_items.json', 'utf8');
  const pdfRecords = JSON.parse(pdfItemsJson);

  const ptoPdf = pdfRecords.filter(r => r.item.toLowerCase().includes('pto') || r.item.toLowerCase().includes('take off'));
  console.log('PTO items in Item.pdf:', ptoPdf.length);
  ptoPdf.forEach(r => console.log('  PDF:', r));

  const envFile = await readFile('.env', 'utf8');
  const DATABASE_URL = envFile.split(/\r?\n/).find(v => /^\s*DATABASE_URL\s*=/.test(v)).split('=')[1].trim().replace(/^['"]|['"]$/g, '');

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const dbRes = await client.query(`
    SELECT 
      i.machine_name,
      i.schedule_code,
      i.maintenance_type,
      to_char(i.inspected_on, 'DD/MM/YYYY') AS tanggal,
      ci.name AS item_name,
      cr.status,
      cr.raw_status
    FROM maintenance_inspections i
    JOIN maintenance_check_results cr ON cr.inspection_id = i.id
    JOIN maintenance_check_items ci ON ci.id = cr.item_id
    WHERE lower(ci.name) LIKE '%pto%' OR lower(ci.name) LIKE '%take off%'
  `);

  console.log('\nPTO items in Database count:', dbRes.rows.length);
  dbRes.rows.slice(0, 15).forEach(r => console.log('  DB:', r));

  await client.end();
}

main().catch(console.error);
