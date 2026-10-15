/* Cozy Novel — js/store.js
 *
 * The page's window onto the books on the phone. The phone is the only place
 * a book lives; this keeps the records this page has open, and every change
 * made here is an OPERATION — a small step written by id ("add this passage",
 * "this version's words are now…") — applied at once on screen and saved
 * soon after.
 *
 * Every save names the copy it was made from. When the phone holds a newer
 * one (another tab or browser saved meanwhile), the save is refused with the
 * newer copy; the page takes it and plays its own unsaved steps over it, then
 * saves again. Nothing is ever written over newer work, and nothing typed here
 * is lost to it. Every change made anywhere is announced to every open page,
 * which takes the new copy the same way — the same book everywhere, live.
 */

import { newId, sleep, hashText } from './util.js';

export const CLIENT = newId('tab');
const recs = new Map();            /* 'kind/id' -> rec */
const statusFns = new Set();
const updateFns = new Set();
/* the code this page is: the server writes it into the page it sends */
let bootCommit = (() => {
  try { const m = globalThis.document && document.querySelector('meta[name="cozynovel-commit"]'); return m && m.content ? m.content : null; } catch (_) { return null; }
})();
let generation = null;             /* the library's generation (counted up by each whole copy brought back) */
let libraryEpoch = 0;              /* discard replies already travelling when a whole copy comes back */
let offline = false;
let lastError = '';

const keyOf = (kind, id) => `${kind}/${id}`;

/* ------------------------------------------------------------ status */

export function onStatus(fn) { statusFns.add(fn); fn(status()); return () => statusFns.delete(fn); }
export function status() {
  let pending = 0;
  for (const r of recs.values()) pending += r.pending.length;
  return { offline, pending, error: lastError };
}
function tellStatus() { const s = status(); for (const fn of statusFns) { try { fn(s); } catch (_) { /* ignore */ } } }

/* the server was updated: the page knows by the commit the server says it runs */
export function onUpdate(fn) { updateFns.add(fn); return () => updateFns.delete(fn); }

/* ------------------------------------------------------------ fetches */

/* A phone whose server Android has frozen (Termux put to sleep) answers
 * nothing at all, and a request to it would wait forever — nothing said,
 * nothing kept. So a request with no answer in time fails the way a refused
 * one does: the banner says so and the work goes into the journal. A big save
 * gets a second more per megabyte to travel. */
const WAIT = 15000;
async function api(method, path, { body, headers = {}, keepalive = false, wait = 0 } = {}) {
  const guarded = generation !== null && /^\/api\/store\//.test(path) && ['PUT', 'DELETE'].includes(method);
  const init = { method, headers: { 'X-Client': CLIENT, ...(guarded ? { 'X-Generation': String(generation) } : {}), ...headers }, keepalive };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }
  const ms = wait || WAIT + Math.floor((init.body ? init.body.length : 0) / 1000);
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  if (ctl) init.signal = ctl.signal;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  try {
    const res = await fetch(path, init);
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (data && data.reload && Number.isFinite(data.generation)) knowGeneration(data.generation);
    return { status: res.status, data };
  } finally { if (timer) clearTimeout(timer); }
}
export { api };

/* WHAT WAS SENT, kept on the phone after each call (Cozy Tavern M347): a
 * sheet opened the moment a page lands waits for the words on their way
 * instead of calling them missing, and a keep that failed is said as failed —
 * never "not kept any more". The newest two hundred are remembered. */
const sentKeeps = new Map();   /* `${novelId}/${key}` -> { done, failed } */
export function keepSent(novelId, key, body) {
  const entry = { failed: '' };
  entry.done = api('PUT', `/api/sent/${novelId}/${key}`, { body })
    .then((r) => { if (r.status !== 200) entry.failed = (r.data && r.data.error) || `the phone answered ${r.status}`; })
    .catch(() => { entry.failed = 'the phone could not be reached'; });
  const k = `${novelId}/${key}`;
  sentKeeps.delete(k);
  sentKeeps.set(k, entry);
  while (sentKeeps.size > 200) sentKeeps.delete(sentKeeps.keys().next().value);
  return entry.done;
}
export async function sentKept(novelId, key) {
  const e = sentKeeps.get(`${novelId}/${key}`);
  if (!e) return { failed: '' };
  await e.done;
  return { failed: e.failed };
}

/* A BOOK'S LEASE (serve.py take_lease; Cozy Tavern M293): the helper and the
 * checker work on a book in one browser at a time. Held while the work goes
 * on and renewed; `confirm()` before a result is written says whether it is
 * still this window's — a tab Android froze past its lease has lost it to
 * another browser, and lays nothing over that one's work. A phone that does
 * not answer holds nothing for anyone: the work waits, as every call it
 * makes would fail anyway; a phone too old to keep leases lets it go ahead. */
