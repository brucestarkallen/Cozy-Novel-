/* The world, the light and the page change without reopening the book. */
import { showWorld } from './worlds.js';
import { colourPair, inkFor } from './look-colours.js';

export const DEFAULT_LOOK = { theme: 'academy', mode: 'dark', motion: 'on', room: 'on', tint: 'on', novelHighlight: 'on', sceneHighlight: 'on', indent: 'off', font: 'literata', size: '18', lead: '1.72', width: '680' };

/* Older copies keep their daylight choice and every page setting. Their
 * stored words are untouched; the next deliberate theme choice saves the new name. */
export function resolveLook(look = {}) {
  const world = look.theme === 'study' ? 'study' : look.theme === 'tokyo' || look.theme === 'rain' ? 'tokyo' : 'academy';
  const mode = look.mode === 'light' || (!look.mode && look.theme === 'day') ? 'light' : 'dark';
  return { world, mode, motion: look.motion === 'off' ? 'off' : 'on' };
}

/* Replay only the choice being changed over the latest saved room. A world
 * change carries legacy daylight forward without capturing another window's
 * older light, typeface or animation preference. */
export function mergeLook(look = {}, patch = {}) {
  return { ...look, ...(patch.theme ? { mode: resolveLook(look).mode } : {}), ...patch };
}

/* House saves also arrive while a reply streams. Touch the page only when an
 * appearance value actually changed: writing the same root attributes forces
 * selector invalidation, and reading its computed colour then flushes styles. */
export function applyLook(look = {}) {
  const d = document.documentElement;
  const { world, mode, motion } = resolveLook(look);
  const coloursChanged = d.dataset.world !== world || d.dataset.mode !== mode;
  const attribute = (el, key, value) => {
    if (el && el.getAttribute(key) !== value) el.setAttribute(key, value);
  };
  for (const [key, value] of Object.entries({
    theme: world, world, mode, motion,
    room: look.room === 'off' ? 'off' : 'on',
    novelHighlight: look.novelHighlight === 'off' ? 'off' : 'on',
    sceneHighlight: look.sceneHighlight === 'off' ? 'off' : 'on',
    font: look.font || 'literata',
    tint: look.tint === 'off' ? 'off' : 'on',
    indent: look.indent === 'on' ? 'on' : 'off',
  })) {
    if (d.dataset[key] !== value) d.dataset[key] = value;
  }
  for (const [key, value] of Object.entries({
    '--prose-size': `${Number(look.size) || 18}px`,
    '--prose-lead': String(Number(look.lead) || 1.72),
    '--page-width': `${Number(look.width) || 680}px`,
  })) {
    if (d.style.getPropertyValue(key) !== value) d.style.setProperty(key, value);
  }
  const novel = colourPair(look, 'novel');
  const scene = colourPair(look, 'scene'), dialogue = colourPair(look, 'dialogue');
  for (const [key, value] of Object.entries({
    '--novel-paper': novel ? novel[mode] : '',
    '--novel-ink': novel ? inkFor(novel[mode]) : '',
    '--scene-paper': scene ? scene[mode] : '',
    '--scene-ink': scene ? inkFor(scene[mode]) : '',
    '--dlg': dialogue ? dialogue[mode] : '',
  })) {
    if (d.style.getPropertyValue(key) === value) continue;
    if (value) d.style.setProperty(key, value); else d.style.removeProperty(key);
  }
  showWorld(world);
  for (const [id, name] of [['worldAcademy', 'academy'], ['worldTokyo', 'tokyo'], ['worldStudy', 'study']]) {
    attribute(document.getElementById(id), 'aria-pressed', String(world === name));
  }
  const light = document.getElementById('modeToggle');
  if (light) {
    attribute(light, 'aria-label', `Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`);
    attribute(light, 'title', mode === 'dark' ? 'Let the morning into your writing room' : 'Settle into your writing room at night');
    const label = light.querySelector('.mode-word'), word = mode === 'dark' ? 'Night' : 'Day';
    if (label && label.textContent !== word) label.textContent = word;
  }
  const movement = document.getElementById('motionToggle');
  if (movement) {
    attribute(movement, 'aria-pressed', String(motion === 'on'));
    attribute(movement, 'title', motion === 'on' ? 'Pause the room’s ambient animation' : 'Let the room’s ambient animation move');
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && coloursChanged) attribute(meta, 'content', getComputedStyle(d).getPropertyValue('--chrome-solid').trim());
}
