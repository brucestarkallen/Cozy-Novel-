/* Saved reading colours: paired for night and day, shared by every window. */
export const COLOUR_PRESETS = {
  novel: { cozy: { name: 'Cozy dark', dark: '#182420', light: '#f3ecde' } },
  scene: { cozy: { name: 'Cozy dark', dark: '#182420', light: '#f3ecde' } },
  dialogue: { orange: { name: 'Warm orange', dark: '#f0b47b', light: '#8a430d' } },
};
export function hexColour(value) { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null; }
export function colourPair(look, kind) {
  const id = look[`${kind}Palette`];
  const raw = id === 'custom' ? look[`${kind}Custom`] : COLOUR_PRESETS[kind]?.[id] || look[`${kind}Saved`]?.[id];
  return raw && hexColour(raw.dark) && hexColour(raw.light) ? { ...raw, dark: hexColour(raw.dark), light: hexColour(raw.light) } : null;
}
export function recommendedColours(world, kind) {
  const values = {
    academy: { scene: ['#1d2a29', '#fffaf0'], dialogue: ['#edcc93', '#83530f'] },
    tokyo: { scene: ['#211c31', '#fffafd'], dialogue: ['#9bdee7', '#276b79'] },
    study: { scene: ['#30271f', '#fffaf0'], dialogue: ['#e8c49c', '#7a4d25'] },
  };
  const [dark, light] = (values[world] || values.academy)[kind === 'novel' ? 'scene' : kind];
  return { dark, light };
}
function luminance(hex) {
  const c = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
export function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
export function inkFor(background) {
  const warm = contrast(background, '#f6ecdc') >= contrast(background, '#30281f') ? '#f6ecdc' : '#30281f';
  if (contrast(background, warm) >= 4.5) return warm;
  return contrast(background, '#ffffff') >= contrast(background, '#000000') ? '#ffffff' : '#000000';
}