const LEASE_MS = 90000;
const leasesHeld = new Set();
export async function lease(key, { ttl = Number(globalThis.__cozyLeaseMs) || LEASE_MS } = {}) {
  const ask = async (release = false, keepalive = false) => {
    try {
      const { status: code, data } = await api('POST', '/api/lease', { body: { key, ttl, ...(release ? { release: true } : {}) }, keepalive });
      if (code === 404) return { ok: true };
      if (code !== 200 || !data) return { ok: false, unreachable: true };
      return data;
    } catch (_) { return { ok: false, unreachable: true }; }
  };
  const first = await ask();
  if (!first.ok) return { ok: false, left: Number(first.left) || 0, unreachable: Boolean(first.unreachable) };
  let at = Date.now();
  let lost = false;
  const renew = async () => {
    if (lost) return false;
    const r = await ask();
    if (r.ok) at = Date.now();
    else if (!r.unreachable) lost = true;
    return Boolean(r.ok);
  };
  const timer = setInterval(renew, Math.floor(ttl / 3));
  const handle = {
    ok: true,
    /* still this window's: renewed lately, or renewed now */
    async confirm() { if (lost) return false; if (Date.now() - at < ttl / 2) return true; return renew(); },
    release() { clearInterval(timer); leasesHeld.delete(handle); if (!lost) ask(true); },
    /* the page is going (closed, reloaded, an update landing): let go at once, so the next page never waits it out */
    goNow() { clearInterval(timer); leasesHeld.delete(handle); if (!lost) { lost = true; ask(true, true); } },
  };
  leasesHeld.add(handle);
  return handle;
}
export function letLeasesGo() { for (const h of [...leasesHeld]) h.goNow(); }

/* ------------------------------------------------------------ records */

function rec(kind, id) {
  const k = keyOf(kind, id);
  let r = recs.get(k);
  if (!r) {
    /* baseJson: the phone's copy at rev, as text — what this page's unsaved steps were played over */
    r = { kind, id, rev: 0, data: null, baseJson: null, loaded: false, pending: [], saving: false, timer: null, deleted: false, journaled: false, fns: new Set(), wait: [] };
    recs.set(k, r);
  }
  return r;
}

/* The record as the phone holds it (null when it does not exist). */
export async function open(kind, id, { fresh = false } = {}) {
  const r = rec(kind, id);
  if (r.loaded && !fresh && !r.deleted) return r.data;
  if (r.loading) return r.loading;
  /* whoever was already watching it (a list showing it as not loaded yet) hears when it is */
  const firstTime = !r.loaded;
  r.loading = (async () => {
    for (let attempt = 0; ; attempt++) {
      const epoch = libraryEpoch;
      try {
        const { status: code, data } = await api('GET', `/api/store/${kind}/${id}`);
        if (epoch !== libraryEpoch || oldGeneration(data) || (data && knowGeneration(data.generation))) continue;
        if (code === 200 && data && data.data === null) { r.loaded = true; r.data = null; r.rev = 0; r.baseJson = null; setOffline(false); return null; }
        if (code === 200 && data && data.data) {
          if (!r.pending.length || !r.loaded) {
            r.data = data.data; r.rev = data.rev; r.baseJson = JSON.stringify(data.data);
          } else if (data.rev > r.rev) {
            rebase(r, data.rev, data.data);
          }
          r.loaded = true; r.deleted = false;
          setOffline(false);
          return r.data;
        }
        if (code === 404) { r.loaded = true; r.data = null; r.rev = 0; r.baseJson = null; setOffline(false); return null; }
        throw new Error(data && data.error ? data.error : `the phone answered ${code}`);
      } catch (e) {
        if (epoch !== libraryEpoch) continue;
        setOffline(true, e);
        if (attempt >= 2) throw e;
        await sleep(600 * (attempt + 1));
      }
    }
  })();
  let out;
  try { out = await r.loading; } finally { r.loading = null; }
  if (firstTime && r.loaded && r.data && r.fns.size) tell(r, 'opened');
  return out;
}

export function peek(kind, id) {
  const r = recs.get(keyOf(kind, id));
  return r && r.loaded ? r.data : undefined;
}
export function revOf(kind, id) {
  const r = recs.get(keyOf(kind, id));
  return r ? r.rev : 0;
}

