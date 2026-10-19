/* Cozy Novel — js/ui/settings.js — THE STUDY: connections and who does
 * what, your own instructions, how it looks, and keeping copies of
 * everything. A toolbar of these parts along the top, and only the part
 * chosen under it; busy sections inside a part fold closed until opened. */

import * as store from '../store.js';
import { h, openSheet, field, group, toast, undoToast, confirmIt, askChoice, copyText, download, pickFile, menu, icon } from './dom.js';
import { PRESETS, LEVELS, spokenAs, describePrefill, learnedFacts, contextOf, alwaysThinks, cannotStopThinking, wireOf, presetOf, budgetFor, searchOffered, structuredOffered, prefillFields } from '../model/providers.js';
import { listModels, tryConnection, testPrefill, learnIdentity } from '../model/call.js';
import { costOf, addRow } from '../model/usage.js';
import { STRUCTURED_PRESETS, fillPreset, presetWords, bannedPattern, MIN_AFTER_DEFAULT } from '../model/structured.js';
import { connFor, connName, partsOf, partsWords, holderOf } from '../novel/writer.js';
import { DEFAULT_WRITING, DEFAULT_NARRATOR, DEFAULT_PARTNER, macroNames, withMacros } from '../novel/prompts.js';
import { voiceOf, presetsOf, presetInUse, presetSteps, cleanVoice, cleanName, voiceLine, startingVoice, FORMAT as PRESET_FORMAT } from '../novel/presets.js';
import { listModules, moduleOf, builtinOf, moduleSteps, rideLine, READERS, READER_WORDS, RIDES, RIDES_WORDS } from '../novel/modules.js';
import { tellerOf, cleanTeller, framePerson } from '../novel/teller.js';
import { readStandingWords, groupFindings, findingsText } from '../novel/plainvoice.js';
import { cleanOwn, ownLine, ownSteps, OWN_ROLES, OWN_PLACES, OWN_TO } from '../novel/ownwords.js';
import { newId, debounce, timeAgo, plural, numberTyped, markTyped } from '../util.js';
import { booksFromLibrary } from '../novel/files.js';
import { bringOldBackup } from '../legacy.js';
import { applyLook, DEFAULT_LOOK, resolveLook, mergeLook } from './look.js';
import { colourPicker } from './colour-picker.js';
import { draftNow, nudgeChecker, nudgeHelper } from './desk.js';
import { superOn, superFrom } from '../novel/auto.js';

let sheet = null;
let editingId = null;

function house() { return store.peek('house', 'house') || {}; }
function changeHouse(fn, opts = {}) { store.change('house', 'house', fn, { delay: 400, ...opts }); }

/* A save that waits for his typing pause. Whatever draws the sheet again, or
 * uses or saves a preset, lands every save still waiting first: words typed a
 * moment ago are never drawn over, nor written in afterwards over a preset
 * just put in the boxes. */
const waiting = new Set();
function typing(fn, ms) {
  const d = debounce(() => { waiting.delete(d); fn(); }, ms);
  return () => { waiting.add(d); d(); };
}
function landTyping() { for (const d of [...waiting]) d.now(); }

/* Settings is a toolbar of its parts along the top and, under it, only the
 * part chosen — never every part stacked at once. It opens at the part last
 * shown in this browser (Connections while there is no connection yet);
 * asked for by name — the writer chip's Connections…, Open Who does what,
 * Your writing room — it opens at that part. */
const PARTS = [
  ['connections', 'Connections', 'Choose who writes with you.'],
  ['roles', 'Who does what', 'Your writer, helper, partner and checker.'],
  ['usage', 'Usage and cost', 'The words sent, and what they cost.'],
  ['words', 'Your instructions', 'Your voice, presets, modules and writing rules.'],
  ['look', 'How it looks', 'The room, the paper and the type.'],
  ['backups', 'Backups', 'Keep a copy. Bring your books back.'],
  ['about', 'About', 'This copy of Cozy Novel.'],
];
const PART_KEY = 'cozy.settings.part';
let part = 'connections';
const isPart = (k) => PARTS.some(([x]) => x === k);
function lastPart() {
  if (!(house().connections || []).length) return 'connections';
  try { const k = localStorage.getItem(PART_KEY); if (isPart(k)) return k; } catch (_) { /* this visit only */ }
  return 'connections';
}

export function openSettings(focus = '') {
  part = isPart(focus) ? focus : lastPart();
  sheet = openSheet('Settings', { onClose: () => { landTyping(); sheet = null; } });
  sheet.box.classList.add('settings-sheet');
  sheet.tabs = h('nav.settings-nav', { role: 'tablist', 'aria-label': 'Settings' },
    ...PARTS.map(([key, label, line]) => h('button.settings-tab', {
      role: 'tab', id: `settings-tab-${key}`, 'data-part': key, title: line,
      onclick: () => choosePart(key),
      onkeydown: (e) => {
        const i = PARTS.findIndex(([x]) => x === key);
        const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: PARTS.length - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        const next = PARTS[(to + PARTS.length) % PARTS.length][0];
        choosePart(next);
        sheet?.tabs.querySelector(`[data-part="${next}"]`)?.focus();
      },
    }, label)));
  sheet.box.insertBefore(sheet.tabs, sheet.body);
  draw();
}

/* a part pressed is shown from its top — the one already shown too */
function choosePart(key) {
  if (!sheet) return;
  if (key === part) { sheet.body.scrollTop = 0; return; }
  part = key;
  draw();
}

function draw(focus = '') {
  if (!sheet) return;
  landTyping();
  if (isPart(focus)) part = focus;
  try { localStorage.setItem(PART_KEY, part); } catch (_) { /* this visit only */ }
  /* the same part drawn again stays where he was in it; another part starts at its top */
  const scroll = sheet.body.dataset.part === part ? sheet.body.scrollTop : 0;
  /* what is open stays open when the sheet is drawn again */
  const open = new Set([...sheet.body.querySelectorAll('section.group[data-key]:not(.fold)')].map((g) => g.dataset.key));
  sheet.body.textContent = '';
  const hs = house();
  const g = ({
    connections: () => connectionsGroup(hs, true),
    roles: () => rolesGroup(hs, true),
    usage: () => usageGroup(hs),
    words: () => wordsGroup(hs),
    look: () => lookGroup(hs),
    backups: () => backupsGroup(),
    about: () => aboutGroup(),
  })[part]();
  for (const x of g.querySelectorAll('section.group[data-key]')) {
    if (open.has(x.dataset.key)) { x.classList.remove('fold'); x.firstChild.setAttribute('aria-expanded', 'true'); }
  }
  /* the part shown is shown whole: the toolbar names it, and a head of its own would only fold it away */
  g.querySelector(':scope > .ghead')?.remove();
  g.classList.remove('fold');
  g.classList.add('settings-section');
  g.id = 'settings-panel';
  g.setAttribute('role', 'tabpanel');
  g.setAttribute('aria-labelledby', `settings-tab-${part}`);
  for (const tab of sheet.tabs.children) {
    const on = tab.dataset.part === part;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on) tab.setAttribute('aria-controls', 'settings-panel'); else tab.removeAttribute('aria-controls');
  }
  sheet.body.append(g);
  sheet.body.dataset.part = part;
  sheet.body.scrollTop = scroll;
}

/* ------------------------------------------------------------ connections */
/* Cozy Tavern's connection editor, field for field and in its words (its
 * Settings → Connections), saved as he types: who writes with you, the
 * thinking and every dial, the prefill — as written or structured, with its
 * ready-made templates and its own Test it — looking things up, the prices
 * for Usage and cost. What he leaves empty is not sent. */

