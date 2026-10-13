# Acme Ltd — Medifinance partner demo

A demo dental-equipment supplier showing how a Medifinance partner can take
finance applications through every channel, including AI agents:

1. **A browser agent on the site.** The store is built so an agent (Claude in
   Chrome, ChatGPT agent mode) can drive the guest form reliably: stable
   semantic markup, no native dialogs, closed dialogs really closed.
2. **The supplier's staff inside Claude.** Acme's own MCP connector, installed
   once for the team, lets a rep start an application for a customer without
   leaving the chat. Product and confirmation cards render in the chat.
3. **A customer inside a chat.** The same connector, used by the buyer
   themselves, once consumer apps can discover suppliers automatically.
4. **A human on the site**, signed in as a demo customer or as a guest.

In every case the application is started through the **Medifinance partner
API** (`POST /api/deals/`, contract in `medifinance-app/docs/partner-api.md`)
and Medifinance emails the applicant a secure link to complete it. Nothing is
agreed, approved or charged by anything in this repo.

Static HTML/CSS/JS plus Vercel serverless functions. No framework.

## Layout

| Path | What |
|---|---|
| `public/` | The static site: `index.html`, `portal.html`, `style.css`, `products.json`, `.well-known/` (Vercel serves this directory; functions live in `api/`) |
| `public/products.json` | **The** catalogue. Page, API and MCP server all read it; prices are only ever looked up server-side by id. |
| `lib/finance.js` | Shared "start an application" logic: validation, server-side price, rate limit, Medifinance call, response mapping |
| `lib/medifinance.js` | Partner API client (bearer key stays server-side), idempotency keys, `MEDIFINANCE_MOCK` |
| `lib/ratelimit.js` | In-memory per-IP / per-email limiter (demo only, see comment) |
| `api/finance.js` | `POST /api/finance` for the website |
| `api/mcp.js` | `POST /api/mcp` — the remote MCP server (Streamable HTTP, stateless) |
| `mcp/server.js` | Tools + UI resource registration |
| `mcp/ui/card.html`, `mcp/ui/card.js` | The in-chat card (MCP Apps). `npm run build` bundles them into `mcp/ui/card.generated.js` |
| `public/.well-known/mcp/server-card.json` | MCP discovery (also at `/api/mcp/server-card`) |
| `scripts/dev-server.mjs` | Vercel-alike local server (no Vercel login needed) |
| `tests/` | Playwright site tests and node:test MCP tests |

## Setup

1. **Issue API keys** in the Medifinance admin: create an `ApiKey` for the
   "Acme Ltd" organisation. Ask for a **sandbox** key as well — it validates
   everything but creates no deal and sends no email, so agents and tests can
   hit it freely.
2. Make sure **API access is enabled** in Medifinance site settings
   (`SiteSettings.api_enabled`).

### Local development

```sh
cp .env.example .env     # paste your key into MEDIFINANCE_API_KEY
npm install
npm run dev              # builds the card, then serves http://localhost:3000
```

`npm run dev` uses `scripts/dev-server.mjs`. `npx vercel dev` also works if
you have the Vercel CLI linked; run `npm run build` first.

Set `MEDIFINANCE_MOCK=1` to skip Medifinance entirely and get a fake
`MF-MOCK-…` reference (the tests do this). With a real **sandbox** key you
get `MF-SANDBOX-…` references from the real API with no side effects.

### Deploy

```sh
npm run build && npx vercel
```

Set `MEDIFINANCE_API_URL`, `MEDIFINANCE_API_KEY` and `PUBLIC_ORIGIN` in the
Vercel project. `vercel.json` sets `buildCommand` so the card bundle is built
on deploy. The functions call Medifinance server-to-server, so the URL must be
reachable from Vercel (the dev or production Medifinance host, not localhost).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `MEDIFINANCE_API_URL` | `http://localhost:8000` | Base URL of the Medifinance app |
| `MEDIFINANCE_API_KEY` | — | Bearer key issued to Acme Ltd (sandbox key for dev) |
| `MEDIFINANCE_MOCK` | — | `1` = never call Medifinance; return a fake reference |
| `PUBLIC_ORIGIN` | `https://acme-amber-beta.vercel.app` | This deployment's public origin |

