import { readFile } from 'node:fs/promises';
import pg from 'pg';

const monthNames = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

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

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const dbRes = await client.query(`
    SELECT DISTINCT
      i.machine_category AS kategori,
      i.machine_type AS jenis,
      i.machine_name AS nama,
      i.schedule_code,
      i.maintenance_type,
      to_char(i.inspected_on, 'DD/MM/YYYY') AS tanggal,
      ci.name AS item_name
    FROM maintenance_inspections i
    JOIN maintenance_check_results cr ON cr.inspection_id = i.id
    JOIN maintenance_check_items ci ON ci.id = cr.item_id
  `);

  await client.end();

  // Combine machine hierarchy from PDF and DB
  const allNamaMap = new Map();

  // 1. From PDF
  pdfRecords.forEach(r => {
    const key = `${r.nama.trim()}|${r.perawatan.trim()}`;
    if (!allNamaMap.has(key)) {
      allNamaMap.set(key, {
        kategori: r.kategori,
        jenis: r.jenis,
        nama: r.nama,
        perawatan: r.perawatan
      });
    }
  });

  // 2. From DB
  dbRes.rows.forEach(r => {
    const rawPer = (r.schedule_code || r.maintenance_type || '').toUpperCase();
    const per = rawPer === 'B' || rawPer.includes('BULAN') ? 'Bulanan' : 'Mingguan';
    const key = `${r.nama.trim()}|${per}`;
    if (!allNamaMap.has(key)) {
      allNamaMap.set(key, {
        kategori: r.kategori,
        jenis: r.jenis,
        nama: r.nama,
        perawatan: per
      });
    }
  });

  const allHierarchy = [...allNamaMap.values()];

  // Check Lakop in allHierarchy
  const lakopHierarchy = allHierarchy.filter(h => h.jenis.toLowerCase() === 'lakop');
  console.log('Lakop machines in hierarchy:', lakopHierarchy);
}

test().catch(console.error);
