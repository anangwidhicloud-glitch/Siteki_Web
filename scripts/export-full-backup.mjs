import pg from "pg";
import { readFile, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import process from "node:process";

function formatSqlValue(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (typeof val === "object") return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function main() {
  const envContents = await readFile(path.join(process.cwd(), ".env"), "utf8");
  const envLine = envContents.split(/\r?\n/).find((line) => /^\s*DATABASE_URL\s*=/.test(line));
  if (!envLine) throw new Error("DATABASE_URL tidak ditemukan di file .env.");
  const connectionString = envLine
    .replace(/^\s*DATABASE_URL\s*=\s*/, "")
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");

  const client = new pg.Client({ connectionString });
  await client.connect();
  console.log("Terhubung ke database NeonDB...");

  // Dapatkan daftar semua tabel pengguna di schema 'public'
  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const tables = tablesRes.rows.map(r => r.table_name);

  const backupDir = path.join(process.cwd(), "backups");
  await mkdir(backupDir, { recursive: true });

  const now = new Date();
  const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;

  const jsonBackupPath = path.join(backupDir, `siteki_backup_${timestamp}.json`);
  const sqlBackupPath = path.join(backupDir, `siteki_backup_${timestamp}.sql`);

  const sqlStream = createWriteStream(sqlBackupPath, { encoding: "utf8" });
  const jsonStream = createWriteStream(jsonBackupPath, { encoding: "utf8" });

  sqlStream.write(`-- ========================================================\n`);
  sqlStream.write(`-- SiTeki Database Full SQL Backup\n`);
  sqlStream.write(`-- Export Date: ${now.toISOString()}\n`);
  sqlStream.write(`-- Total Tables: ${tables.length}\n`);
  sqlStream.write(`-- ========================================================\n\n`);
  sqlStream.write(`SET client_encoding = 'UTF8';\n`);
  sqlStream.write(`SET standard_conforming_strings = on;\n\n`);

  jsonStream.write(`{\n  "exported_at": "${now.toISOString()}",\n  "database": "neondb",\n  "total_tables": ${tables.length},\n  "tables": {\n`);

  console.log(`Mulai mengekspor ${tables.length} tabel...`);

  let grandTotalRows = 0;

  for (let tIdx = 0; tIdx < tables.length; tIdx++) {
    const table = tables[tIdx];
    const isLastTable = tIdx === tables.length - 1;

    // Hitung total baris
    const countRes = await client.query(`SELECT COUNT(*) as cnt FROM "${table}"`);
    const totalCount = parseInt(countRes.rows[0].cnt, 10);
    grandTotalRows += totalCount;

    console.log(`- [${tIdx + 1}/${tables.length}] Tabel '${table}': ${totalCount} baris`);

    jsonStream.write(`    "${table}": [\n`);

    if (totalCount > 0) {
      sqlStream.write(`-- Data untuk tabel "${table}" (${totalCount} baris)\n`);
      sqlStream.write(`TRUNCATE TABLE "${table}" CASCADE;\n`);

      const PAGE_SIZE = 2500;
      let offset = 0;
      let isFirstRow = true;

      while (offset < totalCount) {
        const rowsRes = await client.query(`SELECT * FROM "${table}" LIMIT ${PAGE_SIZE} OFFSET ${offset}`);
        const rows = rowsRes.rows;
        if (rows.length === 0) break;

        const columns = Object.keys(rows[0]);
        const colNames = columns.map(c => `"${c}"`).join(", ");

        // Tulis ke SQL
        const INSERT_CHUNK = 250;
        for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
          const chunk = rows.slice(i, i + INSERT_CHUNK);
          sqlStream.write(`INSERT INTO "${table}" (${colNames}) VALUES\n`);
          const valueLines = chunk.map(row => {
            const vals = columns.map(col => formatSqlValue(row[col]));
            return `  (${vals.join(", ")})`;
          });
          sqlStream.write(valueLines.join(",\n") + `;\n\n`);
        }

        // Tulis ke JSON
        for (const row of rows) {
          if (!isFirstRow) jsonStream.write(",\n");
          jsonStream.write("      " + JSON.stringify(row));
          isFirstRow = false;
        }

        offset += rows.length;
      }
    }

    jsonStream.write(`\n    ]${isLastTable ? "" : ","}\n`);
  }

  jsonStream.write(`  }\n}\n`);

  await new Promise(resolve => sqlStream.end(resolve));
  await new Promise(resolve => jsonStream.end(resolve));

  await client.end();

  console.log("\n========================================================");
  console.log(`✅ BACKUP BERHASIL DISELESAIKAN!`);
  console.log(`Total Tabel: ${tables.length}`);
  console.log(`Total Baris Data: ${grandTotalRows.toLocaleString("id-ID")}`);
  console.log(`File SQL: ${sqlBackupPath}`);
  console.log(`File JSON: ${jsonBackupPath}`);
  console.log("========================================================");
}

main().catch(error => {
  console.error("Gagal melakukan backup:", error);
  process.exitCode = 1;
});
