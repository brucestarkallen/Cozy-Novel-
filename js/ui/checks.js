/* Cozy Novel — js/ui/checks.js — THE BUBBLE ON THE PAGE and what it holds.
 *
 * Green: every finished passage is checked and nothing needs changing. Blue:
 * the checker is at work (or will be, in a moment). Yellow, with a number:
 * suggestions waiting. Grey: nobody checks (Settings → Who does what). Red:
 * the checker's connection is in trouble. A tap opens Suggestions: each one
 * with what it would change and why — Apply, or Leave it — and Apply all. */

import * as store from '../store.js';
import * as checker from '../novel/checker.js';
import { h, icon, toast, openSheet, confirmIt } from './dom.js';
import { chapterLabel } from '../novel/shape.js';
import { GRADE_AXES } from '../novel/prompts.js';
import { findIn } from '../novel/search.js';
import { plural } from '../util.js';
import * as desk from './desk.js';

let bubble = null;
let hooks = {};
const C = { novelId: null, chapterId: null, offs: [], frame: 0, sheet: null };

const KIND = { grammar: 'Grammar', humanize: 'Humanize', avoid: 'Words to avoid', seam: 'Where it joins', continuity: 'Continuity', craft: 'Craft', grade: 'Under your mark' };

export function initChecks(el, appHooks) {
  bubble = el;
  hooks = appHooks;
  bubble.addEventListener('click', () => openSuggestions());
  checker.onChecks((novelId) => { if (novelId === C.novelId) drawSoon(); });
}

/* the book now open: what it holds, watched */
export function showChecks(novelId, chapterId) {
  if (C.novelId !== novelId) {
    for (const off of C.offs) off();
    C.offs = [];
    C.novelId = novelId;
    C.watched = new Set();
    C.offs.push(store.subscribe('novel', novelId, () => { watchChapters(); drawSoon(); }));
    C.offs.push(store.subscribe('house', 'house', () => drawSoon()));
  }
  C.chapterId = chapterId;
  watchChapters();
  drawSoon();
}
function watchChapters() {
  const n = store.peek('novel', C.novelId);
  for (const id of (n && n.order) || []) {
    if (C.watched.has(id)) continue;
    C.watched.add(id);
    C.offs.push(store.subscribe('chapter', id, () => drawSoon()));
  }
}

function drawSoon() { if (!C.frame) C.frame = requestAnimationFrame(() => { C.frame = 0; draw(); }); }

function draw() {
  if (!bubble || !C.novelId) return;
  const st = checker.stateOf(C.novelId);
  bubble.dataset.state = st.state;
  bubble.textContent = '';
  if (st.state === 'found') bubble.append(h('b', st.count > 99 ? '99+' : String(st.count)));
  else if (st.state === 'clean') bubble.append(icon('check', 20));
  else if (st.state === 'trouble') bubble.append(h('b', '!'));
  else if (st.state === 'off') bubble.append(h('b', '–'));
  else bubble.append(h('span.ring'));
  const say = st.state === 'found' ? `Suggestions: ${plural(st.count, 'suggestion')}` : `Suggestions — ${st.words}`;
  bubble.setAttribute('aria-label', say);
  bubble.title = say;
  if (C.sheet) drawSheet();
}

/* ------------------------------------------------------------ the sheet */

function openSuggestions() {
  if (!C.novelId) return;
  if (C.sheet) return;
  const s = openSheet('Suggestions', { onClose: () => { C.sheet = null; } });
  s.box.classList.add('sugsheet');
  C.sheet = s;
  drawSheet();
}

