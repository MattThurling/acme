// Acme's MCP server: lets an AI agent (Claude, ChatGPT…) find equipment and
// start a Medifinance finance application on the user's behalf, with
// interactive cards rendered in the chat via the MCP Apps extension.
//
// Auth: none. The guest flow needs no account, so the server is public.
// To "act as the signed-in customer" later, wrap `createServer` in an OAuth
// layer (the SDK's `scopeChallenge` hooks per tool, or an auth proxy in front
// of /api/mcp) and prefill the applicant from the token — the tool surface
// itself doesn't need to change.
import { McpServer } from "@modelcontextprotocol/server";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { PRODUCTS, findProduct, formatPrice, searchProducts } from "../lib/products.js";
import { COMPANY_TYPES, submitFinance } from "../lib/finance.js";
import { CARD_HTML } from "./ui/card.generated.js";

export const SERVER_NAME = "acme-store";
export const SERVER_VERSION = "1.0.0";
export const CARD_URI = "ui://acme/card.html";

const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || "https://acme-amber-beta.vercel.app").replace(/\/+$/, "");

const INSTRUCTIONS = `Acme Ltd is a UK dental equipment supplier. Use these tools when a UK dental or medical practice wants to buy or spread the cost of equipment (chairs, scanners, X-ray, milling, decontamination).

The user may be a practice buying for itself, or a member of Acme staff acting for a customer. In the staff case the applicant details (name, email, company type) are the customer's, not the staff member's: read them back and get the staff member's confirmation before calling request_finance, because the secure link goes to that email.

Flow: search_products or get_product to find the item, then request_finance once the user has confirmed the product and the applicant's first name, last name, email and company type (limited_company, sole_trader or partnership). request_finance starts a finance application with Medifinance, an FCA-regulated broker: Medifinance emails the applicant a secure link to complete it. Nothing is agreed, approved or charged by the tool call.

Compliance: only repeat Medifinance's own wording from the tool result. Never quote or estimate APRs, interest rates, monthly payments or approval odds, and never say the applicant is approved — Medifinance handles all of that through its secure link.`;

const productSummary = (p) => ({
  id: p.id, name: p.name, price: p.price, price_display: formatPrice(p.price),
  category: p.category, description: p.description,
});

const productLine = (p) => `• ${p.name} — ${formatPrice(p.price)} (id: ${p.id}) — ${p.description}`;

