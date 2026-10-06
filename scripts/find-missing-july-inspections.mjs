import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ExcelJS from "exceljs";

async function run() {
  console.log("=== CHECKING BACKUP DATA FOR JULY ===");
  const backupPath = path.join(process.cwd(), ".deploy-backups", "maintenance-tables-backup-2026-09-25T18-11-20-046Z.json");
  const backupStr = await readFile(backupPath, "utf8");
  const backupData = JSON.parse(backupStr);

  const inspections = backupData.maintenance_inspections || [];
  const julyInspections = inspections.filter(i => {
    const dStr = new Date(i.inspected_on).toISOString().slice(0, 7);
    return dStr === "2026-07";
  });

  console.log(`Total July Inspections in Backup: ${julyInspections.length}`);

  // Also check Rekap Perawatan.xlsx if it exists
  const excelPath = "d:\\01. Pribadi\\Website\\05. SiTeki\\Rekap Perawatan.xlsx";
  console.log("\n=== CHECKING REKAP PERAWATAN.XLSX ===");

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(excelPath);
    console.log("Sheets in Rekap Perawatan.xlsx:", workbook.worksheets.map(w => w.name));

    const sheet = workbook.getWorksheet("Rekap Perawatan") || workbook.worksheets[0];
    console.log(`Sheet "${sheet.name}": ${sheet.rowCount} rows, ${sheet.columnCount} cols`);

    // Let's inspect rows in Rekap Perawatan
    const machinesInExcel = [];
    sheet.eachRow((row, rowNumber) => {
      const vals = row.values.slice(1).map(v => (v == null ? "" : String(v).trim()));
      if (rowNumber <= 5) {
        console.log(`Row ${rowNumber}:`, vals.slice(0, 10));
      }
    });

  } catch (err) {
    console.error("Error reading Excel:", err.message);
  }

  // Let's cross check SCHEDULE_MACHINES (68 machines) against July Inspections in backup
  const SCHEDULE_MACHINES = [
    "Mobile Crane B", "Truck Dump DT39", "Truck Trailler H1983HG", "Mobile Crane C",
    "Forklift A FD35", "Truck Dump DT52", "Truck Trailler H8318QO", "Mobile Crane D",
    "Truck Dump DT55", "Panther H8629JA", "Truck Trailler H8696OA", "Mobile Crane E",
    "Truck Dump DT98", "Truck Trailler H8697OA", "Panther H1669SQ", "Mobile Crane A",
    "Truck Dump DT139", "Truck Trailler H1358KS", "Forklift B FD250", "Suzuki APV",
    "Kop C", "Kop D", "Kop E", "Kop F", "Line 13", "Line 14", "Line 15",
    "Lakop D", "Slitting", "Line 16", "Line 17", "Line 18", "Tes Bending TELKOM",
    "Tes Jatuh Telkom", "Bevel", "Tes Bending PLN", "Verloop D", "Verloop H", "Verloop E",
    "Verloop F", "Kompressor 01", "Line 01", "Line 02", "Line 03", "Verloop A", "Lakop A",
    "Kop A", "Kop B", "Kompressor 02", "Line 04", "Line 05", "Line 06", "Verloop B",
    "Verloop C", "Lakop B", "Lakop C", "Line 07", "Line 08", "Line 09", "Pipa ERW",
    "Verloop G", "Potong Bahan A", "Potong Spiral", "Genset 01", "Line 10", "Line 11", "Line 12"
  ];

  console.log(`Total Schedule Machines defined: ${SCHEDULE_MACHINES.length}`);

  // Count inspections per machine in July backup
  const countsPerMachine = {};
  SCHEDULE_MACHINES.forEach(m => countsPerMachine[m.toLowerCase().trim()] = { name: m, count: 0, codes: [] });

  julyInspections.forEach(i => {
    const mNorm = String(i.machine_name || "").toLowerCase().trim();
    if (!countsPerMachine[mNorm]) {
      countsPerMachine[mNorm] = { name: i.machine_name, count: 0, codes: [] };
    }
    countsPerMachine[mNorm].count++;
    countsPerMachine[mNorm].codes.push(i.schedule_code || i.maintenance_type);
  });

  const missingOrIncomplete = Object.values(countsPerMachine).filter(m => m.count < 4);
  console.log(`\nMesin/Armada dengan jumlah pemeriksaan < 4 di bulan Juli (${missingOrIncomplete.length} unit):`);
  missingOrIncomplete.sort((a, b) => a.count - b.count).forEach(m => {
    console.log(`  - ${m.name}: ${m.count} kali terisi (Kode: ${m.codes.join(", ")})`);
  });
}

run().catch(console.error);
