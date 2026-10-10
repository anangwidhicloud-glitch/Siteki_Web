import pg from "pg";
import { readFile } from "node:fs/promises";

async function main() {
  const env = await readFile(".env", "utf8");
  const url = env.split(/\r?\n/).find(l => /DATABASE_URL\s*=/.test(l)).replace(/DATABASE_URL\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const queries = [
    { title: "Inspeksi Perawatan (maintenance_inspections)", sql: "SELECT MIN(inspected_on) as min_d, MAX(inspected_on) as max_d, count(*) as cnt FROM maintenance_inspections" },
    { title: "Jadwal Rencana (maintenance_plans)", sql: "SELECT MIN(planned_on) as min_d, MAX(planned_on) as max_d, count(*) as cnt FROM maintenance_plans" },
    { title: "Laporan Kerja (work_reports)", sql: "SELECT MIN(report_date) as min_d, MAX(report_date) as max_d, count(*) as cnt FROM work_reports" },
    { title: "Pemeriksaan Listrik (electricity_checks)", sql: "SELECT MIN(checked_at) as min_d, MAX(checked_at) as max_d, count(*) as cnt FROM electricity_checks" },
    { title: "Transaksi Stang (stang_transactions)", sql: "SELECT MIN(issued_on) as min_d, MAX(issued_on) as max_d, count(*) as cnt FROM stang_transactions" },
    { title: "Order Kerja (work_orders)", sql: "SELECT MIN(ordered_at) as min_d, MAX(ordered_at) as max_d, count(*) as cnt FROM work_orders" },
    { title: "Permintaan Part (part_requests)", sql: "SELECT MIN(requested_on) as min_d, MAX(requested_on) as max_d, count(*) as cnt FROM part_requests" }
  ];

  for (const q of queries) {
    try {
      const res = await client.query(q.sql);
      const row = res.rows[0];
      const minStr = row.min_d ? new Date(row.min_d).toISOString().slice(0, 10) : "null";
      const maxStr = row.max_d ? new Date(row.max_d).toISOString().slice(0, 10) : "null";
      console.log(`${q.title}:`);
      console.log(`  Min: ${minStr} | Max: ${maxStr} | Total Rows: ${row.cnt}`);
    } catch (e) {
      console.log(`${q.title}: Error - ${e.message}`);
    }
  }

  await client.end();
}

main().catch(console.error);