export function createServer() {
  const server = new McpServer(
    { name: SERVER_NAME, title: "Acme Ltd Dental Equipment", version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  registerAppTool(
    server,
    "search_products",
    {
      title: "Search Acme equipment",
      description:
        "Search Acme Ltd's dental and medical equipment catalogue (dental chairs and surgery packages, CBCT and intraoral scanners, OPG/ceph X-ray, CAD/CAM milling, decontamination suites). " +
        "Use this first when a UK dental or medical practice wants to buy or finance equipment. Returns matching products with their id, name, price in GBP and description, and shows product cards. " +
        "Leave the query empty to list everything.",
      inputSchema: z.object({
        query: z.string().max(200).optional().describe("Free-text search, e.g. 'dental chair' or 'scanner'. Empty returns all products."),
        max_price: z.number().positive().optional().describe("Only return products at or below this price in GBP."),
      }),
      outputSchema: z.object({
        kind: z.literal("products"),
        products: z.array(z.object({
          id: z.string(), name: z.string(), price: z.number(), price_display: z.string(),
          category: z.string(), description: z.string(),
        })),
        finance_note: z.string(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: CARD_URI } },
    },
    async ({ query, max_price }) => {
      const products = searchProducts({ query, max_price }).map(productSummary);
      const structuredContent = {
        kind: "products",
        products,
        finance_note: "Each product can be financed through Medifinance. Call request_finance with the product id once the user has confirmed and given their details.",
      };
      const text = products.length
        ? `${products.length} product(s) from Acme Ltd:\n${products.map(productLine).join("\n")}\n\nAll can be financed via Medifinance — use request_finance with the product id.`
        : "No products match. Try a broader query or no query to list everything.";
      return { content: [{ type: "text", text }], structuredContent };
    },
  );

  registerAppTool(
    server,
    "get_product",
    {
      title: "Get one Acme product",
      description: "Get full details of one Acme Ltd product by its id (from search_products), including its price in GBP. Shows the product card.",
      inputSchema: z.object({
        product_id: z.string().describe("Product id, e.g. 'chair-package'."),
      }),
      outputSchema: z.object({
        kind: z.literal("product"),
        product: z.object({
          id: z.string(), name: z.string(), price: z.number(), price_display: z.string(),
          category: z.string(), description: z.string(),
        }),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: CARD_URI } },
    },
    async ({ product_id }) => {
      const product = findProduct(product_id);
      if (!product) {
        return {
          isError: true,
          content: [{ type: "text", text: `No product with id '${product_id}'. Known ids: ${PRODUCTS.map((p) => p.id).join(", ")}.` }],
        };
      }
      const p = productSummary(product);
      return {
        content: [{ type: "text", text: `${productLine(product)}\nCategory: ${p.category}. Financing available via request_finance.` }],
        structuredContent: { kind: "product", product: p },
      };
    },
  );

  registerAppTool(
    server,
    "request_finance",
    {
      title: "Start a Medifinance finance application",
      description:
        "Start a finance application with Medifinance (an FCA-regulated UK broker) for one Acme product, on behalf of the applicant: the user themselves, or a customer an Acme staff member is helping. " +
        "Call this only after the user has confirmed the product and the applicant's first name, last name, email address and company type (the applicant's own details, since the secure link is emailed to them). " +
        "Medifinance then emails the applicant a secure link to complete the application; nothing is agreed, approved or charged by this call. " +
        "Returns Medifinance's application reference and its customer message — relay that message verbatim and do not add rates, payment figures or approval claims. " +
        "If it returns validation errors, correct the inputs and call again.",
      inputSchema: z.object({
        product_id: z.string().describe("Product id from search_products, e.g. 'chair-package'."),
        first_name: z.string().min(1).max(150).describe("Applicant's first name."),
        last_name: z.string().min(1).max(150).describe("Applicant's last name."),
        email: z.string().min(3).max(254).describe("Applicant's email address. Medifinance sends the secure application link here."),
        company_type: z.enum(Object.keys(COMPANY_TYPES)).describe("The practice's legal form: limited_company, sole_trader or partnership."),
        agent_client: z.string().max(64).optional().describe("Optional: the AI client making the call, e.g. 'claude' or 'chatgpt'."),
      }),
      outputSchema: z.object({
        kind: z.literal("finance_result"),
        ok: z.boolean(),
        application_reference: z.string().nullable().optional(),
        status: z.string().optional(),
        deduplicated: z.boolean().optional(),
        sandbox: z.boolean().optional(),
        message: z.string(),
        errors: z.array(z.object({ field: z.string().nullable(), message: z.string() })).optional(),
        product: z.object({ id: z.string(), name: z.string(), price: z.number() }).optional(),
        applicant: z.object({ first_name: z.string(), last_name: z.string(), email: z.string(), company_type: z.string() }).optional(),
      }),
      // A write with real-world effect (an email goes out) — hosts should ask
      // the user before running it.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      _meta: { ui: { resourceUri: CARD_URI } },
    },
    async (args) => {
      const { status, body } = await submitFinance({ ...args, channel: "mcp" }, { ip: null });
      const applicant = { first_name: args.first_name, last_name: args.last_name, email: args.email, company_type: args.company_type };
      if (!body.ok) {
        const structuredContent = { kind: "finance_result", ok: false, message: body.message, errors: body.errors, applicant };
        const product = findProduct(args.product_id);
        if (product) structuredContent.product = { id: product.id, name: product.name, price: product.price };
        const text = status === 400
          ? `The application was not started. Fix these and call request_finance again:\n${body.errors.map((e) => `- ${e.field ? e.field + ": " : ""}${e.message}`).join("\n")}`
          : `The application was not started: ${body.message}`;
        return { isError: true, content: [{ type: "text", text }], structuredContent };
      }
      const structuredContent = {
        kind: "finance_result",
        ok: true,
        application_reference: body.application_reference,
        status: body.status,
        deduplicated: body.deduplicated,
        sandbox: body.sandbox,
        message: body.message,
        product: body.product,
        applicant,
      };
      const text =
        `Finance application started with Medifinance for ${body.product.name} (${formatPrice(body.product.price)}).\n` +
        `Application reference: ${body.application_reference}\n` +
        `Medifinance says: "${body.message}"` +
        (body.sandbox ? "\n(Sandbox/mock mode: no real application was created and no email was sent.)" : "");
      return { content: [{ type: "text", text }], structuredContent };
    },
  );

  registerAppResource(
    server,
    "Acme product and finance cards",
    CARD_URI,
    { description: "Interactive product, finance and confirmation cards for Acme Ltd tools.", mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: CARD_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: CARD_HTML,
          _meta: { ui: { prefersBorder: true } },
        },
      ],
    }),
  );

  return server;
}

export { PUBLIC_ORIGIN };
