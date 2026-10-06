import { HttpError, database, handleRequest } from "./lib/core.js";
import { handleAuth } from "./handlers/auth.js";
import { handleOvertime } from "./handlers/overtime.js";
import { handleData } from "./handlers/data.js";
import { handleAssets } from "./handlers/assets.js";
import { handleAnalytics } from "./handlers/analytics.js";
import { handleBackup } from "./handlers/backup.js";
import { handleNotifications } from "./handlers/notifications.js";

async function router(context) {
  const { resource, request, env, body } = context;
  if (resource === "health") {
    const sql = database(env);
    const rows = await sql`SELECT now() AS database_time`;
    return { status:"success", service:"siteki-neon-api", databaseTime:rows[0].database_time };
  }
  if (resource === "monitoring-version") {
    const sql = database(env);
    const rows = await sql`SELECT version,changed_at FROM monitoring_change_state WHERE id=1`;
    return {status:"success",version:Number(rows[0]?.version||0),changedAt:rows[0]?.changed_at||null};
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