function drawSheet() {
  const s = C.sheet;
  if (!s) return;
  const novelId = C.novelId;
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const st = checker.stateOf(novelId);
  const scroll = s.body.scrollTop;
  s.body.textContent = '';
  s.body.append(h('div.sugstate', { 'data-state': st.state }, h('span.dot'), h('span', st.words)));
  const list = checker.suggestions(novelId);
  const row = h('div.btnrow');
  /* Apply all puts in every change that has its words (a sentence to write again is his to ask for) */
  const can = list.filter((x) => typeof x.item.replace === 'string').length;
  if (can > 1) row.append(h('button.btn.primary.small', { title: 'Every change below that has its words goes in — one new version for each passage, the words before one arrow away.', onclick: () => {
    const n = checker.applyAll(novelId);
    toast(n ? `${plural(n, 'change')} applied — the words before are one arrow away.` : 'Nothing could be applied — the words had changed.');
  } }, `Apply all (${can})`));
  /* the older writing, checked only when he asks */
  const here = checker.unchecked(novelId, C.chapterId);
  const all = checker.unchecked(novelId);
  const busyNow = st.state === 'checking' || st.state === 'waiting';
  /* waiting out a failure, or stopped: tried again now, by his hand */
  if (checker.stalled(novelId)) row.append(h('button.btn.primary.small', { title: 'The checker tries again at once — even after its connection was turned away. It stops again only if the trouble is still there.', onclick: () => { if (checker.tryNow(novelId)) toast('The checker tries again now.'); } }, 'Try again now'));
  if (here.passages && !busyNow && st.state !== 'off') row.append(h('button.btn.small', { title: 'The checker reads this chapter’s older passages too.', onclick: () => { checker.checkChapter(novelId, C.chapterId); toast('Checking this chapter.'); } }, 'Check this chapter'));
  if (all.passages > here.passages && !busyNow && st.state !== 'off') row.append(h('button.btn.small.quiet', { title: 'The checker reads every passage of the book not checked yet, a chapter at a time.', onclick: async () => {
    if (!(await confirmIt('Check the whole book?', `${plural(all.passages, 'passage')} that haven’t been checked — about ${all.words.toLocaleString()} words — go to the checker, a chapter at a time.`, 'Check the whole book'))) return;
    checker.checkBook(novelId);
  } }, 'Check the whole book'));
  if (row.childNodes.length) s.body.append(row);
  /* the judge: the book's passages graded, and which writer writes best by it — folded */
  const jb = judgeBox(novelId);
  if (jb) s.body.append(jb);
  /* the passages its model would not check — each with Check it again */
  const ab = asideBox(novelId);
  if (ab) s.body.append(ab);
  if (st.state === 'off') {
    s.body.append(h('div.btnrow', h('button.btn.small', { title: 'Choose who checks the writing.', onclick: () => { s.close(); hooks.openSettings('roles'); } }, 'Open Who does what')));
  }
  if (!list.length) {
    /* (older writing: the line above says so, and the buttons are there) */
    if (st.state === 'clean' && !all.passages) s.body.append(h('p.say', 'Each passage is read once it is finished — for grammar, wording that sounds machine-made (stock wording is counted too), your words to avoid, and slips against the book.'));
    s.body.scrollTop = scroll;
    return;
  }
  /* the open chapter first, then the others in the book's order */
  const groups = new Map();
  for (const x of list) { if (!groups.has(x.chapterId)) groups.set(x.chapterId, []); groups.get(x.chapterId).push(x); }
  const order = [...groups.keys()].sort((a, b) => (a === C.chapterId ? -1 : b === C.chapterId ? 1 : novel.order.indexOf(a) - novel.order.indexOf(b)));
  for (const cid of order) {
    const c = store.peek('chapter', cid);
    s.body.append(h('h3.sughead', c ? chapterLabel(novel, c) : 'A chapter'));
    for (const x of groups.get(cid)) s.body.append(card(novelId, x));
  }
  s.body.scrollTop = scroll;
}

/* The benchmark, folded: for each writer its passages graded and their
 * average, its stock wording in every thousand words, and its record head to
 * head; the checks the book fails most; and a judge that is the very model it
 * grades, said so. */
