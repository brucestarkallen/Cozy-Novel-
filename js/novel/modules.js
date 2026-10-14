/* Cozy Novel — js/novel/modules.js — MODULES: the crafts and rules that ride
 * right after his own words (Settings → Your instructions → Modules).
 *
 * The app's own (crafts.js) — the novel craft for the writer, the scene
 * craft for the narrator, and Cozy Tavern's other built-in rules — and the
 * ones he adds himself. Each says who reads it (the writer, the narrator,
 * the partner) and when it rides: always, when the scene turns intimate,
 * when a fight starts, or not at all (Off).
 *
 * In the house: modules = { [id]: row }. A row for one of the app's holds
 * only what he changed: its words follow the app's until he edits them, so
 * an improved craft still reaches him (Cozy Tavern M510-3), and Back to the
 * default takes the row away. A module of his own is a row with custom:
 * true. Every change is a step by id (store.js plays it again over a newer
 * copy and it means the same). Pure: no store, no screen. */

import { NOVEL_CRAFT, SCENE_CRAFT, INTIMATE_RULE, CONTESTED_RULE, VOICE_RULE, SPECTACLE_RULE, SOUND } from './crafts.js';
import { soundOf } from './shape.js';

export const READERS = ['writer', 'narrator', 'partner'];
export const READER_WORDS = { writer: 'The writer', narrator: 'The narrator', partner: 'Your partner' };
export const RIDES = ['always', 'intimate', 'fight', 'off'];
export const RIDES_WORDS = { always: 'Always', intimate: 'When the scene turns intimate', fight: 'When a fight starts', off: 'Off — not sent' };

export const BUILTIN = [
  { id: 'novel-craft', name: 'The novel craft', text: NOVEL_CRAFT, to: ['writer'], rides: 'always',
    about: 'Your Simulation Engine preset, made for a novel: from your premise the writer writes everyone — the main character too.' },
  { id: 'scene-craft', name: 'The scene craft', text: SCENE_CRAFT, to: ['narrator'], rides: 'always',
    about: 'Your Simulation Engine preset as Cozy Tavern carries it: the narrator runs the world and everyone in it; your character is yours alone.' },
  { id: 'intimate', name: 'When the scene turns intimate', text: INTIMATE_RULE, to: ['writer', 'narrator'], rides: 'intimate',
    about: 'How bodies are written once a scene turns to sex. How it sounds comes from the book’s Sound (About this book).' },
  { id: 'contested', name: 'When words won’t carry it', text: CONTESTED_RULE, to: ['narrator'], rides: 'fight',
    about: 'A fight, a chase, a wager in a scene you play: the narrator gives it a board and lets the result stand. For the writer, the novel craft carries it — and the chip by the box says whose call the outcome is.' },
  { id: 'voice', name: 'The sound of a voice', text: VOICE_RULE, to: ['writer', 'narrator'], rides: 'always',
    about: 'Every woman in the book sounds like herself, never like the next one.' },
  { id: 'spectacle', name: 'Spectacle combat (for the anime arcs)', text: SPECTACLE_RULE, to: ['writer', 'narrator'], rides: 'off',
    about: 'Fights as kinetic spectacle, the board still deciding. Off until you choose when it rides.' },
];
export function builtinOf(id) { return BUILTIN.find((b) => b.id === id) || null; }

/* readers in one order, whatever order they were ticked in */
const readersOf = (v, fallback) => (Array.isArray(v) ? READERS.filter((r) => v.includes(r)) : fallback.slice());
const ridesOf = (v, fallback) => (RIDES.includes(v) ? v : fallback);
const sameReaders = (a, b) => readersOf(a, []).join() === readersOf(b, []).join();
function rowsOf(house) {
  const m = house && house.modules;
  return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
}

/* Every module, in the order they ride: the app's, then his own (the oldest
 * first). changed: he changed something of one of the app's (Back to the
 * default puts it back); ownWords: its words are his now. */
