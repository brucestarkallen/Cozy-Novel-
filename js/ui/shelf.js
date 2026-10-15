/* Cozy Novel — js/ui/shelf.js — YOUR BOOKS: the shelf, newest written first. */

import * as store from '../store.js';
import { h, icon, toast, openSheet, field, pickFile, setText } from './dom.js';
import { newNovel } from '../novel/shape.js';
import { fromText, booksFromLibrary } from '../novel/files.js';
import { bringOldBackup } from '../legacy.js';
import { plural, timeAgo, debounce } from '../util.js';
import { openBook } from './book.js';
import * as archivist from '../novel/archivist.js';

let ui = null;
let hooks = {};
let rows = [];
const bookNodes = new Map();
const shelfNodes = new Map();
let footKey = '';

/* Keep each cover and its buttons mounted while shelf news changes its
 * words. A quiet save must not restart every cover's entrance animation. */
function shelfNode(key, make) {
  if (!shelfNodes.has(key)) shelfNodes.set(key, make());
  return shelfNodes.get(key);
}
function placeBooks(nodes) {
  const wanted = new Set(nodes);
  for (const child of [...ui.books.children]) if (!wanted.has(child)) child.remove();
  let next = ui.books.firstChild;
  for (const node of nodes) {
    if (node !== next) ui.books.insertBefore(node, next);
    next = node.nextSibling;
  }
}
function bookNode(r, i) {
  let item = bookNodes.get(r.id);
  if (!item) {
    const title = h('div.t'), subtitle = h('div.s'), meta = h('div.meta');
    const cover = h('button.cover', { onclick: () => hooks.openNovel(r.id) },
      h('div.cover-copy', h('span.cover-kicker', 'A novel'), h('span.cover-rule', { 'aria-hidden': 'true' }), title),
      h('div.cover-foot', { 'aria-hidden': 'true' }, h('span.cover-rule'), h('div.orn', '❦')));
    const more = h('button.more', { title: 'About this book', onclick: () => aboutBook(item.row) }, icon('more', 18));
    const el = h('div.book', { style: { animationDelay: `${Math.min(i, 12) * 40}ms` } }, cover, meta, more);
    item = { el, cover, title, subtitle, meta, more, metaKey: null };
    bookNodes.set(r.id, item);
  }
  item.row = r;
  const m = r.meta || {};
  item.el.classList.toggle('archived', Boolean(m.archived));
  const coverClass = `cover ${m.cover || 'ember'}`;
  if (item.cover.className !== coverClass) item.cover.className = coverClass;
  const label = `${m.title || 'Untitled'}${r.branch?.name ? ` — ${r.branch.name}` : ''}`;
  for (const [el, value] of [[item.cover, `Open ${label}`], [item.more, `About ${label}`]]) {
    if (el.getAttribute('aria-label') !== value) el.setAttribute('aria-label', value);
  }
  setText(item.title, m.title || 'Untitled');
  setText(item.subtitle, m.subtitle || '');
  if (m.subtitle) {
    if (!item.subtitle.parentNode) item.title.after(item.subtitle);
  } else item.subtitle.remove();
  const written = m.words > 0 && m.written ? `written ${timeAgo(m.written)}` : 'A beginning waiting for you';
  const metaKey = JSON.stringify([r.branch?.name, m.words || 0, m.chapters || 1, written]);
  if (item.metaKey !== metaKey) {
    item.metaKey = metaKey;
    item.meta.replaceChildren(...[r.branch?.name ? h('span.branch-shelf-name', r.branch.name) : null, h('b', plural(m.words || 0, 'word')), ` · ${plural(m.chapters || 1, 'chapter')}`, h('br'), written].filter((x) => x !== null));
  }
  return item.el;
}
let showArchived = false;
let query = '';
/* the list of books: never read yet, on its way, read ('ok'), or not read
 * ('failed') — an empty shelf is welcomed only when the phone said so;
 * books that could not be read are never shown as no books */
let listState = 'idle';
let asked = 0;
let away = false;            /* the list failed because the phone did not answer at all */
let listAvailable = false;   /* the last asking succeeded: a stale list offers no resume */