function judgeBox(novelId) {
  const g = checker.gradesOf(novelId);
  const j = checker.judgeOf(store.peek('house', 'house') || {});
  const writers = g.models.filter((m) => m.n || m.words || m.win || m.loss || m.tie);
  if (!g.rows.length && !g.duels && !writers.some((m) => m.words)) return null;
  const avg = g.rows.length ? Math.round((g.rows.reduce((t, r) => t + r.overall, 0) / g.rows.length) * 10) / 10 : null;
  const under = j ? g.rows.filter((r) => r.overall < j.target).length : 0;
  const words = writers.reduce((t, m) => t + m.words, 0);
  const stock = writers.reduce((t, m) => t + m.stock, 0);
  const per = words ? Math.round((stock / words) * 10000) / 10 : 0;
  const head = g.duels > 0;
  const summary = avg !== null
    ? `Graded ${avg} of 10 on average · ${plural(g.rows.length, 'passage')}${j ? ` · ${under} under your ${j.target}` : ''}`
    : `Stock wording: ${per} in every 1,000 words`;
  const box = h('details.judgebox', h('summary', summary),
    h('table.usage-table',
      h('tr', h('th', 'Who wrote it'), h('th', 'Graded'), h('th', 'Average'), h('th', 'Stock per 1,000 words'), head ? h('th', 'Head to head') : null),
      ...writers.map((m) => h('tr',
        h('td', m.model, m.self ? h('small.quiet', ' · judged by itself') : null),
        h('td.num', String(m.n)),
        h('td.num', m.average === null ? '—' : String(m.average)),
        h('td.num', m.per1000 === null ? '—' : String(m.per1000)),
        head ? h('td.num', { title: 'won – lost – even' }, `${m.win}–${m.loss}–${m.tie}`) : null))));
  if (g.fails.length) box.append(h('p.say', h('b', 'Fails most: '), g.fails.slice(0, 4).map((f) => `${f.name} ${f.n}`).join(' · ')));
  if (writers.some((m) => m.self && m.n)) box.append(h('p.say.quiet', 'A judge leans toward its own writing: a checker on another model grades the passages it wrote more fairly (Settings → Who does what).'));
  box.append(h('p.say.quiet', 'Ten checks a passage passes or fails — Opening, True to the book, Shown, Pacing, Specific, Fresh, Sentences, People, Moves, Ending — its grade the number passed. Stock wording is counted, not judged (for scale: classic books of fiction hold about 0.01 in every 1,000 words, machine-made stories 0.1 to 7). Two versions of one passage by two writers are read head to head, blind and both ways round. The mark, and whether it judges: Settings → Who does what.'));
  return box;
}

/* Set aside, folded: each passage its model would not check, why, and Check
 * it again (Cozy Tavern M675-7: never asked for ever, never lost from sight) */
function asideBox(novelId) {
  const list = checker.setAsideList(novelId);
  if (!list.length) return null;
  const novel = store.peek('novel', novelId);
  const box = h('details.judgebox.asidebox', h('summary', `Set aside — ${list.length === 1 ? 'one passage' : plural(list.length, 'passage')} its model would not check`));
  for (const x of list) {
    const c = store.peek('chapter', x.chapterId);
    const go = () => { if (C.sheet) C.sheet.close(); desk.whenOpen(x.chapterId, { passageId: x.passageId, show: {} }); };
    box.append(h('div.sug', { 'data-kind': 'aside' },
      h('div.sugtop', h('span.tag', 'Set aside'), h('button.link', { title: 'Go to this passage.', onclick: go }, `${c && novel ? `${chapterLabel(novel, c, { withName: false })}, passage` : 'Passage'} ${x.number}`)),
      h('div.sugwhy', x.why),
      h('div.btnrow', h('button.btn.small', { title: 'Its model is asked to check this passage again, by itself, now.', onclick: () => {
        toast(checker.checkAgain(novelId, x.chapterId, x.passageId) ? 'Checking it again.' : 'That passage has changed since — it is checked as it reads now.');
      } }, 'Check it again'))));
  }
  box.append(h('p.say.quiet', 'Its model answered other passages but not these, twice, so they were set aside rather than asked for ever. A passage written again, or another checker (Settings → Who does what), is checked afresh by itself.'));
  return box;
}

const phrasesOf = (item) => (item.phrases && item.phrases.length ? item.phrases : item.phrase ? [item.phrase] : []);
/* a sentence with each of some words marked where it stands */
function marked(text, words) {
  const spans = [];
  for (const w of words) for (const s of findIn(text, w)) if (!spans.some((x) => x.start < s.end && s.start < x.end)) spans.push(s);
  spans.sort((a, b) => a.start - b.start);
  const out = [];
  let at = 0;
  for (const s of spans) { out.push(text.slice(at, s.start), h('mark', text.slice(s.start, s.end))); at = s.end; }
  out.push(text.slice(at));
  return out;
}

