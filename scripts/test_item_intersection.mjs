import { readFile } from 'node:fs/promises';
import pg from 'pg';

async function test() {
  const envFile = await readFile('.env', 'utf8');
  const DATABASE_URL = envFile.split(/\r?\n/).find(v => /^\s*DATABASE_URL\s*=/.test(v)).split('=')[1].trim().replace(/^['"]|['"]$/g, '');

  const pdfItemsJson = await readFile('parsed_pdf_items.json', 'utf8');
  const pdfRecords = JSON.parse(pdfItemsJson);
  console.log('Total pdf records:', pdfRecords.length);

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Fetch all distinct (machine_name, schedule_code/maintenance_type, check_item_name) present in database!
  const dbItemsRes = await client.query(`
    SELECT DISTINCT
      i.machine_name AS nama,
      i.schedule_code,
      i.maintenance_type,
      ci.name AS item_name
    FROM maintenance_inspections i
    JOIN maintenance_check_results cr ON cr.inspection_id = i.id
    JOIN maintenance_check_items ci ON ci.id = cr.item_id
  `);

  await client.end();

  const dbItemSet = new Set();
  dbItemsRes.rows.forEach(r => {
    const rawPer = (r.schedule_code || r.maintenance_type || '').toUpperCase();
    const per = rawPer === 'B' || rawPer.includes('BULAN') ? 'Bulanan' : 'Mingguan';
    dbItemSet.add(`${r.nama.trim()}|${per}|${r.item_name.trim().toLowerCase()}`);
  });

  console.log('Total distinct DB (Nama|Perawatan|ItemName) entries:', dbItemSet.size);

  // Filter pdfRecords to ONLY include items present in dbItemSet!
  const filteredRecords = [];
  const counterMap = new Map();
  let excludedCount = 0;
  const excludedExamples = [];

  pdfRecords.forEach(r => {
    const keyNPName = `${r.nama.trim()}|${r.perawatan.trim()}|${r.item.trim().toLowerCase()}`;
    if (dbItemSet.has(keyNPName)) {
      const keyNP = `${r.nama.trim()}|${r.perawatan.trim()}`;
      const newOrder = (counterMap.get(keyNP) || 0) + 1;
      counterMap.set(keyNP, newOrder);

      filteredRecords.push({
        ...r,
        sort_order: newOrder
      });
    } else {
      excludedCount++;
      if (excludedExamples.length < 15) {
        excludedExamples.push(`${r.nama} (${r.perawatan}): "${r.item}"`);
      }
    }
  });

  console.log('Filtered records count:', filteredRecords.length);
  console.log('Excluded items count:', excludedCount);
  console.log('Sample excluded items (In PDF but NOT in DB):', excludedExamples);
}

test().catch(console.error);
