/* Cozy Novel — js/novel/ownwords.js — WORDS IN THE STORYTELLER'S OWN VOICE
 * (Cozy Tavern's M466, made for a book): SillyTavern's prompt-manager entries
 * with a role and a place, kept for the day he needs them.
 *
 * Settings → Your instructions → Words in the storyteller's own voice. Each
 * entry: a switch, a name, whose words they are (the storyteller's own — the
 * writer's, or the narrator's in a scene — an assistant message; his, a user
 * message; the setup's, a system message), one of three places in the
 * request, who reads them (the writer, the narrator, or both), and the words.
 * {{user}} and {{char}} become the names, as everywhere. Off, or empty: not
 * one byte of any request changes.
 *
 * In the house: ownWords = [{id, on, name, role, place, to, text}]. Pure: no
 * store, no screen — store.js plays the steps.
 */

/* whose words, as the request carries them */
export const OWN_ROLES = {
  teller: 'The storyteller’s own words — the writer’s, or the narrator’s in a scene (an assistant message)',
  you: 'Your words (a user message)',
  house: 'The setup’s words (a system message)',
};
const ROLE_OF = { teller: 'assistant', you: 'user', house: 'system' };

/* where they ride: three places of the request, never anywhere else */
export const OWN_PLACES = {
  'before-pages': 'After the book and its notes — before the story',
  'before-your-message': 'Right before what you ask (your request, or your move in a scene)',
  'after-your-message': 'After what you ask — before the note at the end',
};

/* who reads them */
export const OWN_TO = {
  both: 'The writer and the narrator',
  write: 'The writer — the book',
  play: 'The narrator — your scenes',
};

/* each entry in its own shape, whatever the house holds */
export function cleanOwn(list) {
  return (Array.isArray(list) ? list : [])
    .filter((w) => w && typeof w === 'object' && typeof w.id === 'string' && w.id)
    .map((w) => ({
      id: w.id,
      on: w.on !== false,
      name: typeof w.name === 'string' ? w.name : '',
      role: Object.prototype.hasOwnProperty.call(OWN_ROLES, w.role) ? w.role : 'teller',
      place: Object.prototype.hasOwnProperty.call(OWN_PLACES, w.place) ? w.place : 'after-your-message',
      to: Object.prototype.hasOwnProperty.call(OWN_TO, w.to) ? w.to : 'both',
      text: typeof w.text === 'string' ? w.text : '',
    }));
}

/* what rides for this one (purpose 'write' or 'play'), in his order: {role, place, text, name} —
 * only switched on, only with words, the names filled by `fill` */
export function ownWordsFor(house, purpose, fill = (t) => t) {
  if (purpose !== 'write' && purpose !== 'play') return [];
  const out = [];
  for (const w of cleanOwn(house && house.ownWords)) {
    if (!w.on || (w.to !== 'both' && w.to !== purpose)) continue;
    const text = String(fill(w.text) || '');
    if (!text.trim()) continue;
    out.push({ role: ROLE_OF[w.role], place: w.place, text, name: w.name.trim() || 'Own words' });
  }
  return out;
}

/* the line under an entry in the list: whose, where, for whom — or why nothing goes */
export function ownLine(w) {
  const e = cleanOwn([w])[0];
  if (!e) return '';
  if (!e.on) return 'Off — not sent';
  if (!e.text.trim()) return 'Empty — nothing is sent';
  const whose = { teller: 'the storyteller’s own words', you: 'your words', house: 'the setup’s words' }[e.role];
  const where = { 'before-pages': 'before the story', 'before-your-message': 'right before what you ask', 'after-your-message': 'after what you ask' }[e.place];
  const who = { both: 'the writer and the narrator', write: 'the writer', play: 'the narrator' }[e.to];
  return `${whose.charAt(0).toUpperCase() + whose.slice(1)}, ${where} — for ${who}`;
}

export const ownSteps = {
  add: (row) => (house) => {
    const list = Array.isArray(house.ownWords) ? house.ownWords : (house.ownWords = []);
    if (!list.some((w) => w && w.id === row.id)) list.push(JSON.parse(JSON.stringify(row)));
  },
  set: (id, patch) => (house) => {
    const w = (Array.isArray(house.ownWords) ? house.ownWords : []).find((x) => x && x.id === id);
    if (!w) return;
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete w[k]; else w[k] = v; }
  },
  remove: (id) => (house) => {
    if (Array.isArray(house.ownWords)) house.ownWords = house.ownWords.filter((x) => !x || x.id !== id);
  },
  /* put back where it stood (Undo) */
  restore: (row, at) => (house) => {
    const list = Array.isArray(house.ownWords) ? house.ownWords : (house.ownWords = []);
    if (list.some((w) => w && w.id === row.id)) return;
    list.splice(Math.max(0, Math.min(Number.isInteger(at) ? at : list.length, list.length)), 0, JSON.parse(JSON.stringify(row)));
  },
};
