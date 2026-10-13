/* Cozy Novel — js/ui/book.js — ABOUT THIS BOOK: its title and cover, what
 * it's about, how it reads, where it's headed; taking it out as a file;
 * archiving or removing it. */

import * as store from '../store.js';
import { h, openSheet, field, toast, confirmIt, download, group } from './dom.js';
import { novelSteps, COVERS } from '../novel/shape.js';
import { toMarkdown, toText, toPrintable, toEpub, fileName } from '../novel/files.js';
import { plural, debounce } from '../util.js';

async function loadChapters(novel) {
  const chapters = {};
  for (const id of novel.order || []) { const c = await store.open('chapter', id); if (c) chapters[id] = c; }
  return chapters;
}

export async function exportBook(novelId, kind) {
  const novel = await store.open('novel', novelId);
  if (!novel) return;
  const chapters = await loadChapters(novel);
  if (kind === 'md') download(fileName(novel, 'md'), toMarkdown(novel, chapters), 'text/markdown');
  else if (kind === 'txt') download(fileName(novel, 'txt'), toText(novel, chapters), 'text/plain');
  else if (kind === 'html') download(fileName(novel, 'html'), await toPrintable(novel, chapters), 'text/html');
  else if (kind === 'epub') download(fileName(novel, 'epub'), await toEpub(novel, chapters));
  toast('The file is on its way to your downloads.');
}

export function openBook(novelId, { onGone, onClose } = {}) {
  const n = store.peek('novel', novelId);
  if (!n) return;
  const s = openSheet('About this book', { onClose });
  const save = (key, value) => store.change('novel', novelId, key === 'meta' ? novelSteps.setMeta(value) : novelSteps.setField(key, value));
  const later = (fn) => debounce(fn, 500);

  const title = h('input', { type: 'text', value: n.meta.title || '' });
  title.addEventListener('input', later(() => { const t = title.value.trim(); if (t) save('meta', { title: t }); }));
  const subtitle = h('input', { type: 'text', value: n.meta.subtitle || '', placeholder: 'A line under the title (optional)' });
  subtitle.addEventListener('input', later(() => save('meta', { subtitle: subtitle.value.trim() })));
  const covers = h('div.covers');
  for (const c of COVERS) {
    const b = h('button.cover.' + c, { 'aria-label': c, 'aria-pressed': String(n.meta.cover === c), onclick: () => { save('meta', { cover: c }); for (const x of covers.children) x.setAttribute('aria-pressed', String(x === b)); } });
    b.style.padding = '0';
    covers.append(b);
  }
  s.body.append(field('Title', title), field('Under the title', subtitle), h('div.field', h('span', 'Cover'), covers));

  const brief = h('textarea.tall', { placeholder: 'The premise, the world, the people, the plot essentials — as much or as little as you like. Paste a whole plot essential if you have one.' });
  brief.value = n.brief || '';
  brief.addEventListener('input', later(() => save('brief', brief.value)));
  const style = h('textarea', { placeholder: 'e.g. Third person, past tense, close on Mara. Quiet, wry, a little melancholy. Short chapters.' });
  style.value = n.style || '';
  style.addEventListener('input', later(() => save('style', style.value)));
  const plans = h('textarea', { placeholder: 'What you mean to happen later — the writer reads it as plans, never as things that already happened.' });
  plans.value = n.plans || '';
  plans.addEventListener('input', later(() => save('plans', plans.value)));
  s.body.append(
    field('What it’s about', brief, 'The writer, the partner and the narrator read this word for word, every time.'),
    field('How it reads', style),
    field('Where it’s headed', plans),
    h('p.say', `${plural(n.meta.words || 0, 'word')} in ${plural((n.order || []).length, 'chapter')}. Everything here saves as you type.`));

  /* what the first Cozy Novel held that has no place of its own here, word for word */
  const kept = (n.migrated && Array.isArray(n.migrated.kept)) ? n.migrated.kept : [];
  if (kept.length) {
    s.body.append(group('Kept from the first Cozy Novel', { key: 'book.kept' },
      h('p.say', 'Things the first Cozy Novel held for this book that have no place of their own here — kept as you wrote them.'),
      ...kept.map((k) => h('div.keptitem', h('b', k.what), h('div', k.text)))));
  }

  s.body.append(group('Take it out as a file', { key: 'book.export' },
    h('p.say', 'The book as it stands, ready to read or share. (Settings → Backups keeps everything, notes and all.)'),
    h('div.btnrow',
      h('button.btn', { onclick: () => exportBook(novelId, 'epub') }, 'E-book (EPUB)'),
      h('button.btn', { onclick: () => exportBook(novelId, 'html') }, 'Printable book'),
      h('button.btn', { onclick: () => exportBook(novelId, 'md') }, 'Markdown'),
      h('button.btn', { onclick: () => exportBook(novelId, 'txt') }, 'Plain text')),
    h('p.say', 'The printable book opens in your browser; print it to a PDF from there.')));

  s.body.append(group('Put it away', { key: 'book.away' },
    h('div.btnrow',
      h('button.btn', { onclick: () => { save('meta', { archived: !n.meta.archived }); toast(n.meta.archived ? 'It is back on the shelf.' : 'Archived — it waits under Archived on the shelf.'); s.close(); } }, n.meta.archived ? 'Bring it back from the archive' : 'Archive it'),
      h('button.btn.danger', { onclick: async () => {
        if (!(await confirmIt('Remove this book?', `“${n.meta.title}” — every chapter, its notes, its talk and its scenes — goes to Recently deleted (Settings → Backups) for thirty days.`, 'Remove it', { danger: true }))) return;
        await store.flush();
        await store.remove('novel', novelId);
        s.close();
        toast('The book is removed. It waits in Recently deleted for thirty days.');
        if (onGone) onGone();
      } }, 'Remove the book'))));
}
