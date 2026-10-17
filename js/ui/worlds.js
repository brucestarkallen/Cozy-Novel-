/* Only the chosen room is mounted. The original picture loads on demand.
 *
 * Every room is laid out the same way, in this order: the still drawing
 * (one picture the phone draws once), the desk's veil (a light tint, part of
 * that same picture), then whatever moves (small layers the phone's
 * compositor slides by transform and opacity, nothing drawn again for them),
 * and last the shelf's veil (the shade its words need, over everything, as
 * it always was — the one screen-sized layer the shelf keeps). What moves
 * comes after the desk's veil on purpose: a thing that moves makes the phone
 * keep a separate picture of everything drawn after it, each one the size
 * of the screen — that was the lag (2.12.5). Only one veil shows at a time
 * (css: .world-veil.under on the desk, .over on the shelf). */
import { academyArt } from './worlds/academy.js';
import { tokyoArt } from './worlds/tokyo.js';

const VEIL_UNDER = '<div class="world-veil under" aria-hidden="true"></div>';
const VEIL_OVER = '<div class="world-veil over" aria-hidden="true"></div>';

let mounted = '', prepared = false;
export function showWorld(world) {
  const room = document.querySelector('.room');
  if (!room) return;
  if (mounted === world) {
    if (!prepared && document.documentElement.dataset.room !== 'off') prepared = liftMotion(room.querySelector('.world-scene'));
    return;
  }
  const scene = document.createElement('div');
  scene.className = 'world-scene';
  scene.dataset.world = world;
  scene.setAttribute('aria-hidden', 'true');
  if (world === 'study') {
    /* A folded phone keeps its portrait window even when the keyboard reduces
     * its height. An open, broader screen selects the whole room automatically. */
    scene.innerHTML = `<picture class="study-picture"><source media="(max-width: 599px)" srcset="assets/room/mobile.webp"><img class="study-photo" src="assets/room/desktop.webp" alt="" decoding="async" draggable="false"></picture>${VEIL_UNDER}<div class="study-glow" aria-hidden="true"></div>${VEIL_OVER}`;
  } else if (world === 'tokyo') scene.innerHTML = tokyoArt(VEIL_UNDER, VEIL_OVER);
  else scene.innerHTML = `${academyArt()}${VEIL_UNDER}${VEIL_OVER}`;
  room.replaceChildren(scene);
  prepared = document.documentElement.dataset.room !== 'off' && liftMotion(scene);
  mounted = world;
}

/* The Academy's moving pieces — the flames, the candles' glow, the ivy, the
 * quill, the ink and its sparks — are lifted out of the drawing into a second
 * drawing laid exactly over it, each on a small surface the compositor moves
 * on its own. Inside the one drawing they split it into pictures the size of
 * the screen (everything drawn after a moving piece has to sit above it).
 * Each surface is the piece's own box, padded for where its movement takes
 * it, so nothing is cut off at the edge. Bounds are read once on mounting;
 * nothing runs in JavaScript on animation frames. Returns whether it could
 * (a hidden room has no size yet: tried again when it shows). */
const MOTION = [
  /* class → room around the shape for its movement, in the drawing's own units */
  ['.academy-ivy', 8], ['.academy-quill', 4], ['.academy-ink-ribbon', 10],
  ['.academy-ink-sparks', 6], ['.academy-flame', 4], ['.academy-candle-glow', 0],
];
function liftMotion(scene) {
  const art = scene && scene.querySelector('.world-art.academy-art');
  if (!art) return true;
  if (!art.getBoundingClientRect().width) return false;
  const svgNS = 'http://www.w3.org/2000/svg';
  const moving = [...art.querySelectorAll(MOTION.map(([q]) => q).join(','))];
  if (!moving.length) return true;
  const padOf = (node) => (MOTION.find(([q]) => node.matches(q)) || [null, 4])[1];
  /* bounds and transform origins read before anything moves */
  const shapes = moving.map((node) => {
    const b = node.getBBox();
    const origin = getComputedStyle(node).transformOrigin.split(' ').map(parseFloat);
    return { node, b, origin, pad: padOf(node) };
  });
  const overlay = document.createElementNS(svgNS, 'svg');
  overlay.setAttribute('class', 'academy-art academy-motion');
  overlay.setAttribute('viewBox', art.getAttribute('viewBox'));
  overlay.setAttribute('preserveAspectRatio', art.getAttribute('preserveAspectRatio') || 'xMidYMid slice');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('focusable', 'false');
  for (const { node, b, origin, pad } of shapes) {
    if (!b.width || !b.height) { node.remove(); continue; }
    const x = b.x - pad, y = b.y - pad, w = b.width + pad * 2, h = b.height + pad * 2;
    const surface = document.createElementNS(svgNS, 'foreignObject');
    surface.setAttribute('class', 'world-motion-surface');
    for (const [key, value] of Object.entries({ x, y, width: w, height: h })) surface.setAttribute(key, value);
    const motion = document.createElement('div');
    motion.className = `${node.getAttribute('class')} world-motion`;
    /* the piece turns about the point its rule names on its own shape — the padding moved the box, not the point */
    if (origin.length >= 2 && origin.every(Number.isFinite)) motion.style.transformOrigin = `${origin[0] + pad}px ${origin[1] + pad}px`;
    const drawing = document.createElementNS(svgNS, 'svg');
    drawing.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    drawing.setAttribute('width', '100%');
    drawing.setAttribute('height', '100%');
    drawing.setAttribute('aria-hidden', 'true');
    drawing.setAttribute('focusable', 'false');
    node.removeAttribute('class');
    node.remove();
    drawing.append(node);
    motion.append(drawing);
    surface.append(motion);
    overlay.append(surface);
  }
  /* the still drawing, the desk's veil, what moves, the shelf's veil */
  scene.insertBefore(overlay, scene.querySelector('.world-veil.over'));
  return true;
}

/* A resting tab should not spend a phone's battery painting its rain. */
const rest = () => { document.documentElement.dataset.pageHidden = String(document.hidden); };
document.addEventListener('visibilitychange', rest);
rest();
