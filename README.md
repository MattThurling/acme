# Acme Ltd — Medifinance partner demo

A demo dental-equipment supplier showing three ways a practice can get
Medifinance asset finance, from most to least futuristic:

1. **Inside an AI chat, no browser.** Claude or ChatGPT with the Acme MCP
   connector: product and finance cards render in the chat and the
   application is sent without leaving it.
2. **A browser agent on the site.** The store is built so an agent can drive
   it reliably (stable semantic markup, no native dialogs, closed dialogs
   really closed).
3. **A human on the site**, signed in as a demo customer or as a guest.

In every case the application is started through the **Medifinance partner
API** (`POST /api/deals/`, contract in `medifinance-app/docs/partner-api.md`)
and Medifinance emails the applicant a secure link to complete it. Nothing is
agreed, approved or charged by anything in this repo.

Static HTML/CSS/JS plus Vercel serverless functions. No framework.

## Layout

| Path | What |
|---|---|
| `index.html`, `portal.html`, `style.css` | Store and staff portal pages |
| `products.json` | **The** catalogue. Page, API and MCP server all read it; prices are only ever looked up server-side by id. |
| `lib/finance.js` | Shared "start an application" logic: validation, server-side price, rate limit, Medifinance call, response mapping |
| `lib/medifinance.js` | Partner API client (bearer key stays server-side), idempotency keys, `MEDIFINANCE_MOCK` |
| `lib/ratelimit.js` | In-memory per-IP / per-email limiter (demo only, see comment) |
| `api/finance.js` | `POST /api/finance` for the website |
| `api/mcp.js` | `POST /api/mcp` — the remote MCP server (Streamable HTTP, stateless) |
| `mcp/server.js` | Tools + UI resource registration |
| `mcp/ui/card.html`, `mcp/ui/card.js` | The in-chat card (MCP Apps). `npm run build` bundles them into `mcp/ui/card.generated.js` |
| `.well-known/mcp/server-card.json` | MCP discovery (also at `/api/mcp/server-card`) |
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

## Demo script

1. In Claude, with the Acme connector added, in a fresh chat:
   "I'm fitting out a new surgery and need a dental chair — can I spread the cost?"
2. A product card for the ErgoDent Signature Surgery Package (£32,750) appears.
3. "Yes, finance that one — I'm Jack Jones, jack@jjdental.com, limited company."
4. Claude asks to run `request_finance`; approve. The success card shows the
   reference and Medifinance's message; the Medifinance email arrives.
5. The same request by a browser agent on the website as a guest
   (`/?guest=1`) also completes cleanly.

## Notes

- Medifinance dedups repeat applications (same email within 24h per
  partner) and honours `Idempotency-Key`; the UI shows "Application already
  open" for a dedup.
- Medifinance rate-limits per key and per applicant email; the UI surfaces a
  friendly "try again later" on 429.
- The signed-in personas are hardcoded. There is no real authentication.
