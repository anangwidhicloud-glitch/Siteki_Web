import { neon } from "@neondatabase/serverless";
import postgres from "postgres";

let postgresSql = null;
let currentDbUrl = null;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function database(env) {
  if (!env.DATABASE_URL) throw new HttpError(503, "DATABASE_URL belum dikonfigurasi.");
  if (env.DATABASE_URL.includes("neon.tech")) {
    return neon(env.DATABASE_URL);
  }
  if (!postgresSql || currentDbUrl !== env.DATABASE_URL) {
    postgresSql = postgres(env.DATABASE_URL, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
    });
    currentDbUrl = env.DATABASE_URL;
  }
  return postgresSql;
}

export function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return "*";
  const configured = String(env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  if (!configured.length || configured.includes("*")) return origin;
  if (configured.includes(origin)) return origin;
  if (
    /^https?:\/\/localhost(:\d+)?$/i.test(origin) ||
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin) ||
    /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)\d+(\.\d+)?(:\d+)?$/i.test(origin) ||
    /^capacitor:\/\/localhost$/i.test(origin) ||
    /^https:\/\/([a-z0-9-]+\.)*vercel\.app$/i.test(origin) ||
    /^https:\/\/([a-z0-9-]+\.)*workers\.dev$/i.test(origin) ||
    /^https:\/\/([a-z0-9-]+\.)*pages\.dev$/i.test(origin)
  ) {
    return origin;
  }
  return origin;
}

export function corsHeaders(request, env) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(request, env),
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

export function json(request, env, status, payload, customHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request, env),
      ...customHeaders,
    },
  });
}

export function text(value, maxLength = 4000) {
  const result = String(value ?? "").trim();
  if (result.length > maxLength) throw new HttpError(400, "Teks melebihi batas yang diizinkan.");
  return result || null;
}

export function required(value, label) {
  const result = text(value);
  if (!result) throw new HttpError(400, `${label} wajib diisi.`);
  return result;
}

export function number(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isoDate(value) {
  const source = text(value);
  if (!source) return null;
  let match = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  match = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function isoDateTime(value) {
  const source = text(value);
  if (!source) return null;
  const id = source.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (id) {
    return `${id[3]}-${id[2].padStart(2, "0")}-${id[1].padStart(2, "0")}T${String(id[4] || 0).padStart(2, "0")}:${id[5] || "00"}:00+07:00`;
  }
  const iso = new Date(source);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

export function dateKey(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function idDate(value) {
  const key = dateKey(value);
  if (!key) return "";
  const [year, month, day] = key.split("-");
  return `${day}/${month}/${year}`;
}

export function idDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

export function rowKey(row) {
  return row.legacy_sheet_row ?? row.id;
}

export function identity(...values) {
  return values
    .map(value => String(value ?? "").trim().toLocaleLowerCase("id-ID"))
    .join("|");
}

export function bearerToken(request, body = {}) {
  const header = String(request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  return text(header?.[1] || body.token, 1000);
}

export async function sha256(value) {
  const input = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function requireSession(request, env, body = {}, roles = []) {
  const token = bearerToken(request, body);
  if (!token) throw new HttpError(401, "Sesi tidak tersedia. Silakan login kembali.");
  const sql = database(env);
  const hash = await sha256(token);
  const rows = await sql`
    SELECT users.id, users.username, users.full_name, users.role, users.department,
      users.employee_number, users.base_salary, sessions.id AS session_id
    FROM api_sessions sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ${hash}
      AND sessions.expires_at > now()
      AND users.login_enabled
      AND users.is_active
    LIMIT 1
  `;
  if (!rows.length) throw new HttpError(401, "Sesi berakhir. Silakan login kembali.");
  const profile = rows[0];
  if (roles.length && !roles.map(role => role.toLowerCase()).includes(String(profile.role).toLowerCase())) {
    throw new HttpError(403, "Anda tidak memiliki hak akses untuk operasi ini.");
  }
  await sql`
    UPDATE api_sessions
    SET last_seen_at = now(), expires_at = now() + interval '8 hours'
    WHERE id = ${profile.session_id}
  `;
  return profile;
}

export function monthName(value) {
  const key = dateKey(value);
  if (!key) return "";
  return new Intl.DateTimeFormat("id-ID", { month: "long", timeZone: "UTC" })
    .format(new Date(`${key}T00:00:00Z`));
}

export async function handleRequest(request, env, router) {
  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (!env.DATABASE_URL) throw new HttpError(503, "DATABASE_URL belum dikonfigurasi.");
    const url = new URL(request.url);
    // Root tetap kompatibel dengan frontend lama yang memakai Worker khusus Cek Oli.
    const resource = text(url.searchParams.get("resource")) || "oil";
    let body = {};
    if (request.method === "POST") {
      try { body = await request.json(); }
      catch { throw new HttpError(400, "Format JSON tidak valid."); }
    } else if (request.method !== "GET") {
      throw new HttpError(405, "Metode tidak didukung.");
    }
    const payload = await router({ request, env, url, resource, body });
    if (payload instanceof Response) return payload;
    return json(request, env, 200, payload);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error?.stack || error);
    const safeOrigin = request?.headers?.get("Origin") || "*";
    return new Response(JSON.stringify({
      status: "error",
      message: error.message || "Server SiTeki mengalami kendala saat menghubungkan database.",
      details: error.stack || String(error)
    }), {
      status,
      headers: {
        "Access-Control-Allow-Origin": safeOrigin,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Vary": "Origin"
      },
    });
  }
}