export function initShelf(elements, appHooks) {
  ui = { ...elements };
  for (const name of ['Intro', 'Eyebrow', 'Greeting', 'Invitation', 'Resume', 'Count', 'CollectionTitle']) {
    ui[name[0].toLowerCase() + name.slice(1)] = ui.root.querySelector(`#shelf${name}`);
  }
  hooks = appHooks;
  ui.search.addEventListener('input', debounce(() => { query = ui.search.value.trim().toLowerCase(); draw(); }, 150));
  store.onShelf(debounce(() => { if (!ui.root.hidden) refresh(); }, 250));
  /* the phone answers again: the books it could not list come by themselves */
  store.onStatus((s) => { if (!s.offline && listState === 'failed' && !ui.root.hidden) refresh(); });
}

export async function refresh() {
  const mine = ++asked;
  if (listState !== 'ok') { listState = 'loading'; draw(); }
  let got = null;
  try { got = await store.listNovels(); } catch (_) { /* the banner says when the phone is not answering */ }
  /* only the newest asking draws: an older list arriving late is not the shelf */
  if (mine !== asked) return;
  listAvailable = Boolean(got);
  if (got) { rows = got; listState = 'ok'; } else if (listState !== 'ok') { listState = 'failed'; away = store.status().offline; }
  draw();
}

function recentFirst(a, b) {
  const at = (r) => Math.max(r.meta?.written || 0, r.meta?.opened || 0, r.meta?.created || 0);
  return at(b) - at(a);
}

function drawWelcome(live, list, total) {
  const ready = listState === 'ok';
  if (ui.intro) ui.intro.hidden = !ready;
  setText(ui.eyebrow, rows.length ? 'Make yourself at home' : 'Welcome to your writing room');
  setText(ui.greeting, rows.length ? 'Your next chapter awaits.' : 'A little room.\nA whole world.');
  setText(ui.invitation, rows.length
    ? 'Settle in, find your story, and pick up the thread.'
    : 'A quiet place to dream up worlds, fall in love with characters, and write at your own pace.');
  setText(ui.collectionTitle, showArchived ? 'Archived books' : 'Your books');
  if (ui.count) {
    setText(ui.count, ready ? (query ? `${list.length} of ${plural(total, 'book')}` : plural(total, 'book')) : '');
    ui.count.hidden = !ready;
  }
  if (!ui.resume) return;
  /* A search or the archive is its own shelf; the invitation to return to a
   * live book belongs only to the shelf of books being written. */
  const latest = ready && listAvailable && !store.status().offline && !showArchived && !query ? [...live].sort(recentFirst)[0] : null;
  ui.resume.hidden = !latest;
  if (ui.intro) ui.intro.classList.toggle('has-resume', Boolean(latest));
  if (!latest) { if (ui.resume.firstChild) ui.resume.replaceChildren(); return; }
  const m = latest.meta || {};
  const resumeMeta = `${latest.branch?.name ? `${latest.branch.name} · ` : ''}${plural(m.words || 0, 'word')} · ${plural(m.chapters || 1, 'chapter')}`;
  /* Shelf news can arrive while the button has focus. Update the words in
   * place for the same book, so a save from another window never takes the
   * Continue button (and the keyboard's place) away. */
  if (ui.resume.dataset.book === latest.id && ui.resume.firstChild) {
    setText(ui.resume.querySelector('.resume-title'), m.title || 'Untitled');
    setText(ui.resume.querySelector('.resume-meta'), resumeMeta);
    return;
  }
  ui.resume.dataset.book = latest.id;
  ui.resume.replaceChildren(h('div.resume-card',
    h('span.resume-label', 'Where you left off'),
    h('h2.resume-title', m.title || 'Untitled'),
    h('p.resume-meta', resumeMeta),
    h('div.resume-action',
      h('button.btn.primary', { onclick: () => hooks.openNovel(latest.id), title: 'Open this book at the chapter you last visited.' }, 'Continue writing', icon('right', 16)),
      h('span.resume-hint', 'Back to the chapter you last visited.'))));
}

