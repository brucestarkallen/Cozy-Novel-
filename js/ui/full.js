/* Cozy Novel — js/ui/full.js — FULL SCREEN, for the writing page, a scene or the partner,
 * one at a time. The browser's own bars go too where it allows. The phone's
 * Back, the button in the corner, or the browser leaving full screen by
 * itself (Back, Escape, a swipe) brings everything back.
 *
 * Two moments keep it: going to another app and coming back (the browser
 * drops its own full screen meanwhile — the bars inside the app stay hidden
 * and the next tap asks for the whole screen again), and moving to another
 * chapter (what is open closes as always, the browser stays full, and the
 * page goes full again where it lands: holdFull). */

import { onBack } from './dom.js';

let current = null;     /* { kind, undo, release } */
let holding = false;    /* a move to another chapter: the app's full screen is left and taken again */
let away = 0;           /* when the phone last came back to this page from another app */

export function enterFull(kind, apply, undo) {
  if (current) leave(current, false, true);
  apply();
  const e = { kind, undo, release: null };
  current = e;
  e.release = onBack(() => leave(e, true));
  askScreen();
}
export function leaveFull() { if (current) leave(current, false); }
export function fullKind() { return current ? current.kind : null; }
export function holdFull(on) { holding = Boolean(on); }

function askScreen() {
  try {
    const d = document.documentElement;
    if (d.requestFullscreen && !document.fullscreenElement) d.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  } catch (_) { /* the bars inside the app go even where the browser keeps its own */ }
}

function leave(e, fromBack, keepScreen = false) {
  if (current !== e) return;
  current = null;
  try { e.undo(); } catch (err) { console.error(err); }
  if (!fromBack && e.release) e.release();
  if (keepScreen || holding) return;
  try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (_) { /* nothing to give back */ }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') away = Date.now(); });
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement || !current || holding) return;
  /* back from another app: the browser let go of the screen on the way out */
  if (Date.now() - away < 1500) {
    document.addEventListener('click', () => { if (current) askScreen(); }, { capture: true, once: true });
    return;
  }
  leave(current, false, true);
});
