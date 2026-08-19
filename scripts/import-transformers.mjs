import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client } = pg;
const SPREADSHEET_ID = "1-KUxTQZ5Qu_7Kbrj0eYRYuTx3TDXdxOQNvrZYVv0p0s";
const FORM_API = "https://script.google.com/macros/s/AKfycbyX0U2MaTrjBTZjLkTH64E3bIXg2lyHhtPdTJ1QbEFco34m3FK18gDDE0Lqk7ja-k-C/exec";
const DATA_API = "https://script.google.com/macros/s/AKfycbyaJ1oCCTfcti5u98MYyWP9OBA96SGPEmL_dchslJ9myC4dEv4ku8bZebYAxyqt0aA/exec";

const text = (value) => {
  const result = String(value ?? "").trim();
  return result || null;
};
const normalized = (value) => String(value ?? "").trim().toLocaleLowerCase("id-ID");

function localDateFromInstant(value) {
  const source = text(value);
  if (!source) return null;
  const instant = new Date(source);
  if (Number.isNaN(instant.getTime())) throw new Error(`Tanggal pengadaan tidak valid: ${source}`);
  return new Date(instant.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function inspectionDateTime(value) {
  const source = text(value);
  if (!source) return null;
  const match = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    hour > 23 ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}+07:00`;
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Sumber Trafo gagal dibaca (HTTP ${response.status}).`);
  return response.json();
}

async function inspectionRows() {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Spreadsheet inspeksi gagal dibaca (HTTP ${response.status}).`);
  return parse(await response.text(), {
    columns: true,
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });
}

const [masterPayload, referencePayload, inspections] = await Promise.all([
  json(`${DATA_API}?action=getDataTravo`),
  json(`${FORM_API}?action=getReferensi`),
  inspectionRows(),
]);
if (!Array.isArray(masterPayload)) throw new Error("Master Trafo bukan array.");
const masters = masterPayload;
const brands = [...new Map(
  (referencePayload.merk || [])
    .filter((name) => text(name) && normalized(name) !== "merk_travo")
    .map((name) => [normalized(name), text(name)]),
).values()];
const locations = [...new Map(
  (referencePayload.lokasi || [])
    .filter((name) => text(name) && normalized(name) !== "lokasi")
    .map((name) => [normalized(name), text(name)]),
).values()];

const envContents = await readFile(path.join(process.cwd(), ".env"), "utf8");
const envLine = envContents.split(/\r?\n/).find((line) => /^\s*DATABASE_URL\s*=/.test(line));
if (!envLine) throw new Error("DATABASE_URL tidak ditemukan.");
const connectionString = envLine
  .replace(/^\s*DATABASE_URL\s*=\s*/, "")
  .trim()
  .replace(/^(['"])(.*)\1$/, "$2");

const client = new Client({ connectionString });
try {
  await client.connect();
  await client.query("BEGIN");
  const existing = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM welding_transformers) AS transformers,
      (SELECT count(*)::integer FROM welding_transformer_inspections) AS inspections,
      (SELECT count(*)::integer FROM welding_transformer_brands) AS brands,
      (SELECT count(*)::integer FROM welding_transformer_locations) AS locations
  `);
  if (Object.values(existing.rows[0]).some(Boolean)) {
    throw new Error("Impor dibatalkan karena tabel Trafo sudah berisi data.");
  }

  async function insertNames(table, names) {
    const values = [];
    const tuples = names.map((name) => {
      values.push(name);
      return `($${values.length})`;
    });
    const result = await client.query(
      `INSERT INTO ${table} (name) VALUES ${tuples.join(", ")} RETURNING id, name`,
      values,
    );
    return new Map(result.rows.map((row) => [normalized(row.name), row.id]));
  }
  const brandIds = await insertNames("welding_transformer_brands", brands);
  const locationIds = await insertNames("welding_transformer_locations", locations);

  const seenCodes = new Set();
  let unmatchedBrands = 0;
  const masterValues = [];
  const masterTuples = masters.map((row) => {
    const code = text(row.kode);
    if (!code || seenCodes.has(normalized(code))) throw new Error(`Kode Trafo kosong/duplikat: ${code}`);
    seenCodes.add(normalized(code));
    const brandId = brandIds.get(normalized(row.merk)) || null;
    if (!brandId && text(row.merk)) unmatchedBrands += 1;
    const rowValues = [
      code,
      text(row.nama),
      brandId,
      text(row.merk),
      text(row.tipe),
      text(row.tegangan),
      localDateFromInstant(row.pengadaan),
      JSON.stringify(row),
    ];
    const placeholders = rowValues.map((value) => {
      masterValues.push(value);
      return `$${masterValues.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  const insertedMasters = await client.query(
    `INSERT INTO welding_transformers (
      code, name, brand_id, brand_name, transformer_type, voltage, acquired_on, legacy_data
    ) VALUES ${masterTuples.join(", ")} RETURNING id, code, name`,
    masterValues,
  );
  const transformersByCode = new Map(
    insertedMasters.rows.map((row) => [normalized(row.code), row]),
  );

  let unmatchedTransformers = 0;
  let unmatchedLocations = 0;
  const inspectionValues = [];
  const inspectionTuples = inspections.map((row, index) => {
    const transformer = transformersByCode.get(normalized(row.Kode));
    if (!transformer) unmatchedTransformers += 1;
    const inspectedAt = inspectionDateTime(row.Tanggal);
    if (!inspectedAt) throw new Error(`Tanggal inspeksi tidak valid pada baris ${index + 2}.`);
    const locationId = locationIds.get(normalized(row.Lokasi)) || null;
    if (!locationId && text(row.Lokasi)) unmatchedLocations += 1;
    const rowValues = [
      transformer?.id || null,
      inspectedAt,
      text(row.Kode),
      text(row.Nama),
      locationId,
      text(row.Lokasi),
      text(row.Kondisi),
      text(row.Status),
      text(row.Stang),
      text(row.Kabel),
      text(row.Masa),
      text(row.Keterangan),
      "Inspeksi",
      index + 2,
      JSON.stringify(row),
    ];
    const placeholders = rowValues.map((value) => {
      inspectionValues.push(value);
      return `$${inspectionValues.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  if (unmatchedTransformers) throw new Error(`${unmatchedTransformers} inspeksi tidak memiliki master Trafo.`);
  await client.query(
    `INSERT INTO welding_transformer_inspections (
      transformer_id, inspected_at, transformer_code, transformer_name,
      location_id, location_name, condition, operational_status,
      welding_rod_status, cable_status, ground_clamp_status, notes,
      source_sheet, legacy_sheet_row, legacy_data
    ) VALUES ${inspectionTuples.join(", ")}`,
    inspectionValues,
  );
  await client.query("COMMIT");
  console.log(
    `Impor Trafo Las berhasil: ${masters.length} master, ${inspections.length} inspeksi, ${brands.length} merk, ${locations.length} lokasi.`,
  );
  console.log(`Relasi: ${unmatchedBrands} merk dan ${unmatchedLocations} lokasi tidak ditemukan.`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