function draw() {
  const collection = rows.filter((r) => Boolean(r.meta && r.meta.archived) === showArchived);
  const list = collection
    .filter((r) => !query || String(r.meta?.title || '').toLowerCase().includes(query) || String(r.meta?.subtitle || '').toLowerCase().includes(query) || String(r.branch?.name || '').toLowerCase().includes(query))
    .sort(recentFirst);
  const nodes = [];
  const known = new Set(rows.map((r) => r.id));
  for (const id of bookNodes.keys()) if (!known.has(id)) bookNodes.delete(id);
  const live = rows.filter((r) => !(r.meta && r.meta.archived));
  ui.search.hidden = !rows.length && !query;
  drawWelcome(live, list, collection.length);
  if (!rows.length && listState !== 'ok') {
    footKey = '';
    ui.foot.textContent = '';
    if (listState === 'failed') {
      nodes.push(shelfNode(`failed:${away}`, () => h('div.empty-shelf.unread',
        h('h2', 'Your books could not be read just now.'),
        h('p', away
          ? 'The phone is not answering, so the list of them did not come — nothing is lost. They come back here by themselves when it answers again.'
          : 'The phone could not send the list of them just now — nothing is lost. Try again in a moment.'),
        h('div.btnrow', h('button.btn.primary', { onclick: () => refresh(), title: 'Ask the phone for your books again.' }, 'Try again')))));
    } else nodes.push(shelfNode('loading', () => h('p.say.shelfwait', 'Reading your books…')));
    placeBooks(nodes);
    return;
  }
  if (!rows.length) {
    nodes.push(shelfNode('welcome', () => h('div.empty-shelf',
      h('h2', 'Every story starts somewhere.'),
      h('p', 'Give it a title and begin. You can write every word yourself, or say what happens and let your writer write it — then keep it, try another take, or rewrite it.'),
      h('div.btnrow', h('button.btn.primary', { onclick: newBook, title: 'A new book: only a working title is asked.' }, 'Begin a book'), h('button.btn', { onclick: importBook, title: 'A book from a .txt or .md file — its chapter headings become chapters — or a copy from Backups.' }, 'Bring in a book')))));
  } else if (!showArchived && !query) {
    nodes.push(shelfNode('new', () => h('button.book.new', { onclick: newBook, 'aria-label': 'Begin a new book', title: 'A new book: only a working title is asked.' }, h('div.cover', h('div.plus', '+'), h('div', { style: { font: '500 18px/1.2 var(--display)' } }, 'A new book')))));
  }
  list.forEach((r, i) => nodes.push(bookNode(r, i)));
  if (query && !list.length && rows.length) {
    nodes.push(shelfNode(`search:${showArchived}:${query}`, () => h('div.empty-shelf.search-empty',
      h('h2', 'No books found.'),
      h('p', `No ${showArchived ? 'archived book' : 'book on your shelf'} matches “${ui.search.value.trim()}”. Try another title or subtitle.`),
      h('button.btn', { onclick: () => { query = ''; ui.search.value = ''; draw(); ui.search.focus(); }, title: 'Clear the search and show every book on this shelf.' }, 'Clear search'))));
  } else if (showArchived && !list.length && rows.length) {
    nodes.push(shelfNode('archive', () => h('div.empty-shelf', h('h2', 'Nothing archived.'), h('p', 'Books you archive will rest here until you want them on your shelf again.'))));
  }
  placeBooks(nodes);
  /* Search messages are cheap and may contain arbitrary words; keep only
   * the one currently shown rather than every search ever typed. */
  for (const [key, node] of shelfNodes) if (key.startsWith('search:') && !nodes.includes(node)) shelfNodes.delete(key);
  const archivedCount = rows.length - live.length;
  const nextFoot = `${Boolean(rows.length)}:${archivedCount}:${showArchived}`;
  if (footKey === nextFoot) return;
  footKey = nextFoot;
  ui.foot.textContent = '';
  if (rows.length) ui.foot.append(h('button.btn.quiet.small', { onclick: importBook, title: 'A book from a .txt or .md file — its chapter headings become chapters — or a copy from Backups.' }, 'Bring in a book'));
  if (archivedCount || showArchived) ui.foot.append(h('button.btn.quiet.small', { onclick: () => { showArchived = !showArchived; draw(); }, title: showArchived ? 'The books on the shelf.' : 'The books you archived — each one can go back on the shelf.' }, showArchived ? 'Back to the shelf' : `Archived (${archivedCount})`));
}

/* the book's own sheet — its title, cover, files, archive and removal live
 * there, in one place */
