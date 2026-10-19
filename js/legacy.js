/* Cozy Novel — js/legacy.js — THE FIRST COZY NOVEL'S BOOKS COME ALONG.
 *
 * The first version kept a book in two places: in the browser (its working
 * copy) and on the phone (a copy it tried to keep up). Both are read, once,
 * and moved onto the shelf. The old files are never changed or deleted.
 *
 * When the browser's copy of a book and the phone's differ, the old app's own
 * revision history says which is newer: a scene whose words in one copy grew
 * from the other's is newer there. A newer browser copy replaces a book moved
 * over from the phone (when it has not been touched since); a copy that went
 * its own way comes over as a second book, so no word is ever lost.
 *
 * Its connections come too, with exactly the settings it sent, and the roles
 * it gave them (who writes, who keeps the notes).
 */

import * as store from './store.js';
import { fromLegacy, connectionsFromLegacy, revisionAncestry } from './novel/files.js';
import { hashText } from './util.js';
import { passageText } from './novel/shape.js';

/* the whole old library can be large: it is given time to come */
const SLOW = 180000;

function printOf(novel, chapters) {
  return hashText(novel.order.map((id) => (chapters[id] ? chapters[id].passages.map((p) => passageText(p)).join('\n') : '')).join('\n'));
}

async function readBrowserStore() {
  try {
    if (!globalThis.indexedDB || !indexedDB.databases) return null;
    const list = await indexedDB.databases();
    if (!list.some((d) => d && d.name === 'cozynovel.v1')) return null;
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('cozynovel.v1');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
      req.onupgradeneeded = () => { /* never ours to shape */ };
    });
    try {
      const names = Array.from(db.objectStoreNames);
      if (!names.includes('records') || !names.includes('blobs')) return null;
      const all = (name) => new Promise((resolve, reject) => {
        const req = db.transaction(name, 'readonly').objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      const one = (name, key) => new Promise((resolve) => {
        try {
          const req = db.transaction(name, 'readonly').objectStore(name).get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (_) { resolve(null); }
      });
      /* its connections as this browser knew them, and who did what */
      const library = names.includes('meta') ? await one('meta', 'connectionLibrary') : null;
      return { records: await all('records'), blobs: await all('blobs'), library };
    } finally { db.close(); }
  } catch (_) {
    return null;
  }
}

async function writeBook(b, { id = null, title = null } = {}) {
  const novel = JSON.parse(JSON.stringify(b.novel));
  const chapters = JSON.parse(JSON.stringify(b.chapters));
  let talk = b.talk ? JSON.parse(JSON.stringify(b.talk)) : null;
  let plays = JSON.parse(JSON.stringify(b.plays || []));
  let draft = b.draft ? JSON.parse(JSON.stringify(b.draft)) : null;
  if (id) {
    /* a second copy: everything gets ids of its own, its conversation and scenes too */
    const map = {};
    novel.id = id;
    novel.order = novel.order.map((cid) => { const n = id + '-' + cid.slice(-12); map[cid] = n; return n; });
    for (const [cid, c] of Object.entries(chapters)) { c.id = map[cid]; c.novelId = id; c.passages.forEach((p) => { p.id = p.id + 'b'; }); }
    if (talk) talk = { ...talk, id, novelId: id };
    plays = plays.map((p) => ({ ...p, id: (p.id + '-b').slice(0, 90), novelId: id, chapterId: map[p.chapterId] || novel.order[novel.order.length - 1] }));
    novel.plays = plays.map((p) => p.id);
    if (draft) draft = { ...draft, id, novelId: id };
  }
  if (title) novel.meta.title = title;
  for (const cid of novel.order) {
    const c = chapters[Object.keys(chapters).find((k) => chapters[k].id === cid)] || chapters[cid];
    if (c) await store.create('chapter', c.id, c);
  }
  if (talk && !(await store.open('talk', novel.id))) await store.create('talk', novel.id, talk);
  for (const p of plays) if (!(await store.open('play', p.id))) await store.create('play', p.id, p);
  if (draft && !(await store.open('draft', novel.id))) await store.create('draft', novel.id, draft);
  await store.create('novel', novel.id, novel);
  return novel.id;
}

/* one book from a source: brought over, put in its place, kept beside, or let be */
async function bringBook(b, source, deviceKnown) {
  const existing = await store.open('novel', b.novel.id);
  if (!existing) { await writeBook(b); return 'new'; }
  const theirs = existing.migrated || {};
  if (theirs.print === b.novel.migrated.print) return 'same';
  /* how the copies compare, scene by scene, by the old app's own history */
  let newerHere = false, newerThere = false, apart = false;
  const there = theirs.revisions || {};
  for (const [sid, rev] of Object.entries(b.revisions)) {
    const theirRev = there[sid];
    if (!theirRev) { newerHere = true; continue; }
    if (theirRev === rev) continue;
    if (revisionAncestry(b.byId, rev).includes(theirRev)) newerHere = true;
    else if (deviceKnown && deviceKnown.has(rev)) newerThere = true;
    else apart = true;
  }
  for (const sid of Object.keys(there)) if (!b.revisions[sid]) newerThere = true;
  if (!newerHere && !apart) return 'older';
  const chapters = {};
  for (const id of existing.order || []) { const c = await store.open('chapter', id); if (c) chapters[id] = c; }
  const untouched = theirs.print && printOf(existing, chapters) === theirs.chapterPrint;
  /* (each chapter as it was found untouched: laid only while it still reads so — words written in the moved book
   * meanwhile in another window are never written over by the older copy: 2.12.41, a step laid again over another
   * window's newer copy) */
  const words = (d) => JSON.stringify([d.passages || [], d.name || '', d.nameBy || '']);
  const foundAs = Object.fromEntries(Object.entries(chapters).map(([id, c]) => [id, words(c)]));
  if (newerHere && !newerThere && !apart && untouched) {
    /* the browser's copy is the newer one, and nothing was done to the moved book since */
    for (const id of existing.order || []) if (!b.novel.order.includes(id)) await store.remove('chapter', id).catch(() => {});
    for (const id of b.novel.order) {
      const c = b.chapters[id];
      const found = await store.open('chapter', id);
      const was = foundAs[id] !== undefined ? foundAs[id] : found ? words(found) : '';
      if (found) store.change('chapter', id, (d) => { if (words(d) !== was) return false; d.passages = JSON.parse(JSON.stringify(c.passages)); d.name = c.name; d.nameBy = c.nameBy; return true; }, { now: true });
      else await store.create('chapter', id, c);
    }
    const migratedWas = JSON.stringify(theirs);
    store.change('novel', existing.id, (d) => {
      if (JSON.stringify(d.migrated || {}) !== migratedWas) return false;
      d.order = b.novel.order.slice();
      d.migrated = { ...b.novel.migrated, chapterPrint: printOf(b.novel, b.chapters), revisions: b.revisions };
      d.meta.words = b.novel.meta.words;
      d.meta.chapters = b.novel.meta.chapters;
    }, { now: true });
    return 'replaced';
  }
  const copyId = (b.novel.id + '-' + source).slice(0, 90);
  if (await store.open('novel', copyId)) return 'kept';
  await writeBook(b, { id: copyId, title: `${b.novel.meta.title} (${source === 'browser' ? 'the copy from this browser' : 'another copy'})` });
  return 'copy';
}

/* Old connections onto the house; the roles the old app gave them, where he
 * has not chosen here yet. */
function bringConnections(conns, defaults, why) {
  const idOf = (old) => (old ? 'v1-' + String(old).replace(/[^A-Za-z0-9_-]/g, '').slice(-60) : '');
  store.change('house', 'house', (h) => {
    h.connections = h.connections || [];
    for (const c of conns) if (!h.connections.some((x) => x.id === c.id)) h.connections.push(c);
    h.roles = h.roles || {};
    h.legacy = h.legacy || {};
    const has = (id) => id && h.connections.some((x) => x.id === id);
    const guessed = h.legacy.rolesGuessed === true;
    const writer = idOf(defaults && defaults.writerId);
    const helper = idOf(defaults && defaults.helperId);
    if (has(writer) && (!h.roles.writer || guessed)) h.roles.writer = writer;
    if (has(helper) && (!h.roles.helper || guessed)) h.roles.helper = helper;
    if (!h.roles.writer && conns.length) {
      /* no word from the old app on who writes: its main connection does */
      h.roles.writer = (conns.find((c) => /primary/.test(c.id)) || conns[0]).id;
      h.legacy.rolesGuessed = true;
    } else if (has(writer)) h.legacy.rolesGuessed = false;
    Object.assign(h.legacy, why);
  }, { now: true });
}

/* Run once per source. Returns how many books came over. */
export async function bringOldBooks() {
  let moved = 0;
  let deviceKnown = null;
  const house = store.peek('house', 'house');
  const done = (house && house.legacy) || {};
  /* the phone's old library, and the connections it kept: a quick look first,
   * and read whole only when it is new to this shelf */
  try {
    const peek = await store.api('GET', '/api/legacy?peek=1');
    const stamp = peek.status === 200 && peek.data && peek.data.found ? String(peek.data.stamp || '') : '';
    if (stamp && done.deviceStamp !== stamp) {
      const { status, data } = await store.api('GET', '/api/legacy', { wait: SLOW });
      if (status === 200 && data && data.found) {
        const books = fromLegacy({ records: data.records || [], blobs: data.blobs || [] });
        deviceKnown = new Set((data.records || []).filter((r) => r.type === 'revision').map((r) => r.id));
        for (const b of books) {
          b.novel.migrated.chapterPrint = printOf(b.novel, b.chapters);
          b.novel.migrated.revisions = b.revisions;
          const how = await bringBook(b, 'device', null);
          if (how === 'new' || how === 'replaced' || how === 'copy') moved++;
        }
        bringConnections(connectionsFromLegacy(data.profiles || {}, data.secrets || {}), null, { deviceStamp: stamp });
      } else if (status === 200 && data) {
        bringConnections([], null, { deviceStamp: stamp });
      }
    }
  } catch (e) { console.warn('the old library on the phone could not be read', e); }
  /* this browser's old working copy */
  try {
    let flag = null;
    try { flag = localStorage.getItem('cozynovel.legacy.browser'); } catch (_) { flag = null; }
    const old = flag ? null : await readBrowserStore();
    if (old && old.records.length) {
      const books = fromLegacy(old);
      if (!deviceKnown) {
        const { status, data } = await store.api('GET', '/api/legacy', { wait: SLOW }).catch(() => ({ status: 0 }));
        if (status === 200 && data) deviceKnown = new Set((data.records || []).filter((r) => r.type === 'revision').map((r) => r.id));
      }
      for (const b of books) {
        b.novel.migrated.chapterPrint = printOf(b.novel, b.chapters);
        b.novel.migrated.revisions = b.revisions;
        const how = await bringBook(b, 'browser', deviceKnown);
        if (how === 'new' || how === 'replaced' || how === 'copy') moved++;
      }
    }
    if (old && old.library) {
      /* connections only this browser knew (the old "browser direct" ones), and who did what */
      const lib = old.library;
      const profiles = Object.fromEntries((Array.isArray(lib.profiles) ? lib.profiles : []).filter((p) => p && p.id).map((p) => [p.id, p]));
      bringConnections(connectionsFromLegacy(profiles, {}), lib.defaults || null, {});
    }
    if (!flag) { try { localStorage.setItem('cozynovel.legacy.browser', String(Date.now())); } catch (_) { /* asked again next time, harmlessly */ } }
  } catch (e) { console.warn('this browser’s old books could not be read', e); }
  await store.flush();
  return moved;
}

/* An old backup file, brought in the same way. */
export async function bringOldBackup(data) {
  const books = fromLegacy({ records: data.records || [], blobs: data.blobs || [] });
  let moved = 0;
  for (const b of books) {
    b.novel.migrated.chapterPrint = printOf(b.novel, b.chapters);
    b.novel.migrated.revisions = b.revisions;
    const how = await bringBook(b, 'file', null);
    if (how === 'new' || how === 'replaced' || how === 'copy') moved++;
  }
  await store.flush();
  return moved;
}
