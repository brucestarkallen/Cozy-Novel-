/* Cozy Novel — js/novel/presets.js — PRESETS: the voice of your instructions,
 * saved under a name (Cozy Tavern's saved voices, M510-35/36).
 *
 * Settings → Your instructions → Presets. "Save current preset" keeps,
 * together, everything that makes the writer who it is: How you like it
 * written, How the narrator tells scenes, How the partner talks, both notes
 * at the end, Words to avoid, and your name. Using one writes every one of
 * them back exactly — a box it kept empty is emptied. The switches (whether
 * each note at the end is sent) and the modules are not a voice: they stay as
 * they are, as in Cozy Tavern. A name already used is that preset, saved
 * over; a preset can be renamed (never to nothing, nor to another's name),
 * removed with Undo, taken out as a file and brought back in.
 *
 * In the house: presets = [{id, name, at, voice}]; presetOn: the one last
 * saved or used. Pure: no store, no screen — store.js plays the steps.
 */

import { DEFAULT_WRITING, DEFAULT_NARRATOR, DEFAULT_PARTNER } from './prompts.js';

/* the boxes a preset holds, by their keys in house.instructions */
export const VOICE_BOXES = ['system', 'narrator', 'partner', 'late', 'lateNarrator', 'avoid'];
export const FORMAT = 'cozynovel-preset';

/* what a box sends when he never touched it: its starting words */
const STARTING = { system: DEFAULT_WRITING, narrator: DEFAULT_NARRATOR, partner: DEFAULT_PARTNER, late: '', lateNarrator: '', avoid: '' };

/* The voice as the house holds it now: each box as the words it sends (a box
 * never touched: its starting words), and his name. */
export function voiceOf(house) {
  const ins = (house && house.instructions) || {};
  const boxes = {};
  for (const k of VOICE_BOXES) {
    if (typeof ins[k] === 'string') boxes[k] = ins[k];
    else if (k === 'lateNarrator' && typeof ins.late === 'string') boxes[k] = ins.late;   /* a house from before the two notes */
    else boxes[k] = STARTING[k];
  }
  return { boxes, name: String((house && house.you && house.you.name) || '') };
}

/* two voices alike, box for box */
export function sameVoice(a, b) {
  if (!a || !b) return false;
  return VOICE_BOXES.every((k) => String((a.boxes || {})[k] ?? '') === String((b.boxes || {})[k] ?? '')) && String(a.name || '') === String(b.name || '');
}

/* the app's own voice: every box with its starting words */
export function startingVoice(name = '') {
  return { boxes: { ...STARTING }, name };
}

/* A voice read from a file or the house: only what a preset holds, each in
 * its own shape. null when it holds none of it. */
export function cleanVoice(v) {
  if (!v || typeof v !== 'object') return null;
  const src = v.boxes && typeof v.boxes === 'object' ? v.boxes : {};
  const boxes = {};
  let any = false;
  for (const k of VOICE_BOXES) { if (typeof src[k] === 'string') { boxes[k] = src[k]; any = true; } else boxes[k] = ''; }
  if (!any) return null;
  return { boxes, name: typeof v.name === 'string' ? v.name.trim().slice(0, 60) : '' };
}

/* the presets, newest saved first */
export function presetsOf(house) {
  const list = Array.isArray(house && house.presets) ? house.presets : [];
  return list.filter((p) => p && typeof p === 'object' && p.id && typeof p.name === 'string' && cleanVoice(p.voice)).sort((a, b) => (b.at || 0) - (a.at || 0));
}

/* the preset whose words are the ones in the boxes now, if any */
export function presetInUse(house) {
  const now = voiceOf(house);
  const list = presetsOf(house);
  const on = list.find((p) => p.id === (house && house.presetOn));
  if (on && sameVoice(cleanVoice(on.voice), now)) return on;
  return list.find((p) => sameVoice(cleanVoice(p.voice), now)) || null;
}

export function cleanName(name) { return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40); }

/* what a preset holds, in a line */
export function voiceLine(voice) {
  const v = cleanVoice(voice);
  if (!v) return '';
  const bits = [];
  const first = v.boxes.system.trim().split('\n')[0];
  bits.push(v.boxes.system === DEFAULT_WRITING ? 'the starting writing words' : first ? `“${first.length > 60 ? first.slice(0, 60).replace(/\s+\S*$/, '') + '…' : first}”` : 'no writing words');
  if (v.name) bits.push(`your name: ${v.name}`);
  if (v.boxes.late.trim() || v.boxes.lateNarrator.trim()) bits.push('notes at the end');
  if (v.boxes.avoid.trim()) bits.push('words to avoid');
  return bits.join(' · ');
}

export const presetSteps = {
  /* saved: over the preset with that id, or a new one */
  save: (id, name, voice, at) => (house) => {
    const list = Array.isArray(house.presets) ? house.presets : (house.presets = []);
    const row = { id, name: cleanName(name) || 'My preset', at, voice: JSON.parse(JSON.stringify(voice)) };
    const i = list.findIndex((p) => p.id === id);
    if (i >= 0) list[i] = row; else list.push(row);
    house.presetOn = id;
  },
  rename: (id, name) => (house) => {
    const p = (house.presets || []).find((x) => x.id === id);
    if (p && cleanName(name)) p.name = cleanName(name);
  },
  remove: (id) => (house) => {
    house.presets = (house.presets || []).filter((p) => p.id !== id);
    if (house.presetOn === id) delete house.presetOn;
  },
  /* put back where it was (Undo) */
  restore: (row) => (house) => {
    const list = Array.isArray(house.presets) ? house.presets : (house.presets = []);
    if (!list.some((p) => p.id === row.id)) list.push(JSON.parse(JSON.stringify(row)));
  },
  /* a voice used: every box and his name written back exactly */
  use: (voice, id = null) => (house) => {
    const v = cleanVoice(voice);
    if (!v) return;
    house.instructions = house.instructions || {};
    for (const k of VOICE_BOXES) house.instructions[k] = v.boxes[k];
    house.you = { ...(house.you || {}), name: v.name };
    if (id) house.presetOn = id; else delete house.presetOn;
  },
};
