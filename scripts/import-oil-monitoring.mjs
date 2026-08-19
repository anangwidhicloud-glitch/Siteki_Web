import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client } = pg;
const SPREADSHEET_ID = "1724uhI_7PrL5njfuiA7dniBnykwHWVXlIRCvOHE-2Zs";

const text = (value) => {
  const result = String(value ?? "").trim();
  return result || null;
};
const normalized = (value) => String(value ?? "").trim().toLocaleLowerCase("id-ID").replace(/\s+/g, " ");
const number = (value) => {
  let source = text(value);
  if (!source) return null;
  source = source.replace(/%/g, "").replace(/\s+/g, "");
  if (source.includes(",")) source = source.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(source)) source = source.replace(/\./g, "");
  const result = Number(source);
  return Number.isFinite(result) ? result : null;
};

function date(value) {
  const source = text(value);
  const match = source?.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function readSheet(sheetName) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`);
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

const [reservoirRows, checkRows] = await Promise.all([
  readSheet("VOLUME"),
  readSheet("CEK OLI"),
]);

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
      (SELECT count(*)::integer FROM oil_reservoirs) AS reservoirs,
      (SELECT count(*)::integer FROM oil_checks) AS checks
  `);
  if (Object.values(existing.rows[0]).some(Boolean)) {
    throw new Error("Impor dibatalkan karena tabel cek oli sudah berisi data.");
  }

  const machines = (await client.query("SELECT id, name FROM machines")).rows;
  const machinesByName = new Map();
  for (const machine of machines) {
    const key = normalized(machine.name);
    const matches = machinesByName.get(key) || [];
    matches.push(machine.id);
    machinesByName.set(key, matches);
  }

  let linkedMachines = 0;
  let capacityAnomalies = 0;
  const reservoirValues = [];
  const reservoirTuples = reservoirRows.map((row, index) => {
    const name = text(row.MESIN);
    const matches = machinesByName.get(normalized(name)) || [];
    const machineId = matches.length === 1 ? matches[0] : null;
    if (machineId) linkedMachines += 1;
    const length = number(row.P);
    const width = number(row.L);
    const height = number(row.T);
    const capacity = number(row.V);
    const calculatedCapacity = length * width * height / 1000;
    const anomaly = [length, width, height, capacity].some((value) => value === null) ||
      Math.abs(capacity - calculatedCapacity) > 1;
    if (anomaly) capacityAnomalies += 1;
    const rowValues = [
      machineId,
      name,
      length,
      width,
      height,
      capacity,
      text(row.KETERANGAN),
      anomaly,
      "VOLUME",
      index + 2,
      JSON.stringify(row),
    ];
    const placeholders = rowValues.map((value) => {
      reservoirValues.push(value);
      return `$${reservoirValues.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  const insertedReservoirs = await client.query(
    `INSERT INTO oil_reservoirs (
      machine_id, name, length_cm, width_cm, height_cm, capacity_liters,
      notes, capacity_anomaly, source_sheet, legacy_sheet_row, legacy_data
    ) VALUES ${reservoirTuples.join(", ")} RETURNING id, machine_id, name`,
    reservoirValues,
  );
  const reservoirsByName = new Map(
    insertedReservoirs.rows.map((row) => [normalized(row.name), row]),
  );

  let unmatchedReservoirs = 0;
  let invalidLevels = 0;
  const checkValues = [];
  const checkTuples = checkRows.map((row, index) => {
    const reservoir = reservoirsByName.get(normalized(row.MESIN));
    if (!reservoir) unmatchedReservoirs += 1;
    const checkedOn = date(row.TANGGAL);
    if (!checkedOn) throw new Error(`Tanggal cek oli tidak valid pada baris ${index + 2}.`);
    const level = number(row.LEVEL);
    if (level === null || level < 0 || level > 100) invalidLevels += 1;
    const rowValues = [
      reservoir?.id || null,
      reservoir?.machine_id || null,
      checkedOn,
      level,
      text(row.KETERANGAN),
      "CEK OLI",
      index + 2,
      JSON.stringify(row),
    ];
    const placeholders = rowValues.map((value) => {
      checkValues.push(value);
      return `$${checkValues.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  if (unmatchedReservoirs || invalidLevels) {
    throw new Error(`${unmatchedReservoirs} titik oli atau ${invalidLevels} level tidak valid.`);
  }
  await client.query(
    `INSERT INTO oil_checks (
      reservoir_id, machine_id, checked_on, level_percent, notes,
      source_sheet, legacy_sheet_row, legacy_data
    ) VALUES ${checkTuples.join(", ")}`,
    checkValues,
  );
  await client.query("COMMIT");
  console.log(
    `Impor cek oli berhasil: ${reservoirRows.length} reservoir dan ${checkRows.length} pemeriksaan.`,
  );
  console.log(
    `Relasi: ${linkedMachines} reservoir terhubung master mesin; ${capacityAnomalies} anomali kapasitas.`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
