// POST /api/mcp — Acme's remote MCP server (Streamable HTTP, stateless).
//
// Stateless on purpose: each request gets a fresh server + transport, so it
// works on serverless without sticky sessions. Clients (Claude, ChatGPT, MCP
// Inspector) negotiate per request; no Mcp-Session-Id is issued. GET (the
// optional SSE channel) is therefore not offered.
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { createServer } from "../mcp/server.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const server = createServer();
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,      // plain JSON replies suit serverless better than SSE
  });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }));
    }
  }
}