/* Make a new record. Resolves once the phone has it. */
export async function create(kind, id, data) {
  const r = rec(kind, id);
  r.data = data; r.rev = 0; r.baseJson = null; r.loaded = true; r.deleted = false;
  r.pending.push({ fn: () => {}, checkpoint: false, created: true });
  await saveNow(r);
  return r.data;
}

/* Change a record: fn(data) runs now against the page's copy, and again over a
 * newer copy if the phone turns out to hold one. Write fn by id, never by
 * position, so it means the same thing over any copy. */
export function change(kind, id, fn, { now = false, checkpoint = false, delay = 500 } = {}) {
  const r = rec(kind, id);
  if (r.deleted || r.removing) return undefined;
  if (!r.loaded || !r.data) throw new Error(`${kind} ${id} is not open`);
  const out = fn(r.data);
  r.pending.push({ fn, checkpoint });
  tellStatus();
  /* whoever shows this record hears of the change once, after the steps of this moment */
  if (!r.told) { r.told = true; queueMicrotask(() => { r.told = false; tell(r, 'local'); }); }
  if (now) { clearTimeout(r.timer); r.timer = null; saveNow(r); } else schedule(r, delay);
  return out;
}

/* Wait until everything changed so far is on the phone. */
export async function flush(kind, id) {
  const list = kind ? [recs.get(keyOf(kind, id))].filter(Boolean) : [...recs.values()];
  await Promise.all(list.map((r) => (r.pending.length || r.saving ? saveNow(r) : null)));
}

export function subscribe(kind, id, fn) {
  const r = rec(kind, id);
  r.fns.add(fn);
  return () => r.fns.delete(fn);
}
function tell(r, why) { for (const fn of [...r.fns]) { try { fn(r.data, why); } catch (e) { console.error(e); } } }

export async function remove(kind, id) {
  const r = rec(kind, id);
  /* A book goes with its chapters, conversations, scenes and draft, exactly
   * as on the phone. Freeze every open record before waiting: a worker's
   * child save must not arrive after the phone has removed the whole book. */
  const owned = kind === 'novel' ? [...recs.values()].filter((x) =>
    ['chapter', 'talk', 'play', 'draft'].includes(x.kind) &&
    ((x.data && x.data.novelId === id) || (['talk', 'draft'].includes(x.kind) && x.id === id))) : [];
  const going = [r, ...owned];
  const epoch = libraryEpoch;
  for (const x of going) { x.removing = true; clearTimeout(x.timer); x.timer = null; }
  try {
    /* Keep pending edits in the deleted copy too. If deletion fails, their
     * steps have not been discarded and the records remain editable. */
    await Promise.all(going.map((x) => x.pending.length || x.saving ? saveNow(x) : null));
    if (epoch !== libraryEpoch) throw new Error('a whole copy was brought back; the page is catching up');
    const { status: code } = await api('DELETE', `/api/store/${kind}/${id}`);
    if (epoch !== libraryEpoch) throw new Error('a whole copy was brought back; the page is catching up');
    if (code !== 200) throw new Error('the phone could not delete it');
    for (const x of going) {
      x.deleted = true; x.data = null; x.loaded = false; x.pending = [];
      unjournal(x);
      /* watched records stay, so bringing the book back can refresh them */
      if (!x.fns.size) recs.delete(keyOf(x.kind, x.id));
    }
  } finally {
    for (const x of going) x.removing = false;
    tellStatus();
  }
}

/* Let go of a record this page no longer shows (its unsaved steps are saved first). */
export async function release(kind, id) {
  const r = recs.get(keyOf(kind, id));
  if (!r) return;
  if (r.pending.length || r.saving) await saveNow(r).catch(() => {});
  if (!r.pending.length && !r.fns.size) recs.delete(keyOf(kind, id));
}

function schedule(r, delay) {
  clearTimeout(r.timer);
  r.timer = setTimeout(() => { r.timer = null; saveNow(r); }, delay);
}

function rebase(r, rev, data) {
  r.baseJson = JSON.stringify(data);
  r.data = data;
  r.rev = rev;
  for (const op of r.pending) {
    try { op.fn(r.data); } catch (e) { console.error('a step could not be played over the newer copy', e); }
  }
}

/* Save until nothing is pending. One save at a time per record. EVERY STEP IS
 * WRITTEN TO MEAN THE SAME THING TWICE ("these are now the words", "add this
 * passage if it is not there"), because a step can be played again over a copy
 * that already holds it. */
/* how many bytes a text is on the wire */
const bytesOf = (s) => (typeof Blob === 'function' ? new Blob([s]).size : s.length * 3);

/* A save that could not land waits a while before it tries again — but
 * never past the moment the phone answers again: the banner says what he
 * typed is saved the moment it answers, and so it is. */
