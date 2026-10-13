/* Cozy Novel — js/ui/settings.js — THE STUDY: connections and who does
 * what, your own instructions, how it looks, and keeping copies of
 * everything. Busy sections fold closed until opened. */

import * as store from '../store.js';
import { h, openSheet, field, group, toast, undoToast, confirmIt, download, pickFile, menu, icon } from './dom.js';
import { PRESETS, LEVELS, spokenAs, describePrefill, learnedFacts, contextOf, alwaysThinks, cannotStopThinking } from '../model/providers.js';
import { listModels, tryConnection } from '../model/call.js';
import { connFor, connName } from '../novel/writer.js';
import { DEFAULT_WRITING, DEFAULT_NARRATOR, DEFAULT_PARTNER } from '../novel/prompts.js';
import { listModules, moduleOf, builtinOf, moduleSteps, rideLine, READERS, READER_WORDS, RIDES, RIDES_WORDS } from '../novel/modules.js';
import { newId, debounce, timeAgo, plural } from '../util.js';
import { booksFromLibrary } from '../novel/files.js';
import { bringOldBackup } from '../legacy.js';
import { applyLook, DEFAULT_LOOK } from './look.js';

let sheet = null;
let editingId = null;

function house() { return store.peek('house', 'house') || {}; }
function changeHouse(fn, opts = {}) { store.change('house', 'house', fn, { delay: 400, ...opts }); }

export function openSettings(focus = '') {
  sheet = openSheet('Settings', { onClose: () => { sheet = null; } });
  draw(focus);
}

function draw(focus = '') {
  if (!sheet) return;
  const scroll = sheet.body.scrollTop;
  /* what is open stays open when the sheet is drawn again */
  const open = new Set([...sheet.body.querySelectorAll('section.group[data-key]:not(.fold)')].map((g) => g.dataset.key));
  /* asked for by name (the writer chip's Connections…): it opens, however it was left */
  if (focus === 'connections') open.add('set.connections');
  if (focus === 'roles') open.add('set.roles');
  sheet.body.textContent = '';
  const hs = house();
  sheet.body.append(
    connectionsGroup(hs, focus === 'connections'),
    rolesGroup(hs, focus === 'connections'),
    wordsGroup(hs),
    lookGroup(hs),
    backupsGroup(),
    aboutGroup());
  for (const g of sheet.body.querySelectorAll('section.group[data-key]')) {
    if (open.has(g.dataset.key)) { g.classList.remove('fold'); g.firstChild.setAttribute('aria-expanded', 'true'); }
  }
  sheet.body.scrollTop = scroll;
}

/* ------------------------------------------------------------ connections */

