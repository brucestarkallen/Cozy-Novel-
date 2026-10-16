/* A story can take another way without losing the book it came from. */
import * as store from '../store.js';
import * as writer from '../novel/writer.js';
import * as talk from '../novel/talk.js';
import { branchStory } from '../novel/branching.js';
import { h, openSheet, field, toast } from './dom.js';

let hooks = {};
const making = new Set();
const names = new Map();
export function initBranches(appHooks) { hooks = appHooks; }
export function branchBusy(novelId) {
  const n = store.peek('novel', novelId);
  return making.has(novelId) || writer.busy(novelId) || talk.talkBusy('talk', novelId)
    || (n?.plays || []).some(id => talk.talkBusy('play', id));
}

export function openBranch(spec, { before = null } = {}) {
  const n = store.peek('novel', spec.novelId);
  if (!n) { toast('This book could not be read. Try opening it again.'); return; }
  const point = spec.playId ? 'scene' : spec.conversationTurnId ? 'conversation' : spec.chapterId ? 'passage' : 'whole';
  const key = JSON.stringify(spec);
  let alive = true;
  const s = openSheet('Take the story another way', { small: true, onClose: () => { alive = false; names.set(key, name.value); } });
  s.wrap.classList.add('branch-sheet');
  const name = h('input', { type: 'text', value: names.get(key) || '', placeholder: 'e.g. The road through the woods', maxlength: 120, required: true, autocomplete: 'off' });
  const intro = {
    whole: 'Begin a separate book from the whole story as it stands now, with its notes, conversations and scenes.',
    passage: spec.through === '^' ? 'Begin a separate book at the start of this chapter. Later pages stay in the original.' : 'Begin a separate book with the story up to and including this passage. Later pages stay in the original.',
    scene: 'Begin a separate book at this moment in the scene. It keeps the story from before this scene was turned into prose, and the scene up to this turn.',
    conversation: 'Begin a separate book with the whole story as it stands now, and this conversation up to this answer. This does not turn the book back to how it was when the answer was written.',
  }[point];
  const error = h('p.branch-status', { role: 'alert', hidden: true });
  const status = h('p.say', { role: 'status', 'aria-live': 'polite' });
  const create = h('button.btn.primary', { type: 'submit' }, 'Create branch');
  const form = h('form.branch-form', h('p.say', intro),
    field('Name this branch', name, 'This name appears on its own book on the shelf.'),
    h('details.branch-details', h('summary', 'What travels with the story?'),
      h('p.say', 'Each branch has its own pages and notes. Changes in one book leave the other as it is.'),
      h('p.say', point === 'whole' || point === 'conversation'
        ? 'Your premise, plans and instructions go with it, along with the notes for the current story.'
        : 'Your current premise, plans and instructions go with it. Notes follow the story kept here; if earlier notes cannot be recovered safely, they wait for a helper to read those pages again. Later conversations and scenes stay in the original.')),
    error, status, h('div.btnrow', create, h('button.btn.quiet', { type: 'button', onclick: () => s.close() }, 'Cancel')));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (making.has(spec.novelId)) return;
    const title = name.value.trim();
    if (!title) { error.hidden = false; error.textContent = 'Give this branch a name.'; name.focus(); return; }
    if (branchBusy(spec.novelId)) { error.hidden = false; error.textContent = 'Wait for the writing or reply to finish, then create the branch.'; return; }
    const where = hooks.where?.();
    making.add(spec.novelId);
    create.disabled = true; name.disabled = true; error.hidden = true;
    status.textContent = 'Keeping your words and making the branch…';
    try {
      if (before) await before();
      if (hooks.prepare) await hooks.prepare(spec.novelId);
      const out = await branchStory({ ...spec, name: title });
      if (!out?.ok) throw new Error(out?.error || 'The branch could not be made. Try again.');
      names.delete(key);
      if (!alive || hooks.where?.() !== where) { toast(`“${title}” is ready on the shelf.`, 6000); return; }
      s.close(); names.delete(key);
      toast(out.notesRebuild ? 'Your branch is ready. Its notes will be rebuilt when a helper reads the kept pages.' : 'Your branch is ready, with its own pages and notes.', 6000);
      await hooks.open?.(out.novelId, out.chapterId, { playId: out.playId, conversationId: out.conversationId });
    } catch (e) {
      const words = e?.message || 'The branch could not be made. Try again.';
      if (alive) { error.textContent = words; error.hidden = false; status.textContent = ''; }
      else toast(words, 7000);
    } finally {
      making.delete(spec.novelId);
      create.disabled = false; name.disabled = false;
    }
  });
  s.body.append(form);
  requestAnimationFrame(() => { if (alive) name.focus(); });
  return s;
}

