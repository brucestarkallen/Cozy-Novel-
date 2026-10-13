/* Cozy Novel — tests/thinking.mjs
 * The thinking layer held to Cozy Tavern's REAL output: every case in
 * fixtures/tavern-thinking.json was produced by running Tavern's own
 * requestBody (CozyMaker recorded them). buildRequest must say the same. */
import fs from 'node:fs';
import { buildRequest } from '../js/model/providers.js';

const KEYS = ['thinking', 'reasoning_effort', 'reasoning', 'enable_thinking', 'model_options', 'output_config', 'temperature', 'top_p'];
const { cases } = JSON.parse(fs.readFileSync(new URL('./fixtures/tavern-thinking.json', import.meta.url)));
let same = 0; const failed = [];
for (const { conn, want } of cases) {
  const r = buildRequest({ key: 'k', ...conn }, { system: 's', messages: [{ role: 'user', content: 'x' }] });
  const got = {};
  for (const k of KEYS) if (k in r.body) got[k] = r.body[k];
  if (r.body.thinking && r.body.thinking.budget_tokens) got.maxAboveBudget = r.body.max_tokens > r.body.thinking.budget_tokens;
  if (JSON.stringify(got) === JSON.stringify(want)) same++;
  else failed.push(`${conn.model} at ${conn.url} [${conn.thinking}] — Tavern ${JSON.stringify(want)}, here ${JSON.stringify(got)}`);
}
/* his rule: nothing set, nothing sent — on every connection in the grid */
const pairs = [...new Map(cases.map((c) => [c.conn.url + '|' + c.conn.model, c.conn])).values()];
const leaks = pairs.filter((c) => {
  const b = buildRequest({ key: 'k', url: c.url, model: c.model }, { messages: [{ role: 'user', content: 'x' }] }).body;
  return KEYS.slice(0, 6).some((k) => k in b) || 'temperature' in b || 'top_p' in b || 'max_tokens' in b && !/anthropic/.test(c.url);
});
console.log(`thinking parity: ${same} of ${cases.length} say what Cozy Tavern says; nothing-set leaks on ${leaks.length} of ${pairs.length} connections`);
for (const f of failed.slice(0, 20)) console.log('  ✗ ' + f);
for (const l of leaks.slice(0, 10)) console.log('  ✗ leak ' + l.model + ' ' + l.url);
process.exit(failed.length || leaks.length ? 1 : 0);
