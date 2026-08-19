import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client } = pg;
const SPREADSHEET_ID = "1Rt9Gss71ajvW6QdqIbv1gH_OiT2l1286-PsudulEu-Y";

function text(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase("id-ID");
}

function parseDate(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const month = second > 12 ? first : second;
  const day = second > 12 ? second : first;
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return null;
  return `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function monthNumber(date) {
  return date ? Number(date.slice(5, 7)) : null;
}

function postgresDate(value) {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return `${value.getFullYear()}-${(value.getMonth() + 1)
    .toString()
    .padStart(2, "0")}-${value.getDate().toString().padStart(2, "0")}`;
}

function percent(value) {
  const source = String(value ?? "").trim().replace("%", "").replace(",", ".");
  const result = Number(source);
  return Number.isFinite(result) ? result / 100 : null;
}

function resultStatus(value) {
  const source = normalized(value);
  if (!source) return null;
  if (source === "bagus" || source === "baik") return "good";
  if (source === "perbaikan" || source === "rusak") return "repair_needed";
  if (source === "x" || source === "-" || source === "tidak berlaku") {
    return "not_applicable";
  }
  return "other";
}

async function readSheet(sheetName) {
  const url = new URL(
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`,
  );
  url.searchParams.set("tqx", "out:csv");
  url.searchParams.set("sheet", sheetName);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Tab ${sheetName} gagal dibaca.`);
  const rows = parse(await response.text(), {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
  });
  return { headers: rows[0] || [], rows: rows.slice(1) };
}

async function insertBatches(client, table, columns, rows, returning = "") {
  const returned = [];
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500);
    const values = [];
    const tuples = batch.map((row) => {
      const placeholders = row.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const result = await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}${returning}`,
      values,
    );
    returned.push(...result.rows);
  }
  return returned;
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

