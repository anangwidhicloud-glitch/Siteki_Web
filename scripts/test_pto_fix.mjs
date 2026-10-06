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
    WHERE lower(ci.name) LIKE '%pto%'
  `);

  await client.end();

  const dbResultsMap = new Map();
  dbRes.rows.forEach(row => {
    const rawPer = (row.schedule_code || row.maintenance_type || '').toUpperCase();
    const per = rawPer === 'B' || rawPer.includes('BULAN') ? 'Bulanan' : 'Mingguan';
    const keyX = `${row.machine_name}|${per}|${row.tanggal}|${excelTrimLower(row.item_name)}`;
    dbResultsMap.set(keyX, row.raw_status || row.status);
  });

  // Test Mobile Crane A (Bulanan) 02/01/2026 for item 'Pto ( Power Take Off)'
  const pdfItem = 'Pto ( Power Take Off)';
  const testKeyX = `Mobile Crane A|Bulanan|02/01/2026|${excelTrimLower(pdfItem)}`;
  console.log('Test key X:', testKeyX);
  console.log('Matched status in dbResultsMap:', dbResultsMap.get(testKeyX));
}

main().catch(console.error);
