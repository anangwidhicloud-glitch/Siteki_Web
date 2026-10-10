import ExcelJS from "exceljs";
import path from "node:path";
import pg from "pg";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";

const FOLDER = "D:\\02. Kantor\\00. Teknik\\06 Dokumen\\2026\\SiTeki";

function text(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase("id-ID");
}

function parseDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const str = String(value ?? "").trim();
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const matchSlash = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (matchSlash) {
    const d = matchSlash[1].padStart(2, "0");
    const m = matchSlash[2].padStart(2, "0");
    const y = matchSlash[3];
    return `${y}-${m}-${d}`;
  }
  return null;
}

function resultStatus(value) {
  const source = normalized(value);
  if (!source) return null;
  if (source === "bagus" || source === "baik" || source === "v" || source === "ok") return "good";
  if (source === "perbaikan" || source === "rusak" || source === "rusak/perbaikan") return "repair_needed";
  if (source === "x" || source === "-" || source === "tidak berlaku") return "not_applicable";
  return "other";
}

async function insertBatches(client, table, columns, rows) {
  if (rows.length === 0) return;
  const colString = columns.map(c => `"${c}"`).join(", ");
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500);
    const values = [];
    const tuples = batch.map((row) => {
      const placeholders = row.map((val) => {
        values.push(val);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(`INSERT INTO "${table}" (${colString}) VALUES ${tuples.join(", ")}`, values);
  }
}

async function main() {
  const env = await readFile(".env", "utf8");
  const url = env.split(/\r?\n/).find(l => /DATABASE_URL\s*=/.test(l)).replace(/DATABASE_URL\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  console.log("Terhubung ke NeonDB...");

  // Load existing machines
  const machines = (await client.query("SELECT id, category, machine_type, name FROM machines")).rows;
  const machineByFullKey = new Map(machines.map(m => [`${normalized(m.category)}|${normalized(m.machine_type)}|${normalized(m.name)}`, m.id]));
  const machineByName = new Map(machines.map(m => [normalized(m.name), m.id]));

  function findMachine(category, type, name) {
    return machineByFullKey.get(`${normalized(category)}|${normalized(type)}|${normalized(name)}`) ||
           machineByName.get(normalized(name)) || null;
  }

  // Load existing check items
  const items = (await client.query("SELECT id, machine_category, name, sort_order FROM maintenance_check_items")).rows;
  const itemMap = new Map();
  for (const it of items) {
    itemMap.set(`${normalized(it.machine_category)}|${normalized(it.name)}`, it.id);
  }

  // Link Armada Baut dan Mur to Mesin Baut dan Mur
  const mesinBaut = itemMap.get("mesin|baut dan mur");
  if (mesinBaut && !itemMap.has("armada|baut dan mur")) {
    itemMap.set("armada|baut dan mur", mesinBaut);
  }

  // Load existing inspections to PREVENT ANY DUPLICATES
  const existingInspections = (await client.query("SELECT inspected_on, machine_name, schedule_code FROM maintenance_inspections")).rows;
  const processedKeys = new Set(existingInspections.map(i => {
    const dStr = i.inspected_on instanceof Date ? i.inspected_on.toISOString().slice(0, 10) : String(i.inspected_on).slice(0, 10);
    return `${dStr}|${normalized(i.machine_name)}|${normalized(i.schedule_code)}`;
  }));

  console.log(`Database saat ini memiliki ${processedKeys.size} riwayat inspeksi.`);

  const files = [
    { file: "Rekap Perawatan (2).xlsx", month: "Juli 2026" },
    { file: "Perawatan - Agustus.xlsx", month: "Agustus 2026" },
    { file: "Perawatan - September.xlsx", month: "September 2026" },
    { file: "Rekap Perawatan (5).xlsx", month: "Oktober 2026" }
  ];

  const inspectionsToInsert = [];
  const checkResultsToInsert = [];

  let duplicateCount = 0;

  for (const item of files) {
    const fullPath = path.join(FOLDER, item.file);
    console.log(`\nMembaca file: ${item.file} (${item.month})...`);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fullPath);
    const ws = wb.getWorksheet("det_rawat");

    const row1 = ws.getRow(1).values;
    let tglCol = -1, katCol = -1, jenisCol = -1, mesinCol = -1, waktuCol = -1;
    const checkColumns = [];

    for (let c = 1; c < row1.length; c++) {
      const h = text(row1[c]);
      if (!h) continue;
      const hNorm = normalized(h);
      if (hNorm === "tanggal") tglCol = c;
      else if (hNorm === "kategori") katCol = c;
      else if (hNorm === "jenis") jenisCol = c;
      else if (hNorm === "nama mesin") mesinCol = c;
      else if (hNorm === "waktu") waktuCol = c;
      else if (hNorm !== "keterangan" && hNorm !== "no") {
        checkColumns.push({ colIndex: c, name: h });
      }
    }

    let fileNewInspections = 0;
    let fileNewResults = 0;

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const vals = row.values;
      if (!vals) return;

      const inspectedOn = parseDate(vals[tglCol]);
      if (!inspectedOn) return;

      const category = text(vals[katCol]);
      const type = text(vals[jenisCol]);
      const name = text(vals[mesinCol]);
      const code = text(vals[waktuCol]);

      if (!name) return;

      const dedupeKey = `${inspectedOn}|${normalized(name)}|${normalized(code)}`;
      if (processedKeys.has(dedupeKey)) {
        duplicateCount++;
        return;
      }

      processedKeys.add(dedupeKey);

      const machineId = findMachine(category, type, name);
      const inspectionId = crypto.randomUUID();
      const maintenanceType = normalized(code) === "m" ? "Mingguan" : normalized(code) === "b" ? "Bulanan" : code;

      // Note column
      const noteCol = row1.findIndex(h => normalized(h) === "keterangan");
      const notes = noteCol >= 0 ? text(vals[noteCol]) : null;

      inspectionsToInsert.push([
        inspectionId,
        null, // plan_id
        machineId,
        inspectedOn,
        category,
        type,
        name,
        code,
        maintenanceType,
        notes,
        item.file,
        rowNumber,
        JSON.stringify({ source: item.file, row: rowNumber, values: vals })
      ]);
      fileNewInspections++;

      // Check results for this inspection
      for (const ch of checkColumns) {
        const rawVal = text(vals[ch.colIndex]);
        if (!rawVal) continue;
        const status = resultStatus(rawVal);
        if (!status) continue;

        const itemId = itemMap.get(`${normalized(category)}|${normalized(ch.name)}`) ||
                       itemMap.get(`mesin|${normalized(ch.name)}`) ||
                       itemMap.get(`armada|${normalized(ch.name)}`);

        if (itemId) {
          checkResultsToInsert.push([
            inspectionId,
            itemId,
            status,
            rawVal
          ]);
          fileNewResults++;
        }
      }
    });

    console.log(`  -> Menemukan ${fileNewInspections} inspeksi baru & ${fileNewResults} hasil checklist`);
  }

  console.log(`\n======================================================`);
  console.log(`MEMULAI PROSES UNGGAH KE NEONDB:`);
  console.log(`Total Inspeksi Baru: ${inspectionsToInsert.length}`);
  console.log(`Total Hasil Checklist: ${checkResultsToInsert.length}`);
  console.log(`Total Duplikat Dilewati: ${duplicateCount}`);
  console.log(`======================================================`);

  if (inspectionsToInsert.length === 0) {
    console.log("Tidak ada data baru untuk diunggah.");
    await client.end();
    return;
  }

  await client.query("BEGIN");

  try {
    console.log("Mengunggah inspeksi perawatan...");
    await insertBatches(
      client,
      "maintenance_inspections",
      [
        "id",
        "plan_id",
        "machine_id",
        "inspected_on",
        "machine_category",
        "machine_type",
        "machine_name",
        "schedule_code",
        "maintenance_type",
        "notes",
        "source_sheet",
        "legacy_sheet_row",
        "legacy_data"
      ],
      inspectionsToInsert
    );

    console.log("Mengunggah hasil checklist...");
    await insertBatches(
      client,
      "maintenance_check_results",
      [
        "inspection_id",
        "item_id",
        "status",
        "raw_status"
      ],
      checkResultsToInsert
    );

    // Pastikan target KPI bulanan 268 untuk Juli - Oktober
    await client.query(`
      UPDATE maintenance_monthly_targets 
      SET target_inspection_count = 268 
      WHERE month >= '2026-07-01' AND month <= '2026-10-01'
    `);

    await client.query("COMMIT");
    console.log("\n✅ SEMUA DATA BERHASIL DIUNGGAH TANPA DUPLIKASI!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Gagal mengunggah data:", err);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(console.error);
