/* Only the chosen room is mounted. The original picture loads on demand. */
import { academyArt } from './worlds/academy.js';
import { tokyoArt } from './worlds/tokyo.js';

let mounted = '';
export function showWorld(world) {
  const room = document.querySelector('.room');
  if (!room || mounted === world) return;
  const scene = document.createElement('div');
  scene.className = 'world-scene';
  scene.dataset.world = world;
  scene.setAttribute('aria-hidden', 'true');
  if (world === 'study') {
    /* A folded phone keeps its portrait window even when the keyboard reduces
     * its height. An open, broader screen selects the whole room automatically. */
    scene.innerHTML = '<picture class="study-picture"><source media="(max-width: 599px), (max-aspect-ratio: 4/5)" srcset="assets/room/mobile.webp"><img class="study-photo" src="assets/room/desktop.webp" alt="" decoding="async" draggable="false"></picture><div class="study-glow" aria-hidden="true"></div>';
  } else scene.innerHTML = world === 'tokyo' ? tokyoArt() : academyArt();
  room.replaceChildren(scene);
  mounted = world;
}

/* A resting tab should not spend a phone's battery painting its rain. */
const rest = () => { document.documentElement.dataset.pageHidden = String(document.hidden); };
document.addEventListener('visibilitychange', rest);
rest();
