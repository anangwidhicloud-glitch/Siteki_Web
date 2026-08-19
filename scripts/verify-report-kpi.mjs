import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client } = pg;
const SPREADSHEET_ID = "1g1kICI_1SVzTsEzklRSRAMQWpoxieTWmhYDVeeXG-4E";

function text(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function number(value) {
  let source = text(value);
  if (!source) return 0;
  source = source.replace(/\s+/g, "");
  if (source.includes(",")) source = source.replace(/\./g, "").replace(",", ".");
  const result = Number(source);
  return Number.isFinite(result) ? result : 0;
}

function month(value) {
  const match = String(value ?? "").match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const monthNumber = second > 12 ? first : second;
  return `${match[3]}-${monthNumber.toString().padStart(2, "0")}-01`;
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
const envLine = envContents
  .split(/\r?\n/)
  .find((entry) => /^\s*DATABASE_URL\s*=/.test(entry));
if (!envLine) throw new Error("DATABASE_URL tidak ditemukan.");
const connectionString = envLine
  .replace(/^\s*DATABASE_URL\s*=\s*/, "")
  .trim()
  .replace(/^(['"])(.*)\1$/, "$2");

const [hours, orders, ratings] = await Promise.all([
  readSheet("Rekap Jam"),
  readSheet("Rekap Order"),
  readSheet("Rekap Penilaian"),
]);
const expected = new Map();
for (const row of hours) {
  const key = month(row.Bulan);
  if (key) expected.set(key, { totalHours: number(row["Total Jam"]), target: number(row.Target) });
}
for (const row of orders) {
  const key = month(row.Bulan);
  if (key) expected.set(key, { ...expected.get(key), orderCount: number(row["Jumlah Order"]) });
}
for (const row of ratings) {
  const key = month(row.Bulan);
  if (key) {
    expected.set(key, {
      ...expected.get(key),
      goodCount: number(row.Bagus),
      fairCount: number(row.Cukup),
      poorCount: number(row["Tidak Bagus"]),
    });
  }
}

const client = new Client({ connectionString });
try {
  await client.connect();
  const result = await client.query(`
    SELECT
      to_char(month, 'YYYY-MM-DD') AS month,
      total_hours::float8,
      target_hours::float8,
      order_count,
      good_count,
      fair_count,
      poor_count
    FROM monthly_technical_kpi
    ORDER BY month
  `);
  let mismatches = 0;
  const mismatchDetails = [];
  for (const actual of result.rows) {
    const source = expected.get(actual.month);
    if (
      !source ||
      Math.abs(actual.total_hours - source.totalHours) > 0.11 ||
      Math.abs(actual.target_hours - source.target) > 0.01 ||
      actual.order_count !== source.orderCount ||
      actual.good_count !== source.goodCount ||
      actual.fair_count !== source.fairCount ||
      actual.poor_count !== source.poorCount
    ) {
      mismatches += 1;
      mismatchDetails.push({ month: actual.month, actual, expected: source || null });
    }
  }
  if (result.rows.length !== expected.size) mismatches += 1;
  if (mismatches) {
    console.error(JSON.stringify(mismatchDetails, null, 2));
    throw new Error(`${mismatches} rekap bulanan berbeda antara Neon dan spreadsheet.`);
  }
  console.log(`Verifikasi KPI berhasil: ${result.rows.length} bulan sama dengan spreadsheet.`);
} finally {
  await client.end().catch(() => {});
}
