import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function localApiPlugin() {
  let databaseUrl = "";
  let apiHandler = null;

  return {
    name: "siteki-local-api",
    async configResolved(config) {
      const env = loadEnv(config.mode, process.cwd(), "");
      databaseUrl = env.DATABASE_URL || process.env.DATABASE_URL;
      const mod = await import("./worker/siteki-api.js");
      apiHandler = mod.default;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, "http://localhost");
        if (url.searchParams.has("resource") || url.pathname.startsWith("/api")) {
          try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const rawBody = Buffer.concat(chunks);

            const headers = new Headers();
            for (const [k, v] of Object.entries(req.headers)) {
              if (Array.isArray(v)) v.forEach((item) => headers.append(k, item));
              else if (v) headers.set(k, v);
            }

            const webReq = new Request(url.toString(), {
              method: req.method,
              headers,
              body: ["GET", "HEAD"].includes(req.method) ? undefined : rawBody,
            });

            const webRes = await apiHandler.fetch(webReq, { DATABASE_URL: databaseUrl, ALLOWED_ORIGINS: "*" }, {});
            res.statusCode = webRes.status;
            for (const [hk, hv] of webRes.headers.entries()) res.setHeader(hk, hv);
            const buf = Buffer.from(await webRes.arrayBuffer());
            res.end(buf);
          } catch (err) {
            console.error("Vite API Middleware Error:", err);
            res.statusCode = 500;
            res.end(JSON.stringify({ status: "error", message: err.message }));
          }
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  base: "./",
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react";
          }
          if (
            id.includes("node_modules/exceljs") ||
            id.includes("src/lib/dataWorkbook") ||
            id.includes("src/lib/directWorkbook") ||
            id.includes("src/lib/workbookLoader")
          ) {
            return "workbook";
          }
        },
      },
    },
  },
});
