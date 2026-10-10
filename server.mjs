import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Baca .env jika ada
let databaseUrl = process.env.DATABASE_URL;
try {
  const envContent = await readFile(path.join(__dirname, ".env"), "utf8");
  const match = envContent.match(/^\s*DATABASE_URL\s*=\s*['"]?([^'"\r\n]+)['"]?/m);
  if (match) databaseUrl = match[1];
} catch {}

if (!databaseUrl) {
  console.error("❌ ERROR: DATABASE_URL tidak ditemukan di .env atau environment variables.");
  process.exit(1);
}

// Import worker router
const { default: workerHandler } = await import("./worker/siteki-api.js");

const PORT = Number(process.env.PORT) || 3000;
const DIST_DIR = path.join(__dirname, "dist");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
};

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `localhost:${PORT}`;
    const fullUrl = new URL(req.url, `http://${host}`);

    // Cek apakah ini permintaan API
    const isApiRequest = fullUrl.searchParams.has("resource") || fullUrl.pathname.startsWith("/api");

    if (isApiRequest) {
      // Baca body jika ada (misal POST request)
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks);

      const headers = new Headers();
      for (const [key, val] of Object.entries(req.headers)) {
        if (Array.isArray(val)) {
          val.forEach((v) => headers.append(key, v));
        } else if (val) {
          headers.set(key, val);
        }
      }

      const webRequest = new Request(fullUrl.toString(), {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : rawBody,
      });

      const env = {
        DATABASE_URL: databaseUrl,
        ALLOWED_ORIGINS: "*",
      };

      const webResponse = await workerHandler.fetch(webRequest, env, {});

      res.statusCode = webResponse.status;
      for (const [hKey, hVal] of webResponse.headers.entries()) {
        res.setHeader(hKey, hVal);
      }

      const resBuffer = Buffer.from(await webResponse.arrayBuffer());
      res.end(resBuffer);
      return;
    }

    // Jika bukan API, layani file statis dari folder dist/
    let reqPath = decodeURIComponent(fullUrl.pathname);
    if (reqPath === "/" || !reqPath) reqPath = "/index.html";

    let filePath = path.join(DIST_DIR, reqPath);

    // Cek apakah file ada
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
      if (ext === ".html") {
        res.setHeader("Cache-Control", "no-cache");
      } else {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Fallback SPA ke index.html
    const indexPath = path.join(DIST_DIR, "index.html");
    if (fs.existsSync(indexPath)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      fs.createReadStream(indexPath).pipe(res);
      return;
    }

    res.statusCode = 404;
    res.end("Frontend belum dibuild. Jalankan 'npm run build' terlebih dahulu.");
  } catch (err) {
    console.error("Server Error:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "error", message: err.message || "Internal server error" }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("========================================================");
  console.log(`🚀 SiTeki Server berjalan di port ${PORT}`);
  console.log(`📡 URL Lokal    : http://localhost:${PORT}`);
  console.log(`🐘 Database     : PostgreSQL di ${databaseUrl.replace(/:[^:@]+@/, ":****@")}`);
  console.log(`📂 Folder Web   : ${DIST_DIR}`);
  console.log("========================================================");
});
