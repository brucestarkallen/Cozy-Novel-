/* Cozy Novel — js/ui/checks.js — THE BUBBLE ON THE PAGE and what it holds.
 *
 * Green: every finished passage is checked and nothing needs changing. Blue:
 * the checker is at work (or will be, in a moment). Yellow, with a number:
 * suggestions waiting. Grey: nobody checks (Settings → Who does what). Red:
 * the checker's connection is in trouble. A tap opens Suggestions: each one
 * with what it would change and why — Apply, or Leave it — and Apply all. */

import * as store from '../store.js';
import * as checker from '../novel/checker.js';
import { h, icon, toast, undoToast, openSheet, confirmIt } from './dom.js';
import { putBackWords } from '../novel/inplace.js';
import * as archivist from '../novel/archivist.js';
import { chapterLabel, picked, passageNumbers } from '../novel/shape.js';
import { GRADE_AXES, JUDGE_CHECKS, avoidList } from '../novel/prompts.js';
import { findIn } from '../novel/search.js';
import { plural } from '../util.js';
import * as desk from './desk.js';

let bubble = null;
let hooks = {};
const C = { novelId: null, chapterId: null, offs: [], frame: 0, sheet: null };

const KIND = { grammar: 'Grammar', clarity: 'Clarity', humanize: 'Humanize', avoid: 'Words to avoid', seam: 'Where it joins', continuity: 'Continuity', craft: 'Craft', grade: 'Under your mark' };

export function initChecks(el, appHooks) {
  bubble = el;
  hooks = appHooks;
  bubble.addEventListener('click', () => openSuggestions());
  checker.onChecks((novelId) => { if (novelId === C.novelId) { C.stateDirty = true; drawSoon(); } });
}

/* the book now open: what it holds, watched */
/* What the judge said of one passage's version on show: its ten checks, each passed or failed with the words that
 * fail it (a tap goes to them), a "no" it could not show in the passage said and not counted, what the app counted
 * itself, and what writing it again would need (2.6.5: a passage at or over the mark showed nothing of its grade) */
export function showJudged(novelId, chapterId, passageId) {
  const c = store.peek('chapter', chapterId);
  const p = c && (c.passages || []).find((x) => x.id === passageId);
  const e = p && checker.entryFor(c, p);
  const g = e && e.grade;
  if (!g) { toast('This version is not graded yet.'); return; }
  const judge = checker.judgeOf(store.peek('house', 'house') || {});
  const s = openSheet('What the judge said', { small: true });
  s.box.classList.add('judgesheet');
  const go = (words) => () => { s.close(); desk.whenOpen(chapterId, { passageId, show: { query: words } }); };
  s.body.append(h('p.judgehead', h('b', `Graded ${g.overall} of ${g.of || 10}`), judge ? ` — your mark is ${judge.target}${g.overall < judge.target ? '; this is under it' : ''}` : ''));
  if (!g.of) {
    s.body.append(h('p.say', 'Graded before the ten checks, on another scale: ', GRADE_AXES.filter(([k]) => Number.isFinite(g[k])).map(([k, w]) => `${w} ${g[k]}`).join(' · '), '. Check this chapter grades it on the ten checks.'));
    return;
  }
  const faults = g.faults || [];
  s.body.append(h('ul.judged', ...JUDGE_CHECKS.map(([k, name, what]) => {
    const f = faults.find((x) => x.check === k);
    const row = h('li', { 'data-check': k, 'data-said': !f ? 'yes' : f.unverified ? 'uncounted' : 'no' }, h('b', name), ' — ');
    if (!f) row.append('passed');
    else if (f.unverified) row.append(`it said no, but the words it quoted are not in the passage, so it is not counted${f.said ? `: “${f.said}”` : ''}${f.why ? ` — ${f.why}` : ''}`);
    else row.append(f.counted ? 'failed (counted by the app): ' : 'failed: ', h('button.link.quote', { title: 'Go to these words in the passage.', onclick: go(f.words) }, `“${f.words}”`), f.why ? ` — ${f.why}` : '');
    row.append(h('small', what));
    return row;
  })));
  if (g.lift) s.body.append(h('p.say', h('b', 'What would lift it: '), g.lift));
  s.body.append(h('p.say.quiet', 'A judge reads generously: a published page fails one or two of these, a machine-made one most. A "no" counts only with the words in the passage that fail it.'));
}

