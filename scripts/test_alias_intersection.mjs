import { readFile } from 'node:fs/promises';
import pg from 'pg';

const ALIASES = {
  'instalasi stop kontak': 'ins. stop kontak',
  'ins. stop kontak': 'ins. stop kontak',
  'coil pad': 'coilpad',
  'coilpad': 'coilpad',
  'baut dan mur': 'baut dan mur',
  'pto ( power take off)': 'pto (power take off)',
  'pto (power take off)': 'pto (power take off)',
};

function norm(s) {
  if (!s) return '';
  const cleaned = String(s).trim().replace(/\s+/g, ' ').toLowerCase();
  return ALIASES[cleaned] || cleaned;
}

async function test() {
  const envFile = await readFile('.env', 'utf8');
  const DATABASE_URL = envFile.split(/\r?\n/).find(v => /^\s*DATABASE_URL\s*=/.test(v)).split('=')[1].trim().replace(/^['"]|['"]$/g, '');

  const pdfItemsJson = await readFile('parsed_pdf_items.json', 'utf8');
  const pdfRecords = JSON.parse(pdfItemsJson);
  console.log('Total PDF records:', pdfRecords.length);

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const res = await client.query(`
    SELECT DISTINCT
      lower(trim(i.machine_name)) AS nama,
      CASE WHEN upper(i.schedule_code)='B' OR lower(i.maintenance_type) LIKE '%bulan%' THEN 'Bulanan' ELSE 'Mingguan' END AS per,
      ci.name AS db_item
    FROM maintenance_inspections i
    JOIN maintenance_check_results cr ON cr.inspection_id = i.id
    JOIN maintenance_check_items ci ON ci.id = cr.item_id
  `);

  await client.end();

  const dbSet = new Set();
  res.rows.forEach(r => {
    dbSet.add(`${norm(r.nama)}|${norm(r.per)}|${norm(r.db_item)}`);
  });

  console.log('Total DB entries:', dbSet.size);

  const matchedRecords = [];
  const excludedRecords = [];

  pdfRecords.forEach(r => {
    const key = `${norm(r.nama)}|${norm(r.perawatan)}|${norm(r.item)}`;
    if (dbSet.has(key)) {
      matchedRecords.push(r);
    } else {
      excludedRecords.push(r);
    }
  });

  console.log('Matched records (In PDF AND in DB):', matchedRecords.length);
  console.log('Excluded records (In PDF, but NOT in DB for that machine & schedule):', excludedRecords.length);

  console.log('\nSample Excluded Items (Will NOT be shown in Excel):');
  excludedRecords.slice(0, 15).forEach(r => {
    console.log(`  - ${r.nama} (${r.perawatan}): "${r.item}"`);
  });
}

test().catch(console.error);
