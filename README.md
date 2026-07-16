# Acme Ltd — Medifinance API demo

A demo dental-equipment supplier site showing how a partner integrates with
the **Medifinance public API**. Two pages:

- **Store** (`/`) — customer-facing product list. Each product shows an
  indicative "from £X/month" price (live from `POST /api/quotes/`) with
  **Buy Now** and **Get Finance** buttons. Get Finance opens a short form
  that creates a deal via `POST /api/deals/`; the customer then receives
  Medifinance's portal magic-link email.
- **Staff portal** (`/portal`) — Acme staff enter a sale on behalf of a
  customer; same `POST /api/deals/` call, server-rendered.

Both API calls are proxied through this Flask app so the bearer key stays
server-side and is never exposed to the browser.

## Setup

1. **Issue an API key** in the Medifinance admin: create an `ApiKey` for the
   "Acme Ltd" organisation (create the organisation first if needed). The raw
   `mfk_…` key is shown once in the flash message — copy it.
2. Make sure **API access is enabled** in Medifinance site settings
   (`SiteSettings.api_enabled`).
3. Configure and run this app:

   ```sh
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env   # then paste your key into MEDIFINANCE_API_KEY
   python app.py
   ```

4. With the Medifinance app running on `http://localhost:8000`, open
   <http://localhost:5001>.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `MEDIFINANCE_API_URL` | `http://localhost:8000` | Base URL of the Medifinance app |
| `MEDIFINANCE_API_KEY` | — | Bearer key issued to Acme Ltd |
| `PORT` | `5001` | Port for this demo site |

## Notes

- Monthly prices are quoted over 60 months and cached for 5 minutes; products
  with no covering rate band simply omit the finance price.
- The API dedups repeat applications (same email within 24h) — the UI reports
  this as "we already have your application".
- Medifinance rate-limits deal creation per key (5/hour, 25/day); the UI
  surfaces a friendly "try again later" message on 429.
- The staff portal is deliberately unauthenticated — this is a demo.
