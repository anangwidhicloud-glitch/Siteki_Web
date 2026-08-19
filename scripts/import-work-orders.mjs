import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const SOURCE_URL = "https://script.google.com/macros/s/AKfycbzbmKFheI55ccsJ_kLdOzy6VIdGpgKIy2s9pljrIM8sNbgJ_RLywnzF-Q2sJTslVQU/exec?action=getAllOrders";

const text = (value) => {
  const result = String(value ?? "").trim();
  return result || null;
};
const normalized = (value) => String(value ?? "").trim().toLocaleLowerCase("id-ID");

function dateTime(value) {
  const source = text(value);
  if (!source) return null;
  const match = source.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const months = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const month = months[match[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  const day = Number(match[1]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    hour > 23 || minute > 59 ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`;
}

const envContents = await readFile(path.join(process.cwd(), ".env"), "utf8");
const envLine = envContents.split(/\r?\n/).find((line) => /^\s*DATABASE_URL\s*=/.test(line));
if (!envLine) throw new Error("DATABASE_URL tidak ditemukan.");
const connectionString = envLine
  .replace(/^\s*DATABASE_URL\s*=\s*/, "")
  .trim()
  .replace(/^(['"])(.*)\1$/, "$2");

const response = await fetch(SOURCE_URL);
if (!response.ok) throw new Error(`Endpoint Order Kerja gagal dibaca (HTTP ${response.status}).`);
const rows = await response.json();
if (!Array.isArray(rows)) throw new Error("Respons Order Kerja bukan array.");

const client = new Client({ connectionString });
try {
  await client.connect();
  await client.query("BEGIN");
  const existing = await client.query("SELECT count(*)::integer AS count FROM work_orders");
  if (existing.rows[0].count) throw new Error("Impor dibatalkan karena work_orders sudah berisi data.");

  const machineRows = (await client.query("SELECT id, name FROM machines")).rows;
  const machinesByName = new Map();
  for (const machine of machineRows) {
    const key = normalized(machine.name);
    const matches = machinesByName.get(key) || [];
    matches.push(machine.id);
    machinesByName.set(key, matches);
  }

  const rowIndexes = new Set();
  let invalidDates = 0;
  let unmatchedMachines = 0;
  const values = [];
  const tuples = rows.map((row) => {
    const legacyRow = Number(row.rowIndex);
    if (!Number.isInteger(legacyRow) || rowIndexes.has(legacyRow)) {
      throw new Error(`Nomor baris Order Kerja tidak valid/duplikat: ${row.rowIndex}`);
    }
    rowIndexes.add(legacyRow);
    const orderedAt = dateTime(row.tanggal);
    if (!orderedAt) invalidDates += 1;
    const machineMatches = machinesByName.get(normalized(row.namaMesin)) || [];
    const machineId = machineMatches.length === 1 ? machineMatches[0] : null;
    if (!machineId) unmatchedMachines += 1;
    const rowValues = [
      orderedAt,
      text(row.bagianOrder),
      text(row.namaOrder),
      text(row.bagianTujuan),
      text(row.kategoriMesin),
      text(row.jenis),
      text(row.namaMesin),
      text(row.jenisPekerjaan),
      text(row.kerusakan),
      text(row.urgensi),
      text(row.status) || "Open",
      legacyRow,
      machineId,
      "Order API",
      JSON.stringify(row),
    ];
    const placeholders = rowValues.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  if (invalidDates) throw new Error(`${invalidDates} tanggal Order Kerja tidak valid.`);
  if (tuples.length) {
    await client.query(
      `INSERT INTO work_orders (
        ordered_at, requester_department, requester_name, assigned_department,
        machine_category, machine_type, machine_name, job_type,
        problem_description, urgency, order_status, legacy_sheet_row,
        machine_id, source_name, legacy_data
      ) VALUES ${tuples.join(", ")}`,
      values,
    );
  }
  await client.query("COMMIT");
  console.log(`Impor Order Kerja berhasil: ${rows.length} order, ${unmatchedMachines} tanpa relasi mesin.`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
