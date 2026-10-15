/* Cozy Novel — js/ui/dom.js — the small kit every screen is built from. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* h('button.btn.primary', {onclick, title}, 'Write') */
export function h(tag, attrs = {}, ...kids) {
  const [name, ...classes] = String(tag).split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = {}; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  notes: '<path d="M6 3.5h9l3 3V20.5H6z"/><path d="M9 9.5h6M9 13h6M9 16.5h4"/>',
  chat: '<path d="M4 5.5h16v10H9l-5 4z"/>',
  mask: '<path d="M4 6c3 1.4 13 1.4 16 0v5c0 4.5-3.6 8-8 8s-8-3.5-8-8z"/><path d="M8.5 11.5c.8-.6 1.7-.6 2.5 0M13 11.5c.8-.6 1.7-.6 2.5 0M9.5 15c1.4 1 3.6 1 5 0"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.3 9v.03A1.7 1.7 0 0 0 21 10.06H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  feather: '<path d="M20 4c-6 0-11 4-12 10l-2 6 6-2c6-1 10-6 8-14z"/><path d="M8 16l6-6"/>',
  book: '<path d="M4 4.5h6a2 2 0 0 1 2 2V20a2 2 0 0 0-2-2H4z"/><path d="M20 4.5h-6a2 2 0 0 0-2 2V20a2 2 0 0 1 2-2h6z"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};
export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.style.display = 'inline-grid';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

/* ------------------------------------------------------------- toast */
let toastTimer = null;
function placeToast() {
  const t = $('#toast');
  if (t) (focusedSheet()?.box || document.body).append(t);
}
function hideToast(t) { t.classList.remove('on'); t.inert = true; t.setAttribute('aria-hidden', 'true'); }
/* One line at the bottom, for a moment. With an action (Undo), it stays a
 * little longer; whichever line came last is the one shown, for its own time. */
export function toast(words, ms = 3200, action = null) {
  let t = $('#toast');
  if (!t) { t = h('div.toast', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = words;
  if (action) {
    t.append(' ', h('button.toastact', { onclick: () => { clearTimeout(toastTimer); hideToast(t); action.run(); } }, action.label));
  }
  placeToast();
  t.inert = false;
  t.removeAttribute('aria-hidden');
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hideToast(t), ms);
}
export function undoToast(words, undo) { toast(words, 7000, { label: 'Undo', run: undo }); }

/* ------------------------------------------------------- the phone's Back */
/* Whatever is open over the page (a sheet, a drawer, a menu, the edit box)
 * closes on the phone's Back instead of leaving the book. Each one open has
 * a step in the history, and each step says how deep it is — so wherever
 * Back (or Forward) lands, the page knows which overlays stand above it.
 *
 * The steps follow the overlays a moment later, all at once: something
 * closed and something opened in the same moment (a menu item that opens a
 * sheet) hands its step over instead of stepping back and forth; and no step
 * is pushed while a step back of the app's own is still on its way — the
 * browser would count that step back from the new step, and the next Back
 * would leave the book. */
const backs = [];
let have = (history.state && Number.isInteger(history.state.cozy)) ? history.state.cozy : 0;  /* our steps in the history, once a step in flight lands */
let flying = false;      /* a step back of ours that has not landed yet */
let flyTimer = 0;
let syncTimer = 0;
const backWaiters = [];

export function onBack(close) {
  const e = { close, done: false };
  backs.push(e);
  sync();                /* its step at once, so Back works the moment it is open */
  return () => {
    if (e.done) return;
    e.done = true;
    const i = backs.indexOf(e);
    if (i >= 0) backs.splice(i, 1);
    if (!syncTimer) syncTimer = setTimeout(sync, 0);
  };
}
function sync() {
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = 0; }
  if (flying) return;
  const want = backs.length;
  if (want > have) {
    while (have < want) { have++; history.pushState({ cozy: have }, ''); }
  } else if (want < have) {
    const n = have - want;
    flying = true;
    history.go(-n);
    /* a step back the browser drops is not waited on for ever */
    clearTimeout(flyTimer);
    flyTimer = setTimeout(() => { if (flying) { flying = false; have = want; sync(); } }, 900);
    return;
  }
  for (const f of backWaiters.splice(0)) f();
}
window.addEventListener('popstate', (ev) => {
  const depth = ev.state && Number.isInteger(ev.state.cozy) ? ev.state.cozy : 0;
  if (flying) {
    flying = false;
    clearTimeout(flyTimer);
    have = depth;
    sync();
    return;
  }
  /* he moved: whatever stood above where he is now closes, the top one first */
  have = depth;
  while (backs.length > depth) {
    const e = backs.pop();
    if (e.done) continue;
    e.done = true;
    try { e.close(true); } catch (err) { console.error(err); }
  }
  sync();
});
export function backDepth() { return backs.length; }
/* Before the page goes somewhere else, whatever is open over it closes — as
 * if Back had been pressed for each — in one step back through the history,
 * so the new address lands on the page's own place, never on an overlay's. */
export function dropOverlays() {
  for (const e of backs.splice(0).reverse()) {
    if (e.done) continue;
    e.done = true;
    try { e.close(true); } catch (err) { console.error(err); }
  }
  sync();
}
/* Going somewhere new waits until the app's own steps back have landed — a
 * step back that lands after a new address would undo it. */
export function afterBacks() {
  if (syncTimer) sync();
  if (!flying) return Promise.resolve();
  return new Promise((resolve) => backWaiters.push(resolve));
}

/* ------------------------------------------------------------- sheets */
/* A sheet over the page. Returns {box, body, close}. */
const sheets = [];
/* Only the sheet at the top of the Back stack owns the keyboard. A menu or
 * another overlay opened from it gets the keyboard until it closes. */
function focusedSheet() {
  const top = sheets[sheets.length - 1];
  return top && top.back === backs[backs.length - 1] ? top : null;
}
function canFocus(el) {
  return el && el.isConnected && typeof el.focus === 'function' && !el.matches(':disabled') &&
    !el.closest('[inert]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
}
function sheetStops(box) {
  return [...box.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex], [contenteditable]')]
    .filter((el) => el.tabIndex >= 0 && canFocus(el));
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || e.defaultPrevented) return;
  const top = focusedSheet();
  if (!top) return;
  const stops = sheetStops(top.box);
  const at = stops.indexOf(document.activeElement);
  if (!stops.length || at < 0 || (e.shiftKey ? at === 0 : at === stops.length - 1)) {
    e.preventDefault();
    (stops.length ? stops[e.shiftKey ? stops.length - 1 : 0] : top.box).focus({ preventScroll: true });
  }
});
document.addEventListener('focusin', (e) => {
  const top = focusedSheet();
  if (!top) return;
  if (top.box.contains(e.target)) { top.lastFocus = e.target; return; }
  (canFocus(top.lastFocus) ? top.lastFocus : top.box).focus({ preventScroll: true });
});
export function openSheet(title, { small = false, onClose = null, actions = [] } = {}) {
  closeMenu();
  const body = h('div.body');
  const entry = { onClose, closed: false, from: document.activeElement };
  const close = () => shut(entry);
  const heading = h('h2', title);
  const box = h('div.box', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    h('div.head', heading, ...actions, h('button.icon', { 'aria-label': 'Close', onclick: close }, icon('close'))),
    body);
  const wrap = h('div.sheet' + (small ? '.small' : ''), { onclick: (e) => { if (e.target === wrap) close(); } }, box);
  entry.wrap = wrap;
  entry.box = box;
  document.body.append(wrap);
  requestAnimationFrame(() => {
    if (entry.closed) return;
    wrap.classList.add('on');
    /* the keyboard's place moves into the sheet (unless something in it took it already) */
    if (focusedSheet() === entry && !box.contains(document.activeElement)) box.focus({ preventScroll: true });
  });
  sheets.push(entry);
  entry.release = onBack(() => shut(entry, true));
  entry.back = backs[backs.length - 1];
  placeToast();
  const setTitle = (t) => { heading.textContent = t; box.setAttribute('aria-label', t); };
  return { box, body, close, wrap, setTitle };
}
function shut(entry, fromBack = false) {
  if (entry.closed) return;
  entry.closed = true;
  const i = sheets.indexOf(entry);
  const wasTop = i === sheets.length - 1;
  if (openMenu && entry.wrap.contains(openMenu.anchor)) closeMenu();
  if (i >= 0) sheets.splice(i, 1);
  entry.wrap.classList.remove('on');
  setTimeout(() => entry.wrap.remove(), 220);
  if (!fromBack && entry.release) entry.release();
  placeToast();
  if (entry.onClose) { try { entry.onClose(); } catch (e) { console.error(e); } }
  /* A nested sheet returns to its opener in the parent. The parent's words
   * may have been drawn again meanwhile; in that case return to its box. */
  const back = entry.from;
  const top = focusedSheet();
  if (wasTop && (!sheets.length || top)) {
    const target = canFocus(back) && (!top || top.box.contains(back)) ? back : top && top.box;
    if (target) { try { target.focus({ preventScroll: true }); } catch (_) { /* gone */ } }
  }
  entry.wrap.inert = true;
  entry.wrap.setAttribute('aria-hidden', 'true');
}
export function closeTopSheet() {
  const top = sheets[sheets.length - 1];
  if (!top) return false;
  shut(top);
  return true;
}
export function closeAllSheets() { while (sheets.length) shut(sheets[sheets.length - 1]); }
export function sheetOpen() { return sheets.length > 0; }

