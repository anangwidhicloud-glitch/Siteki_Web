import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

function envValue(contents, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = contents.split(/\r?\n/).find(entry => new RegExp(`^\\s*${escaped}\\s*=`).test(entry));
  if (!line) throw new Error(`${key} tidak ditemukan.`);
  return line.replace(new RegExp(`^\\s*${escaped}\\s*=\\s*`), "").trim().replace(/^(['"])(.*)\1$/, "$2");
}

const localEnv = await readFile(".env", "utf8");
const productionEnv = await readFile(".env.production", "utf8");
const databaseUrl = envValue(localEnv, "DATABASE_URL");
const workerUrl = `${envValue(productionEnv, "VITE_API_URL").replace(/\/$/, "")}?resource=oil`;
const origin = "https://siteki.xo.je";

const preflight = await fetch(workerUrl, {
  method: "OPTIONS",
  headers: {
    Origin: origin,
    "Access-Control-Request-Method": "GET",
    "Access-Control-Request-Headers": "authorization",
  },
});
if (preflight.status !== 204 || preflight.headers.get("access-control-allow-origin") !== origin) {
  throw new Error("CORS Worker tidak sesuai origin InfinityFree.");
}

const unauthorized = await fetch(workerUrl, { headers: { Origin: origin } });
if (unauthorized.status !== 401) throw new Error("Worker tidak menolak request tanpa sesi.");

const invalidSession = await fetch(workerUrl, {
  headers: { Origin: origin, Authorization: "Bearer verification-invalid-token" },
});
if (invalidSession.status !== 401) throw new Error("Worker tidak menolak token sesi yang tidak valid.");

const sql = neon(databaseUrl);
const rows = await sql.query(`
  SELECT
    (SELECT count(*)::integer FROM oil_reservoirs) AS reservoirs,
    (SELECT count(*)::integer FROM oil_checks) AS checks
`);
if (Number(rows[0]?.reservoirs) !== 31 || Number(rows[0]?.checks) !== 162) {
  throw new Error("Jumlah data Neon Cek Oli tidak sesuai spreadsheet.");
}

console.log(
  `Worker aktif dan aman; Neon berisi ${rows[0].reservoirs} reservoir serta ${rows[0].checks} pemeriksaan.`,
);
