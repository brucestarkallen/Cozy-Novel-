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
const drawnLines = new WeakMap();
export function streamLines(box, text, { blocks = false } = {}) {
  const raw = String(text || '');
  let was = drawnLines.get(box);
  if (!was || was.blocks !== blocks || box.childNodes.length !== (blocks ? was.lines.length : was.nodes.length)) {
    box.textContent = '';
    was = { blocks, text: '', data: [], nodes: [], lines: [] };
  } else if (raw === was.text) return false;
  /* A growing answer only splits its unfinished piece. Completed paragraphs
   * and long-line pieces need no parsing or DOM work as the answer grows. */
  let k = 0, start = 0, line = 0;
  if (was.data.length && raw.startsWith(was.text)) {
    k = was.data.length - 1;
    start = was.data[k].at;
    line = was.data[k].ln;
  }
  const parts = raw.slice(start).split('\n');
  const want = [];
  let at = start;
  parts.forEach((p, ln) => {
    const pcs = piecesOf(p);
    pcs.forEach((t, i) => {
      want.push({ t: !blocks && ln < parts.length - 1 && i === pcs.length - 1 ? t + '\n' : t, ln: line + ln, at });
      at += t.length;
    });
    at++;
  });
  let j = 0;
  while (j < want.length && k < was.data.length && want[j].t === was.data[k].t && want[j].ln === was.data[k].ln) { j++; k++; }
  if (j === want.length && k === was.data.length) { was.text = raw; drawnLines.set(box, was); return false; }
  const doc = box.ownerDocument;
  for (let i = j; i < want.length; i++, k++) {
    const item = want[i];
    let node = was.nodes[k];
    if (node && was.data[k].ln === item.ln) {
      /* Keep even the newest text node: replacing it on every token made
       * live text blink and discarded browser selection/anchoring. */
      if (node.data !== item.t) {
        if (item.t.startsWith(node.data)) node.appendData(item.t.slice(node.data.length));
        else node.data = item.t;
      }
    } else {
      if (node) node.remove();
      node = doc.createTextNode(item.t);
      if (blocks) {
        let row = was.lines[item.ln];
        if (!row) { row = doc.createElement('div'); row.className = 'ln'; box.append(row); was.lines[item.ln] = row; }
        row.append(node);
      } else box.append(node);
    }
    const parent = blocks ? was.lines[item.ln] : box;
    const prior = k && (!blocks || was.data[k - 1].ln === item.ln) ? was.nodes[k - 1] : null;
    const next = prior ? prior.nextSibling : parent.firstChild;
    if (node !== next) parent.insertBefore(node, next);
    was.nodes[k] = node;
    was.data[k] = item;
  }
  for (let i = was.nodes.length - 1; i >= k; i--) was.nodes[i].remove();
  was.nodes.length = was.data.length = k;
  const keepLines = k ? was.data[k - 1].ln + 1 : 0;
  for (let i = was.lines.length - 1; i >= keepLines; i--) was.lines[i].remove();
  was.lines.length = blocks ? keepLines : 0;
  was.text = raw;
  drawnLines.set(box, was);
  return true;
}

/* tail(): where the view stands when it is with the newest words (the
 * bottom, unless said otherwise). onChange(on): told when following starts
 * or stops. */
export function follower(box, { tail = null, onChange = null, active = () => true } = {}) {
  let on = true;
  let hand = false;
  let last = box.scrollTop;
  const max = () => Math.max(0, box.scrollHeight - box.clientHeight);
  const target = () => Math.max(0, Math.min(max(), tail ? tail() : max()));
  const atTail = () => box.scrollTop >= target() - 8;
  const set = (v) => { if (on === v) return; on = v; if (onChange) onChange(v); };
  box.addEventListener('scroll', () => {
    const y = box.scrollTop;
    if (!active()) { last = y; return; }
    if (y < last - 2 && !atTail()) set(false);     /* the hand went up */
    else if (atTail()) set(true);                   /* and brought it back down */
    last = y;
  }, { passive: true });
  for (const ev of ['wheel', 'touchmove']) box.addEventListener(ev, () => { if (active() && !atTail()) set(false); }, { passive: true });
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