const napping = new Set();
function nap(ms) {
  return new Promise((resolve) => {
    const wake = () => { clearTimeout(t); napping.delete(wake); resolve(); };
    const t = setTimeout(wake, ms);
    napping.add(wake);
  });
}
function wakeSaves() { for (const wake of [...napping]) wake(); }

function saveNow(r, { keepalive = false } = {}) {
  if (r.saving) return new Promise((resolve) => { r.wait.push(resolve); r.again = true; });
  r.saving = true;
  const done = (async () => {
    let backoff = 800;
    let ride = keepalive;
    try {
      while (r.pending.length && !r.deleted) {
        const epoch = libraryEpoch;
        /* A new book can be the first record opened by a page. Learn which
         * library it belongs to before its first write, even without news. */
        if (generation === null) {
          try {
            const v = await api('GET', '/api/version');
            if (v.status !== 200 || !v.data || !Number.isFinite(v.data.generation)) throw new Error('the phone could not say which copy is open');
            knowGeneration(v.data.generation);
          } catch (e) {
            if (epoch !== libraryEpoch) continue;
            setOffline(true, e);
            journal(r);
            await nap(backoff);
            backoff = Math.min(backoff * 2, 15000);
            continue;
          }
          if (epoch !== libraryEpoch || !r.pending.length) continue;
        }
        const ops = r.pending.slice();
        const checkpoint = ops.every((o) => o.checkpoint);
        const json = JSON.stringify(r.data);
        const body = `{"data":${json}}`;
        let res;
        try {
          /* as the page is put away, a small record rides even if the page
           * closes (the browser carries at most 64 KB of such saves at once) */
          res = await api('PUT', `/api/store/${r.kind}/${r.id}`, {
            body,
            keepalive: ride && bytesOf(body) < 60000,
            headers: { 'X-Base': String(r.rev), 'X-Save': hashText(json), ...(checkpoint ? { 'X-Checkpoint': '1' } : {}) },
          });
        } catch (e) {
          if (epoch !== libraryEpoch) continue;
          ride = false;
          setOffline(true, e);
          journal(r);
          await nap(backoff);
          backoff = Math.min(backoff * 2, 15000);
          continue;
        }
        /* Its acknowledgement belongs to the library it left. In
         * particular it cannot consume an edit typed into the new copy. */
        if (epoch !== libraryEpoch) continue;
        if (res.status === 200 && res.data && Number.isFinite(res.data.rev)) {
          r.rev = res.data.rev;
          r.baseJson = json;
          r.pending.splice(0, ops.length);
          if (!r.pending.length) unjournal(r);
          setOffline(false);
          continue;
        }
        if (res.status === 409 && res.data && res.data.data) {
          /* the phone holds a newer copy: take it, play the unsaved steps over it */
          rebase(r, res.data.rev, res.data.data);
          tell(r, 'remote');
          continue;
        }
        if (res.status === 410) {
          r.deleted = true; r.pending = [];
          unjournal(r);
          tell(r, 'deleted');
          break;
        }
        /* the phone could not write it (full, or a fault): keep it and keep trying */
        setOffline(true, new Error((res.data && res.data.error) || `the phone answered ${res.status}`));
        journal(r);
        await nap(backoff);
        backoff = Math.min(backoff * 2, 15000);
      }
    } finally {
      r.saving = false;
      tellStatus();
      const waiting = r.wait.splice(0);
      if (r.again && r.pending.length) { r.again = false; saveNow(r).then(() => waiting.forEach((f) => f())); } else { r.again = false; waiting.forEach((f) => f()); }
    }
  })();
  return done;
}

function setOffline(on, err) {
  const was = offline;
  offline = on;
  lastError = on ? String((err && err.message) || err || '') : '';
  if (was !== on || on) tellStatus();
  /* back: what waits goes now */
  if (was && !on) wakeSaves();
}

/* ------------------------------------------------------- the shelf list */

export async function listNovels() {
  let res;
  /* the phone reads each book once for the shelf (then remembers it): a big
   * shelf's first reading on a slow phone is given its time, and no answer
   * at all is said on the banner, as any other is */
  try { res = await api('GET', '/api/novels', { wait: 60000 }); } catch (e) { setOffline(true, e); throw e; }
  const { status: code, data } = res;
  if (code !== 200 || !data) throw new Error('the shelf could not be read');
  setOffline(false);
  return data.novels || [];
}

/* ------------------------------------------------------- live changes */

const shelfFns = new Set();
export function onShelf(fn) { shelfFns.add(fn); return () => shelfFns.delete(fn); }
const reloadFns = new Set();
export function onReload(fn) { reloadFns.add(fn); return () => reloadFns.delete(fn); }

