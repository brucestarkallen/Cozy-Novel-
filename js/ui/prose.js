/* Cozy Novel — js/ui/prose.js — the story drawn as a book page.
 *
 * Each line is a paragraph; a line of * * * (or ---, ***, #, ⁂) is a scene
 * break; *italic* and **bold** are drawn as such; dialogue can be tinted.
 * The stored words are never changed by drawing them. Every paragraph keeps a
 * map from the letters on screen back to the letters stored, so words he
 * selects on screen are found exactly in the passage. */

const BREAK = /^\s*(?:\*\s*\*\s*\*|\*{3,}|-{3,}|_{3,}|#|⁂|~{3,}|❦|•\s*•\s*•)\s*$/;
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
  for (const m of raw.matchAll(/\*\*(?=\S)([^*\n]*?\S)\*\*/g)) {
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

/* Draw a passage's text into `into` (a .prose element). */
export function drawProse(into, text, { tint = false } = {}) {
  const raw = String(text || '');
  into.textContent = '';
  let pos = 0;
  const frag = document.createDocumentFragment();
  for (const line of raw.split('\n')) {
    const start = pos;
    pos += line.length + 1;
    if (!line.trim()) continue;
    if (BREAK.test(line)) { const p = document.createElement('p'); p.className = 'brk'; p.textContent = '❦'; frag.append(p); continue; }
    const hm = HEADING.exec(line);
    if (hm) { const p = document.createElement('p'); p.className = 'sub'; p.textContent = hm[1].replace(/\*+/g, ''); frag.append(p); continue; }
    const lead = line.match(/^\s*/)[0].length;
    const body = line.slice(lead);
    const { html, srcOf } = paragraph(body, { tint });
    const p = document.createElement('p');
    p.innerHTML = html;
    maps.set(p, { start: start + lead, srcOf });
    frag.append(p);
  }
  into.append(frag);
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
