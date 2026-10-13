/* Cozy Novel — js/ui/book.js — ABOUT THIS BOOK: its title and cover, what
 * it's about, how it reads, where it's headed; taking it out as a file;
 * archiving or removing it.
 *
 * What it's about and How it reads are each Manual (only his words) or
 * Automatic (his words, if any, and what the helper keeps of the book as it
 * stands — kept current as the book goes on). What the helper keeps he can
 * correct; his correction stands until he has it written from the book
 * again. (Cozy Tavern's brief, Manual / Automatic.) */

import * as store from '../store.js';
import * as archivist from '../novel/archivist.js';
import { h, openSheet, field, toast, confirmIt, download, group } from './dom.js';
import { novelSteps, COVERS } from '../novel/shape.js';
import { autoOn } from '../novel/prompts.js';
import { connFor } from '../novel/writer.js';
import { toMarkdown, toText, toPrintable, toEpub, fileName } from '../novel/files.js';
import { plural, debounce, timeAgo } from '../util.js';

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

/* What it's about / How it reads: Manual or Automatic, his words, and what
 * the helper keeps (Automatic). Drawn again when the helper keeps something
 * new — never under his fingers. */
function keptField(novelId, key, { label, own, ownPlaceholder, keptPlaceholder }) {
  const wrap = h('div.keptfield');
  const save = debounce((text) => {
    /* emptied: given back — the helper writes it again from the book */
    if (!text.trim()) { archivist.keepAgain(novelId, key); return; }
    store.change('novel', novelId, novelSteps.setKept(key, { text, at: Date.now(), by: 'you' }));
  }, 600);
  const mine = h('textarea.tall', { placeholder: ownPlaceholder });
  mine.value = own.value();
  mine.addEventListener('input', debounce(() => own.save(mine.value), 500));
  const kept = h('textarea', { placeholder: keptPlaceholder, 'aria-label': `${label} — kept by the helper` });
  kept.addEventListener('input', () => save(kept.value));
  const say = h('p.say');
  const again = h('button.btn.quiet.small', { onclick: () => { save.cancel(); archivist.keepAgain(novelId, key); kept.value = ''; draw(); toast('The helper writes it again from the book.'); } }, 'Write it from the book again');
  const modes = h('div.segmented', { role: 'group', 'aria-label': label });
  const mode = (on, text) => h('button', { 'aria-pressed': 'false', onclick: () => {
    store.change('novel', novelId, novelSteps.setAuto(key, on), { now: true });
    if (on) archivist.nudge(novelId, 500);
    draw();
  } }, text);
  const manual = mode(false, 'Manual');
  const auto = mode(true, 'Automatic');
  modes.append(manual, auto);
  const keptBox = h('div.keptbox', h('span.keptlabel', 'Kept by the helper, as the book stands'), kept, say, h('div.btnrow', again));
  const ownHint = h('em');
  wrap.append(h('div.keptrow', h('span.keptname', label), modes), mine, ownHint, keptBox);
  function draw() {
    const n = store.peek('novel', novelId);
    if (!n) return;
    const on = autoOn(n, key);
    manual.setAttribute('aria-pressed', String(!on));
    auto.setAttribute('aria-pressed', String(on));
    keptBox.hidden = !on;
    ownHint.textContent = on ? 'Your own words, if you want any — they stand as they are, and win wherever the two differ. The writer, the partner and the narrator read both, every time.' : 'Only your words are sent — the writer, the partner and the narrator read them word for word, every time.';
    const k = (n.kept && n.kept[key]) || null;
    if (document.activeElement !== kept) kept.value = (k && k.text) || '';
    const helper = connFor(store.peek('house', 'house') || {}, 'helper');
    if (k && k.by === 'you') say.textContent = 'Your corrections stand — the helper leaves this as it is until you have it written from the book again.';
    else if (!helper) say.textContent = 'No helper is chosen, so nothing is kept here yet. Choose one in Settings → Connections.';
    else if (k && k.text) say.textContent = `Kept current by the helper as the book goes on — last brought up to date ${timeAgo(k.at)}. Correct anything here and your words stand.`;
    else say.textContent = 'The helper writes this from the book once there are words in it, and keeps it current from then on.';
    again.hidden = !(k && (k.text || k.by === 'you'));
  }
  draw();
  return { el: wrap, draw };
}

export function openBook(novelId, { onGone, onClose } = {}) {
  const n = store.peek('novel', novelId);
  if (!n) return;
  let off = () => {};
  const s = openSheet('About this book', { onClose: () => { off(); if (onClose) onClose(); } });
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

  const about = keptField(novelId, 'about', {
    label: 'What it’s about',
    own: { value: () => (store.peek('novel', novelId) || {}).brief || '', save: (v) => save('brief', v) },
    ownPlaceholder: 'The premise, the world, the people, the plot essentials — as much or as little as you like. Paste a whole plot essential if you have one.',
    keptPlaceholder: 'Written by the helper from the book: the premise, the people at its heart and what they want, where the story is heading.',
  });
  const reads = keptField(novelId, 'style', {
    label: 'How it reads',
    own: { value: () => (store.peek('novel', novelId) || {}).style || '', save: (v) => save('style', v) },
    ownPlaceholder: 'e.g. Third person, past tense, close on Mara. Quiet, wry, a little melancholy. Short chapters.',
    keptPlaceholder: 'Written by the helper from the book: its point of view and tense, its voice, its rhythm.',
  });
  const plans = h('textarea', { placeholder: 'What you mean to happen later — the writer reads it as plans, never as things that already happened.' });
  plans.value = n.plans || '';
  plans.addEventListener('input', later(() => save('plans', plans.value)));
  s.body.append(
    about.el,
    reads.el,
    field('Where it’s headed', plans),
    h('p.say', `${plural(n.meta.words || 0, 'word')} in ${plural((n.order || []).length, 'chapter')}. Everything here saves as you type.`));
  /* what the helper keeps arrives while the sheet is open */
  off = store.subscribe('novel', novelId, () => { about.draw(); reads.draw(); });

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
