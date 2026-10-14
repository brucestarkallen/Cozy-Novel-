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
 * word). A line that runs long is drawn in pieces — ended at its next
 * sentence past 500 characters, or at its next space past 1,500 (Cozy
 * Tavern M279: a thinking with no line breaks at all was one line, drawn
 * whole every frame, and froze the phone) — so a frame's new words touch only
 * the piece they land on; the pieces of a line stay one line on the screen.
 * Returns whether anything was drawn. */
const LONG = 500;
const HARD = 1500;
export function piecesOf(line) {
  const out = [];
  let rest = line;
  for (;;) {
    if (rest.length <= LONG) break;
    const m = /[.!?…]["”’)\]]*\s/.exec(rest.slice(LONG));
    const atSentence = m ? LONG + m.index + m[0].length : Infinity;
    const sp = rest.length > HARD ? rest.indexOf(' ', HARD) : -1;
    const atSpace = sp >= 0 ? sp + 1 : Infinity;
    const cut = Math.min(atSentence, atSpace);
    if (!Number.isFinite(cut) || cut >= rest.length) break;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  out.push(rest);
  return out;
}
const drawnLines = new WeakMap();   /* box -> { blocks, data: [{ t, ln }], nodes: Text[], lines: Element[] } */
export function streamLines(box, text, { blocks = false } = {}) {
  const parts = String(text || '').split('\n');
  const want = [];
  parts.forEach((p, ln) => {
    const pcs = piecesOf(p);
    pcs.forEach((t, k) => want.push({ t: !blocks && ln < parts.length - 1 && k === pcs.length - 1 ? t + '\n' : t, ln }));
  });
  let was = drawnLines.get(box);
  if (!was || was.blocks !== blocks || box.childNodes.length !== (blocks ? was.lines.length : was.nodes.length)) {
    box.textContent = '';
    was = { blocks, data: [], nodes: [], lines: [] };
  }
  let k = 0;
  const n = Math.min(want.length, was.data.length);
  while (k < n && want[k].t === was.data[k].t && want[k].ln === was.data[k].ln) k++;
  if (k === want.length && k === was.data.length) return false;
  for (let i = was.nodes.length - 1; i >= k; i--) was.nodes[i].remove();
  const data = was.data.slice(0, k);
  const nodes = was.nodes.slice(0, k);
  /* the lines kept: those with a piece still drawn */
  const keepLines = k ? data[k - 1].ln + 1 : 0;
  for (let i = was.lines.length - 1; i >= keepLines; i--) was.lines[i].remove();
  const lines = was.lines.slice(0, keepLines);
  const doc = box.ownerDocument;
  for (let i = k; i < want.length; i++) {
    const node = doc.createTextNode(want[i].t);
    if (blocks) {
      let line = lines[want[i].ln];
      if (!line) { line = doc.createElement('div'); line.className = 'ln'; box.append(line); lines[want[i].ln] = line; }
      line.append(node);
    } else box.append(node);
    data.push(want[i]);
    nodes.push(node);
  }
  drawnLines.set(box, { blocks, data, nodes, lines });
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
