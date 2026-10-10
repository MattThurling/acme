// End-to-end MCP checks over real Streamable HTTP: list tools, call each one,
// read the UI resource. Runs the dev server with MEDIFINANCE_MOCK=1 so no
// real application is ever created. (MCP Inspector covers the same ground
// interactively — see README.)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const PORT = 3123;
const URL_ = new URL(`http://localhost:${PORT}/api/mcp`);
let proc;

async function connect() {
  const client = new Client(
    { name: "acme-test-client", version: "1.0.0" },
    { capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } },
  );
  await client.connect(new StreamableHTTPClientTransport(URL_));
  return client;
}

before(async () => {
  proc = spawn(process.execPath, ["scripts/dev-server.mjs"], {
    env: { ...process.env, PORT: String(PORT), MEDIFINANCE_MOCK: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://localhost:${PORT}/products.json`); return; } catch { await sleep(100); }
  }
  throw new Error("dev server did not start");
});

after(() => proc?.kill());

test("lists the three tools with the right annotations and UI metadata", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(byName).sort(), ["get_product", "request_finance", "search_products"]);
  assert.equal(byName.search_products.annotations.readOnlyHint, true);
  assert.equal(byName.get_product.annotations.readOnlyHint, true);
  assert.deepEqual(byName.request_finance.annotations, {
    readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true,
  });
  for (const t of tools) assert.equal(t._meta?.ui?.resourceUri, "ui://acme/card.html", `${t.name} has UI`);
  await client.close();
});

test("search_products returns the chair package for 'dental chair' with text and structured content", async () => {
  const client = await connect();
  const r = await client.callTool({ name: "search_products", arguments: { query: "dental chair" } });
  assert.ok(!r.isError);
  assert.equal(r.structuredContent.kind, "products");
  assert.ok(r.structuredContent.products.some((p) => p.id === "chair-package"));
  assert.match(r.content[0].text, /ErgoDent Signature Surgery Package — £32,750/);
  await client.close();
});

test("search_products with no query lists everything, max_price filters", async () => {
  const client = await connect();
  const all = await client.callTool({ name: "search_products", arguments: {} });
  assert.equal(all.structuredContent.products.length, 6);
  const cheap = await client.callTool({ name: "search_products", arguments: { max_price: 20000 } });
  assert.deepEqual(cheap.structuredContent.products.map((p) => p.id).sort(), ["intraoral-scanner", "sterilisation-suite"]);
  await client.close();
});

test("get_product returns one product and errors clearly on a bad id", async () => {
  const client = await connect();
  const ok = await client.callTool({ name: "get_product", arguments: { product_id: "chair-package" } });
  assert.equal(ok.structuredContent.product.price, 32750);
  const bad = await client.callTool({ name: "get_product", arguments: { product_id: "nope" } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /Known ids/);
  await client.close();
});

test("request_finance starts an application (mock) and relays Medifinance's message verbatim", async () => {
  const client = await connect();
  const r = await client.callTool({
    name: "request_finance",
    arguments: { product_id: "chair-package", first_name: "Jack", last_name: "Jones", email: "jack@jjdental.com", company_type: "limited_company", agent_client: "test" },
  });
  assert.ok(!r.isError, JSON.stringify(r));
  const sc = r.structuredContent;
  assert.equal(sc.kind, "finance_result");
  assert.equal(sc.ok, true);
  assert.match(sc.application_reference, /^MF-MOCK-/);
  assert.match(sc.message, /secure link/);
  assert.match(r.content[0].text, new RegExp(sc.application_reference));
  for (const banned of ["APR", "%", "per month"]) assert.ok(!r.content[0].text.includes(banned));
  await client.close();
});

test("request_finance validation errors are structured and name the field", async () => {
  const client = await connect();
  const r = await client.callTool({
    name: "request_finance",
    arguments: { product_id: "chair-package", first_name: "Jack", last_name: "Jones", email: "not-an-email", company_type: "sole_trader" },
  });
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.ok, false);
  assert.ok(r.structuredContent.errors.some((e) => e.field === "email"));
  assert.match(r.content[0].text, /email/);
  await client.close();
});

test("the UI resource resolves with the MCP Apps MIME type and self-contained HTML", async () => {
  const client = await connect();
  const { resources } = await client.listResources();
  const card = resources.find((x) => x.uri === "ui://acme/card.html");
  assert.ok(card, "card resource listed");
  assert.equal(card.mimeType, "text/html;profile=mcp-app");
  const read = await client.readResource({ uri: "ui://acme/card.html" });
  const c = read.contents[0];
  assert.equal(c.mimeType, "text/html;profile=mcp-app");
  assert.match(c.text, /<!DOCTYPE html>/);
  assert.ok(!/<script[^>]+src=/.test(c.text), "no external scripts");
  assert.ok(!/<link[^>]+href=/.test(c.text), "no external stylesheets");
  assert.equal(c._meta?.ui?.prefersBorder, true);
  await client.close();
});

test("server card and discovery files are served", async () => {
  const card = await fetch(`http://localhost:${PORT}/.well-known/mcp/server-card.json`);
  assert.equal(card.status, 200);
  assert.equal(card.headers.get("content-type"), "application/mcp-server-card+json");
  const json = await card.json();
  assert.equal(json.remotes[0].type, "streamable-http");
  const alias = await fetch(`http://localhost:${PORT}/api/mcp/server-card`);
  assert.equal(alias.status, 200);
  const page = await fetch(`http://localhost:${PORT}/`);
  assert.match(page.headers.get("link"), /rel="mcp"/);
});
