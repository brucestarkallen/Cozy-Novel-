/* Cozy Novel — js/novel/conversations.js — THE PARTNER'S CONVERSATIONS,
 * Cozy Tavern's housekeeper sessions for a book.
 *
 * One conversation is open; the others wait, each with its name and its
 * talk, newest used first. New conversation keeps the open one in the list;
 * Copy (the whole one, or Branch from here, up to one answer) makes a new
 * one from it and keeps it as it is; Rename; Remove (with Undo); Start over
 * empties the open one (with Undo). A conversation copied from another keeps
 * what came of its changes — said to the partner as before — but they stay
 * the conversation's they were made in, with their Undo there, so nothing
 * can be applied or undone twice. Edit and ask again (on his message) lets
 * go of it and everything after it, his words back in the box — Undo puts
 * them back while nothing was said since.
 *
 * In the talk record: `turns` is the open conversation's (everything else
 * in the app reads only these), with its `name`, `convId` and `named` (he
 * named it); `convs` the others, each {id, name, named, at, turns}. An empty
 * conversation he never named is not kept when another opens. Pure: no
 * store, no screen — talk.js plays the steps.
 */

export const NAME = 'Conversation';

/* when a conversation was last used: its newest message or answer, or when it was put aside */
export function lastAt(conv) {
  let at = Number(conv && conv.at) || 0;
  for (const t of (conv && conv.turns) || []) for (const v of t.versions || []) at = Math.max(at, Number(v.done) || 0, Number(v.at) || 0);
  return at;
}

/* "Conversation N", the first N no conversation is called */
export function freeName(rec, also = []) {
  const used = new Set([rec && rec.name, ...((rec && rec.convs) || []).map((c) => c.name), ...also].filter(Boolean));
  for (let n = 1; ; n++) if (!used.has(`${NAME} ${n}`)) return `${NAME} ${n}`;
}

/* the open conversation's name, as it is shown and kept */
export function openName(rec) { return String((rec && rec.name) || '').trim() || freeName({ ...(rec || {}), name: '' }); }

export function cleanConvName(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40); }

/* what the list shows: the open one, and the others newest used first */
export function conversationsOf(rec) {
  const others = ((rec && rec.convs) || []).filter((c) => c && c.id)
    .map((c) => ({ id: c.id, name: c.name || NAME, at: lastAt(c), n: (c.turns || []).length }))
    .sort((a, b) => b.at - a.at);
  return { open: { id: (rec && rec.convId) || null, name: openName(rec), n: ((rec && rec.turns) || []).length }, others };
}

/* the open conversation kept in the list (an empty one he never named is let go) */
function keepOpen(d, { spareId, spareName, at }) {
  const turns = d.turns || [];
  if (!turns.length && !d.named) return;
  const id = d.convId || spareId;
  d.convs = Array.isArray(d.convs) ? d.convs : [];
  if (d.convs.some((c) => c.id === id)) return;
  d.convs.push({ id, name: d.name || spareName, ...(d.named ? { named: true } : {}), at, turns });
}
function openOne(d, c) {
  d.turns = c.turns || [];
  d.name = c.name || '';
  d.convId = c.id;
  if (c.named) d.named = true; else delete d.named;
}

export const convSteps = {
  /* a new, empty conversation opens */
  fresh: ({ id, name, at, spareId, spareName }) => (d) => {
    keepOpen(d, { spareId, spareName, at });
    openOne(d, { id, name, turns: [] });
  },
  /* another conversation opens */
  open: ({ id, at, spareId, spareName }) => (d) => {
    const list = Array.isArray(d.convs) ? d.convs : [];
    const i = list.findIndex((c) => c.id === id);
    if (i < 0) return;
    const [c] = list.splice(i, 1);
    d.convs = list;
    keepOpen(d, { spareId, spareName, at });
    openOne(d, c);
  },
  /* a copy of the open conversation — whole, or up to one turn — opens; the
   * changes in it stay the ones they were made in */
  copy: ({ id, name, at, upto = null, spareId, spareName }) => (d) => {
    const turns = d.turns || [];
    const i = upto ? turns.findIndex((t) => t.id === upto) : turns.length - 1;
    if (upto && i < 0) return;
    const copied = JSON.parse(JSON.stringify(turns.slice(0, i + 1)));
    for (const t of copied) {
      for (const v of t.versions || []) {
        if (Array.isArray(v.changes)) v.changes = v.changes.map((c) => ({ ...c, copied: true }));
        /* a reply cut short where it was being written is not being written here */
        delete v.streaming; delete v.beat; delete v.tab; delete v.browser;
      }
    }
    keepOpen(d, { spareId, spareName, at });
    openOne(d, { id, name, turns: copied });
  },
  rename: (name) => (d) => { d.name = name; d.named = true; },
  /* Start over: the open conversation's talk goes */
  clear: () => (d) => { d.turns = []; },
  /* its Undo: back, while nothing was said in it since */
  unclear: (convId, turns) => (d) => {
    if ((d.convId || null) !== (convId || null) || (d.turns || []).length) return;
    d.turns = JSON.parse(JSON.stringify(turns));
  },
  /* the open conversation goes from the list: the newest of the others opens, or a new empty one */
  remove: ({ nextId, freshId, freshName }) => (d) => {
    const list = Array.isArray(d.convs) ? d.convs : [];
    const i = nextId ? list.findIndex((c) => c.id === nextId) : -1;
    if (i >= 0) { const [c] = list.splice(i, 1); d.convs = list; openOne(d, c); return; }
    openOne(d, { id: freshId, name: freshName, turns: [] });
  },
  /* its Undo: it opens again, the one opened in its place kept in the list */
  unremove: (conv, { at }) => (d) => {
    if (d.convId === conv.id || (d.convs || []).some((c) => c.id === conv.id)) return;
    keepOpen(d, { spareId: d.convId, spareName: d.name, at });
    openOne(d, JSON.parse(JSON.stringify(conv)));
  },
  /* Edit and ask again: his message and everything after it go */
  cutFrom: (tid) => (d) => { const i = (d.turns || []).findIndex((t) => t.id === tid); if (i >= 0) d.turns = d.turns.slice(0, i); },
  /* its Undo: back where they were, while the conversation still ends where it was cut */
  putBack: (convId, at, turns) => (d) => {
    if ((d.convId || null) !== (convId || null) || (d.turns || []).length !== at) return;
    d.turns = [...(d.turns || []), ...JSON.parse(JSON.stringify(turns))];
  },
};
