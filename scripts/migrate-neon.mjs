import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const root = process.cwd();

function readDatabaseUrl(contents) {
  const line = contents
    .split(/\r?\n/)
    .find((entry) => /^\s*DATABASE_URL\s*=/.test(entry));
  if (!line) throw new Error("DATABASE_URL tidak ditemukan dalam file .env.");

  const value = line
    .replace(/^\s*DATABASE_URL\s*=\s*/, "")
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");
  if (!/^postgres(?:ql)?:\/\//.test(value)) {
    throw new Error("DATABASE_URL bukan PostgreSQL connection string yang valid.");
  }
  return value;
}

const envContents = await readFile(path.join(root, ".env"), "utf8");
const connectionString = readDatabaseUrl(envContents);
const migrationDirectory = path.join(root, "database", "migrations");
const migrationFiles = (await readdir(migrationDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();

const client = new Client({ connectionString });

try {
  await client.connect();
  for (const name of migrationFiles) {
    const migration = await readFile(path.join(migrationDirectory, name), "utf8");
    await client.query(migration);
  }
  const verification = await client.query(`
    SELECT
      to_regclass('public.work_orders') AS table_name,
      (SELECT count(*)::integer FROM public.work_orders) AS row_count,
      (
        SELECT count(*)::integer
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'work_orders'
      ) AS column_count,
      (SELECT count(*)::integer FROM public.machines) AS machine_count,
      (SELECT count(*)::integer FROM public.users) AS user_count,
      (
        SELECT count(*)::integer
        FROM public.users
        WHERE password_hash IS NOT NULL AND password_hash NOT LIKE '$2%'
      ) AS unsafe_password_count,
      (
        SELECT count(*)::integer
        FROM (
          SELECT lower(username)
          FROM public.users
          WHERE login_enabled
          GROUP BY lower(username)
          HAVING count(*) > 1
        ) duplicate_logins
      ) AS duplicate_active_login_count,
      (SELECT count(*)::integer FROM public.parts) AS part_count,
      (SELECT count(*)::integer FROM public.inventory_balances) AS balance_count,
      (SELECT count(*)::integer FROM public.part_requests) AS request_count,
      (SELECT count(*)::integer FROM public.stock_movements) AS movement_count,
      (
        SELECT count(*)::integer FROM public.part_requests
        WHERE source_sheet = 'Bon'
      ) AS current_request_count,
      (
        SELECT count(*)::integer FROM public.part_requests
        WHERE source_sheet = 'Sheet3'
      ) AS historical_request_count,
      (SELECT count(*)::integer FROM public.work_reports) AS report_count,
      (SELECT count(*)::integer FROM public.kpi_monthly_targets) AS target_count,
      (
        SELECT count(*)::integer FROM public.work_reports WHERE time_anomaly
      ) AS report_time_anomaly_count,
      (
        SELECT count(*)::integer FROM public.work_reports WHERE duration_anomaly
      ) AS report_duration_anomaly_count,
      (SELECT count(*)::integer FROM public.maintenance_plans) AS maintenance_plan_count,
      (
        SELECT count(*)::integer FROM public.maintenance_inspections
      ) AS maintenance_inspection_count,
      (
        SELECT count(*)::integer FROM public.maintenance_inspections
        WHERE plan_id IS NOT NULL
      ) AS maintenance_linked_plan_count,
      (
        SELECT count(*)::integer FROM public.maintenance_check_items
      ) AS maintenance_item_count,
      (
        SELECT count(*)::integer FROM public.maintenance_check_results
      ) AS maintenance_result_count,
      (SELECT count(*)::integer FROM public.overtime_entries) AS overtime_count,
      (
        SELECT count(*)::integer FROM public.overtime_entries WHERE user_id IS NULL
      ) AS overtime_unmatched_user_count,
      (
        SELECT count(*)::integer FROM public.overtime_entries WHERE wage_anomaly
      ) AS overtime_wage_anomaly_count,
      (SELECT count(*)::integer FROM public.electricity_checks) AS electricity_check_count,
      (SELECT count(*)::integer FROM public.electricity_officers) AS electricity_officer_count,
      (
        SELECT count(*)::integer FROM public.electricity_checks WHERE officer_id IS NULL
      ) AS electricity_unmatched_officer_count,
      (
        SELECT count(*)::integer FROM public.electricity_checks WHERE calculation_anomaly
      ) AS electricity_anomaly_count,
      (SELECT count(*)::integer FROM public.stang_transactions) AS stang_transaction_count,
      (
        SELECT count(*)::integer FROM public.stang_transactions WHERE returned_on IS NOT NULL
      ) AS stang_returned_count,
      (
        SELECT count(*)::integer FROM public.stang_transactions WHERE returned_on IS NULL
      ) AS stang_open_count,
      (
        SELECT count(*)::integer FROM public.stang_transactions WHERE code IS NULL
      ) AS stang_missing_code_count,
      (
        SELECT count(*)::integer FROM public.work_orders WHERE lower(order_status) = 'open'
      ) AS work_order_open_count,
      (
        SELECT count(*)::integer FROM public.work_orders WHERE machine_id IS NULL
      ) AS work_order_unmatched_machine_count,
      (SELECT count(*)::integer FROM public.welding_transformers) AS transformer_count,
      (
        SELECT count(*)::integer FROM public.welding_transformer_inspections
      ) AS transformer_inspection_count,
      (
        SELECT count(*)::integer FROM public.welding_transformer_inspections
        WHERE transformer_id IS NULL OR location_id IS NULL
      ) AS transformer_unmatched_count,
      (SELECT count(*)::integer FROM public.oil_reservoirs) AS oil_reservoir_count,
      (SELECT count(*)::integer FROM public.oil_checks) AS oil_check_count,
      (
        SELECT count(*)::integer FROM public.oil_reservoirs WHERE machine_id IS NOT NULL
      ) AS oil_linked_machine_count
  `);
  const result = verification.rows[0];
  if (!result?.table_name) throw new Error("Tabel work_orders tidak ditemukan.");
  console.log(
    `Migration berhasil (${migrationFiles.length} file): ${result.table_name}, ${result.column_count} kolom, ${result.row_count} baris; ${result.machine_count} mesin; ${result.user_count} pengguna.`,
  );
  if (result.unsafe_password_count || result.duplicate_active_login_count) {
    throw new Error("Verifikasi keamanan akun Neon gagal.");
  }
  console.log("Verifikasi akun berhasil: tidak ada password teks biasa atau login aktif duplikat.");
  console.log(
    `Inventori: ${result.part_count} part, ${result.balance_count} saldo, ${result.request_count} order (${result.current_request_count} Bon + ${result.historical_request_count} riwayat), ${result.movement_count} penggunaan.`,
  );
  console.log(
    `Laporan: ${result.report_count} baris, ${result.target_count} target KPI, ${result.report_time_anomaly_count} anomali waktu, ${result.report_duration_anomaly_count} anomali durasi.`,
  );
  console.log(
    `Perawatan: ${result.maintenance_plan_count} jadwal, ${result.maintenance_inspection_count} inspeksi (${result.maintenance_linked_plan_count} terhubung jadwal), ${result.maintenance_item_count} item, ${result.maintenance_result_count} hasil.`,
  );
  console.log(
    `Lembur: ${result.overtime_count} transaksi, ${result.overtime_unmatched_user_count} tanpa pengguna, ${result.overtime_wage_anomaly_count} anomali upah historis.`,
  );
  console.log(
    `Listrik: ${result.electricity_check_count} pemeriksaan, ${result.electricity_officer_count} petugas, ${result.electricity_unmatched_officer_count} tanpa petugas, ${result.electricity_anomaly_count} anomali.`,
  );
  console.log(
    `Stang: ${result.stang_transaction_count} transaksi, ${result.stang_returned_count} kembali, ${result.stang_open_count} belum kembali, ${result.stang_missing_code_count} tanpa kode historis.`,
  );
  console.log(
    `Order kerja: ${result.row_count} transaksi, ${result.work_order_open_count} open, ${result.work_order_unmatched_machine_count} tanpa mesin.`,
  );
  console.log(
    `Trafo Las: ${result.transformer_count} master, ${result.transformer_inspection_count} inspeksi, ${result.transformer_unmatched_count} relasi kosong.`,
  );
  console.log(
    `Oli: ${result.oil_reservoir_count} reservoir, ${result.oil_check_count} pemeriksaan, ${result.oil_linked_machine_count} terhubung mesin.`,
  );
} finally {
  await client.end().catch(() => {});
}
