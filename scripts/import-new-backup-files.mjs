import ExcelJS from "exceljs";
import path from "node:path";
import pg from "pg";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";

const FOLDER = "D:\\02. Kantor\\00. Teknik\\06 Dokumen\\2026\\SiTeki";

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase("id-ID");
}

function text(value) {
  const result = String(value ?? "").trim();
  return result || null;
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

  // ==========================================
  // BAGIAN 1: IMPOR DATA LISTRIK DARI PDF
  // ==========================================
  console.log("\n--- BAGIAN 1: MEMPROSES DATA LISTRIK PLN DARI PDF ---");
  const electricityJson = JSON.parse(await readFile("scratch/parsed_electricity_pdf.json", "utf8"));

  // Ambil data petugas listrik yang ada
  const officersRes = await client.query("SELECT id, name FROM electricity_officers");
  const officerMap = new Map();
  for (const off of officersRes.rows) {
    officerMap.set(normalized(off.name), off.id);
  }

  // Cek apakah ada petugas baru dalam PDF
  for (const item of electricityJson) {
    const normName = normalized(item.officer);
    let offId = officerMap.get(normName);
    if (!offId) {
      for (const [existingNorm, existingId] of officerMap.entries()) {
        if (normName.includes(existingNorm) || existingNorm.includes(normName)) {
          offId = existingId;
          break;
        }
      }
      if (!offId) {
        const newOffId = crypto.randomUUID();
        await client.query(
          "INSERT INTO electricity_officers (id, name, legacy_sheet_row) VALUES ($1, $2, $3)",
          [newOffId, item.officer, Math.floor(Math.random() * 10000) + 1000]
        );
        officerMap.set(normName, newOffId);
        offId = newOffId;
        console.log(`Menambahkan petugas listrik baru: "${item.officer}"`);
      }
    }
  }

  // Dapatkan pemeriksaan listrik yang sudah ada untuk mencegah duplikasi
  const existingElecRes = await client.query("SELECT checked_at FROM electricity_checks");
  const existingElecSet = new Set(existingElecRes.rows.map(r => new Date(r.checked_at).toISOString()));

  const electricityToInsert = [];
  let dupElecCount = 0;

  for (let idx = 0; idx < electricityJson.length; idx++) {
    const item = electricityJson[idx];
    const parts = item.date.split("/");
    const isoDate = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
    const timeParts = item.time.split(":");
    const checkedAtIso = new Date(`${isoDate}T${timeParts[0].padStart(2, "0")}:${timeParts[1].padStart(2, "0")}:00+07:00`).toISOString();

    if (existingElecSet.has(checkedAtIso)) {
      dupElecCount++;
      continue;
    }
    existingElecSet.add(checkedAtIso);

    const normName = normalized(item.officer);
    let officerId = officerMap.get(normName);
    if (!officerId) {
      for (const [existingNorm, existingId] of officerMap.entries()) {
        if (normName.includes(existingNorm) || existingNorm.includes(normName)) {
          officerId = existingId;
          break;
        }
      }
    }

    electricityToInsert.push([
      crypto.randomUUID(),
      officerId,
      `${isoDate}T${timeParts[0].padStart(2, "0")}:${timeParts[1].padStart(2, "0")}:00+07:00`,
      item.officer,
      item.huhe_h,
      item.huhe_hh,
      item.huar_heh,
      item.huar_hh,
      item.grid_from_mwh,
      item.pv_from_mwh,
      item.grid_to_mwh,
      item.kwh,
      item.kvar,
      item.difference,
      item.conclusion,
      false, // calculation_anomaly
      "rekap-stand-meter-pln-2026-09-18.pdf",
      idx + 1, // unique row number
      JSON.stringify(item)
    ]);
  }

  console.log(`Data Listrik Baru: ${electricityToInsert.length}`);
  console.log(`Data Listrik Duplikat Dilewati: ${dupElecCount}`);

  if (electricityToInsert.length > 0) {
    await insertBatches(
      client,
      "electricity_checks",
      [
        "id", "officer_id", "checked_at", "officer_name",
        "huhe_h", "huhe_hh", "huar_heh", "huar_hh",
        "grid_from_mwh", "pv_from_mwh", "grid_to_mwh",
        "kwh", "kvar", "difference", "conclusion",
        "calculation_anomaly", "source_sheet", "legacy_sheet_row", "legacy_data"
      ],
      electricityToInsert
    );
    console.log(`✅ Berhasil mengunggah ${electricityToInsert.length} data pemeriksaan listrik baru!`);
  }

  // ==========================================
  // BAGIAN 2: IMPOR RENCANA PERAWATAN BARU
  // ==========================================
  console.log("\n--- BAGIAN 2: MEMPROSES RENCANA PERAWATAN DARI EXCEL BACKUP ---");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(FOLDER, "siteki-backup-2026-09-26.xlsx"));
  const ws = wb.getWorksheet("Rencana Perawatan");

  // Load machines
  const machines = (await client.query("SELECT id, category, machine_type, name FROM machines")).rows;
  const machineByFullKey = new Map(machines.map(m => [`${normalized(m.category)}|${normalized(m.machine_type)}|${normalized(m.name)}`, m.id]));
  const machineByName = new Map(machines.map(m => [normalized(m.name), m.id]));

  function findMachine(category, type, name) {
    return machineByFullKey.get(`${normalized(category)}|${normalized(type)}|${normalized(name)}`) ||
           machineByName.get(normalized(name)) || null;
  }

  // Load existing plans to prevent duplicates
  const existingPlans = (await client.query("SELECT planned_on, machine_name, schedule_code FROM maintenance_plans")).rows;
  const existingPlanSet = new Set(existingPlans.map(p => {
    const dStr = p.planned_on instanceof Date ? p.planned_on.toISOString().slice(0, 10) : String(p.planned_on).slice(0, 10);
    return `${dStr}|${normalized(p.machine_name)}|${normalized(p.schedule_code)}`;
  }));

  const plansToInsert = [];
  let dupPlanCount = 0;

  ws.eachRow((row, num) => {
    if (num === 1) return;
    const v = row.values;
    // v[1] = id, v[2] = machine_id, v[3] = planned_on, v[4] = machine_type, v[5] = machine_name, v[6] = schedule_code, v[7] = maintenance_type, v[8] = source_sheet
    const pOn = parseDate(v[3]);
    if (!pOn) return;

    const mType = text(v[4]);
    const mName = text(v[5]);
    const sCode = text(v[6]);
    const mainType = text(v[7]);
    const sSheet = text(v[8]) || "siteki-backup-2026-09-26.xlsx";

    if (!mName) return;

    const dedupeKey = `${pOn}|${normalized(mName)}|${normalized(sCode)}`;
    if (existingPlanSet.has(dedupeKey)) {
      dupPlanCount++;
      return;
    }
    existingPlanSet.add(dedupeKey);

    const mId = findMachine(null, mType, mName);
    plansToInsert.push([
      crypto.randomUUID(),
      mId,
      pOn,
      mType,
      mName,
      sCode,
      mainType,
      sSheet,
      num,
      JSON.stringify({ row: num, values: v })
    ]);
  });

  console.log(`Rencana Perawatan Baru: ${plansToInsert.length}`);
  console.log(`Rencana Duplikat Dilewati: ${dupPlanCount}`);

  if (plansToInsert.length > 0) {
    await insertBatches(
      client,
      "maintenance_plans",
      [
        "id", "machine_id", "planned_on", "machine_type",
        "machine_name", "schedule_code", "maintenance_type",
        "source_sheet", "legacy_sheet_row", "legacy_data"
      ],
      plansToInsert
    );
    console.log(`✅ Berhasil mengunggah ${plansToInsert.length} rencana perawatan baru!`);
  }

  // ==========================================
  // HUBUNGKAN PLAN_ID KE INSPEKSI TANPA PLAN
  // ==========================================
  console.log("\n--- MENYINKRONKAN RELASI PLAN_ID DENGAN INSPEKSI ---");
  await client.query(`
    UPDATE maintenance_inspections i
    SET plan_id = p.id
    FROM maintenance_plans p
    WHERE i.plan_id IS NULL
      AND i.inspected_on = p.planned_on
      AND lower(i.machine_name) = lower(p.machine_name)
      AND lower(i.schedule_code) = lower(p.schedule_code)
  `);

  const linkedCount = await client.query("SELECT count(*) FROM maintenance_inspections WHERE plan_id IS NOT NULL");
  console.log(`Inspeksi yang kini terhubung ke jadwal rencana: ${linkedCount.rows[0].count}`);

  await client.end();
  console.log("\n========================================================");
  console.log("SELESAI! SEMUA DATA BERHASIL DIUNGGAH TANPA DUPLIKASI.");
  console.log("========================================================");
}

main().catch(console.error);
