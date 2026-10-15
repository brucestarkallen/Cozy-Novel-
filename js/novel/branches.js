/* A story branch is a separate book. Pure: no saves, calls or screen.
 * The shared past is copied; nothing in the book it came from is changed.
 * A chapter alone cannot own a different future: notes belong to the book. */
import { newId } from '../util.js';
import { NOTE_KINDS, CARD_FIELDS, hisCard, hisField, keptFor, countBook } from './shape.js';
import { notesAtPoint, readingOf } from './readings.js';

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const fail = (message) => { throw new Error(message); };

/* Only addresses change. A passage, request, note or draft may literally
 * contain an old id; those are his words, never an address to replace.
 * Also used when adding books from a whole-library copy. */
export function remapBranchData(value, ids) {
  const map = ids instanceof Map ? ids : new Map(Object.entries(ids || {}));
  const fields = new Set(['id', 'novelId', 'chapterId', 'playId', 'play', 'nowAt', 'rootId', 'fromId', 'sourceId']);
  const keyOf = (key) => map.get(key) || key.split(':').map((part) => map.get(part) || part).join(':');
  const walk = (item, field = '', parent = '') => {
    if (Array.isArray(item)) return item.map((part) => typeof part === 'string' && ['order', 'plays', 'chapterIds'].includes(field) ? map.get(part) || part : walk(part, '', field));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, part]) => [keyOf(key), walk(part, key, field)]));
    return typeof item === 'string' && (fields.has(field) || (parent === 'prefs' && field === 'at')) ? map.get(item) || item : item;
  };
  return walk(value);
}

const ownName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Another way';
const turnAt = (turns, id, label) => {
  const index = (turns || []).findIndex((turn) => turn.id === id);
  if (index < 0) fail(`that ${label} is not there any more`);
  return index;
};

function copiedTurns(turns) {
  return (turns || []).map((turn) => ({ ...clone(turn), versions: (turn.versions || []).map((version) => {
    const out = clone(version);
    delete out.streaming; delete out.beat; delete out.tab; delete out.browser;
    if (Array.isArray(out.changes)) out.changes = out.changes.map((change) => ({ ...change, copied: true }));
    return out;
  }) }));
}

/* A card can be his in just one field while the helper writes the rest.
 * Keeping its present generated whereabouts would carry the other future
 * into this branch. Legacy cards marked wholly his keep his whole fields.
 * Since then is the helper's later account, not the card's own words. */
function authoredNotes(source, chapters) {
  const names = new Map();
  const retained = new Set(Object.values(chapters).flatMap((c) => (c.passages || []).map((p) => p.id)));
  const readings = Object.entries(source.memory?.readings || {}).filter(([pid]) => retained.has(pid))
    .flatMap(([, versions]) => Object.values(versions || {})).filter((r) => r.mode === 'new' && (r.covers || []).every((pid) => retained.has(pid)))
    .sort((a, b) => (a.at || 0) - (b.at || 0));
  for (const reading of readings) for (const card of reading.cards || []) if (card.after?.name && !names.has(card.id)) names.set(card.id, card.after.name);
  const labels = { people: 'A person', places: 'A place', lore: 'A note', threads: 'A thread' };
  return Object.fromEntries(NOTE_KINDS.map((kind) => [kind, ((source.notes || {})[kind] || []).filter(hisCard).map((card, index) => {
    const name = hisField(card, 'name') ? card.name : names.get(card.id) || `${labels[kind]} in your notes${index ? ` ${index + 1}` : ''}`;
    const out = { id: card.id, name, updated: clone(card.updated) };
    for (const field of CARD_FIELDS) if (hisField(card, field) && card[field] !== undefined) out[field] = clone(card[field]);
    return out;
  })]));
}

/* A legacy/imported note may have no reading markers at all. "Nothing
 * later is marked read" is not proof that such a note belongs to the past.
 * Trust generated cards only when a current reading records them exactly;
 * pruned or untracked history is rebuilt from the branch's own pages. */
