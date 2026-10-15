/* Cozy Novel — js/ui/prose.js — the story drawn as a book page.
 *
 * Each line is a paragraph; a line of * * * (or ---, ***, #, ⁂) is a scene
 * break; *italic* and **bold** are drawn as such; dialogue can be tinted.
 * The stored words are never changed by drawing them. Every paragraph keeps a
 * map from the letters on screen back to the letters stored, so words he
 * selects on screen are found exactly in the passage. */

import { BREAK_LINE as BREAK } from '../novel/textshape.js';

const HEADING = /^\s{0,3}#{1,4}\s+(.+?)\s*#*\s*$/;
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const maps = new WeakMap();      /* <p> -> {start, srcOf: number[]} */

/* where the markup is in one paragraph's raw text: the delimiters to hide and
 * the tags to open and close around the letters */
function marks(raw, tint) {
  const hide = new Set();
  const open = new Map();   /* index -> [tags] opened before the letter */
  const close = new Map();  /* index -> [tags] closed after the letter */
  const add = (m, i, t) => { if (!m.has(i)) m.set(i, []); m.get(i).push(t); };
  let masked = raw;
  const mask = (from, len) => { masked = masked.slice(0, from) + '\u0000'.repeat(len) + masked.slice(from + len); };
  /* flanking: a bold starts and ends on a letter, never on a space or an asterisk ("*****" is text) */
  for (const m of raw.matchAll(/\*\*(?=[^\s*])([^*\n]*?[^\s*])\*\*/g)) {
    const a = m.index, b = m.index + m[0].length - 1;
    hide.add(a); hide.add(a + 1); hide.add(b); hide.add(b - 1);
    add(open, a + 2, 'strong'); add(close, b - 2, 'strong');
    mask(a, 2); mask(b - 1, 2);
  }
  for (const m of masked.matchAll(/(^|[^*\w\u0000])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g)) {
    const a = m.index + m[1].length, b = m.index + m[0].length - 1;
    hide.add(a); hide.add(b);
    add(open, a + 1, 'em'); add(close, b - 1, 'em');
  }
  for (const m of masked.matchAll(/(^|[^_\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?![_\w])/g)) {
    const a = m.index + m[1].length, b = m.index + m[0].length - 1;
    hide.add(a); hide.add(b);
    add(open, a + 1, 'em'); add(close, b - 1, 'em');
  }
  if (tint) {
    for (const m of raw.matchAll(/“[^”\n]*(?:”|$)|"[^"\n]*(?:"|$)|«[^»\n]*(?:»|$)/g)) {
      const a = m.index, b = m.index + m[0].length - 1;
      if (b <= a) continue;
      add(open, a, 'dlg'); add(close, b, 'dlg');
    }
  }
  return { hide, open, close };
}

/* one paragraph: {html, srcOf} — srcOf[k] is where the k-th letter on screen
 * stands in the raw text */
export function paragraph(raw, { tint = false } = {}) {
  const { hide, open, close } = marks(raw, tint);
  let html = '';
  const srcOf = [];
  const stack = [];
  const tag = (t) => (t === 'dlg' ? '<span class="dlg">' : `<${t}>`);
  const end = (t) => (t === 'dlg' ? '</span>' : `</${t}>`);
  for (let i = 0; i < raw.length; i++) {
    for (const t of open.get(i) || []) { html += tag(t); stack.push(t); }
    if (!hide.has(i)) {
      const ch = raw[i];
      html += ESC[ch] || ch;
      srcOf.push(i);
    }
    for (const t of (close.get(i) || []).slice().reverse()) {
      const at = stack.lastIndexOf(t);
      if (at < 0) continue;
      /* close what was opened after it, then reopen it, so tags always nest */
      const after = stack.splice(at);
      for (let k = after.length - 1; k >= 0; k--) html += end(after[k]);
      for (let k = 1; k < after.length; k++) { html += tag(after[k]); stack.push(after[k]); }
    }
  }
  while (stack.length) html += end(stack.pop());
  return { html, srcOf };
}

/* one line of the stored text as it is drawn: a paragraph, a scene break, a
 * heading — or nothing, for an empty line. start: where it stands in the text */
function lineEl(line, start, tint) {
  if (!line.trim()) return null;
  if (BREAK.test(line)) { const p = document.createElement('p'); p.className = 'brk'; p.textContent = '❦'; return p; }
  const hm = HEADING.exec(line);
  if (hm) { const p = document.createElement('p'); p.className = 'sub'; p.textContent = hm[1].replace(/\*+/g, ''); return p; }
  const lead = line.match(/^\s*/)[0].length;
  const { html, srcOf } = paragraph(line.slice(lead), { tint });
  const p = document.createElement('p');
  p.innerHTML = html;
  maps.set(p, { start: start + lead, srcOf });
  return p;
}

/* what each .prose was last drawn with, line by line — so words still
 * arriving redraw only the paragraph they land on: the text, its lines (and
 * the paragraph each became), how many paragraphs are on screen, and where
 * its last line begins */
const drawn = new WeakMap();   /* .prose -> { tint, text, lines: [{ line, el }], shown, lastAt } */

function drawLines(frag, parts, pos, tint, lines) {
  for (const line of parts) {
    const el = lineEl(line, pos, tint);
    lines.push({ line, el });
    if (el) frag.append(el);
    pos += line.length + 1;
  }
}
function keep(into, tint, text, lines) {
  let shown = 0;
  for (const l of lines) if (l.el) shown++;
  drawn.set(into, { tint, text, lines, shown, lastAt: text.length - lines[lines.length - 1].line.length });
}

/* Draw a passage's text into `into` (a .prose element). */
export function drawProse(into, text, { tint = false } = {}) {
  const raw = String(text || '');
  into.textContent = '';
  const lines = [];
  const frag = document.createDocumentFragment();
  drawLines(frag, raw.split('\n'), 0, tint, lines);
  into.append(frag);
  keep(into, tint, raw, lines);
}

/* Reuse the paragraph and its unchanged inline nodes while a sentence
 * grows. appendData also keeps a selection in the words already written;
 * replacing a whole paragraph used to make those words blink each token. */
function sameNode(a, b) {
  return a.nodeType === b.nodeType && (a.nodeType === 3 || (a.nodeName === b.nodeName && a.className === b.className));
}
function amendNode(into, fresh) {
  if (into.nodeType === 3) {
    const before = into.data, after = fresh.data;
    if (before === after) return;
    if (after.startsWith(before)) { into.appendData(after.slice(before.length)); return; }
    let a = 0, b = 0;
    while (a < before.length && a < after.length && before[a] === after[a]) a++;
    while (b < before.length - a && b < after.length - a && before[before.length - b - 1] === after[after.length - b - 1]) b++;
    into.replaceData(a, before.length - a - b, after.slice(a, after.length - b));
    return;
  }
  let old = into.firstChild;
  for (const node of [...fresh.childNodes]) {
    if (old && sameNode(old, node)) { amendNode(old, node); old = old.nextSibling; }
    else { into.insertBefore(node, old); if (old) { const next = old.nextSibling; old.remove(); old = next; } }
  }
  while (old) { const next = old.nextSibling; old.remove(); old = next; }
}

/* The same, for a passage still being written: the paragraphs before the
 * first one that changed stay exactly as they are on screen. Words that only
 * grow the text (the usual stream) are not even split again before the last
 * line drawn — the work is the newest paragraph's, however long the passage. */
export function growProse(into, text, { tint = false } = {}) {
  const raw = String(text || '');
  const was = drawn.get(into);
  /* drawn some other way since (or with something else in it, like "Writing…"): drawn whole */
  if (!was || was.tint !== tint || into.childNodes.length !== was.shown) { drawProse(into, raw, { tint }); return; }
  if (raw === was.text) return;
  let k;
  let pos;
  let parts;
  if (raw.startsWith(was.text.slice(0, was.lastAt))) {
    /* only the last line drawn, and what comes after it, can be new */
    k = was.lines.length - 1;
    pos = was.lastAt;
    parts = raw.slice(pos).split('\n');
    if (parts[0] === was.lines[k].line) { pos += parts[0].length + 1; parts = parts.slice(1); k += 1; }
  } else {
    const all = raw.split('\n');
    const n = Math.min(all.length, was.lines.length);
    k = 0;
    pos = 0;
    while (k < n && all[k] === was.lines[k].line) { pos += all[k].length + 1; k++; }
    parts = all.slice(k);
  }
  const lines = was.lines.slice(0, k);
  for (const line of parts) {
    let el = lineEl(line, pos, tint);
    const before = was.lines[lines.length]?.el;
    if (el && before && sameNode(before, el)) {
      amendNode(before, el);
      const map = maps.get(el);
      if (map) maps.set(before, map); else maps.delete(before);
      el = before;
    } else if (before) {
      if (el) before.replaceWith(el); else before.remove();
    } else if (el) {
      /* A previously blank line may now be text before later paragraphs. */
      const next = was.lines.slice(lines.length + 1).find((x) => x.el && x.el.parentNode === into)?.el;
      into.insertBefore(el, next || null);
    }
    lines.push({ line, el });
    pos += line.length + 1;
  }
  for (let i = was.lines.length - 1; i >= lines.length; i--) if (was.lines[i].el) was.lines[i].el.remove();
  keep(into, tint, raw, lines);
}

/* Where a point on screen (a text node and an offset in it) stands in the
 * stored text, or -1. `edge` 'start' or 'end'. */
export function sourceOffset(node, offset, edge = 'start') {
  let p = node.nodeType === 1 ? node : node.parentNode;
  while (p && !(p.tagName === 'P' && maps.has(p))) p = p.parentNode;
  if (!p) return -1;
  const { start, srcOf } = maps.get(p);
  let k = 0;
  if (node === p) {
    /* an offset counted in child nodes */
    for (let i = 0; i < offset && i < p.childNodes.length; i++) k += p.childNodes[i].textContent.length;
  } else {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (t === node) { k += offset; break; }
      k += t.textContent.length;
    }
  }
  if (!srcOf.length) return start;
  if (edge === 'end') return start + (k <= 0 ? 0 : srcOf[Math.min(k, srcOf.length) - 1] + 1);
  return start + (k >= srcOf.length ? srcOf[srcOf.length - 1] + 1 : srcOf[k]);
}

/* The words he selected inside one passage, as stored offsets. */
export function selectionIn(passageEl) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  const prose = passageEl.querySelector('.prose');
  if (!prose || !prose.contains(r.startContainer) || !prose.contains(r.endContainer)) return null;
  const a = sourceOffset(r.startContainer, r.startOffset, 'start');
  const b = sourceOffset(r.endContainer, r.endOffset, 'end');
  if (a < 0 || b < 0 || b <= a) return null;
  return { start: a, end: b };
}
