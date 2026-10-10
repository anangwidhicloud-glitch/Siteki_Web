import pg from "pg";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";

function normalized(str) {
  return String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function main() {
  const env = await readFile(path.join(process.cwd(), ".env"), "utf8");
  const envLine = env.split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  if (!envLine) throw new Error("DATABASE_URL tidak ditemukan di .env");
  const connectionString = envLine
    .replace(/^\s*DATABASE_URL\s*=\s*/, "")
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");

  const client = new pg.Client({ connectionString });
  await client.connect();
  console.log("Terhubung ke database server:", connectionString.replace(/:[^:@]+@/, ":****@"));

  const parsedData = JSON.parse(await readFile("scratch/september_electricity.json", "utf8"));
  console.log(`Memproses ${parsedData.length} data listrik dari PDF rekap-pemakaian-listrik-2026-09-18.pdf...`);

  // Ambil officer map
  const officersRes = await client.query("SELECT id, name FROM electricity_officers");
  const officerMap = new Map();
  for (const off of officersRes.rows) {
    officerMap.set(normalized(off.name), off.id);
  }

  // Cek apakah ada petugas baru
  for (const item of parsedData) {
    const norm = normalized(item.officer);
    let offId = officerMap.get(norm);
    if (!offId) {
      for (const [existingNorm, existingId] of officerMap.entries()) {
        if (norm.includes(existingNorm) || existingNorm.includes(norm)) {
          offId = existingId;
          break;
        }
      }
      if (!offId) {
        const newId = crypto.randomUUID();
        await client.query(
          "INSERT INTO electricity_officers (id, name, legacy_sheet_row) VALUES ($1, $2, $3)",
          [newId, item.officer, Math.floor(Math.random() * 10000) + 1000]
        );
        officerMap.set(norm, newId);
        offId = newId;
        console.log(`Menambahkan petugas listrik baru: "${item.officer}"`);
      }
    }
  }

  // Cek duplikasi berdasarkan checked_at
  const existingRes = await client.query("SELECT checked_at FROM electricity_checks");
  const existingSet = new Set(existingRes.rows.map((r) => new Date(r.checked_at).toISOString()));

  const toInsert = [];
  let dupCount = 0;

  for (let idx = 0; idx < parsedData.length; idx++) {
    const item = parsedData[idx];
    const [d, m, y] = item.date.split("/");
    const isoDate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    const [hh, mm] = item.time.split(":");
    const checkedAt = new Date(`${isoDate}T${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:00+07:00`).toISOString();

    if (existingSet.has(checkedAt)) {
      dupCount++;
      continue;
    }
    existingSet.add(checkedAt);

    let officerId = officerMap.get(normalized(item.officer));
    if (!officerId) {
      for (const [existingNorm, existingId] of officerMap.entries()) {
        if (normalized(item.officer).includes(existingNorm) || existingNorm.includes(normalized(item.officer))) {
          officerId = existingId;
          break;
        }
      }
    }

    toInsert.push([
      crypto.randomUUID(),
      officerId,
      `${isoDate}T${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:00+07:00`,
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
      "rekap-pemakaian-listrik-2026-09-18.pdf",
      idx + 1,
      JSON.stringify(item),
      new Date().toISOString(),
      new Date().toISOString()
    ]);
  }

  console.log(`- Data Baru Siap Dimasukkan: ${toInsert.length}`);
  console.log(`- Data Duplikat Dilewati    : ${dupCount}`);

  if (toInsert.length > 0) {
    const columns = [
      "id", "officer_id", "checked_at", "officer_name",
      "huhe_h", "huhe_hh", "huar_heh", "huar_hh",
      "grid_from_mwh", "pv_from_mwh", "grid_to_mwh",
      "kwh", "kvar", "difference", "conclusion",
      "calculation_anomaly", "source_sheet", "legacy_sheet_row",
      "legacy_data", "created_at", "updated_at"
    ];

    const placeholders = [];
    const flatValues = [];
    let pIdx = 1;

    for (const row of toInsert) {
      const rowPh = [];
      for (let c = 0; c < row.length; c++) {
        if (columns[c] === "legacy_data") {
          rowPh.push(`$${pIdx}::jsonb`);
        } else {
          rowPh.push(`$${pIdx}`);
        }
        flatValues.push(row[c]);
        pIdx++;
      }
      placeholders.push(`(${rowPh.join(", ")})`);
    }

    const insertSql = `
      INSERT INTO electricity_checks (${columns.map((c) => `"${c}"`).join(", ")})
      VALUES ${placeholders.join(",\n")}
    `;
    await client.query(insertSql, flatValues);
    console.log(`✅ Berhasil memasukkan ${toInsert.length} baris ke tabel electricity_checks.`);
  }

  const countRes = await client.query("SELECT count(*)::int AS count FROM electricity_checks");
  console.log(`\nTotal Data Listrik di Server Sekarang: ${countRes.rows[0].count} baris.`);

  await client.end();
}

main().catch((err) => {
  console.error("❌ Terjadi kesalahan:", err);
  process.exit(1);
});
