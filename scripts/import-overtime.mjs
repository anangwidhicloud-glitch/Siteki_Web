import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client } = pg;
const SPREADSHEET_ID = "1C6qxrpwlNPuXvLhU2cHWHb4V658tnJLQZteHgZR2S7U";

const text = (value) => {
  const result = String(value ?? "").trim();
  return result || null;
};
const normalized = (value) => String(value ?? "").trim().toLocaleLowerCase("id-ID");

function number(value) {
  let source = text(value);
  if (!source) return null;
  source = source.replace(/[^0-9,.-]/g, "");
  if (source.includes(",")) source = source.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(source)) source = source.replace(/\./g, "");
  const result = Number(source);
  return Number.isFinite(result) ? result : null;
}

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

function dateTime(value) {
  const source = text(value);
  if (!source) return null;
  const match = source.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s+(\d{1,2}):([0-5]\d)(?::([0-5]\d))?/,
  );
  if (!match) return null;
  const dayValue = date(`${match[1]}/${match[2]}/${match[3]}`);
  if (!dayValue) return null;
  return `${dayValue}T${match[4].padStart(2, "0")}:${match[5]}:${match[6] || "00"}+07:00`;
}

function roundedComponent(baseSalary, multiplier, hours) {
  if (!baseSalary || !hours || hours <= 0) return 0;
  const rounded = Math.round(multiplier * 0.005781035 * baseSalary * hours);
  const hundreds = Math.floor(rounded / 100) * 100;
  const remainder = rounded % 100;
  if (remainder === 0) return hundreds;
  return remainder < 50 ? hundreds + 50 : hundreds + 100;
}

function calculatedWage(baseSalary, hours, type) {
  if (normalized(type).replaceAll("_", "") === "haribesar") {
    return roundedComponent(baseSalary, 2, hours);
  }
  if (hours > 1) {
    return roundedComponent(baseSalary, 1.5, 1) +
      roundedComponent(baseSalary, 2, hours - 1);
  }
  return roundedComponent(baseSalary, 1.5, hours);
}

const envContents = await readFile(path.join(process.cwd(), ".env"), "utf8");
const envLine = envContents.split(/\r?\n/).find((line) => /^\s*DATABASE_URL\s*=/.test(line));
if (!envLine) throw new Error("DATABASE_URL tidak ditemukan.");
const connectionString = envLine
  .replace(/^\s*DATABASE_URL\s*=\s*/, "")
  .trim()
  .replace(/^(['"])(.*)\1$/, "$2");

const url = new URL(
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`,
);
url.searchParams.set("tqx", "out:csv");
url.searchParams.set("sheet", "Database_Lembur");
const response = await fetch(url);
if (!response.ok) throw new Error("Tab Database_Lembur gagal dibaca.");
const sourceRows = parse(await response.text(), {
  columns: true,
  bom: true,
  relax_column_count: true,
  skip_empty_lines: true,
  trim: true,
});

const client = new Client({ connectionString });
try {
  await client.connect();
  await client.query("BEGIN");
  const existing = await client.query("SELECT count(*)::integer AS count FROM overtime_entries");
  const countBefore = existing.rows[0].count;
  const users = (await client.query(
    "SELECT id, full_name, base_salary FROM users",
  )).rows;
  const groupedUsers = new Map();
  for (const user of users) {
    const key = normalized(user.full_name);
    const matches = groupedUsers.get(key) || [];
    matches.push(user);
    groupedUsers.set(key, matches);
  }

  let unmatchedUsers = 0;
  let wageAnomalies = 0;
  let salaryAnomalies = 0;
  let invalidDates = 0;
  const values = [];
  const tuples = sourceRows.map((row, index) => {
    const matches = groupedUsers.get(normalized(row.Nama)) || [];
    const user = matches.length === 1 ? matches[0] : null;
    if (!user) unmatchedUsers += 1;
    const overtimeDate = date(row.Tanggal);
    if (!overtimeDate) invalidDates += 1;
    const hours = number(row.Jam_Lembur);
    const hourlySalary = number(row.Gaji_Pokok_Per_Jam);
    const totalWage = number(row.Total_Upah);
    const baseSalary = user?.base_salary == null ? null : Number(user.base_salary);
    const expectedWage = baseSalary ? calculatedWage(baseSalary, hours, row.Jenis_Lembur) : null;
    const wageAnomaly =
      expectedWage !== null && totalWage !== null && Math.abs(expectedWage - totalWage) > 1;
    const salaryAnomaly =
      baseSalary !== null &&
      hourlySalary !== null &&
      Math.abs(baseSalary / 173 - hourlySalary) > 0.01;
    if (wageAnomaly) wageAnomalies += 1;
    if (salaryAnomaly) salaryAnomalies += 1;
    const rowValues = [
      user?.id || null,
      dateTime(row.Timestamp),
      overtimeDate,
      text(row.Nama),
      text(row.Role),
      hours,
      text(row.Jenis_Lembur),
      hourlySalary,
      totalWage,
      text(row.Keterangan),
      wageAnomaly,
      salaryAnomaly,
      "Database_Lembur",
      index + 2,
      JSON.stringify(row),
    ];
    const placeholders = rowValues.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  if (invalidDates) throw new Error(`${invalidDates} tanggal lembur tidak valid.`);
  await client.query(
    `INSERT INTO overtime_entries (
      user_id, recorded_at, overtime_date, employee_name, role_snapshot,
      overtime_hours, overtime_type, hourly_salary_snapshot, total_wage,
      notes, wage_anomaly, salary_reference_anomaly, source_sheet,
      legacy_sheet_row, legacy_data
    ) VALUES ${tuples.join(", ")}
    ON CONFLICT (source_sheet, legacy_sheet_row) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      recorded_at = EXCLUDED.recorded_at,
      overtime_date = EXCLUDED.overtime_date,
      employee_name = EXCLUDED.employee_name,
      role_snapshot = EXCLUDED.role_snapshot,
      overtime_hours = EXCLUDED.overtime_hours,
      overtime_type = EXCLUDED.overtime_type,
      hourly_salary_snapshot = EXCLUDED.hourly_salary_snapshot,
      total_wage = EXCLUDED.total_wage,
      notes = EXCLUDED.notes,
      wage_anomaly = EXCLUDED.wage_anomaly,
      salary_reference_anomaly = EXCLUDED.salary_reference_anomaly,
      legacy_data = EXCLUDED.legacy_data`,
    values,
  );
  const countAfter = (await client.query(
    "SELECT count(*)::integer AS count FROM overtime_entries",
  )).rows[0].count;
  await client.query("COMMIT");
  console.log(
    `Sinkronisasi berhasil: ${sourceRows.length} baris diproses, ${countAfter - countBefore} transaksi baru.`,
  );
  console.log(
    `Verifikasi: ${unmatchedUsers} tanpa user_id, ${wageAnomalies} anomali upah, ${salaryAnomalies} anomali referensi gaji.`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
