import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client } = pg;
const USER_SPREADSHEET_ID = "1XnjbaYXuyYIgEsf9mcxsHSAZWQxgNebZI4p_Wk8H1Cc";

function money(value) {
  let source = String(value ?? "").trim().replace(/[^0-9,.-]/g, "");
  if (!source) return null;
  if (source.includes(",")) source = source.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(source)) source = source.replace(/\./g, "");
  const result = Number(source);
  return Number.isFinite(result) ? result : null;
}
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
  const result = await client.query(`
    SELECT
      count(*)::integer AS entry_count,
      count(*) FILTER (WHERE user_id IS NULL)::integer AS unmatched_users,
      count(*) FILTER (WHERE wage_anomaly)::integer AS wage_anomalies,
      count(*) FILTER (WHERE salary_reference_anomaly)::integer AS salary_anomalies,
      count(*) FILTER (
        WHERE user_id IS NOT NULL
          AND abs(total_wage - calculated_wage) > 1
      )::integer AS database_formula_mismatches
    FROM overtime_entry_calculations
  `);
  const summary = result.rows[0];
  if (summary.database_formula_mismatches !== summary.wage_anomalies) {
    throw new Error("Penanda anomali upah tidak konsisten dengan fungsi PostgreSQL.");
  }
  const userUrl = new URL(
    `https://docs.google.com/spreadsheets/d/${USER_SPREADSHEET_ID}/gviz/tq`,
  );
  userUrl.searchParams.set("tqx", "out:csv");
  userUrl.searchParams.set("sheet", "User");
  const userResponse = await fetch(userUrl);
  if (!userResponse.ok) throw new Error("Tab User gagal dibaca untuk verifikasi gaji.");
  const sourceUsers = parse(await userResponse.text(), {
    columns: true,
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });
  const databaseUsers = (await client.query(
    "SELECT legacy_sheet_row, base_salary::float8, daily_salary::float8 FROM users",
  )).rows;
  const databaseByRow = new Map(
    databaseUsers.map((user) => [user.legacy_sheet_row, user]),
  );
  let salarySourceMismatches = 0;
  sourceUsers.forEach((sourceUser, index) => {
    const databaseUser = databaseByRow.get(index + 2);
    const sourceBase = money(sourceUser["Gaji Pokok"]);
    const sourceDaily = money(sourceUser["Gaji Harian"]);
    if (
      !databaseUser ||
      (sourceBase !== null && Math.abs(databaseUser.base_salary - sourceBase) > 0.01) ||
      (sourceDaily !== null && Math.abs(databaseUser.daily_salary - sourceDaily) > 0.01)
    ) {
      salarySourceMismatches += 1;
    }
  });
  if (salarySourceMismatches) {
    throw new Error(`${salarySourceMismatches} data gaji pengguna berbeda dari spreadsheet User.`);
  }
  console.log(
    `Verifikasi lembur: ${summary.entry_count} transaksi, ${summary.unmatched_users} tanpa user, ${summary.wage_anomalies} anomali upah, ${summary.salary_anomalies} anomali referensi gaji.`,
  );
  console.log(`Verifikasi gaji pengguna berhasil: ${sourceUsers.length} profil sama dengan spreadsheet.`);
} finally {
  await client.end().catch(() => {});
}
