import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parse } from "csv-parse/sync";
import pg from "pg";

const { Client } = pg;
const SPREADSHEET_ID = "1nbmqEBQWJMy-1CYSGtIiTHDXgbXR485xe1Np-THWR9U";

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

function identity(category, name, size) {
  return [category, name, size]
    .map((value) => String(value ?? "").trim().toLocaleLowerCase("id-ID"))
    .join("|");
}

function date(value) {
  const source = text(value);
  if (!source) return null;
  const id = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (id) {
    return `${id[3]}-${id[2].padStart(2, "0")}-${id[1].padStart(2, "0")}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(source) ? source : null;
}

function number(value) {
  let source = text(value);
  if (!source) return null;
  const match = source.replace(/\s+/g, "").match(/-?[0-9.,]+/);
  if (!match) return null;
  source = match[0];
  if (source.includes(",")) {
    source = source.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(source)) {
    source = source.replace(/\./g, "");
  }
  const result = Number(source);
  return Number.isFinite(result) ? result : null;
}

async function insertBatches(client, table, columns, rows, returning = "") {
  const returned = [];
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
    const result = await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}${returning}`,
      values,
    );
    returned.push(...result.rows);
  }
  return returned;
}

const env = await readFile(path.join(process.cwd(), ".env"), "utf8");
const connectionString = readDatabaseUrl(env);
const [partSource, stockSource, bonSource, usageSource, historySource] =
  await Promise.all(
    ["Part", "Stok", "Bon", "Penggunaan", "Sheet3"].map(readSheet),
  );

const partRows = partSource.filter((row) => text(row.Nama));
const stockRows = stockSource.filter((row) => text(row.Nama));
const bonRows = bonSource.filter((row) => text(row.Nama));
const historyRows = historySource.map((row, index) => ({
  row,
  rowNumber: index + 2,
}));
const usageRows = usageSource.filter((row) => text(row.Nama));
const replaceRequests = process.argv.includes("--replace-requests");

