# Acme Ltd — Medifinance API demo

A demo dental-equipment supplier site showing how a partner integrates with
the **Medifinance public API**. Static HTML/CSS/JS plus one Vercel serverless
function:

- **Store** (`/`) — customer-facing product list with **Buy Now** and
  **Get Finance** buttons. The demo pretends a customer is already signed in
  (Jack Jones of JJ Dental Ltd), so Get Finance is a one-click confirmation:
  it creates a deal via `POST /api/deals/` using the account details Acme
  already holds, and the customer then receives Medifinance's portal
  magic-link email.
- **Staff portal** (`/portal`) — an Acme admin (John Doe in the demo) enters
  a sale and the customer's details on their behalf; same deal-create call.

The serverless function (`api/finance.js`) proxies the Medifinance API so the
bearer key stays server-side — it is never exposed to the browser, and
amounts are looked up by product id so they can't be tampered with
client-side.

## Setup

1. **Issue an API key** in the Medifinance admin: create an `ApiKey` for the
   "Acme Ltd" organisation (create the organisation first if needed). The raw
   `mfk_…` key is shown once in the flash message — copy it.
2. Make sure **API access is enabled** in Medifinance site settings
   (`SiteSettings.api_enabled`).

### Local development

```sh
cp .env.example .env   # then paste your key into MEDIFINANCE_API_KEY
npx vercel dev
```

With the Medifinance app running on `http://localhost:8000`, open the URL
`vercel dev` prints (usually <http://localhost:3000>).

### Deploy

```sh
npx vercel
```

Set `MEDIFINANCE_API_URL` and `MEDIFINANCE_API_KEY` as environment variables
in the Vercel project settings. Note the deployed functions call the
Medifinance API server-to-server, so `MEDIFINANCE_API_URL` must be a URL
reachable from Vercel (i.e. the production Medifinance host, not localhost).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `MEDIFINANCE_API_URL` | `http://localhost:8000` | Base URL of the Medifinance app |
| `MEDIFINANCE_API_KEY` | — | Bearer key issued to Acme Ltd |

## Notes

- The Medifinance API dedups repeat applications (same email within 24h) —
  the UI reports this as "we already have your application".
- Medifinance rate-limits deal creation per key (5/hour, 25/day); the UI
  surfaces a friendly "try again later" message on 429.
- The signed-in users on both pages are hardcoded personas — there is no real
  authentication. This is a demo.
