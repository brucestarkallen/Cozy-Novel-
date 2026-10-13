/* Cozy Novel — js/ui/think.js — THE THINKING, beside what it led to. While
 * the model thinks it streams open, live; once its words begin it folds to
 * one line ("The thinking (N words)"), a tap away, with Copy. The page, the
 * partner and the scenes all show it the same way. */

import { h, icon, toast, copyText } from './dom.js';
import { plural, countWords } from '../util.js';

const labelOf = (thinking, live) => (live ? 'Thinking…' : `The thinking (${plural(countWords(thinking), 'word')})`);

/* live: still thinking (open and streaming). open: unfolded by him.
 * onToggle(now): told when he opens or folds it, so a redraw keeps it so. */
export function thinkBox(thinking, { live = false, open = false, onToggle = null } = {}) {
  const box = h('div.thinkbox' + (open ? '.open' : '') + (live ? '.live' : ''));
  const words = h('div.words', thinking);
  const copy = h('button.copy', { onclick: async () => toast((await copyText(words.textContent || '')) ? 'The thinking is copied.' : 'It could not be copied.') }, 'Copy it');
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

/* the same box, brought up to date as more thinking — or the first words — arrive */
export function updateThinkBox(box, thinking, { live = false } = {}) {
  const words = box.querySelector('.words');
  if (words) words.textContent = thinking;
  box.classList.toggle('live', live);
  const label = box.querySelector('.label');
  if (label) label.textContent = labelOf(thinking, live);
  const btn = box.querySelector(':scope > button');
  if (btn) btn.setAttribute('aria-expanded', String(live || box.classList.contains('open')));
  if (live && words) words.scrollTop = words.scrollHeight;
}
