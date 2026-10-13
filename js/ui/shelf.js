/* Cozy Novel — js/ui/shelf.js — YOUR BOOKS: the shelf, newest written first. */

import * as store from '../store.js';
import { h, icon, toast, openSheet, field, pickFile } from './dom.js';
import { newNovel } from '../novel/shape.js';
import { fromText, booksFromLibrary } from '../novel/files.js';
import { bringOldBackup } from '../legacy.js';
import { plural, timeAgo, debounce } from '../util.js';
import { openBook } from './book.js';
import * as archivist from '../novel/archivist.js';

let ui = null;
let hooks = {};
let rows = [];
let showArchived = false;
let query = '';

export function initShelf(elements, appHooks) {
  ui = elements;
  hooks = appHooks;
  ui.search.addEventListener('input', debounce(() => { query = ui.search.value.trim().toLowerCase(); draw(); }, 150));
  store.onShelf(debounce(() => { if (!ui.root.hidden) refresh(); }, 250));
}

export async function refresh() {
  try { rows = await store.listNovels(); } catch (_) { /* the banner says the phone is not answering */ }
  draw();
}

function draw() {
  const list = rows
    .filter((r) => Boolean(r.meta && r.meta.archived) === showArchived)
    .filter((r) => !query || String(r.meta.title || '').toLowerCase().includes(query) || String(r.meta.subtitle || '').toLowerCase().includes(query))
    .sort((a, b) => Math.max(b.meta.written || 0, b.meta.opened || 0) - Math.max(a.meta.written || 0, a.meta.opened || 0));
  ui.books.textContent = '';
  const live = rows.filter((r) => !(r.meta && r.meta.archived));
  ui.search.hidden = rows.length < 7;
  if (!rows.length) {
    ui.books.append(h('div.empty-shelf',
      h('h2', 'Every story starts somewhere.'),
      h('p', 'Give it a title and begin. You can write every word yourself, or say what happens and let your writer write it — then keep it, try another take, or rewrite it.'),
      h('div.btnrow', h('button.btn.primary', { onclick: newBook }, 'Begin a book'), h('button.btn', { onclick: importBook }, 'Bring in a book'))));
  } else if (!showArchived) {
    ui.books.append(h('button.book.new', { onclick: newBook, 'aria-label': 'Begin a new book' }, h('div.cover', h('div.plus', '+'), h('div', { style: { font: '500 18px/1.2 var(--display)' } }, 'A new book'))));
  }
  list.forEach((r, i) => {
    const m = r.meta || {};
    const el = h('div.book' + (m.archived ? '.archived' : ''), { style: { animationDelay: `${Math.min(i, 12) * 40}ms` } },
      h('button.cover.' + (m.cover || 'ember'), { onclick: () => hooks.openNovel(r.id), 'aria-label': `Open ${m.title}` },
        h('div', h('div.t', m.title || 'Untitled'), m.subtitle ? h('div.s', m.subtitle) : null),
        h('div.orn', '❦')),
      h('div.meta', h('b', plural(m.words || 0, 'word')), ` · ${plural(m.chapters || 1, 'chapter')}`, h('br'), `written ${timeAgo(m.written || m.created) || 'not yet'}`),
      h('button.more', { 'aria-label': `About ${m.title}`, title: 'About this book', onclick: () => aboutBook(r) }, icon('more', 18)));
    ui.books.append(el);
  });
  if (showArchived && !list.length) ui.books.append(h('p.say', 'Nothing archived.'));
  else if (query && !list.length) ui.books.append(h('p.say', `No book’s title has “${ui.search.value.trim()}” in it.`));
  ui.foot.textContent = '';
  const archivedCount = rows.length - live.length;
  if (rows.length) ui.foot.append(h('button.btn.quiet.small', { onclick: importBook }, 'Bring in a book'));
  if (archivedCount || showArchived) ui.foot.append(h('button.btn.quiet.small', { onclick: () => { showArchived = !showArchived; draw(); } }, showArchived ? 'Back to the shelf' : `Archived (${archivedCount})`));
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
  const go = async () => {
    const t = title.value.trim();
    if (!t) { toast('Give it a title — a working one is fine.'); title.focus(); return; }
    begin.disabled = true;
    try {
      const { novel, chapter } = newNovel({ title: t, brief: brief.value.trim(), style: style.value.trim() });
      await store.create('chapter', chapter.id, chapter);
      await store.create('novel', novel.id, novel);
      keepDraft({});
      s.close();
      hooks.openNovel(novel.id);
    } catch (e) {
      begin.disabled = false;
      toast('The book could not be made: the phone is not answering. Is Cozy Novel running in Termux?', 6000);
    }
  };
  const begin = h('button.btn.primary', { onclick: go }, 'Open the book');
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
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
      const list = booksFromLibrary(data);
      for (const b of list) {
        for (const id of b.novel.order) await store.create('chapter', id, b.chapters[id]);
        if (b.talk) await store.create('talk', b.novel.id, b.talk);
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