function trackedNotes(source) {
  const after = new Set();
  for (const seen of Object.values(source.memory?.seen || {})) for (const [pid, sig] of Object.entries(seen || {})) {
    const reading = readingOf(source, pid, sig);
    for (const card of reading?.cards || []) if (card.after) after.add(JSON.stringify(card.after));
  }
  return NOTE_KINDS.every((kind) => (source.notes?.[kind] || []).every((card) => {
    const entirelyHis = hisCard(card) && !card.since && CARD_FIELDS.every((field) => card[field] === undefined || card[field] === '' || (Array.isArray(card[field]) && !card[field].length) || hisField(card, field));
    return entirelyHis || after.has(JSON.stringify(card));
  }));
}

function trimMemory(memory, chapters, also) {
  const retained = new Map();
  for (const chapter of Object.values(chapters)) for (const passage of chapter.passages || []) retained.set(passage.id, new Set((passage.versions || []).map((v) => v.id)));
  const unmarked = new Set(also || []);
  const readings = {};
  for (const [pid, versions] of Object.entries(memory.readings || {})) {
    if (!retained.has(pid) || unmarked.has(pid)) continue;
    for (const [vid, reading] of Object.entries(versions || {})) {
      if (!retained.get(pid).has(vid) || (reading.covers || []).some((id) => !retained.has(id) || unmarked.has(id))) continue;
      (readings[pid] ||= {})[vid] = clone(reading);
    }
  }
  /* A retained passage can point to a combined reading stored on one that
   * was cut off. It becomes unread, rather than silently staying read. */
  for (const [pid, versions] of Object.entries(readings)) for (const [vid, reading] of Object.entries(versions)) {
    if (reading.in && readings[reading.in.pid]?.[reading.in.vid]?.sig !== reading.in.sig) { delete versions[vid]; unmarked.add(pid); }
  }
  const seen = Object.fromEntries(Object.values(chapters).map((chapter) => [chapter.id,
    Object.fromEntries(Object.entries(memory.seen?.[chapter.id] || {}).filter(([pid]) => retained.has(pid) && !unmarked.has(pid)))]));
  const aside = Object.fromEntries(Object.entries(memory.aside || {}).filter(([key]) => {
    if (retained.has(key)) return !unmarked.has(key);
    return key.startsWith('summary:') && Boolean(chapters[key.slice(8)]?.summary);
  }));
  return { seen, readings, aside, removed: [], undo: null, at: 0 };
}

/* bundle is a coherent server snapshot: {records:[{kind,id,rev,data}]}.
 * through is inclusive, '^' means the chapter's beginning. With no point,
 * the whole book is copied. IDs inside a version stay local to its book. */
