import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function readSourceDatabaseUrl(envContents) {
  const line = envContents
    .split(/\r?\n/)
    .find((entry) => /^\s*DATABASE_URL\s*=/.test(entry));
  if (!line) throw new Error("DATABASE_URL sumber tidak ditemukan dalam file .env.");

  return line
    .replace(/^\s*DATABASE_URL\s*=\s*/, "")
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");
}

async function main() {
  const targetUrl = process.argv[2] || process.env.TARGET_DATABASE_URL;

  if (!targetUrl) {
    console.error("❌ Error: Target DATABASE_URL tidak diberikan.");
    console.error("\nPenggunaan:");
    console.error('  node scripts/clone-to-server.mjs "postgres://postgres:PASSWORD@100.103.125.96:5432/postgres?sslmode=disable"\n');
    console.error("Atau tambahkan TARGET_DATABASE_URL di file .env terlebih dahulu.");
    process.exit(1);
  }

  const envContents = await readFile(path.join(root, ".env"), "utf8");
  const sourceUrl = readSourceDatabaseUrl(envContents);

  console.log("========================================================");
  console.log("🚀 MEMULAI MIGRASI DATABASE NEONDB -> POSTGRES SERVER LOKAL");
  console.log("========================================================");

  const sourceClient = new pg.Client({ connectionString: sourceUrl });
  const targetClient = new pg.Client({ connectionString: targetUrl });

  try {
    console.log("1. Menghubungkan ke NeonDB (Sumber)...");
    await sourceClient.connect();
    console.log("   ✅ Terhubung ke NeonDB.");

    console.log("2. Menghubungkan ke Server PostgreSQL Lokal (Target)...");
    await targetClient.connect();
    console.log("   ✅ Terhubung ke Server Target.");
  } catch (err) {
    console.error("❌ Gagal terhubung ke database:", err.message);
    process.exit(1);
  }

  try {
    // 1. Eksekusi migrasi skema tabel di target
    console.log("\n3. Menerapkan skema tabel (migrations) di server target...");
    const migrationDirectory = path.join(root, "database", "migrations");
    const migrationFiles = (await readdir(migrationDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const file of migrationFiles) {
      process.stdout.write(`   - Menjalankan ${file}... `);
      const sql = await readFile(path.join(migrationDirectory, file), "utf8");
      try {
        await targetClient.query(sql);
        console.log("OK");
      } catch (mErr) {
        // Abaikan jika sudah ada atau notice non-fatal
        console.log(`(Info: ${mErr.message.split("\n")[0]})`);
      }
    }

    // 2. Dapatkan daftar seluruh tabel di source
    const tablesRes = await sourceClient.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const tables = tablesRes.rows.map((r) => r.table_name);
    console.log(`\n4. Ditemukan ${tables.length} tabel untuk disinkronkan.\n`);

    // Kosongkan seluruh tabel di target sekaligus di awal
    const truncateList = tables.map((t) => `"${t}"`).join(", ");
    await targetClient.query(`TRUNCATE TABLE ${truncateList} CASCADE;`);

    // Nonaktifkan trigger dan foreign keys selama proses bulk copy
    await targetClient.query("SET session_replication_role = 'replica';");

    const stats = [];
    let grandTotalSource = 0;

    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      process.stdout.write(`   [${i + 1}/${tables.length}] Menyalin tabel "${table}"... `);

      // Ambil definisi kolom
      const colsRes = await sourceClient.query(`
        SELECT column_name, data_type, udt_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [table]);
      const colNames = colsRes.rows.map((c) => `"${c.column_name}"`);

      if (colNames.length === 0) {
        console.log("Lewati (tidak ada kolom)");
        continue;
      }

      // Ambil data dari source
      const selectRes = await sourceClient.query(`SELECT * FROM "${table}";`);
      const rows = selectRes.rows;
      grandTotalSource += rows.length;

      if (rows.length === 0) {
        console.log(`Selesai (0 baris)`);
        continue;
      }

      // Insert dalam batch agar cepat dan hemat memori
      const BATCH_SIZE = 500;
      for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        const batch = rows.slice(offset, offset + BATCH_SIZE);
        const valuePlaceholders = [];
        const flatValues = [];
        let valIndex = 1;

        for (const row of batch) {
          const rowPlaceholders = [];
          for (const col of colsRes.rows) {
            const val = row[col.column_name];
            if (val === null || val === undefined) {
              rowPlaceholders.push("NULL");
            } else if (col.udt_name === "jsonb" || col.udt_name === "json") {
              rowPlaceholders.push(`$${valIndex}::jsonb`);
              flatValues.push(typeof val === "object" ? JSON.stringify(val) : String(val));
              valIndex++;
            } else {
              rowPlaceholders.push(`$${valIndex}`);
              flatValues.push(val);
              valIndex++;
            }
          }
          valuePlaceholders.push(`(${rowPlaceholders.join(", ")})`);
        }

        const insertQuery = `
          INSERT INTO "${table}" (${colNames.join(", ")})
          VALUES ${valuePlaceholders.join(",\n")}
        `;
        await targetClient.query(insertQuery, flatValues);
      }

      console.log(`Disalin (${rows.length} baris)`);
    }

    // Aktifkan kembali trigger dan foreign keys
    await targetClient.query("SET session_replication_role = 'origin';");

    // Verifikasi seluruh tabel di akhir setelah semua selesai disalin
    console.log("\nMemverifikasi seluruh tabel target...");
    let grandTotalTarget = 0;
    for (const table of tables) {
      const srcCntRes = await sourceClient.query(`SELECT count(*)::int AS cnt FROM "${table}";`);
      const tgtCntRes = await targetClient.query(`SELECT count(*)::int AS cnt FROM "${table}";`);
      const sCnt = srcCntRes.rows[0].cnt;
      const tCnt = tgtCntRes.rows[0].cnt;
      grandTotalTarget += tCnt;
      const isMatch = sCnt === tCnt;
      stats.push({ table, source: sCnt, target: tCnt, status: isMatch ? "MATCH" : "MISMATCH" });
    }

    // Aktifkan kembali trigger dan foreign keys
    await targetClient.query("SET session_replication_role = 'origin';");

    // Sinkronkan sequences jika ada auto-increment ID
    const seqRes = await targetClient.query(`
      SELECT sequence_name 
      FROM information_schema.sequences 
      WHERE sequence_schema = 'public';
    `);
    for (const seq of seqRes.rows) {
      try {
        await targetClient.query(`SELECT setval('${seq.sequence_name}', (SELECT max(id) FROM "${seq.sequence_name.replace(/_id_seq$/, '')}"));`);
      } catch {
        // Abaikan jika sequence tidak mengikuti penamaan default
      }
    }

    console.log("\n========================================================");
    console.log("🎉 HASIL MIGRASI KE SERVER LOKAL");
    console.log("========================================================");
    console.log(`Total Tabel   : ${tables.length}`);
    console.log(`Total Baris Sumber (NeonDB) : ${grandTotalSource.toLocaleString("id-ID")}`);
    console.log(`Total Baris Target (Server) : ${grandTotalTarget.toLocaleString("id-ID")}`);

    const mismatches = stats.filter((s) => s.status !== "MATCH");
    if (mismatches.length === 0) {
      console.log("Status Paritas: 100% COCOK & LENGKAP ✅");
    } else {
      console.warn("Terdapat tabel dengan selisih baris:", mismatches);
    }
    console.log("========================================================");

  } catch (error) {
    console.error("❌ Terjadi kesalahan saat migrasi:", error);
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

main();
