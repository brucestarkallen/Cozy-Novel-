/* Cozy Novel — js/model/usage.js — what a row of Usage and cost comes to
 * (pure; Cozy Tavern's engine/usage.js). */

/* The money for a row (Cozy Tavern's M510-25): the connection's prices as they
 * stand, or — a connection let go since — the prices it had when its calls
 * were made. Input from the provider's cache at the cached price (the input
 * price when none is set); Claude's writes into its cache at 1.25 times the
 * input price, as Anthropic charges them. Null when no price is set. */
export function costOf(row, conn) {
  const src = conn ? { in: conn.priceIn, out: conn.priceOut, cached: conn.priceCached } : ((row && row.prices) || {});
  const p = (v) => (Number.isFinite(v) ? v : null);
  const pin = p(src.in);
  const pout = p(src.out);
  const pcached = p(src.cached);
  if (pin === null && pout === null) return null;
  const all = Math.max(0, Number(row.in) || 0);
  const cached = Math.min(Math.max(0, Number(row.cached) || 0), all);
  const write = Math.min(Math.max(0, Number(row.cacheWrite) || 0), all - cached);
  const plain = all - cached - write;
  return (plain * (pin || 0) + cached * (pcached !== null ? pcached : (pin || 0)) + write * (pin || 0) * (row.anthropic ? 1.25 : 1) + Math.max(0, Number(row.out) || 0) * (pout || 0)) / 1e6;
}
/* a day's row added to a period's: its counts summed, the newest prices it had kept */
export function addRow(t, r) {
  for (const k of ['calls', 'in', 'out', 'cached', 'cacheWrite', 'estimated']) t[k] = (t[k] || 0) + (Number(r[k]) || 0);
  if (r.anthropic === true) t.anthropic = true;
  if (r.prices && typeof r.prices === 'object') t.prices = r.prices;
  return t;
}
