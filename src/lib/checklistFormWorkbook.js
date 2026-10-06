import ExcelJS from "exceljs";

const monthNames = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

function dateToParts(tglStr) {
  if (!tglStr) return null;
  const s = String(tglStr).trim();
  let year = "";
  let monthName = "";
  const parts = s.split("/");
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

export async function createChecklistFormWorkbook(options = {}) {
  const inspections = Array.isArray(options.inspections) ? options.inspections : [];
  const machines = Array.isArray(options.machines) ? options.machines : [];

  // 1. Kategori -> Jenis
  const katJenisPairs = new Set();
  machines.forEach(m => {
    const k = (m.kategori || "Mesin").trim();
    const j = (m.jenis || "").trim();
    if (k && j) katJenisPairs.add(`${k}\t${j}`);
  });
  inspections.forEach(i => {
    const k = (i.kategori || "Mesin").trim();
    const j = (i.jenis || "").trim();
    if (k && j) katJenisPairs.add(`${k}\t${j}`);
  });

  const tblKatJenis = [...katJenisPairs]
    .map(p => { const [k, j] = p.split("\t"); return { key: k, val: j }; })
    .sort((a, b) => a.key.localeCompare(b.key, "id-ID") || a.val.localeCompare(b.val, "id-ID"));

  // 2. Jenis -> Nama
  const jenisNamaPairs = new Set();
  machines.forEach(m => {
    const j = (m.jenis || "").trim();
    const n = (m.nama || "").trim();
    if (j && n) jenisNamaPairs.add(`${j}\t${n}`);
  });
  inspections.forEach(i => {
    const j = (i.jenis || "").trim();
    const n = (i.nama_mesin || i.nama || "").trim();
    if (j && n) jenisNamaPairs.add(`${j}\t${n}`);
  });

  const tblJenisNama = [...jenisNamaPairs]
    .map(p => { const [j, n] = p.split("\t"); return { key: j, val: n }; })
    .sort((a, b) => a.key.localeCompare(b.key, "id-ID") || a.val.localeCompare(b.val, "id-ID"));

  // 3. Nama -> Perawatan
  const namaPerPairs = new Set();
  // 4. Nama|Perawatan -> Tahun
  const namaPerTahunPairs = new Set();
  // 5. Nama|Perawatan|Tahun -> Bulan
  const namaPerTahunBulanPairs = new Set();
  // 6. Nama|Perawatan|Tahun|Bulan -> Tanggal
  const fullHierarchyPairs = new Set();

  inspections.forEach(i => {
    const n = (i.nama_mesin || i.nama || "").trim();
    const rawPer = (i.waktu || i.jenis_perawatan || i.perawatan || "").trim().toUpperCase();
    const p = rawPer === "B" || rawPer.includes("BULAN") ? "Bulanan" : "Mingguan";
    const dp = dateToParts(i.tanggal);

    if (n) {
      namaPerPairs.add(`${n}\t${p}`);
      if (dp && dp.year && dp.monthName) {
        namaPerTahunPairs.add(`${n}|${p}\t${dp.year}`);
        namaPerTahunBulanPairs.add(`${n}|${p}|${dp.year}\t${dp.monthName}`);
        fullHierarchyPairs.add(`${n}|${p}|${dp.year}|${dp.monthName}\t${dp.formatted}`);
      }
    }
  });

  const tblNamaPer = [...namaPerPairs]
    .map(pair => { const [n, p] = pair.split("\t"); return { key: n, val: p }; })
    .sort((a, b) => a.key.localeCompare(b.key, "id-ID") || a.val.localeCompare(b.val, "id-ID"));

  const tblNamaPerTahun = [...namaPerTahunPairs]
    .map(pair => { const [k, t] = pair.split("\t"); return { key: k, val: t }; })
    .sort((a, b) => a.key.localeCompare(b.key, "id-ID") || b.val.localeCompare(a.val, "id-ID"));

  const tblNamaPerTahunBulan = [...namaPerTahunBulanPairs]
    .map(pair => { const [k, b] = pair.split("\t"); return { key: k, val: b }; })
    .sort((a, b) => a.key.localeCompare(b.key, "id-ID") || a.val.localeCompare(b.val, "id-ID"));

  const tblFullHierarchy = [...fullHierarchyPairs]
    .map(pair => { const [k, t] = pair.split("\t"); return { key: k, val: t }; })
    .sort((a, b) => a.key.localeCompare(b.key, "id-ID") || a.val.localeCompare(b.val, "id-ID"));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SiTeki";
  workbook.created = new Date();

  // Sheet 1: Checklist Perawatan
  const sheet = workbook.addWorksheet("Checklist Perawatan", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1 }
  });

  // Sheet 2: _DATA_DROPDOWN (Hidden reference data)
  const dataSheet = workbook.addWorksheet("_DATA_DROPDOWN");
  dataSheet.state = "veryHidden";

  dataSheet.getCell("A1").value = "Kat";
  dataSheet.getCell("B1").value = "Jenis";

  dataSheet.getCell("D1").value = "Jenis";
  dataSheet.getCell("E1").value = "Nama";

  dataSheet.getCell("G1").value = "Nama";
  dataSheet.getCell("H1").value = "Perawatan";

  dataSheet.getCell("J1").value = "KeyNP";
  dataSheet.getCell("K1").value = "Tahun";

  dataSheet.getCell("M1").value = "KeyNPT";
  dataSheet.getCell("N1").value = "Bulan";

  dataSheet.getCell("P1").value = "KeyNPTB";
  dataSheet.getCell("Q1").value = "Tanggal";

  dataSheet.getCell("S1").value = "Kategori";
  dataSheet.getCell("S2").value = "Armada";
  dataSheet.getCell("S3").value = "Mesin";

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

  const maxKatJ = Math.max(2, tblKatJenis.length + 1);
  const maxJenN = Math.max(2, tblJenisNama.length + 1);
  const maxNamP = Math.max(2, tblNamaPer.length + 1);
  const maxNP_T = Math.max(2, tblNamaPerTahun.length + 1);
  const maxNPT_B = Math.max(2, tblNamaPerTahunBulan.length + 1);
  const maxNPTB_T = Math.max(2, tblFullHierarchy.length + 1);

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

  const borderThin = {
    top: { style: "thin" }, left: { style: "thin" },
    bottom: { style: "thin" }, right: { style: "thin" }
  };
  const fontTitle = { name: "Times New Roman", size: 14, bold: true };
  const fontHeader = { name: "Times New Roman", size: 10, bold: true };
  const fontSubHeader = { name: "Times New Roman", size: 9, bold: true };
  const fontLabel = { name: "Times New Roman", size: 9, bold: true };
  const fontData = { name: "Times New Roman", size: 9 };
  const fontSmall = { name: "Times New Roman", size: 8 };

  const defaultKat = "Mesin";
  const defaultJenis = tblKatJenis.find(x => x.key === "Mesin")?.val || "Perakitan";
  const defaultNama = tblJenisNama.find(x => x.key === defaultJenis)?.val || "Line 09";
  const defaultPer = tblNamaPer.find(x => x.key === defaultNama)?.val || "Mingguan";
  const defaultTahun = tblNamaPerTahun.find(x => x.key === `${defaultNama}|${defaultPer}`)?.val || "2026";
  const defaultBulan = tblNamaPerTahunBulan.find(x => x.key === `${defaultNama}|${defaultPer}|${defaultTahun}`)?.val || "Januari";
  const defaultTgl = tblFullHierarchy.find(x => x.key === `${defaultNama}|${defaultPer}|${defaultTahun}|${defaultBulan}`)?.val || "";

  function buildSection(startRow) {
    sheet.mergeCells(startRow, 1, startRow + 3, 2);
    const logoCell = sheet.getCell(startRow, 1);
    logoCell.value = "PT. RAJA BESI";
    logoCell.font = { name: "Times New Roman", size: 14, bold: true, color: { argb: "FFC61823" } };
    logoCell.alignment = { vertical: "middle", horizontal: "center" };

    sheet.mergeCells(startRow, 3, startRow, 7);
    const formCell = sheet.getCell(startRow, 3);
    formCell.value = "FORMULIR";
    formCell.font = fontHeader;
    formCell.alignment = { vertical: "middle", horizontal: "center" };

    sheet.mergeCells(startRow + 1, 3, startRow + 2, 7);
    const titleCell = sheet.getCell(startRow + 1, 3);
    titleCell.value = "CHECKLIST PERAWATAN RUTIN";
    titleCell.font = fontTitle;
    titleCell.alignment = { vertical: "middle", horizontal: "center" };

    sheet.mergeCells(startRow + 3, 3, startRow + 3, 7);
    const subCell = sheet.getCell(startRow + 3, 3);
    subCell.value = "KESELAMATAN DAN KESEHATAN KERJA";
    subCell.font = fontSubHeader;
    subCell.alignment = { vertical: "middle", horizontal: "center" };

    sheet.getCell(startRow, 8).value = "No. Dok.";
    sheet.getCell(startRow, 8).font = fontSmall;
    sheet.mergeCells(startRow, 9, startRow, 10);
    sheet.getCell(startRow, 9).value = ": F.K3.1.04";
    sheet.getCell(startRow, 9).font = fontSmall;

    sheet.getCell(startRow + 1, 8).value = "Tanggal";
    sheet.getCell(startRow + 1, 8).font = fontSmall;
    sheet.mergeCells(startRow + 1, 9, startRow + 1, 10);
    sheet.getCell(startRow + 1, 9).value = ": 05 Oktober 2020";
    sheet.getCell(startRow + 1, 9).font = fontSmall;

    sheet.getCell(startRow + 2, 8).value = "Revisi";
    sheet.getCell(startRow + 2, 8).font = fontSmall;
    sheet.mergeCells(startRow + 2, 9, startRow + 2, 10);
    sheet.getCell(startRow + 2, 9).value = ": 02";
    sheet.getCell(startRow + 2, 9).font = fontSmall;

    sheet.getCell(startRow + 3, 8).value = "Halaman";
    sheet.getCell(startRow + 3, 8).font = fontSmall;
    sheet.mergeCells(startRow + 3, 9, startRow + 3, 10);
    sheet.getCell(startRow + 3, 9).value = ": 1 dari 1";
    sheet.getCell(startRow + 3, 9).font = fontSmall;

    for (let r = startRow; r <= startRow + 3; r++) {
      for (let c = 1; c <= 10; c++) sheet.getCell(r, c).border = borderThin;
    }

    const rMeta1 = startRow + 4;
    const rMeta2 = startRow + 5;

    const cKatRef = `B${rMeta1}`;
    const cJenisRef = `B${rMeta2}`;
    const cNamaRef = `D${rMeta1}`;
    const cPerRef = `G${rMeta1}`;
    const cTahunRef = `G${rMeta2}`;
    const cBulanRef = `I${rMeta1}`;

    sheet.getCell(rMeta1, 1).value = "KATEGORI :";
    sheet.getCell(rMeta1, 1).font = fontLabel;
    const cKat = sheet.getCell(rMeta1, 2);
    cKat.value = defaultKat;
    cKat.font = fontData;
    cKat.dataValidation = { type: "list", allowBlank: true, formulae: [catRef] };

    sheet.getCell(rMeta2, 1).value = "JENIS :";
    sheet.getCell(rMeta2, 1).font = fontLabel;
    const cJenis = sheet.getCell(rMeta2, 2);
    cJenis.value = defaultJenis;
    cJenis.font = fontData;
    cJenis.dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`OFFSET(_DATA_DROPDOWN!$B$1, MATCH(${cKatRef}, _DATA_DROPDOWN!$A$2:$A$${maxKatJ}, 0), 0, COUNTIF(_DATA_DROPDOWN!$A$2:$A$${maxKatJ}, ${cKatRef}), 1)`]
    };

    sheet.getCell(rMeta1, 3).value = "NAMA :";
    sheet.getCell(rMeta1, 3).font = fontLabel;
    sheet.mergeCells(rMeta1, 4, rMeta1, 5);
    const cNama = sheet.getCell(rMeta1, 4);
    cNama.value = defaultNama;
    cNama.font = fontData;
    cNama.dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`OFFSET(_DATA_DROPDOWN!$E$1, MATCH(${cJenisRef}, _DATA_DROPDOWN!$D$2:$D$${maxJenN}, 0), 0, COUNTIF(_DATA_DROPDOWN!$D$2:$D$${maxJenN}, ${cJenisRef}), 1)`]
    };

    sheet.getCell(rMeta1, 6).value = "PERAWATAN :";
    sheet.getCell(rMeta1, 6).font = fontLabel;
    const cPer = sheet.getCell(rMeta1, 7);
    cPer.value = defaultPer;
    cPer.font = fontData;
    cPer.dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`OFFSET(_DATA_DROPDOWN!$H$1, MATCH(${cNamaRef}, _DATA_DROPDOWN!$G$2:$G$${maxNamP}, 0), 0, COUNTIF(_DATA_DROPDOWN!$G$2:$G$${maxNamP}, ${cNamaRef}), 1)`]
    };

    sheet.getCell(rMeta2, 6).value = "TAHUN :";
    sheet.getCell(rMeta2, 6).font = fontLabel;
    const cTahun = sheet.getCell(rMeta2, 7);
    cTahun.value = defaultTahun;
    cTahun.font = fontData;
    cTahun.dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`OFFSET(_DATA_DROPDOWN!$K$1, MATCH(${cNamaRef} & "|" & ${cPerRef}, _DATA_DROPDOWN!$J$2:$J$${maxNP_T}, 0), 0, COUNTIF(_DATA_DROPDOWN!$J$2:$J$${maxNP_T}, ${cNamaRef} & "|" & ${cPerRef}), 1)`]
    };

    sheet.getCell(rMeta1, 8).value = "BULAN :";
    sheet.getCell(rMeta1, 8).font = fontLabel;
    sheet.mergeCells(rMeta1, 9, rMeta1, 10);
    const cBulan = sheet.getCell(rMeta1, 9);
    cBulan.value = defaultBulan;
    cBulan.font = fontData;
    cBulan.dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`OFFSET(_DATA_DROPDOWN!$N$1, MATCH(${cNamaRef} & "|" & ${cPerRef} & "|" & ${cTahunRef}, _DATA_DROPDOWN!$M$2:$M$${maxNPT_B}, 0), 0, COUNTIF(_DATA_DROPDOWN!$M$2:$M$${maxNPT_B}, ${cNamaRef} & "|" & ${cPerRef} & "|" & ${cTahunRef}), 1)`]
    };

    sheet.getCell(rMeta2, 8).value = "TANGGAL :";
    sheet.getCell(rMeta2, 8).font = fontLabel;
    sheet.mergeCells(rMeta2, 9, rMeta2, 10);
    const cTgl = sheet.getCell(rMeta2, 9);
    cTgl.value = defaultTgl;
    cTgl.font = fontData;
    cTgl.dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`OFFSET(_DATA_DROPDOWN!$Q$1, MATCH(${cNamaRef} & "|" & ${cPerRef} & "|" & ${cTahunRef} & "|" & ${cBulanRef}, _DATA_DROPDOWN!$P$2:$P$${maxNPTB_T}, 0), 0, COUNTIF(_DATA_DROPDOWN!$P$2:$P$${maxNPTB_T}, ${cNamaRef} & "|" & ${cPerRef} & "|" & ${cTahunRef} & "|" & ${cBulanRef}), 1)`]
    };

    for (let r = rMeta1; r <= rMeta2; r++) {
      for (let c = 1; c <= 10; c++) sheet.getCell(r, c).border = borderThin;
    }

    const rTblH = startRow + 6;
    sheet.getCell(rTblH, 1).value = "NO.";
    sheet.getCell(rTblH, 1).font = fontHeader;
    sheet.getCell(rTblH, 1).alignment = { horizontal: "center", vertical: "middle" };

    sheet.mergeCells(rTblH, 2, rTblH, 4);
    sheet.getCell(rTblH, 2).value = "ITEM";
    sheet.getCell(rTblH, 2).font = fontHeader;
    sheet.getCell(rTblH, 2).alignment = { horizontal: "center", vertical: "middle" };

    sheet.getCell(rTblH, 5).value = "KONDISI";
    sheet.getCell(rTblH, 5).font = fontHeader;
    sheet.getCell(rTblH, 5).alignment = { horizontal: "center", vertical: "middle" };

    sheet.getCell(rTblH, 6).value = "NO.";
    sheet.getCell(rTblH, 6).font = fontHeader;
    sheet.getCell(rTblH, 6).alignment = { horizontal: "center", vertical: "middle" };

    sheet.mergeCells(rTblH, 7, rTblH, 9);
    sheet.getCell(rTblH, 7).value = "ITEM";
    sheet.getCell(rTblH, 7).font = fontHeader;
    sheet.getCell(rTblH, 7).alignment = { horizontal: "center", vertical: "middle" };

    sheet.getCell(rTblH, 10).value = "KONDISI";
    sheet.getCell(rTblH, 10).font = fontHeader;
    sheet.getCell(rTblH, 10).alignment = { horizontal: "center", vertical: "middle" };

    for (let c = 1; c <= 10; c++) sheet.getCell(rTblH, c).border = borderThin;

    const rBodyStart = startRow + 7;
    for (let i = 0; i < 23; i++) {
      const rCurr = rBodyStart + i;
      sheet.getCell(rCurr, 1).value = i + 1;
      sheet.getCell(rCurr, 1).font = fontData;
      sheet.getCell(rCurr, 1).alignment = { horizontal: "center" };

      sheet.mergeCells(rCurr, 2, rCurr, 4);
      sheet.getCell(rCurr, 2).font = fontData;

      sheet.getCell(rCurr, 5).font = fontData;
      sheet.getCell(rCurr, 5).alignment = { horizontal: "center" };

      if (i < 20) {
        sheet.getCell(rCurr, 6).value = i + 24;
        sheet.getCell(rCurr, 6).font = fontData;
        sheet.getCell(rCurr, 6).alignment = { horizontal: "center" };

        sheet.mergeCells(rCurr, 7, rCurr, 9);
        sheet.getCell(rCurr, 7).font = fontData;

        sheet.getCell(rCurr, 10).font = fontData;
        sheet.getCell(rCurr, 10).alignment = { horizontal: "center" };
      }

      for (let c = 1; c <= 10; c++) sheet.getCell(rCurr, c).border = borderThin;
    }

    const rSummaryBagus = rBodyStart + 20;
    const rSummaryRusak = rBodyStart + 21;
    const rSummaryTA = rBodyStart + 22;

    sheet.mergeCells(rSummaryBagus, 6, rSummaryBagus, 8);
    sheet.getCell(rSummaryBagus, 6).value = "% Kondisi Bagus";
    sheet.getCell(rSummaryBagus, 6).font = fontLabel;
    sheet.getCell(rSummaryBagus, 9).value = ":";
    sheet.getCell(rSummaryBagus, 9).font = fontLabel;
    sheet.getCell(rSummaryBagus, 9).alignment = { horizontal: "center" };
    sheet.getCell(rSummaryBagus, 10).font = fontLabel;

    sheet.mergeCells(rSummaryRusak, 6, rSummaryRusak, 8);
    sheet.getCell(rSummaryRusak, 6).value = "% Kondisi Rusak";
    sheet.getCell(rSummaryRusak, 6).font = fontLabel;
    sheet.getCell(rSummaryRusak, 9).value = ":";
    sheet.getCell(rSummaryRusak, 9).font = fontLabel;
    sheet.getCell(rSummaryRusak, 9).alignment = { horizontal: "center" };
    sheet.getCell(rSummaryRusak, 10).font = fontLabel;

    sheet.mergeCells(rSummaryTA, 6, rSummaryTA, 8);
    sheet.getCell(rSummaryTA, 6).value = "% Kondisi Tidak Ada (T.A)";
    sheet.getCell(rSummaryTA, 6).font = fontLabel;
    sheet.getCell(rSummaryTA, 9).value = ":";
    sheet.getCell(rSummaryTA, 9).font = fontLabel;
    sheet.getCell(rSummaryTA, 9).alignment = { horizontal: "center" };
    sheet.getCell(rSummaryTA, 10).font = fontLabel;

    const rKetTitle = startRow + 30;
    const rKetBody = startRow + 31;

    sheet.mergeCells(rKetTitle, 1, rKetTitle, 10);
    sheet.getCell(rKetTitle, 1).value = "Keterangan :";
    sheet.getCell(rKetTitle, 1).font = fontLabel;

    sheet.mergeCells(rKetBody, 1, rKetBody, 10);
    sheet.getCell(rKetBody, 1).value = "(Isi Keterangan)";
    sheet.getCell(rKetBody, 1).font = fontSmall;

    for (let c = 1; c <= 10; c++) {
      sheet.getCell(rKetTitle, c).border = borderThin;
      sheet.getCell(rKetBody, c).border = borderThin;
    }

    return startRow + 32;
  }

  const nextRow = buildSection(1);
  const nextRow2 = buildSection(nextRow);

  const rSign = nextRow2;
  const roles = ["H.S.E", "KABAG", "KASUBAG", "PELAKSANA"];
  const namesSig = ["A. S. Feriyanto", "Yani Mustofa", "Anang Widhi P", "Machfiroch"];
  const colRanges = [[1, 2], [3, 5], [6, 7], [8, 10]];

  colRanges.forEach((range, idx) => {
    sheet.mergeCells(rSign, range[0], rSign, range[1]);
    const cell = sheet.getCell(rSign, range[0]);
    cell.value = roles[idx];
    cell.font = fontHeader;
    cell.alignment = { horizontal: "center", vertical: "middle" };
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

  return {
    buffer: await workbook.xlsx.writeBuffer(),
    filename: "Checklist Perawatan.xlsx"
  };
}
