// POST /api/finance — create a finance application (a Medifinance deal).
// Used by both the shop's Get Finance modal and the staff portal.
import { PRODUCTS, API_BASE, apiHeaders } from "../lib/products.js";

const SOURCES = { store: "online store", portal: "staff portal" };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "POST only." });
  }

  const body = req.body || {};
  const product = PRODUCTS.find((p) => p.id === body.product_id);
  const firstName = String(body.first_name || "").trim();
  const lastName = String(body.last_name || "").trim();
  const email = String(body.email || "").trim();
  const source = SOURCES[body.source] || SOURCES.store;

  if (!product || !firstName || !lastName || !email) {
    return res.status(400).json({ ok: false, message: "Please fill in all the fields." });
  }

  let resp;
  try {
    resp = await fetch(`${API_BASE}/api/deals/`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        name: `${product.name} — Acme Ltd (${source})`,
        amount: product.price,
        first_name: firstName,
        last_name: lastName,
        email,
        ltd: Boolean(body.ltd),
      }),
    });
  } catch {
    return res.status(502).json({
      ok: false,
      message: "Could not reach the finance provider. Please try again shortly.",
    });
  }

  const data = await resp.json().catch(() => ({}));

  if (resp.status === 200 || resp.status === 201) {
    return res.status(200).json({
      ok: true,
      deal_id: data.id,
      deduplicated: Boolean(data.deduplicated),
      message: data.deduplicated
        ? "We already have a recent application for this email address — check your inbox for the application link."
        : "Application received! Check your email for a secure link to complete your finance application.",
    });
  }

  const friendly = {
    400: data.detail || "Some of the details were invalid.",
    401: "Finance service authorisation failed — Acme's API key is missing or has been revoked.",
    429: "Too many applications submitted just now — please try again in a little while.",
    503: "Finance applications are temporarily unavailable.",
  };
  return res.status(resp.status).json({
    ok: false,
    message: friendly[resp.status] || "Something went wrong submitting your application.",
  });
}