/* THE NEWS FROM THE PHONE. A browser gives one address six lines at most,
 * so one window of Cozy Novel holds the line for all of them in this browser
 * and hands each piece of news to the others (a lock says which one; a
 * channel carries the news) — six windows open side by side still leave the
 * page its lines for saving and writing. Only a window that can be seen
 * holds it or listens: a hidden one lets go, and coming back into view it
 * catches up on whatever it missed. Where the browser has no locks, each
 * window keeps its own line, as before. */
let source = null;           /* this window's own line, while it holds it */
let hellos = 0;
let listening = 0;           /* which listening this is (0: not listening) */
let starts = 0;
let letGo = null;            /* lets the lock go, while this window holds it */
let caughtUp = true;         /* false: news may have been missed (the line newly held here) */
const NEWS = typeof BroadcastChannel === 'function' ? new BroadcastChannel('cozynovel-news') : null;
const LOCKS = Boolean(NEWS && globalThis.navigator && navigator.locks && navigator.locks.request);

/* a whole copy was brought back: nothing this page kept waiting from before
 * it is played over it, and the page shows the copy */
function libraryReplaced() {
  libraryEpoch++;
  for (const r of recs.values()) { r.pending = []; r.loaded = false; r.journaled = false; clearTimeout(r.timer); r.timer = null; }
  Journal.clear();
  for (const fn of reloadFns) fn();
  for (const fn of shelfFns) fn();
}

/* A read can discover a restore before the news line does. An older reply
 * may still be travelling; it must never count the library backwards. */
function knowGeneration(next) {
  if (!Number.isFinite(next)) return false;
  if (generation === null) { generation = next; return false; }
  if (next <= generation) return false;
  generation = next;
  libraryReplaced();
  return true;
}
const oldGeneration = (data) => data && Number.isFinite(data.generation) && generation !== null && data.generation < generation;

function onNews(raw) {
  let ev;
  try { ev = JSON.parse(raw); } catch (_) { return; }
  if (ev.hello) {
    if (bootCommit === null) bootCommit = ev.hello.commit || '';
    else if ((ev.hello.commit || '') !== bootCommit) for (const fn of updateFns) fn(ev.hello);
    if (Number.isFinite(ev.hello.generation)) {
      /* the copy came back while this page was away (Cozy Tavern M670): what it kept waiting is not saved over it */
      if (knowGeneration(ev.hello.generation)) return;
    }
    setOffline(false);
    /* back after a gap, or the line newly held here: whatever changed
     * meanwhile is fetched, and work a closed tab left in this browser's
     * journal is handed over */
    if (hellos++ > 0 || !caughtUp) { caughtUp = true; recheckAll(); replayJournal().catch(() => {}); }
    return;
  }
  if (ev.resync) { recheckAll(); return; }   /* this page fell behind the news: it reads everything again */
  if (ev.reload) {
    /* a whole copy was brought back: nothing waiting from before it is played over it */
    if (Number.isFinite(ev.generation)) {
      if (generation !== null && ev.generation <= generation) return;
      generation = ev.generation;
    }
    libraryReplaced();
    return;
  }
  if (ev.kind === 'novel') for (const fn of shelfFns) fn(ev);
  /* Our own cascade also deletes child records, including ones opened
   * while its request travelled. Those deletion events still matter. */
  if (ev.by === CLIENT && !ev.deleted) return;
  const r = recs.get(keyOf(ev.kind, ev.id));
  if (!r || (!r.loaded && !r.deleted)) return;
  if (ev.deleted) {
    /* remove() already owns these records and its caller moves the screen
     * after success. Do not navigate away before that local removal ends. */
    if (ev.by === CLIENT && r.removing) return;
    gone(r); return;
  }
  /* newer, or back after being deleted (started over, brought back) */
  if (r.deleted || ev.rev > r.rev) refresh(r);
}

function openLine(relay) {
  source = new EventSource('/api/events');
  source.onmessage = (e) => {
    if (relay && NEWS) { try { NEWS.postMessage(e.data); } catch (_) { /* the others catch up by themselves */ } }
    onNews(e.data);
  };
  source.onerror = () => { /* EventSource tries again by itself; the next hello rechecks */ };
}