const client = new Client({ connectionString });
try {
  await client.connect();
  await client.query("BEGIN");

  const counts = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM parts) AS parts,
      (SELECT count(*)::integer FROM inventory_balances) AS balances,
      (SELECT count(*)::integer FROM part_requests) AS requests,
      (SELECT count(*)::integer FROM stock_movements) AS movements
  `);
  const existing = counts.rows[0];
  let insertedParts;
  if (existing.parts === 0) {
    insertedParts = await insertBatches(
      client,
      "parts",
      [
        "category",
        "name",
        "size",
        "unit",
        "component_type",
        "identity_key",
        "legacy_sheet_row",
        "legacy_data",
      ],
      partRows.map((row, index) => [
        text(row.Kategori),
        text(row.Nama),
        text(row.Ukuran),
        text(row.Satuan),
        text(row["Jenis Komponen"]),
        identity(row.Kategori, row.Nama, row.Ukuran),
        index + 2,
        JSON.stringify(row),
      ]),
      " RETURNING id, identity_key",
    );
  } else if (existing.parts === partRows.length) {
    insertedParts = (await client.query("SELECT id, identity_key FROM parts")).rows;
  } else {
    throw new Error("Jumlah part di Neon berbeda dari sumber; impor dibatalkan.");
  }

  const partsByIdentity = new Map();
  for (const part of insertedParts) {
    const matches = partsByIdentity.get(part.identity_key) || [];
    matches.push(part.id);
    partsByIdentity.set(part.identity_key, matches);
  }
  const certainPartId = (category, name, size) => {
    const matches = partsByIdentity.get(identity(category, name, size)) || [];
    return matches.length === 1 ? matches[0] : null;
  };

  const balanceData = stockRows.map((row, index) => [
    certainPartId(row.Kategori, row.Nama, row.Ukuran),
    text(row.Kategori),
    text(row.Nama),
    text(row.Ukuran),
    number(row.Masuk),
    number(row.Keluar),
    number(row.Stok),
    text(row.Satuan),
    index + 2,
    JSON.stringify(row),
  ]);
  if (existing.balances === 0) {
    await insertBatches(
      client,
      "inventory_balances",
      [
        "part_id",
        "category",
        "part_name",
        "part_size",
        "incoming_quantity",
        "outgoing_quantity",
        "current_quantity",
        "unit",
        "legacy_sheet_row",
        "legacy_data",
      ],
      balanceData,
    );
  } else if (existing.balances !== stockRows.length) {
    throw new Error("Jumlah saldo stok di Neon berbeda dari sumber; impor dibatalkan.");
  }

  const requestData = [
    ...bonRows.map((row, index) => [
      certainPartId(row.Kategori, row.Nama, row.Ukuran),
      date(row["Tgl Pesan"]),
      text(row.Kategori),
      text(row.Nama),
      text(row.Ukuran),
      null,
      text(row.Kegunaan),
      number(row["Jml Pesan"]),
      text(row["Jml Pesan"]),
      text(row.Bagian),
      text(row.Pemesan),
      text(row.Mesin),
      date(row["Tgl Datang"]),
      number(row["Jml Datang"]),
      text(row["Jml Datang"]),
      text(row.Status) || "Open",
      "Bon",
      index + 2,
      JSON.stringify(row),
    ]),
    ...historyRows.map(({ row, rowNumber }) => [
      certainPartId(row["NAMA PART"], row["JENIS PART"], row.UKURAN),
      date(row["TGL PESAN"]),
      text(row["NAMA PART"]),
      text(row["JENIS PART"]),
      text(row.UKURAN),
      text(row.KETERANGAN),
      text(row.KEGUNAAN),
      number(row["JML PESAN"]),
      text(row["JML PESAN"]),
      text(row.BAGIAN),
      text(row.PEMESAN),
      text(row.MESIN),
      date(row["TGL DATANG"]),
      number(row["JML DATANG"]),
      text(row["JML DATANG"]),
      text(row.STATUS) || "Open",
      "Sheet3",
      rowNumber,
      JSON.stringify(row),
    ]),
  ];
  if (existing.requests && !replaceRequests) {
    throw new Error(
      "Data order part sudah ada. Gunakan --replace-requests untuk mengganti hasil impor.",
    );
  }
  if (existing.requests && replaceRequests) {
    await client.query("DELETE FROM part_requests");
  }
  await insertBatches(
    client,
    "part_requests",
    [
      "part_id",
      "requested_on",
      "category",
      "part_name",
      "part_size",
      "notes",
      "purpose",
      "requested_quantity",
      "requested_quantity_text",
      "department",
      "requester_name",
      "machine_name",
      "arrived_on",
      "arrived_quantity",
      "arrived_quantity_text",
      "status",
      "source_sheet",
      "legacy_sheet_row",
      "legacy_data",
    ],
    requestData,
  );

  const movementData = usageRows.map((row, index) => [
    certainPartId(row.Kategori, row.Nama, row.Ukuran),
    date(row.Tanggal),
    text(row.Kategori),
    text(row.Nama),
    text(row.Jenis),
    text(row.Ukuran),
    number(row.Jumlah),
    text(row.Jumlah),
    text(row.Satuan),
    text(row.Digunakan),
    text(row.Mesin),
    text(row.Pengguna),
    text(row.Bagian),
    text(row.Keterangan),
    index + 2,
    JSON.stringify(row),
  ]);
  if (existing.movements === 0) {
    await insertBatches(
      client,
      "stock_movements",
      [
        "part_id",
        "occurred_on",
        "category",
        "part_name",
        "part_type",
        "part_size",
        "quantity",
        "quantity_text",
        "unit",
        "used_for",
        "machine_name",
        "user_name",
        "department",
        "notes",
        "legacy_sheet_row",
        "legacy_data",
      ],
      movementData,
    );
  } else if (existing.movements !== usageRows.length) {
    throw new Error("Jumlah penggunaan stok berbeda dari sumber; impor dibatalkan.");
  }

  await client.query("COMMIT");
  const unmatchedBalances = balanceData.filter((row) => !row[0]).length;
  const unmatchedRequests = requestData.filter((row) => !row[0]).length;
  console.log(
    `Impor berhasil: ${partRows.length} part, ${stockRows.length} saldo stok, ${requestData.length} order part, ${usageRows.length} penggunaan.`,
  );
  console.log(
    `Perlu rekonsiliasi: ${unmatchedBalances} saldo stok dan ${unmatchedRequests} order belum memiliki relasi part_id yang pasti.`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
