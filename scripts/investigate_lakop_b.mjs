import { readFile } from 'node:fs/promises';
import pg from 'pg';

async function main() {
  const pdfItemsJson = await readFile('parsed_pdf_items.json', 'utf8');
  const pdfRecords = JSON.parse(pdfItemsJson);

  const lakopB_pdf = pdfRecords.filter(r => r.nama.toLowerCase().includes('lakop b'));
  console.log('Lakop B items in Item.pdf:', lakopB_pdf.length);
  lakopB_pdf.forEach(r => console.log('  PDF:', r));

  const envFile = await readFile('.env', 'utf8');
  const DATABASE_URL = envFile.split(/\r?\n/).find(v => /^\s*DATABASE_URL\s*=/.test(v)).split('=')[1].trim().replace(/^['"]|['"]$/g, '');

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const dbRes = await client.query(`
    SELECT DISTINCT i.machine_category, i.machine_type, i.machine_name
    FROM maintenance_inspections i
    WHERE lower(i.machine_name) LIKE '%lakop%'
  `);

  console.log('\nAll Lakop machines in Database:', dbRes.rows);

  const dbLakopBRes = await client.query(`
    SELECT DISTINCT ci.name AS item_name
    FROM maintenance_inspections i
    JOIN maintenance_check_results cr ON cr.inspection_id = i.id
    JOIN maintenance_check_items ci ON ci.id = cr.item_id
    WHERE lower(i.machine_name) LIKE '%lakop b%'
  `);

  console.log('\nLakop B items in Database:', dbLakopBRes.rows.map(r => r.name));

  await client.end();
}

main().catch(console.error);
