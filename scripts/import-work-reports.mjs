import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client } = pg;
const SPREADSHEET_ID = "1g1kICI_1SVzTsEzklRSRAMQWpoxieTWmhYDVeeXG-4E";

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

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase("id-ID");
}

function reportDate(value) {
  const source = text(value);
  if (!source) return null;
  const id = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!id) return null;
  const first = Number(id[1]);
  const second = Number(id[2]);
  const month = second > 12 ? first : second;
  const day = second > 12 ? second : first;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = new Date(Date.UTC(Number(id[3]), month - 1, day));
  if (
    candidate.getUTCFullYear() !== Number(id[3]) ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${id[3]}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

function dateTime(value, baseDate) {
  const source = text(value);
  if (!source || !baseDate) return null;
  const match = source.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s+(\d{1,2}):([0-5]\d)(?::([0-5]\d))?/,
  );
  if (!match) return null;
  const [, yearText, monthText, dayText] = baseDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const baseYear = Number(yearText);
  const baseMonth = Number(monthText);
  const baseDay = Number(dayText);
  const first = Number(match[1]);
  const second = Number(match[2]);
  let month;
  let day;
  if (first === baseMonth || second === baseDay) {
    month = first;
    day = second;
  } else if (first === baseDay || second === baseMonth) {
    day = first;
    month = second;
  } else if (first > 12) {
    day = first;
    month = second;
  } else {
    month = first;
    day = second;
  }
  const year = Number(match[3]) || baseYear;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}T${match[4].padStart(
    2,
    "0",
  )}:${match[5]}:${match[6] || "00"}+07:00`;
}

function number(value) {
  let source = text(value);
  if (!source) return null;
  source = source.replace(/\s+/g, "");
  if (source.includes(",")) {
    source = source.replace(/\./g, "").replace(",", ".");
  }
  const result = Number(source);
  return Number.isFinite(result) ? result : null;
}

function boolean(value) {
  return /^(true|ya|yes|1)$/i.test(text(value) || "");
}

function uniqueLookup(rows, keyBuilder) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyBuilder(row);
    const matches = grouped.get(key) || [];
    matches.push(row.id);
    grouped.set(key, matches);
  }
  return (key) => {
    const matches = grouped.get(key) || [];
    return matches.length === 1 ? matches[0] : null;
  };
}

async function insertBatches(client, table, columns, rows) {
  for (let start = 0; start < rows.length; start += 100) {
    const batch = rows.slice(start, start + 100);
    const values = [];
    const tuples = batch.map((row) => {
      const placeholders = row.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`,
      values,
    );
  }
}

const env = await readFile(path.join(process.cwd(), ".env"), "utf8");
const connectionString = readDatabaseUrl(env);
const [reportSource, targetSource] = await Promise.all([
  readSheet("lap_kerja"),
  readSheet("Rekap Jam"),
]);
const reports = reportSource.map((row, index) => ({ row, rowNumber: index + 2 }));
const targets = targetSource.map((row, index) => ({ row, rowNumber: index + 2 }));

