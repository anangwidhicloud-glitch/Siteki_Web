import { readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import pg from 'pg';
import { execSync } from 'node:child_process';

// Parse Item.pdf
execSync('python scripts/parse_item_pdf.py', { stdio: 'inherit' });

const monthNames = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

function excelTrimLower(str) {
  if (!str) return '';
  return String(str).trim().replace(/\s+/g, ' ').toLowerCase();
}

function dateToParts(tglStr) {
  if (!tglStr) return null;
  const s = String(tglStr).trim();
  let year = '';
  let monthName = '';
  const parts = s.split('/');
  if (parts.length === 3) {
    year = parts[2];
    const mIdx = parseInt(parts[1], 10) - 1;
    if (mIdx >= 0 && mIdx < 12) monthName = monthNames[mIdx];
  } else {
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      year = match[1];
      const mIdx = parseInt(match[2], 10) - 1;
      if (mIdx >= 0 && mIdx < 12) monthName = monthNames[mIdx];
    }
  }
  return { year, monthName, formatted: s };
}

function cleanStatusText(status, rawStatus) {
  const s = (rawStatus || status || '').trim();
  if (/not_applicable|t\.a|tidak ada|tidak berlaku|^x$/i.test(s)) return 'T.A';
  if (/repair|perbaikan|rusak/i.test(s)) return 'Perbaikan';
  if (/good|bagus|baik|normal/i.test(s)) return 'Bagus';
  return s || 'Bagus';
}

