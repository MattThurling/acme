// Single source of truth for the catalogue. The store page fetches
// /products.json, and both /api/finance and the MCP server import this
// module, so prices are always looked up server-side by id — the browser or
// an AI agent can never submit a tampered amount.
import catalogue from "../public/products.json" with { type: "json" };

export const PRODUCTS = catalogue;

export function findProduct(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}

export function formatPrice(amount) {
  return "£" + Number(amount).toLocaleString("en-GB");
}

const WORDS = {
  chair: ["chair-package"],
  surgery: ["chair-package"],
  "treatment centre": ["chair-package"],
  scanner: ["cbct-scanner", "intraoral-scanner"],
  "x-ray": ["panoramic-xray", "cbct-scanner"],
  xray: ["panoramic-xray", "cbct-scanner"],
  imaging: ["cbct-scanner", "panoramic-xray", "intraoral-scanner"],
  mill: ["cadcam-mill"],
  crown: ["cadcam-mill"],
  autoclave: ["sterilisation-suite"],
  steriliser: ["sterilisation-suite"],
  sterilizer: ["sterilisation-suite"],
  decon: ["sterilisation-suite"],
};

/** Case-insensitive catalogue search over name, description, category and a
 *  few dental synonyms. Empty query returns everything. */
export function searchProducts({ query = "", max_price } = {}) {
  const q = String(query || "").trim().toLowerCase();
  let results = PRODUCTS;
  if (q) {
    const synonymHits = new Set();
    for (const [word, ids] of Object.entries(WORDS)) {
      if (q.includes(word)) ids.forEach((id) => synonymHits.add(id));
    }
    const terms = q.split(/\s+/).filter((t) => t.length > 2);
    results = PRODUCTS.filter((p) => {
      if (synonymHits.has(p.id)) return true;
      const hay = `${p.name} ${p.description} ${p.category}`.toLowerCase();
      return terms.some((t) => hay.includes(t));
    });
    if (results.length === 0) results = PRODUCTS; // never leave the agent empty-handed
  }
  if (max_price != null && Number.isFinite(Number(max_price))) {
    results = results.filter((p) => p.price <= Number(max_price));
  }
  return results;
}