export function buildBranch(bundle, options = {}) {
  const records = Array.isArray(bundle?.records) ? bundle.records : [];
  const sourceRow = records.find((record) => record.kind === 'novel' && (!options.novelId || record.id === options.novelId));
  if (!sourceRow?.data) fail('that book is not on the shelf any more');
  const source = sourceRow.data;
  const row = (kind, id) => records.find((record) => record.kind === kind && record.id === id)?.data;
  const original = {};
  for (const id of source.order || []) {
    const chapter = row('chapter', id);
    if (!chapter || chapter.novelId !== source.id) fail('a chapter of this book could not be read — try again');
    original[id] = chapter;
  }
  if (!(source.order || []).length) fail('the book has no chapter to branch from');
  const memory = source.memory || {};
  if (memory.inParts || (memory.rereadFrom && memory.undo?.keep)) fail('the helper is still reading this book — let it finish first');
  for (const record of records) {
    const groups = record.kind === 'chapter' ? [record.data.passages || []]
      : ['talk', 'play'].includes(record.kind) ? [record.data.turns || [], ...(record.data.convs || []).map((c) => c.turns || [])] : [];
    if (groups.some((list) => list.some((part) => (part.versions || []).some((v) => v.streaming)))) fail('words are still being written in this book — let them finish or stop them first');
  }
  const at = options.at ?? Date.now();
  const makeId = options.makeId || newId;
  const novelId = makeId('n');
  const name = ownName(options.name);
  let chapterId = options.chapterId || null;
  let through = options.through;
  let chosenPlay = null;
  let point = { kind: 'book' };

  if (options.playId) {
    chosenPlay = row('play', options.playId);
    if (!chosenPlay || chosenPlay.novelId !== source.id || !(source.plays || []).includes(chosenPlay.id)) fail('that scene is not in this book any more');
    if (!options.turnId) fail('choose a telling to branch from');
    turnAt(chosenPlay.turns, options.turnId, 'telling');
    chapterId = chosenPlay.chapterId;
    through = chosenPlay.after;
    /* Older scenes remember only their latest conversion. Go back before
     * their first prose passage: an alternative telling must never inherit
     * the outcome already written from the original scene. */
    let conversion = false;
    for (const id of source.order) {
      const list = original[id].passages || [];
      const index = list.findIndex((p) => (p.versions || []).some((v) => v.ask?.play === chosenPlay.id));
      if (index >= 0) { chapterId = id; through = index ? list[index - 1].id : '^'; conversion = true; break; }
    }
    if (!conversion && chosenPlay.turned) fail('the scene’s earlier place in the book could not be found — branch from a passage instead');
    if (!through) fail('the scene’s starting place changed — branch from a passage instead');
    point = { kind: 'scene', chapterId, through, playId: chosenPlay.id, turnId: options.turnId };
  } else if (options.conversationTurnId || options.conversationId) {
    if (chapterId || through !== undefined) fail('a conversation branch starts with the book as it stands now');
    point = { kind: 'conversation', ...(options.conversationId ? { conversationId: options.conversationId } : {}), ...(options.conversationTurnId ? { conversationTurnId: options.conversationTurnId } : {}) };
  } else if (chapterId || through !== undefined) {
    if (!chapterId) fail('choose the chapter to branch from');
    point = { kind: 'passage', chapterId, ...(through !== undefined ? { through } : {}) };
  }

  const chapterIndex = chapterId ? source.order.indexOf(chapterId) : source.order.length - 1;
  if (chapterIndex < 0) fail('that chapter is not in the book any more');
  const cutChapter = chapterId ? original[chapterId] : original[source.order[chapterIndex]];
  let keepCount = (cutChapter.passages || []).length;
  if (chapterId && through !== undefined) keepCount = through === '^' ? 0 : turnAt(cutChapter.passages, through, 'passage') + 1;
  const early = chapterIndex < source.order.length - 1 || keepCount < (cutChapter.passages || []).length;
  const keptChapterIds = source.order.slice(0, chapterIndex + 1);
  const chapters = Object.fromEntries(keptChapterIds.map((id) => [id, clone(original[id])]));
  const last = chapters[keptChapterIds.at(-1)];
  if (keepCount < last.passages.length) {
    last.passages = last.passages.slice(0, keepCount);
    Object.assign(last, keptFor(last, last.passages.map((p) => p.id)));
    last.summary = null; last.summaries = [];
  }
  const novel = clone(source);
  novel.order = keptChapterIds;
  let notesRebuild = false;
  if (early) {
    const standing = notesAtPoint(source, original, cutChapter.id, { through: keepCount ? cutChapter.passages[keepCount - 1].id : '^' });
    /* planOf preserves his cards whole. If a later reading also touched
     * those cards, its generated fields cannot safely be treated as past. */
    const ownLater = standing.later && NOTE_KINDS.some((kind) => (source.notes?.[kind] || []).some(hisCard));
    if (!standing.clean || ownLater || !trackedNotes(source)) {
      novel.notes = authoredNotes(source, chapters);
      novel.memory = { seen: {}, readings: {}, aside: {}, removed: [], undo: null, at: 0 };
      notesRebuild = true;
    } else {
      novel.notes = clone(standing.notes);
      novel.memory = trimMemory(memory, chapters, standing.also);
      notesRebuild = standing.also.length > 0;
    }
    /* Even a corrected Automatic description describes the complete book.
     * The original keeps it; this branch is read from its retained pages. */
    novel.kept = {};
  }

  let talk = !early && !chosenPlay ? clone(row('talk', source.id)) : null;
  let conversationId;
  let sourceConversationId;
  if (point.kind === 'conversation') {
    if (!talk) fail('that conversation is not there any more');
    const current = !options.conversationId || (talk.convId || null) === options.conversationId || (!talk.convId && options.conversationId === 'current');
    const conversation = current ? { id: talk.convId, name: talk.name, named: talk.named, turns: talk.turns || [] }
      : (talk.convs || []).find((c) => c.id === options.conversationId);
    if (!conversation) fail('that conversation is not there any more');
    sourceConversationId = conversation.id || 'current';
    const turns = conversation.turns || [];
    const end = options.conversationTurnId ? turnAt(turns, options.conversationTurnId, 'answer') + 1 : turns.length;
    talk.turns = turns.slice(0, end); talk.convId = conversation.id || makeId('cv');
    talk.name = conversation.name || 'Conversation';
    if (conversation.named) talk.named = true; else delete talk.named;
    /* The other conversations, and the rest of this one, wait in the
     * original book. This branch starts its own conversation from here. */
    talk.convs = [];
    conversationId = talk.convId;
    point.conversationId = conversation.id || null;
  }
  if (talk) {
    talk.id = source.id; talk.novelId = source.id;
    talk.turns = copiedTurns(talk.turns);
    talk.convs = (talk.convs || []).map((c) => ({ ...c, turns: copiedTurns(c.turns) }));
  }
  const plays = [];
  if (chosenPlay) {
    const play = clone(chosenPlay);
    play.turns = copiedTurns(play.turns.slice(0, turnAt(play.turns, options.turnId, 'telling') + 1));
    play.chapterId = cutChapter.id; play.after = keepCount ? cutChapter.passages[keepCount - 1].id : '^';
    play.turned = null; play.created = at; play.updated = at;
    plays.push(play);
  } else if (!early) {
    for (const id of source.plays || []) {
      const play = row('play', id);
      if (!play || play.novelId !== source.id) fail('a scene in this book could not be read — try again');
      const copy = clone(play); copy.turns = copiedTurns(copy.turns); plays.push(copy);
    }
  }
  novel.plays = plays.map((p) => p.id);
  let draft = !early && !chosenPlay ? clone(row('draft', source.id)) : null;
  if (chosenPlay) {
    const key = 'play:' + chosenPlay.id;
    const saved = row('draft', source.id)?.composers?.[key];
    if (saved) draft = { id: source.id, novelId: source.id, composers: { [key]: clone(saved) } };
  } else if (point.kind === 'conversation' && draft) {
    const key = `talk:${source.id}:${sourceConversationId}`;
    draft.composers = Object.fromEntries(Object.entries(draft.composers || {}).filter(([k]) => !k.startsWith('talk:') || k === key)
      .map(([k, value]) => [k === key ? `talk:${source.id}:${conversationId}` : k, value]));
  }
  if (draft) { draft.id = source.id; draft.novelId = source.id; }
  const map = new Map([[source.id, novelId], ...keptChapterIds.map((id) => [id, makeId('ch')]), ...plays.map((p) => [p.id, makeId('pl')])]);
  const newChapters = Object.fromEntries(Object.values(chapters).map((chapter) => { const c = remapBranchData(chapter, map); return [c.id, c]; }));
  const resultNovel = remapBranchData(novel, map);
  const targetChapterId = map.get(chapterId || (keptChapterIds.includes(source.prefs?.at) ? source.prefs.at : keptChapterIds.at(-1)));
  resultNovel.prefs = { ...(resultNovel.prefs || {}), at: targetChapterId };
  resultNovel.meta = { ...(resultNovel.meta || {}), created: at, opened: at, written: at, archived: false, ...countBook(resultNovel, newChapters) };
  resultNovel.branch = { rootId: source.branch?.rootId || source.id, fromId: source.id, name, at, point };
  const out = Object.values(newChapters).map((data) => ({ kind: 'chapter', id: data.id, data }));
  for (const [kind, data] of [...plays.map((p) => ['play', p]), ...(talk ? [['talk', talk]] : []), ...(draft ? [['draft', draft]] : [])]) {
    const copy = remapBranchData(data, map);
    out.push({ kind, id: copy.id, data: copy });
  }
  out.push({ kind: 'novel', id: novelId, data: resultNovel });
  return { records: out, novelId, chapterId: targetChapterId, ...(chosenPlay ? { playId: map.get(chosenPlay.id) } : {}), ...(conversationId ? { conversationId } : {}), notesRebuild, early };
}
