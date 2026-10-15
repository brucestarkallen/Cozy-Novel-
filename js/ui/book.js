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
import { novelSteps, COVERS, soundOf } from '../novel/shape.js';
import { autoOn, bookHasMacro, bookNames } from '../novel/prompts.js';
import { connFor, stopIn } from '../novel/writer.js';
import { stopTalk } from '../novel/talk.js';
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
function keptField(novelId, key, { label, own, ownPlaceholder, keptPlaceholder, later }) {
  const wrap = h('div.keptfield');
  const save = later((text) => {
    /* emptied: given back — the helper writes it again from the book */
    if (!text.trim()) { archivist.keepAgain(novelId, key, { keepWords: false }); return; }
    store.change('novel', novelId, novelSteps.setKept(key, { text, at: Date.now(), by: 'you' }));
  }, 600);
  const mine = h('textarea.tall', { placeholder: ownPlaceholder, 'aria-label': `${label} — your words` });
  mine.value = own.value();
  /* his own words rewritten: on Automatic, what the helper keeps beside them is written again once he pauses (Cozy Tavern M518-2) */
  mine.addEventListener('input', later(() => { own.save(mine.value); if (autoOn(store.peek('novel', novelId) || {}, key)) archivist.nudge(novelId, 15000); }));
  const kept = h('textarea', { placeholder: keptPlaceholder, 'aria-label': `${label} — kept by the helper` });
  kept.addEventListener('input', () => save(kept.value));
  const say = h('p.say');
  const again = h('button.btn.quiet.small', { title: 'The helper writes this afresh from the book; what stands here is used until its new words land.', onclick: () => {
    if (!connFor(store.peek('house', 'house') || {}, 'helper')) { toast('No helper is chosen, so nothing can be written from the book — choose one in Settings → Connections. What stands here stays.', 6000); return; }
    /* Keep the correction just typed while its replacement is on the way. */
    save.flush();
    archivist.keepAgain(novelId, key);
    draw();
    toast('The helper writes it again from the book — what stands is used until then.');
  } }, 'Write it from the book again');
  const modes = h('div.segmented', { role: 'group', 'aria-label': label });
  const mode = (on, text) => h('button', { title: on ? 'Send your words together with what the helper keeps from the book.' : 'Send only your words, exactly as you wrote them.', 'aria-pressed': 'false', onclick: () => {
    store.change('novel', novelId, novelSteps.setAuto(key, on), { now: true });
    if (on) archivist.nudge(novelId, 500);
    draw();
  } }, text);
  const manual = mode(false, 'Manual');
  const auto = mode(true, 'Automatic');
  modes.append(manual, auto);
  const existing = store.peek('novel', novelId);
  const keptBox = h('details.keptbox', { open: Boolean(existing && existing.kept && existing.kept[key] && existing.kept[key].text) },
    h('summary', 'Kept by the helper'),
    h('div.keptcontent', h('span.keptlabel', 'As the book stands'), kept, say, h('div.btnrow', again)));
  const ownHint = h('em');
  wrap.append(h('div.keptrow', h('span.keptname', label), modes), mine, ownHint, keptBox);
  function draw() {
    const n = store.peek('novel', novelId);
    if (!n) return;
    const on = autoOn(n, key);
    manual.setAttribute('aria-pressed', String(!on));
    auto.setAttribute('aria-pressed', String(on));
    keptBox.hidden = !on;
    ownHint.textContent = on ? 'Your words guide the book. The helper’s notes travel with them; where they differ, your words win.' : 'Only your words are sent, exactly as written, to the writer, partner and narrator.';
    const k = (n.kept && n.kept[key]) || null;
    if (document.activeElement !== kept && !save.pending()) kept.value = (k && k.text) || '';
    const helper = connFor(store.peek('house', 'house') || {}, 'helper');
    if (k && k.by === 'you') say.textContent = 'Your corrections stand — the helper leaves this as it is until you have it written from the book again.';
    else if (!helper) say.textContent = 'No helper is chosen, so nothing is kept here yet. Choose one in Settings → Connections.';
    else if (k && k.again) say.textContent = k.text ? 'Being written again from the book — what stands here is used until the new words land.' : 'Being written again from the book.';
    else if (k && k.text) say.textContent = `Kept current by the helper as the book goes on — last brought up to date ${timeAgo(k.at)}. Correct anything here and your words stand.`;
    else say.textContent = 'The helper writes this from the book once there are words in it, and keeps it current from then on.';
    again.hidden = !(k && (k.text || k.by === 'you')) || Boolean(k && k.again);
  }
  draw();
  return { el: wrap, draw };
}