/* A question with buttons. Resolves to the chosen value (or null). */
export function askChoice(title, words, choices) {
  return new Promise((resolve) => {
    let picked = null;
    const s = openSheet(title, { small: true, onClose: () => resolve(picked) });
    if (words) s.body.append(h('p.say', { style: { color: 'var(--chrome-ink)', fontSize: '15px' } }, words));
    const row = h('div.btnrow');
    for (const c of choices) {
      row.append(h('button.btn' + (c.primary ? '.primary' : '') + (c.danger ? '.danger' : '') + (c.quiet ? '.quiet' : ''), { onclick: () => { picked = c.value; s.close(); } }, c.label));
    }
    s.body.append(row);
  });
}
export function confirmIt(title, words, yes = 'Yes', { danger = false } = {}) {
  return askChoice(title, words, [{ label: yes, value: true, primary: !danger, danger }, { label: 'Not now', value: false, quiet: true }]).then((v) => v === true);
}
/* A line (or a few) of words. Resolves to the text, or null. */
export function askText(title, { words = '', value = '', placeholder = '', yes = 'Done', multiline = false } = {}) {
  return new Promise((resolve) => {
    let out = null;
    const s = openSheet(title, { small: !multiline, onClose: () => resolve(out) });
    if (words) s.body.append(h('p.say', words));
    const box = multiline ? h('textarea', { rows: 6, placeholder, 'aria-label': title }) : h('input', { type: 'text', placeholder, 'aria-label': title });
    box.value = value;
    const field = h('label.field', box);
    s.body.append(field, h('div.btnrow', h('button.btn.primary', { onclick: () => { out = box.value; s.close(); } }, yes)));
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline && !e.isComposing) { e.preventDefault(); out = box.value; s.close(); } });
    setTimeout(() => { if (!s.wrap.classList.contains('on')) return; box.focus(); if (box.select && value) box.select(); }, 60);
  });
}

