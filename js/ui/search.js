/* Cozy Novel — js/ui/search.js — SEARCH: any words, anywhere in the book —
 * or in every book on the shelf. Each place they stand, with the words
 * either side; a tap goes there (the page goes to the passage and marks the
 * words; a card of the notes opens; the partner or a scene opens at the turn). */

import * as store from '../store.js';
import { searchBookAsync, searchSaid, searchOrder, yieldSearch } from '../novel/search.js';
import { h, openSheet, toast } from './dom.js';
import * as talk from '../novel/talk.js';
import { debounce } from '../util.js';
import * as desk from './desk.js';
import { showCard, showTurn } from './panes.js';
import { showRef } from './bibliography.js';

let hooks = {};
const Q = { scope: 'book', query: '' };

export function initSearch(appHooks) { hooks = appHooks; }

/* everything of a book a search reads, opened from the phone if it is not here yet */
async function bookOf(novelId, current) {
  const novel = store.peek('novel', novelId) || await store.open('novel', novelId).catch(() => null);
  if (!novel || !current()) return null;
  const chapters = {};
  /* a chapter the phone did not answer for is counted, and said: never searched as if it were empty */
  let lost = 0;
  await Promise.all((novel.order || []).map(async (id) => { const c = store.peek('chapter', id) ?? await store.open('chapter', id).catch(() => null); if (c) chapters[id] = c; else lost++; }));
  if (!current()) return null;
  const talk = store.peek('talk', novelId) ?? await store.open('talk', novelId).catch(() => null);
  if (!current()) return null;
  const plays = [];
  for (const id of novel.plays || []) {
    const p = store.peek('play', id) ?? await store.open('play', id).catch(() => null);
    if (!current()) return null;
    if (p) plays.push(p);
  }
  return { novel, chapters, talk, plays, lost };
}

export function openSearch({ query = null } = {}) {
  const novelId = hooks.currentNovel();
  if (!novelId) return;
  /* opened for words already chosen (a name's Every place): those words, in this book */
  if (typeof query === 'string' && query.trim()) { Q.query = query.trim(); Q.scope = 'book'; }
  let ticket = 0, closed = false, focusTimer = null, later = null;
  const s = openSheet('Search', { onClose: () => {
    closed = true;
    ticket++;
    clearTimeout(focusTimer);
    if (later) later.cancel();
  } });
  s.box.classList.add('searchsheet');
  const input = h('input', { type: 'search', placeholder: 'Words to find…', 'aria-label': 'Words to find', autocomplete: 'off', enterkeyhint: 'search', value: Q.query });
  const seg = h('div.segmented', { role: 'group', 'aria-label': 'Where to search' });
  for (const [k, l] of [['book', 'This book'], ['all', 'All books']]) {
    seg.append(h('button', { 'data-scope': k, 'aria-pressed': String(Q.scope === k), onclick: () => {
      Q.scope = k;
      for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.scope === k));
      later.cancel();
      run();
    } }, l));
  }
  const say = h('p.say.searchsay', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const results = h('div.results', { 'aria-busy': 'false' });
  s.body.append(h('div.searchtop', input, seg), say, results);
  focusTimer = setTimeout(() => { if (!closed) input.focus(); }, 60);
  const run = async () => {
    if (closed) return;
    const me = ++ticket;
    const current = () => !closed && me === ticket;
    Q.query = input.value;
    const q = input.value.trim();
    const scope = Q.scope;
    results.setAttribute('aria-busy', String(Boolean(q)));
    if (!q) { results.replaceChildren(); say.textContent = scope === 'all' ? 'Type to search every book on the shelf.' : 'Type to search the whole book — its passages, chapter names, notes, bibliography, what it’s about, the partner and the scenes.'; return; }
    let ids = [novelId];
    /* what could not be read is said — never taken for words that are not there (Cozy Tavern A8) */
    let unread = 0;
    let noShelf = false;
    say.textContent = scope === 'all' ? 'Reading your books…' : 'Searching this book…';
    if (scope === 'all') {
      let rows = [];
      try { rows = await store.listNovels(); } catch (_) { rows = []; noShelf = true; }
      if (!current()) return;
      ids = searchOrder(novelId, rows);
    }
    if (!current()) return;
    let total = 0, searched = 0, lost = 0;
    const LIMIT = 400;
    const next = document.createDocumentFragment();
    /* Keep the previous result still while the new one is prepared. Read
     * books in shelf order only until the result limit is full; a common
     * word must not load and scan the rest of the library unnecessarily. */
    for (const id of ids) {
      const b = await bookOf(id, current);
      if (!current()) return;
      if (!b) { unread++; continue; }
      searched++; lost += b.lost || 0;
      const found = await searchBookAsync({ ...b, query: q, limit: LIMIT - total }, current);
      if (!current() || !found) return;
      if (!found.length) continue;
      total += found.length;
      if (scope === 'all') next.append(h('h3.searchbook', (b.novel.meta && b.novel.meta.title) || 'Untitled'));
      let group = '', built = 0;
      for (const f of found) {
        if (f.group !== group) { group = f.group; next.append(h('div.searchgroup', group)); }
        next.append(h('button.hit', { onclick: () => go(f, q, s) },
          h('span.where', f.label),
          h('span.snip', f.snippet.before, h('mark', f.snippet.match), f.snippet.after)));
        if (++built % 40 === 0) { await yieldSearch(); if (!current()) return; }
      }
      if (total >= LIMIT) break;
    }
    if (!current()) return;
    results.replaceChildren(next);
    results.setAttribute('aria-busy', 'false');
    say.textContent = searchSaid({ q, scope, total, limit: LIMIT, searched, noShelf, unread, lost });
  };
  later = debounce(run, 140);
  input.addEventListener('input', () => { Q.query = input.value; ticket++; later(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); later.now(); } });
  run();
}

/* a tap on a place: there */
function go(f, q, sheet) {
  sheet.close();
  const here = f.novelId === hooks.currentNovel();
  const inBook = (fn) => (here ? fn() : hooks.goBook(f.novelId, f.chapterId || null, fn));
  if (f.where === 'passage' || f.where === 'chapter') {
    const then = f.where === 'passage' ? { passageId: f.passageId, show: { query: q } } : {};
    if (here) { if (f.where === 'passage') desk.whenOpen(f.chapterId, then); else hooks.goChapter(f.chapterId); return; }
    if (f.where === 'passage') desk.thenOnOpen(f.chapterId, then);
    hooks.goBook(f.novelId, f.chapterId);
    return;
  }
  if (f.where === 'note') return inBook(() => showCard(f.kind, f.cardId));
  if (f.where === 'entry') return inBook(() => showRef(f.novelId, `e:${f.entryId}`));
  if (f.where === 'book') return inBook(() => hooks.openBook(f.novelId));
  if (f.where === 'talk') return inBook(async () => {
    /* in a conversation not open now: that one opens first */
    if (f.convId) {
      const out = await talk.openConversation(f.novelId, f.convId);
      if (!out.ok && !/not there any more/.test(out.error || '')) { toast(`It couldn’t open that conversation: ${out.error}.`, 5000); return; }
    }
    showTurn('talk', f.novelId, f.turnId);
  });
  if (f.where === 'play') return inBook(() => showTurn('play', f.playId, f.turnId));
  return undefined;
}
