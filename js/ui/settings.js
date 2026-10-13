/* Cozy Novel — js/ui/settings.js — THE STUDY: connections and who does
 * what, your own instructions, how it looks, and keeping copies of
 * everything. Busy sections fold closed until opened. */

import * as store from '../store.js';
import { h, openSheet, field, group, toast, confirmIt, download, pickFile, menu, icon } from './dom.js';
import { PRESETS, LEVELS, spokenAs, describePrefill, learnedFacts, contextOf, alwaysThinks, cannotStopThinking } from '../model/providers.js';
import { listModels, tryConnection } from '../model/call.js';
import { connFor, connName } from '../novel/writer.js';
import { DEFAULT_WRITING } from '../novel/prompts.js';
import { newId, debounce, timeAgo, plural } from '../util.js';
import { booksFromLibrary } from '../novel/files.js';
import { bringOldBackup } from '../legacy.js';
import { applyLook } from './look.js';

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
  const pick = h('select', { hidden: true, 'aria-label': 'Pick a model' });
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
    pick.hidden = false;
    pick.onchange = () => {
      const m = r.models.find((x) => x.id === pick.value);
      if (!m) return;
      model.value = m.id;
      set({ model: m.id, modelHf: m.hf || undefined, modelEfforts: m.efforts || undefined, modelContext: m.context || undefined }, { redraw: true });
    };
    say.textContent = 'Picking one fills the model name, and keeps what the provider says about it (its room, its thinking levels).';
  } }, 'Show the models on offer');
  model.addEventListener('input', debounce(() => { if (model.value.trim() !== c.model) set({ modelHf: undefined, modelEfforts: undefined, modelContext: undefined }); }, 400));
  box.append(field('Model', model), h('div.btnrow', list), pick, say);

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
  g.body.append(
    roleSel('writer', 'The writer', 'Writes the pages, the other takes, the rewrites, and narrates the scenes you play. The writer button under the page switches it too.', false),
    roleSel('partner', 'The partner', 'Talks the book over with you.', true),
    roleSel('helper', 'The helper', 'Keeps the notes and the chapter summaries, quietly, after each change. A quick, inexpensive model is perfect here.', true));
  return g;
}

/* ------------------------------------------------------------ his words */

function wordsGroup(hs) {
  const ins = hs.instructions || {};
  const g = group('Your instructions', { key: 'set.words' });
  const box = (key, rows, placeholder) => {
    const ta = h('textarea', { rows, placeholder });
    ta.value = ins[key] || '';
    ta.addEventListener('input', debounce(() => changeHouse((x) => { x.instructions = x.instructions || {}; x.instructions[key] = ta.value; }), 500));
    return ta;
  };
  const name = h('input', { type: 'text', value: (hs.you && hs.you.name) || '', placeholder: 'e.g. Bruce' });
  name.addEventListener('input', debounce(() => changeHouse((x) => { x.you = { ...(x.you || {}), name: name.value.trim() }; }), 500));
  const sys = box('system', 9, 'How you like your stories written…');
  sys.classList.add('tall');
  g.body.append(
    field('Your name', name, 'How the writer, the partner and the helper speak of you (“the novel you and Bruce are writing”).'),
    field('How you like it written', sys, 'Sent first, word for word, to the writer and the narrator — like the main prompt of a SillyTavern preset. Your voice, your rules, a persona if you like.'),
    h('div.btnrow', h('button.btn.quiet.small', { onclick: () => { sys.value = DEFAULT_WRITING; sys.dispatchEvent(new Event('input')); } }, 'Use the starting words again')),
    field('A note at the end', box('late', 3, 'Optional. Rides after your request, like post-history instructions.'), 'Sent after your request each time the writer or narrator is asked. Empty: nothing is sent.'),
    field('How the partner talks', box('partner', 4, 'Optional. A persona or a way of talking for your writing partner.'), 'Sent first to the partner. Empty: the partner is simply a friend who knows the book.'));
  return g;
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
      field('Page width', sel('width', [['600', 'Narrow'], ['680', 'Book'], ['780', 'Wide']], look.width || '680'))));
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