const THINK_WORDS = {
  '': 'Not set — nothing is sent',
  off: 'Off — straight to the words',
  low: 'Low — a quick weighing',
  medium: 'Medium — a considered weighing',
  high: 'High — a deep weighing',
  xhigh: 'XHigh — a long, deep weighing',
  max: 'Max — everything it has',
};
const MODEL_HINT = {
  claude: 'e.g. claude-sonnet-4-6, claude-opus-4-5', openai: 'e.g. gpt-4o, gpt-4o-mini', openrouter: 'e.g. anthropic/claude-sonnet-4-6',
  zai: 'e.g. glm-4.6, glm-4.5-air', gemini: 'e.g. gemini-2.5-pro, gemini-2.5-flash', deepseek: 'e.g. deepseek-chat, deepseek-reasoner',
  moonshot: 'e.g. kimi-k2-thinking', synthetic: 'e.g. hf:deepseek-ai/DeepSeek-V3', hermes: 'hermes-agent — or a profile’s name', custom: 'Whatever the endpoint calls it',
};
/* the thinking room, in Cozy Tavern's words for each kind of address */
function roomWords(c) {
  const model = String(c.model || '').toLowerCase();
  const url = String(c.url || '').toLowerCase();
  if (wireOf(c) === 'anthropic') {
    if (/deepseek/.test(url + ' ' + model)) return 'DeepSeek has thinking LEVELS and no thinking room — a number here is never sent; the level above is.';
    return 'Claude takes a thinking room (no less than 1,024 tokens — a smaller number is sent as 1,024). Set, it replaces the level above; empty, the level decides.';
  }
  if (/openrouter\.ai/.test(url)) {
    if (/^(anthropic|google)\//.test(model)) return 'Through OpenRouter this model takes a thinking room (OpenRouter keeps it between 1,024 and 32,000). Set, it replaces the level above; empty, the level decides.';
    return 'Through OpenRouter only Claude and Gemini models take a thinking room. For this model a number here is never sent — OpenRouter would only turn it into a level of its own choosing in place of yours; the level above is what is sent.';
  }
  return 'This address has thinking LEVELS and no thinking room — a number here is never sent; the level above is what decides how long it thinks.';
}

function connectionsGroup(hs, open) {
  const conns = [...(hs.connections || [])].sort((a, b) => connName(a).localeCompare(connName(b)));
  if (!editingId || !conns.some((c) => c.id === editingId)) editingId = (conns[0] || {}).id || null;
  const g = group('Connections', { key: 'set.connections', open: open || !conns.length, note: conns.length ? plural(conns.length, 'connection') : 'none yet' });
  g.body.append(h('p.say', 'Your key stays on this phone and is sent only to your provider. Empty settings use the provider’s defaults.'));
  const pick = h('select', { 'aria-label': 'Which connection' });
  for (const c of conns) pick.append(h('option', { value: c.id, selected: c.id === editingId }, `${connName(c)}${c.model && c.name ? ` — ${c.model}` : ''}${partsOf(hs, c.id).length ? ' (in use)' : ''}`));
  pick.addEventListener('change', () => { editingId = pick.value; draw(); });
  const row = h('div.btnrow',
    conns.length ? h('label.field', { style: { flex: '1', minWidth: '200px', margin: '0' } }, pick) : null,
    h('button.btn.small', { title: 'A new connection, started from a provider', onclick: (e) => presetMenu(e.currentTarget) }, icon('plus', 15), 'Add a connection'),
    conns.length ? h('button.btn.quiet.small', { title: 'A second connection with this one’s provider, key, address and dials — change its model and name.', onclick: () => copyConnection(editingId) }, 'Copy') : null);
  /* which parts the one shown has — picking it here only opens it to change (Who does what gives the parts) */
  const shown = conns.find((x) => x.id === editingId);
  const parts = shown ? partsOf(hs, shown.id) : [];
  g.body.append(row, shown ? h('p.say.inuse' + (parts.length ? '.good' : ''), parts.length ? `In use as ${partsWords(parts)}.` : 'Not in use — Who does what gives it a part.') : '', h('p.say.quiet', conns.length
    ? 'Pick a connection to edit. Copy keeps its settings so you can try another model.'
    : 'No connections yet. Add one: pick your provider, paste your key, pick a model.'));
  const c = conns.find((x) => x.id === editingId);
  if (c) g.body.append(connectionForm(c));
  return g;
}

function presetMenu(anchor) {
  menu(anchor, [{ label: 'Start from', header: true }, ...PRESETS.map((p) => ({ label: p.name, hint: p.url ? p.url.replace(/^https?:\/\//, '') : 'Any address that talks like OpenAI', run: () => {
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
  landTyping();
  const c = (house().connections || []).find((x) => x.id === id);
  if (!c) return;
  const copy = JSON.parse(JSON.stringify(c));
  delete copy.learned; delete copy.tested; delete copy.prefillTested; delete copy.modelHf; delete copy.modelEfforts; delete copy.modelContext;
  delete copy.identFor; delete copy.identTriedFor; delete copy.identTriedAt;
  copy.id = newId('c');
  copy.name = `${connName(c)} (copy)`;
  changeHouse((hs) => { hs.connections.push(copy); }, { now: true });
  editingId = copy.id;
  toast('Copied — change the model, and the rest is as it was.');
  draw('connections');
}

function connectionForm(c) {
  const box = h('div.connform');
  /* what the form says right now: the saved connection with what is being typed laid over it */
  const typed = {};
  const now = () => ({ ...((house().connections || []).find((x) => x.id === c.id) || c), ...typed });
  const set = (patch, { redraw = false } = {}) => {
    for (const [k, v] of Object.entries(patch)) typed[k] = v === '' || v === null ? undefined : v;
    changeHouse((hs) => {
      const live = (hs.connections || []).find((x) => x.id === c.id);
      if (!live) return;
      const keys = ['url', 'model', 'key', 'thinking', 'thinkingBudget', 'prefill', 'prefillMode', 'prefillMinChars', 'prefillBanned', 'prefillFlagField', 'prefillReasoningField', 'prefillKeepThinking', 'searchOn'];
      const before = JSON.stringify(keys.map((k) => live[k]));
      for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === '' || v === null) delete live[k]; else live[k] = v; }
      const after = JSON.stringify(keys.map((k) => live[k]));
      if (after !== before) { delete live.tested; delete live.prefillTested; }
    });
    if (redraw) draw();
  };
  const text = (key, placeholder, { type = 'text', after = null } = {}) => {
    const inp = h('input', { type, placeholder, value: c[key] ?? '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    inp.addEventListener('input', typing(() => { set({ [key]: inp.value.trim() }); if (after) after(inp.value.trim()); }, 400));
    return inp;
  };
  /* a number as he types it — "8,000" and "200.000" are thousands, "128k" too
   * (util.js numberTyped); one that is not a number is said under the box,
   * never kept as another number (Cozy Tavern M234, M390) */
  const num = (key, placeholder, { whole = false } = {}) => {
    const inp = h('input', { type: 'text', inputmode: whole ? 'numeric' : 'decimal', placeholder, value: Number.isFinite(c[key]) ? String(c[key]) : '', autocomplete: 'off' });
    const said = h('small.badnum', { hidden: true }, whole ? 'A whole number, like 8000 — this one is not kept.' : 'A number, like 0.7 — this one is not kept.');
    inp.addEventListener('input', typing(() => {
      const s = inp.value.trim();
      if (s === '') { said.hidden = true; inp.removeAttribute('aria-invalid'); set({ [key]: undefined }); return; }
      const n = numberTyped(s, { whole });
      const ok = Number.isFinite(n);
      said.hidden = ok;
      if (ok) { inp.removeAttribute('aria-invalid'); set({ [key]: n }); } else inp.setAttribute('aria-invalid', 'true');
    }, 400));
    return h('span.numbox', inp, said);
  };
  const tick = (key, label, on, onChange) => {
    const inp = h('input', { type: 'checkbox', checked: on });
    inp.addEventListener('change', () => onChange(inp.checked));
    return h('label.toggle', inp, h('span', label));
  };
  const quiet = (words) => h('p.say.quiet', words);
  const kind = wireOf(c) === 'anthropic' ? 'claude' : presetOf(c);

  /* ---- who it is */
  box.append(field('Call it', text('name', 'e.g. Claude at home')));
  const urlHint = quiet(wireOf(c) === 'anthropic' ? 'Leave as-is unless you know otherwise.' : 'Usually ends in /v1 — left off, it is added for you.');
  /* another address: what its provider says of the model there is asked, in the background */
  const askAbout = () => setTimeout(() => { const live = (house().connections || []).find((x) => x.id === c.id); if (live) learnIdentity(live).catch(() => {}); }, 300);
  box.append(field('Address', text('url', 'https://api.deepseek.com/v1', { after: askAbout })), urlHint);
  box.append(field('Key', text('key', 'The key they gave you', { type: 'password' })));
  const model = text('model', (PRESETS.find((p) => p.id === kind) || {}).model || 'the model’s name');
  const pick = h('select', { 'aria-label': 'What’s on offer' });
  const pickBox = h('label.field', { hidden: true, style: { marginTop: '8px' } }, h('span', 'What’s on offer'), pick);
  const say = h('p.say', { hidden: true });
  const list = h('button.btn.small', { onclick: async () => {
    list.disabled = true; say.hidden = false; say.className = 'say'; say.textContent = 'Asking what’s on offer…';
    landTyping();
    await store.flush('house', 'house');
    const r = await listModels(now());
    list.disabled = false;
    if (!r.ok) { say.className = 'say bad'; say.textContent = `The offer wouldn’t come through: ${r.error}. The model name above still stands.`; return; }
    if (!r.models.length) { say.textContent = 'The list came back empty — the model name above still stands.'; return; }
    pick.textContent = '';
    pick.append(h('option', { value: '' }, 'Choose one…'));
    for (const m of r.models) pick.append(h('option', { value: m.id }, m.id + (m.context ? ` (${Math.round(m.context / 1000)}k)` : '')));
    pickBox.hidden = false;
    pick.onchange = () => {
      const m = r.models.find((x) => x.id === pick.value);
      if (!m) return;
      model.value = m.id;
      /* what the provider says of it, kept for this very model at this very address */
      set({ model: m.id, modelHf: m.hf || undefined, modelEfforts: m.efforts || undefined, modelContext: m.context || undefined, identFor: `${m.id}@${now().url || ''}`, identTriedFor: undefined, identTriedAt: undefined }, { redraw: true });
    };
    say.textContent = `${r.models.length.toLocaleString()} on offer. Pick one and it fills the model field — and keeps what the provider says about it (its room, its thinking levels).`;
  } }, 'Fetch what’s on offer');
  /* a model typed by hand: what was said of another goes, and its provider is asked about this one, in the background (Tavern M289) */
  model.addEventListener('input', typing(() => {
    if (model.value.trim() !== c.model) set({ modelHf: undefined, modelEfforts: undefined, modelContext: undefined, identFor: undefined, identTriedFor: undefined, identTriedAt: undefined });
    askAbout();
  }, 400));
  box.append(field('Model', model), quiet(MODEL_HINT[kind] || MODEL_HINT.custom), h('div.btnrow', list), pickBox, say);

  const basicActions = h('div.connection-actions');
  box.append(basicActions);
  const section = (title, key, note) => {
    const g = group(title, { key: `set.conn.${key}`, open: true, note });
    g.classList.add('connection-section');
    box.append(g);
    return g.body;
  };

  /* ---- thinking */
  const thinkingBody = section('Thinking', 'thinking', 'Time to weigh the words');
  const think = h('select');
  for (const l of ['', ...LEVELS]) think.append(h('option', { value: l, selected: (c.thinking || '') === l }, THINK_WORDS[l] || l));
  think.addEventListener('change', () => set({ thinking: think.value || undefined }, { redraw: true }));
  const said = spokenAs(c);
  thinkingBody.append(field('Thinking — how long the writer weighs the page before writing', think),
    quiet('A level this address can’t name is spoken as the nearest one it can — never a name the endpoint rejects. If the address ever refuses the thinking settings, the page is sent again without them, and none are sent for a day.'),
    quiet((c.thinking || alwaysThinks(c.model) || cannotStopThinking(c)) ? `For this connection: ${said}.` : 'Not set: nothing about thinking is sent until you choose a level.'));
  thinkingBody.append(field('Thinking room, in tokens (optional)', num('thinkingBudget', budgetFor({ ...c, thinkingBudget: 2048 }).sent ? 'Leave empty to follow the level' : 'Not used by this address', { whole: true })), quiet(roomWords(c)));

  /* ---- the dials */
  const dialsBody = section('Writing settings', 'dials', 'Sampling and reply length');
  dialsBody.append(h('div.fieldrow',
    field('Temperature (0–2)', num('temperature', 'Their own default')),
    field('Top-p (0–1)', num('topP', 'Their own default'))));
  const claude = wireOf(c) === 'anthropic';
  dialsBody.append(h('div.fieldrow',
    field('Top-k', num('topK', 'Their own default', { whole: true })),
    claude ? null : field('Min-p (0–1)', num('minP', 'Their own default')),
    claude ? null : field('Presence penalty', num('presencePenalty', 'Their own default')),
    claude ? null : field('Frequency penalty', num('frequencyPenalty', 'Their own default')),
    claude ? null : field('Repetition penalty', num('repetitionPenalty', 'Their own default')),
    claude ? null : field('Seed', num('seed', 'None', { whole: true }))));
  if (!claude) dialsBody.append(quiet('The three penalties make the model avoid words it has already written — sound effects too (*CLANG!*, “hah… hah…”). If the sounds thin out, keep them at 0 or low.'));
  else dialsBody.append(quiet('Claude takes top-k and nothing else of these; with its thinking on it takes no top-k, and its temperature is 1.'));
  const stop = h('textarea', { rows: 2, spellcheck: 'false', placeholder: 'Leave empty to send none' });
  stop.value = Array.isArray(c.stop) ? c.stop.join('\n') : '';
  stop.addEventListener('input', typing(() => { const lines = stop.value.split('\n').filter((l) => l !== ''); set({ stop: lines.length ? lines : undefined }); }, 500));
  dialsBody.append(field('Stop text, one per line', stop, 'The reply ends where one of these would be written. The helper and the checker never get them (a stop can end a JSON answer halfway).'));
  dialsBody.append(h('div.fieldrow',
    field('Longest reply, in tokens', num('maxTokens', 'The provider’s own', { whole: true })),
    field('The model’s room, in tokens', num('context', `${contextOf({ ...c, context: undefined }).toLocaleString()} if empty`, { whole: true }))));
  dialsBody.append(quiet('Longest reply: empty, nothing is sent (Claude, which must be told one, gets what the length you ask for needs); a model that thinks gets room to think and write. The room is how much the model can read at once — past it, the oldest chapters ride as their summaries; empty, what the provider says, or its usual size.'));

  /* ---- what it costs */
  const pricesBody = section('Prices', 'prices', 'For your usage record');
  pricesBody.append(h('div.fieldrow',
    field('Input price, $ per million tokens', num('priceIn', 'e.g. 3')),
    field('Output price, $ per million tokens', num('priceOut', 'e.g. 15')),
    field('Cached input price, $ per million', num('priceCached', 'e.g. 0.3'))),
    quiet('Never sent — for Usage and cost. Cached input is what the provider serves from its cache; empty, the input price.'));

  /* ---- looking things up */
  if (searchOffered(c)) {
    box.append(tick('searchOn', 'Let it look things up (web search)', c.searchOn === true, (on) => set({ searchOn: on ? true : undefined }, { redraw: true })));
    if (c.searchOn === true) box.append(field(claude ? 'At most how many look-ups per reply' : 'At most how many pages it reads per reply', num('searchMaxUses', 'not set', { whole: true }), 'Empty: nothing is sent, and the provider decides.'));
    box.append(quiet(`${claude ? 'Claude’s own web search' : 'OpenRouter’s web plugin'}: for the pages, your partner and the scenes — never the helper or the checker. What it looked at is listed under the passage.`));
  } else {
    box.append(quiet('Looking things up: this address has no looking-things-up of its own — the switch rests. (Web search rides a provider’s own tool: Claude’s native search, or OpenRouter’s web plugin.)'));
  }

  /* ---- the prefill */
  section('Starting the reply', 'prefill', 'Optional prefill').append(prefillPart(c, { set, now, quiet, tick }));

  /* ---- how the address talks */
  box.append(group('How the address talks', { key: 'set.conn.shape' },
    field('How the address talks', (() => {
      const sel = h('select');
      for (const [v, l] of [['', 'Found from the address'], ['openai', 'Like OpenAI (most providers)'], ['anthropic', 'Like Claude (Anthropic)']]) sel.append(h('option', { value: v, selected: (c.shape || '') === v }, l));
      sel.addEventListener('change', () => set({ shape: sel.value || undefined }, { redraw: true }));
      return sel;
    })(), 'Only for an unusual address that talks the way Claude’s does.')));

  /* ---- what the model taught */
  const facts = learnedFacts(c);
  if (facts && (facts.efforts || facts.drop.length || facts.offThinks || facts.down || facts.noLateSystem || facts.prefillDown || facts.context || facts.maxOut || facts.completionField || facts.structuredDown)) {
    const bits = [];
    if (facts.maxOut) bits.push(`gives at most ${facts.maxOut.toLocaleString()} tokens in one reply`);
    if (facts.completionField) bits.push('takes the reply’s length as “max_completion_tokens”');
    if (facts.efforts) bits.push('takes thinking at ' + facts.efforts.join(', '));
    if (facts.drop.length) bits.push('does not take ' + facts.drop.map((f) => `“${f}”`).join(', '));
    if (facts.offThinks) bits.push('Off does not stop it thinking, so Off asks for its least');
    if (facts.down) bits.push('refused thinking today, so none is sent until tomorrow');
    if (facts.noLateSystem) bits.push('takes no system message after the request');
    if (facts.prefillDown) bits.push('will not continue a started reply');
    if (facts.structuredDown) bits.push('will not take a structured prefill');
    if (facts.context) bits.push(`holds about ${facts.context.toLocaleString()} tokens`);
    box.append(h('p.say', 'What the model taught the app about itself: ' + bits.join(' · ') + '.'),
      h('div.btnrow', h('button.btn.quiet.small', { onclick: () => { set({ learned: undefined }, { redraw: true }); toast('Forgotten — the next request asks afresh.'); } }, 'Forget what it taught')),
      quiet('Forget what it taught: the next request asks with everything you set, as if for the first time.'));
  }

  /* ---- test, let go */
  const result = h('p.say' + (c.tested ? (c.tested.ok ? '.good' : '.bad') : ''), c.tested ? `Tested ${timeAgo(c.tested.at)}: ${c.tested.words}` : '');
  const testBtn = h('button.btn.primary.small', { onclick: async () => {
    testBtn.disabled = true; testBtn.textContent = 'Listening for an answer…';
    landTyping();
    await store.flush('house', 'house');
    const out = await tryConnection(now());
    testBtn.disabled = false; testBtn.textContent = 'Test';
    result.className = 'say ' + (out.ok ? 'good' : 'bad');
    result.textContent = out.words;
    set({ tested: { at: Date.now(), ok: out.ok, words: out.words } });
    toast(out.ok ? `“${connName(c)}” answered — the connection works.` : 'No answer came back — the address, key or model may be off.');
  } }, 'Test');
  basicActions.append(h('div.btnrow', testBtn), quiet('Check that this connection answers with the model and settings above.'), result);
  box.append(h('div.btnrow',
    h('button.btn.danger.small', { title: 'Removes this connection and its key; the parts it does go to the writer, said before and after.', onclick: async () => {
      /* the parts it does, and who does them after it — said before he says yes, and once it is gone (Cozy Tavern M301: never resolved silently) */
      const parts = partsOf(house(), c.id);
      const rest = (house().connections || []).filter((x) => x.id !== c.id);
      const heir = parts.includes('writer') ? rest[0] : connFor(house(), 'writer');
      const after = !parts.length ? '' : heir
        ? ` It is ${partsWords(parts)} now — ${parts.length > 1 ? 'they go' : 'that goes'} to “${connName(heir)}”${parts.includes('writer') ? ', the first connection you made' : ', the writer'}.`
        : ` It is ${partsWords(parts)} now — with no other connection, nothing will write until you add one.`;
      if (!(await confirmIt(`Let go of “${connName(c)}”?`, `The key on this phone goes with it. Your books are not touched.${after}`, 'Let go', { danger: true }))) return;
      changeHouse((hs) => {
        hs.connections = (hs.connections || []).filter((x) => x.id !== c.id);
        for (const k of Object.keys(hs.roles || {})) if (hs.roles[k] === c.id) delete hs.roles[k];
        if (!hs.roles.writer && hs.connections[0]) hs.roles.writer = hs.connections[0].id;
      }, { now: true });
      editingId = null;
      draw('connections');
      /* who does each part now, from the house as it is */
      const now = house();
      const by = new Map();
      for (const p of parts) { const k = holderOf(now, p); const name = k ? connName(k) : ''; by.set(name, [...(by.get(name) || []), p]); }
      const said = [...by.entries()].map(([name, ps]) => (name ? `${partsWords(ps)} ${ps.length > 1 ? 'are' : 'is'} “${name}” now` : `nothing does ${partsWords(ps)} now — add a connection`)).join('; ');
      toast(said ? `“${connName(c)}” is gone — ${said.charAt(0).toLowerCase() + said.slice(1)}.` : `“${connName(c)}” is gone.`, 6000);
    } }, 'Let go')),
    quiet('Let go removes this connection and its key. You’ll see who takes over its parts before anything changes.'));
  return box;
}

/* The prefill, as Cozy Tavern carries it: as written (a started reply, or a
 * thinking seed) or structured (the model writes the opening itself, held to
 * it by the answer's pattern), its ready-made templates, the words it can
 * never write, the two field names, and its own Test it. */
function prefillPart(c, { set, now, quiet, tick }) {
  const part = h('div.prefillpart');
  const ta = h('textarea', { rows: 3, spellcheck: 'false', placeholder: 'The reply opens with these words already written…' });
  ta.value = c.prefill || '';
  const hint = h('p.say');
  const sayHint = () => { const d = describePrefill({ ...now(), prefill: ta.value }); hint.textContent = d || 'Empty: nothing is started for it.'; };
  ta.addEventListener('input', typing(() => { set({ prefill: ta.value || undefined }); sayHint(); }, 500));
  part.append(field('Start the reply for it (optional — the prefill)', ta),
    quiet('This opening and thinking seed are shared by the writer and narrator using this connection. For separate voices, use their own boxes in Your instructions, including Words in the storyteller’s own voice.'),
    quiet('Open it with <think> and it seeds the model’s THINKING instead of its reply — <think>Right, where were we. Let me look at what Bruce just asked for… — the model carries the thought on in your words, then writes the page itself. Anything after </think> starts the reply, as before.'),
    hint);
  sayHint();

  const offered = structuredOffered(c);
  const mode = h('select');
  for (const [v, l] of [['', 'As written — a started reply, or a thinking seed'], ['structured', 'Structured — the model writes the opening itself']]) mode.append(h('option', { value: v, selected: (c.prefillMode || '') === v }, l));
  mode.addEventListener('change', () => set({ prefillMode: mode.value || undefined }, { redraw: true }));
  part.append(h('div.fieldrow',
    field('How it is sent', mode),
    field('At least this many characters after it', (() => {
      const inp = h('input', { type: 'text', inputmode: 'numeric', placeholder: String(MIN_AFTER_DEFAULT), value: Number.isFinite(c.prefillMinChars) ? String(c.prefillMinChars) : '' });
      inp.addEventListener('input', typing(() => { const n = Number(inp.value.trim()); set({ prefillMinChars: inp.value.trim() && Number.isFinite(n) && n >= 1 ? Math.min(10000, Math.round(n)) : undefined }); }, 400));
      return inp;
    })())));
  const structured = c.prefillMode === 'structured';
  if (structured) {
    if (!offered) part.append(quiet('This address takes no JSON-schema answers (Claude, DeepSeek, Kimi, Z.ai and a few others), so here the prefill goes as written.'));
    /* the ready-made templates */
    const tpl = h('select');
    tpl.append(h('option', { value: '' }, 'Choose one…'));
    for (const p of STRUCTURED_PRESETS) tpl.append(h('option', { value: p.id }, p.name));
    const words = h('input', { type: 'text', maxlength: 600, autocomplete: 'off', spellcheck: 'true', placeholder: 'e.g. Yuhuu Hulk is here Bruce story is good' });
    const wordsLabel = h('span', 'Your words');
    const guide = h('p.say.quiet', { hidden: true });
    const example = h('pre.preset-example', { hidden: true });
    const saidPut = h('span.say.quiet', { hidden: true });
    const showTpl = () => {
      const p = STRUCTURED_PRESETS.find((x) => x.id === tpl.value);
      wordsLabel.textContent = !p ? 'Your words' : p.needsWords ? 'Your words' : (p.build('x') === p.build('') ? 'Your words (not used by this one)' : 'Your words (optional)');
      guide.hidden = !p; example.hidden = !p;
      if (p) { guide.textContent = p.guide + ' A page will look like this:'; example.textContent = p.example(presetWords(words.value)); }
    };
    tpl.addEventListener('change', showTpl);
    words.addEventListener('input', showTpl);
    part.append(field('Ready-made template', tpl), h('label.field', wordsLabel, words), guide, example,
      h('div.btnrow', h('button.btn.small', { onclick: () => {
        if (!tpl.value) { saidPut.hidden = false; saidPut.textContent = 'Choose a template first.'; return; }
        const out = fillPreset(tpl.value, words.value);
        if (out.error) { saidPut.hidden = false; saidPut.textContent = out.error; return; }
        ta.value = out.prefill;
        set({ prefill: out.prefill, prefillMode: 'structured' });
        sayHint();
        saidPut.hidden = false; saidPut.textContent = 'Written into the prefill box — it is kept as it stands.';
      } }, 'Put it in the prefill box'), saidPut));
    /* the words it can never write */
    const banned = h('textarea', { rows: 2, spellcheck: 'false', placeholder: 'ozone\ntapestry' });
    banned.value = c.prefillBanned || '';
    const banNote = h('p.say.quiet');
    const sayBan = () => {
      const b = bannedPattern(banned.value);
      banNote.textContent = !b.words.length ? '' : b.tooBig ? `Too many for one exact pattern (${b.words.length}) — the list would not be sent. Keep it to the few that matter most.`
        : `${b.words.length} word${b.words.length === 1 ? '' : 's'} — it cannot write ${b.words.length === 1 ? 'it' : 'any of them'} after your opening (any capitals). Claude routes on OpenRouter take no such list.`;
    };
    banned.addEventListener('input', typing(() => { set({ prefillBanned: banned.value.trim() ? banned.value : undefined }); sayBan(); }, 500));
    sayBan();
    part.append(field('Words it can never write after your opening (structured only — one per line)', banned), banNote,
      quiet('Structured: the reply must begin with your words, and the model writes them itself — it is not handed them, so it cannot refuse at the first word or ignore them. Only addresses that take JSON-schema answers (OpenAI, and on OpenRouter the models that list structured outputs) can; one that refuses is remembered for its model and gets the prefill as written. A <think>…</think> at the start is a thinking block the model must write itself — it goes in the thinking box, beside the model’s own thinking. Inside your words: [[keep]] hides everything before it; [[w:2-5]] words, [[opt:a|b]] one of these, [[line]], [[lines:2-4]], [[num]], [[number:1-100]], [[emotion]], [[name]], [[action]], [[thought]], [[re:…]], and [[end]] to end the reply there.'));
  }
  part.append(
    tick('prefillKeepThinking', 'Keep the thinking open when a seed is sent', c.prefillKeepThinking !== false, (on) => set({ prefillKeepThinking: on ? undefined : false })),
    quiet('On: a thinking seed sent with Thinking at Off asks for the lightest thinking, so the seed has a channel to land in.'),
    tick('prefillForWorkers', 'Workers riding this connection get it too', c.prefillForWorkers === true, (on) => set({ prefillForWorkers: on ? true : undefined })),
    quiet('Off (usual): the helper and the checker on this connection get no prefill — their answers are JSON, which a started reply can break. On: they get it as written.'));
  const auto = prefillFields({ ...c, prefillFlagField: '', prefillReasoningField: '' });
  const names = h('details.quiet-details', h('summary', 'The two field names (only if your address needs others)'),
    h('div.fieldrow',
      field('Continuation flag', (() => { const i = h('input', { type: 'text', maxlength: 40, autocomplete: 'off', spellcheck: 'false', placeholder: auto.flag || 'none', value: c.prefillFlagField || '' }); i.addEventListener('input', typing(() => set({ prefillFlagField: i.value.trim() || undefined }), 400)); return i; })()),
      field('Thinking field', (() => { const i = h('input', { type: 'text', maxlength: 40, autocomplete: 'off', spellcheck: 'false', placeholder: auto.reasoning || 'none', value: c.prefillReasoningField || '' }); i.addEventListener('input', typing(() => set({ prefillReasoningField: i.value.trim() || undefined }), 400)); return i; })())),
    quiet('Empty uses this address’s own (shown greyed); type none to send no such field.'));
  part.append(names);
  const verdict = h('p.say' + (c.prefillTested ? (c.prefillTested.ok ? '.good' : '.bad') : ''), c.prefillTested ? `Tested ${timeAgo(c.prefillTested.at)}: ${c.prefillTested.words}` : '');
  const testIt = h('button.btn.small', { onclick: async () => {
    testIt.disabled = true;
    verdict.className = 'say'; verdict.textContent = 'Asking, just a whisper of a request…';
    landTyping();
    await store.flush('house', 'house');
    const live = now();
    const out = await testPrefill(live);
    testIt.disabled = false;
    verdict.className = 'say ' + (out.ok ? 'good' : 'bad');
    verdict.textContent = out.words;
    const patch = { prefillTested: { at: Date.now(), ok: out.ok, words: out.words } };
    /* a fresh yes lifts an old refusal; a refusal it taught is kept on the connection */
    if (out.clearDown && live.learned) patch.learned = { ...live.learned, prefillDownAt: null, structuredDownAt: null };
    else if (!out.ok && live.learned) patch.learned = live.learned;
    set(patch);
    toast(out.ok ? 'The prefill took.' : 'The prefill wouldn’t take — the words above say why.');
  } }, 'Test it');
  part.append(h('div.btnrow', testIt), quiet('Test it sends a tiny exchange with the prefill exactly as a page sends it — the thinking dial, the seed, the two field names; set to Structured, the very schema a page carries — and reads what came back.'), verdict);
  return part;
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
  checkSel.addEventListener('change', () => {
    changeHouse((x) => {
      x.roles = x.roles || {};
      /* a checker chosen after Nobody begins now: what is written from now on goes first, writing from before after it (checker.js checksFromOf, nextBatch) */
      /* (with Super automatic checking for Nobody already, from when it was switched on: never later — 2.12.35, the pages
       * written since and not checked yet were dropped to Check this chapter) */
      if (x.roles.checker === 'off' && checkSel.value !== 'off') { const all = superFrom(x); x.checksFrom = all === null ? Date.now() : Math.min(Date.now(), all); }
      if (checkSel.value) x.roles.checker = checkSel.value; else delete x.roles.checker;
    }, { now: true });
    /* (with Super automatic on, Nobody is said to check all the same: the line under it follows) */
    if (superOn(house())) draw();
  });
  g.body.classList.add('settings-roles');
  g.body.append(
    superField(hs),
    h('p.settings-intro', 'A small circle of help for your book. One connection can do every part, or you can choose a different one for each.'),
    roleSel('writer', 'The writer', 'Writes the pages, the other takes, the rewrites, and narrates the scenes you play. The writer button under the page switches it too.', false),
    roleSel('partner', 'The partner', 'Talks the book over with you.', true),
    roleSel('helper', 'The helper', 'Keeps the notes and the chapter summaries, quietly, after each change. A quick, inexpensive model is perfect here.', true),
    field('The checker', checkSel, `Reads each passage once it’s finished — grammar, wording that sounds machine-made, your words to avoid, slips against the book — and puts what it would change behind the bubble on the page, for you to apply or leave. It checks every page of the book by itself, the newest first — words brought in from a file only when you ask. A quick, inexpensive model is perfect here.${superOn(hs) && curCheck === 'off' ? ' With Super automatic on, the helper’s connection checks even though this says Nobody.' : ''}`),
    judgeField(hs),
    ...autoFields(hs),
    ideasField(hs));
  return g;
}

/* ------------------------------------------------------------ usage and cost */
/* Ideas beside the box: on or off, and how many */
function ideasField(hs) {
  const j = hs.ideas || {};
  const on = h('input', { type: 'checkbox', checked: j.on !== false });
  on.addEventListener('change', () => changeHouse((x) => { x.ideas = { ...(x.ideas || {}), on: on.checked }; }, { now: true }));
  const sel = h('select');
  for (const n of [1, 2, 3, 4, 5]) sel.append(h('option', { value: String(n), selected: (Number(j.count) || 4) === n }, n === 1 ? 'One' : `${n}`));
  sel.addEventListener('change', () => changeHouse((x) => { x.ideas = { ...(x.ideas || {}), count: Number(sel.value) }; }, { now: true }));
  return h('div.field',
    h('label.toggle', on, h('span', 'Ideas beside the box')),
    h('em', 'An Ideas chip under the page: a few premises for what happens next, from your partner’s connection, with the whole book — a tap puts one in the box. Off: the chip is gone.'),
    field('How many ideas', sel));
}

/* SUPER AUTOMATIC (auto.js): one switch for everything that can happen by itself — his word, 2.12.28: "one
 * universal button to make everything automatic … except the rewrite or the score judge" */
function superField(hs) {
  const on = h('input', { type: 'checkbox', checked: superOn(hs) });
  on.addEventListener('change', () => {
    changeHouse((x) => { x.superAuto = on.checked ? { on: true, from: Date.now() } : { on: false }; }, { now: true });
    /* on: the checker looks at once, and the helper of the book open reads now (What it's about and How it reads kept from the book) */
    if (on.checked) { nudgeChecker(); nudgeHelper(); }
    draw();
  });
  return h('div.field.superauto',
    h('label.toggle', on, h('span', 'Super automatic')),
    h('em', 'Everything that can happen by itself does — you write the premises and read, and play a scene now and then. In every book the helper keeps What it’s about and How it reads, the bibliography fills itself from the pages, and Smart recall brings in what a page needs that nothing on it names. The writer ends a chapter where the story would, and your next page goes in the next one. The checker’s fixes go in by themselves on every page it checks — and it checks even with Nobody chosen. Your partner’s changes land at once, with Undo. Your notes are kept as always — your own cards too: what the book adds goes beside your words, and the notes’ check puts right what the book contradicts. Never by itself: a passage under your mark written again (its own switch, below) and your mark. Off: every switch is as you set it; what was written meanwhile stays.'));
}

/* what happens by itself: the checker's fixes, and a passage under his mark
 * written again — each from when he switches it on (checker.js autoAfter) */
function autoFields(hs) {
  const row = (key, label, say) => {
    /* the checker's fixes go in by themselves with Super automatic on, whatever this says (checker.js autoOf) */
    const ruled = key === 'autoFix' && superOn(hs);
    const on = h('input', { type: 'checkbox', checked: ruled || Boolean(hs[key] && hs[key].on), disabled: ruled });
    on.addEventListener('change', () => {
      changeHouse((x) => { x[key] = on.checked ? { on: true, from: Date.now() } : { on: false }; }, { now: true });
      /* switched on: the checker looks at once, and what waits goes in (his report, 2.12.2: on, and nothing happened) */
      if (on.checked) nudgeChecker();
    });
    return h('div.field', h('label.toggle', on, h('span', label)), h('em', ruled ? `On with Super automatic. ${say}` : say));
  };
  return [
    row('autoFix', 'Apply the checker’s fixes by themselves',
      'Every fix with words to put in goes in on the page itself as soon as it’s found — grammar, clarity, wording — on every passage checked, your own words too, from the moment you switch it on. ⋯ → Put back the words before takes a fix back out, and words you put back yourself stay as you put them. A sentence to write again (a word on your list, stock wording) is written again by itself, on the page too — twice at most for a passage, each one a call to the writer. A slip against the book’s notes, a rewrite of a large stretch, and more than a small change at once wait behind the bubble for you, each saying why — and so do words you brought in from a file. A new version is only ever a rewrite or another take.'),
    row('autoLift', 'Write a passage under your mark again by itself',
      'When the judge puts a passage under your mark, the writer writes it again toward it with what the judge said it needs — twice at most; then the best-graded version stays on show, every version one arrow away. Its fixes wait until then. Anything you ask the writer meanwhile goes first, Leave it on its grade stops it, and a version you put back on show yourself stays as you chose it. Your own words too. For passages written after you switch it on.'),
  ];
}

/* the judge (in the checker's reading): on or off, and his mark */
function judgeField(hs) {
  const j = hs.judge || {};
  const on = h('input', { type: 'checkbox', checked: j.on !== false });
  on.addEventListener('change', () => changeHouse((x) => { x.judge = { ...(x.judge || {}), on: on.checked }; }, { now: true }));
  const mark = h('input', { type: 'text', inputmode: 'decimal', value: Number.isFinite(Number(j.target)) && j.target ? String(j.target) : '', placeholder: '9', style: { maxWidth: '90px' } });
  /* "8", "8,5", "8/10", "8 of 10", "80%" — one that is not a mark out of ten is said, and the mark he had stays (util.js markTyped) */
  const markSaid = h('small.badnum', { hidden: true }, 'A mark from 1 to 10, like 8 or 8.5 — this one is not kept.');
  mark.addEventListener('input', typing(() => {
    const raw = mark.value.trim();
    const n = markTyped(raw);
    const ok = !raw || (Number.isFinite(n) && n >= 1 && n <= 10);
    markSaid.hidden = ok;
    if (ok) mark.removeAttribute('aria-invalid'); else { mark.setAttribute('aria-invalid', 'true'); return; }
    changeHouse((x) => { x.judge = { ...(x.judge || {}) }; if (raw) x.judge.target = n; else delete x.judge.target; });
  }, 400));
  return h('div.field',
    h('label.toggle', on, h('span', 'The judge grades each passage')),
    h('em', 'In the checker’s own reading, ten checks a passage passes or fails — Opening, True to the book, Shown, Pacing, Specific, Fresh, Sentences, People, Moves, Ending — each one it fails named with the words that fail it; its grade is the number passed. A passage under your mark comes behind the bubble with fixes that lift it and Write it again toward your mark — nothing changes until you say, unless you switch on the two below. Two versions of one passage by two writers are read head to head. Its grades show which writer writes best.'),
    field('Your mark', h('span.numbox', mark, markSaid), 'Under this, a passage is offered to be lifted (empty: 9 — one check failed at most).'));
}

/* Every call to a model — the writer, the helper, the checker, the partner,
 * the narrator — counted on the phone as it lands (Cozy Tavern's meter), by
 * connection and model; the money from the prices set on each connection. */

function usageGroup(hs) {
  const g = group('Usage and cost', { key: 'set.usage' });
  const box = h('div', h('p.say', 'Looking…'));
  g.body.append(h('p.say', 'Every call to a model — the writer, the helper, the checker, your partner, the narrator — counted as it lands. Set each connection’s prices in Connections to see the money.'), box,
    h('div.btnrow', h('button.btn.quiet.small', { title: 'The counts start again from nothing; your books and connections are not touched.', onclick: async () => {
      if (!(await confirmIt('Clear the counts?', 'Usage and cost starts again from nothing. Your books and connections are not touched.', 'Clear them', { danger: true }))) return;
      await store.api('POST', '/api/usage/clear', { body: {} }).catch(() => {});
      fillUsage(box, house());
    } }, 'Clear the counts')));
  fillUsage(box, hs);
  return g;
}

/* Cozy Tavern's Usage and cost (M457, M510): one period at a time — Today,
 * Last 7 days, Last 30 days — as a small table, each connection and model a
 * row with the total; what it comes to per day, week and month at the rate so
 * far; and the busiest day per model, folded until he opens it. */
const tok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n || 0)));
const money = (c) => (c === null || c === undefined ? '—' : '$' + (c >= 100 ? c.toFixed(0) : c >= 1 ? c.toFixed(2) : c.toFixed(3)));
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let usagePeriod = 'today';
async function fillUsage(box, hs) {
  const { status, data } = await store.api('GET', '/api/usage').catch(() => ({ status: 0 }));
  box.textContent = '';
  if (status !== 200 || !data) { box.append(h('p.say', 'The counts could not be read just now — the phone did not answer.')); return; }
  const days = data.days || {};
  const keys = Object.keys(days).sort();
  if (!keys.length) { box.append(h('p.say', 'Nothing counted yet — every call from now on is.')); return; }
  const now = new Date();
  const since = (n) => { const d = new Date(now); d.setDate(d.getDate() - (n - 1)); return dayKey(d); };
  const conns = hs.connections || [];
  const connOf = (key) => { const url = key.slice(0, key.lastIndexOf('|')); const model = key.slice(key.lastIndexOf('|') + 1); return conns.find((c) => String(c.url || '') === url && String(c.model || '') === model) || null; };
  const sum = (from) => {
    const rows = new Map();
    for (const day of keys) {
      if (from && day < from) continue;
      for (const [key, r] of Object.entries(days[day] || {})) rows.set(key, addRow(rows.get(key) || { calls: 0, in: 0, out: 0, cached: 0, cacheWrite: 0, estimated: 0 }, r || {}));
    }
    const list = [...rows.entries()].map(([key, r]) => { const c = connOf(key); return { ...r, name: c ? connName(c) : 'A connection no longer here', model: key.slice(key.lastIndexOf('|') + 1), cost: costOf(r, c) }; })
      .sort((a, b) => (b.in + b.out) - (a.in + a.out));
    const total = list.reduce((t, r) => ({ calls: t.calls + r.calls, in: t.in + r.in, out: t.out + r.out, cost: r.cost === null ? t.cost : (t.cost || 0) + r.cost, unpriced: t.unpriced || r.cost === null }), { calls: 0, in: 0, out: 0, cost: null, unpriced: false });
    return { rows: list, total };
  };
  const table = (p) => {
    const t = h('table.usage-table', h('tr', h('th', 'Connection · model'), h('th', 'In'), h('th', 'Out'), h('th', 'Cost')));
    if (!p.rows.length) t.append(h('tr', h('td.quiet', { colSpan: 4 }, 'No calls in this time.')));
    for (const r of p.rows) t.append(h('tr', h('td', `${r.name} · ${r.model}${r.estimated ? ' ≈' : ''}`), h('td.num', `${tok(r.in)}${r.cached ? ` (${tok(r.cached)} cached)` : ''}`), h('td.num', tok(r.out)), h('td.num', r.cost === null ? 'no price' : money(r.cost))));
    if (p.rows.length) t.append(h('tr.usage-total', h('td', `Total (${plural(p.total.calls, 'call')})`), h('td.num', tok(p.total.in)), h('td.num', tok(p.total.out)), h('td.num', `${money(p.total.cost)}${p.total.unpriced && p.total.cost !== null ? ' +' : ''}`)));
    return t;
  };
  const periods = [['today', 'Today', since(1)], ['week', 'Last 7 days', since(7)], ['month', 'Last 30 days', since(30)]];
  const pick = h('div.usage-periods');
  const shown = h('div.usage-shown');
  const choose = (key) => {
    usagePeriod = key;
    for (const b of pick.querySelectorAll('button')) b.classList.toggle('current', b.dataset.period === key);
    shown.textContent = '';
    shown.append(table(sum(periods.find((x) => x[0] === key)[2])));
  };
  for (const [key, words] of periods) pick.append(h('button.usage-period', { type: 'button', 'data-period': key, onclick: () => choose(key) }, words));
  box.append(pick, shown);
  choose(usagePeriod);
  /* at the rate so far, over the days since the first one counted */
  const first = new Date(`${keys[0]}T00:00:00`);
  const span = Math.max(1, Math.round((new Date(`${dayKey(now)}T00:00:00`) - first) / 86400000) + 1);
  const all = sum(null).total;
  const per = (n) => `${tok((all.in / span) * n)} in · ${tok((all.out / span) * n)} out · ${all.cost === null ? 'set prices to see the cost' : money((all.cost / span) * n) + (all.unpriced ? ' (some connections have no price)' : '')}`;
  box.append(h('div.usage-averages', h('p.stack-label', `At the rate so far (over ${plural(span, 'day')})`),
    ...[['Per day', 1], ['Per week', 7], ['Per month', 30]].map(([w, n]) => h('div.usage-avg-row', h('span', w), h('span.num', per(n))))));
  /* the busiest day per model — folded until he opens it */
  const busiest = new Map();
  for (const day of keys) for (const [key, r] of Object.entries(days[day] || {})) {
    const b = busiest.get(key);
    const size = (Number(r.in) || 0) + (Number(r.out) || 0);
    if (!b || size > b.size) busiest.set(key, { day, size, r: addRow({ calls: 0, in: 0, out: 0, cached: 0, cacheWrite: 0, estimated: 0 }, r || {}) });
  }
  const fold = h('details.usage-busiest', h('summary.stack-label', 'Your busiest day, per model — and a month of days like it'));
  try { fold.open = localStorage.getItem('cozynovel.usageBusiest') === 'open'; } catch (_) { /* a private window */ }
  fold.addEventListener('toggle', () => { try { localStorage.setItem('cozynovel.usageBusiest', fold.open ? 'open' : 'closed'); } catch (_) { /* fine */ } });
  const bt = h('table.usage-table', h('tr', h('th', 'Connection · model'), h('th', 'Busiest day'), h('th', 'That day'), h('th', 'A month like it')));
  for (const [key, b] of busiest) {
    const c = connOf(key);
    const cost = costOf(b.r, c);
    const when = new Date(`${b.day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    bt.append(h('tr', h('td', `${c ? connName(c) : 'A connection no longer here'} · ${key.slice(key.lastIndexOf('|') + 1)}`), h('td', when),
      h('td.num', `${tok(b.r.in)} in · ${tok(b.r.out)} out · ${cost === null ? 'no price' : money(cost)}`),
      h('td.num', `${tok(b.r.in * 30)} in · ${tok(b.r.out * 30)} out · ${cost === null ? 'no price' : money(cost * 30)}`)));
  }
  fold.append(bt);
  box.append(fold, h('p.say.quiet', '≈ where a provider gave no count, the app counted the tokens itself.'));
}

/* ------------------------------------------------------------ his words */

/* Back to the default over words of his: go back, or copy his first (to
 * paste anywhere) and go back — Undo, right after, puts his back either way */
function backChoice(words) {
  return askChoice('Back to the default?', `${words} Copy mine first keeps a copy of yours to paste anywhere; Undo, right after, puts them back.`, [
    { label: 'Back to the default', value: 'back', primary: true },
    { label: 'Copy mine first', value: 'copy' },
    { label: 'Not now', value: false, quiet: true },
  ]);
}

/* the starting words of each box, for Back to the default */
const STARTING = { system: DEFAULT_WRITING, narrator: DEFAULT_NARRATOR, partner: DEFAULT_PARTNER };

function wordsGroup(hs) {
  const ins = hs.instructions || {};
  const g = group('Your instructions', { key: 'set.words' });
  const box = (key, rows, placeholder) => {
    const ta = h('textarea', { rows, placeholder });
    /* a box he never touched shows the words that are sent for it: its starting words */
    ta.value = typeof ins[key] === 'string' ? ins[key] : (STARTING[key] || '');
    ta.addEventListener('input', typing(() => changeHouse((x) => { x.instructions = x.instructions || {}; x.instructions[key] = ta.value; }), 500));
    return ta;
  };
  /* every box with starting words can have them back — and his back again with Undo */
  const back = (ta, key) => h('div.btnrow', h('button.btn.quiet.small', { title: 'The starting words come back in place of the words in the box — with Undo.', onclick: async () => {
    const mine = ta.value;
    let how = 'back';
    if (mine.trim() && mine !== STARTING[key]) {
      how = await backChoice('The words in the box go, and the starting words come back.');
      if (!how) return;
      if (how === 'copy' && !(await copyText(mine))) { toast('Your words could not be copied, so they stay in the box.'); return; }
    }
    /* kept on the phone at once, not after the typing pause */
    const put = (v) => { ta.value = v; changeHouse((x) => { x.instructions = x.instructions || {}; x.instructions[key] = v; }, { now: true }); ta.dispatchEvent(new Event('input')); };
    put(STARTING[key]);
    if (mine === STARTING[key]) { toast('The starting words are back.'); return; }
    undoToast(how === 'copy' ? 'Yours are copied, and the starting words are back.' : 'The starting words are back.', () => put(mine));
  } }, 'Back to the default'));
  const choose = (key, options, cur, hint, label) => {
    const sel = h('select');
    for (const [v, l] of options) sel.append(h('option', { value: v, selected: (cur || options[0][0]) === v }, l));
    sel.addEventListener('change', () => changeHouse((x) => { if (sel.value === options[0][0]) delete x[key]; else x[key] = sel.value; }, { now: true }));
    return field(label, sel, hint);
  };
  const name = h('input', { type: 'text', value: (hs.you && hs.you.name) || '', placeholder: 'e.g. Bruce' });
  name.addEventListener('input', typing(() => changeHouse((x) => { x.you = { ...(x.you || {}), name: name.value.trim() }; }), 500));
  const sys = box('system', 9, 'How you like your stories written…');
  sys.classList.add('tall');
  const narr = box('narrator', 7, 'How the narrator tells the scenes you play…');
  const partner = box('partner', 5, 'A way of talking, or a persona, for your writing partner…');
  g.body.append(
    presetsField(hs),
    field('Your name', name, 'How your notes and the helper speak of you (“Bruce here.”, “a novel Bruce is writing”).'),
    field('How you like it written', sys, 'Sent first, word for word, to the writer — like the main prompt of a SillyTavern preset. Who the writer is, your voice, your rules, a persona if you like. The novel craft rides right after it (Modules, below).'),
    back(sys, 'system'),
    tellerField(hs, 'write', sys),
    field('How the narrator tells scenes', narr, 'Sent first, word for word, when you play a scene — the narrator’s own voice and rules, a persona if you like. The scene craft rides right after it. Empty: nothing of yours is sent.'),
    back(narr, 'narrator'),
    tellerField(hs, 'play', narr),
    field('How the partner talks', partner, 'Sent first, word for word, to your partner. Empty: nothing of yours is sent.'),
    back(partner, 'partner'),
    tellerField(hs, 'partner', partner),
    voiceCheckField(hs),
    modulesField(hs),
    field('A note at the end — the book', box('late', 3, 'Optional. Rides after your request, like post-history instructions.'), 'Sent after your request each time the writer writes the book: a new page, Another take, Rewrite, Go on, a scene turned into prose. Empty, or Send it off: nothing is sent.'),
    sendIt('lateOff', ins.lateOff, 'Send it', 'Off: your words stay in the box, and nothing is sent until you switch it back on.'),
    lateAs('lateAs', ins.lateAs),
    field('A note at the end — scenes', box('lateNarrator', 3, 'Optional. Rides after your move, like post-history instructions.'), 'Sent after your move each time the narrator tells a scene you play. Empty, or Send it off: nothing is sent.'),
    sendIt('lateNarratorOff', ins.lateNarratorOff, 'Send it', 'Off: your words stay in the box, and nothing is sent until you switch it back on.'),
    lateAs('lateNarratorAs', ins.lateNarratorAs),
    ownWordsField(hs),
    field('Words to avoid', box('avoid', 4, 'One to a line — for example:\na testament to\nshivers down her spine'), 'Words and phrases you never want in the book. The writer, the narrator and your partner are told them, after your own words; the checker marks any that slip through, with a way to write them again. Empty: nothing is sent.'),
    choose('notesAs', [
      ['system', 'The system message (the default)'],
      ['user', 'A user message — your notes'],
      ['assistant', 'An assistant message — a notebook'],
    ], hs.notesAs, 'What the book is about, its chapters and its notes, after your instructions — for the writer, the narrator and the partner alike, as in Cozy Tavern. As your notes they open “Bruce here. Here’s where our book stands…”; as a notebook they are the writer’s own (“My notebook for…”), before what you ask.', 'The book and its notes ride as'),
    superOn(hs)
      ? field('Your partner’s changes land', h('p.quiet', 'At once, with Undo — Super automatic is on (Settings → Who does what).'), 'When your partner changes a passage, a chapter’s name, the book’s words or a card in the notes: each change shows under its answer, with its Undo.')
      : choose('partnerApplies', [
        ['now', 'At once, with Undo (the default)'],
        ['wait', 'When I press Apply'],
      ], hs.partnerApplies, 'When your partner changes a passage, a chapter’s name, the book’s words or a card in the notes: each change shows under its answer, with its Undo.', 'Your partner’s changes land'));
  return g;
}

/* ------------------------------------------------------- who is telling */
/* Cozy Tavern's The frame, beside each box (teller.js): Who is telling, the Grounding phrase, The teller thinks as,
 * Say it again at the end — folded until he opens it, what is set said on its line */
const TELLER_WHO = { write: 'the writer', play: 'the narrator', partner: 'your partner' };
function tellerField(hs, purpose, boxTa) {
  const t = tellerOf(hs, purpose);
  const save = (patch) => changeHouse((x) => {
    x.tellers = x.tellers && typeof x.tellers === 'object' ? x.tellers : {};
    const next = cleanTeller({ ...cleanTeller(x.tellers[purpose]), ...patch });
    if (!next.name && !next.phrase && next.person === 'follow' && !next.echo) delete x.tellers[purpose]; else x.tellers[purpose] = next;
  });
  const name = h('input', { type: 'text', maxlength: '40', autocomplete: 'off', spellcheck: 'false', value: t.name, placeholder: 'e.g. Tony Stark — empty for no name' });
  const phrase = h('input', { type: 'text', maxlength: '80', autocomplete: 'off', spellcheck: 'false', value: t.phrase, placeholder: 'e.g. Autobots, roll out! — empty for none' });
  const person = h('select');
  for (const [v, l] of [['follow', 'Follow the box above'], ['first', 'I — “I am Tony Stark. I write Bruce’s novel…”'], ['second', 'You — “You are Tony Stark. You write Bruce’s novel…”']]) person.append(h('option', { value: v, selected: t.person === v }, l));
  const echo = h('input', { type: 'checkbox', checked: t.echo });
  const personNote = h('em');
  const line = h('small.tellerline');
  const said = () => {
    const read = framePerson(boxTa.value) === 'first' ? 'I' : 'You';
    const now = person.value === 'follow' ? (read === 'I' ? 'first' : 'second') : person.value;
    personNote.textContent = `${person.value === 'follow' ? `The box above reads as “${read}” — so the app’s own rules are written that way too. ` : `Set by hand (the box above reads as “${read}”). `}${now === 'first'
      ? 'The rules and the lines between your words and the book become the teller’s own notes to itself, and you are “you” in them: “you bring me premises… I write the novel”.'
      : 'The rules speak to the teller: “you write the novel… your craft”.'} What you say to it in your turn — the request, your notes — always says “you”, the way you would to a friend.`;
    const bits = [name.value.trim() || 'nobody named', phrase.value.trim() ? `opens with “${phrase.value.trim()}”` : '', now === 'first' ? 'thinks as I' : '', echo.checked ? 'said again at the end' : ''].filter(Boolean);
    line.textContent = bits.join(' · ');
  };
  name.addEventListener('input', typing(() => save({ name: name.value }), 500));
  name.addEventListener('input', said);
  phrase.addEventListener('input', typing(() => save({ phrase: phrase.value }), 500));
  phrase.addEventListener('input', said);
  person.addEventListener('change', () => { said(); save({ person: person.value }); });
  echo.addEventListener('change', () => { said(); save({ echo: echo.checked }); });
  boxTa.addEventListener('input', said);
  said();
  return h('details.tellerbox', { 'data-teller': purpose },
    h('summary', h('span', 'Who is telling'), line),
    field('Who is telling', name, `With a name here, everything the app says to ${TELLER_WHO[purpose]} in your turn greets it by that name — “Tony — pick Chapter Two up right where it stops…”, “Tony — Bruce here.” — and {{char}} in your words is that name. It only ever uses the name; who they are is yours to say in the box above.`),
    field('Grounding phrase', phrase, 'The first words of its thinking, every time. A teller that opens its own thinking in character stays in character through it, instead of sliding into an assistant’s voice on the turns that are mostly instruction. It is woven into the words it is sent — near the top, and again a third of the way down — and planted as the start of the thinking itself where the model takes that (DeepSeek and Kimi with thinking on; never over a prefill of your own). Empty: nothing is asked and nothing is sent.'),
    field('The teller thinks as', person, ''),
    personNote,
    h('div.field.switchrow', h('label.toggle', echo, h('span', 'Say it again at the end')), h('em', 'The box above once more at the end of the request, just before the note at the end — the anchor against a long request’s fade.')));
}

/* READ MY STANDING WORDS FOR AN ASSISTANT’S VOICE (plainvoice.js, Cozy Tavern M359/M360): his own words read over,
 * with no model and nothing sent — the lines that name the machine, and the ones that read like a manual */
function voiceCheckField(hs) {
  const list = h('ul.voicefound', { hidden: true });
  const run = () => {
    landTyping();
    const now = house();
    const ins = now.instructions || {};
    const names = macroNames(now, 'write');
    const pieces = [
      { name: 'How you like it written', text: typeof ins.system === 'string' ? ins.system : STARTING.system },
      { name: 'How the narrator tells scenes', text: typeof ins.narrator === 'string' ? ins.narrator : STARTING.narrator },
      { name: 'How the partner talks', text: typeof ins.partner === 'string' ? ins.partner : STARTING.partner },
      { name: 'A note at the end — the book', text: ins.late || '' },
      { name: 'A note at the end — scenes', text: typeof ins.lateNarrator === 'string' ? ins.lateNarrator : (ins.late || '') },
      ...cleanOwn(now.ownWords).map((w) => ({ name: w.name.trim() || 'Words in the storyteller’s own voice', text: w.text })),
      ...listModules(now).map((m) => ({ name: m.name, text: m.text, mine: !m.builtin || Boolean(m.ownWords) })),
    ];
    const found = readStandingWords(pieces.map((p) => ({ ...p, text: withMacros(p.text, names) })));
    const { machine, manual, house: theirs } = groupFindings(found);
    list.textContent = '';
    list.hidden = false;
    const add = (words) => { const li = h('li', words); list.append(li); return li; };
    if (!machine.length && !manual.length) {
      add(theirs ? `Nothing in YOUR words sounds like an assistant. (${theirs} in the app’s own modules, which are spoken in your voice when they are sent — not yours to fix.)` : 'Nothing in your words sounds like an assistant.');
      return;
    }
    add(machine.length
      ? `${machine.length} ${machine.length === 1 ? 'line of YOURS names the machine — this is the one that breaks a teller’s voice:' : 'lines of YOURS name the machine — these are the ones that break a teller’s voice:'}`
      : 'Nothing of yours names the machine.');
    for (const f of machine.slice(0, 25)) add(`“${f.words.join('”, “')}” (${f.why}) — ${f.where}: ${f.line}`);
    if (machine.length > 25) add(`and ${machine.length - 25} more like it.`);
    if (manual.length) {
      add(`${manual.length} more read like a manual rather than a person (your call — words that instruct are allowed to sound like it):`);
      for (const f of manual.slice(0, 10)) add(`“${f.words.join('”, “')}” — ${f.where}: ${f.line}`);
      if (manual.length > 10) add(`and ${manual.length - 10} more of those.`);
    }
    if (theirs) add(`${theirs} more stand in the app’s own modules. Those are spoken in your voice when they are sent, and are not yours to fix.`);
    list.append(h('li', h('button.btn.quiet.small', { title: 'Copies the lines found, whole, to hand to whoever rewrites them.', onclick: async () => toast(await copyText(findingsText(found)) ? 'Copied.' : 'They could not be copied.') }, 'Copy these lines')));
  };
  return h('div.field',
    h('div.btnrow', h('button.btn.quiet.small.voicecheck', { title: 'Reads your boxes, your notes at the end, your modules and your words in the storyteller’s own voice for words that make a teller sound like an assistant — nothing is sent anywhere, and nothing is changed.', onclick: run }, 'Read my standing words for an assistant’s voice')),
    list);
}

/* a note's switch: ticked, it is sent; off, his words wait in the box */
/* how a note at the end rides: the setup's words (the default), his, or the storyteller's own — each falling back
 * to the one before where a model will not take it (providers.js) */
function lateAs(key, cur) {
  const sel = h('select');
  for (const [v, l] of [
    ['system', 'A system message — like SillyTavern’s post-history instructions (the default)'],
    ['user', 'A user message — as if you wrote it after your request'],
    ['assistant', 'The storyteller’s own voice — an assistant message'],
  ]) sel.append(h('option', { value: v, selected: (cur || 'system') === v }, l));
  sel.addEventListener('change', () => changeHouse((x) => { x.instructions = x.instructions || {}; if (sel.value === 'system') delete x.instructions[key]; else x.instructions[key] = sel.value; }, { now: true }));
  return field('Sent as', sel, 'As the storyteller’s own voice, the page is written on from your words, as if the storyteller had just said them — the way SillyTavern sends a note at the end with the role “AI Assistant”. A model that will not take that gets it as a system message (said in What was sent, and remembered for that model); one that will not take a system message there gets it as a user message. Claude and DeepSeek with thinking set get it as a system message: a reply begun in the storyteller’s words would skip the thinking.');
}

/* ------------------------------------------- words in the storyteller's own voice */
/* Cozy Tavern's M466 (ownwords.js): a few lines the request carries as if the
 * storyteller had already said them — or as his, or the setup's — each with its
 * switch, its place and who reads it; each in a sheet of its own. */
function ownWordsField(hs) {
  const list = h('div.modlist.ownlist');
  for (const w of cleanOwn(hs.ownWords)) {
    list.append(h('button.modrow', { 'data-id': w.id, title: 'Its switch, whose words, where they ride, who reads them, and the words.', onclick: () => openOwnWords(w.id) },
      h('span.grow', h('b', w.name.trim() || 'Words with no name yet'), h('small', ownLine(w))),
      icon('right', 16)));
  }
  return h('div.field',
    h('span', 'Words in the storyteller’s own voice'),
    list,
    h('div.btnrow', h('button.btn.small', { title: 'A new entry: its words, whose they are, where they ride and who reads them.', onclick: addOwnWords }, icon('plus', 15), 'Add words')),
    h('em', 'Like SillyTavern’s prompt-manager entries with the role “AI Assistant”, as in Cozy Tavern: a few lines the request carries as if the writer — or the narrator, in a scene — had already said them, so a writer who is Batman reads his own voice on the way in. Or as your words, or the setup’s. Each has its switch, one of three places, and who reads it. {{user}} and {{char}} become the names. Off, or empty: nothing is sent.'));
}

function addOwnWords() {
  const id = newId('ow');
  changeHouse(ownSteps.add({ id, on: true, name: '', role: 'teller', place: 'before-your-message', to: 'both', text: '' }), { now: true });
  draw();
  openOwnWords(id, { fresh: true });
}

function openOwnWords(id, { fresh = false } = {}) {
  const now = () => cleanOwn(house().ownWords).find((w) => w.id === id);
  const first = now();
  if (!first) return;
  let t = null;
  let pending = null;
  const set = (patch, opts) => changeHouse(ownSteps.set(id, patch), opts);
  /* the words and the name are kept after the typing pause — at once when the sheet closes */
  const later = (patch) => { pending = { ...(pending || {}), ...patch }; clearTimeout(t); t = setTimeout(flush, 500); };
  const flush = () => { clearTimeout(t); t = null; if (pending) { const p = pending; pending = null; if (now()) set(p, { now: true }); } };
  const s = openSheet(first.name.trim() || 'Words in the storyteller’s own voice', { onClose: () => { flush(); if (sheet) draw(); } });
  s.box.classList.add('modsheet', 'settings-detail');
  const on = h('input', { type: 'checkbox', checked: first.on });
  on.addEventListener('change', () => { set({ on: on.checked }, { now: true }); sayNow(); });
  const name = h('input', { type: 'text', value: first.name, maxlength: 60, placeholder: 'A name for these words — “Stay Batman”' });
  name.addEventListener('input', () => { later({ name: name.value }); s.setTitle(name.value.trim() || 'Words in the storyteller’s own voice'); });
  const pick = (map, cur, key) => {
    const sel = h('select');
    for (const [v, l] of Object.entries(map)) sel.append(h('option', { value: v, selected: cur === v }, l));
    sel.addEventListener('change', () => { set({ [key]: sel.value }, { now: true }); sayNow(); });
    return sel;
  };
  const role = pick(OWN_ROLES, first.role, 'role');
  const place = pick(OWN_PLACES, first.place, 'place');
  const to = pick(OWN_TO, first.to, 'to');
  const words = h('textarea.tall.modtext', { placeholder: 'The words, as the storyteller would say them — “Batman here, still me: I keep what the book has set down, and I talk like myself.”', spellcheck: 'false' });
  words.value = first.text;
  const say = h('em');
  const sayNow = () => { say.textContent = ownLine({ ...(now() || first), on: on.checked, role: role.value, place: place.value, to: to.value, text: words.value }); };
  words.addEventListener('input', () => { later({ text: words.value }); sayNow(); });
  sayNow();
  s.body.append(
    h('div.field.switchrow', h('label.toggle', on, h('span', 'Send these words')), say),
    field('Name', name),
    field('Whose words', role, 'The storyteller’s own: an assistant message, as if the writer (or the narrator, in a scene) had said them. Yours: a user message. The setup’s: a system message, like a preset’s instructions.'),
    field('Where they ride', place, 'After the book and its notes, before the story; right before what you ask; or after what you ask, before the note at the end. The storyteller’s own words at the very end of the request begin the page — sent as the setup’s words wherever a model will not take that, as the note at the end is.'),
    field('Who reads them', to),
    field('The words', words, 'Sent exactly as you write them. {{user}} and {{char}} become the names. Empty: nothing is sent.'),
    h('div.btnrow', h('button.btn.danger.small', { title: 'These words go — with Undo.', onclick: () => {
      flush();
      const all = cleanOwn(house().ownWords);
      const at = all.findIndex((w) => w.id === id);
      const row = JSON.parse(JSON.stringify((house().ownWords || []).find((w) => w && w.id === id) || null));
      changeHouse(ownSteps.remove(id), { now: true });
      s.close();
      undoToast('The words are taken out.', () => { if (row) changeHouse(ownSteps.restore(row, at), { now: true }); if (sheet) draw(); });
    } }, 'Remove these words')));
  if (fresh) name.focus();
}

function sendIt(key, off, label, hint) {
  const inp = h('input', { type: 'checkbox', checked: !off });
  inp.addEventListener('change', () => changeHouse((x) => { x.instructions = x.instructions || {}; if (inp.checked) delete x.instructions[key]; else x.instructions[key] = true; }, { now: true }));
  return h('div.field.switchrow', h('label.toggle', inp, h('span', label)), h('em', hint));
}

/* ------------------------------------------------------------ presets */
/* Cozy Tavern's saved voices (presets.js): his boxes, both notes at the end,
 * words to avoid and his name, saved together under a name and used again
 * with one tap. */

/* what the presets row shows: which presets, and which one is in the boxes */
function presetsKey(hs) {
  const on = presetInUse(hs);
  return JSON.stringify([presetsOf(hs).map((p) => [p.id, p.name, p.at]), on ? on.id : null]);
}

/* The row stays true to the boxes as he types (each box's save lands after
 * his typing pause): drawn again only when what it shows changes. It holds
 * only buttons — nothing under his fingers is touched. */
export function freshenPresets() {
  if (!sheet) return;
  const old = sheet.body.querySelector('.presetsfield');
  if (!old) return;
  const hs = house();
  if (old.dataset.key !== presetsKey(hs)) old.replaceWith(presetsField(hs));
}

function presetsField(hs) {
  const list = presetsOf(hs);
  const on = presetInUse(hs);
  const wrap = h('div.field.presetsfield', { 'data-key': presetsKey(hs) });
  const rows = h('div.modlist');
  for (const p of list) {
    rows.append(h('div.modrow.presetrow', { 'data-id': p.id },
      h('span.grow', h('b', p.name), h('small', voiceLine(p.voice)), h('small.about', `Saved ${timeAgo(p.at)}`)),
      on && on.id === p.id ? h('span.tag', 'in use') : h('button.btn.small', { title: 'Every box, both notes at the end, words to avoid and your name become this preset’s — with Undo.', onclick: () => usePresetNow(p) }, 'Use'),
      h('button.icon', { 'aria-label': `More for ${p.name}`, onclick: (e) => presetMenu2(e.currentTarget, p) }, icon('more', 18))));
  }
  wrap.append(h('span', 'Presets'),
    list.length ? rows : h('p.say', 'None saved yet. Save what is in the boxes below as a preset — a Batman, a Light Yagami — and change between them with one tap.'),
    h('div.btnrow',
      h('button.btn.small.primary', { title: 'Keeps what is in the boxes below right now under a name: How you like it written, How the narrator tells scenes, How the partner talks, both notes at the end, Words to avoid and your name.', onclick: savePresetNow }, icon('plus', 15), 'Save current preset'),
      h('button.btn.quiet.small', { title: 'A preset taken out as a file, brought back in here.', onclick: bringPreset }, 'Bring a preset in'),
      h('button.btn.quiet.small', { title: 'Every box back to its starting words; notes at the end, words to avoid and storyteller’s own voice entries cleared — with Undo.', onclick: () => usePresetNow(null) }, 'The starting words')),
    h('em', 'A preset keeps your three voices, both notes at the end, Words to avoid, your name, and Words in the storyteller’s own voice. Use restores them together. The notes’ Send it switches and your modules stay as they are.'));
  return wrap;
}

async function askName(title, value = '', ok = 'Save') {
  return new Promise((resolve) => {
    let out = null;
    const s = openSheet(title, { small: true, onClose: () => resolve(out) });
    const inp = h('input', { type: 'text', value, maxlength: 40, placeholder: 'e.g. Batman' });
    const go = () => { const v = cleanName(inp.value); if (!v) { toast('It needs a name.'); return; } out = v; s.close(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
    s.body.append(field('Name', inp), h('div.btnrow', h('button.btn.primary', { onclick: go }, ok)));
    setTimeout(() => inp.focus(), 50);
  });
}

async function savePresetNow() {
  landTyping();
  await store.flush('house', 'house');
  const hs = house();
  const on = presetInUse(hs) || presetsOf(hs).find((p) => p.id === hs.presetOn);
  const name = await askName('Save current preset', on ? on.name : '');
  if (!name) return;
  const same = presetsOf(house()).find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (same && !(await confirmIt(`Save over “${same.name}”?`, 'A preset with this name is there already: it becomes what is in the boxes now.', 'Save over it'))) return;
  const id = same ? same.id : newId('vp');
  changeHouse(presetSteps.save(id, name, voiceOf(house()), Date.now()), { now: true });
  toast(same ? `“${name}” is saved over.` : `Saved as “${name}”.`);
  draw();
}

function usePresetNow(p) {
  /* what he typed a moment ago is in the boxes first — Undo brings it back */
  landTyping();
  const before = voiceOf(house());
  const wasOn = house().presetOn || null;
  const voice = p ? cleanVoice(p.voice) : startingVoice(before.name);
  changeHouse(presetSteps.use(voice, p ? p.id : null), { now: true });
  draw();
  undoToast(p ? `Using “${p.name}”.` : 'The starting words are back in every box.', () => { changeHouse(presetSteps.use(before, wasOn), { now: true }); draw(); });
}

function presetMenu2(anchor, p) {
  menu(anchor, [
    { label: 'Save what is in the boxes over it', hint: 'This preset becomes your instructions as they stand in the boxes now.', run: async () => {
      if (!(await confirmIt(`Save over “${p.name}”?`, 'It becomes what is in the boxes now.', 'Save over it'))) return;
      landTyping();
      await store.flush('house', 'house');
      changeHouse(presetSteps.save(p.id, p.name, voiceOf(house()), Date.now()), { now: true }); toast(`“${p.name}” is saved over.`); draw();
    } },
    { label: 'Rename', hint: 'A new name for this preset; its words stay as they are.', run: async () => {
      const name = await askName('Rename the preset', p.name, 'Rename');
      if (!name || name === p.name) return;
      if (presetsOf(house()).some((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) { toast(`Another preset is called “${name}” already.`); return; }
      changeHouse(presetSteps.rename(p.id, name), { now: true }); draw();
    } },
    { label: 'Take it out as a file', hint: 'Saves this preset as a file, to keep or to bring into another Cozy Novel.', run: () => {
      download(`${p.name.replace(/[^\w -]+/g, '').trim() || 'preset'}.cozynovel-preset.json`, JSON.stringify({ format: PRESET_FORMAT, name: p.name, at: p.at, voice: p.voice }, null, 2), 'application/json');
    } },
    '-',
    { label: 'Remove', hint: 'This preset goes from the list, with Undo; your instructions as they stand are not touched.', danger: true, run: () => {
      const row = JSON.parse(JSON.stringify(p));
      changeHouse(presetSteps.remove(p.id), { now: true }); draw();
      undoToast(`“${p.name}” is removed.`, () => { changeHouse(presetSteps.restore(row), { now: true }); draw(); });
    } },
  ]);
}

async function bringPreset() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let data = null;
  try { data = JSON.parse(await file.text()); } catch (_) { data = null; }
  const voice = data && data.format === PRESET_FORMAT ? cleanVoice(data.voice) : null;
  if (!voice) { toast('That file is not a Cozy Novel preset.'); return; }
  const name = cleanName(data.name) || 'A preset brought in';
  const same = presetsOf(house()).find((p) => p.name.toLowerCase() === name.toLowerCase());
  const id = newId('vp');
  changeHouse(presetSteps.save(id, same ? `${name} (brought in)` : name, voice, Date.now()), { now: true });
  /* saving marks it as the one in use; bringing it in does not use it */
  changeHouse((x) => { if (x.presetOn === id) delete x.presetOn; }, { now: true });
  toast(`“${same ? `${name} (brought in)` : name}” is in your presets — Use puts it in the boxes.`);
  draw();
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
    h('div.btnrow',
      h('button.btn.small', { title: 'A module of your own: its name, who reads it, when it rides, its words.', onclick: addModule }, icon('plus', 15), 'Add your own module'),
      h('button.btn.quiet.small', { disabled: !listModules(hs).some((m) => m.builtin && m.changed), title: 'Every module of the app’s back as it came — its words, who reads it, when it rides. Your own modules stay.', onclick: allModulesBack }, 'All back to the default')),
    h('em', 'They ride right after your own words above — each to the writer, the narrator or your partner, as it says — in this order. The app’s come with it, made from your Cozy Tavern preset: change one and it’s yours, and Back to the default (in the module) puts it back. Off: not sent at all.'));
}

async function allModulesBack() {
  const changed = listModules(house()).filter((m) => m.builtin && m.changed);
  if (!changed.length) return;
  if (!(await confirmIt('All back to the default?', `${changed.map((m) => m.name).join(', ')} — each back as it came: the app’s words, who reads it, when it rides. Your own modules stay. (Undo puts yours back.)`, 'All back to the default'))) return;
  const rows = JSON.parse(JSON.stringify(house().modules || {}));
  for (const m of changed) changeHouse(moduleSteps.remove(m.id), { now: true });
  draw();
  undoToast('The app’s modules are as they came.', () => { for (const m of changed) if (rows[m.id]) changeHouse(moduleSteps.restore(m.id, rows[m.id]), { now: true }); draw(); });
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
  s.box.classList.add('modsheet', 'settings-detail');

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
  let buttonsKey = null;
  const drawButtons = () => {
    const m = now();
    const key = `${Boolean(base)}:${Boolean(m.changed)}`;
    if (buttonsKey === key) return;
    buttonsKey = key;
    buttons.textContent = '';
    if (base) {
      /* always there, as in Cozy Tavern: greyed while the module is as it came */
      buttons.append(h('button.btn.quiet.small', { disabled: !m.changed, title: m.changed ? 'The app’s words come back, with who reads it and when it rides as they came — with Undo.' : 'Nothing is changed — it is as it came.', onclick: async () => {
        /* A click can beat the typing pause. Save the visible words before
         * deciding whether to ask, and before taking Undo's copy. */
        flushAll();
        let how = 'back';
        if (now().ownWords) {
          how = await backChoice('Your words for this module go, and the app’s come back — with who reads it and when it rides as they came.');
          if (!how) return;
          if (how === 'copy' && !(await copyText(words.value))) { toast('Your words could not be copied, so they stay as they are.'); return; }
        }
        for (const x of savers) x.cancel();
        const row = JSON.parse(JSON.stringify((house().modules || {})[id] || null));
        /* the sheet as the module now stands */
        const fill = () => {
          const d = now();
          name.value = d.name; words.value = d.text; rides.value = d.rides;
          for (const [i, r] of READERS.entries()) who.children[i].querySelector('input').checked = d.to.includes(r);
          s.setTitle(d.name);
          sayNow(); drawButtons();
        };
        changeHouse(moduleSteps.remove(id), { now: true });
        fill();
        undoToast(how === 'copy' ? 'Yours are copied, and the module is as it came.' : 'The module is as it came.', () => { if (row) changeHouse(moduleSteps.restore(id, row), { now: true }); fill(); if (sheet) draw(); });
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
    field('When it rides', rides, 'Intimate and fight: it wakes by itself when your own words turn to it — what you ask for, and what you asked for or wrote last before that point (a scene break starts afresh); in a scene, where it starts and your last three moves — and rides nearer the page. What the writer wrote never wakes it.'),
    field('Its words', words, base ? 'The app’s words, from your preset — change anything and they are yours, sent exactly as you leave them. Empty: nothing is sent.' : 'Sent word for word, right after your own instructions. Empty: nothing is sent.'),
    buttons);
  if (fresh) name.focus();
}

/* ------------------------------------------------------------ the look */

const THEMES = [
  ['academy', 'Academy of Ink', 'Candlelight, quiet magic, and unwritten worlds.', '<path d="M38 94V45Q38 23 63 8Q88 23 88 45V94M49 94V47Q49 32 63 23Q77 32 77 47V94M63 23V94M38 60H88M20 94H110M24 94V70H33V94M94 94V65H104V94M133 91V40L143 23L153 40V91M127 40H160M167 91V58L177 42L187 58V91M167 70H187"/><path d="M113 14v12m-6-6h12M22 29v8m-4-4h8M174 17v10m-5-5h10"/>'],
  ['tokyo', 'Neon Tokyo', 'A rain-wet street of glowing signs. The page lit like one.', '<path d="M19 12H187V94H19ZM119 12V94M19 72H187M29 72V39H51V72M57 72V25H80V72M86 72V45H108M131 72V47H150V72M159 72V32H177V72M33 46H47M33 53H47M63 33H74M63 41H74M63 49H74M164 40H173M164 48H173M164 56H173M23 94H190"/><path d="M42 13l-6 13m67-10l-8 18m54-20l-7 17M69 72l-5 15m104-22l-7 16"/>'],
  ['study', 'Original Study', 'The familiar rainy window and warm lamplight.', '<path d="M14 12H122V94H14ZM68 12V94M14 52H122M24 44V29H48V44M78 44V23H100V44M22 94H192M154 94V53M139 53H177L167 25H149ZM145 94H166M137 84H188M24 82H61V90H24ZM25 73H57V81H25M82 16l-5 13m29-8l-4 10M41 57l-5 11"/>'],
];

function lookGroup(hs) {
  const look = hs.look || {};
  const g = group('How it looks', { key: 'set.look' });
  const colourEditors = [];
  const setLook = (patch) => {
    changeHouse((x) => { x.look = typeof patch === 'function' ? patch(x.look || {}) : mergeLook(x.look, patch); });
    const latest = house().look || {};
    applyLook(latest);
    Object.assign(look, latest);
    for (const editor of colourEditors) editor.refresh();
  };
  for (const kind of ['novel', 'scene', 'dialogue']) colourEditors.push(colourPicker(kind, () => house().look || {}, setLook));
  const chosen = resolveLook(look);
  const sw = h('div.swatches.world-swatches', { role: 'group', 'aria-label': 'Choose your world' });
  for (const [id, label, description, paths] of THEMES) {
    const b = h('button.swatch', { 'data-world': id, title: description, 'aria-pressed': String(chosen.world === id), onclick: () => { setLook({ theme: id }); for (const x of sw.children) x.setAttribute('aria-pressed', String(x === b)); } },
      h('span.world-preview', { 'aria-hidden': 'true', html: `<svg viewBox="0 0 210 105" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>` }), h('b', label), h('small', description));
    sw.append(b);
  }
  const modes = h('div.mode-choices.segmented', { role: 'group', 'aria-label': 'Light or dark mode' });
  for (const [mode, label] of [['dark', 'Night'], ['light', 'Day']]) {
    const b = h('button.mode-choice', { 'data-mode': mode, title: mode === 'dark' ? 'A softly lit room after dark.' : 'Let the morning into the room.', 'aria-pressed': String(chosen.mode === mode), onclick: () => {
      setLook({ mode });
      for (const x of modes.children) x.setAttribute('aria-pressed', String(x === b));
    } }, label);
    modes.append(b);
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
  g.body.append(h('p.say', 'Choose a world to write in. Make it morning, or stay a little after dark.'), sw,
    h('div.world-mode-row', h('span', 'The light in your room'), modes),
    toggle('motion', 'Ambient animation', look.motion !== 'off'),
    h('p.say.motion-hint', 'Slow ink, candlelight, rain or a gentle lamplight glow. Off, only the room is still: what is at work — the Suggestions ring, the notes’ light while the helper reads, the page being written — still moves. Your device’s reduced-motion setting is always respected; only the Suggestions ring still turns, slowly, so it never looks stuck.'),
    toggle('room', 'The room behind the page', look.room !== 'off'),
    toggle('tint', 'Tint the dialogue', look.tint !== 'off'),
    ...colourEditors.map(editor => editor.box),
    toggle('indent', 'Indented paragraphs, like a printed book', look.indent === 'on'),
    h('div.fieldrow',
      field('Typeface', sel('font', [['literata', 'Literata (book)'], ['classic', 'Georgia (classic)'], ['sans', 'Plain (sans)']], look.font || 'literata')),
      field('Size', sel('size', [['16', 'Small'], ['18', 'Medium'], ['20', 'Large'], ['22', 'Larger'], ['25', 'Largest']], look.size || '18')),
      field('Line spacing', sel('lead', [['1.5', 'Snug'], ['1.72', 'Comfortable'], ['1.95', 'Airy']], look.lead || '1.72')),
      field('Page width', sel('width', [['600', 'Narrow'], ['680', 'Book'], ['780', 'Wide']], look.width || '680'))),
    h('div.btnrow', h('button.btn.quiet.small', { title: 'The theme, the type, the spacing and the width as they began — with Undo.', onclick: () => {
      const was = JSON.parse(JSON.stringify(house().look || {}));
      const put = (v) => { changeHouse((x) => { x.look = { ...v }; }, { now: true }); applyLook(v); for (const k of Object.keys(look)) delete look[k]; Object.assign(look, v); draw(); };
      put({ ...DEFAULT_LOOK, novelSaved: house().look?.novelSaved, sceneSaved: house().look?.sceneSaved, dialogueSaved: house().look?.dialogueSaved });
      undoToast('It looks the way it began.', () => put(was));
    } }, 'Back to the default look')));
  return g;
}

/* ------------------------------------------------------------ copies */

function backupsGroup() {
  const g = group('Backups', { key: 'set.backups' });
  const copies = h('div', h('p.say', 'Looking…'));
  const trash = h('div');
  g.body.append(
    h('p.say', 'Your books live on this phone, in ~/.cozynovel — the same in every browser. A copy of everything is kept on the phone once a day (the newest fourteen) and just before each update, and every chapter keeps its earlier copies.'),
    h('div.btnrow',
      h('button.btn.primary.small', { title: 'Every book, its notes, talks and scenes, and your settings — as one file in your downloads.', onclick: async () => {
        if (!(await allOnPhone())) return;
        location.href = '/api/backup'; toast('The copy is on its way to your downloads.');
      } }, 'Take a copy of everything'),
      h('button.btn.small', { title: 'A copy taken before: its books beside yours, or everything made exactly as in it.', onclick: bringCopyBack }, 'Bring a copy back')),
    h('p.say.quiet', 'Take a copy of everything: one file in your downloads, with every word on the phone. Bring a copy back: adds its books to the shelf, or makes everything as in the copy.'),
    h('h4', { style: { margin: '16px 0 6px', font: '600 16px/1.2 var(--display)' } }, 'Copies kept on this phone'), copies,
    h('h4', { style: { margin: '16px 0 6px', font: '600 16px/1.2 var(--display)' } }, 'Recently deleted'), trash);
  fillCopies(copies);
  fillTrash(trash);
  return g;
}

/* what is still on its way to the phone goes first, so a copy holds every
 * word and a copy brought back keeps them in the one made before it (Cozy
 * Tavern M670) — the box's last words too */
async function allOnPhone() {
  /* A backup also keeps the last keystroke in Settings, before its pause. */
  landTyping();
  draftNow();
  /* a phone that does not answer is not waited on for long: it is said */
  await Promise.race([store.flush().catch(() => {}), new Promise((done) => setTimeout(done, 8000))]);
  if (!store.hasPending()) return true;
  toast('Some of your words have not reached the phone yet, so nothing was done — try again once it answers.');
  return false;
}

async function fillCopies(box) {
  const { status, data } = await store.api('GET', '/api/copies').catch(() => ({ status: 0 }));
  box.textContent = '';
  if (status !== 200 || !data) { box.append(h('p.say', 'The copies could not be read just now — the phone did not answer.')); return; }
  if (!data.copies.length) { box.append(h('p.say', 'None yet — the first is made today.')); return; }
  const list = h('ul.list');
  /* every copy the phone keeps (fourteen days' and fourteen kept before a copy was brought back) — never a few of them, the rest out of reach */
  for (const c of data.copies) {
    const before = c.name.includes('before-');
    const update = c.name.includes('before-update-');
    list.append(h('li', h('div.grow', update ? 'Kept just before Cozy Novel was updated' : before ? 'Kept just before a copy was brought back' : `The day’s copy`, h('small', [new Date(c.at).toLocaleString(), Number.isFinite(c.books) ? `${plural(c.books, 'book')} · ${plural(c.words, 'word')}` : '', `${Math.max(1, Math.round(c.size / 1024)).toLocaleString()} KB`].filter(Boolean).join(' · '))),
      h('button.btn.small', { title: 'Everything goes back to how it was then — everything as it is now is kept as a copy first.', onclick: async () => {
        if (!(await confirmIt('Bring this copy back?', 'Everything goes back to how it was then. Everything as it is now is kept as a copy first, so nothing is lost.', 'Bring it back'))) return;
        if (!(await allOnPhone())) return;
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
    let list;
    try { list = booksFromLibrary(data); }
    catch (error) { toast(error?.message || 'That copy could not be read. No books were added.', 7000); return; }
    for (const b of list) {
      for (const id of b.novel.order) await store.create('chapter', id, b.chapters[id]);
      if (b.talk) await store.create('talk', b.novel.id, b.talk);
      if (b.draft) await store.create('draft', b.novel.id, b.draft);
      for (const p of b.plays) await store.create('play', p.id, p);
      await store.create('novel', b.novel.id, b.novel);
    }
    toast(`${plural(list.length, 'book')} added to the shelf.`);
  } else if (choice === 'replace') {
    if (!(await confirmIt('Replace everything?', 'Everything becomes exactly as in the copy. What is here now is kept on the phone first (Backups → Copies kept on this phone).', 'Replace everything', { danger: true }))) return;
    if (!(await allOnPhone())) return;
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
