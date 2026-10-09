const API_BASE = String(
  import.meta.env?.VITE_API_URL ||
  (import.meta.env?.DEV ? "https://siteki-neon-api.siteki.workers.dev" : "") ||
  (typeof process !== "undefined" ? process.env?.VITE_API_URL : "") || ""
)
  .trim().replace(/\?+$/, "");
const responseCache = new Map();
const pendingRequests = new Map();
const RETRYABLE_READ_STATUSES = new Set([429, 500, 502, 503, 504]);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function endpoint(resource) {
  if (!API_BASE) return "";
  const separator = API_BASE.includes("?") ? "&" : "?";
  return `${API_BASE}${separator}resource=${encodeURIComponent(resource)}`;
}

function sessionToken() {
  if (typeof window === "undefined") return "";
  try {
    const raw =
      (typeof localStorage !== "undefined" && localStorage.getItem("siteki-session")) ||
      (typeof sessionStorage !== "undefined" && sessionStorage.getItem("siteki-session"));
    return JSON.parse(raw || "null")?.token || "";
  } catch {
    return "";
  }
}

function authHeaders(extra = {}) {
  const token = sessionToken();
  return { ...extra, ...(token ? { Authorization:`Bearer ${token}` } : {}) };
}

export function formatApiError(error) {
  if (!error) return new Error("Terjadi kesalahan jaringan.");
  const msg = String(error.message || "");
  const name = String(error.name || "");
  if (name === "AbortError" || /aborted/i.test(msg) || /signal is aborted/i.test(msg)) {
    return new Error("Waktu tunggu koneksi habis (timeout). Server atau database sedang sibuk. Silakan coba lagi.");
  }
  if (/failed to fetch|network\s?error|load failed/i.test(msg)) {
    return new Error("Koneksi ke server terputus atau database sedang memulai ulang (cold start). Silakan coba lagi.");
  }
  return error;
}

export const ENDPOINTS = {
  login: endpoint("users"), users: endpoint("users"),
  monitoringVersion: endpoint("monitoring-version"),
  notifications: endpoint("notifications"),
  dashboardOrders: endpoint("orders"), orders: endpoint("orders"),
  createOrder: endpoint("orders"), completeOrder: endpoint("orders"),
  maintenance: endpoint("maintenance"), maintenanceMaster: endpoint("maintenance-master"),
  jobs: endpoint("jobs"), electricity: endpoint("electricity"),
  stock: endpoint("stock"), partMaster: endpoint("parts"),
  partOrder: endpoint("part-order"), partRequests: endpoint("part-requests"),
  transformer: endpoint("transformers"), transformerData: endpoint("transformer-data"),
  stang: endpoint("stang"), kpi: endpoint("kpi"),
  kpiCombined: endpoint("kpi-combined"), kpiDaily:endpoint("kpi-daily"), downtime: endpoint("downtime"),
  maintenanceDetail: endpoint("maintenance-detail"), backup: endpoint("backup")
};

function withQuery(url, params = {}) {
  const target = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      target.searchParams.set(key, String(value));
    }
  });
  target.searchParams.set("_", Date.now());
  return target.toString();
}

function requestKey(endpoint, params = {}) {
  const query = Object.entries(params)
    .filter(([,value]) => value !== undefined && value !== null && value !== "")
    .sort(([left],[right]) => left.localeCompare(right))
    .map(([key,value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${endpoint}?${query}`;
}

function isReadAction(params = {}) {
  const action = String(params.action || "");
  return !action || /^(get|list|fetch|summary|check)/i.test(action);
}

export function clearApiCache(endpoint) {
  for (const key of responseCache.keys()) {
    if (!endpoint || key.startsWith(endpoint)) responseCache.delete(key);
  }
}

async function parseResponse(response) {
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401) {
      try {
        if (typeof localStorage !== "undefined") localStorage.removeItem("siteki-session");
        if (typeof sessionStorage !== "undefined") sessionStorage.removeItem("siteki-session");
        if (typeof window !== "undefined") window.dispatchEvent(new Event("siteki-session-expired"));
      } catch {}
    }
    try {
      const payload=JSON.parse(text);
      throw new Error(payload?.message||`Permintaan server gagal (HTTP ${response.status}).`);
    } catch(error) {
      if(error instanceof SyntaxError)throw new Error(`Permintaan server gagal (HTTP ${response.status}).`);
      throw error;
    }
  }
  if (!text.trim()) return { status: "success" };
  try {
    return JSON.parse(text);
  } catch {
    return { status: /success/i.test(text) ? "success" : "unknown", message: text };
  }
}

export async function apiGet(endpoint, params = {}, options = {}) {
  if (!endpoint) throw new Error("VITE_API_URL belum dikonfigurasi.");
  const cacheable = options.cache !== false && isReadAction(params);
  const key = requestKey(endpoint, params);
  const ttl = options.cacheTtl ?? 30000;
  const cached = cacheable ? responseCache.get(key) : null;
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cacheable && pendingRequests.has(key)) return pendingRequests.get(key);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 60000);
  const request = (async () => {
    try {
      let value;
      let lastError;
      const maxAttempts = 4;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const response = await fetch(withQuery(endpoint, params), {
            method: "GET",
            headers: authHeaders(),
            cache: "no-store",
            signal: controller.signal,
            redirect: "follow"
          });
          if (RETRYABLE_READ_STATUSES.has(response.status) && attempt < maxAttempts - 1) {
            await wait(600 * Math.pow(1.8, attempt));
            continue;
          }
          value = await parseResponse(response);
          lastError = null;
          break;
        } catch (error) {
          lastError = formatApiError(error);
          if (controller.signal.aborted || attempt === maxAttempts - 1) break;
          await wait(600 * Math.pow(1.8, attempt));
        }
      }
      if (lastError) throw lastError;
      if (cacheable && ttl > 0) responseCache.set(key,{value,expiresAt:Date.now()+ttl});
      else if (!cacheable) clearApiCache(endpoint);
      return value;
    } finally {
      clearTimeout(timeout);
      pendingRequests.delete(key);
    }
  })();
  if (cacheable) pendingRequests.set(key,request);
  return request;
}

export async function apiPost(endpoint, payload, options = {}) {
  if (!endpoint) throw new Error("VITE_API_URL belum dikonfigurasi.");
  const maxAttempts = options.retries ? options.retries + 1 : 1;
  const timeoutMs = options.timeout || 45000;
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json;charset=utf-8" }),
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: "follow"
      });
      const value = await parseResponse(response);
      clearApiCache(endpoint);
      return value;
    } catch (error) {
      lastError = formatApiError(error);
      if (options.signal?.aborted) break;
      if (attempt < maxAttempts - 1) {
        await wait(600 * (attempt + 1));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

export const RBKIC_ENDPOINTS = {
  // RBKIC Local (development)
  rbkicLocal: 'http://localhost:4173/api/kpi',
  // RBKIC Production - sesuaikan dengan URL deployment
  rbkicProduction: 'http://localhost:4173/api/kpi'
};

// RBKIC KPI API Endpoints
export const RBKIC_KPI = {
  summary: '/summary',
  wo: '/wo',
  pm: '/pm',
  downtime: '/downtime',
  quality: '/quality',
  combined: '/combined'
};

export function asArray(value, keys = ["data", "rows", "result"]) {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

export function isSuccess(value) {
  if (!value) return false;
  if (value.status === undefined) return true;
  return /success|ok|berhasil/i.test(String(value.status)) ||
    /success|berhasil/i.test(String(value.message || ""));
}