## The website

- **Demo session.** `window.ACME_CUSTOMER` is Jack Jones (signed in) or
  `null` (guest). Toggle with the header link ("Sign out" / "Sign in as
  Jack"), or `?guest=1` / `?signin=1`; the choice persists in `localStorage`.
- **Signed in:** Get Finance is a one-click, read-only confirmation.
- **Guest:** the same dialog shows labelled inputs (first/last name, email,
  company type) with native validation plus inline server errors.
- **Success** shows Medifinance's own message and the application reference.
- Agent-friendliness: `[hidden]` always wins (closed dialog is out of the
  accessibility tree), real `role="dialog"` with focus management and a focus
  trap, unique button names ("Get finance for ErgoDent … (£32,750)"), and a
  toast instead of `alert()`.

`POST /api/finance` accepts `{ source: 'store'|'guest'|'portal', product_id,
first_name, last_name, email, company_type, idempotency_key? }` (legacy
`ltd: true/false` still works) and returns either
`{ ok: true, application_reference, message, status, deduplicated, sandbox, product }`
or `{ ok: false, errors: [{ field, message }], message }`. Guest submissions
are rate-limited per IP and per email (in memory — production needs a shared
store).

## The MCP server

- **Endpoint:** `https://acme-amber-beta.vercel.app/api/mcp` (Streamable
  HTTP, stateless, JSON responses). Locally: `http://localhost:3000/api/mcp`.
- **Auth:** none. The guest flow needs no account. To act as a signed-in
  customer later, put OAuth in front of `/api/mcp` (or use the SDK's
  per-tool `scopeChallenge`) and prefill the applicant from the token; the
  tools don't need to change.
- **Tools**
  - `search_products(query?, max_price?)` — read-only. Returns products and
    renders product cards.
  - `get_product(product_id)` — read-only.
  - `request_finance(product_id, first_name, last_name, email, company_type, agent_client?)`
    — a write (`readOnlyHint: false`, `openWorldHint: true`), so hosts ask the
    user before running it. Calls the same `lib/finance.js` logic as the
    website with `channel: 'mcp'`, returns Medifinance's reference and
    message, and renders a confirmation card. Validation failures come back
    as `isError` results with per-field messages so the model can correct
    itself.
- **In-chat UI** uses the [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps)
  extension (`@modelcontextprotocol/ext-apps`): one resource
  `ui://acme/card.html` (`text/html;profile=mcp-app`) linked from each tool
  via `_meta.ui.resourceUri`. The card shows products with a "Get finance"
  action, an in-card guest form whose Confirm calls `request_finance`
  through the host, and a success card with the reference. ChatGPT implements
  the same standard. Every tool also returns plain text for hosts without UI.
- **Compliance.** The server's instructions and the card never generate
  finance terms. The only customer-facing finance wording is Medifinance's
  `message`, shown verbatim.

### Add it to Claude

Settings → Connectors → **Add custom connector** → name "Acme Ltd", URL
`https://acme-amber-beta.vercel.app/api/mcp`, no auth → Add. Then enable it in
a chat's connector menu.

### Add it to ChatGPT

Settings → Apps & Connectors → Advanced → enable **Developer mode** → Create →
name "Acme Ltd", MCP server URL `https://acme-amber-beta.vercel.app/api/mcp`,
no authentication → Create. Then pick it from the chat's tools menu.

### Discovery

`/.well-known/mcp/server-card.json` (also `/api/mcp/server-card`, the
location recommended by SEP-2127) describes the server, and
`/.well-known/ai-catalog.json` links to it. Pages send
`Link: </.well-known/mcp/server-card.json>; rel="mcp"` and carry a matching
`<link rel="mcp">`. The `Link`/`rel="mcp"` hint is our own convention; the
SEP itself only defines the card and catalog.

## Testing

```sh
npm test               # build + MCP tests + Playwright
npm run test:mcp       # node:test over real Streamable HTTP (MEDIFINANCE_MOCK=1)
npm run test:site      # Playwright: signed-in, guest, a11y tree, validation
npm run inspector      # MCP Inspector — connect to http://localhost:3000/api/mcp
```

First time: `npx playwright install chromium`.

With MCP Inspector: pick **Streamable HTTP**, enter the endpoint, Connect.
Check **Tools → List** shows the three tools with their annotations, call
each one, and under **Resources** read `ui://acme/card.html` and confirm the
MIME type is `text/html;profile=mcp-app`.

No test ever submits to production Medifinance: the suites run with
`MEDIFINANCE_MOCK=1`, and manual testing should use a sandbox key.

## Demo scripts

Three scripts, in pitch order for a supplier audience. All three end with
the same thing: a deal in the Medifinance CRM, attributed to Acme with the
channel recorded, and Medifinance's secure-link email in the applicant's
inbox. Use a Medifinance **sandbox** key if you don't want real emails.

### 1. A browser agent on the site (lead with this)

No connector, no install. This is how a niche supplier's site actually gets
agent traffic.

1. Open Claude in Chrome (or ChatGPT agent mode) and say:
   "Go to acme-amber-beta.vercel.app and apply for finance on a dental chair
   as a guest. The applicant is Priya Patel, priya@smiledental.example,
   a sole trader."
2. The agent signs out of the demo session (or you pre-open `/?guest=1`),
   presses "Get finance for ErgoDent Signature Surgery Package (£32,750)",
   fills the four labelled fields, confirms.
3. The success state shows Medifinance's message and the `MF-…` reference.
4. Point out why it worked first time: unique button names, a dialog that is
   genuinely absent until opened, native inputs with labels, inline error
   text instead of `alert()`. Then show the deal in the Medifinance CRM with
   `channel = web-guest`.

### 2. Supplier staff in Claude (the connector)

One org-wide install; this is the realistic everyday use of the MCP server.

1. With the Acme connector added to Claude (see above), in a fresh chat:
   "Start a finance application for Dr Anjali Patel at Smile Dental,
   drpatel@smiledental.example, limited company, for the OrthoVision CBCT
   scanner."
2. A product card for the OrthoVision 3D CBCT Scanner (£64,500) appears.
   Claude reads the customer's details back and asks to run
   `request_finance`; approve.
3. The success card shows the reference and Medifinance's message. The email
   goes to the customer, not the rep. In the CRM: `channel = mcp`,
   `agent_client = claude`.

### 3. A customer in chat (the closer)

Same server, used by the buyer. Frame it as where this goes once consumer
apps can discover suppliers automatically (the server card is the first step).

1. In a fresh chat: "I'm fitting out a new surgery and need a dental chair —
   can I spread the cost?"
2. A product card for the ErgoDent Signature Surgery Package (£32,750) appears.
3. "Yes, finance that one — I'm Jack Jones, jack@jjdental.com, limited company."
4. Claude asks to run `request_finance`; approve. The success card shows the
   reference and Medifinance's message; the Medifinance email arrives.

**Why not pitch a consumer connector?** A connector only reaches accounts
that have added it, so for a niche supplier it brings almost no end-customer
traffic today. Its value is script 2 (staff) and the proof that the partner
API copes with agent submissions; script 1 is where the reach is.

## Notes

- Medifinance dedups repeat applications (same email within 24h per
  partner) and honours `Idempotency-Key`; the UI shows "Application already
  open" for a dedup.
- Medifinance rate-limits per key and per applicant email; the UI surfaces a
  friendly "try again later" on 429.
- The signed-in personas are hardcoded. There is no real authentication.
