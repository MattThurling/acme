// Medifinance partner API client. The bearer key stays server-side; the
// contract is documented in medifinance-app/docs/partner-api.md.
import { createHash, randomUUID } from "node:crypto";

export const API_BASE = (process.env.MEDIFINANCE_API_URL || "http://localhost:8000")
  .replace(/\/+$/, "");
export const API_KEY = process.env.MEDIFINANCE_API_KEY || "";
export const MOCK = process.env.MEDIFINANCE_MOCK === "1";

export const apiHeaders = (idempotencyKey) => ({
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
  ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
});

/** Stable key for an attempt. Callers that can (the website) pass a UUID
 *  minted when the user pressed Confirm, so a network retry replays the
 *  original result. Agents can't be trusted to do that, so for them we derive
 *  the key from the submission itself plus the hour, which collapses rapid
 *  retries of the same approved request into one application. */
export function deriveIdempotencyKey(payload) {
  const hour = new Date().toISOString().slice(0, 13);
  const canonical = JSON.stringify({
    p: payload.product_id, e: payload.email.toLowerCase(), f: payload.first_name,
    l: payload.last_name, c: payload.company_type, ch: payload.channel, hour,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function newIdempotencyKey() {
  return randomUUID();
}

/**
 * POST /api/deals/. Returns `{ status, data }` where `data` is the parsed
 * JSON body (or `{}`), or throws on a network failure.
 */
export async function createApplication(payload, { idempotencyKey } = {}) {
  if (MOCK) return mockCreate(payload);

  const resp = await fetch(`${API_BASE}/api/deals/`, {
    method: "POST",
    headers: apiHeaders(idempotencyKey),
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  return { status: resp.status, data };
}

function mockCreate(payload) {
  const ref = "MF-MOCK-" + createHash("sha1").update(payload.email).digest("hex").slice(0, 6).toUpperCase();
  return {
    status: 201,
    data: {
      id: null,
      name: payload.description || payload.name,
      amount: Number(payload.amount).toFixed(2),
      deduplicated: false,
      application_reference: ref,
      status: "awaiting_customer",
      // Same wording Medifinance returns, so the demo reads identically.
      message: `We've emailed ${payload.email} a secure link to complete the finance application. Nothing is agreed or charged at this stage.`,
      sandbox: true,
    },
  };
}