async function main() {
  const envFile = await readFile('.env', 'utf8');
  const line = envFile.split(/\r?\n/).find(v => /^\s*DATABASE_URL\s*=/.test(v));
  const DATABASE_URL = line.split('=')[1].trim().replace(/^['"]|['"]$/g, '');

  const pdfItemsJson = await readFile('parsed_pdf_items.json', 'utf8');
  const pdfRecords = JSON.parse(pdfItemsJson);

  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const dbRes = await client.query(`
    SELECT 
      i.machine_category AS kategori,
      i.machine_type AS jenis,
      i.machine_name AS nama,
      i.schedule_code,
      i.maintenance_type,
      to_char(i.inspected_on, 'DD/MM/YYYY') AS tanggal,
      ci.name AS item_name,
      cr.status,
      cr.raw_status
    FROM maintenance_inspections i
    JOIN maintenance_check_results cr ON cr.inspection_id = i.id
    JOIN maintenance_check_items ci ON ci.id = cr.item_id
    ORDER BY i.inspected_on DESC, i.machine_name
  `);

  await client.end();
  const dbInspectionRows = dbRes.rows;

  const dbItemSet = new Set();
  dbInspectionRows.forEach(row => {
    const rawPer = (row.schedule_code || row.maintenance_type || '').toUpperCase();
    const per = rawPer === 'B' || rawPer.includes('BULAN') ? 'Bulanan' : 'Mingguan';
    dbItemSet.add(`${excelTrimLower(row.nama)}|${excelTrimLower(per)}|${excelTrimLower(row.item_name)}`);
  });

  const allNamaMap = new Map();

  pdfRecords.forEach(r => {
    const keyNP = `${r.nama.trim()}|${r.perawatan.trim()}`;
    if (!allNamaMap.has(keyNP)) {
      allNamaMap.set(keyNP, {
        kategori: r.kategori.trim(),
        jenis: r.jenis.trim(),
        nama: r.nama.trim(),
        perawatan: r.perawatan.trim()
      });
    }
  });

  dbInspectionRows.forEach(row => {
    const rawPer = (row.schedule_code || row.maintenance_type || '').toUpperCase();
    const per = rawPer === 'B' || rawPer.includes('BULAN') ? 'Bulanan' : 'Mingguan';
    const keyNP = `${row.nama.trim()}|${per}`;
    if (!allNamaMap.has(keyNP)) {
      allNamaMap.set(keyNP, {
        kategori: (row.kategori || 'Mesin').trim(),
        jenis: (row.jenis || 'Lainnya').trim(),
        nama: row.nama.trim(),
        perawatan: per
      });
    }
  });

  const allMachineHierarchy = [...allNamaMap.values()];

  const filteredPdfRecords = [];
  const itemCounterMap = new Map();

  pdfRecords.forEach(r => {
    const keyNPItem = `${excelTrimLower(r.nama)}|${excelTrimLower(r.perawatan)}|${excelTrimLower(r.item)}`;
    if (dbItemSet.has(keyNPItem)) {
      const keyNP = `${r.nama.trim()}|${r.perawatan.trim()}`;
      const newOrder = (itemCounterMap.get(keyNP) || 0) + 1;
      itemCounterMap.set(keyNP, newOrder);

      filteredPdfRecords.push({
        ...r,
        sort_order: newOrder
      });
    }
  });

  const pdfJenisTemplateMap = new Map();
  pdfRecords.forEach(r => {
    const keyPer = `${excelTrimLower(r.jenis)}|${excelTrimLower(r.perawatan)}`;
    if (!pdfJenisTemplateMap.has(keyPer)) {
      pdfJenisTemplateMap.set(keyPer, []);
    }
    const items = pdfJenisTemplateMap.get(keyPer);
    if (!items.some(i => excelTrimLower(i.item) === excelTrimLower(r.item))) {
      items.push(r);
    }
  });

  allMachineHierarchy.forEach(m => {
    const keyNP = `${m.nama}|${m.perawatan}`;
    if (!itemCounterMap.has(keyNP) || itemCounterMap.get(keyNP) === 0) {
      const keyPer = `${excelTrimLower(m.jenis)}|${excelTrimLower(m.perawatan)}`;
      const templateItems = pdfJenisTemplateMap.get(keyPer) || [];
      
      let order = 0;
      templateItems.forEach(t => {
        const keyNPItem = `${excelTrimLower(m.nama)}|${excelTrimLower(m.perawatan)}|${excelTrimLower(t.item)}`;
        if (dbItemSet.has(keyNPItem)) {
          order++;
          filteredPdfRecords.push({
            kategori: m.kategori,
            jenis: m.jenis,
            nama: m.nama,
            perawatan: m.perawatan,
            item: t.item,
            sort_order: order
          });
        }
      });
      itemCounterMap.set(keyNP, order);
    }
  });

  const inspectionDatesMap = new Map();
  dbInspectionRows.forEach(row => {
    const rawPer = (row.schedule_code || row.maintenance_type || '').toUpperCase();
    const per = rawPer === 'B' || rawPer.includes('BULAN') ? 'Bulanan' : 'Mingguan';
    const key = `${row.nama}|${per}|${row.tanggal}`;
    if (!inspectionDatesMap.has(key)) {
      inspectionDatesMap.set(key, {
        kategori: row.kategori,
        jenis: row.jenis,
        nama: row.nama,
        perawatan: per,
        tanggal: row.tanggal
      });
    }
  });

  const inspectionDateList = [...inspectionDatesMap.values()];

  const katJenisPairs = new Set();
  allMachineHierarchy.forEach(r => {
    if (r.kategori && r.jenis) katJenisPairs.add(`${r.kategori}\t${r.jenis}`);
  });

  const tblKatJenis = [...katJenisPairs]
    .map(p => { const [k, j] = p.split('\t'); return { key: k, val: j }; })
    .sort((a, b) => a.key.localeCompare(b.key, 'id-ID') || a.val.localeCompare(b.val, 'id-ID'));

  const jenisNamaPairs = new Set();
  allMachineHierarchy.forEach(r => {
    if (r.jenis && r.nama) jenisNamaPairs.add(`${r.jenis}\t${r.nama}`);
  });

  const tblJenisNama = [...jenisNamaPairs]
    .map(p => { const [j, n] = p.split('\t'); return { key: j, val: n }; })
    .sort((a, b) => a.key.localeCompare(b.key, 'id-ID') || a.val.localeCompare(b.val, 'id-ID'));

  const namaPerPairs = new Set();
  allMachineHierarchy.forEach(r => {
    if (r.nama && r.perawatan) namaPerPairs.add(`${r.nama}\t${r.perawatan}`);
  });

  const tblNamaPer = [...namaPerPairs]
    .map(pair => { const [n, p] = pair.split('\t'); return { key: n, val: p }; })
    .sort((a, b) => a.key.localeCompare(b.key, 'id-ID') || a.val.localeCompare(b.val, 'id-ID'));

  const namaPerTahunPairs = new Set();
  const namaPerTahunBulanPairs = new Set();
  const fullHierarchyPairs = new Set();

  inspectionDateList.forEach(i => {
    const n = i.nama;
    const p = i.perawatan;
    const dp = dateToParts(i.tanggal);

    if (n && p && dp && dp.year && dp.monthName) {
      namaPerTahunPairs.add(`${n}|${p}\t${dp.year}`);
      namaPerTahunBulanPairs.add(`${n}|${p}|${dp.year}\t${dp.monthName}`);
      fullHierarchyPairs.add(`${n}|${p}|${dp.year}|${dp.monthName}\t${dp.formatted}`);
    }
  });

  const tblNamaPerTahun = [...namaPerTahunPairs]
    .map(pair => { const [k, t] = pair.split('\t'); return { key: k, val: t }; })
    .sort((a, b) => a.key.localeCompare(b.key, 'id-ID') || b.val.localeCompare(a.val, 'id-ID'));

  const tblNamaPerTahunBulan = [...namaPerTahunBulanPairs]
    .map(pair => { const [k, b] = pair.split('\t'); return { key: k, val: b }; })
    .sort((a, b) => a.key.localeCompare(b.key, 'id-ID') || a.val.localeCompare(b.val, 'id-ID'));

  const tblFullHierarchy = [...fullHierarchyPairs]
    .map(pair => { const [k, t] = pair.split('\t'); return { key: k, val: t }; })
    .sort((a, b) => a.key.localeCompare(b.key, 'id-ID') || a.val.localeCompare(b.val, 'id-ID'));

  const tblMasterItems = filteredPdfRecords.map(r => ({
    key: `${r.nama}|${r.perawatan}|${r.sort_order}`,
    val: r.item
  }));

  const dbResultsMap = new Map();
  dbInspectionRows.forEach(row => {
    const rawPer = (row.schedule_code || row.maintenance_type || '').toUpperCase();
    const per = rawPer === 'B' || rawPer.includes('BULAN') ? 'Bulanan' : 'Mingguan';
    const keyNPTgItem = `${row.nama}|${per}|${row.tanggal}|${excelTrimLower(row.item_name)}`;
    const statusTxt = cleanStatusText(row.status, row.raw_status);
    dbResultsMap.set(keyNPTgItem, statusTxt);
  });

  const tblInspectionResults = [];
  for (const [keyNPTgItem, statusTxt] of dbResultsMap.entries()) {
    tblInspectionResults.push({
      key: keyNPTgItem,
      val: statusTxt
    });
  }

  // Build Workbook
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SiTeki';
  workbook.created = new Date();

  // Sheet 1: Checklist Perawatan
  const sheet = workbook.addWorksheet('Checklist Perawatan', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 }
  });

  // Sheet 2: _DATA_DROPDOWN (Hidden reference data)
  const dataSheet = workbook.addWorksheet('_DATA_DROPDOWN');
  dataSheet.state = 'veryHidden';

  dataSheet.getCell('A1').value = 'Kat';
  dataSheet.getCell('B1').value = 'Jenis';

  dataSheet.getCell('D1').value = 'Jenis';
  dataSheet.getCell('E1').value = 'Nama';

  dataSheet.getCell('G1').value = 'Nama';
  dataSheet.getCell('H1').value = 'Perawatan';

  dataSheet.getCell('J1').value = 'KeyNP';
  dataSheet.getCell('K1').value = 'Tahun';

  dataSheet.getCell('M1').value = 'KeyNPT';
  dataSheet.getCell('N1').value = 'Bulan';

  dataSheet.getCell('P1').value = 'KeyNPTB';
  dataSheet.getCell('Q1').value = 'Tanggal';

  dataSheet.getCell('S1').value = 'Kategori';
  dataSheet.getCell('S2').value = 'Armada';
  dataSheet.getCell('S3').value = 'Mesin';

  dataSheet.getCell('U1').value = 'Key_NP_Order';
  dataSheet.getCell('V1').value = 'Item_Name';

  dataSheet.getCell('X1').value = 'Key_NPTg_ItemNorm';
  dataSheet.getCell('Y1').value = 'Status_Text';

  // Populate _DATA_DROPDOWN
  tblKatJenis.forEach((item, idx) => {
    const rowNum = idx + 2;
    dataSheet.getCell(`A${rowNum}`).value = item.key;
    dataSheet.getCell(`B${rowNum}`).value = item.val;
  });

  tblJenisNama.forEach((item, idx) => {
    const rowNum = idx + 2;
    dataSheet.getCell(`D${rowNum}`).value = item.key;
    dataSheet.getCell(`E${rowNum}`).value = item.val;
  });

  tblNamaPer.forEach((item, idx) => {
    const rowNum = idx + 2;
    dataSheet.getCell(`G${rowNum}`).value = item.key;
    dataSheet.getCell(`H${rowNum}`).value = item.val;
  });

  tblNamaPerTahun.forEach((item, idx) => {
    const rowNum = idx + 2;
    dataSheet.getCell(`J${rowNum}`).value = item.key;
    dataSheet.getCell(`K${rowNum}`).value = item.val;
  });

  tblNamaPerTahunBulan.forEach((item, idx) => {
    const rowNum = idx + 2;
    dataSheet.getCell(`M${rowNum}`).value = item.key;
    dataSheet.getCell(`N${rowNum}`).value = item.val;
  });

  tblFullHierarchy.forEach((item, idx) => {
    const rowNum = idx + 2;
    dataSheet.getCell(`P${rowNum}`).value = item.key;
    dataSheet.getCell(`Q${rowNum}`).value = item.val;
  });

  tblMasterItems.forEach((item, idx) => {
    const rowNum = idx + 2;
    dataSheet.getCell(`U${rowNum}`).value = item.key;
    dataSheet.getCell(`V${rowNum}`).value = item.val;
  });

  tblInspectionResults.forEach((item, idx) => {
    const rowNum = idx + 2;
    dataSheet.getCell(`X${rowNum}`).value = item.key;
    dataSheet.getCell(`Y${rowNum}`).value = item.val;
  });

  const maxKatJ = Math.max(2, tblKatJenis.length + 1);
  const maxJenN = Math.max(2, tblJenisNama.length + 1);
  const maxNamP = Math.max(2, tblNamaPer.length + 1);
  const maxNP_T = Math.max(2, tblNamaPerTahun.length + 1);
  const maxNPT_B = Math.max(2, tblNamaPerTahunBulan.length + 1);
  const maxNPTB_T = Math.max(2, tblFullHierarchy.length + 1);
  const maxMasterItems = Math.max(2, tblMasterItems.length + 1);
  const maxInspectionResults = Math.max(2, tblInspectionResults.length + 1);

  const catRef = `_DATA_DROPDOWN!$S$2:$S$3`;

  sheet.columns = [
    { width: 5 },   // A: NO
    { width: 12 },  // B: ITEM 1
    { width: 12 },  // C: ITEM 2
    { width: 10 },  // D: ITEM 3
    { width: 10 },  // E: KONDISI
    { width: 5 },   // F: NO
    { width: 12 },  // G: ITEM 1
    { width: 12 },  // H: ITEM 2
    { width: 10 },  // I: ITEM 3
    { width: 10 },  // J: KONDISI
  ];

  // Helper styles
  const borderThin = {
    top: { style: 'thin' }, left: { style: 'thin' },
    bottom: { style: 'thin' }, right: { style: 'thin' }
  };
  const fontTitle = { name: 'Times New Roman', size: 14, bold: true };
  const fontHeader = { name: 'Times New Roman', size: 10, bold: true };
  const fontSubHeader = { name: 'Times New Roman', size: 9, bold: true };
  const fontLabel = { name: 'Times New Roman', size: 9, bold: true };
  const fontData = { name: 'Times New Roman', size: 9 };
  const fontSmall = { name: 'Times New Roman', size: 8 };

  const defaultKat = 'Armada';
  const defaultJenis = 'Forklift';
  const defaultNama = 'Forklift B FD250';
  const defaultPer = 'Bulanan';
  const defaultTahun = '2026';
  const defaultBulan = 'Maret';
  const defaultTgl = '07/03/2026';

  function buildSection(startRow) {
    // Header block
    sheet.mergeCells(startRow, 1, startRow + 3, 2);
    const logoCell = sheet.getCell(startRow, 1);
    logoCell.value = 'PT. RAJA BESI';
    logoCell.font = { name: 'Times New Roman', size: 14, bold: true, color: { argb: 'FFC61823' } };
    logoCell.alignment = { vertical: 'middle', horizontal: 'center' };

    sheet.mergeCells(startRow, 3, startRow, 7);
    const formCell = sheet.getCell(startRow, 3);
    formCell.value = 'FORMULIR';
    formCell.font = fontHeader;
    formCell.alignment = { vertical: 'middle', horizontal: 'center' };

    sheet.mergeCells(startRow + 1, 3, startRow + 2, 7);
    const titleCell = sheet.getCell(startRow + 1, 3);
    titleCell.value = 'CHECKLIST PERAWATAN RUTIN';
    titleCell.font = fontTitle;
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

    sheet.mergeCells(startRow + 3, 3, startRow + 3, 7);
    const subCell = sheet.getCell(startRow + 3, 3);
    subCell.value = 'KESELAMATAN DAN KESEHATAN KERJA';
    subCell.font = fontSubHeader;
    subCell.alignment = { vertical: 'middle', horizontal: 'center' };

    // Metadata Right Box
    sheet.getCell(startRow, 8).value = 'No. Dok.';
    sheet.getCell(startRow, 8).font = fontSmall;
    sheet.mergeCells(startRow, 9, startRow, 10);
    sheet.getCell(startRow, 9).value = ': F.K3.1.04';
    sheet.getCell(startRow, 9).font = fontSmall;

    sheet.getCell(startRow + 1, 8).value = 'Tanggal';
    sheet.getCell(startRow + 1, 8).font = fontSmall;
    sheet.mergeCells(startRow + 1, 9, startRow + 1, 10);
    sheet.getCell(startRow + 1, 9).value = ': 05 Oktober 2020';
    sheet.getCell(startRow + 1, 9).font = fontSmall;

    sheet.getCell(startRow + 2, 8).value = 'Revisi';
    sheet.getCell(startRow + 2, 8).font = fontSmall;
    sheet.mergeCells(startRow + 2, 9, startRow + 2, 10);
    sheet.getCell(startRow + 2, 9).value = ': 02';
    sheet.getCell(startRow + 2, 9).font = fontSmall;

    sheet.getCell(startRow + 3, 8).value = 'Halaman';
    sheet.getCell(startRow + 3, 8).font = fontSmall;
    sheet.mergeCells(startRow + 3, 9, startRow + 3, 10);
    sheet.getCell(startRow + 3, 9).value = ': 1 dari 1';
    sheet.getCell(startRow + 3, 9).font = fontSmall;

    for (let r = startRow; r <= startRow + 3; r++) {
      for (let c = 1; c <= 10; c++) sheet.getCell(r, c).border = borderThin;
    }

    // Metadata Form Fields
    const rMeta1 = startRow + 4;
    const rMeta2 = startRow + 5;

    const cKatRef = `B${rMeta1}`;
    const cJenisRef = `B${rMeta2}`;
    const cNamaRef = `D${rMeta1}`;
    const cPerRef = `G${rMeta1}`;
    const cTahunRef = `G${rMeta2}`;
    const cBulanRef = `I${rMeta1}`;
    const cTglRef = `I${rMeta2}`;

    // 1. KATEGORI
    sheet.getCell(rMeta1, 1).value = 'KATEGORI :';
    sheet.getCell(rMeta1, 1).font = fontLabel;
    const cKat = sheet.getCell(rMeta1, 2);
    cKat.value = defaultKat;
    cKat.font = fontData;
    cKat.dataValidation = { type: 'list', allowBlank: true, formulae: [catRef] };

    // 2. JENIS
    sheet.getCell(rMeta2, 1).value = 'JENIS :';
    sheet.getCell(rMeta2, 1).font = fontLabel;
    const cJenis = sheet.getCell(rMeta2, 2);
    cJenis.value = defaultJenis;
    cJenis.font = fontData;
    cJenis.dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`OFFSET(_DATA_DROPDOWN!$B$1, MATCH(${cKatRef}, _DATA_DROPDOWN!$A$2:$A$${maxKatJ}, 0), 0, COUNTIF(_DATA_DROPDOWN!$A$2:$A$${maxKatJ}, ${cKatRef}), 1)`]
    };

    // 3. NAMA
    sheet.getCell(rMeta1, 3).value = 'NAMA :';
    sheet.getCell(rMeta1, 3).font = fontLabel;
    sheet.mergeCells(rMeta1, 4, rMeta1, 5);
    const cNama = sheet.getCell(rMeta1, 4);
    cNama.value = defaultNama;
    cNama.font = fontData;
    cNama.dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`OFFSET(_DATA_DROPDOWN!$E$1, MATCH(${cJenisRef}, _DATA_DROPDOWN!$D$2:$D$${maxJenN}, 0), 0, COUNTIF(_DATA_DROPDOWN!$D$2:$D$${maxJenN}, ${cJenisRef}), 1)`]
    };

    // 4. PERAWATAN
    sheet.getCell(rMeta1, 6).value = 'PERAWATAN :';
    sheet.getCell(rMeta1, 6).font = fontLabel;
    const cPer = sheet.getCell(rMeta1, 7);
    cPer.value = defaultPer;
    cPer.font = fontData;
    cPer.dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`OFFSET(_DATA_DROPDOWN!$H$1, MATCH(${cNamaRef}, _DATA_DROPDOWN!$G$2:$G$${maxNamP}, 0), 0, COUNTIF(_DATA_DROPDOWN!$G$2:$G$${maxNamP}, ${cNamaRef}), 1)`]
    };

    // 5. TAHUN
    sheet.getCell(rMeta2, 6).value = 'TAHUN :';
    sheet.getCell(rMeta2, 6).font = fontLabel;
    const cTahun = sheet.getCell(rMeta2, 7);
    cTahun.value = defaultTahun;
    cTahun.font = fontData;
    cTahun.dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`OFFSET(_DATA_DROPDOWN!$K$1, MATCH(${cNamaRef} & "|" & ${cPerRef}, _DATA_DROPDOWN!$J$2:$J$${maxNP_T}, 0), 0, COUNTIF(_DATA_DROPDOWN!$J$2:$J$${maxNP_T}, ${cNamaRef} & "|" & ${cPerRef}), 1)`]
    };

    // 6. BULAN
    sheet.getCell(rMeta1, 8).value = 'BULAN :';
    sheet.getCell(rMeta1, 8).font = fontLabel;
    sheet.mergeCells(rMeta1, 9, rMeta1, 10);
    const cBulan = sheet.getCell(rMeta1, 9);
    cBulan.value = defaultBulan;
    cBulan.font = fontData;
    cBulan.dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`OFFSET(_DATA_DROPDOWN!$N$1, MATCH(${cNamaRef} & "|" & ${cPerRef} & "|" & ${cTahunRef}, _DATA_DROPDOWN!$M$2:$M$${maxNPT_B}, 0), 0, COUNTIF(_DATA_DROPDOWN!$M$2:$M$${maxNPT_B}, ${cNamaRef} & "|" & ${cPerRef} & "|" & ${cTahunRef}), 1)`]
    };

    // 7. TANGGAL
    sheet.getCell(rMeta2, 8).value = 'TANGGAL :';
    sheet.getCell(rMeta2, 8).font = fontLabel;
    sheet.mergeCells(rMeta2, 9, rMeta2, 10);
    const cTgl = sheet.getCell(rMeta2, 9);
    cTgl.value = defaultTgl;
    cTgl.font = fontData;
    cTgl.dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`OFFSET(_DATA_DROPDOWN!$Q$1, MATCH(${cNamaRef} & "|" & ${cPerRef} & "|" & ${cTahunRef} & "|" & ${cBulanRef}, _DATA_DROPDOWN!$P$2:$P$${maxNPTB_T}, 0), 0, COUNTIF(_DATA_DROPDOWN!$P$2:$P$${maxNPTB_T}, ${cNamaRef} & "|" & ${cPerRef} & "|" & ${cTahunRef} & "|" & ${cBulanRef}), 1)`]
    };

    for (let r = rMeta1; r <= rMeta2; r++) {
      for (let c = 1; c <= 10; c++) sheet.getCell(r, c).border = borderThin;
    }

    // Checklist Table Header
    const rTblH = startRow + 6;
    sheet.getCell(rTblH, 1).value = 'NO.';
    sheet.getCell(rTblH, 1).font = fontHeader;
    sheet.getCell(rTblH, 1).alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.mergeCells(rTblH, 2, rTblH, 4);
    sheet.getCell(rTblH, 2).value = 'ITEM';
    sheet.getCell(rTblH, 2).font = fontHeader;
    sheet.getCell(rTblH, 2).alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.getCell(rTblH, 5).value = 'KONDISI';
    sheet.getCell(rTblH, 5).font = fontHeader;
    sheet.getCell(rTblH, 5).alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.getCell(rTblH, 6).value = 'NO.';
    sheet.getCell(rTblH, 6).font = fontHeader;
    sheet.getCell(rTblH, 6).alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.mergeCells(rTblH, 7, rTblH, 9);
    sheet.getCell(rTblH, 7).value = 'ITEM';
    sheet.getCell(rTblH, 7).font = fontHeader;
    sheet.getCell(rTblH, 7).alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.getCell(rTblH, 10).value = 'KONDISI';
    sheet.getCell(rTblH, 10).font = fontHeader;
    sheet.getCell(rTblH, 10).alignment = { horizontal: 'center', vertical: 'middle' };

    for (let c = 1; c <= 10; c++) sheet.getCell(rTblH, c).border = borderThin;

    // Checklist Rows (1 to 23 left, 24 to 43 right)
    const rBodyStart = startRow + 7;
    for (let i = 0; i < 23; i++) {
      const itemIdxLeft = i + 1;
      const rCurr = rBodyStart + i;

      // Left No (1..23)
      sheet.getCell(rCurr, 1).value = itemIdxLeft;
      sheet.getCell(rCurr, 1).font = fontData;
      sheet.getCell(rCurr, 1).alignment = { horizontal: 'center' };

      // Left ITEM
      sheet.mergeCells(rCurr, 2, rCurr, 4);
      const cItemLeft = sheet.getCell(rCurr, 2);
      cItemLeft.font = fontData;
      cItemLeft.value = {
        formula: `IFERROR(VLOOKUP(${cNamaRef} & "|" & ${cPerRef} & "|${itemIdxLeft}", _DATA_DROPDOWN!$U$2:$V$${maxMasterItems}, 2, FALSE), "")`
      };

      // Left KONDISI
      const cKondLeft = sheet.getCell(rCurr, 5);
      cKondLeft.font = fontData;
      cKondLeft.alignment = { horizontal: 'center' };
      cKondLeft.value = {
        formula: `IF(B${rCurr}="", "", IFERROR(VLOOKUP(${cNamaRef} & "|" & ${cPerRef} & "|" & ${cTglRef} & "|" & LOWER(TRIM(B${rCurr})), _DATA_DROPDOWN!$X$2:$Y$${maxInspectionResults}, 2, FALSE), ""))`
      };

      if (i < 20) {
        const itemIdxRight = i + 24;

        // Right No (24..43)
        sheet.getCell(rCurr, 6).value = itemIdxRight;
        sheet.getCell(rCurr, 6).font = fontData;
        sheet.getCell(rCurr, 6).alignment = { horizontal: 'center' };

        // Right ITEM
        sheet.mergeCells(rCurr, 7, rCurr, 9);
        const cItemRight = sheet.getCell(rCurr, 7);
        cItemRight.font = fontData;
        cItemRight.value = {
          formula: `IFERROR(VLOOKUP(${cNamaRef} & "|" & ${cPerRef} & "|${itemIdxRight}", _DATA_DROPDOWN!$U$2:$V$${maxMasterItems}, 2, FALSE), "")`
        };

        // Right KONDISI
        const cKondRight = sheet.getCell(rCurr, 10);
        cKondRight.font = fontData;
        cKondRight.alignment = { horizontal: 'center' };
        cKondRight.value = {
          formula: `IF(G${rCurr}="", "", IFERROR(VLOOKUP(${cNamaRef} & "|" & ${cPerRef} & "|" & ${cTglRef} & "|" & LOWER(TRIM(G${rCurr})), _DATA_DROPDOWN!$X$2:$Y$${maxInspectionResults}, 2, FALSE), ""))`
        };
      }

      for (let c = 1; c <= 10; c++) sheet.getCell(rCurr, c).border = borderThin;
    }

    // Right side Summary rows for items 21..23
    const rSummaryBagus = rBodyStart + 20;
    const rSummaryRusak = rBodyStart + 21;
    const rSummaryTA = rBodyStart + 22;

    const rLeftStart = rBodyStart;
    const rLeftEnd = rBodyStart + 22;
    const rRightStart = rBodyStart;
    const rRightEnd = rBodyStart + 19;

    // Expressions for counts
    const denomExpr = `(COUNTIF(E${rLeftStart}:E${rLeftEnd},"Bagus")+COUNTIF(E${rLeftStart}:E${rLeftEnd},"Perbaikan")+COUNTIF(E${rLeftStart}:E${rLeftEnd},"Rusak")+COUNTIF(E${rLeftStart}:E${rLeftEnd},"T.A")+COUNTIF(E${rLeftStart}:E${rLeftEnd},"x")+COUNTIF(J${rRightStart}:J${rRightEnd},"Bagus")+COUNTIF(J${rRightStart}:J${rRightEnd},"Perbaikan")+COUNTIF(J${rRightStart}:J${rRightEnd},"Rusak")+COUNTIF(J${rRightStart}:J${rRightEnd},"T.A")+COUNTIF(J${rRightStart}:J${rRightEnd},"x"))`;
    const bagusExpr = `(COUNTIF(E${rLeftStart}:E${rLeftEnd},"Bagus")+COUNTIF(J${rRightStart}:J${rRightEnd},"Bagus"))`;
    const rusakExpr = `(COUNTIF(E${rLeftStart}:E${rLeftEnd},"Perbaikan")+COUNTIF(E${rLeftStart}:E${rLeftEnd},"Rusak")+COUNTIF(J${rRightStart}:J${rRightEnd},"Perbaikan")+COUNTIF(J${rRightStart}:J${rRightEnd},"Rusak"))`;
    const taExpr = `(COUNTIF(E${rLeftStart}:E${rLeftEnd},"T.A")+COUNTIF(E${rLeftStart}:E${rLeftEnd},"x")+COUNTIF(J${rRightStart}:J${rRightEnd},"T.A")+COUNTIF(J${rRightStart}:J${rRightEnd},"x"))`;

    sheet.mergeCells(rSummaryBagus, 6, rSummaryBagus, 8);
    sheet.getCell(rSummaryBagus, 6).value = '% Kondisi Bagus';
    sheet.getCell(rSummaryBagus, 6).font = fontLabel;
    sheet.getCell(rSummaryBagus, 9).value = ':';
    sheet.getCell(rSummaryBagus, 9).font = fontLabel;
    sheet.getCell(rSummaryBagus, 9).alignment = { horizontal: 'center' };
    sheet.getCell(rSummaryBagus, 10).font = fontLabel;
    sheet.getCell(rSummaryBagus, 10).alignment = { horizontal: 'center' };
    sheet.getCell(rSummaryBagus, 10).value = {
      formula: `IF(${denomExpr}>0, TEXT(${bagusExpr}/${denomExpr}, "0.0%"), "0.0%")`
    };

    sheet.mergeCells(rSummaryRusak, 6, rSummaryRusak, 8);
    sheet.getCell(rSummaryRusak, 6).value = '% Kondisi Rusak';
    sheet.getCell(rSummaryRusak, 6).font = fontLabel;
    sheet.getCell(rSummaryRusak, 9).value = ':';
    sheet.getCell(rSummaryRusak, 9).font = fontLabel;
    sheet.getCell(rSummaryRusak, 9).alignment = { horizontal: 'center' };
    sheet.getCell(rSummaryRusak, 10).font = fontLabel;
    sheet.getCell(rSummaryRusak, 10).alignment = { horizontal: 'center' };
    sheet.getCell(rSummaryRusak, 10).value = {
      formula: `IF(${denomExpr}>0, TEXT(${rusakExpr}/${denomExpr}, "0.0%"), "0.0%")`
    };

    sheet.mergeCells(rSummaryTA, 6, rSummaryTA, 8);
    sheet.getCell(rSummaryTA, 6).value = '% Kondisi Tidak Ada (T.A)';
    sheet.getCell(rSummaryTA, 6).font = fontLabel;
    sheet.getCell(rSummaryTA, 9).value = ':';
    sheet.getCell(rSummaryTA, 9).font = fontLabel;
    sheet.getCell(rSummaryTA, 9).alignment = { horizontal: 'center' };
    sheet.getCell(rSummaryTA, 10).font = fontLabel;
    sheet.getCell(rSummaryTA, 10).alignment = { horizontal: 'center' };
    sheet.getCell(rSummaryTA, 10).value = {
      formula: `IF(${denomExpr}>0, TEXT(${taExpr}/${denomExpr}, "0.0%"), "0.0%")`
    };

    // Keterangan Row
    const rKetTitle = startRow + 30;
    const rKetBody = startRow + 31;

    sheet.mergeCells(rKetTitle, 1, rKetTitle, 10);
    sheet.getCell(rKetTitle, 1).value = 'Keterangan :';
    sheet.getCell(rKetTitle, 1).font = fontLabel;

    sheet.mergeCells(rKetBody, 1, rKetBody, 10);
    sheet.getCell(rKetBody, 1).value = '(Isi Keterangan)';
    sheet.getCell(rKetBody, 1).font = fontSmall;

    for (let c = 1; c <= 10; c++) {
      sheet.getCell(rKetTitle, c).border = borderThin;
      sheet.getCell(rKetBody, c).border = borderThin;
    }

    return startRow + 32;
  }

  // Build Section 1 & Section 2
  const nextRow = buildSection(1);
  const nextRow2 = buildSection(nextRow);

  // Signatures Table
  const rSign = nextRow2;
  const roles = ['H.S.E', 'KABAG', 'KASUBAG', 'PELAKSANA'];
  const namesSig = ['A. S. Feriyanto', 'Yani Mustofa', 'Anang Widhi P', 'Machfiroch'];
  const colRanges = [[1, 2], [3, 5], [6, 7], [8, 10]];

  colRanges.forEach((range, idx) => {
    sheet.mergeCells(rSign, range[0], rSign, range[1]);
    const cell = sheet.getCell(rSign, range[0]);
    cell.value = roles[idx];
    cell.font = fontHeader;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  sheet.mergeCells(rSign + 1, 1, rSign + 3, 2);
  sheet.mergeCells(rSign + 1, 3, rSign + 3, 5);
  sheet.mergeCells(rSign + 1, 6, rSign + 3, 7);
  sheet.mergeCells(rSign + 1, 8, rSign + 3, 10);

  const rName = rSign + 4;
  const rDate = rSign + 5;

  colRanges.forEach((range, idx) => {
    sheet.mergeCells(rName, range[0], rName, range[1]);
    const cellN = sheet.getCell(rName, range[0]);
    cellN.value = `NAMA     : ${namesSig[idx]}`;
    cellN.font = fontSmall;

    sheet.mergeCells(rDate, range[0], rDate, range[1]);
    const cellD = sheet.getCell(rDate, range[0]);
    cellD.value = `TANGGAL : `;
    cellD.font = fontSmall;
  });

  for (let r = rSign; r <= rDate; r++) {
    for (let c = 1; c <= 10; c++) sheet.getCell(r, c).border = borderThin;
  }

  // Save Excel file synchronously to workspace and parent folder as requested
  const dest1 = path.join(process.cwd(), 'Checklist Perawatan.xlsx');
  const dest2 = path.resolve(process.cwd(), '..', 'Checklist Perawatan.xlsx');

  const buffer = await workbook.xlsx.writeBuffer();
  try {
    writeFileSync(dest1, buffer);
    console.log('Saved to:', dest1, 'Size:', buffer.length);
  } catch (err) {
    console.warn('Could not write to dest1:', err.message);
  }

  try {
    writeFileSync(dest2, buffer);
    console.log('Saved to:', dest2, 'Size:', buffer.length);
  } catch (err) {
    console.warn('Could not write to dest2:', err.message);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
