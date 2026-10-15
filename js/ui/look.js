/* The world, the light and the page change without reopening the book. */
import { showWorld } from './worlds.js';

export const DEFAULT_LOOK = { theme: 'academy', mode: 'dark', motion: 'on', room: 'on', tint: 'on', indent: 'off', font: 'literata', size: '18', lead: '1.72', width: '680' };

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

export function applyLook(look = {}) {
  const d = document.documentElement;
  const { world, mode, motion } = resolveLook(look);
  d.dataset.theme = world;
  d.dataset.world = world;
  d.dataset.mode = mode;
  d.dataset.motion = motion;
  d.dataset.room = look.room === 'off' ? 'off' : 'on';
  d.dataset.font = look.font || 'literata';
  d.dataset.tint = look.tint === 'off' ? 'off' : 'on';
  d.dataset.indent = look.indent === 'on' ? 'on' : 'off';
  d.style.setProperty('--prose-size', `${Number(look.size) || 18}px`);
  d.style.setProperty('--prose-lead', String(Number(look.lead) || 1.72));
  d.style.setProperty('--page-width', `${Number(look.width) || 680}px`);
  showWorld(world);
  for (const [id, name] of [['worldAcademy', 'academy'], ['worldTokyo', 'tokyo'], ['worldStudy', 'study']]) {
    document.getElementById(id)?.setAttribute('aria-pressed', String(world === name));
  }
  const light = document.getElementById('modeToggle');
  if (light) {
    light.setAttribute('aria-label', `Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`);
    light.title = mode === 'dark' ? 'Let the morning into your writing room' : 'Settle into your writing room at night';
    light.querySelector('.mode-word').textContent = mode === 'dark' ? 'Night' : 'Day';
  }
  const movement = document.getElementById('motionToggle');
  if (movement) {
    movement.setAttribute('aria-pressed', String(motion === 'on'));
    movement.title = motion === 'on' ? 'Pause the room’s ambient animation' : 'Let the room’s ambient animation move';
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(d).getPropertyValue('--chrome-solid').trim());
}