/* ------------------------------------------------------------- menus */
/* A menu is open over the page like a sheet: the phone's Back (or Escape)
 * closes it and nothing else, and the screen it was opened on is the one it
 * acts on. */
let openMenu = null;
export function menu(anchor, items) {
  closeMenu();
  const pop = h('div.menu-pop', { role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { pop.append(h('hr')); continue; }
    if (it.label && it.header) { pop.append(h('div.label', it.label)); continue; }
    /* each item can say in a small line what it does (Cozy Tavern's quiet lines) */
    pop.append(h('button' + (it.danger ? '.danger' : '') + (it.hint ? '.hinted' : ''), { role: it.checked !== undefined ? 'menuitemradio' : 'menuitem', 'aria-checked': it.checked === undefined ? undefined : String(Boolean(it.checked)), disabled: it.disabled,
      onclick: (e) => { e.stopPropagation(); closeMenu(); if (it.run) it.run(); } }, it.hint ? h('span.mlabel', it.label) : it.label, it.hint ? h('small.mhint', it.hint) : null));
  }
  pop.addEventListener('keydown', (e) => {
    const list = Array.from(pop.querySelectorAll('button:not([disabled])'));
    const at = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = list.length;
      if (n) list[(at + (e.key === 'ArrowDown' ? 1 : n - 1) + n) % n].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (list.length) list[e.key === 'Home' ? 0 : list.length - 1].focus();
    } else if (e.key === 'Tab') closeMenu();
  });
  document.body.append(pop);
  const m = { pop, anchor, viewport: window.visualViewport, frame: 0, release: onBack(() => closeMenu(true)) };
  openMenu = m;
  placeMenu(m);
  if (openMenu !== m) return;
  window.addEventListener('resize', placeMenuSoon);
  if (m.viewport) {
    m.viewport.addEventListener('resize', placeMenuSoon);
    m.viewport.addEventListener('scroll', placeMenuSoon);
  }
  m.outsideTimer = setTimeout(() => { if (openMenu === m) document.addEventListener('pointerdown', outside, { capture: true }); }, 0);
  const first = pop.querySelector('button:not([disabled])');
  if (first) first.focus({ preventScroll: true });
}
/* Folding the phone or opening its keyboard moves the anchor and the room
 * available around it. Move the same menu: its focus and Back step stay. */
