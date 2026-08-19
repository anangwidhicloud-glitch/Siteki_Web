import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import worker from "../worker/siteki-api.js";

const envFile = await readFile(path.join(process.cwd(), ".env"), "utf8");
const line = envFile.split(/\r?\n/).find(value => /^\s*DATABASE_URL\s*=/.test(value));
if (!line) throw new Error("DATABASE_URL tidak ditemukan dalam .env.");
const DATABASE_URL = line.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^(['"])(.*)\1$/, "$2");
const env = { DATABASE_URL, ALLOWED_ORIGIN:"https://siteki.xo.je" };
const origin = "https://siteki.xo.je";

async function call(resource, params = {}) {
  const url = new URL("https://api.test/");
  url.searchParams.set("resource", resource);
  Object.entries(params).forEach(([key,value]) => url.searchParams.set(key,String(value)));
  const response = await worker.fetch(new Request(url,{headers:{Origin:origin}}),env);
  const payload = await response.json();
  if (!response.ok) throw new Error(`${resource}: ${payload.message || response.status}`);
  return payload;
}

const cases = [
  ["health", payload => payload.service === "siteki-neon-api"],
  ["maintenance-master", payload => Array.isArray(payload) && payload.length === 89],
  ["parts", payload => Array.isArray(payload) && payload.length === 520],
  ["orders", payload => Array.isArray(payload) && payload.length === 21],
  ["maintenance", payload => Array.isArray(payload) && payload.length >= 1276],
  ["stock", payload => Array.isArray(payload) && payload.length === 517],
  ["part-requests", payload => Array.isArray(payload) && payload.length === 742],
  ["transformer-data", payload => Array.isArray(payload) && payload.length === 95],
  ["stang", payload => payload.rangkuman?.totalDikeluarkan === 2026],
  ["electricity", payload => Array.isArray(payload.data) && payload.data.length === 134],
  ["kpi", payload => Array.isArray(payload) && payload.length === 12],
  ["kpi-combined", payload => Array.isArray(payload.rekap) && payload.rekap.length === 12],
  ["downtime", payload => Array.isArray(payload.rekap) && Array.isArray(payload.laporan_mentah)],
  ["maintenance-detail", payload => Array.isArray(payload.data_per_jenis) && Array.isArray(payload.data_per_mesin)],
];

for (const [resource, verify] of cases) {
  const payload = await call(resource, resource === "orders" ? { action:"getAllOrders" } : {});
  if (!verify(payload)) throw new Error(`${resource}: bentuk/jumlah respons tidak sesuai.`);
  console.log(`OK ${resource}`);
}

const unauthorized = await worker.fetch(new Request("https://api.test/?resource=oil",{headers:{Origin:origin}}),env);
if (unauthorized.status !== 401) throw new Error(`oil: seharusnya 401 tanpa sesi, mendapat ${unauthorized.status}.`);
console.log("OK oil menolak akses tanpa sesi");
console.log("Smoke test API Neon berhasil.");
