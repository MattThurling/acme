// Minimal in-memory sliding-window limiter for guest/agent submissions.
//
// DEMO ONLY: this lives in one serverless instance's memory, so limits reset
// on cold start and aren't shared across instances or regions. Production
// needs a shared store (Vercel KV / Upstash Redis / Postgres) keyed the same
// way. Medifinance also enforces its own per-key and per-email limits
// upstream, so this is a first line of defence, not the only one.

const buckets = new Map();

export function createLimiter({ windowMs, max }) {
  return function hit(key) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const stamps = (buckets.get(key) || []).filter((t) => t > cutoff);
    if (stamps.length >= max) {
      const retryAfterSec = Math.ceil((stamps[0] + windowMs - now) / 1000);
      buckets.set(key, stamps);
      return { allowed: false, retryAfterSec };
    }
    stamps.push(now);
    buckets.set(key, stamps);
    if (buckets.size > 5000) prune(cutoff);
    return { allowed: true, retryAfterSec: 0 };
  };
}

function prune(cutoff) {
  for (const [k, v] of buckets) {
    const kept = v.filter((t) => t > cutoff);
    if (kept.length) buckets.set(k, kept); else buckets.delete(k);
  }
}

/** Test hook. */
export function resetLimiters() {
  buckets.clear();
}
