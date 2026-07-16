// GET /api/quotes — indicative monthly price per product, via the Medifinance
// quote API. Cached at Vercel's edge for 5 minutes so a page load doesn't
// fan out to the quotes endpoint on every visit.
import { PRODUCTS, QUOTE_TERM_MONTHS, API_BASE, apiHeaders } from "../lib/products.js";

export default async function handler(req, res) {
  const quotes = await Promise.all(
    PRODUCTS.map(async (product) => {
      try {
        const resp = await fetch(`${API_BASE}/api/quotes/`, {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({
            amount: product.price,
            term_months: QUOTE_TERM_MONTHS,
          }),
        });
        if (!resp.ok) return null;
        const quote = await resp.json();
        return {
          id: product.id,
          monthly_payment: quote.monthly_payment,
          apr: quote.apr,
          term_months: QUOTE_TERM_MONTHS,
        };
      } catch {
        return null;
      }
    }),
  );
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.status(200).json({ quotes: quotes.filter(Boolean) });
}
