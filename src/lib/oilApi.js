const API_BASE = String(
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "https://siteki-neon-api.siteki.workers.dev" : ""),
).replace(/\/$/, "");
const OIL_API_URL = API_BASE ? `${API_BASE}?resource=oil` : "";

async function oilRequest(token, options = {}) {
  if (!token) throw new Error("Sesi tidak tersedia. Silakan login kembali.");
  if (!OIL_API_URL) throw new Error("Alamat API Cek Oli belum dikonfigurasi untuk build ini.");
  const response = await fetch(OIL_API_URL, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !/success|ok/i.test(String(result.status || ""))) {
    throw new Error(result.message || `Permintaan cek oli gagal (HTTP ${response.status}).`);
  }
  return result.data;
}

export const getOilMonitoring = token => oilRequest(token);
export const saveOilCheck = (token, payload) => oilRequest(token, { method: "POST", body: payload });
