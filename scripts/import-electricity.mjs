import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client } = pg;
const SPREADSHEET_ID = "1HXnn48lUENsnksx2jUI29DxIusX-_1tDs_h0xiIeEXA";

const text = (value) => {
  const result = String(value ?? "").trim();
  return result || null;
};
const normalized = (value) => String(value ?? "").trim().toLocaleLowerCase("id-ID");
const number = (value) => {
  let source = text(value);
  if (!source) return null;
  source = source.replace(/\s+/g, "");
  if (source.includes(",")) source = source.replace(/\./g, "").replace(",", ".");
  const result = Number(source);
  return Number.isFinite(result) ? result : null;
};

function date(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const month = second > 12 ? first : second;
  const day = second > 12 ? second : first;
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 || month > 12 ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return null;
  return `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function dateTime(dateValue, timeValue) {
  const day = date(dateValue);
  const match = String(timeValue ?? "").trim().match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/);
  if (!day || !match) return null;
  return `${day}T${match[1].padStart(2, "0")}:${match[2]}:${match[3] || "00"}+07:00`;
}

async function readSheet(sheetName) {
  const url = new URL(
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`,
  );
  url.searchParams.set("tqx", "out:csv");
  url.searchParams.set("sheet", sheetName);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Tab ${sheetName} gagal dibaca.`);
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

const [checkRows, officerRows] = await Promise.all([
  readSheet("Ceklistrik"),
  readSheet("Petugas"),
]);

const client = new Client({ connectionString });
try {
  await client.connect();
  await client.query("BEGIN");
  const existing = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM electricity_checks) AS checks,
      (SELECT count(*)::integer FROM electricity_officers) AS officers
  `);
  if (existing.rows[0].checks || existing.rows[0].officers) {
    throw new Error("Impor dibatalkan karena tabel listrik sudah berisi data.");
  }

  const users = (await client.query("SELECT id, full_name FROM users")).rows;
  const usersByName = new Map();
  for (const user of users) {
    const key = normalized(user.full_name);
    const matches = usersByName.get(key) || [];
    matches.push(user.id);
    usersByName.set(key, matches);
  }
  const officerNames = new Map();
  officerRows.forEach((row, index) => {
    const name = text(row.Nama);
    if (name) officerNames.set(normalized(name), { name, legacySheetRow: index + 2 });
  });
  checkRows.forEach((row) => {
    const name = text(row.Petugas);
    if (name && !officerNames.has(normalized(name))) {
      officerNames.set(normalized(name), { name, legacySheetRow: null });
    }
  });
  const officerValues = [];
  const officerTuples = [...officerNames.values()]
    .map(({ name, legacySheetRow }) => {
      const matches = usersByName.get(normalized(name)) || [];
      const values = [matches.length === 1 ? matches[0] : null, name, legacySheetRow];
      const placeholders = values.map((value) => {
        officerValues.push(value);
        return `$${officerValues.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
  const insertedOfficers = await client.query(
    `INSERT INTO electricity_officers (user_id, name, legacy_sheet_row)
     VALUES ${officerTuples.join(", ")}
     RETURNING id, name`,
    officerValues,
  );
  const officersByName = new Map(
    insertedOfficers.rows.map((officer) => [normalized(officer.name), officer.id]),
  );

  let invalidDates = 0;
  let unmatchedOfficers = 0;
  let calculationAnomalies = 0;
  const values = [];
  const tuples = checkRows.map((row, index) => {
    const checkedAt = dateTime(row.Tanggal, row.Jam);
    if (!checkedAt) invalidDates += 1;
    const officerId = officersByName.get(normalized(row.Petugas)) || null;
    if (!officerId) unmatchedOfficers += 1;
    const huheH = number(row["HUHE H"]);
    const huheHh = number(row["HUHE HH"]);
    const huarHeh = number(row["HUAR HEH"]);
    const huarHh = number(row["HUAR HH"]);
    const kwh = number(row.KWH);
    const kvar = number(row.KVAR);
    const difference = number(row.Selisih);
    const calculatedKwh = (huheH - huheHh) * 0.62;
    const calculatedKvar = huarHeh - huarHh;
    const calculatedDifference = calculatedKwh - calculatedKvar;
    const calculatedConclusion = calculatedKvar > calculatedKwh ? "potensi denda" : "aman";
    const anomaly =
      [huheH, huheHh, huarHeh, huarHh].some((value) => value === null) ||
      (kwh !== null && Math.abs(kwh - calculatedKwh) > 0.001) ||
      (kvar !== null && Math.abs(kvar - calculatedKvar) > 0.001) ||
      (difference !== null && Math.abs(difference - calculatedDifference) > 0.001) ||
      (text(row.Kesimpulan) && normalized(row.Kesimpulan) !== calculatedConclusion);
    if (anomaly) calculationAnomalies += 1;
    const rowValues = [
      officerId,
      checkedAt,
      text(row.Petugas),
      huheH,
      huheHh,
      huarHeh,
      huarHh,
      number(row["From Grid PLN (MWH)"]),
      number(row["From PV PLTS (MWH)"]),
      number(row["To Grid PLN (MWH)"]),
      kwh,
      kvar,
      difference,
      text(row.Kesimpulan),
      anomaly,
      "Ceklistrik",
      index + 2,
      JSON.stringify(row),
    ];
    const placeholders = rowValues.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  if (invalidDates) throw new Error(`${invalidDates} tanggal/jam pemeriksaan tidak valid.`);
  await client.query(
    `INSERT INTO electricity_checks (
      officer_id, checked_at, officer_name, huhe_h, huhe_hh, huar_heh,
      huar_hh, grid_from_mwh, pv_from_mwh, grid_to_mwh, kwh, kvar,
      difference, conclusion, calculation_anomaly, source_sheet,
      legacy_sheet_row, legacy_data
    ) VALUES ${tuples.join(", ")}`,
    values,
  );
  await client.query("COMMIT");
  console.log(
    `Impor berhasil: ${checkRows.length} pemeriksaan dan ${insertedOfficers.rows.length} petugas.`,
  );
  console.log(
    `Verifikasi: ${unmatchedOfficers} pemeriksaan tanpa officer_id dan ${calculationAnomalies} anomali perhitungan.`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
