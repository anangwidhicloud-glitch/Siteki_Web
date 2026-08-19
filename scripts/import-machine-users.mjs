import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import bcrypt from "bcryptjs";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client } = pg;
const SPREADSHEET_ID = "1XnjbaYXuyYIgEsf9mcxsHSAZWQxgNebZI4p_Wk8H1Cc";

function readDatabaseUrl(contents) {
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

function text(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function date(value) {
  const source = text(value);
  if (!source) return null;
  const id = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (id) {
    return `${id[3]}-${id[2].padStart(2, "0")}-${id[1].padStart(2, "0")}`;
  }
  const iso = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return iso ? source : null;
}

function money(value) {
  let source = text(value);
  if (!source) return null;
  source = source.replace(/[^0-9,.-]/g, "");
  if (!source) return null;
  if (source.includes(",")) {
    source = source.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(source)) {
    source = source.replace(/\./g, "");
  }
  const result = Number(source);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function withoutPassword(row) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => key.toLowerCase() !== "password"),
  );
}

const env = await readFile(path.join(process.cwd(), ".env"), "utf8");
const connectionString = readDatabaseUrl(env);
const [machineRows, userRows] = await Promise.all([
  readSheet("mesin"),
  readSheet("User"),
]);

const machines = machineRows.filter((row) => text(row.Nama));
const users = userRows.filter((row) => text(row.username));
const activeUsernames = new Set();
let disabledDuplicateLogins = 0;

const client = new Client({ connectionString });
try {
  await client.connect();
  await client.query("BEGIN");

  const counts = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM machines) AS machines,
      (SELECT count(*)::integer FROM users) AS users
  `);
  if (counts.rows[0].machines || counts.rows[0].users) {
    throw new Error(
      "Impor dibatalkan karena tabel machines atau users sudah berisi data.",
    );
  }

  for (const [index, row] of machines.entries()) {
    await client.query(
      `INSERT INTO machines
        (category, machine_type, name, legacy_sheet_row, legacy_data)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        text(row.Kategori),
        text(row.Jenis),
        text(row.Nama),
        index + 2,
        JSON.stringify(row),
      ],
    );
  }

  for (const [index, row] of users.entries()) {
    const sourcePassword = text(row.password);
    const passwordHash = sourcePassword ? await bcrypt.hash(sourcePassword, 12) : null;
    const normalizedUsername = text(row.username).toLowerCase();
    const loginEnabled = !activeUsernames.has(normalizedUsername);
    if (loginEnabled) activeUsernames.add(normalizedUsername);
    else disabledDuplicateLogins += 1;
    await client.query(
      `INSERT INTO users (
        username, password_hash, login_enabled, full_name, role, function_name,
        employee_number, job_title, department, team, joined_on,
        tenure_display, last_contract_on, education, major,
        employment_status, salary_status, allowance, birth_place,
        birth_date, age_display, address, phone, emergency_phone,
        base_salary, daily_salary, notes, legacy_sheet_row, legacy_data
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29::jsonb
      )`,
      [
        text(row.username),
        passwordHash,
        loginEnabled,
        text(row.nama) || text(row.username),
        text(row.role) || "Lainnya",
        text(row.fungsi),
        text(row.NIK),
        text(row.Jabatan),
        text(row.Bagian),
        text(row.Regu),
        date(row.Masuk),
        text(row["Lama Kerja"]),
        date(row["Kontrak Terakhir"]),
        text(row.Pendidikan),
        text(row.Jurusan),
        text(row.Pegawai),
        text(row.Status),
        text(row.Tunjangan),
        text(row.T_Lahir),
        date(row.Tgl_Lahir),
        text(row["#REF!"]),
        text(row.Alamat),
        text(row["No. Telp"]),
        text(row["No. Telp Darurat"]),
        money(row["Gaji Pokok"]),
        money(row["Gaji Harian"]),
        text(row.Keterangan),
        index + 2,
        JSON.stringify(withoutPassword(row)),
      ],
    );
  }

  await client.query("COMMIT");
  console.log(
    `Impor berhasil: ${machines.length} mesin dan ${users.length} pengguna; ${disabledDuplicateLogins} login duplikat dinonaktifkan. Password disimpan sebagai hash bcrypt.`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