function card(novelId, x) {
  const { item } = x;
  const el = h('div.sug', { 'data-kind': item.kind });
  const show = () => {
    if (C.sheet) C.sheet.close();
    desk.whenOpen(x.chapterId, { passageId: x.passageId, show: { query: item.find } });
  };
  el.append(h('div.sugtop', h('span.tag', KIND[item.kind] || 'Wording'), h('button.link', { onclick: show }, `Passage ${x.number}`)));
  if (item.kind === 'grade') {
    /* graded under his mark: each check it fails with the words that fail it
     * (a tap goes to them), and what writing it again would need — a grade
     * from before 2.4.3 by its five */
    const gr = item.grade || {};
    el.append(h('div.sugwhat', h('b', `${gr.overall} of ${gr.of || 10} — under your ${item.target}`), gr.faults ? null : h('small.gradeaxes', GRADE_AXES.filter(([k]) => Number.isFinite(gr[k])).map(([k, w]) => `${w} ${gr[k]}`).join(' · '))));
    if (gr.faults && gr.faults.length) {
      el.append(h('ul.faults', ...gr.faults.map((f) => h('li',
        h('b', checker.CHECK_NAME[f.check] || f.check),
        f.words ? [' — ', h('button.link.quote', { title: 'Go to these words in the passage.', onclick: () => {
          if (C.sheet) C.sheet.close();
          desk.whenOpen(x.chapterId, { passageId: x.passageId, show: { query: f.words } });
        } }, `“${f.words}”`)] : null,
        f.why ? ` — ${f.why}` : null,
        /* a "no" whose words are not in the passage: shown, never counted (Cozy Tavern M644) */
        f.unverified ? h('small.notcounted', ' — its words were not found in the passage, so it is not counted') : null))));
    }
    if (item.why) el.append(h('div.sugwhy', item.why));
    if (item.lift) el.append(h('div.sugwhy', h('b', 'To reach it: '), item.lift));
    /* written again by itself, and it failed: said, and never tried by itself again (S11-G6) */
    if (item.liftFailed) el.append(h('div.sugwhy', h('b', 'Written again by itself, it did not come: '), `${item.liftFailed.why}. It is not tried by itself again — the button below still asks for it.`));
    el.append(h('div.btnrow',
      item.lift ? h('button.btn.primary.small', { title: 'The writer writes the passage again with this as its note; the words before stay one arrow away.', onclick: () => {
        if (C.sheet) C.sheet.close();
        checker.leaveOne(x.chapterId, x.passageId, item.id, { remember: false });
        desk.rewritePassage({ chapterId: x.chapterId, passageId: x.passageId, note: item.lift });
      } }, `Write it again toward ${item.target}`) : null,
      h('button.btn.quiet.small', { title: 'Keep the passage as it is — this grade is not offered again.', onclick: () => checker.leaveOne(x.chapterId, x.passageId, item.id) }, 'Leave it')));
    return el;
  }
  if (typeof item.replace === 'string') {
    el.append(h('div.sugwhat', h('del', item.find), ' ', icon('right', 14), ' ', item.replace ? h('ins', item.replace) : h('i', '(taken out)')));
  } else {
    /* words he never wants, marked in their sentence — to be written again */
    el.append(h('div.sugwhat', marked(item.find, phrasesOf(item))));
  }
  if (item.why) el.append(h('div.sugwhy', item.why));
  const btns = h('div.btnrow');
  if (typeof item.replace === 'string') {
    btns.append(h('button.btn.primary.small', { title: 'This change goes in — a new version, the words before one arrow away.', onclick: () => {
      const out = checker.applyOne(novelId, x.chapterId, x.passageId, item.id);
      if (!out.ok) toast(`It couldn’t be applied: ${out.said}.`, 5000);
    } }, 'Apply'));
  } else {
    btns.append(h('button.btn.primary.small', { title: 'The writer writes this sentence again without them — a new version, the words before one arrow away.', onclick: () => {
      const spot = checker.spotOf(x.chapterId, x.passageId, item);
      if (!spot) { toast('Those words are not there any more.'); checker.leaveOne(x.chapterId, x.passageId, item.id, { remember: false }); return; }
      if (C.sheet) C.sheet.close();
      /* his words to avoid, or stock wording counted: the sentence written again without them */
      const note = item.stock ? `Write it again without ${checker.quoted(phrasesOf(item))} — say it the way this book would.` : `Write it again without ${checker.quoted(phrasesOf(item))}.`;
      desk.rewriteSpan({ chapterId: x.chapterId, passageId: x.passageId, start: spot.start, end: spot.end, note });
    } }, 'Write it again'));
  }
  btns.append(h('button.btn.quiet.small', { title: 'Keep the words as they are — this is not offered for the passage again.', onclick: () => checker.leaveOne(x.chapterId, x.passageId, item.id) }, 'Leave it'));
  el.append(btns);
  return el;
}
