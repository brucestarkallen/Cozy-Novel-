/* Source-grounded notes history. Pure behavior; no model or paid calls. */
import assert from 'node:assert/strict';
import { continuityOf, continuityStep, mergeContinuity, timelineOf } from '../js/novel/timeline.js';
import { newNovel, newChapter, newPassage, newVersion, newCard, chapterSteps, picked } from '../js/novel/shape.js';

let passed = 0;
function test(name, work) { work(); passed++; console.log('ok   ' + name); }
function book() {
  const { novel, chapter } = newNovel({ title: 'The disputed letter' });
  novel.notes.people = [newCard('people', { id: 'mara', name: 'Mara', aka: ['The keeper'], about: 'Jealous and proud.' }), newCard('people', { id: 'tom', name: 'Tom' })];
  novel.notes.threads = [newCard('threads', { id: 'letter', name: 'The letter' })];
  chapter.passages.push(newPassage('you', 'Mara distrusted Tom after he hid the letter.'));
  const p = chapter.passages[0], v = picked(p);
  return { novel, chapter, chapters: { [chapter.id]: chapter }, p, v };
}
function row(extra = {}) {
  return { kind: 'relationship', cards: [{ kind: 'people', name: 'Mara' }, { kind: 'people', name: 'Tom' }], text: 'Mara distrusts Tom more.', why: 'He hid the letter.', evidence: ['Mara distrusted Tom after he hid the letter.'], stance: 'fact', ...extra };
}
function keep(b, rows = [row()]) {
  continuityStep(b.p.id, b.v.id, continuityOf(rows, b.novel.notes, { text: b.v.text }))(b.chapter);
  return timelineOf(b.novel, b.chapters);
}

