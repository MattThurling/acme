# Acme Ltd — Medifinance API demo

A demo dental-equipment supplier site showing how a partner integrates with
the **Medifinance public API**. Static HTML/CSS/JS plus two Vercel serverless
functions:

- **Store** (`/`) — customer-facing product list. Each product shows an
  indicative "from £X/month" price (live from Medifinance `POST /api/quotes/`)
  with **Buy Now** and **Get Finance** buttons. Get Finance opens a short form
  that creates a deal via `POST /api/deals/`; the customer then receives
  Medifinance's portal magic-link email.
- **Staff portal** (`/portal`) — Acme staff enter a sale on behalf of a
  customer; same deal-create call.

The serverless functions (`api/quotes.js`, `api/finance.js`) proxy the
Medifinance API so the bearer key stays server-side — it is never exposed to
the browser, and amounts are looked up by product id so they can't be
tampered with client-side.

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

- Monthly prices are quoted over 60 months; `/api/quotes` responses are
  edge-cached for 5 minutes. Products with no covering rate band simply omit
  the finance price.
- The Medifinance API dedups repeat applications (same email within 24h) —
  the UI reports this as "we already have your application".
- Medifinance rate-limits deal creation per key (5/hour, 25/day); the UI
  surfaces a friendly "try again later" message on 429.
- The staff portal is deliberately unauthenticated — this is a demo.