async function aboutBook(r) {
  const n = await store.open('novel', r.id).catch(() => null);
  if (!n) { toast('That book could not be opened just now.'); return; }
  openBook(r.id, { onGone: () => refresh(), onClose: () => refresh() });
}

/* ---------------------------------------------------------- a new book */

/* what he typed for a book not begun yet stays, if the sheet is closed by a
 * stray tap or Back, until the book is made */
const DRAFT = 'cozynovel.newbook';
function draftOf() { try { return JSON.parse(sessionStorage.getItem(DRAFT) || 'null') || {}; } catch (_) { return {}; } }
function keepDraft(d) { try { sessionStorage.setItem(DRAFT, JSON.stringify(d)); } catch (_) { /* this visit only */ } }

function newBook() {
  const s = openSheet('A new book', { small: true });
  const kept = draftOf();
  const title = h('input', { type: 'text', placeholder: 'A working title', value: kept.title || '' });
  const brief = h('textarea', { rows: 5, placeholder: 'What it’s about — a premise, a world, a few people. Or paste a whole plot essential. (Optional; you can add it any time.)' });
  brief.value = kept.brief || '';
  const style = h('input', { type: 'text', placeholder: 'e.g. First person, past tense, warm and funny (optional)', value: kept.style || '' });
  const remember = () => keepDraft({ title: title.value, brief: brief.value, style: style.value });
  for (const el of [title, brief, style]) el.addEventListener('input', remember);
  let making = false;
  const go = async () => {
    if (making) return;
    const t = title.value.trim();
    if (!t) { toast('Give it a title — a working one is fine.'); title.focus(); return; }
    making = true;
    begin.disabled = true;
    try {
      const { novel, chapter } = newNovel({ title: t, brief: brief.value.trim(), style: style.value.trim() });
      await store.create('chapter', chapter.id, chapter);
      await store.create('novel', novel.id, novel);
      keepDraft({});
      s.close();
      hooks.openNovel(novel.id);
    } catch (e) {
      making = false;
      begin.disabled = false;
      toast('The book could not be made: the phone is not answering. Is Cozy Novel running in Termux?', 6000);
    }
  };
  const begin = h('button.btn.primary', { onclick: go }, 'Open the book');
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
  s.body.append(field('Title', title), field('What it’s about', brief), field('How it reads', style), h('div.btnrow', begin));
  setTimeout(() => title.focus(), 80);
}

/* ---------------------------------------------------------- bringing in */

async function importBook() {
  const file = await pickFile('.txt,.md,.markdown,.text,.json,text/plain,text/markdown,application/json');
  if (!file) return;
  let text = '';
  try { text = await file.text(); } catch (_) { toast('That file could not be read.'); return; }
  if (/\.json$/i.test(file.name) || /^\s*\{/.test(text)) {
    let data = null;
    try { data = JSON.parse(text); } catch (_) { data = null; }
    if (data && data.format === 'cozyNovel.backup') {
      const n = await bringOldBackup(data);
      toast(n ? `${plural(n, 'book')} from the first Cozy Novel came onto the shelf.` : 'Those books are already on the shelf.');
      refresh();
      return;
    }
    if (data && data.format === 'cozynovel-library') {
      let list;
      try { list = booksFromLibrary(data); }
      catch (error) { toast(error?.message || 'That copy could not be read. No books were added.', 7000); return; }
      for (const b of list) {
        for (const id of b.novel.order) await store.create('chapter', id, b.chapters[id]);
        if (b.talk) await store.create('talk', b.novel.id, b.talk);
        if (b.draft) await store.create('draft', b.novel.id, b.draft);
        for (const p of b.plays) await store.create('play', p.id, p);
        await store.create('novel', b.novel.id, b.novel);
      }
      toast(`${plural(list.length, 'book')} added to the shelf.`);
      refresh();
      return;
    }
    toast('That file is not a book Cozy Novel can read.');
    return;
  }
  const { novel, chapters } = fromText(file.name, text);
  for (const id of novel.order) await store.create('chapter', id, chapters[id]);
  await store.create('novel', novel.id, novel);
  toast(`“${novel.meta.title}” is on the shelf: ${plural(novel.order.length, 'chapter')}, ${plural(novel.meta.words, 'word')}. The helper reads it for the notes.`, 6000);
  archivist.nudge(novel.id, 1500);
  refresh();
}


