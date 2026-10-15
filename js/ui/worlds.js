/* Only the chosen room is mounted. The original picture loads on demand. */
import { academyArt } from './worlds/academy.js';
import { tokyoArt } from './worlds/tokyo.js';

let mounted = '', prepared = false;
export function showWorld(world) {
  const room = document.querySelector('.room');
  if (!room) return;
  if (mounted === world) {
    if (!prepared && document.documentElement.dataset.room !== 'off') prepared = compositeMotion(room.querySelector('.world-art'));
    return;
  }
  const scene = document.createElement('div');
  scene.className = 'world-scene';
  scene.dataset.world = world;
  scene.setAttribute('aria-hidden', 'true');
  if (world === 'study') {
    /* A folded phone keeps its portrait window even when the keyboard reduces
     * its height. An open, broader screen selects the whole room automatically. */
    scene.innerHTML = '<picture class="study-picture"><source media="(max-width: 599px)" srcset="assets/room/mobile.webp"><img class="study-photo" src="assets/room/desktop.webp" alt="" decoding="async" draggable="false"></picture><div class="study-glow" aria-hidden="true"></div>';
  } else scene.innerHTML = world === 'tokyo' ? tokyoArt() : academyArt();
  room.replaceChildren(scene);
  prepared = document.documentElement.dataset.room !== 'off' && compositeMotion(scene.querySelector('.world-art'));
  mounted = world;
}

/* SVG subgroup animations invalidate the whole drawing on every frame in
 * Chromium. A small HTML motion surface inside the same SVG keeps its place,
 * clipping and colours, while the compositor moves a cached drawing. Bounds
 * are read together once on mounting; these are local shapes, never a stack
 * of full-screen copies. Nothing runs in JavaScript on animation frames. */
function compositeMotion(art) {
  if (!art) return true;
  if (!art.getBoundingClientRect().width) return false;
  const svgNS = 'http://www.w3.org/2000/svg';
  const moving = art.querySelectorAll([
    '.academy-cloud', '.academy-ivy', '.academy-quill', '.academy-ink-ribbon',
    '.academy-ink-sparks', '.academy-flame', '.academy-candle-glow',
    '.tokyo-rain', '.tokyo-clouds', '.tokyo-neon', '.tokyo-steam', '.tokyo-train',
  ].join(','));
  const shapes = [...moving].map(node => ({ node, bounds: node.getBBox() }));
  for (const { node, bounds: b } of shapes) {
    if (!b.width || !b.height) continue;
    const surface = document.createElementNS(svgNS, 'foreignObject');
    surface.setAttribute('class', 'world-motion-surface');
    for (const [key, value] of Object.entries({ x: b.x, y: b.y, width: b.width, height: b.height })) {
      surface.setAttribute(key, value);
    }
    const motion = document.createElement('div');
    motion.className = `${node.getAttribute('class')} world-motion`;
    const drawing = document.createElementNS(svgNS, 'svg');
    drawing.setAttribute('viewBox', `${b.x} ${b.y} ${b.width} ${b.height}`);
    drawing.setAttribute('width', '100%');
    drawing.setAttribute('height', '100%');
    drawing.setAttribute('aria-hidden', 'true');
    drawing.setAttribute('focusable', 'false');
    node.removeAttribute('class');
    node.replaceWith(surface);
    drawing.append(node);
    motion.append(drawing);
    surface.append(motion);
  }
  return true;
}

/* A resting tab should not spend a phone's battery painting its rain. */
const rest = () => { document.documentElement.dataset.pageHidden = String(document.hidden); };
document.addEventListener('visibilitychange', rest);
rest();
