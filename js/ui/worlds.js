/* Two rooms drawn with paths, ink and light. Only the room on show is mounted. */
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
  scene.innerHTML = world === 'tokyo' ? tokyoArt() : academyArt();
  room.replaceChildren(scene);
  mounted = world;
}

/* A resting tab should not spend a phone's battery painting its rain. */
const rest = () => { document.documentElement.dataset.pageHidden = String(document.hidden); };
document.addEventListener('visibilitychange', rest);
rest();
