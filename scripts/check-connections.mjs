import { apiGet, asArray, ENDPOINTS } from "../src/lib/api.js";
import { getFirestoreCollection } from "../src/lib/firebase.js";

const checks = [
  ["Login API", () => apiGet(ENDPOINTS.login, { action: "login", username: "__connection_check__", password: "__invalid__" }), (x) => Object.keys(x || {}).length],
  ["Order dashboard", () => apiGet(ENDPOINTS.dashboardOrders, { action: "getAllOrders" }), (x) => asArray(x).length],
  ["Order kerja", () => apiGet(ENDPOINTS.orders, { action: "getAllOrders" }), (x) => asArray(x).length],
  ["Perawatan", () => apiGet(ENDPOINTS.maintenance, { action: "getPerawatan" }), (x) => asArray(x).length],
  ["Master perawatan", () => apiGet(ENDPOINTS.maintenanceMaster, { action: "getRawatMaster" }), (x) => asArray(x).length],
  ["Laporan kerja", () => apiGet(ENDPOINTS.jobs, { action: "getDataLapKerja", bulan: "", tglAwal: "", tglAkhir: "" }), (x) => asArray(x).length],
  ["Listrik", () => apiGet(ENDPOINTS.electricity), (x) => Object.keys(x || {}).length],
  ["Stok part", () => apiGet(ENDPOINTS.stock, { action: "getStokPart", bulan: "" }), (x) => asArray(x).length],
  ["Metadata order part", () => apiGet(ENDPOINTS.partOrder, { action: "getMetadataOrder" }), (x) => Object.keys(x || {}).length],
  ["Daftar bon", () => apiGet(ENDPOINTS.partRequests, { action: "getDaftarBon" }), (x) => asArray(x).length],
  ["Data trafo", () => apiGet(ENDPOINTS.transformerData, { action: "getDataTravo" }), (x) => asArray(x).length],
  ["Referensi trafo", () => apiGet(ENDPOINTS.transformer, { action: "getReferensi" }), (x) => Object.keys(x || {}).length],
  ["Stang", () => apiGet(ENDPOINTS.stang, { action: "getDatabaseStang" }), (x) => Object.keys(x || {}).length],
  ["KPI perawatan", () => apiGet(ENDPOINTS.kpi), (x) => asArray(x).length],
  ["KPI gabungan", () => apiGet(ENDPOINTS.kpiCombined), (x) => asArray(x, ["rekap"]).length],
  ["Downtime", () => apiGet(ENDPOINTS.downtime), (x) => asArray(x, ["rekap"]).length],
  ["Detail perawatan", () => apiGet(ENDPOINTS.maintenanceDetail, { bulan:"Semua Bulan", jenis:"Semua Jenis" }), (x) => Object.keys(x || {}).length],
  ["Firestore master_mesin", () => getFirestoreCollection("master_mesin"), (x) => x.length],
  ["Firestore master_part", () => getFirestoreCollection("master_part"), (x) => x.length]
];

const results = await Promise.all(checks.map(async ([name, load, size]) => {
  try {
    const result = await load();
    return { ok: true, message: `OK   ${name}: ${size(result)} record/field` };
  } catch (error) {
    return { ok: false, message: `FAIL ${name}: ${error?.name || "ConnectionError"}` };
  }
}));
results.forEach((result) => console.log(result.message));
const failed = results.filter((result) => !result.ok).length;

if (failed) {
  console.error(`${failed} koneksi gagal dari ${checks.length} pemeriksaan.`);
  process.exitCode = 1;
} else {
  console.log(`Semua ${checks.length} koneksi baca berhasil.`);
}
