import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client } = pg;
const SPREADSHEET_ID = "1XnjbaYXuyYIgEsf9mcxsHSAZWQxgNebZI4p_Wk8H1Cc";

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
const [machineSource, userSource] = await Promise.all([
  readSheet("mesin"),
  readSheet("User"),
]);
const machines = machineSource.filter((row) => text(row.Nama));
const users = userSource.filter((row) => text(row.username));
const client = new Client({ connectionString: databaseUrl(env) });

try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM machines) AS machines,
      (SELECT count(*)::integer FROM users) AS users,
      (SELECT count(*)::integer FROM machines WHERE legacy_sheet_row IS NULL) AS machines_without_source,
      (SELECT count(*)::integer FROM users WHERE legacy_sheet_row IS NULL) AS users_without_source,
      (
        SELECT count(*)::integer FROM users
        WHERE password_hash IS NOT NULL AND password_hash NOT LIKE '$2%'
      ) AS unsafe_passwords,
      (
        SELECT count(*)::integer FROM (
          SELECT lower(username)
          FROM users
          WHERE login_enabled
          GROUP BY lower(username)
          HAVING count(*) > 1
        ) duplicates
      ) AS duplicate_active_logins
  `);
  const row = result.rows[0];
  const problems = [];
  if (row.machines !== machines.length) {
    problems.push(`mesin Spreadsheet ${machines.length}, Neon ${row.machines}`);
  }
  if (row.users !== users.length) {
    problems.push(`pengguna Spreadsheet ${users.length}, Neon ${row.users}`);
  }
  if (row.machines_without_source || row.users_without_source) {
    problems.push(
      `${row.machines_without_source} mesin dan ${row.users_without_source} pengguna tanpa referensi baris sumber`,
    );
  }
  if (row.unsafe_passwords) problems.push(`${row.unsafe_passwords} password tidak aman`);
  if (row.duplicate_active_logins) {
    problems.push(`${row.duplicate_active_logins} username aktif duplikat`);
  }
  if (problems.length) throw new Error(`Verifikasi master gagal: ${problems.join("; ")}.`);
  console.log(
    `Verifikasi master berhasil: ${row.machines} mesin dan ${row.users} pengguna sama dengan Spreadsheet; password tersimpan sebagai hash.`,
  );
  await client.query("ROLLBACK");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