const THINK_WORDS = { '': 'Not set — the model decides', off: 'Off', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

function connectionsGroup(hs, open) {
  const conns = [...(hs.connections || [])].sort((a, b) => connName(a).localeCompare(connName(b)));
  if (!editingId || !conns.some((c) => c.id === editingId)) editingId = (conns[0] || {}).id || null;
  const g = group('Connections', { key: 'set.connections', open: open || !conns.length, note: conns.length ? plural(conns.length, 'connection') : 'none yet' });
  g.body.append(h('p.say', 'What you set here is exactly what is sent — your temperature, your top-p, your thinking. What you leave empty is not sent at all, so the provider does what it normally does. Keys stay on this phone.'));
  const pick = h('select', { 'aria-label': 'Which connection' });
  for (const c of conns) pick.append(h('option', { value: c.id, selected: c.id === editingId }, `${connName(c)}${c.model && c.name ? ` — ${c.model}` : ''}`));
  pick.addEventListener('change', () => { editingId = pick.value; draw(); });
  const row = h('div.btnrow',
    conns.length ? h('label.field', { style: { flex: '1', minWidth: '200px', margin: '0' } }, pick) : null,
    h('button.btn.small', { onclick: (e) => presetMenu(e.currentTarget) }, icon('plus', 15), 'New'),
    conns.length ? h('button.btn.quiet.small', { onclick: () => copyConnection(editingId) }, 'Copy') : null);
  g.body.append(row);
  const c = conns.find((x) => x.id === editingId);
  if (c) g.body.append(connectionForm(c));
  else g.body.append(h('p.say', 'Add one to start writing: pick your provider under New, paste your key, pick a model.'));
  return g;
}

function presetMenu(anchor) {
  menu(anchor, [{ label: 'Which provider?', header: true }, ...PRESETS.map((p) => ({ label: p.name, run: () => {
    const id = newId('c');
    const taken = (house().connections || []).map((x) => x.name);
    let name = p.id === 'custom' ? 'My connection' : p.name;
    for (let i = 2; taken.includes(name); i++) name = `${p.id === 'custom' ? 'My connection' : p.name} ${i}`;
    changeHouse((hs) => {
      hs.connections = hs.connections || [];
      hs.connections.push({ id, name, preset: p.id, url: p.url, model: p.model, key: '' });
      hs.roles = hs.roles || {};
      if (!hs.roles.writer) hs.roles.writer = id;
    }, { now: true });
    editingId = id;
    draw('connections');
  } }))]);
}

function copyConnection(id) {
  const c = (house().connections || []).find((x) => x.id === id);
  if (!c) return;
  const copy = JSON.parse(JSON.stringify(c));
  delete copy.learned; delete copy.tested; delete copy.modelHf; delete copy.modelEfforts; delete copy.modelContext;
  copy.id = newId('c');
  copy.name = `${connName(c)} (copy)`;
  changeHouse((hs) => { hs.connections.push(copy); }, { now: true });
  editingId = copy.id;
  toast('Copied — change the model, and the rest is as it was.');
  draw('connections');
}

function connectionForm(c) {
  const box = h('div');
  const set = (patch, { redraw = false } = {}) => {
    changeHouse((hs) => {
      const live = (hs.connections || []).find((x) => x.id === c.id);
      if (!live) return;
      const before = JSON.stringify([live.url, live.model, live.key, live.thinking, live.thinkingBudget, live.prefill]);
      for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === '' || v === null) delete live[k]; else live[k] = v; }
      if (JSON.stringify([live.url, live.model, live.key, live.thinking, live.thinkingBudget, live.prefill]) !== before) delete live.tested;
    });
    if (redraw) draw();
  };
  const text = (key, placeholder, { type = 'text', after = null } = {}) => {
    const inp = h('input', { type, placeholder, value: c[key] ?? '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    inp.addEventListener('input', debounce(() => { set({ [key]: inp.value.trim() }); if (after) after(inp.value.trim()); }, 400));
    return inp;
  };
  const num = (key, placeholder, step = 'any') => {
    const inp = h('input', { type: 'number', inputmode: 'decimal', step, placeholder, value: Number.isFinite(c[key]) ? c[key] : '' });
    inp.addEventListener('input', debounce(() => {
      const s = inp.value.trim();
      if (s === '') { set({ [key]: undefined }); return; }
      const n = Number(s);
      if (Number.isFinite(n)) set({ [key]: n });
    }, 400));
    return inp;
  };
  box.append(field('Name', text('name', 'What to call it', { after: () => {} })));
  box.append(field('Address', text('url', 'https://api.deepseek.com/v1'), 'The provider’s address — the preset fills it in.'));
  box.append(field('Key', text('key', 'Your API key', { type: 'password' })));
  const model = text('model', 'deepseek-chat');
  const pick = h('select', { 'aria-label': 'Pick a model' });
  /* inside a field, so it wears the same look as every other box here */
  const pickBox = h('label.field', { hidden: true, style: { marginTop: '8px' } }, pick);
  const say = h('p.say', { hidden: true });
  const list = h('button.btn.small', { onclick: async () => {
    list.disabled = true; say.hidden = false; say.className = 'say'; say.textContent = 'Asking which models it offers…';
    await store.flush('house', 'house');
    const r = await listModels((house().connections || []).find((x) => x.id === c.id) || c);
    list.disabled = false;
    if (!r.ok) { say.className = 'say bad'; say.textContent = `The list did not come: ${r.error}. The model name above still stands.`; return; }
    if (!r.models.length) { say.textContent = 'The list came back empty — type the model name above.'; return; }
    pick.textContent = '';
    pick.append(h('option', { value: '' }, `${r.models.length} on offer — pick one`));
    for (const m of r.models) pick.append(h('option', { value: m.id }, m.id + (m.context ? ` (${Math.round(m.context / 1000)}k)` : '')));
    pickBox.hidden = false;
    pick.onchange = () => {
      const m = r.models.find((x) => x.id === pick.value);
      if (!m) return;
      model.value = m.id;
      set({ model: m.id, modelHf: m.hf || undefined, modelEfforts: m.efforts || undefined, modelContext: m.context || undefined }, { redraw: true });
    };
    say.textContent = 'Picking one fills the model name, and keeps what the provider says about it (its room, its thinking levels).';
  } }, 'Show the models on offer');
  model.addEventListener('input', debounce(() => { if (model.value.trim() !== c.model) set({ modelHf: undefined, modelEfforts: undefined, modelContext: undefined }); }, 400));
  box.append(field('Model', model), h('div.btnrow', list), pickBox, say);

  /* thinking */
  const think = h('select');
  for (const l of ['', ...LEVELS]) think.append(h('option', { value: l, selected: (c.thinking || '') === l }, THINK_WORDS[l]));
  think.addEventListener('change', () => set({ thinking: think.value || undefined }, { redraw: true }));
  const facts = learnedFacts(c);
  const said = spokenAs(c);
  const thinkHint = (c.thinking || alwaysThinks(c.model) || cannotStopThinking(c)) ? `${said.charAt(0).toUpperCase()}${said.slice(1)}.` : 'Nothing about thinking is sent until you choose a level.';
  box.append(field('Thinking', think, thinkHint));

  const dials = h('div.fieldrow',
    field('Temperature', num('temperature', 'not set')),
    field('Top-p', num('topP', 'not set')),
    field('Longest reply (tokens)', num('maxTokens', 'not set', '1')),
    field('Room (context tokens)', num('context', `${contextOf({ ...c, context: undefined }).toLocaleString()} if empty`, '1')));
  box.append(dials, h('p.say', 'The room is how much the model can read at once; past it, the oldest chapters ride as their summaries. Empty: what the provider says, or 128,000.'));

  const more = group('More dials', { key: 'set.conn.more' },
    h('div.fieldrow',
      field('Top-k', num('topK', 'not set', '1')),
      field('Min-p', num('minP', 'not set')),
      field('Presence penalty', num('presencePenalty', 'not set')),
      field('Frequency penalty', num('frequencyPenalty', 'not set')),
      field('Repetition penalty', num('repetitionPenalty', 'not set')),
      field('Thinking room (Claude)', num('thinkingBudget', 'not set', '1'))),
    field('Prefill — start the reply for it', (() => {
      const ta = h('textarea', { rows: 3, placeholder: 'Words the reply begins with. Start with <think> to seed its thinking instead.' });
      ta.value = c.prefill || '';
      ta.addEventListener('input', debounce(() => set({ prefill: ta.value || undefined }), 500));
      return ta;
    })(), describePrefill(c) || 'Empty: nothing is started for it.'),
    field('How the address talks', (() => {
      const sel = h('select');
      for (const [v, l] of [['', 'Found from the address'], ['openai', 'Like OpenAI (most providers)'], ['anthropic', 'Like Claude (Anthropic)']]) sel.append(h('option', { value: v, selected: (c.shape || '') === v }, l));
      sel.addEventListener('change', () => set({ shape: sel.value || undefined }, { redraw: true }));
      return sel;
    })(), 'Only for an unusual address that talks the way Claude’s does.'));
  box.append(more);

  if (facts && (facts.efforts || facts.drop.length || facts.offThinks || facts.down || facts.noLateSystem || facts.prefillDown || facts.context || facts.maxOut || facts.completionField)) {
    const bits = [];
    if (facts.maxOut) bits.push(`gives at most ${facts.maxOut.toLocaleString()} tokens in one reply`);
    if (facts.completionField) bits.push('takes the reply’s length as “max_completion_tokens”');
    if (facts.efforts) bits.push('takes thinking at ' + facts.efforts.join(', '));
    if (facts.drop.length) bits.push('does not take ' + facts.drop.map((f) => `“${f}”`).join(', '));
    if (facts.offThinks) bits.push('Off does not stop it thinking, so Off asks for its least');
    if (facts.down) bits.push('refused thinking today, so none is sent until tomorrow');
    if (facts.noLateSystem) bits.push('takes no system message after the request');
    if (facts.prefillDown) bits.push('will not continue a started reply');
    if (facts.context) bits.push(`holds about ${facts.context.toLocaleString()} tokens`);
    box.append(h('p.say', 'What the model taught the app about itself: ' + bits.join(' · ') + '.'),
      h('div.btnrow', h('button.btn.quiet.small', { onclick: () => { set({ learned: undefined }, { redraw: true }); toast('Forgotten — the next request asks afresh.'); } }, 'Forget what it taught')));
  }

  const result = h('p.say' + (c.tested ? (c.tested.ok ? '.good' : '.bad') : ''), c.tested ? `Tried ${timeAgo(c.tested.at)}: ${c.tested.words}` : '');
  const tryBtn = h('button.btn.primary.small', { onclick: async () => {
    tryBtn.disabled = true; tryBtn.textContent = 'Trying…';
    await store.flush('house', 'house');
    const live = (house().connections || []).find((x) => x.id === c.id) || c;
    const out = await tryConnection(live);
    tryBtn.disabled = false; tryBtn.textContent = 'Try it';
    result.className = 'say ' + (out.ok ? 'good' : 'bad');
    result.textContent = out.words;
    set({ tested: { at: Date.now(), ok: out.ok, words: out.words } });
  } }, 'Try it');
  box.append(h('div.btnrow', tryBtn,
    h('button.btn.danger.small', { onclick: async () => {
      if (!(await confirmIt('Remove this connection?', `“${connName(c)}” and its key go. Your books are not touched.`, 'Remove it', { danger: true }))) return;
      changeHouse((hs) => {
        hs.connections = (hs.connections || []).filter((x) => x.id !== c.id);
        for (const k of Object.keys(hs.roles || {})) if (hs.roles[k] === c.id) delete hs.roles[k];
        if (!hs.roles.writer && hs.connections[0]) hs.roles.writer = hs.connections[0].id;
      }, { now: true });
      editingId = null;
      draw('connections');
    } }, 'Remove')), result);
  return box;
}

function rolesGroup(hs, open) {
  const conns = [...(hs.connections || [])].sort((a, b) => connName(a).localeCompare(connName(b)));
  const g = group('Who does what', { key: 'set.roles', open });
  const roleSel = (role, label, hint, fallback) => {
    const sel = h('select');
    if (fallback) sel.append(h('option', { value: '' }, 'The same as the writer'));
    else if (!conns.length) sel.append(h('option', { value: '' }, 'Add a connection first'));
    for (const c of conns) sel.append(h('option', { value: c.id, selected: ((hs.roles || {})[role] || '') === c.id }, connName(c)));
    sel.addEventListener('change', () => changeHouse((x) => { x.roles = x.roles || {}; if (sel.value) x.roles[role] = sel.value; else delete x.roles[role]; }, { now: true }));
    return field(label, sel, hint);
  };
  /* the checker: the helper's connection unless he picks another — or nobody */
  const checkSel = h('select');
  const curCheck = (hs.roles || {}).checker || '';
  checkSel.append(h('option', { value: '', selected: !curCheck }, 'The same as the helper'));
  for (const c of conns) checkSel.append(h('option', { value: c.id, selected: curCheck === c.id }, connName(c)));
  checkSel.append(h('option', { value: 'off', selected: curCheck === 'off' }, 'Nobody — don’t check'));
  checkSel.addEventListener('change', () => changeHouse((x) => { x.roles = x.roles || {}; if (checkSel.value) x.roles.checker = checkSel.value; else delete x.roles.checker; }, { now: true }));
  g.body.append(
    roleSel('writer', 'The writer', 'Writes the pages, the other takes, the rewrites, and narrates the scenes you play. The writer button under the page switches it too.', false),
    roleSel('partner', 'The partner', 'Talks the book over with you.', true),
    roleSel('helper', 'The helper', 'Keeps the notes and the chapter summaries, quietly, after each change. A quick, inexpensive model is perfect here.', true),
    field('The checker', checkSel, 'Reads each passage once it’s finished — grammar, wording that sounds machine-made, your words to avoid, slips against the book — and puts what it would change behind the bubble on the page, for you to apply or leave. Writing from before it began is checked only when you ask. A quick, inexpensive model is perfect here.'));
  return g;
}

/* ------------------------------------------------------------ his words */

/* the starting words of each box, for Back to the default */
const STARTING = { system: DEFAULT_WRITING, narrator: DEFAULT_NARRATOR, partner: DEFAULT_PARTNER };

function wordsGroup(hs) {
  const ins = hs.instructions || {};
  const g = group('Your instructions', { key: 'set.words' });
  const box = (key, rows, placeholder) => {
    const ta = h('textarea', { rows, placeholder });
    /* a box he never touched shows the words that are sent for it: its starting words */
    ta.value = typeof ins[key] === 'string' ? ins[key] : (STARTING[key] || '');
    ta.addEventListener('input', debounce(() => changeHouse((x) => { x.instructions = x.instructions || {}; x.instructions[key] = ta.value; }), 500));
    return ta;
  };
  /* every box with starting words can have them back */
  const back = (ta, key) => h('div.btnrow', h('button.btn.quiet.small', { onclick: async () => {
    if (ta.value.trim() && ta.value !== STARTING[key] && !(await confirmIt('Back to the default?', 'The words in the box go, and the starting words come back. (Copy yours first if you want to keep them.)', 'Back to the default'))) return;
    ta.value = STARTING[key];
    /* kept on the phone at once, not after the typing pause */
    changeHouse((x) => { x.instructions = x.instructions || {}; x.instructions[key] = STARTING[key]; }, { now: true });
    ta.dispatchEvent(new Event('input'));
    toast('The starting words are back.');
  } }, 'Back to the default'));
  const choose = (key, options, cur, hint, label) => {
    const sel = h('select');
    for (const [v, l] of options) sel.append(h('option', { value: v, selected: (cur || options[0][0]) === v }, l));
    sel.addEventListener('change', () => changeHouse((x) => { if (sel.value === options[0][0]) delete x[key]; else x[key] = sel.value; }, { now: true }));
    return field(label, sel, hint);
  };
  const name = h('input', { type: 'text', value: (hs.you && hs.you.name) || '', placeholder: 'e.g. Bruce' });
  name.addEventListener('input', debounce(() => changeHouse((x) => { x.you = { ...(x.you || {}), name: name.value.trim() }; }), 500));
  const sys = box('system', 9, 'How you like your stories written…');
  sys.classList.add('tall');
  const narr = box('narrator', 7, 'How the narrator tells the scenes you play…');
  const partner = box('partner', 5, 'A way of talking, or a persona, for your writing partner…');
  g.body.append(
    field('Your name', name, 'How your notes and the helper speak of you (“Bruce here.”, “a novel Bruce is writing”).'),
    field('How you like it written', sys, 'Sent first, word for word, to the writer — like the main prompt of a SillyTavern preset. Who the writer is, your voice, your rules, a persona if you like. The novel craft rides right after it (Modules, below).'),
    back(sys, 'system'),
    field('How the narrator tells scenes', narr, 'Sent first, word for word, when you play a scene — the narrator’s own voice and rules, a persona if you like. The scene craft rides right after it. Empty: nothing of yours is sent.'),
    back(narr, 'narrator'),
    field('How the partner talks', partner, 'Sent first, word for word, to your partner. Empty: nothing of yours is sent.'),
    back(partner, 'partner'),
    modulesField(hs),
    field('A note at the end', box('late', 3, 'Optional. Rides after your request, like post-history instructions.'), 'Sent after your request each time the writer or narrator is asked. Empty: nothing is sent.'),
    field('Words to avoid', box('avoid', 4, 'One to a line — for example:\na testament to\nshivers down her spine'), 'Words and phrases you never want in the book. The writer, the narrator and your partner are told them, after your own words; the checker marks any that slip through, with a way to write them again. Empty: nothing is sent.'),
    choose('notesAs', [
      ['system', 'The system message (the default)'],
      ['user', 'A user message — your notes'],
      ['assistant', 'An assistant message — a notebook'],
    ], hs.notesAs, 'What the book is about, its chapters and its notes, after your instructions — for the writer, the narrator and the partner alike, as in Cozy Tavern. As your notes they open “Bruce here. Here’s where our book stands…”; as a notebook they are the writer’s own (“My notebook for…”), before what you ask.', 'The book and its notes ride as'),
    choose('partnerApplies', [
      ['now', 'At once, with Undo (the default)'],
      ['wait', 'When I press Apply'],
    ], hs.partnerApplies, 'When your partner changes a passage, a chapter’s name, the book’s words or a card in the notes: each change shows under its answer, with its Undo.', 'Your partner’s changes land'));
  return g;
}

/* ------------------------------------------------------------ modules */
/* The crafts and rules that ride right after his own words (modules.js):
 * the app's, made from his Cozy Tavern preset, and his own. Each opens in a
 * sheet of its own: its name, who reads it, when it rides, its words. */

function modulesField(hs) {
  const list = h('div.modlist');
  for (const m of listModules(hs)) {
    list.append(h('button.modrow', { 'data-id': m.id, 'data-rides': m.rides, onclick: () => openModule(m.id) },
      h('span.grow',
        h('b', m.name),
        h('small', rideLine(m)),
        m.about ? h('small.about', m.about) : null),
      m.ownWords ? h('span.tag', 'your words') : m.custom ? h('span.tag', 'yours') : null,
      icon('right', 16)));
  }
  return h('div.field',
    h('span', 'Modules'),
    list,
    h('div.btnrow', h('button.btn.small', { onclick: addModule }, icon('plus', 15), 'Add your own module')),
    h('em', 'They ride right after your own words above — each to the writer, the narrator or your partner, as it says — in this order. The app’s come with it, made from your Cozy Tavern preset: change one and it’s yours, and Back to the default puts it back. Off: not sent at all.'));
}

function addModule() {
  const id = newId('m');
  /* his own is for the scenes he plays unless he ticks otherwise */
  changeHouse(moduleSteps.add(id, { at: Date.now(), name: '', text: '', to: ['narrator'], rides: 'always' }), { now: true });
  draw();
  openModule(id, { fresh: true });
}

/* one module, in a sheet of its own; what he changes is kept as he goes */
function openModule(id, { fresh = false } = {}) {
  const first = moduleOf(house(), id);
  if (!first) return;
  const base = builtinOf(id);
  const now = () => moduleOf(house(), id) || first;
  /* a save that waits for the typing pause — and goes at once when the
   * sheet closes, or is let go when the module goes back to the default */
  const savers = [];
  const later = (fn, ms = 450) => {
    let t = null;
    const flush = () => { if (t) { clearTimeout(t); t = null; fn(); } };
    savers.push({ flush, cancel: () => { clearTimeout(t); t = null; } });
    return () => { clearTimeout(t); t = setTimeout(flush, ms); };
  };
  const flushAll = () => { for (const x of savers) x.flush(); };
  const set = (patch, opts) => changeHouse(moduleSteps.set(id, patch), opts);
  let offHouse = () => {};
  const s = openSheet(first.name, { onClose: () => { flushAll(); offHouse(); if (sheet) draw(); } });
  s.box.classList.add('modsheet');

  /* his own, not named yet: the box is empty for him to name it */
  const named = base ? first.name : String(((house().modules || {})[id] || {}).name || '');
  const name = h('input', { type: 'text', value: named, placeholder: base ? base.name : 'What to call it' });
  name.addEventListener('input', later(() => { set({ name: name.value.trim() || undefined }); s.setTitle(name.value.trim() || (base ? base.name : 'A module of your own')); }));

  const say = h('em');
  const who = h('div.modwho');
  for (const r of READERS) {
    const inp = h('input', { type: 'checkbox', checked: first.to.includes(r) });
    inp.addEventListener('change', () => {
      const to = READERS.filter((x) => (x === r ? inp.checked : now().to.includes(x)));
      set({ to }, { now: true });
      sayNow();
    });
    who.append(h('label.toggle', inp, h('span', READER_WORDS[r])));
  }
  const rides = h('select');
  for (const k of RIDES) rides.append(h('option', { value: k, selected: first.rides === k }, RIDES_WORDS[k]));
  rides.addEventListener('change', () => { set({ rides: rides.value }, { now: true }); sayNow(); });

  const words = h('textarea.tall.modtext', { placeholder: 'The words — sent exactly as you write them.', spellcheck: 'false' });
  words.value = first.text;
  /* who reads it and when, as the fields say right now */
  const sayNow = () => {
    const to = READERS.filter((r, i) => who.children[i].querySelector('input').checked);
    say.textContent = rideLine({ ...now(), to, rides: rides.value, text: words.value });
  };
  const saveWords = later(() => set({ text: words.value }), 600);
  words.addEventListener('input', () => { saveWords(); sayNow(); });

  const buttons = h('div.btnrow');
  const drawButtons = () => {
    buttons.textContent = '';
    const m = now();
    if (base && m.changed) {
      buttons.append(h('button.btn.quiet.small', { onclick: async () => {
        if (m.ownWords && !(await confirmIt('Back to the default?', 'Your words for this module go, and the app’s come back — with who reads it and when it rides as they came. (Copy yours first if you want to keep them.)', 'Back to the default'))) return;
        for (const x of savers) x.cancel();
        changeHouse(moduleSteps.remove(id), { now: true });
        const d = now();
        name.value = d.name; words.value = d.text; rides.value = d.rides;
        for (const [i, r] of READERS.entries()) who.children[i].querySelector('input').checked = d.to.includes(r);
        s.setTitle(d.name);
        sayNow(); drawButtons();
        toast('The module is as it came.');
      } }, 'Back to the default'));
    }
    if (!base) {
      buttons.append(h('button.btn.danger.small', { onclick: () => {
        flushAll();
        const row = JSON.parse(JSON.stringify((house().modules || {})[id] || {}));
        changeHouse(moduleSteps.remove(id), { now: true });
        s.close();
        undoToast('The module is taken out.', () => { changeHouse(moduleSteps.restore(id, row), { now: true }); if (sheet) draw(); });
      } }, 'Remove this module'));
    }
  };
  /* what he changes shows its buttons as it lands */
  offHouse = store.subscribe('house', 'house', () => drawButtons());

  sayNow();
  drawButtons();
  if (first.about) s.body.append(h('p.say', first.about));
  s.body.append(
    field('Name', name),
    h('div.field', h('span', 'Who reads it'), who, say),
    field('When it rides', rides, 'Intimate and fight: it wakes by itself when your words or the page right before the point being written turn to it, and rides nearer the page.'),
    field('Its words', words, base ? 'The app’s words, from your preset — change anything and they are yours, sent exactly as you leave them. Empty: nothing is sent.' : 'Sent word for word, right after your own instructions. Empty: nothing is sent.'),
    buttons);
  if (fresh) name.focus();
}

/* ------------------------------------------------------------ the look */

const THEMES = [
  ['study', 'The study at night', 'linear-gradient(135deg,#2a1f17,#f4ead6 70%)'],
  ['candle', 'Candlelight', 'linear-gradient(135deg,#1f1813,#e2a54b)'],
  ['rain', 'Rain on the window', 'linear-gradient(135deg,#141b25,#8fb9e3)'],
  ['day', 'Daylight', 'linear-gradient(135deg,#fffdf8,#c98a36)'],
  ['ink', 'Ink (pure dark)', 'linear-gradient(135deg,#000,#d4a35a)'],
];

function lookGroup(hs) {
  const look = hs.look || {};
  const g = group('How it looks', { key: 'set.look' });
  const setLook = (patch) => {
    changeHouse((x) => { x.look = { ...(x.look || {}), ...patch }; });
    applyLook({ ...look, ...patch });
    Object.assign(look, patch);
  };
  const sw = h('div.swatches');
  for (const [id, label, grad] of THEMES) {
    const b = h('button.swatch', { 'aria-pressed': String((look.theme || 'study') === id), onclick: () => { setLook({ theme: id }); for (const x of sw.children) x.setAttribute('aria-pressed', String(x === b)); } }, h('i', { style: { background: grad } }), label);
    sw.append(b);
  }
  const toggle = (key, label, on) => {
    const inp = h('input', { type: 'checkbox', checked: on });
    inp.addEventListener('change', () => setLook({ [key]: inp.checked ? 'on' : 'off' }));
    return h('label.toggle', inp, h('span', label));
  };
  const sel = (key, options, cur) => {
    const s = h('select');
    for (const [v, l] of options) s.append(h('option', { value: v, selected: String(cur) === String(v) }, l));
    s.addEventListener('change', () => setLook({ [key]: s.value }));
    return s;
  };
  g.body.append(sw,
    toggle('room', 'The room behind the page', look.room !== 'off'),
    toggle('tint', 'Tint the dialogue', look.tint !== 'off'),
    toggle('indent', 'Indented paragraphs, like a printed book', look.indent === 'on'),
    h('div.fieldrow',
      field('Typeface', sel('font', [['literata', 'Literata (book)'], ['classic', 'Georgia (classic)'], ['sans', 'Plain (sans)']], look.font || 'literata')),
      field('Size', sel('size', [['16', 'Small'], ['18', 'Medium'], ['20', 'Large'], ['22', 'Larger'], ['25', 'Largest']], look.size || '18')),
      field('Line spacing', sel('lead', [['1.5', 'Snug'], ['1.72', 'Comfortable'], ['1.95', 'Airy']], look.lead || '1.72')),
      field('Page width', sel('width', [['600', 'Narrow'], ['680', 'Book'], ['780', 'Wide']], look.width || '680'))),
    h('div.btnrow', h('button.btn.quiet.small', { onclick: () => {
      changeHouse((x) => { x.look = { ...DEFAULT_LOOK }; }, { now: true });
      applyLook(DEFAULT_LOOK);
      Object.assign(look, DEFAULT_LOOK);
      toast('It looks the way it began.');
      draw();
    } }, 'Back to the default look')));
  return g;
}

/* ------------------------------------------------------------ copies */

function backupsGroup() {
  const g = group('Backups', { key: 'set.backups' });
  const copies = h('div', h('p.say', 'Looking…'));
  const trash = h('div');
  g.body.append(
    h('p.say', 'Your books live on this phone, in ~/.cozynovel — the same in every browser. A copy of everything is kept on the phone once a day (the newest fourteen), and every chapter keeps its earlier copies.'),
    h('div.btnrow',
      h('button.btn.primary.small', { onclick: () => { location.href = '/api/backup'; toast('The copy is on its way to your downloads.'); } }, 'Take a copy of everything'),
      h('button.btn.small', { onclick: bringCopyBack }, 'Bring a copy back')),
    h('h4', { style: { margin: '16px 0 6px', font: '600 16px/1.2 var(--display)' } }, 'Copies kept on this phone'), copies,
    h('h4', { style: { margin: '16px 0 6px', font: '600 16px/1.2 var(--display)' } }, 'Recently deleted'), trash);
  fillCopies(copies);
  fillTrash(trash);
  return g;
}

async function fillCopies(box) {
  const { status, data } = await store.api('GET', '/api/copies').catch(() => ({ status: 0 }));
  box.textContent = '';
  if (status !== 200 || !data) { box.append(h('p.say', 'The copies could not be read just now — the phone did not answer.')); return; }
  if (!data.copies.length) { box.append(h('p.say', 'None yet — the first is made today.')); return; }
  const list = h('ul.list');
  for (const c of data.copies.slice(0, 20)) {
    const before = c.name.includes('before-');
    list.append(h('li', h('div.grow', before ? 'Kept just before a copy was brought back' : `The day’s copy`, h('small', `${new Date(c.at).toLocaleString()} · ${Math.max(1, Math.round(c.size / 1024)).toLocaleString()} KB`)),
      h('button.btn.small', { onclick: async () => {
        if (!(await confirmIt('Bring this copy back?', 'Everything goes back to how it was then. Everything as it is now is kept as a copy first, so nothing is lost.', 'Bring it back'))) return;
        const r = await store.api('POST', `/api/copies/${c.name}/restore`, { body: {} });
        if (r.status === 200) { toast('Everything is as it was then.'); setTimeout(() => location.reload(), 600); } else toast((r.data && r.data.error) || 'It could not be brought back.');
      } }, 'Bring back')));
  }
  box.append(list);
}

async function fillTrash(box) {
  const { status, data } = await store.api('GET', '/api/trash').catch(() => ({ status: 0 }));
  box.textContent = '';
  if (status !== 200 || !data) { box.append(h('p.say', 'Recently deleted could not be read just now — the phone did not answer.')); return; }
  if (!data.trash.length) { box.append(h('p.say', 'Nothing — what you remove waits here for thirty days.')); return; }
  const list = h('ul.list');
  const what = { novel: 'The book', chapter: 'A chapter', play: 'A scene', talk: 'The talk with your partner', draft: 'Unsent words' };
  for (const t of data.trash) {
    /* a conversation brought back where a new one was begun keeps both — the earlier first */
    const busy = t.kind === 'talk';
    list.append(h('li', h('div.grow', `${what[t.kind] || 'Something'}${t.title ? ` — ${t.title}` : ''}`, h('small', `${timeAgo(t.at)}${t.count > 1 ? ` · with ${plural(t.count - 1, 'thing')} that belonged to it` : ''}`)),
      h('button.btn.small', { onclick: async () => {
        if (busy && !(await confirmIt('Bring this conversation back?', 'It comes back beside the one there now — its turns first, then the newer ones. Nothing is lost.', 'Bring it back'))) return;
        const r = await store.api('POST', `/api/trash/${t.name}/restore`, { body: {} });
        if (r.status === 200) {
          toast(t.kind === 'chapter' ? 'The chapter is back, at the end of its book.' : t.kind === 'play' ? 'The scene is back, under Scenes.' : 'It is back.');
          fillTrash(box);
        } else toast((r.data && r.data.error) || 'It could not be brought back.');
      } }, 'Bring back')));
  }
  box.append(list);
}

async function bringCopyBack() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let data = null;
  try { data = JSON.parse(await file.text()); } catch (_) { toast('That file is not a copy Cozy Novel can read.'); return; }
  if (data && data.format === 'cozyNovel.backup') {
    const n = await bringOldBackup(data);
    toast(n ? `${plural(n, 'book')} from the first Cozy Novel came onto the shelf.` : 'Those books are already on the shelf.');
    return;
  }
  if (!data || data.format !== 'cozynovel-library') { toast('That file is not a copy Cozy Novel can read.'); return; }
  const books = (data.records || []).filter((r) => r.kind === 'novel').length;
  const choice = await new Promise((resolve) => {
    let v = null;
    const s = openSheet('Bring a copy back', { small: true, onClose: () => resolve(v) });
    s.body.append(h('p.say', `This copy holds ${plural(books, 'book')}${data.at ? `, from ${new Date(data.at).toLocaleString()}` : ''}.`),
      h('div.btnrow', { style: { flexDirection: 'column', alignItems: 'stretch' } },
        h('button.btn.primary', { onclick: () => { v = 'add'; s.close(); } }, 'Add its books to the shelf'),
        h('button.btn', { onclick: () => { v = 'replace'; s.close(); } }, 'Replace everything with it')),
      h('p.say', 'Adding keeps everything here and puts its books beside them. Replacing makes everything exactly as in the copy — what is here now is kept as a copy on the phone first.'));
  });
  if (choice === 'add') {
    const list = booksFromLibrary(data);
    for (const b of list) {
      for (const id of b.novel.order) await store.create('chapter', id, b.chapters[id]);
      if (b.talk) await store.create('talk', b.novel.id, b.talk);
      for (const p of b.plays) await store.create('play', p.id, p);
      await store.create('novel', b.novel.id, b.novel);
    }
    toast(`${plural(list.length, 'book')} added to the shelf.`);
  } else if (choice === 'replace') {
    if (!(await confirmIt('Replace everything?', 'Everything becomes exactly as in the copy. What is here now is kept on the phone first (Backups → Copies kept on this phone).', 'Replace everything', { danger: true }))) return;
    const r = await store.api('POST', '/api/restore', { body: data });
    if (r.status === 200) { toast('Everything is as in the copy.'); setTimeout(() => location.reload(), 600); } else toast((r.data && r.data.error) || 'It could not be brought back.');
  }
}