test('a relationship keeps its cause, exact source and neutral direction', () => {
  const b = book(), out = keep(b), e = out.events[0];
  assert.equal(e.text, 'Mara distrusts Tom more.'); assert.equal(e.why, 'He hid the letter.');
  assert.deepEqual(e.cards, ['mara', 'tom']); assert.deepEqual(e.evidence, [b.v.text]);
  assert.equal(e.chapterId, b.chapter.id); assert.equal(e.passageId, b.p.id); assert.equal(e.versionId, b.v.id);
  assert.deepEqual(out.coverage, { total: 1, read: 1, missing: 0, passed: 0, complete: true });
  assert.equal(b.novel.notes.people[0].about, 'Jealous and proud.');
});
test('invented quotes and quotes belonging only to a different part leave a gap', () => {
  const b = book();
  let c = continuityOf([row(), row({ evidence: ['Mara forgave Tom.'] })], b.novel.notes, { text: b.v.text });
  assert.equal(c.events.length, 1); assert.equal(c.complete, false);
  c = continuityOf([row()], b.novel.notes, { text: 'The next part of the same passage.', whole: b.v.text + ' The next part of the same passage.' });
  assert.equal(c.events.length, 0); assert.equal(c.complete, false);
});
test('an empty list means covered; missing and malformed lists mean missing history', () => {
  for (const rows of [undefined, null, {}, 'none', [null]]) {
    const b = book();
    continuityStep(b.p.id, b.v.id, continuityOf(rows, b.novel.notes, { text: b.v.text }))(b.chapter);
    assert.equal(timelineOf(b.novel, b.chapters).coverage.complete, false);
  }
  assert.equal(keep(book(), []).coverage.complete, true);
  const b = book(); assert.equal(timelineOf(b.novel, b.chapters).coverage.missing, 1);
});
test('beliefs, claims and intentions keep whose they are instead of becoming facts', () => {
  const b = book();
  for (const stance of ['belief', 'claim', 'intention']) {
    const c = continuityOf([row({ stance, whose: 'Mara' })], b.novel.notes, { text: b.v.text });
    assert.equal(c.events[0].stance, stance); assert.equal(c.events[0].whose.id, 'mara');
    assert.equal(continuityOf([row({ stance })], b.novel.notes, { text: b.v.text }).complete, false);
    assert.equal(continuityOf([row({ stance, whose: 'Someone invented' })], b.novel.notes, { text: b.v.text }).events.length, 0);
  }
});
test('card names and aliases resolve without inventing or guessing an ambiguous person', () => {
  const b = book();
  assert.deepEqual(keep(b, [row({ cards: [{ kind: 'people', name: 'The keeper' }, { kind: 'people', name: 'Tom' }] })]).events[0].cards, ['mara', 'tom']);
  b.novel.notes.people.push(newCard('people', { name: 'Another keeper', aka: ['The keeper'] }));
  assert.equal(continuityOf([row({ cards: [{ kind: 'people', name: 'The keeper' }, { kind: 'people', name: 'Tom' }] })], b.novel.notes, { text: b.v.text }).events.length, 0);
  assert.equal(continuityOf([row({ cards: [{ kind: 'people', name: 'Mara' }, { kind: 'people', name: 'Nobody' }] })], b.novel.notes, { text: b.v.text }).events.length, 0);
});
test('character and thread events require the right existing cards', () => {
  const b = book();
  const character = row({ kind: 'character', cards: [{ kind: 'people', name: 'Mara' }] });
  const thread = row({ kind: 'thread', cards: [{ kind: 'threads', name: 'The letter' }] });
  assert.equal(keep(b, [character, thread]).events.length, 2);
  assert.equal(keep(b, [row({ kind: 'thread' })]).coverage.complete, false);
});
test('versions, changed words, removed passages and restoring them choose their own evidence', () => {
  const b = book(); keep(b);
  const old = structuredClone(b.p);
  const alternative = newVersion({ text: 'Mara trusted Tom after he returned the letter.' });
  chapterSteps.addVersion(b.p.id, alternative)(b.chapter);
  assert.equal(timelineOf(b.novel, b.chapters).events.length, 0);
  continuityStep(b.p.id, b.v.id, b.v.continuity)(b.chapter);
  assert.equal(picked(b.p).continuity, undefined, 'a stale reply cannot attach to the selected take');
  chapterSteps.pick(b.p.id, b.v.id)(b.chapter);
  assert.equal(timelineOf(b.novel, b.chapters).events.length, 1);
  b.v.text += ' She changed her mind.';
  assert.equal(timelineOf(b.novel, b.chapters).events.length, 0, 'Go on invalidates the former fingerprint');
  b.chapter.passages = [];
  assert.equal(timelineOf(b.novel, b.chapters).events.length, 0);
  b.chapter.passages = [old];
  assert.equal(timelineOf(b.novel, b.chapters).events.length, 1);
});
test('move and reorder follow book order, independently of reading timestamps and pruned checkpoints', () => {
  const b = book(); keep(b);
  const second = newChapter(b.novel.id); b.chapters[second.id] = second; b.novel.order.push(second.id);
  second.passages = b.chapter.passages; b.chapter.passages = [];
  b.novel.memory.readings = {};
  const e = timelineOf(b.novel, b.chapters).events[0];
  assert.equal(e.chapterId, second.id); assert.equal(e.chapterNumber, 2);
  b.novel.order.reverse(); assert.equal(timelineOf(b.novel, b.chapters).events[0].chapterNumber, 1);
});
test('up-to-here never includes future events, including invalid or empty boundaries', () => {
  const b = book(); keep(b);
  const second = newChapter(b.novel.id); b.chapters[second.id] = second; b.novel.order.push(second.id);
  second.passages.push(newPassage('you', 'Mara forgave Tom.'));
  const later = second.passages[0], lv = picked(later);
  continuityStep(later.id, lv.id, continuityOf([row({ text: 'Mara forgives Tom.', evidence: [lv.text] })], b.novel.notes, { text: lv.text }))(second);
  assert.equal(timelineOf(b.novel, b.chapters).events.length, 2);
  assert.equal(timelineOf(b.novel, b.chapters, { chapterId: b.chapter.id, through: b.p.id }).events.length, 1);
  assert.equal(timelineOf(b.novel, b.chapters, { chapterId: second.id, through: '^' }).events.length, 1);
  for (const options of [{ chapterId: 'absent' }, { chapterId: b.chapter.id, through: 'absent' }, { through: b.p.id }, { chapterId: b.chapter.id, through: '^' }]) assert.equal(timelineOf(b.novel, b.chapters, options).events.length, 0);
});
test('manual card corrections change the card, not the historical source; aliases survive folding', () => {
  const b = book(); keep(b);
  b.novel.notes.people[0].about = 'My exact new account.'; b.novel.notes.people[0].ties = 'My present relationship.';
  assert.equal(timelineOf(b.novel, b.chapters).events[0].text, 'Mara distrusts Tom more.');
  b.novel.notes.people[0] = newCard('people', { id: 'merged', name: 'Mara Venn', aka: ['Mara'] });
  assert.deepEqual(timelineOf(b.novel, b.chapters).events[0].cards, ['merged', 'tom']);
  b.novel.notes.people = b.novel.notes.people.filter(c => c.id !== 'merged');
  assert.equal(timelineOf(b.novel, b.chapters).events[0].participants[0].missing, true);
  assert.equal(b.novel.notes.people.length, 1, 'history never recreates a removed card');
});
test('partial readings combine exact evidence once and retain a missing part as missing', () => {
  const b = book(), a = continuityOf([row()], b.novel.notes, { text: b.v.text });
  assert.equal(mergeContinuity(a, a).events.length, 1);
  const missing = continuityOf(undefined, b.novel.notes, { text: b.v.text });
  assert.equal(mergeContinuity(missing, a).complete, false);
  keep(b); continuityStep(b.p.id, b.v.id, missing)(b.chapter);
  assert.equal(timelineOf(b.novel, b.chapters).events.length, 1, 'an unsupported answer does not discard sound evidence');
  assert.equal(timelineOf(b.novel, b.chapters).coverage.complete, false);
});
test('filters do not misreport source coverage and unreadable chapters prevent a complete claim', () => {
  const b = book(); keep(b);
  assert.equal(timelineOf(b.novel, b.chapters, { cardId: 'tom' }).events.length, 1);
  assert.equal(timelineOf(b.novel, b.chapters, { kind: 'thread' }).events.length, 0);
  assert.equal(timelineOf(b.novel, b.chapters, { kind: 'thread' }).coverage.read, 1);
  b.novel.order.push('not-loaded');
  assert.equal(timelineOf(b.novel, b.chapters).coverage.complete, false);
});
test('malformed restored evidence never invents attribution or a valid relationship', () => {
  for (const bad of [e => { e.refs = [null]; }, e => { e.refs.length = 1; }, e => { e.stance = 'belief'; delete e.whose; }, e => { e.id = ''; }, e => { e.evidence = ['Words never in this passage.']; }]) {
    const b = book(); keep(b); bad(b.v.continuity.events[0]);
    const out = timelineOf(b.novel, b.chapters);
    assert.equal(out.events.length, 0); assert.equal(out.coverage.complete, false);
  }
});
console.log(`\ntimeline: ${passed} passed`);
