/* Cozy Novel — js/ui/look.js — the room, the page and the type, set on the
 * document the moment they change (no refresh). */

/* how it looks to begin with — and with Back to the default look */
export const DEFAULT_LOOK = { theme: 'study', room: 'on', tint: 'on', indent: 'off', font: 'literata', size: '18', lead: '1.72', width: '680' };

export function applyLook(look = {}) {
  const d = document.documentElement;
  d.dataset.theme = look.theme || 'study';
  d.dataset.room = look.room === 'off' ? 'off' : 'on';
  d.dataset.font = look.font || 'literata';
  d.dataset.tint = look.tint === 'off' ? 'off' : 'on';
  d.dataset.indent = look.indent === 'on' ? 'on' : 'off';
  d.style.setProperty('--prose-size', `${Number(look.size) || 18}px`);
  d.style.setProperty('--prose-lead', String(Number(look.lead) || 1.72));
  d.style.setProperty('--page-width', `${Number(look.width) || 680}px`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', look.theme === 'day' ? '#faf6ef' : look.theme === 'rain' ? '#0f1622' : look.theme === 'ink' ? '#000000' : '#1b1511');
}
