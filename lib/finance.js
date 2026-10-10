// Shared "start a finance application" logic used by POST /api/finance (the
// website, signed-in or guest) and by the MCP server's `request_finance`
// tool. Validates, looks the price up server-side, rate-limits, calls
// Medifinance, and maps the result to one stable shape for every caller:
//
//   { ok: true,  application_reference, message, status, deduplicated, sandbox, product }
//   { ok: false, errors: [{ field, message }], message, retry_after? }
import { findProduct } from "./products.js";
import { createApplication, deriveIdempotencyKey, newIdempotencyKey } from "./medifinance.js";
import { createLimiter } from "./ratelimit.js";

export const CHANNELS = ["web", "web-guest", "mcp"];

export const COMPANY_TYPES = {
  limited_company: "Limited company",
  sole_trader: "Sole trader",
  partnership: "Partnership",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 150;

// Per visitor (IP) and per applicant email, per hour. Generous enough for a
// live demo, tight enough that one script can't spray applications.
const perIp = createLimiter({ windowMs: 60 * 60 * 1000, max: 20 });
const perEmail = createLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

/** Validate raw input (from JSON or a tool call). Returns
 *  `{ ok: true, value }` or `{ ok: false, errors }`. */
export function validateFinanceRequest(input = {}) {
  const errors = [];
  const str = (v) => (typeof v === "string" ? v.trim() : "");

  const product = findProduct(str(input.product_id));
  if (!product) {
    errors.push({ field: "product_id", message: "Choose a product from the catalogue (use search_products or the store page to find its id)." });
  }

  const first_name = str(input.first_name);
  if (!first_name) errors.push({ field: "first_name", message: "Enter the applicant's first name." });
  else if (first_name.length > MAX_NAME) errors.push({ field: "first_name", message: `First name must be ${MAX_NAME} characters or fewer.` });

  const last_name = str(input.last_name);
  if (!last_name) errors.push({ field: "last_name", message: "Enter the applicant's last name." });
  else if (last_name.length > MAX_NAME) errors.push({ field: "last_name", message: `Last name must be ${MAX_NAME} characters or fewer.` });

  const email = str(input.email);
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    errors.push({ field: "email", message: "Enter a valid email address — the secure application link is sent there." });
  }

  // `company_type` is the field; `ltd: true/false` is still accepted from
  // older callers and mapped onto it.
  let company_type = str(input.company_type);
  if (!company_type && typeof input.ltd === "boolean") {
    company_type = input.ltd ? "limited_company" : "sole_trader";
  }
  if (!COMPANY_TYPES[company_type]) {
    errors.push({ field: "company_type", message: `Choose a company type: ${Object.keys(COMPANY_TYPES).join(", ")}.` });
  }

  let channel = str(input.channel) || "web";
  if (!CHANNELS.includes(channel)) channel = "web";

  const agent_client = str(input.agent_client).slice(0, 64);
  const idempotency_key = str(input.idempotency_key).slice(0, 255);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { product, first_name, last_name, email, company_type, channel, agent_client, idempotency_key },
  };
}

/**
 * The whole flow. `ip` is used for the per-visitor limit; pass whatever the
 * caller knows (null for MCP calls where the host's IP is meaningless).
 */
export async function submitFinance(input, { ip = null } = {}) {
  const checked = validateFinanceRequest(input);
  if (!checked.ok) {
    return { status: 400, body: { ok: false, errors: checked.errors, message: summarise(checked.errors) } };
  }
  const v = checked.value;

  const emailHit = perEmail(v.email.toLowerCase());
  const ipHit = ip ? perIp(ip) : { allowed: true, retryAfterSec: 0 };
  if (!emailHit.allowed || !ipHit.allowed) {
    const retry = Math.max(emailHit.retryAfterSec, ipHit.retryAfterSec);
    const message = "Too many finance applications just now. If you already applied, check your inbox for the Medifinance link; otherwise try again in a little while.";
    return { status: 429, body: { ok: false, errors: [{ field: null, message }], message, retry_after: retry } };
  }

  const payload = {
    description: `${v.product.name} — Acme Ltd`,
    amount: v.product.price,
    first_name: v.first_name,
    last_name: v.last_name,
    email: v.email,
    company_type: v.company_type,
    ltd: v.company_type === "limited_company", // v1 field, kept for older API deploys
    channel: v.channel,
    ...(v.agent_client ? { agent_client: v.agent_client } : {}),
    product_id: v.product.id,
    asset_category: v.product.category,
  };
  const idempotencyKey = v.idempotency_key || (v.channel === "mcp" ? deriveIdempotencyKey(payload) : newIdempotencyKey());

  let result;
  try {
    result = await createApplication(payload, { idempotencyKey });
  } catch {
    const message = "Could not reach the finance provider. Please try again shortly.";
    return { status: 502, body: { ok: false, errors: [{ field: null, message }], message } };
  }

  return mapMedifinanceResponse(result, v.product);
}

function mapMedifinanceResponse({ status, data }, product) {
  const productOut = { id: product.id, name: product.name, price: product.price };

  if (status === 200 || status === 201) {
    return {
      status: 200,
      body: {
        ok: true,
        application_reference: data.application_reference || (data.id ? `MF-${data.id}` : null),
        deal_id: data.id ?? null, // legacy field the staff portal shows
        status: data.status || "awaiting_customer",
        deduplicated: Boolean(data.deduplicated),
        sandbox: Boolean(data.sandbox),
        // Medifinance's approved customer wording — show verbatim, never embellish.
        message: data.message || "Application received. Check your email for a secure link from Medifinance to complete it.",
        product: productOut,
      },
    };
  }

  // Structured errors from Medifinance map straight through; its field names
  // match ours except `amount`/`description`, which the visitor never typed.
  if ((status === 400 || status === 422) && Array.isArray(data.errors) && data.errors.length) {
    const errors = data.errors.map((e) => ({
      field: ["amount", "description", "name"].includes(e.field) ? "product_id" : e.field,
      message: e.message,
    }));
    return { status: 400, body: { ok: false, errors, message: summarise(errors) } };
  }

  const generic = {
    401: "Finance service authorisation failed — Acme's API key is missing or has been revoked.",
    409: "This request was already submitted with different details. Start a new application.",
    429: data.detail || "Too many applications submitted just now — please try again in a little while.",
    503: "Finance applications are temporarily unavailable.",
  };
  const message = generic[status] || data.detail || "Something went wrong submitting your application.";
  return { status: status >= 400 && status < 600 ? status : 502, body: { ok: false, errors: [{ field: null, message }], message } };
}

function summarise(errors) {
  return errors.map((e) => e.message).join(" ");
}
