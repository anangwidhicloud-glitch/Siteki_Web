import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

async function main() {
  const envContents = await readFile(path.join(root, ".env"), "utf8");
  const envLine = envContents.split(/\r?\n/).find((line) => /^\s*DATABASE_URL\s*=/.test(line));
  if (!envLine) throw new Error("DATABASE_URL tidak ditemukan di .env");
  const connectionString = envLine
    .replace(/^\s*DATABASE_URL\s*=\s*/, "")
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");

  console.log("========================================================");
  console.log("🔄 MEMULIHKAN FULL DATA KE DATABASE SERVER");
  console.log("========================================================");

  // Cari file backup JSON terbaru di folder backups
  const backupDir = path.join(root, "backups");
  const files = (await readdir(backupDir)).filter((f) => f.startsWith("siteki_backup_") && f.endsWith(".json")).sort();
  if (files.length === 0) {
    throw new Error("Tidak ditemukan file backup JSON di folder backups/");
  }
  const latestBackupFile = path.join(backupDir, files[files.length - 1]);
  console.log(`Menggunakan backup: ${files[files.length - 1]}`);

  const backupData = JSON.parse(await readFile(latestBackupFile, "utf8"));
  const tableNames = Object.keys(backupData.tables);

  const client = new pg.Client({ connectionString });
  await client.connect();
  console.log("✅ Terhubung ke database target di .env");

  try {
    // 1. Kosongkan semua tabel sekaligus
    console.log("\n1. Mengosongkan seluruh tabel di database target...");
    const truncateList = tableNames.map((t) => `"${t}"`).join(", ");
    await client.query(`TRUNCATE TABLE ${truncateList} CASCADE;`);
    console.log("   ✅ Seluruh tabel berhasil dikosongkan.");

    // 2. Nonaktifkan pemeriksaan FK dan trigger selama restore
    await client.query("SET session_replication_role = 'replica';");

    console.log("\n2. Mengisi data ke dalam tabel...");
    let totalInserted = 0;

    for (let i = 0; i < tableNames.length; i++) {
      const table = tableNames[i];
      const rows = backupData.tables[table] || [];
      process.stdout.write(`   [${i + 1}/${tableNames.length}] Tabel "${table}"... `);

      if (rows.length === 0) {
        console.log("0 baris (kosong)");
        continue;
      }

      // Dapatkan kolom dari skema tabel di target
      const colsRes = await client.query(`
        SELECT column_name, data_type, udt_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [table]);
      const columns = colsRes.rows;
      const colNames = columns.map((c) => `"${c.column_name}"`);

      const BATCH_SIZE = 500;
      for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
        const batch = rows.slice(offset, offset + BATCH_SIZE);
        const valuePlaceholders = [];
        const flatValues = [];
        let valIndex = 1;

        for (const row of batch) {
          const rowPlaceholders = [];
          for (const col of columns) {
            let val = row[col.column_name];
            if (val === null || val === undefined) {
              rowPlaceholders.push("NULL");
            } else if (col.data_type === "date") {
              const d = new Date(val);
              const formattedDate = isNaN(d.getTime())
                ? String(val).slice(0, 10)
                : d.toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
              rowPlaceholders.push(`$${valIndex}::date`);
              flatValues.push(formattedDate);
              valIndex++;
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
        await client.query(insertQuery, flatValues);
      }

      totalInserted += rows.length;
      console.log(`Dimasukkan ${rows.length.toLocaleString("id-ID")} baris ✅`);
    }

    // 3. Aktifkan kembali trigger dan FK
    await client.query("SET session_replication_role = 'origin';");

    // 4. Sinkronkan sequence ID
    const seqRes = await client.query(`
      SELECT sequence_name 
      FROM information_schema.sequences 
      WHERE sequence_schema = 'public';
    `);
    for (const seq of seqRes.rows) {
      try {
        const tbl = seq.sequence_name.replace(/_id_seq$/, "");
        await client.query(`SELECT setval('${seq.sequence_name}', COALESCE((SELECT max(id) FROM "${tbl}"), 1));`);
      } catch {}
    }

    // 5. Verifikasi jumlah baris akhir
    console.log("\n========================================================");
    console.log("3. Verifikasi Jumlah Baris Akhir di Database Server:");
    console.log("========================================================");
    let verifiedTotal = 0;
    let mismatchCount = 0;

    for (const table of tableNames) {
      const cntRes = await client.query(`SELECT count(*)::int AS cnt FROM "${table}";`);
      const targetCount = cntRes.rows[0].cnt;
      const expectedCount = (backupData.tables[table] || []).length;
      verifiedTotal += targetCount;

      const isMatch = targetCount === expectedCount;
      if (!isMatch) mismatchCount++;
      if (expectedCount > 0 || !isMatch) {
        console.log(`- ${table.padEnd(35)} : ${targetCount.toLocaleString("id-ID").padStart(8)} baris ${isMatch ? "✅" : "⚠️ MISMATCH"}`);
      }
    }

    console.log("========================================================");
    console.log(`Total Baris di Server: ${verifiedTotal.toLocaleString("id-ID")}`);
    if (mismatchCount === 0) {
      console.log("✅ PARITAS 100% SEMPURNA! SELURUH DATA LENGKAP DI SERVER.");
    } else {
      console.warn(`⚠️ Ada ${mismatchCount} tabel yang berbeda.`);
    }
    console.log("========================================================");

  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("❌ Error saat restore:", err);
  process.exit(1);
});
