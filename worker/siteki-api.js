import { HttpError, database, handleRequest } from "./lib/core.js";
import { handleAuth } from "./handlers/auth.js";
import { handleOvertime } from "./handlers/overtime.js";
import { handleData } from "./handlers/data.js";
import { handleAssets } from "./handlers/assets.js";
import { handleAnalytics } from "./handlers/analytics.js";
import { handleBackup } from "./handlers/backup.js";
import { handleNotifications } from "./handlers/notifications.js";

let versionMemoryCache = {
  data: null,
  expiresAt: 0,
};

async function router(context) {
  const { resource, request, env, body } = context;

  // Invalidate in-memory version cache on any mutation request (POST)
  if (request.method === "POST") {
    versionMemoryCache.expiresAt = 0;
  }

  if (resource === "health") {
    const sql = database(env);
    const rows = await sql`SELECT now() AS database_time`;
    return { status:"success", service:"siteki-neon-api", databaseTime:rows[0].database_time };
  }
  if (resource === "monitoring-version") {
    const now = Date.now();
    if (versionMemoryCache.data && now < versionMemoryCache.expiresAt) {
      return json(request, env, 200, versionMemoryCache.data, {
        "Cache-Control": "public, max-age=15, s-maxage=15, stale-while-revalidate=30",
      });
    }

    const sql = database(env);
    const rows = await sql`
      SELECT version,
             COALESCE(version_orders, version, 1) AS version_orders,
             COALESCE(version_reports, version, 1) AS version_reports,
             COALESCE(version_maintenance, version, 1) AS version_maintenance,
             COALESCE(version_overtime, version, 1) AS version_overtime,
             COALESCE(version_electricity, version, 1) AS version_electricity,
             COALESCE(version_inventory, version, 1) AS version_inventory,
             changed_at
      FROM monitoring_change_state
      WHERE id = 1
    `;
    const row = rows[0] || {};
    const payload = {
      status: "success",
      version: Number(row.version || 0),
      modules: {
        orders: Number(row.version_orders || row.version || 0),
        reports: Number(row.version_reports || row.version || 0),
        maintenance: Number(row.version_maintenance || row.version || 0),
        overtime: Number(row.version_overtime || row.version || 0),
        electricity: Number(row.version_electricity || row.version || 0),
        inventory: Number(row.version_inventory || row.version || 0),
      },
      changedAt: row.changed_at || null,
    };

    versionMemoryCache = {
      data: payload,
      expiresAt: now + 15000, // 15 detik TTL di memori Worker
    };

    return json(request, env, 200, payload, {
      "Cache-Control": "public, max-age=15, s-maxage=15, stale-while-revalidate=30",
    });
  }
  if (resource === "users") {
    const auth = await handleAuth(context);
    if (auth) return auth;
    const overtime = await handleOvertime(context);
    if (overtime) return overtime;
  }
  if (resource === "backup") return handleBackup(context);
  const handlers = [handleNotifications,handleData, handleAssets, handleAnalytics];
  for (const handler of handlers) {
    const result = await handler(context);
    if (result !== null && result !== undefined) return result;
  }
  throw new HttpError(404, `Resource ${resource} tidak dikenal.`);
}

export default {
  fetch(request, env, executionCtx) {
    return handleRequest(request, env, context=>router({...context,executionCtx}));
  },
};