const client = new Client({ connectionString });
try {
  await client.connect();
  await client.query("BEGIN");
  const counts = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM work_reports) AS reports,
      (SELECT count(*)::integer FROM kpi_monthly_targets) AS targets
  `);
  if (counts.rows[0].reports || counts.rows[0].targets) {
    throw new Error("Impor dibatalkan karena tabel laporan/KPI sudah berisi data.");
  }

  const machines = (await client.query(
    "SELECT id, category, machine_type, name FROM machines",
  )).rows;
  const parts = (await client.query(
    "SELECT id, category, name, size FROM parts",
  )).rows;
  const machineByFullKey = uniqueLookup(
    machines,
    (row) => `${normalized(row.category)}|${normalized(row.machine_type)}|${normalized(row.name)}`,
  );
  const machineByName = uniqueLookup(machines, (row) => normalized(row.name));
  const partByFullKey = uniqueLookup(
    parts,
    (row) => `${normalized(row.category)}|${normalized(row.name)}|${normalized(row.size)}`,
  );
  const partByNameSize = uniqueLookup(
    parts,
    (row) => `${normalized(row.name)}|${normalized(row.size)}`,
  );

  let invalidDates = 0;
  let unmatchedMachines = 0;
  let unmatchedParts = 0;
  let timeAnomalies = 0;
  let durationAnomalies = 0;
  const reportData = reports.map(({ row, rowNumber }) => {
    const day = reportDate(row.Tanggal);
    if (!day) invalidDates += 1;
    const machineFullKey = `${normalized(row["Kategori Mesin"])}|${normalized(
      row.Jenis,
    )}|${normalized(row["Nama Mesin"])}`;
    const machineId =
      machineByFullKey(machineFullKey) || machineByName(normalized(row["Nama Mesin"]));
    if (text(row["Nama Mesin"]) && !machineId) unmatchedMachines += 1;

    const partName = text(row["Part Nama"]) || text(row["Spare Part"]);
    const partSize =
      text(row["Part Ukuran"]) ||
      text(row["Ukuran Part"]) ||
      text(row["Ukuran Spare Part"]);
    const partCategory = text(row["Part Kategori"]);
    const partId = partName
      ? (partCategory
          ? partByFullKey(
              `${normalized(partCategory)}|${normalized(partName)}|${normalized(partSize)}`,
            )
          : null) || partByNameSize(`${normalized(partName)}|${normalized(partSize)}`)
      : null;
    if (partName && normalized(partName) !== "tidak pakai" && !partId) {
      unmatchedParts += 1;
    }
    const startedAt = dateTime(row["Jam Mulai"], day);
    const finishedAt = dateTime(row["Jam Selesai"], day);
    const totalHours = number(row["Total Jam"]);
    const calculatedHours =
      startedAt && finishedAt
        ? (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 3_600_000
        : null;
    const timeAnomaly = calculatedHours !== null && calculatedHours < 0;
    const durationAnomaly =
      (totalHours !== null && totalHours < 0) ||
      (calculatedHours !== null &&
        totalHours !== null &&
        Math.abs(calculatedHours - totalHours) > 0.06);
    if (timeAnomaly) timeAnomalies += 1;
    if (durationAnomaly) durationAnomalies += 1;
    return [
      machineId,
      partId,
      day,
      text(row.Bagian),
      text(row["Kategori Mesin"]),
      text(row.Jenis),
      text(row["Nama Mesin"]),
      text(row["Jenis Pekerjaan"]),
      text(row["Laporan Pekerjaan"]),
      text(row["Jenis Komponen"]),
      startedAt,
      finishedAt,
      totalHours,
      text(row.Definisi),
      partName,
      partSize,
      text(row.Order),
      text(row["Status Order"]),
      text(row["Nilai Perbaikan"]),
      text(row.Keterangan),
      boolean(row["Is New Machine"]),
      boolean(row["Is New Part"]),
      timeAnomaly,
      durationAnomaly,
      partCategory,
      "lap_kerja",
      rowNumber,
      JSON.stringify(row),
    ];
  });
  if (invalidDates) {
    throw new Error(`Impor dibatalkan: ${invalidDates} tanggal laporan tidak valid.`);
  }

  await insertBatches(
    client,
    "work_reports",
    [
      "machine_id",
      "part_id",
      "report_date",
      "department",
      "machine_category",
      "machine_type",
      "machine_name",
      "job_type",
      "work_description",
      "component_type",
      "started_at",
      "finished_at",
      "total_hours",
      "definition",
      "spare_part_name",
      "spare_part_size",
      "order_type",
      "order_status",
      "repair_rating",
      "notes",
      "is_new_machine",
      "is_new_part",
      "time_anomaly",
      "duration_anomaly",
      "part_category",
      "source_sheet",
      "legacy_sheet_row",
      "legacy_data",
    ],
    reportData,
  );

  const targetRows = targets
    .map(({ row, rowNumber }) => [
      reportDate(row.Bulan),
      number(row.Target) ?? 500,
      rowNumber,
    ])
    .filter((row) => row[0]);
  await insertBatches(
    client,
    "kpi_monthly_targets",
    ["month", "target_hours", "legacy_sheet_row"],
    targetRows,
  );

  await client.query("COMMIT");
  console.log(
    `Impor berhasil: ${reportData.length} laporan kerja dan ${targetRows.length} target KPI.`,
  );
  console.log(
    `Perlu rekonsiliasi: ${unmatchedMachines} laporan tanpa machine_id dan ${unmatchedParts} laporan tanpa part_id yang pasti.`,
  );
  console.log(
    `Anomali sumber: ${timeAnomalies} urutan waktu dan ${durationAnomalies} perbedaan Total Jam.`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
