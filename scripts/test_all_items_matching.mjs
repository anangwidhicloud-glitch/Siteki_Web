import { readFile } from 'node:fs/promises';
import pg from 'pg';

function excelTrimLower(str) {
  if (!str) return '';
  return String(str).trim().replace(/\s+/g, ' ').toLowerCase();
}

async function main() {
  const pdfItemsJson = await readFile('parsed_pdf_items.json', 'utf8');
  const pdfRecords = JSON.parse(pdfItemsJson);

  const envFile = await readFile('.env', 'utf8');
  const DATABASE_URL = envFile.split(/\r?\n/).find(v => /^\s*DATABASE_URL\s*=/.test(v)).split('=')[1].trim().replace(/^['"]|['"]$/g, '');

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const dbRes = await client.query(`
    SELECT DISTINCT
      lower(trim(i.machine_name)) AS nama,
      CASE WHEN upper(i.schedule_code)='B' OR lower(i.maintenance_type) LIKE '%bulan%' THEN 'bulanan' ELSE 'mingguan' END AS per,
      ci.name AS db_item
    FROM maintenance_inspections i
    JOIN maintenance_check_results cr ON cr.inspection_id = i.id
    JOIN maintenance_check_items ci ON ci.id = cr.item_id
  `);

  await client.end();

  const dbItemSet = new Set();
  dbRes.rows.forEach(r => {
    dbItemSet.add(`${excelTrimLower(r.nama)}|${excelTrimLower(r.per)}|${excelTrimLower(r.db_item)}`);
  });

  console.log('Total DB items in dbItemSet:', dbItemSet.size);

  let ptoMatched = 0;
  pdfRecords.forEach(r => {
    if (r.item.toLowerCase().includes('pto')) {
      const key = `${excelTrimLower(r.nama)}|${excelTrimLower(r.perawatan)}|${excelTrimLower(r.item)}`;
      if (dbItemSet.has(key)) {
        ptoMatched++;
        console.log('PTO Matched:', r.nama, r.perawatan, r.item);
      } else {
        console.log('PTO Unmatched:', r.nama, r.perawatan, r.item);
      }
    }
  });

  console.log('Total PTO items matched:', ptoMatched);
}

main().catch(console.error);
