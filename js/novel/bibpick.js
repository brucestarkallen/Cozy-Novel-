/* Cozy Novel — js/novel/bibpick.js — WHAT A PAGE NEEDS FROM THE BIBLIOGRAPHY, BY WHAT IT MEANS
 *
 * His question (2.12.27): "is anything only injected when it is mentioned, or is the injection of the bible smart —
 * it knows what to inject?" An entry rides when its name comes up (bibliography.js ridingItems). One the page needs
 * that no word near it names — the order the city guard answers to when the guard storms the docks, how magic works
 * when a spell is cast, a faction's leader when its banner goes up — is found here by what it means, as Cozy Tavern's
 * smart recall finds the record's lines (agents/recallpick.js, M510-50):
 *
 * before a page of the writer's, and before each telling of the narrator's, the helper reads his own words for it,
 * the chapter's plan and the words right before the point against his entries that would not ride — each by its name,
 * the names it goes by, its kind and its line — and names the ones the page needs (context.js pickInput, prompts.js
 * pickRequest). Careful by construction: it only names; what rides is his entry, word for word, after the ones his
 * own words name. A number not on the list is nothing, five at most, and it waits PICK_TIMEOUT_MS at most — slower,
 * failing or unsure, and the page goes with the names alone, as before. The same moment asked again (another take of
 * the same page) is answered from what it named the first time. Nothing to pick from (no entries, or every one rides
 * already or is his alone): no call at all. Never the partner's (it sees every entry and opens any whole) and never
 * the checker's (it holds a page to what the page names).
 */
import { ask } from '../model/call.js';
import { contextOf } from '../model/providers.js';
import { hashText } from '../util.js';
import { pickInput } from './context.js';
import { pickRequest } from './prompts.js';
import { readPick } from './bibliography.js';

export const PICK_TIMEOUT_MS = 8000;

/* what it named for a moment, kept by the very words it was asked (a bound on how many) */
const named = new Map();
const KEEP = 60;

/* {refs, asked}: refs — his entries the page needs, as bibliography refs ('e:<id>'); asked — whether a call went out.
 * conn: the helper's connection (writer.js connFor(house, 'helper')); the rest as assemble takes them. */
export async function pickEntries({ conn, house, novel, chapters, purpose = 'write', target = {}, request = '', moment = '', turns = [], play = null, signal = null, timeoutMs = PICK_TIMEOUT_MS }) {
  if (!conn || (purpose !== 'write' && purpose !== 'play')) return { refs: [], asked: false };
  if (signal && signal.aborted) return { refs: [], asked: false };
  let input = null;
  /* the list of his entries fitted to the helper's own room, beside the words it reads (Cozy Tavern's index, held to the picker's room) */
  const cap = Math.max(800, Math.min(6000, Math.floor(contextOf(conn) * 0.25)));
  try { input = pickInput({ house, novel, chapters, purpose, target, request, moment, turns, play, cap }); } catch (e) { console.error(e); return { refs: [], asked: false }; }
  if (!input || !input.rows.length) return { refs: [], asked: false };
  const { system, user } = pickRequest({ house, novel: input.novel, purpose, rows: input.rows, riding: input.riding, moment: input.moment, plan: input.plan, near: input.near });
  const key = hashText(`${conn.id || ''}\u0001${conn.model || ''}\u0001${system}\u0001${user}`);
  if (named.has(key)) return { refs: named.get(key), asked: false };
  const ctl = new AbortController();
  /* the page never waits past the time, nor past Stop, whatever the call does on its way out (Cozy Tavern's race) */
  let done = null;
  const over = new Promise((resolve) => { done = () => { ctl.abort(); resolve(null); }; });
  if (signal) signal.addEventListener('abort', done, { once: true });
  const timer = setTimeout(done, Math.max(0, timeoutMs));
  try {
    /* a helper's call: his settings as he set them, his Longest reply if he set one, nothing he did not */
    const asking = ask(conn, { build: () => ({ system, messages: [{ role: 'user', content: user }], maxTokens: Number.isFinite(conn.maxTokens) ? conn.maxTokens : undefined }), stream: true, worker: true, noStructured: true, noSearch: true, signal: ctl.signal }).catch(() => null);
    const out = await Promise.race([asking, over]);
    if (!out || !out.ok) return { refs: [], asked: true };
    /* its answer; one written only in the thinking is read from there (as every helper's answer is) */
    const said = String(out.text || '');
    const refs = /"entries"\s*:/.test(said) ? readPick(said, input.rows) : readPick(String(out.thinking || ''), input.rows);
    if (named.size >= KEEP) named.delete(named.keys().next().value);
    named.set(key, refs);
    return { refs, asked: true };
  } catch (e) {
    return { refs: [], asked: true };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', done);
  }
}
