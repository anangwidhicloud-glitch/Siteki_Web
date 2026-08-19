import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const envContents = await readFile(path.join(process.cwd(), ".env"), "utf8");
const envLine = envContents.split(/\r?\n/).find(line => /^\s*DATABASE_URL\s*=/.test(line));
if (!envLine) throw new Error("DATABASE_URL tidak ditemukan.");
const connectionString = envLine
  .replace(/^\s*DATABASE_URL\s*=\s*/, "")
  .trim()
  .replace(/^(['"])(.*)\1$/, "$2");

const client = new Client({ connectionString });
const correctedPreviousReading = 6784.3;

try {
  await client.connect();
  await client.query("BEGIN");
  const result = await client.query(`
    SELECT id, officer_name,
      to_char(checked_at AT TIME ZONE 'Asia/Jakarta', 'DD/MM/YYYY HH24:MI') AS checked_at,
      huhe_h, huhe_hh, huar_heh, huar_hh, kwh, kvar, difference, conclusion
    FROM electricity_checks
    WHERE checked_at AT TIME ZONE 'Asia/Jakarta' = timestamp '2025-10-27 08:49:00'
    FOR UPDATE
  `);
  if (result.rowCount !== 1) {
    throw new Error(`Rekaman target harus tepat satu, ditemukan ${result.rowCount}.`);
  }

  const before = result.rows[0];
  if (Number(before.huhe_h) !== 6811.61) {
    throw new Error(`HUHE H target berubah: ${before.huhe_h}. Koreksi dibatalkan.`);
  }
  if (Number(before.huhe_hh) === correctedPreviousReading) {
    console.log("Rekaman sudah dikoreksi sebelumnya.", before);
    await client.query("ROLLBACK");
    process.exit(0);
  }
  if (Number(before.huhe_hh) !== 6874.3) {
    throw new Error(`HUHE HH target bukan 6874.3: ${before.huhe_hh}. Koreksi dibatalkan.`);
  }

  const updated = await client.query(`
    UPDATE electricity_checks
    SET
      huhe_hh = $2,
      kwh = (huhe_h - $2) * 0.62,
      kvar = huar_heh - huar_hh,
      difference = ((huhe_h - $2) * 0.62) - (huar_heh - huar_hh),
      conclusion = CASE
        WHEN huar_heh - huar_hh > (huhe_h - $2) * 0.62 THEN 'POTENSI DENDA'
        ELSE 'AMAN'
      END,
      calculation_anomaly = false,
      legacy_data = coalesce(legacy_data, '{}'::jsonb) || jsonb_build_object(
        'manual_correction', jsonb_build_object(
          'field', 'HUHE HH',
          'old_value', 6874.3,
          'new_value', $2::numeric,
          'reason', 'Koreksi salah ketik; diselaraskan dengan baseline pembacaan sekitar',
          'corrected_at', now()
        )
      )
    WHERE id = $1
    RETURNING id, officer_name,
      to_char(checked_at AT TIME ZONE 'Asia/Jakarta', 'DD/MM/YYYY HH24:MI') AS checked_at,
      huhe_h, huhe_hh, huar_heh, huar_hh, kwh, kvar, difference, conclusion
  `, [before.id, correctedPreviousReading]);

  await client.query("COMMIT");
  console.log("Sebelum koreksi:", before);
  console.log("Sesudah koreksi:", updated.rows[0]);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
