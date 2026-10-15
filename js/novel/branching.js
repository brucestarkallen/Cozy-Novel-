/* Making a branch on the phone: one complete copy, then its own address.
 * The builder is pure; the server compares the source's saved numbers and
 * publishes all the new records together. A lost acknowledgement retries
 * the same operation, never invents another book. */
import * as store from '../store.js';
import { buildBranch } from './branches.js';

const running = new Map();
const uncertain = new Map();
const keyOf = (options) => JSON.stringify(['novelId', 'name', 'chapterId', 'through', 'playId', 'turnId', 'conversationId', 'conversationTurnId'].map((key) => options[key] ?? null));
const unclear = (result) => result?.uncertain || !result?.status || result.status >= 500;
let journalDb;

/* The exact unfinished operation joins the browser's journal of unsaved
 * work. A phone can close the tab after the branch lands but before its
 * acknowledgement arrives; the next attempt still names that one branch.
 * No successful book lives here: the phone remains its only home. */
function journal() {
  if (typeof indexedDB === 'undefined') {
    if (typeof document === 'undefined') return Promise.resolve(null); // command-line checks
    return Promise.reject(new Error('The browser could not keep the unfinished branch safely. Nothing was copied; try again after reopening it.'));
  }
  if (!journalDb) journalDb = new Promise((resolve, reject) => {
    const request = indexedDB.open('cozynovel-branch-journal', 1);
    const timer = setTimeout(() => reject(new Error('The browser is still opening its saved work. Nothing was copied; try again in a moment.')), 5000);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('operations')) request.result.createObjectStore('operations', { keyPath: 'key' }); };
    request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
    request.onerror = () => { clearTimeout(timer); reject(new Error('The browser could not keep the unfinished branch safely. Nothing was copied; try again after reopening it.')); };
  }).catch((error) => { journalDb = null; throw error; });
  return journalDb;
}

async function pendingOperation(key, operation) {
  const db = await journal();
  if (!db) return operation === undefined ? uncertain.get(key) : undefined;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('operations', operation === undefined ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('operations');
    const request = operation === undefined ? store.get(key) : operation === null ? store.delete(key) : store.put({ key, operation });
    transaction.oncomplete = () => resolve(operation === undefined ? request.result?.operation : undefined);
    transaction.onerror = transaction.onabort = () => reject(new Error('The browser could not keep the unfinished branch safely. Try again after reopening it.'));
  });
}

async function forgetOperation(key) {
  /* If deleting the receipt fails, leave it in memory too. Another click
   * reopens the same saved branch rather than making an accidental copy. */
  try { await pendingOperation(key, null); uncertain.delete(key); }
  catch (_) { /* the saved operation remains safe to retry */ }
}

export function branchStory(options = {}) {
  const key = keyOf(options);
  if (running.has(key)) return running.get(key);
  const promise = makeBranch(options, key).finally(() => running.delete(key));
  running.set(key, promise);
  return promise;
}

async function makeBranch(options, key) {
  try {
    let operation = uncertain.get(key) || await pendingOperation(key);
    if (!operation) {
      const snapshot = await store.branchSnapshot(options.novelId);
      if (!snapshot.ok) return { ok: false, error: snapshot.error || 'the book could not be read — try again' };
      const built = buildBranch(snapshot, options);
      const { records, ...destination } = built;
      operation = { built: destination, payload: {
        sourceId: options.novelId,
        sourceSentId: options.novelId,
        generation: snapshot.generation,
        revisions: snapshot.records.map(({ kind, id, rev }) => ({ kind, id, rev })),
        records,
        requestId: built.novelId,
      } };
      /* A failed journal write happens before the first request. There is
       * then no copy on the phone whose outcome could be forgotten. */
      await pendingOperation(key, operation);
    }
    /* Keep the operation until its outcome is certain, including if the
     * page asks again after both acknowledgements went missing. */
    uncertain.set(key, operation);
    let saved = await store.createBranch(operation.payload);
    if (!saved.ok && unclear(saved)) saved = await store.createBranch(operation.payload);
    if (!saved.ok) {
      if (!unclear(saved)) await forgetOperation(key);
      return { ok: false, error: saved.error || 'the branch could not be kept — try again', ...(unclear(saved) ? { uncertain: true } : {}) };
    }
    const destination = operation.built;
    /* Do not install the submitted snapshot in the local store. An
     * idempotent retry may find a branch already edited in another window.
     * Its real records, including those edits, are what opens next. */
    const opened = await Promise.allSettled([
      store.open('novel', destination.novelId, { fresh: true }),
      store.open('chapter', destination.chapterId, { fresh: true }),
      ...(destination.playId ? [store.open('play', destination.playId, { fresh: true })] : []),
      ...(destination.conversationId ? [store.open('talk', destination.novelId, { fresh: true })] : []),
    ]);
    const bookRead = opened[0], chapterRead = opened[1];
    if (store.libraryGeneration() !== saved.generation) {
      await forgetOperation(key);
      return { ok: false, saved: true, error: 'A whole copy was brought back after the branch was saved. Open the book from the shelf to see what is there now.' };
    }
    if (bookRead.status === 'rejected' || chapterRead.status === 'rejected') {
      return { ok: false, saved: true, error: 'The branch was saved, but the phone could not open it yet. Try again to open that same branch.' };
    }
    if (!bookRead.value || !chapterRead.value || !(bookRead.value.order || []).includes(destination.chapterId) || chapterRead.value.novelId !== destination.novelId) {
      await forgetOperation(key);
      return { ok: false, saved: true, error: 'The branch was saved, but it or its chapter was removed or replaced before it could open. The shelf shows what is there now.' };
    }
    if (destination.playId) {
      const sceneRead = opened[2];
      if (sceneRead.status === 'rejected') return { ok: false, saved: true, error: 'The branch was saved, but its scene could not open yet. Try again to open that same branch.' };
      if (!sceneRead.value || sceneRead.value.novelId !== destination.novelId || !(bookRead.value.plays || []).includes(destination.playId)) {
        await forgetOperation(key);
        return { ok: false, saved: true, error: 'The branch was saved, but its scene was removed before it could open. The book is on the shelf.' };
      }
    }
    if (destination.conversationId) {
      const conversationRead = opened.at(-1);
      if (conversationRead.status === 'rejected') return { ok: false, saved: true, error: 'The branch was saved, but its conversation could not open yet. Try again to open that same branch.' };
      const talk = conversationRead.value;
      if (!talk || talk.novelId !== destination.novelId || (talk.convId !== destination.conversationId && !(talk.convs || []).some((c) => c.id === destination.conversationId))) {
        await forgetOperation(key);
        return { ok: false, saved: true, error: 'The branch was saved, but its conversation was removed before it could open. The book is on the shelf.' };
      }
    }
    await forgetOperation(key);
    if (store.libraryGeneration() !== saved.generation || !store.peek('novel', destination.novelId)) {
      return { ok: false, saved: true, error: 'The library changed before the branch could open. The shelf shows what is there now.' };
    }
    return { ok: true, ...destination };
  } catch (error) {
    return { ok: false, error: error?.message || 'the branch could not be made — try again' };
  }
}
