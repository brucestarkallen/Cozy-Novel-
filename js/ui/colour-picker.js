import { h, field, toast, undoToast } from './dom.js';
import { newId } from '../util.js';
import { COLOUR_PRESETS, colourPair, recommendedColours, hexColour, inkFor, contrast } from './look-colours.js';
import { resolveLook } from './look.js';

export function colourPicker(kind, read, update) {
  const title = kind === 'novel' ? 'Novel highlight colour' : kind === 'scene' ? 'Scene highlight colour' : 'Dialogue colour';
  const enabled = kind !== 'dialogue' ? h('input', { type: 'checkbox' }) : null;
  enabled?.addEventListener('change', () => update({ [`${kind}Highlight`]: enabled.checked ? 'on' : 'off' }));
  const choose = h('select', { 'aria-label': title + ' preset' });
  const night = h('input', { type: 'color', 'aria-label': title + ' at night' });
  const day = h('input', { type: 'color', 'aria-label': title + ' by day' });
  const name = h('input', { type: 'text', maxlength: 60, placeholder: 'A name to keep', 'aria-label': title + ' name' });
  const preview = h('div.colour-preview', h('span', 'Rain tapped against the window. '), h('span.colour-dialogue', '“Stay for one more chapter.”'));
  const hint = h('p.say.quiet');
  const remove = h('button.btn.quiet.small', { title: 'Remove this saved colour pair. The recommended colours return.', onclick: () => {
    const id = read()[`${kind}Palette`];
    const before = read()[`${kind}Saved`]?.[id];
    if (!before) return;
    update(look => { const saved = { ...(look[`${kind}Saved`] || {}) }; delete saved[id]; return { ...look, [`${kind}Saved`]: saved, [`${kind}Palette`]: 'default' }; });
    undoToast('Saved colour removed.', () => update(look => ({ ...look, [`${kind}Saved`]: { ...(look[`${kind}Saved`] || {}), [id]: before }, [`${kind}Palette`]: id })));
  } }, 'Remove saved colour');
  let signature = '';
  const refresh = () => {
    const look = read(), { world, mode } = resolveLook(look);
    if (enabled) enabled.checked = look[`${kind}Highlight`] !== 'off';
    const saved = Object.entries(look[`${kind}Saved`] || {}).filter(([, p]) => p && hexColour(p.dark) && hexColour(p.light));
    const options = [['default', 'Recommended for this room'], ...Object.entries(COLOUR_PRESETS[kind]).map(([id, p]) => [id, p.name]), ...saved.map(([id, p]) => [id, p.name || 'Saved colour']), ['custom', 'Custom colours']];
    const next = JSON.stringify(options);
    if (signature !== next) { signature = next; choose.replaceChildren(...options.map(([id, label]) => h('option', { value: id }, label))); }
    const selected = look[`${kind}Palette`] || 'default';
    choose.value = options.some(([id]) => id === selected) ? selected : 'default';
    const pair = colourPair(look, kind) || recommendedColours(world, kind);
    if (night.value !== pair.dark) night.value = pair.dark;
    if (day.value !== pair.light) day.value = pair.light;
    remove.hidden = !saved.some(([id]) => id === selected);
    const surface = kind === 'novel' ? 'novel' : 'scene';
    const scene = colourPair(look, surface) || recommendedColours(world, surface);
    const dialogue = colourPair(look, 'dialogue') || recommendedColours(world, 'dialogue');
    preview.style.background = scene[mode]; preview.style.color = inkFor(scene[mode]);
    if (look[`${surface}Highlight`] === 'off') { preview.style.background = 'var(--chrome-solid)'; preview.style.color = 'var(--chrome-ink)'; }
    preview.querySelector('.colour-dialogue').style.color = look.tint === 'off' ? 'inherit' : dialogue[mode];
    const low = contrast(scene[mode], dialogue[mode]) < 4.5;
    hint.textContent = enabled && !enabled.checked ? 'Highlight is off: a plain reading surface replaces the coloured paper. Your colours stay saved.' : kind === 'novel' ? 'The writer’s novel page, including reading mode. Night and day switch together with your room.' : kind === 'scene' ? 'The narrator’s page in scenes, including full screen. Night and day switch together with your room.' : look.tint === 'off' ? 'Turn on Tint the dialogue to see these colours in the book and scenes.' : low ? 'This dialogue colour has low contrast against your scene highlight. Try a lighter night colour or a darker day colour.' : 'Spoken words in the book and scenes. Night and day switch together with your room.';
  };
  choose.addEventListener('change', () => update({ [`${kind}Palette`]: choose.value }));
  const edit = () => update({ [`${kind}Palette`]: 'custom', [`${kind}Custom`]: { dark: night.value, light: day.value } });
  night.addEventListener('input', edit); day.addEventListener('input', edit);
  const save = h('button.btn.small', { title: 'Keep both colours under this name, without replacing your other saved colours.', onclick: () => {
    const label = name.value.trim();
    if (!label) { toast('Give this colour pair a name.'); name.focus(); return; }
    const id = newId(), pair = { name: label, dark: night.value, light: day.value };
    update(look => ({ ...look, [`${kind}Saved`]: { ...(look[`${kind}Saved`] || {}), [id]: pair }, [`${kind}Palette`]: id }));
    name.value = ''; toast('Colour pair saved.');
  } }, 'Save colours');
  const reset = h('button.btn.quiet.small', { title: 'Use the recommended colours for the current room. Your saved colours stay available.', onclick: () => update({ [`${kind}Palette`]: 'default' }) }, 'Back to default');
  const box = h('section.reading-colours', { 'aria-label': title }, h('h4', title),
    ...(enabled ? [h('label.toggle', enabled, h('span', kind === 'novel' ? 'Highlight the novel' : 'Highlight scenes'))] : []), field('Colour preset', choose),
    h('div.fieldrow', field('Night', night), field('Day', day)), preview, hint,
    h('div.colour-save', field('Save a colour pair', name), save), h('div.btnrow', reset, remove),
    h('p.say.quiet', 'Back to default follows your room again. Your saved colours stay here.'));
  refresh();
  return { box, refresh };
}
