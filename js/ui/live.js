/* Cozy Novel — js/ui/live.js — WORDS AS THEY ARRIVE, drawn the way Cozy
 * Tavern draws them, so the page scrolls smoothly while it streams:
 *
 * - paced(): painted at most once a frame, and never more often than four
 *   times what the last paint cost (Cozy Tavern's M164) — a short text paints
 *   every frame, a very long one a few times a second, and painting never
 *   takes more than a fifth of the phone's time.
 * - streamLines(): a plain text (the thinking, a reply beside the page) drawn
 *   line by line (M279): the lines that have not changed are left alone, so a
 *   frame's new words touch only the line they land on, however long the
 *   whole grows.
 * - follower(): the follow law (M37, SillyTavern's): while words stream the
 *   view follows them only until his hand moves it up; from then on it stays
 *   exactly where he put it, and follows again only once he brings it back
 *   down to the words. A finger resting on the page holds it too. */

export function paced(paint) {
  let frame = 0;
  let timer = 0;
  let cost = 0;
  let at = 0;
  const now = () => {
    frame = requestAnimationFrame(() => {
      frame = 0;
      const t0 = performance.now();
      try { paint(); } finally { at = performance.now(); cost = at - t0; }
    });
  };
  return {
    ask() {
      if (frame || timer) return;
      const owed = at + cost * 4 - performance.now();
      if (owed > 0) { timer = setTimeout(() => { timer = 0; now(); }, owed); return; }
      now();
    },
    cancel() {
      if (frame) cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
      frame = 0; timer = 0;
    },
  };
}

/* blocks: each line its own block (the thinking); otherwise each line is a
 * text node in the same run of text (a reply, whose "…" sits after its last
 * word). Returns whether anything was drawn. */
const drawnLines = new WeakMap();   /* box -> { blocks, data: string[], nodes: Node[] } */
export function streamLines(box, text, { blocks = false } = {}) {
  const parts = String(text || '').split('\n');
  const want = blocks ? parts : parts.map((p, i) => (i < parts.length - 1 ? p + '\n' : p));
  let was = drawnLines.get(box);
  if (!was || was.blocks !== blocks || box.childNodes.length !== was.nodes.length) {
    box.textContent = '';
    was = { blocks, data: [], nodes: [] };
  }
  let k = 0;
  const n = Math.min(want.length, was.data.length);
  while (k < n && want[k] === was.data[k]) k++;
  if (k === want.length && k === was.data.length) return false;
  for (let i = was.nodes.length - 1; i >= k; i--) was.nodes[i].remove();
  const data = was.data.slice(0, k);
  const nodes = was.nodes.slice(0, k);
  const doc = box.ownerDocument;
  const frag = doc.createDocumentFragment();
  for (let i = k; i < want.length; i++) {
    let node;
    if (blocks) { node = doc.createElement('div'); node.className = 'ln'; node.textContent = want[i]; }
    else node = doc.createTextNode(want[i]);
    frag.append(node);
    data.push(want[i]);
    nodes.push(node);
  }
  box.append(frag);
  drawnLines.set(box, { blocks, data, nodes });
  return true;
}

/* tail(): where the view stands when it is with the newest words (the
 * bottom, unless said otherwise). onChange(on): told when following starts
 * or stops. */
export function follower(box, { tail = null, onChange = null } = {}) {
  let on = true;
  let hand = false;
  let last = box.scrollTop;
  const max = () => Math.max(0, box.scrollHeight - box.clientHeight);
  const target = () => Math.max(0, Math.min(max(), tail ? tail() : max()));
  const atTail = () => box.scrollTop >= target() - 8;
  const set = (v) => { if (on === v) return; on = v; if (onChange) onChange(v); };
  box.addEventListener('scroll', () => {
    const y = box.scrollTop;
    if (y < last - 2 && !atTail()) set(false);     /* the hand went up */
    else if (atTail()) set(true);                   /* and brought it back down */
    last = y;
  }, { passive: true });
  for (const ev of ['wheel', 'touchmove']) box.addEventListener(ev, () => { if (!atTail()) set(false); }, { passive: true });
  box.addEventListener('touchstart', () => { hand = true; }, { passive: true });
  for (const ev of ['touchend', 'touchcancel']) box.addEventListener(ev, () => { hand = false; }, { passive: true });
  return {
    get on() { return on; },
    get hand() { return hand; },
    atTail,
    start() { set(true); },
    stop() { set(false); },
    /* the app moved the view itself (a redraw keeping his place, a jump to
     * the words): not his hand */
    jump(y) { box.scrollTop = y; last = box.scrollTop; },
    moved() { last = box.scrollTop; },
    /* new words are drawn: the view goes down to them, when following —
     * never up, and never under his finger */
    follow() {
      if (!on || hand) return false;
      const t = target();
      if (t <= box.scrollTop + 1) return false;
      box.scrollTop = t;
      last = box.scrollTop;
      return true;
    },
  };
}