function placeMenuSoon() {
  const m = openMenu;
  if (!m || m.frame) return;
  m.frame = requestAnimationFrame(() => { m.frame = 0; if (openMenu === m) placeMenu(m); });
}
function placeMenu(m) {
  if (!m.anchor.isConnected) { closeMenu(); return; }
  const v = m.viewport;
  const left = (v ? v.offsetLeft : 0) + 8, top = (v ? v.offsetTop : 0) + 8;
  const width = Math.max(0, (v ? v.width : innerWidth) - 16);
  const height = Math.max(0, (v ? v.height : innerHeight) - 16);
  /* Reset the old position before measuring: an offscreen left edge can
   * otherwise squeeze the menu to its minimum width after a fold. */
  const { pop } = m;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  pop.style.minWidth = Math.min(220, width) + 'px';
  pop.style.maxWidth = Math.min(340, innerWidth * .92, width) + 'px';
  pop.style.maxHeight = height + 'px';
  const r = m.anchor.getBoundingClientRect();
  const w = pop.offsetWidth, ht = pop.offsetHeight;
  let y = r.bottom + 6;
  if (y + ht > top + height) y = r.top - ht - 6;
  pop.style.left = Math.max(left, Math.min(r.left, left + width - w)) + 'px';
  pop.style.top = Math.max(top, Math.min(y, top + height - ht)) + 'px';
  if (pop.contains(document.activeElement)) document.activeElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function outside(e) { if (openMenu && !openMenu.pop.contains(e.target)) closeMenu(); }
export function closeMenu(fromBack = false) {
  document.removeEventListener('pointerdown', outside, { capture: true });
  if (!openMenu) return;
  const m = openMenu;
  openMenu = null;
  clearTimeout(m.outsideTimer);
  cancelAnimationFrame(m.frame);
  window.removeEventListener('resize', placeMenuSoon);
  if (m.viewport) {
    m.viewport.removeEventListener('resize', placeMenuSoon);
    m.viewport.removeEventListener('scroll', placeMenuSoon);
  }
  const hadFocus = m.pop.contains(document.activeElement);
  m.pop.remove();
  if (!fromBack && m.release) m.release();
  if (hadFocus && m.anchor && m.anchor.isConnected) { try { m.anchor.focus({ preventScroll: true }); } catch (_) { /* gone */ } }
}
export function menuOpen() { return Boolean(openMenu); }
/* Escape on a keyboard is the phone's Back: whatever is open over the page —
 * a menu, a sheet, a drawer — closes, the top one first. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (backs.length) { e.preventDefault(); if (!flying) history.back(); }
});

/* ------------------------------------------------------------- folds */
/* A section that folds closed (he likes busy screens folded). Remembers by key. */
const FOLDS = 'cozynovel.folds';
function folds() { try { return JSON.parse(localStorage.getItem(FOLDS) || '{}'); } catch (_) { return {}; } }
export function group(title, { key = '', open = false, note = '' } = {}, ...kids) {
  const state = folds();
  const isOpen = key && key in state ? state[key] : open;
  const body = h('div.gbody', ...kids);
  const g = h('section.group' + (isOpen ? '' : '.fold'), { 'data-key': key || undefined },
    h('button.ghead', { 'aria-expanded': String(isOpen), onclick: () => {
      const now = g.classList.toggle('fold');
      g.firstChild.setAttribute('aria-expanded', String(!now));
      if (key) { const s = folds(); s[key] = !now; try { localStorage.setItem(FOLDS, JSON.stringify(s)); } catch (_) { /* this visit only */ } }
    } }, h('h3', title), note ? h('small', note) : null, h('span.chev', icon('chev', 18))),
    body);
  g.body = body;
  return g;
}

export function field(label, control, hint = '') {
  return h('label.field', h('span', label), control, hint ? h('em', hint) : null);
}

/* a textarea that grows with what is in it — measured again whenever it can
 * be seen at a new width (a box measured while hidden is measured as nothing) */
export function autoGrow(ta, max = 0.32) {
  const fit = () => {
    if (!ta.isConnected || !ta.offsetParent) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, Math.round(window.innerHeight * max)) + 'px';
  };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  if (typeof ResizeObserver === 'function') {
    let width = 0;
    new ResizeObserver(() => { const w = ta.clientWidth; if (w && w !== width) { width = w; fit(); } }).observe(ta);
  }
  return fit;
}

export function download(name, blobOrText, type = 'text/plain') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    const finish = () => { resolve(inp.files && inp.files[0] ? inp.files[0] : null); inp.remove(); };
    inp.addEventListener('change', finish, { once: true });
    inp.addEventListener('cancel', finish, { once: true });
    document.body.append(inp);
    inp.click();
  });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* fall back */ }
  const from = document.activeElement;
  const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } });
  ta.value = text;
  /* Keep the fallback inside the active sheet so its focus guard does not
   * take the selection away before the browser has copied the words. */
  (focusedSheet()?.box || document.body).append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  ta.remove();
  if (canFocus(from)) from.focus({ preventScroll: true });
  return ok;
}