export function listModules(house) {
  const rows = rowsOf(house);
  const out = BUILTIN.map((b) => {
    const r = rows[b.id] && !rows[b.id].custom ? rows[b.id] : {};
    const ownWords = typeof r.text === 'string' && r.text !== b.text;
    return {
      id: b.id, builtin: true,
      name: typeof r.name === 'string' && r.name.trim() ? r.name : b.name,
      text: ownWords ? r.text : b.text,
      to: readersOf(r.to, b.to),
      rides: ridesOf(r.rides, b.rides),
      about: b.about,
      ownWords,
      changed: Object.keys(r).length > 0,
    };
  });
  const own = Object.entries(rows).filter(([id, r]) => r && r.custom && !builtinOf(id)).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  for (const [id, r] of own) {
    out.push({
      id, builtin: false, custom: true,
      name: String(r.name || '').trim() || 'A module of your own',
      text: typeof r.text === 'string' ? r.text : '',
      to: readersOf(r.to, ['writer']),
      rides: ridesOf(r.rides, 'always'),
      at: r.at || 0,
    });
  }
  return out;
}
export function moduleOf(house, id) { return listModules(house).find((m) => m.id === id) || null; }

/* what one module says about itself, in a line: who reads it and when */
export function rideLine(m) {
  if (m.rides === 'off') return 'Off — not sent';
  if (!String(m.text || '').trim()) return 'Empty — nothing is sent';
  if (!m.to.length) return 'Sent to nobody — tick who reads it';
  const words = m.to.map((r, i) => (i ? READER_WORDS[r].toLowerCase() : READER_WORDS[r]));
  const who = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0];
  return `${who} · ${RIDES_WORDS[m.rides].toLowerCase()}`;
}

const READER_OF = { write: 'writer', play: 'narrator', partner: 'partner' };

/* What rides for one of them this time — always: the part that stays the
 * same page after page, right after his own words; woken: what his words
 * woke (it rides nearer the page, so the part that stays the same stays the
 * same). wake: {intimate, fight}, from his own words (crafts.js wakesOn —
 * never the page). A module he
 * emptied sends nothing. The sound law rides for the two who tell the story,
 * as the book's Sound switch writes it: always its two lanes, how a fight
 * sounds once one starts, and how sex sounds with the intimate rule. */
export function ridingFor(house, novel, purpose, wake = {}) {
  const who = READER_OF[purpose];
  const always = [];
  const woken = [];
  const names = [];
  if (!who) return { always, woken, names };
  const sound = SOUND[soundOf(novel)];
  const tells = who === 'writer' || who === 'narrator';
  for (const m of listModules(house)) {
    if (!m.to.includes(who)) continue;
    const on = m.rides === 'always' || (m.rides === 'intimate' && wake.intimate) || (m.rides === 'fight' && wake.fight);
    const text = String(m.text || '').trim();
    if (!on || !text) continue;
    const piece = m.id === 'intimate' && tells ? `${text}\n\n${sound.intimate}` : text;
    (m.rides === 'always' ? always : woken).push(piece);
    names.push(m.name);
  }
  if (tells) {
    always.push(sound.always);
    if (wake.fight) woken.push(sound.fight);
  }
  return { always, woken, names };
}

/* ------------------------------------------------------------ the steps */

export const moduleSteps = {
  /* fields of a module set; undefined puts one of the app's back as it came */
  set: (id, patch) => (house) => {
    const rows = (house.modules = rowsOf(house));
    const b = builtinOf(id);
    const row = { ...(rows[id] || {}) };
    if (!b && !row.custom) return;   /* his own, taken out meanwhile: it stays out */
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete row[k]; else row[k] = v; }
    if (Array.isArray(row.to)) row.to = readersOf(row.to, []);
    if (b) {
      /* only what differs from the app's is kept */
      delete row.custom;
      if (row.text === b.text) delete row.text;
      if (row.name === b.name || (typeof row.name === 'string' && !row.name.trim())) delete row.name;
      if (Array.isArray(row.to) && sameReaders(row.to, b.to)) delete row.to;
      if (row.rides === b.rides) delete row.rides;
      if (!Object.keys(row).length) { delete rows[id]; return; }
    }
    rows[id] = row;
  },
  /* a module of his own, new */
  add: (id, fields) => (house) => {
    const rows = (house.modules = rowsOf(house));
    if (rows[id] || builtinOf(id)) return;
    rows[id] = { custom: true, name: '', text: '', to: ['writer'], rides: 'always', ...fields, ...(Array.isArray(fields.to) ? { to: readersOf(fields.to, []) } : {}) };
  },
  /* his own taken out; one of the app's back as it came */
  remove: (id) => (house) => { const rows = rowsOf(house); if (rows[id]) { delete rows[id]; house.modules = rows; } },
  /* his own, put back where it was (Undo) */
  restore: (id, row) => (house) => {
    const rows = (house.modules = rowsOf(house));
    if (!rows[id]) rows[id] = JSON.parse(JSON.stringify(row));
  },
};