export function openBranches(novelId, { before = null } = {}) {
  const n = store.peek('novel', novelId);
  if (!n) return;
  let alive = true;
  const s = openSheet('Branches of this story', { small: true, onClose: () => { alive = false; } });
  s.wrap.classList.add('branch-sheet');
  s.body.append(h('p.say', 'Try another path through the story. Each book keeps its own pages and notes.'),
    h('button.btn', { onclick: () => openBranch({ novelId }, { before }) }, 'Branch the whole book'),
    h('p.say.quiet', 'A second book with every page, the notes, your partner and the scenes as they stand — this one stays as it is.'));
  const chapterId = hooks.chapter?.(novelId) || n.prefs?.at || n.order?.at(-1);
  const chapter = store.peek('chapter', chapterId);
  if (chapter) s.body.append(h('button.btn.quiet', { onclick: () => {
    const now = store.peek('chapter', chapterId);
    openBranch({ novelId, chapterId, through: now?.passages?.at(-1)?.id || '^' }, { before });
  } }, 'Branch through this chapter'), h('p.say.quiet', 'A second book that ends where this chapter ends, its notes as they stood there.'), h('p.say', 'Or use a passage’s ⋯ menu to begin exactly where you choose.'));
  const family = h('div.branch-family', { 'aria-live': 'polite' });
  s.body.append(h('details.branch-details', { open: true }, h('summary', 'Open another branch'), family));
  const failure = h('p.branch-status', { role: 'alert', hidden: true });
  s.body.append(failure);
  let opening = false;
  async function open(id, chapterId, target) {
    if (opening) return;
    opening = true; failure.hidden = true;
    const where = hooks.where?.();
    try {
      if (before) await before();
      await hooks.prepare?.(novelId);
      if (alive && hooks.where?.() === where) await hooks.open?.(id, chapterId, target);
    } catch (e) {
      if (alive) { failure.textContent = e?.message || 'The book could not be opened. Try again.'; failure.hidden = false; }
    } finally { opening = false; }
  }
  async function draw() {
    family.replaceChildren(h('p.say', 'Finding this story’s branches…'));
    try {
      const rows = await store.listNovels();
      if (!alive) return;
      const rootId = n.branch?.rootId || n.id;
      const related = rows.filter(row => row.id === rootId || row.branch?.rootId === rootId || row.id === n.id);
      family.replaceChildren();
      if (n.branch?.fromId) {
        const source = rows.find(row => row.id === n.branch.fromId);
        if (source) family.append(h('button.btn.quiet.branch-source', { onclick: () => open(source.id, n.branch.point?.chapterId, { source: n.branch.point }) }, 'Open where this branch began'), h('p.say.quiet', 'The book it came from, at the passage it parted.'));
        else family.append(h('p.say', 'The book this branch began from is no longer on the shelf.'));
      }
      const list = h('ul.branch-list');
      for (const row of related) list.append(h('li', h('button.branch-book', { disabled: row.id === novelId, 'aria-current': row.id === novelId ? 'page' : undefined, onclick: () => open(row.id) }, h('b', row.branch?.name || row.meta?.title || 'Untitled'),
      h('small', row.id === novelId ? 'Open now' : row.id === rootId ? 'Original book' : `A branch${row.meta?.archived ? ' · archived' : ''}`))));
      family.append(list);
      if (related.length < 2) family.append(h('p.say', 'New branches will be listed here, beside this book.'));
    } catch (_) {
      if (alive) family.replaceChildren(h('p.say', 'The branches could not be read just now.'), h('button.btn.quiet', { onclick: draw }, 'Try again'));
    }
  }
  draw();
  return s;
}
