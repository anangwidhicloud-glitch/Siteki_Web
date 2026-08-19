import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function envValue(contents, key) {
  const line = contents.split(/\r?\n/).find(value => new RegExp(`^\\s*${key}\\s*=`).test(value));
  return line?.replace(new RegExp(`^\\s*${key}\\s*=\\s*`), "").trim().replace(/^(['"])(.*)\1$/, "$2") || "";
}

const productionEnv = await readFile(path.join(process.cwd(), ".env.production"), "utf8");
const apiBase = envValue(productionEnv, "VITE_API_URL").replace(/\/$/, "");
if (!apiBase) throw new Error("VITE_API_URL tidak ditemukan dalam .env.production.");

async function get(resource, params = {}) {
  const url = new URL(apiBase);
  url.searchParams.set("resource", resource);
  Object.entries(params).forEach(([key,value]) => value !== "" && url.searchParams.set(key,String(value)));
  const response = await fetch(url,{headers:{Origin:"https://siteki.xo.je"}});
  const payload = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.message||`HTTP ${response.status}`);
  return payload;
}

const checks = [
  ["Health API Neon", () => get("health"), value => value.service ? 1 : 0],
  ["Order kerja", () => get("orders",{action:"getAllOrders"}), value => value.length],
  ["Perawatan", () => get("maintenance"), value => value.length],
  ["Master mesin", () => get("maintenance-master"), value => value.length],
  ["Laporan kerja", () => get("jobs",{action:"getDataLapKerja"}), value => value.length],
  ["Listrik", () => get("electricity"), value => value.data?.length||0],
  ["Stok part", () => get("stock"), value => value.length],
  ["Master part", () => get("parts"), value => value.length],
  ["Metadata order part", () => get("part-order"), value => value.stok?.length||0],
  ["Daftar bon", () => get("part-requests"), value => value.length],
  ["Data trafo", () => get("transformer-data"), value => value.length],
  ["Referensi trafo", () => get("transformers",{action:"getReferensi"}), value => value.lokasi?.length||0],
  ["Stang", () => get("stang"), value => value.data?.length||0],
  ["KPI perawatan", () => get("kpi"), value => value.length],
  ["KPI gabungan", () => get("kpi-combined"), value => value.rekap?.length||0],
  ["Downtime", () => get("downtime"), value => value.rekap?.length||0],
  ["Detail perawatan", () => get("maintenance-detail",{bulan:"Semua Bulan",jenis:"Semua Jenis"}), value => value.data_per_mesin?.length||0],
];

const results = await Promise.all(checks.map(async ([name,load,size])=>{
  try { const value=await load(); return {ok:true,message:`OK   ${name}: ${size(value)} record/field`}; }
  catch(error){ return {ok:false,message:`FAIL ${name}: ${error?.message||error}`}; }
}));
results.forEach(result=>console.log(result.message));
const failed=results.filter(result=>!result.ok).length;
if(failed){console.error(`${failed} koneksi gagal dari ${checks.length} pemeriksaan.`);process.exitCode=1;}
else console.log(`Semua ${checks.length} koneksi Neon berhasil.`);
