import ExcelJS from "exceljs";
import fs from "node:fs/promises";

async function build() {
  const filePath = "d:\\01. Pribadi\\Website\\05. SiTeki\\Pengecekan.xlsx";
  console.log("Reading Pengecekan.xlsx...");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.worksheets[0];
  const headerRow = worksheet.getRow(1);
  const headers = [];

  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value || "").trim();
  });

  const machineTemplates = {};
  const jenisTemplates = {};
  const categoryTemplates = {};

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const kategori = String(row.getCell(1).value || "").trim();
    const jenis = String(row.getCell(2).value || "").trim();
    const namaMesin = String(row.getCell(3).value || "").trim();
    const waktu = String(row.getCell(4).value || "").trim().toUpperCase();

    if (!namaMesin || !waktu) return;

    const checkedItems = [];
    for (let colIdx = 5; colIdx <= headers.length; colIdx++) {
      const itemName = headers[colIdx - 1];
      if (!itemName) continue;

      const cellVal = String(row.getCell(colIdx).value || "").toLowerCase().trim();
      if (cellVal === "v" || cellVal === "✓") {
        checkedItems.push(itemName);
      }
    }

    const machineKey = `${namaMesin.toLowerCase().trim()}|${waktu}`;
    machineTemplates[machineKey] = checkedItems;

    if (jenis) {
      const jenisKey = `${jenis.toLowerCase().trim()}|${waktu}`;
      if (!jenisTemplates[jenisKey]) jenisTemplates[jenisKey] = new Set();
      checkedItems.forEach(item => jenisTemplates[jenisKey].add(item));
    }

    if (kategori) {
      const catKey = `${kategori.toLowerCase().trim()}|${waktu}`;
      if (!categoryTemplates[catKey]) categoryTemplates[catKey] = new Set();
      checkedItems.forEach(item => categoryTemplates[catKey].add(item));
    }
  });

  // Convert Sets to Arrays
  const jenisTemplatesArray = {};
  for (const [k, set] of Object.entries(jenisTemplates)) {
    jenisTemplatesArray[k] = Array.from(set);
  }

  const categoryTemplatesArray = {};
  for (const [k, set] of Object.entries(categoryTemplates)) {
    categoryTemplatesArray[k] = Array.from(set);
  }

  console.log("\n=== VERIFIKASI MATRIKS PENGECEKAN.XLSX ===");
  console.log("Total Mesin & Frekuensi dalam Template:", Object.keys(machineTemplates).length);

  const dt39M = machineTemplates["truck dump dt39|M"];
  const dt39B = machineTemplates["truck dump dt39|B"];
  console.log(`\nTruck Dump DT39 (M - Mingguan) [${dt39M?.length} item]:`, dt39M);
  console.log(`Truck Dump DT39 (B - Bulanan) [${dt39B?.length} item]:`, dt39B);

  const craneM = machineTemplates["mobile crane a|M"];
  const craneB = machineTemplates["mobile crane a|B"];
  console.log(`\nMobile Crane A (M - Mingguan) [${craneM?.length} item]:`, craneM);
  console.log(`Mobile Crane A (B - Bulanan) [${craneB?.length} item]:`, craneB);

  const forkliftM = machineTemplates["forklift a fd35|M"];
  const forkliftB = machineTemplates["forklift a fd35|B"];
  console.log(`\nForklift A FD35 (M - Mingguan) [${forkliftM?.length} item]:`, forkliftM);
  console.log(`Forklift A FD35 (B - Bulanan) [${forkliftB?.length} item]:`, forkliftB);

  const jsContent = `// Auto-generated checklist template definitions from Pengecekan.xlsx matrix
export const MACHINE_CHECKLIST_TEMPLATES = ${JSON.stringify(machineTemplates, null, 2)};

export const JENIS_CHECKLIST_TEMPLATES = ${JSON.stringify(jenisTemplatesArray, null, 2)};

export const CATEGORY_CHECKLIST_TEMPLATES = ${JSON.stringify(categoryTemplatesArray, null, 2)};

export function getChecklistItems(namaMesin, jenis, kategori, scheduleCode = "M") {
  const code = (scheduleCode || "M").toUpperCase().trim() === "B" ? "B" : "M";
  const normName = String(namaMesin || "").toLowerCase().trim();
  const normJenis = String(jenis || "").toLowerCase().trim();
  const normKategori = String(kategori || "").toLowerCase().trim();

  // 1. Try exact machine name + schedule code
  if (normName && MACHINE_CHECKLIST_TEMPLATES[\`\${normName}|\${code}\`]) {
    return [...MACHINE_CHECKLIST_TEMPLATES[\`\${normName}|\${code}\`]];
  }

  // 1b. Try fuzzy matching machine name
  for (const [key, items] of Object.entries(MACHINE_CHECKLIST_TEMPLATES)) {
    const [templateName, templateCode] = key.split("|");
    if (templateCode === code && normName && (normName.includes(templateName) || templateName.includes(normName))) {
      return [...items];
    }
  }

  // 2. Try jenis + schedule code
  if (normJenis && JENIS_CHECKLIST_TEMPLATES[\`\${normJenis}|\${code}\`]) {
    return [...JENIS_CHECKLIST_TEMPLATES[\`\${normJenis}|\${code}\`]];
  }

  // 3. Try category + schedule code
  if (normKategori && CATEGORY_CHECKLIST_TEMPLATES[\`\${normKategori}|\${code}\`]) {
    return [...CATEGORY_CHECKLIST_TEMPLATES[\`\${normKategori}|\${code}\`]];
  }

  // 4. Fallback general checklist
  return code === "B"
    ? [
        "Kebersihan", "Baut dan Mur", "Pelumasan Rantai / Gear", "Motor & Gearbox",
        "Panel Listrik & Wiring", "Suhu Operasional", "Sistem Pengaman / Sensor",
        "Kondisi Bearing", "Vibrasi Mesin", "Uji Fungsi Keseluruhan"
      ]
    : [
        "Kebersihan", "Cek Baut dan Mur", "Pelumasan / Grease", "Kabel & Sambungan",
        "Suara / Getaran Abnormal", "Tekanan / Aliran Angin", "Kerapian Area Mesin",
        "Uji Fungsi Tombol Emergency"
      ];
}
`;

  await fs.writeFile("src/lib/maintenanceChecklistTemplates.js", jsContent, "utf8");
  console.log("\nBerhasil memperbarui src/lib/maintenanceChecklistTemplates.js berdasarkan Pengecekan.xlsx!");
}

build().catch(console.error);