export function listen() {
  if (listening || typeof EventSource === 'undefined') return;
  const me = ++starts;
  listening = me;
  /* coming back after letting go: what changed meanwhile is fetched */
  if (me > 1) { recheckAll(); replayJournal().catch(() => {}); }
  if (!LOCKS) { openLine(false); return; }
  NEWS.onmessage = (e) => { if (listening === me && !source) onNews(e.data); };
  navigator.locks.request('cozynovel-news', (lock) => new Promise((release) => {
    /* gone quiet (or listening again since) while it waited: not this one */
    if (!lock || listening !== me || source) { release(); return; }
    letGo = release;
    /* news sent between the last holder letting go and this line opening is fetched at its hello */
    caughtUp = false;
    openLine(true);
  })).catch(() => { if (listening === me && !source) openLine(false); });
}
export function quiet() {
  listening = 0;
  if (NEWS) NEWS.onmessage = null;
  if (source) { source.close(); source = null; }
  if (letGo) { const r = letGo; letGo = null; r(); }
}

/* An answer that a record is not on the phone is about the moment it was
 * asked. It means deleted only if the page held the record as on the phone
 * then (rev > 0), nothing of it has been saved since and no save is on its
 * way — never for a record still being made when it asked (the phone
 * answered before the record landed), which would be marked deleted and
 * every change to it after dropped. */
function stillGone(r, revAsked) {
  return revAsked > 0 && r.rev === revAsked && !r.saving && Boolean(r.data) && !r.deleted;
}
function gone(r) {
  r.deleted = true;
  r.pending = [];
  unjournal(r);
  tell(r, 'deleted');
}

async function refresh(r) {
  if (r.refreshing) { r.refreshAgain = true; return; }
  r.refreshing = true;
  try {
    for (;;) {
      r.refreshAgain = false;
      const epoch = libraryEpoch;
      const revAsked = r.rev;
      const { status: code, data } = await api('GET', `/api/store/${r.kind}/${r.id}`);
      if (epoch !== libraryEpoch || oldGeneration(data) || (data && knowGeneration(data.generation))) return;
      if (code === 404 || (code === 200 && data && data.data === null)) {
        /* deleted — never a record this page made that the phone has not taken yet */
        if (stillGone(r, revAsked)) gone(r);
        return;
      }
      if (code === 200 && data && data.data && (data.rev > r.rev || r.deleted)) {
        if (r.saving && !r.deleted) {
          /* our own save is on its way; if it was made from an older copy it is refused and rebased */
        } else {
          const back = r.deleted;
          r.deleted = false; r.loaded = true;
          if (back) r.pending = [];
          rebase(r, data.rev, data.data);
          tell(r, 'remote');
          if (r.pending.length) schedule(r, 50);
        }
      }
      if (!r.refreshAgain) return;
    }
  } catch (_) { /* the next event or hello tries again */ } finally { r.refreshing = false; }
}

/* Everything this page holds, checked against the phone in one question; only
 * what changed is read again. */
async function recheckAll() {
  for (const fn of shelfFns) fn();
  const held = [...recs.values()].filter((r) => r.loaded || (r.deleted && r.fns.size));
  if (!held.length) return;
  const asked = new Map(held.map((r) => [r, r.rev]));
  const epoch = libraryEpoch;
  let revs = null;
  try {
    const { status: code, data } = await api('POST', '/api/revs', { body: held.map((r) => [r.kind, r.id]) });
    if (code === 200 && data && data.revs) revs = data.revs;
  } catch (_) { revs = null; }
  if (epoch !== libraryEpoch) return;
  for (const r of held) {
    if (!revs) { if (!r.deleted) refresh(r); continue; }
    const n = revs[keyOf(r.kind, r.id)];
    if (n === undefined) continue;
    if (n <= 0) { if (stillGone(r, asked.get(r))) gone(r); continue; }
    if (n > r.rev || r.deleted) refresh(r);
  }
}

/* ------------------------------------------------- leaving the page */

/* The phone puts a hidden page away without warning: whatever is waiting is
 * sent at once (a small record rides even as the page closes). */
export function flushOnHide() {
  for (const r of recs.values()) {
    if (!r.pending.length) continue;
    /* Android may close a hidden page before its save lands: what waits is
     * written down in this browser too, until the phone has it */
    journal(r);
    if (r.saving) continue;
    clearTimeout(r.timer); r.timer = null;
    saveNow(r, { keepalive: true });
  }
}

/* Back in view: whatever is still waiting goes, and whatever changed
 * elsewhere comes (the news line opens again; its hello fetches it). */
export function recheck() {
  for (const r of recs.values()) if (r.pending.length && !r.saving) { clearTimeout(r.timer); r.timer = null; saveNow(r); }
  if (listening) recheckAll(); else listen();
}

export function hasPending() {
  for (const r of recs.values()) if (r.pending.length || r.saving) return true;
  return false;
}

