/* Cozy Novel — js/ui/think.js — THE THINKING, beside what it led to. While
 * the model thinks it streams open, live, line by line (only the newest line
 * is drawn again as it grows — Cozy Tavern's M279); once its words begin it
 * folds to one line ("The thinking (N words)"), a tap away, with Copy. The
 * box follows its own newest line only while he is at its bottom: scrolled
 * up inside it to read, he is left where he is. The page, the partner and the
 * scenes all show it the same way. */

import { h, icon, toast, copyText } from './dom.js';
import { plural, countWords } from '../util.js';
import { streamLines } from './live.js';

const labelOf = (thinking, live) => (live ? 'Thinking…' : `The thinking (${plural(countWords(thinking), 'word')})`);
const shown = new WeakMap();   /* box -> the thinking it shows */

/* live: still thinking (open and streaming). open: unfolded by him.
 * onToggle(now): told when he opens or folds it, so a redraw keeps it so. */
export function thinkBox(thinking, { live = false, open = false, onToggle = null } = {}) {
  const box = h('div.thinkbox' + (open ? '.open' : '') + (live ? '.live' : ''));
  const words = h('div.words');
  if (live) streamLines(words, thinking, { blocks: true });
  else words.textContent = thinking;
  shown.set(box, thinking);
  const copy = h('button.copy', { onclick: async () => toast((await copyText(shown.get(box) || '')) ? 'The thinking is copied.' : 'It could not be copied.') }, 'Copy it');
  const label = h('span.label', labelOf(thinking, live));
  const btn = h('button', { 'aria-expanded': String(open || live), onclick: () => {
    const now = box.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(now || box.classList.contains('live')));
    if (onToggle) onToggle(now);
  } }, h('span.chev', icon('chev', 14)), label);
  box.append(btn, words, h('div.thinkcopy', copy));
  if (live) requestAnimationFrame(() => { words.scrollTop = words.scrollHeight; });
  return box;
}

/* the same box, brought up to date as more thinking — or the first words —
 * arrive; nothing on screen is touched when nothing changed */
export function updateThinkBox(box, thinking, { live = false } = {}) {
  const was = shown.get(box);
  const wasLive = box.classList.contains('live');
  if (thinking === was && live === wasLive) return;
  shown.set(box, thinking);
  const words = box.querySelector(':scope > .words');
  if (words) {
    if (live) {
      const atBottom = words.scrollHeight - words.scrollTop - words.clientHeight < 24;
      streamLines(words, thinking, { blocks: true });
      if (atBottom) words.scrollTop = words.scrollHeight;
    } else {
      /* the finished thinking is drawn whole, once */
      words.textContent = thinking;
    }
  }
  if (live !== wasLive) {
    box.classList.toggle('live', live);
    const btn = box.querySelector(':scope > button');
    if (btn) btn.setAttribute('aria-expanded', String(live || box.classList.contains('open')));
  }
  const label = box.querySelector('.label');
  const now = labelOf(thinking, live);
  if (label && label.textContent !== now) label.textContent = now;
}
