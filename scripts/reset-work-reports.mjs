import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const BACKUP_DIR = path.resolve(process.cwd(), ".deploy-backups", "work-reports-reset-20260815");
const DATA_FILE = path.join(BACKUP_DIR, "work-reports.json.gz");
const MANIFEST_FILE = path.join(BACKUP_DIR, "manifest.json");
const CONFIRMATION = "DELETE_WORK_REPORTS_ONLY";

function databaseUrl(contents) {
  const line = contents.split(/\r?\n/).find(value => /^\s*DATABASE_URL\s*=/.test(value));
  if (!line) throw new Error("DATABASE_URL tidak ditemukan.");
  return line.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^(['"])(.*)\1$/, "$2");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function counts(client) {
  const result = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM work_reports) AS work_reports,
      (SELECT count(*)::integer FROM kpi_monthly_targets) AS kpi_targets,
      (SELECT count(*)::integer FROM work_orders) AS work_orders,
      (SELECT count(*)::integer FROM maintenance_plans) AS maintenance_plans,
      (SELECT count(*)::integer FROM maintenance_inspections) AS maintenance_inspections,
      (SELECT count(*)::integer FROM overtime_entries) AS overtime_entries,
      (SELECT count(*)::integer FROM electricity_checks) AS electricity_checks,
      (SELECT count(*)::integer FROM inventory_balances) AS inventory_balances,
      (SELECT count(*)::integer FROM machines) AS machines,
      (SELECT count(*)::integer FROM parts) AS parts,
      (SELECT count(*)::integer FROM users) AS users
  `);
  return result.rows[0];
}

const env = await readFile(path.resolve(process.cwd(), ".env"), "utf8");
const client = new Client({ connectionString: databaseUrl(env) });
await client.connect();

try {
  if (process.argv.includes("--backup")) {
    const before = await counts(client);
    if (!before.work_reports) throw new Error("Data laporan kerja kosong; backup dibatalkan.");
    const reports = await client.query("SELECT * FROM work_reports ORDER BY report_date,id");
    const payload = Buffer.from(JSON.stringify({
      backedUpAt: new Date().toISOString(),
      counts: before,
      workReports: reports.rows,
    }));
    const compressed = gzipSync(payload, { level: 9 });
    const manifest = {
      createdAt: new Date().toISOString(),
      file: path.basename(DATA_FILE),
      sha256: sha256(compressed),
      compressedBytes: compressed.length,
      counts: before,
    };
    await mkdir(BACKUP_DIR, { recursive: true });
    await writeFile(DATA_FILE, compressed);
    await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
    const restored = JSON.parse(gunzipSync(await readFile(DATA_FILE)).toString("utf8"));
    if (restored.workReports.length !== before.work_reports) throw new Error("Validasi isi backup gagal.");
    console.log(JSON.stringify({ status:"backup-ok", directory:BACKUP_DIR, ...manifest }, null, 2));
  } else if (process.argv.includes("--clear")) {
    const confirmation = process.argv.find(value => value.startsWith("--confirm="))?.slice(10);
    if (confirmation !== CONFIRMATION) throw new Error("Konfirmasi penghapusan tidak cocok.");
    const manifest = JSON.parse(await readFile(MANIFEST_FILE, "utf8"));
    const compressed = await readFile(DATA_FILE);
    if (sha256(compressed) !== manifest.sha256) throw new Error("Checksum backup tidak cocok; penghapusan dibatalkan.");
    const restored = JSON.parse(gunzipSync(compressed).toString("utf8"));
    if (restored.workReports.length !== manifest.counts.work_reports) {
      throw new Error("Jumlah isi backup tidak cocok; penghapusan dibatalkan.");
    }
    const before = await counts(client);
    if (before.work_reports !== manifest.counts.work_reports) {
      throw new Error("Jumlah laporan Neon berubah setelah backup; penghapusan dibatalkan.");
    }
    await client.query("BEGIN");
    try {
      const deleted = await client.query("DELETE FROM work_reports RETURNING id");
      const after = await counts(client);
      const protectedKeys = [
        "kpi_targets", "work_orders", "maintenance_plans", "maintenance_inspections",
        "overtime_entries", "electricity_checks", "inventory_balances", "machines", "parts", "users",
      ];
      for (const key of protectedKeys) {
        if (after[key] !== before[key]) throw new Error(`Tabel pelindung berubah: ${key}.`);
      }
      if (after.work_reports !== 0) throw new Error("Riwayat laporan kerja belum kosong setelah penghapusan.");
      if (deleted.rowCount !== before.work_reports) throw new Error("Jumlah laporan terhapus tidak cocok.");
      await client.query("COMMIT");
      console.log(JSON.stringify({
        status:"clear-ok", deletedWorkReports:deleted.rowCount,
        preserved:Object.fromEntries(protectedKeys.map(key => [key, after[key]])),
      }, null, 2));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } else {
    throw new Error("Gunakan --backup atau --clear dengan konfirmasi yang benar.");
  }
} finally {
  await client.end().catch(() => {});
}