/* ------------------------------------------------------- the journal
 *
 * Changes the phone could not take yet: its server away (Android stopped
 * Termux) or the page put away mid-save. Written in this browser only then,
 * and crossed out the moment the phone takes them. If Android closes the tab
 * meanwhile, the next tab opened in this browser hands them over, merged with
 * whatever the phone holds by then — so no word typed here is lost to a tab
 * that closed before it could save. */

const Journal = (() => {
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error('no journal in this browser')); return; }
      const req = indexedDB.open('cozynovel-journal', 1);
      req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('pending')) d.createObjectStore('pending', { keyPath: 'k' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbp = null; reject(req.error); };
      req.onblocked = () => { dbp = null; reject(new Error('blocked')); };
    });
    return dbp;
  }
  async function run(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction('pending', mode);
      let req;
      try { req = fn(t.objectStore('pending')); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  return {
    put: (entry) => run('readwrite', (st) => st.put(entry)).catch(() => {}),
    del: (k) => run('readwrite', (st) => st.delete(k)).catch(() => {}),
    all: () => run('readonly', (st) => st.getAll()).then((x) => x || []).catch(() => []),
    clear: () => run('readwrite', (st) => st.clear()).catch(() => {}),
  };
})();

/* this tab holds a lock for as long as it is open, so another tab can tell
 * its journal from a closed tab's */
const TAB_LOCK = 'cozynovel-tab-';
try { if (globalThis.navigator && navigator.locks) navigator.locks.request(TAB_LOCK + CLIENT, () => new Promise(() => {})).catch(() => {}); } catch (_) { /* no locks here */ }

/* this browser, by an id it keeps — so a page left being written here can be
 * told from one being written in another browser */
export const BROWSER = (() => {
  try {
    let b = localStorage.getItem('cozynovel.browser');
    if (!b) { b = newId('br'); localStorage.setItem('cozynovel.browser', b); }
    return b;
  } catch (_) { return ''; }
})();
/* the tabs open in this browser right now (null when the browser cannot say) */
export async function liveTabs() {
  try {
    if (!globalThis.navigator || !navigator.locks || !navigator.locks.query) return null;
    const q = await navigator.locks.query();
    const out = new Set();
    for (const l of q.held || []) if (l.name && l.name.startsWith(TAB_LOCK)) out.add(l.name.slice(TAB_LOCK.length));
    return out;
  } catch (_) { return null; }
}

const KINDS_HERE = new Set(['house', 'novel', 'chapter', 'talk', 'play', 'draft']);
const journalKey = (r) => `${CLIENT}|${r.kind}/${r.id}`;
function journal(r) {
  if (!r.loaded || !r.data || r.deleted) return;
  r.journaled = true;
  const json = JSON.stringify(r.data);
  /* its fingerprint is the one its save carries: the phone's list of the
   * saves it took tells later whether this one landed */
  Journal.put({ k: journalKey(r), tab: CLIENT, kind: r.kind, id: r.id, base: r.rev, baseJson: r.baseJson, json, hash: hashText(json), gen: generation, at: Date.now() });
}
function unjournal(r) {
  if (!r.journaled) return;
  r.journaled = false;
  Journal.del(journalKey(r));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copy = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
function itemKey(x) {
  if (isObj(x)) return typeof x.id === 'string' ? 'i:' + x.id : typeof x.key === 'string' ? 'k:' + x.key : null;
  return typeof x === 'string' || typeof x === 'number' ? 'v:' + x : null;
}

/* Three copies of one record — the one both started from, this browser's,
 * the phone's — made one: whatever only one side changed is taken from it;
 * lists of things with ids (passages, versions, chapters, notes) are joined
 * by id, each kept where it stood; where both changed the same value, this
 * browser's unsaved change is taken (the phone keeps the other in the
 * record's earlier copies). */
export function merge3(base, mine, theirs) {
  if (same(mine, theirs)) return copy(mine);
  if (base !== undefined && same(mine, base)) return copy(theirs);
  if (base !== undefined && same(theirs, base)) return copy(mine);
  if (Array.isArray(mine) && Array.isArray(theirs)) return mergeList(Array.isArray(base) ? base : [], mine, theirs);
  if (isObj(mine) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const inM = k in mine, inT = k in theirs, inB = k in b;
      if (inM && inT) out[k] = merge3(inB ? b[k] : undefined, mine[k], theirs[k]);
      else if (inM) { if (!inB || !same(b[k], mine[k])) out[k] = copy(mine[k]); }   /* added here, or changed here after the phone let it go */
      else if (!inB || !same(b[k], theirs[k])) out[k] = copy(theirs[k]);             /* added there, or changed there after this browser let it go */
    }
    return out;
  }
  return copy(mine);
}
function mergeList(base, mine, theirs) {
  const keyed = [base, mine, theirs].every((l) => {
    const ks = l.map(itemKey);
    return ks.every((k) => k !== null) && new Set(ks).size === ks.length;
  });
  if (!keyed) return copy(same(theirs, base) ? mine : same(mine, base) ? theirs : mine);
  const B = new Map(base.map((x) => [itemKey(x), x]));
  const M = new Map(mine.map((x) => [itemKey(x), x]));
  const T = new Set(theirs.map(itemKey));
  const out = [];
  for (const x of theirs) {
    const k = itemKey(x);
    if (M.has(k)) out.push(merge3(B.get(k), M.get(k), x));
    else if (!B.has(k) || !same(B.get(k), x)) out.push(copy(x));   /* let go here — unless changed there since */
  }
  mine.forEach((x, i) => {
    const k = itemKey(x);
    if (T.has(k)) return;
    if (B.has(k) && same(B.get(k), x)) return;                       /* let go there, untouched here */
    let at = -1;                                                     /* after whatever stood before it here */
    for (let j = i - 1; j >= 0 && at < 0; j--) { const pk = itemKey(mine[j]); at = out.findIndex((y) => itemKey(y) === pk); }
    out.splice(at + 1, 0, copy(x));
  });
  return out;
}