export function openBook(novelId, { onGone, onClose } = {}) {
  const n = store.peek('novel', novelId);
  if (!n) return;
  let off = () => {};
  const pending = new Set();
  const flushPending = () => { for (const commit of [...pending]) commit(); };
  const s = openSheet('About this book', { onClose: () => { off(); flushPending(); if (onClose) onClose(); } });
  s.wrap.classList.add('booksheet');
  const save = (key, value) => store.change('novel', novelId, key === 'meta' ? novelSteps.setMeta(value) : novelSteps.setField(key, value));
  /* A field's last keystroke belongs to the book before it is exported or
   * closed. Waiting callbacks must never write over a newly opened sheet. */
  const later = (fn, ms = 500) => {
    let args = [];
    const commit = () => { pending.delete(commit); wait.cancel(); fn(...args); };
    const wait = debounce(commit, ms);
    const queue = (...next) => { args = next; pending.add(commit); wait(); };
    queue.flush = () => { if (pending.has(commit)) commit(); };
    queue.pending = () => pending.has(commit);
    return queue;
  };

  const title = h('input', { type: 'text', value: n.meta.title || '' });
  title.addEventListener('input', later(() => { const t = title.value.trim(); if (t) save('meta', { title: t }); }));
  const subtitle = h('input', { type: 'text', value: n.meta.subtitle || '', placeholder: 'A line under the title (optional)' });
  subtitle.addEventListener('input', later(() => save('meta', { subtitle: subtitle.value.trim() })));
  const previewTitle = h('span.t', n.meta.title || 'Your book');
  const previewSubtitle = h('span.s', n.meta.subtitle || '');
  const preview = h('div.cover.book-preview.' + (n.meta.cover || COVERS[0]), { 'aria-hidden': 'true' },
    h('div', previewTitle, previewSubtitle), h('span.orn', '✦'));
  title.addEventListener('input', () => { previewTitle.textContent = title.value.trim() || 'Your book'; });
  subtitle.addEventListener('input', () => { previewSubtitle.textContent = subtitle.value.trim(); });
  const covers = h('div.covers');
  for (const c of COVERS) {
    const b = h('button.cover.' + c, { 'aria-label': c, title: `Use the ${c} cover`, 'aria-pressed': String(n.meta.cover === c), onclick: () => {
      save('meta', { cover: c });
      preview.className = 'cover book-preview ' + c;
      for (const x of covers.children) x.setAttribute('aria-pressed', String(x === b));
    } });
    b.style.padding = '0';
    covers.append(b);
  }
  s.body.append(h('p.book-intro', 'A home for the people, places and voice of your story. Everything here saves as you type.'),
    h('section.book-identity', { 'aria-label': 'Title and cover' },
      h('div.book-identity-main', preview, h('div.book-title-fields', field('Title', title), field('Under the title', subtitle))),
      h('div.field.book-covers', h('span', 'Cover'), covers)));

  const about = keptField(novelId, 'about', {
    later,
    label: 'What it’s about',
    own: { value: () => (store.peek('novel', novelId) || {}).brief || '', save: (v) => save('brief', v) },
    ownPlaceholder: 'The premise, the world, the people, the plot essentials — as much or as little as you like. Paste a whole plot essential if you have one.',
    keptPlaceholder: 'Written by the helper from the book: the premise, the people at its heart and what they want, where the story is heading.',
  });
  const reads = keptField(novelId, 'style', {
    later,
    label: 'How it reads',
    own: { value: () => (store.peek('novel', novelId) || {}).style || '', save: (v) => save('style', v) },
    ownPlaceholder: 'e.g. Third person, past tense, close on Mara. Quiet, wry, a little melancholy. Short chapters.',
    keptPlaceholder: 'Written by the helper from the book: its point of view and tense, its voice, its rhythm.',
  });
  /* how the world's sounds are written: his sound law as comics have it, or as a printed novel does */
  const sound = h('div.segmented', { role: 'group', 'aria-label': 'Sound' });
  const soundSay = h('em');
  const SOUND_SAY = {
    comic: 'Comic: the world’s sounds as sound effects in asterisks — *CLANG!* *thud thud* — the way your scenes in Cozy Tavern have them.',
    novel: 'Novel: the same sounds written into the sentences — steel shrieking off steel, the crack of a rib — the way a printed novel has them.',
  };
  const drawSound = () => {
    const cur = soundOf(store.peek('novel', novelId));
    for (const b of sound.children) b.setAttribute('aria-pressed', String(b.dataset.v === cur));
    soundSay.textContent = `${SOUND_SAY[cur]} Voices — moans, cries, war cries — are written out in quotes either way. The writer and the narrator follow it from the next page on.`;
  };
  for (const [v, label] of [['comic', 'Comic'], ['novel', 'Novel']]) {
    sound.append(h('button', { title: v === 'comic' ? 'Write sounds as effects in asterisks.' : 'Write sounds into the prose.', 'data-v': v, 'aria-pressed': 'false', onclick: () => {
      store.change('novel', novelId, novelSteps.setPref('sound', v === 'comic' ? '' : v), { now: true });
      drawSound();
    } }, label));
  }
  drawSound();
  const plans = h('textarea', { placeholder: 'What you mean to happen later — the writer reads it as plans, never as things that already happened.' });
  plans.value = n.plans || '';
  plans.addEventListener('input', later(() => save('plans', plans.value)));
  /* words brought from SillyTavern say {{char}} and {{user}}: who {{char}} is, asked once — every model reads the names, never the marks */
  const charName = h('input', { type: 'text', value: n.meta.char || '', placeholder: 'e.g. Rias' });
  charName.addEventListener('input', later(() => save('meta', { char: charName.value.trim() })));
  const charSay = h('em');
  const charField = h('label.field', h('span', 'Who {{char}} is in your words'), charName, charSay);
  const drawChar = () => {
    const now = store.peek('novel', novelId) || n;
    charField.hidden = !bookHasMacro(now) && !String((now.meta && now.meta.char) || '').trim();
    const names = bookNames(store.peek('house', 'house') || {}, now);
    charSay.textContent = `Your words here say {{char}} or {{user}}: every model reads {{user}} as ${names.user === 'me' ? 'you (your name, in Settings → Your instructions)' : names.user}, and {{char}} as the name you give here${String((now.meta && now.meta.char) || '').trim() ? '' : ' (until then, “the other main character”)'}.`;
  };
  drawChar();
  s.body.append(
    about.el,
    reads.el,
    h('div.field.book-sound', h('span', 'Sound'), sound, soundSay),
    h('section.book-plans', field('Where it’s headed', plans)),
    charField,
    h('p.say.book-wordcount', `${plural(n.meta.words || 0, 'word')} · ${plural((n.order || []).length, 'chapter')}`));
  /* what the helper keeps arrives while the sheet is open */
  off = store.subscribe('novel', novelId, () => { about.draw(); reads.draw(); drawChar(); });

  /* what the first Cozy Novel held that has no place of its own here, word for word */
  const kept = (n.migrated && Array.isArray(n.migrated.kept)) ? n.migrated.kept : [];
  if (kept.length) {
    s.body.append(group('Kept from the first Cozy Novel', { key: 'book.kept' },
      h('p.say', 'Things the first Cozy Novel held for this book that have no place of their own here — kept as you wrote them.'),
      ...kept.map((k) => h('div.keptitem', h('b', k.what), h('div', k.text)))));
  }

  s.body.append(group('Take it out as a file', { key: 'book.export' },
    h('p.say', 'The book as it stands, ready to read or share. (Settings → Backups keeps everything, notes and all.)'),
    h('div.btnrow.book-exports', [
      ['epub', 'E-book (EPUB)', 'Ready for an e-reader'],
      ['html', 'Printable book', 'Read or print to PDF'],
      ['md', 'Markdown', 'With formatting marks'],
      ['txt', 'Plain text', 'Just the story’s words'],
    ].map(([kind, label, hint]) => h('div.book-export-option',
      h('button.btn', { title: hint, onclick: () => { flushPending(); exportBook(novelId, kind); } }, label),
      h('small', hint)))),
    h('p.say', 'The printable book opens in your browser; print it to a PDF from there.')));

  s.body.append(group('Put it away', { key: 'book.away' },
    h('div.btnrow',
      h('button.btn', { title: 'Keep the whole book in the archive, ready to return to.', onclick: () => { save('meta', { archived: !n.meta.archived }); toast(n.meta.archived ? 'It is back on the shelf.' : 'Archived — it waits under Archived on the shelf.'); s.close(); } }, n.meta.archived ? 'Bring it back from the archive' : 'Archive it'),
      h('button.btn.danger', { title: 'Move this book to Recently deleted for thirty days.', onclick: async () => {
        if (!(await confirmIt('Remove this book?', `“${n.meta.title}” — every chapter, its notes, its talk and its scenes — goes to Recently deleted (Settings → Backups) for thirty days.`, 'Remove it', { danger: true }))) return;
        /* whatever is being written for it stops: a page, the partner's answer, a scene's (Tavern M675) */
        stopIn(novelId);
        stopTalk('talk', novelId);
        for (const pid of (store.peek('novel', novelId) || {}).plays || []) stopTalk('play', pid);
        flushPending();
        await store.flush();
        await store.remove('novel', novelId);
        s.close();
        toast('The book is removed. It waits in Recently deleted for thirty days.');
        if (onGone) onGone();
      } }, 'Remove the book'))));
}