const envContents = await readFile(path.join(process.cwd(), ".env"), "utf8");
const envLine = envContents.split(/\r?\n/).find((line) => /^\s*DATABASE_URL\s*=/.test(line));
if (!envLine) throw new Error("DATABASE_URL tidak ditemukan.");
const connectionString = envLine
  .replace(/^\s*DATABASE_URL\s*=\s*/, "")
  .trim()
  .replace(/^(['"])(.*)\1$/, "$2");

const [plansSource, armadaSource, machineSource, combinedSource, recapSource] =
  await Promise.all(
    ["Rekap Perawatan", "Armada", "Mesin", "r_mesin", "Rekap"].map(readSheet),
  );

function itemDefinitions(source, category) {
  const notesIndex = source.headers.findIndex((header) => normalized(header) === "keterangan");
  return source.headers
    .slice(5, notesIndex < 0 ? source.headers.length : notesIndex)
    .map((name, index) => ({
      category,
      name: text(name),
      sortOrder: index + 1,
      sourceIndex: index + 5,
    }))
    .filter((item) => item.name);
}

const itemDefinitionsByCategory = {
  Armada: itemDefinitions(armadaSource, "Armada"),
  Mesin: itemDefinitions(machineSource, "Mesin"),
};

const rawInspections = [
  ...armadaSource.rows.map((row, index) => ({
    row,
    rowNumber: index + 2,
    sourceSheet: "Armada",
    category: "Armada",
  })),
  ...machineSource.rows.map((row, index) => ({
    row,
    rowNumber: index + 2,
    sourceSheet: "Mesin",
    category: "Mesin",
  })),
].filter((entry) => {
  const date = parseDate(entry.row[0]);
  return date && monthNumber(date) <= 3;
});

const combinedInspections = combinedSource.rows
  .map((row, index) => ({
    row,
    rowNumber: index + 2,
    sourceSheet: "r_mesin",
    category: text(row[1]),
  }))
  .filter((entry) => parseDate(entry.row[0]));

const client = new Client({ connectionString });
try {
  await client.connect();
  await client.query("BEGIN");
  const counts = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM maintenance_plans) AS plans,
      (SELECT count(*)::integer FROM maintenance_inspections) AS inspections,
      (SELECT count(*)::integer FROM maintenance_check_items) AS items,
      (SELECT count(*)::integer FROM maintenance_check_results) AS results,
      (SELECT count(*)::integer FROM maintenance_monthly_targets) AS targets
  `);
  if (Object.values(counts.rows[0]).some(Number)) {
    throw new Error("Impor dibatalkan karena tabel perawatan sudah berisi data.");
  }

  const machines = (await client.query(
    "SELECT id, category, machine_type, name FROM machines",
  )).rows;
  const machineByFullKey = uniqueLookup(
    machines,
    (row) => `${normalized(row.category)}|${normalized(row.machine_type)}|${normalized(row.name)}`,
  );
  const machineByName = uniqueLookup(machines, (row) => normalized(row.name));
  const findMachine = (category, type, name) =>
    machineByFullKey(`${normalized(category)}|${normalized(type)}|${normalized(name)}`) ||
    machineByName(normalized(name));

  const itemRows = Object.values(itemDefinitionsByCategory)
    .flat()
    .map((item) => [item.category, item.name, item.sortOrder]);
  const insertedItems = await insertBatches(
    client,
    "maintenance_check_items",
    ["machine_category", "name", "sort_order"],
    itemRows,
    " RETURNING id, machine_category, name, sort_order",
  );
  const itemIdByKey = new Map(
    insertedItems.map((item) => [
      `${item.machine_category}|${item.sort_order}`,
      item.id,
    ]),
  );

  let unmatchedPlans = 0;
  const planData = plansSource.rows
    .map((row, index) => {
      const plannedOn = parseDate(row[0]);
      if (!plannedOn || !text(row[2])) return null;
      const machineId = findMachine(null, row[1], row[2]);
      if (!machineId) unmatchedPlans += 1;
      return [
        machineId,
        plannedOn,
        text(row[1]),
        text(row[2]),
        text(row[3]),
        text(row[4]),
        "Rekap Perawatan",
        index + 2,
        JSON.stringify({ headers: plansSource.headers, values: row }),
      ];
    })
    .filter(Boolean);
  const insertedPlans = await insertBatches(
    client,
    "maintenance_plans",
    [
      "machine_id",
      "planned_on",
      "machine_type",
      "machine_name",
      "schedule_code",
      "maintenance_type",
      "source_sheet",
      "legacy_sheet_row",
      "legacy_data",
    ],
    planData,
    " RETURNING id, planned_on, machine_type, machine_name, schedule_code",
  );
  const planByKey = uniqueLookup(
    insertedPlans,
    (row) => {
      const plannedOn = postgresDate(row.planned_on);
      return `${plannedOn}|${normalized(row.machine_type)}|${normalized(
        row.machine_name,
      )}|${normalized(row.schedule_code)}`;
    },
  );

  const allInspections = [...rawInspections, ...combinedInspections];
  let unmatchedInspections = 0;
  let unmatchedPlansForInspection = 0;
  const inspectionMetadata = allInspections.map((entry) => {
    const isCombined = entry.sourceSheet === "r_mesin";
    const inspectedOn = parseDate(entry.row[0]);
    const type = text(entry.row[isCombined ? 2 : 1]);
    const name = text(entry.row[isCombined ? 3 : 2]);
    const code = text(entry.row[isCombined ? 4 : 3]);
    const maintenanceType = isCombined
      ? normalized(code) === "m"
        ? "Mingguan"
        : normalized(code) === "b"
          ? "Bulanan"
          : code
      : text(entry.row[4]);
    const machineId = findMachine(entry.category, type, name);
    if (!machineId) unmatchedInspections += 1;
    const planKey = `${inspectedOn}|${normalized(type)}|${normalized(name)}|${normalized(code)}`;
    const planId = planByKey(planKey);
    if (!planId) unmatchedPlansForInspection += 1;
    const headers = isCombined
      ? combinedSource.headers
      : entry.category === "Armada"
        ? armadaSource.headers
        : machineSource.headers;
    const notesIndex = headers.findIndex((header) => normalized(header) === "keterangan");
    return {
      ...entry,
      inspectedOn,
      type,
      name,
      code,
      maintenanceType,
      machineId,
      planId,
      notes: notesIndex >= 0 ? text(entry.row[notesIndex]) : null,
      headers,
    };
  });

  const insertedInspections = await insertBatches(
    client,
    "maintenance_inspections",
    [
      "plan_id",
      "machine_id",
      "inspected_on",
      "machine_category",
      "machine_type",
      "machine_name",
      "schedule_code",
      "maintenance_type",
      "notes",
      "source_sheet",
      "legacy_sheet_row",
      "legacy_data",
    ],
    inspectionMetadata.map((entry) => [
      entry.planId,
      entry.machineId,
      entry.inspectedOn,
      entry.category,
      entry.type,
      entry.name,
      entry.code,
      entry.maintenanceType,
      entry.notes,
      entry.sourceSheet,
      entry.rowNumber,
      JSON.stringify({ headers: entry.headers, values: entry.row }),
    ]),
    " RETURNING id, source_sheet, legacy_sheet_row",
  );
  const inspectionIdBySource = new Map(
    insertedInspections.map((row) => [
      `${row.source_sheet}|${row.legacy_sheet_row}`,
      row.id,
    ]),
  );

  const combinedHeaderIndexes = new Map();
  combinedSource.headers.forEach((header, index) => {
    const key = normalized(header);
    if (!key) return;
    const indexes = combinedHeaderIndexes.get(key) || [];
    indexes.push(index);
    combinedHeaderIndexes.set(key, indexes);
  });
  const checkResults = [];
  for (const entry of inspectionMetadata) {
    const inspectionId = inspectionIdBySource.get(
      `${entry.sourceSheet}|${entry.rowNumber}`,
    );
    for (const item of itemDefinitionsByCategory[entry.category] || []) {
      let valueIndex = item.sourceIndex;
      if (entry.sourceSheet === "r_mesin") {
        const indexes = combinedHeaderIndexes.get(normalized(item.name)) || [];
        valueIndex = entry.category === "Armada" ? indexes.at(-1) : indexes[0];
      }
      const rawStatus = valueIndex === undefined ? null : text(entry.row[valueIndex]);
      const status = resultStatus(rawStatus);
      if (!status) continue;
      const itemId = itemIdByKey.get(`${entry.category}|${item.sortOrder}`);
      checkResults.push([inspectionId, itemId, status, rawStatus]);
    }
  }
  await insertBatches(
    client,
    "maintenance_check_results",
    ["inspection_id", "item_id", "status", "raw_status"],
    checkResults,
  );

  const targetRows = recapSource.rows
    .map((row, index) => [parseDate(row[0]), percent(row[2]) ?? 0.8, 272, index + 2])
    .filter((row) => row[0]);
  await insertBatches(
    client,
    "maintenance_monthly_targets",
    ["month", "target_ratio", "target_inspection_count", "legacy_sheet_row"],
    targetRows,
  );

  await client.query("COMMIT");
  console.log(
    `Impor berhasil: ${planData.length} jadwal, ${inspectionMetadata.length} inspeksi, ${insertedItems.length} item, ${checkResults.length} hasil checklist, ${targetRows.length} target.`,
  );
  console.log(
    `Perlu rekonsiliasi: ${unmatchedPlans} jadwal dan ${unmatchedInspections} inspeksi tanpa machine_id; ${unmatchedPlansForInspection} inspeksi tanpa plan_id.`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