export function showChecks(novelId, chapterId) {
  if (C.novelId !== novelId) {
    for (const off of C.offs) off();
    C.offs = [];
    C.novelId = novelId;
    C.inputs = null;
    C.watched = new Set();
    if (novelId) {
      C.offs.push(store.subscribe('novel', novelId, () => { watchChapters(); drawSoon(); }));
      C.offs.push(store.subscribe('house', 'house', () => drawSoon()));
    }
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

/* These are the things the review displays, not the whole book. Notes,
 * summaries, thinking and saved requests can grow without changing one
 * suggestion. Keep manuscript strings by reference rather than copying or
 * hashing the book on every save. Only the small selected check records
 * and head-to-head results need a snapshot for edits made in place. */
function reviewInputs() {
  const n = store.peek('novel', C.novelId);
  const hs = store.peek('house', 'house') || {};
  const conn = checker.checkerConn(hs);
  const out = [C.novelId, C.chapterId, n?.meta?.title, hs.checksFrom,
    conn?.id, conn?.model, JSON.stringify(checker.judgeOf(hs)), JSON.stringify(avoidList(hs)),
    JSON.stringify(checker.autoOf(hs))];
  for (const id of n?.order || []) {
    const c = store.peek('chapter', id);
    const duels = Object.values(c?.duels || {});
    out.push(id, c?.name, c?.checkAll, JSON.stringify(c?.duels || null));
    for (const p of c?.passages || []) {
      const v = picked(p);
      const entry = c.checks?.[p.id]?.[v?.id];
      out.push(p.id, p.by, p.pick, JSON.stringify(entry || null));
      for (const version of p.versions || []) {
        /* A stream has no finished grade yet. If Go on is extending a
         * checked version, the first added words still invalidate its old
         * finding; subsequent token checkpoints need no further redraw. */
        const checkedStream = version.streaming && c.checks?.[p.id]?.[version.id];
        const words = version.streaming ? (checkedStream ? checker.sigOf(version) === checkedStream.sig : '') : version.text;
        out.push(version.id, words, Boolean(version.streaming), version.model,
          version.how, version.rootHow, version.at, version.done, version.rootAt,
          version.cut, version.carried, version.ask?.direction, version.ask?.note,
          JSON.stringify(version.liftFailed || null));
        if (version.streaming) for (const duel of duels) {
          if (duel.pid !== p.id) continue;
          for (const side of ['x', 'y']) if (duel[side] === version.id && duel[`${side}Sig`]) out.push(checker.sigOf(version) === duel[`${side}Sig`]);
        }
      }
    }
  }
  return out;
}
const sameInputs = (a, b) => a && a.length === b.length && a.every((value, i) => value === b[i]);

function draw() {
  if (!bubble || !C.novelId) return;
  const inputs = reviewInputs();
  const changed = !sameInputs(C.inputs, inputs);
  if (!changed && !C.stateDirty) return;
  C.inputs = inputs;
  C.stateDirty = false;
  const st = checker.stateOf(C.novelId);
  const face = `${st.state}:${st.state === 'found' ? Math.min(st.count, 100) : ''}`;
  if (C.face !== face) {
    C.face = face;
    bubble.dataset.state = st.state;
    bubble.textContent = '';
    if (st.state === 'found') bubble.append(h('b', st.count > 99 ? '99+' : String(st.count)));
    else if (st.state === 'clean') bubble.append(icon('check', 20));
    else if (st.state === 'trouble') bubble.append(h('b', '!'));
    else if (st.state === 'off') bubble.append(h('b', '–'));
    else bubble.append(h('span.ring'));
  }
  const say = st.state === 'found' ? `Suggestions: ${plural(st.count, 'suggestion')}` : `Suggestions — ${st.words}`;
  if (bubble.getAttribute('aria-label') !== say) bubble.setAttribute('aria-label', say);
  if (bubble.title !== say) bubble.title = say;
  const state = JSON.stringify([st, Boolean(checker.stalled(C.novelId))]);
  if (C.sheet && (changed || C.sheetState !== state)) drawSheet(st);
  C.sheetState = state;
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

function drawSheet(st = checker.stateOf(C.novelId)) {
  const s = C.sheet;
  if (!s) return;
  const novelId = C.novelId;
  const novel = store.peek('novel', novelId);
  if (!novel) return;
  const scroll = s.body.scrollTop;
  const folds = new Map([...s.body.querySelectorAll('details[data-fold]')].map((d) => [d.dataset.fold, d.open]));
  const active = s.body.contains(document.activeElement) ? document.activeElement : null;
  const activeCard = active && active.closest('.sug');
  const focus = active ? { words: active.textContent, card: activeCard && activeCard.dataset.key,
    index: activeCard ? [...s.body.querySelectorAll('.sug')].indexOf(activeCard) : -1,
    fold: active.tagName === 'SUMMARY' ? active.parentElement.dataset.fold : null } : null;
  const restore = () => {
    for (const d of s.body.querySelectorAll('details[data-fold]')) if (folds.has(d.dataset.fold)) d.open = folds.get(d.dataset.fold);
    if (focus) {
      const cards = [...s.body.querySelectorAll('.sug')];
      const scope = focus.card ? cards.find((c) => c.dataset.key === focus.card) || cards[Math.min(focus.index, cards.length - 1)] : s.body;
      const target = focus.fold ? [...s.body.querySelectorAll('details[data-fold]')].find((d) => d.dataset.fold === focus.fold)?.querySelector('summary')
        : scope && ([...scope.querySelectorAll('button')].find((b) => b.textContent === focus.words) || (focus.card && scope.querySelector('button')));
      (target || s.box.querySelector('.head button'))?.focus({ preventScroll: true });
    }
    s.body.scrollTop = scroll;
  };
  s.body.textContent = '';
  s.body.append(h('div.check-intro',
    h('p.eyebrow', novel.meta?.title || 'YOUR BOOK'),
    h('h3', 'A little polish for your pages.'),
    h('p', 'Keep what feels right. A change goes in on the page itself — its Undo, or ⋯ → Put back the words before on the passage, takes it back out.')));
  s.body.append(h('div.sugstate', { 'data-state': st.state, role: 'status' }, h('span.dot', { 'aria-hidden': 'true' }), h('span', st.words)));
  const list = checker.suggestions(novelId);
  const row = h('div.btnrow.check-actions');
  /* Apply all puts in every change that has its words (a sentence to write again is his to ask for) */
  const can = list.filter((x) => typeof x.item.replace === 'string').length;
  if (can > 1) row.append(h('button.btn.primary.small', { title: 'Every change below that has its words goes in on the page itself — ⋯ → Put back the words before, on a passage, takes them back out.', onclick: () => {
    const n = checker.applyAll(novelId);
    toast(n ? `${plural(n, 'change')} put in on the page — ⋯ → Put back the words before, on a passage, takes them out.` : 'Nothing could be applied — the words had changed.');
  } }, `Apply all (${can})`));
  /* the older writing, checked only when he asks */
  const here = checker.unchecked(novelId, C.chapterId);
  const all = checker.unchecked(novelId);
  const busyNow = st.state === 'checking' || st.state === 'waiting';
  /* waiting out a failure, or stopped: tried again now, by his hand */
  if (checker.stalled(novelId)) row.append(h('button.btn.primary.small', { title: 'The checker tries again at once — even after its connection was turned away. It stops again only if the trouble is still there.', onclick: () => { if (checker.tryNow(novelId)) toast('The checker tries again now.'); } }, 'Try again now'));
  /* (and the passages checked but never graded, with the judge on: graded — their suggestions kept as they are) */
  const hereN = here.passages + here.ungraded;
  const allN = all.passages + all.ungraded;
  if (hereN && !busyNow && st.state !== 'off') row.append(h('button.btn.small', { title: 'The checker reads this chapter’s older passages too, and grades any checked but not graded yet.', onclick: () => { checker.checkChapter(novelId, C.chapterId); toast('Checking this chapter.'); } }, 'Check this chapter'));
  if (allN > hereN && !busyNow && st.state !== 'off') row.append(h('button.btn.small.quiet', { title: 'The checker reads every passage of the book not checked yet, and grades any not graded yet, a chapter at a time.', onclick: async () => {
    const said = [all.passages ? `${plural(all.passages, 'passage')} that haven’t been checked — about ${all.words.toLocaleString()} words —` : '', all.ungraded ? `${all.passages ? 'and ' : ''}${plural(all.ungraded, 'passage')} checked but not graded` : ''].filter(Boolean).join(' ');
    if (!(await confirmIt('Check the whole book?', `${said} go to the checker, a chapter at a time.`, 'Check the whole book'))) return;
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
    if (st.state === 'clean' && !allN) s.body.append(h('div.check-empty', icon('feather', 30), h('h3', 'Room to keep writing.'), h('p.say', 'New passages are checked when they’re finished. Any suggestions will be waiting here.')));
    restore();
    return;
  }
  /* the open chapter first, then the others in the book's order */
  const groups = new Map();
  for (const x of list) { if (!groups.has(x.chapterId)) groups.set(x.chapterId, []); groups.get(x.chapterId).push(x); }
  const order = [...groups.keys()].sort((a, b) => (a === C.chapterId ? -1 : b === C.chapterId ? 1 : novel.order.indexOf(a) - novel.order.indexOf(b)));
  for (const cid of order) {
    const c = store.peek('chapter', cid);
    s.body.append(h('h3.sughead', h('span', c ? chapterLabel(novel, c) : 'A chapter'), h('small', plural(groups.get(cid).length, 'suggestion'))));
    for (const x of groups.get(cid)) s.body.append(card(novelId, x));
  }
  restore();
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
  const box = h('details.judgebox', { 'data-fold': 'grades' }, h('summary', summary),
    h('div.check-table', { tabindex: 0, role: 'region', 'aria-label': 'Grades by writer' }, h('table.usage-table',
      h('tr', h('th', 'Who wrote it'), h('th', 'Graded'), h('th', 'Average'), h('th', 'Stock per 1,000 words'), head ? h('th', 'Head to head') : null),
      ...writers.map((m) => h('tr',
        h('td', m.mixed ? 'Mixed — your words or your partner’s in it, carried on by another writer, or brought in' : m.model, m.self ? h('small.quiet', ' · judged by itself') : null),
        h('td.num', String(m.n)),
        h('td.num', m.average === null ? '—' : String(m.average)),
        h('td.num', m.per1000 === null ? '—' : String(m.per1000)),
        head ? h('td.num', { title: 'won – lost – even' }, `${m.win}–${m.loss}–${m.tie}`) : null)))));
  if (g.fails.length) box.append(h('p.say', h('b', 'Fails most: '), g.fails.slice(0, 4).map((f) => `${f.name} ${f.n}`).join(' · ')));
  /* why each grade is what it is (his ask, 2.12.2: "add reasoning why it gives 9"): a point for each of the ten
   * checks passed — the ones it failed, with the words that fail them and why; a tap opens all ten */
  if (g.rows.length) box.append(gradesWhy(novelId, g.rows));
  if (writers.some((m) => m.self && m.n)) box.append(h('p.say.quiet', 'A judge leans toward its own writing: a checker on another model grades the passages it wrote more fairly (Settings → Who does what).'));
  box.append(h('p.say.quiet', 'Ten checks a passage passes or fails — Opening, True to the book, Shown, Pacing, Specific, Fresh, Sentences, People, Moves, Ending — its grade the number passed. Stock wording is counted, not judged (for scale: classic books of fiction hold about 0.01 in every 1,000 words, machine-made stories 0.1 to 7). Two versions of one passage by two writers are read head to head, blind and both ways round. The mark, and whether it judges: Settings → Who does what.'));
  return box;
}

function gradesWhy(novelId, rows) {
  const novel = store.peek('novel', novelId);
  const order = (novel && novel.order) || [];
  const where = new Map();
  for (const id of order) {
    const c = store.peek('chapter', id);
    if (!c) continue;
    const nums = passageNumbers(c);
    (c.passages || []).forEach((p, k) => where.set(p.id, { c, n: nums.get(p.id), k, ci: order.indexOf(id) }));
  }
  const list = rows.filter((r) => where.has(r.passageId)).sort((a, b) => (where.get(a.passageId).ci - where.get(b.passageId).ci) || (where.get(a.passageId).k - where.get(b.passageId).k));
  const name = (k) => (JUDGE_CHECKS.find(([x]) => x === k) || [k, k])[1];
  return h('div.gradewhy',
    h('p.say', h('b', 'Why each grade: '), 'each of the ten checks a passage passes is a point, so a 9 is nine passed and one failed — the one named, with the words that fail it. For scale, the judge is told that judged this way a page from a published novelist fails one or two of the ten, and a page that reads machine-made fails most.'),
    h('ul.gradelist', ...list.map((r) => {
      const at = where.get(r.passageId);
      const failed = (r.faults || []).filter((f) => !f.unverified);
      const uncounted = (r.faults || []).filter((f) => f.unverified).length;
      return h('li',
        h('button.link', { title: 'All ten checks of this passage, each passed or failed.', onclick: () => showJudged(novelId, at.c.id, r.passageId) }, `${chapterLabel(novel, at.c, { withName: false })}, passage ${at.n}`),
        ` — ${r.overall} of ${r.of || 10}: `,
        failed.length ? failed.map((f, i) => [i ? '; ' : '', h('b', name(f.check)), ' failed', f.words ? ` — “${f.words}”` : '', f.why ? ` — ${f.why}` : '']) : 'passed all ten',
        uncounted ? h('small.quiet', ` (${uncounted === 1 ? 'one more no' : `${uncounted} more noes`} quoted words not in the passage, so not counted)`) : null);
    })));
}

/* Set aside, folded: each passage its model would not check, why, and Check
 * it again (Cozy Tavern M675-7: never asked for ever, never lost from sight) */
function asideBox(novelId) {
  const list = checker.setAsideList(novelId);
  if (!list.length) return null;
  const novel = store.peek('novel', novelId);
  const box = h('details.judgebox.asidebox', { 'data-fold': 'aside' }, h('summary', `Set aside — ${list.length === 1 ? 'one passage' : plural(list.length, 'passage')} its model would not check`));
  for (const x of list) {
    const c = store.peek('chapter', x.chapterId);
    const go = () => { if (C.sheet) C.sheet.close(); desk.whenOpen(x.chapterId, { passageId: x.passageId, show: {} }); };
    box.append(h('div.sug', { 'data-kind': 'aside', 'data-key': `aside:${x.chapterId}:${x.passageId}` },
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
  const el = h('div.sug', { 'data-kind': item.kind, 'data-key': `${x.chapterId}:${x.passageId}:${item.id}` });
  const show = () => {
    if (C.sheet) C.sheet.close();
    desk.whenOpen(x.chapterId, { passageId: x.passageId, show: { query: item.find } });
  };
  el.append(h('div.sugtop', h('span.tag', KIND[item.kind] || 'Wording'), h('button.link', { title: 'Go to these words in the passage.', onclick: show }, `Passage ${x.number}`)));
  if (item.kind === 'grade') {
    /* graded under his mark: each check it fails with the words that fail it
     * (a tap goes to them), and what writing it again would need — a grade
     * from before 2.4.3 by its five */
    const gr = item.grade || {};
    el.append(h('div.sugwhat.grade-score', h('b', `${gr.overall} of ${gr.of || 10} — under your ${item.target}`), gr.faults ? null : h('small.gradeaxes', GRADE_AXES.filter(([k]) => Number.isFinite(gr[k])).map(([k, w]) => `${w} ${gr[k]}`).join(' · '))));
    if (gr.faults && gr.faults.length) {
      el.append(h('ul.faults', ...gr.faults.map((f) => h('li',
        h('b', checker.CHECK_NAME[f.check] || f.check),
        f.words ? [' — ', h('button.link.quote', { title: 'Go to these words in the passage.', onclick: () => {
          if (C.sheet) C.sheet.close();
          desk.whenOpen(x.chapterId, { passageId: x.passageId, show: { query: f.words } });
        } }, `“${f.words}”`)] : null,
        f.why ? ` — ${f.why}` : null,
        /* a "no" whose words are not in the passage: shown, never counted (Cozy Tavern M644) */
        f.unverified ? h('small.notcounted', ` — its words were not found in the passage, so it is not counted${f.said ? ` (it quoted “${f.said}”)` : ''}`) : null))));
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
    el.append(h('div.sugwhat.word-comparison',
      h('div.word-before', h('small.word-label', 'Original'), h('del', item.find)),
      h('div.word-after', h('small.word-label', 'Suggested'), item.replace ? h('ins', item.replace) : h('i', '(taken out)'))));
  } else {
    /* words he never wants, marked in their sentence — to be written again */
    el.append(h('div.sugwhat.word-passage', h('small.word-label', 'In your passage'), marked(item.find, phrasesOf(item))));
  }
  if (item.why) el.append(h('div.sugwhy', item.why));
  /* with the fixes going in by themselves: why this one waits for him (his report, 2.12.2) */
  const waits = checker.waitsWhy(x.chapterId, x.passageId, item);
  if (waits) el.append(h('div.sugwhy.sugwaits', h('b', 'Not put in by itself: '), `${waits}.`));
  const btns = h('div.btnrow');
  if (typeof item.replace === 'string') {
    btns.append(h('button.btn.primary.small', { title: 'This change goes in on the page itself — Undo takes it back out.', onclick: () => {
      const out = checker.applyOne(novelId, x.chapterId, x.passageId, item.id);
      if (!out.ok) { toast(`It couldn’t be applied: ${out.said}.`, 5000); return; }
      undoToast('Put in on the page.', () => {
        const back = putBackWords({ novelId, chapterId: x.chapterId, passageId: x.passageId, versionId: out.versionId, expect: out.after, before: out.before });
        if (back.ok) archivist.nudge(novelId);
        else toast(`It couldn’t be taken back out: ${back.said}.`, 5000);
      });
    } }, 'Apply'));
  } else {
    btns.append(h('button.btn.primary.small', { title: 'The writer writes this sentence again without them, on the page itself — ⋯ → Put back the words before takes it back out.', onclick: () => {
      const spot = checker.spotOf(x.chapterId, x.passageId, item);
      if (!spot) { toast('Those words are not there any more.'); checker.leaveOne(x.chapterId, x.passageId, item.id, { remember: false }); return; }
      if (C.sheet) C.sheet.close();
      /* his words to avoid, or stock wording counted: the sentence written again without them */
      const note = checker.spanNote(item);
      desk.rewriteSpan({ chapterId: x.chapterId, passageId: x.passageId, start: spot.start, end: spot.end, note });
    } }, 'Write it again'));
  }
  btns.append(h('button.btn.quiet.small', { title: 'Keep the words as they are — this is not offered for the passage again.', onclick: () => checker.leaveOne(x.chapterId, x.passageId, item.id) }, 'Leave it'));
  el.append(btns);
  return el;
}
