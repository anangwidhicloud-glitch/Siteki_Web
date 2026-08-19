import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client } = pg;
const SPREADSHEET_ID = "1nbmqEBQWJMy-1CYSGtIiTHDXgbXR485xe1Np-THWR9U";

function text(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function databaseUrl(contents) {
  const line = contents
    .split(/\r?\n/)
    .find((entry) => /^\s*DATABASE_URL\s*=/.test(entry));
  if (!line) throw new Error("DATABASE_URL tidak ditemukan dalam file .env.");
  return line
    .replace(/^\s*DATABASE_URL\s*=\s*/, "")
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");
}

async function readSheet(sheetName) {
  const url = new URL(
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`,
  );
  url.searchParams.set("tqx", "out:csv");
  url.searchParams.set("sheet", sheetName);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Tab ${sheetName} gagal dibaca (HTTP ${response.status}).`);
  }
  return parse(await response.text(), {
    columns: true,
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });
}

const env = await readFile(path.join(process.cwd(), ".env"), "utf8");
const [partSource, stockSource, bonSource, usageSource, historySource] =
  await Promise.all(
    ["Part", "Stok", "Bon", "Penggunaan", "Sheet3"].map(readSheet),
  );
const expected = {
  parts: partSource.filter((row) => text(row.Nama)).length,
  balances: stockSource.filter((row) => text(row.Nama)).length,
  currentRequests: bonSource.filter((row) => text(row.Nama)).length,
  historicalRequests: historySource.length,
  movements: usageSource.filter((row) => text(row.Nama)).length,
};
const client = new Client({ connectionString: databaseUrl(env) });

try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM parts) AS parts,
      (SELECT count(*)::integer FROM inventory_balances) AS balances,
      (SELECT count(*)::integer FROM part_requests WHERE source_sheet = 'Bon') AS current_requests,
      (SELECT count(*)::integer FROM part_requests WHERE source_sheet = 'Sheet3') AS historical_requests,
      (SELECT count(*)::integer FROM stock_movements) AS movements,
      (SELECT count(*)::integer FROM inventory_balances WHERE part_id IS NULL) AS unmatched_balances,
      (SELECT count(*)::integer FROM part_requests WHERE part_id IS NULL) AS unmatched_requests,
      (SELECT count(*)::integer FROM stock_movements WHERE part_id IS NULL) AS unmatched_movements
  `);
  const row = result.rows[0];
  const comparisons = [
    ["part", expected.parts, row.parts],
    ["saldo stok", expected.balances, row.balances],
    ["permintaan Bon", expected.currentRequests, row.current_requests],
    ["riwayat Sheet3", expected.historicalRequests, row.historical_requests],
    ["penggunaan stok", expected.movements, row.movements],
  ];
  const differences = comparisons
    .filter(([, source, neon]) => source !== neon)
    .map(([label, source, neon]) => `${label}: Spreadsheet ${source}, Neon ${neon}`);
  if (differences.length) {
    throw new Error(`Verifikasi inventori gagal: ${differences.join("; ")}.`);
  }
  console.log(
    `Verifikasi inventori berhasil: ${row.parts} part, ${row.balances} saldo, ${row.current_requests + row.historical_requests} permintaan, dan ${row.movements} penggunaan sama dengan Spreadsheet.`,
  );
  console.log(
    `Relasi belum pasti: ${row.unmatched_balances} saldo, ${row.unmatched_requests} permintaan, ${row.unmatched_movements} penggunaan tanpa part_id.`,
  );
  await client.query("ROLLBACK");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