/* ------------------------------------------------------------ about */

function aboutGroup() {
  const g = group('About', { key: 'set.about' });
  const line = h('p.say', '');
  store.api('GET', '/api/version').then(({ data }) => {
    if (data) line.textContent = `Cozy Novel ${data.version}${data.commit ? ` (${data.commit.slice(0, 7)})` : ''} — your books are in ${data.home}. To update: run cozynovel in Termux; open pages refresh by themselves when nothing is being written.`;
  }).catch(() => {});
  g.body.append(line);
  return g;
}

/* A change made in another window is drawn — but never under his fingers:
 * while he is typing in a field here, it waits until he leaves the field. */
let redrawWaiting = false;
export function redrawSettings() {
  if (!sheet) return;
  const a = document.activeElement;
  if (a && sheet.box.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) {
    if (!redrawWaiting) {
      redrawWaiting = true;
      sheet.box.addEventListener('focusout', function later() {
        setTimeout(() => {
          const now = document.activeElement;
          if (sheet && now && sheet.box.contains(now) && /^(INPUT|TEXTAREA|SELECT)$/.test(now.tagName)) return;
          sheet && sheet.box.removeEventListener('focusout', later);
          redrawWaiting = false;
          if (sheet) draw();
        }, 50);
      });
    }
    return;
  }
  draw();
}
