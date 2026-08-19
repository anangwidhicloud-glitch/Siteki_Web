import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client } = pg;
const SPREADSHEET_ID = "1edHJAOrrYEqbDkhOQsH4VnfmGw6qLDHt78F8-2jtfv0";

const text = (value) => {
  const result = String(value ?? "").trim();
  return result || null;
};
const normalized = (value) => String(value ?? "").trim().toLocaleLowerCase("id-ID");
const integer = (value) => {
  const source = text(value);
  if (!source) return null;
  const result = Number(source);
  return Number.isInteger(result) ? result : null;
};

function date(value) {
  const source = text(value);
  if (!source) return null;
  const match = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) throw new Error(`Tanggal tidak valid: ${source}`);
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) throw new Error(`Tanggal tidak valid: ${source}`);
  return `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function daysBetween(first, second) {
  if (!first || !second) return null;
  return Math.round((Date.parse(`${second}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86400000);
}

async function readSheet(sheetName) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`);
  url.searchParams.set("tqx", "out:csv");
  if (sheetName) url.searchParams.set("sheet", sheetName);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Tab ${sheetName || "utama"} gagal dibaca.`);
  return parse(await response.text(), {
    columns: true,
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });
}

const envContents = await readFile(path.join(process.cwd(), ".env"), "utf8");
const envLine = envContents.split(/\r?\n/).find((line) => /^\s*DATABASE_URL\s*=/.test(line));
if (!envLine) throw new Error("DATABASE_URL tidak ditemukan.");
const connectionString = envLine
  .replace(/^\s*DATABASE_URL\s*=\s*/, "")
  .trim()
  .replace(/^(['"])(.*)\1$/, "$2");

const [transactionRows, brandRows, groupRows, locationRows] = await Promise.all([
  readSheet(null),
  readSheet("MERK"),
  readSheet("GROUP"),
  readSheet("LOKASI"),
]);

function referenceEntries(rows, column, historicalValues) {
  const entries = new Map();
  rows.forEach((row, index) => {
    const name = text(row[column]);
    if (name) entries.set(normalized(name), { name, active: true, row: index + 2 });
  });
  historicalValues.forEach((value) => {
    const name = text(value);
    if (name && name !== "-" && !entries.has(normalized(name))) {
      entries.set(normalized(name), { name, active: false, row: null });
    }
  });
  return [...entries.values()];
}

const brandEntries = referenceEntries(brandRows, "MERK", transactionRows.map((row) => row.Merk));
const groupEntries = referenceEntries(
  groupRows,
  "GROUP",
  transactionRows.flatMap((row) => [row["Nama Keluar"], row["Nama Kembali"]]),
);
const locationEntries = referenceEntries(
  locationRows,
  "LOKASI",
  transactionRows.flatMap((row) => [row.Digunakan, row.Dari]),
);

const client = new Client({ connectionString });
try {
  await client.connect();
  await client.query("BEGIN");
  const existing = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM stang_transactions) AS transactions,
      (SELECT count(*)::integer FROM stang_brands) AS brands,
      (SELECT count(*)::integer FROM stang_groups) AS groups,
      (SELECT count(*)::integer FROM stang_locations) AS locations
  `);
  if (Object.values(existing.rows[0]).some(Boolean)) {
    throw new Error("Impor dibatalkan karena tabel Stang sudah berisi data.");
  }

  async function insertReferences(table, sourceSheet, entries) {
    const values = [];
    const tuples = entries.map((entry) => {
      const rowValues = [entry.name, entry.active, sourceSheet, entry.row];
      const placeholders = rowValues.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const result = await client.query(
      `INSERT INTO ${table} (name, is_active, source_sheet, legacy_sheet_row)
       VALUES ${tuples.join(", ")}
       RETURNING id, name`,
      values,
    );
    return new Map(result.rows.map((row) => [normalized(row.name), row.id]));
  }

  const brands = await insertReferences("stang_brands", "MERK", brandEntries);
  const groups = await insertReferences("stang_groups", "GROUP", groupEntries);
  const locations = await insertReferences("stang_locations", "LOKASI", locationEntries);

  let missingCodes = 0;
  let missingIssueDates = 0;
  let durationAnomalies = 0;
  const values = [];
  const tuples = transactionRows.map((row, index) => {
    const code = text(row.Kode);
    const issuedOn = date(row.Keluar);
    const returnedOn = date(row.Kembali);
    const duration = integer(row.Durasi);
    const calculatedDuration = daysBetween(issuedOn, returnedOn);
    if (!code) missingCodes += 1;
    if (!issuedOn) missingIssueDates += 1;
    const durationAnomaly = returnedOn !== null && (
      calculatedDuration === null || duration === null || duration !== calculatedDuration ||
      calculatedDuration < 0 || duration < 0
    );
    if (durationAnomaly) durationAnomalies += 1;
    const issuedName = text(row["Nama Keluar"]);
    const returnedName = text(row["Nama Kembali"]);
    const usedLocation = text(row.Digunakan);
    const fromLocation = text(row.Dari);
    const brandName = text(row.Merk);
    const rowValues = [
      code,
      issuedOn,
      groups.get(normalized(issuedName)) || null,
      issuedName,
      locations.get(normalized(usedLocation)) || null,
      usedLocation,
      returnedOn,
      groups.get(normalized(returnedName)) || null,
      returnedName,
      locations.get(normalized(fromLocation)) || null,
      fromLocation,
      brands.get(normalized(brandName)) || null,
      brandName,
      duration,
      text(row.Keterangan),
      !code || !issuedOn || durationAnomaly,
      "Database",
      index + 2,
      JSON.stringify(row),
    ];
    const placeholders = rowValues.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  await client.query(
    `INSERT INTO stang_transactions (
      code, issued_on, issued_group_id, issued_by_name, used_location_id,
      used_location_name, returned_on, returned_group_id, returned_by_name,
      from_location_id, from_location_name, brand_id, brand_name, duration_days,
      notes, data_anomaly, source_sheet, legacy_sheet_row, legacy_data
    ) VALUES ${tuples.join(", ")}`,
    values,
  );
  await client.query("COMMIT");
  console.log(
    `Impor Stang berhasil: ${transactionRows.length} transaksi, ${brandEntries.length} merk, ${groupEntries.length} grup, dan ${locationEntries.length} lokasi.`,
  );
  console.log(
    `Data sumber: ${missingCodes} tanpa kode, ${missingIssueDates} tanpa tanggal keluar, ${durationAnomalies} anomali durasi.`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