/* One journal entry handed to the phone: 'saved', 'done' (the phone already
 * held it, or the record was deleted meanwhile, which stands), or '' (try
 * again later). */
async function handOver(e) {
  const epoch = libraryEpoch;
  const mine = JSON.parse(e.json);
  const base = e.baseJson ? JSON.parse(e.baseJson) : undefined;
  for (let i = 0; i < 6; i++) {
    const got = await api('GET', `/api/store/${e.kind}/${e.id}`);
    if (epoch !== libraryEpoch || oldGeneration(got.data) || (got.data && knowGeneration(got.data.generation))) return 'done';
    if (got.status !== 200 || !got.data) throw new Error('the phone is away');
    const rev = Number(got.data.rev) || 0;
    const theirs = got.data.data;
    if (theirs === null && e.base > 0) return 'done';
    /* the save it was waiting for landed after all (the page closed before it heard) */
    if (e.hash && Array.isArray(got.data.saves) && got.data.saves.some((s) => Array.isArray(s) && s[0] === e.hash)) return 'done';
    const data = theirs === null || rev === e.base ? mine : merge3(base, mine, theirs);
    if (theirs !== null && same(data, theirs)) return 'done';
    const put = await api('PUT', `/api/store/${e.kind}/${e.id}`, { body: `{"data":${JSON.stringify(data)}}`, headers: { 'X-Base': String(rev) } });
    if (epoch !== libraryEpoch) return 'done';
    if (put.status === 200) {
      const r = recs.get(keyOf(e.kind, e.id));
      if (r && r.loaded) refresh(r);
      if (e.kind === 'novel') for (const fn of shelfFns) fn({ kind: 'novel', id: e.id });
      return 'saved';
    }
    if (put.status === 410) return 'done';
    if (put.status !== 409) throw new Error('the phone is away');
  }
  return '';
}

let replaying = null;
/* Work left in this browser's journal by tabs that are closed now, handed
 * over. Returns how many records it saved. */
export function replayJournal() {
  if (replaying) return replaying;
  replaying = (async () => {
    const entries = await Journal.all();
    if (!entries.length) return 0;
    if (generation === null) {
      const v = await api('GET', '/api/version');
      if (v.status !== 200 || !v.data || !Number.isFinite(v.data.generation)) throw new Error('the phone is away');
      knowGeneration(v.data.generation);
    }
    /* no locks: every entry is handed over, which is safe — a merge by id means the same thing twice */
    const open = (await liveTabs()) || new Set();
    let n = 0;
    for (const e of entries.sort((a, b) => (a.at || 0) - (b.at || 0))) {
      if (!KINDS_HERE.has(e.kind) || typeof e.id !== 'string' || typeof e.json !== 'string') { await Journal.del(e.k); continue; }
      /* written before a whole copy was brought back: not played over it */
      if (Number.isFinite(e.gen) && e.gen !== generation) { await Journal.del(e.k); continue; }
      if (e.tab === CLIENT || open.has(e.tab)) continue;   /* an open tab saves its own */
      const how = await handOver(e);
      if (how) await Journal.del(e.k);
      if (how === 'saved') n++;
    }
    return n;
  })();
  return replaying.finally(() => { replaying = null; });
}

/* the news as the line brings it — for the tests, which have no line */
export function forTests() { return { recs, Journal, news: onNews }; }
