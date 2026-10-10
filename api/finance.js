// POST /api/finance — start a finance application (a Medifinance deal).
// Used by the store's Get Finance dialog (signed-in or guest) and the staff
// portal. All real logic lives in lib/finance.js, shared with the MCP server.
import { submitFinance } from "../lib/finance.js";

const CHANNEL_FOR_SOURCE = { store: "web", guest: "web-guest", portal: "web" };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, errors: [{ field: null, message: "POST only." }], message: "POST only." });
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || null;

  const { status, body: out } = await submitFinance(
    { ...body, channel: body.channel || CHANNEL_FOR_SOURCE[body.source] || "web" },
    { ip },
  );
  if (out.retry_after) res.setHeader("Retry-After", String(out.retry_after));
  return res.status(status).json(out);
}
