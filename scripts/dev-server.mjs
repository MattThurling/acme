// Tiny Vercel-alike for local development and tests: serves the static site
// from public/ (with clean URLs), the .well-known files, and routes /api/* to the
// serverless handlers with Vercel's `req.body` / `res.status().json()`
// conveniences. `npx vercel dev` works too; this just needs no Vercel login.
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.join(REPO, "public"); // static files live in public/, as on Vercel
const PORT = Number(process.env.PORT || 3000);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};
const SPECIAL_TYPES = {
  "/.well-known/mcp/server-card.json": "application/mcp-server-card+json",
  "/.well-known/ai-catalog.json": "application/ai-catalog+json",
};

const financeHandler = (await import("../api/finance.js")).default;
const mcpHandler = (await import("../api/mcp.js")).default;

function shim(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(obj)); return res; };
  res.send = (body) => { res.end(body); return res; };
  return res;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  if ((req.headers["content-type"] || "").includes("application/json")) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

function serveStatic(urlPath, res) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel.endsWith("/")) rel += "index.html";
  const candidates = [rel, `${rel}.html`];
  for (const c of candidates) {
    const file = path.join(ROOT, c);
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) continue;
    const type = SPECIAL_TYPES[c] || TYPES[path.extname(file)] || "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    if (c.startsWith("/.well-known/")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=3600");
    }
    createReadStream(file).pipe(res);
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Link", '</.well-known/mcp/server-card.json>; rel="mcp"');
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/api/mcp/server-card") return serveStatic("/.well-known/mcp/server-card.json", res) || notFound(res);
    if (url.pathname === "/api/finance") { req.body = await readBody(req); return financeHandler(req, shim(res)); }
    if (url.pathname === "/api/mcp") { req.body = await readBody(req); return mcpHandler(req, shim(res)); }
    if (serveStatic(url.pathname, res)) return;
    notFound(res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) { res.statusCode = 500; res.end("Internal error"); }
  }
});

function notFound(res) { res.statusCode = 404; res.setHeader("Content-Type", "text/plain"); res.end("Not found"); }

server.listen(PORT, () => {
  console.log(`Acme dev server: http://localhost:${PORT}  (MCP endpoint: http://localhost:${PORT}/api/mcp)`);
  if (process.env.MEDIFINANCE_MOCK === "1") console.log("MEDIFINANCE_MOCK=1: Medifinance calls are faked.");
});
