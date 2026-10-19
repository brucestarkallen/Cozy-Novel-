/* Cozy Novel — js/novel/auto.js — SUPER AUTOMATIC (pure)
 *
 * His word (2.12.28): "my philosophy for Cozy Novel is both manual and super autonomous — both self-heal. Create one
 * universal button to make everything automatic: the notes, even the ones written by me; the bibliography, always or
 * not; the chapters; the checker — everything except the rewrite and the score judge. Super plug and play: I just
 * write premises, read, and now and then play a scene."
 *
 * One switch, Settings → Who does what → Super automatic (`house.superAuto`: {on, from}). While it is on:
 *  - What it's about and How it reads are kept by the helper (Automatic), Fill it from the book by itself and Smart
 *    recall are on, in every book — the three switches read Super automatic (`superActive`) before his own setting,
 *    which is never changed: with the switch off everything is as he set it;
 *  - the checker's fixes go in by themselves (`autoOf`), and the checker checks even where he switched it off
 *    (writer.js holderOf, checker.js checkerConn);
 *  - his own cards in the notes are kept as they always are: where they are now and how they stand with the others
 *    are the helper's, what the book adds rides beside his words as "Since then", and where the book says otherwise
 *    (quoted) the notes' check puts the book's account in their place (archivist.js foldNotes, 2.12.10–2.12.18) — his
 *    words are never handed over whole, where a reading could thin a card he wrote or take it out;
 *  - the writer ends a chapter where the story would end one, and the next page goes on in the next chapter
 *    (prompts.js CLOSE_LINE, writer.js, desk.js).
 * Never by itself: a passage under his mark written again (Write a passage under your mark again by itself stays his
 * own switch), the judge's mark, and his partner's changes when he set them to wait for Apply (Your partner's changes
 * land stays his own setting, `appliesOf` — 2.12.39).
 */

export function superOn(house) { return Boolean(house && house.superAuto && house.superAuto.on); }

/* the house as the switches of a book are read (prompts.js autoOn, context.js bibAutoOn, bibliography.js recallOn):
 * those take the book alone, so the house is read where they are — set once by the part of the app that holds the
 * records (archivist.js), never by a pure part; with none set, nothing is on by Super automatic */
let houseNow = () => null;
export function readHouseWith(fn) { if (typeof fn === 'function') houseNow = fn; }
export function superActive() { try { return superOn(houseNow()); } catch (_) { return false; } }
/* when he switched it on (with Nobody chosen to check, when the helper's connection began to: checker.js checksFromOf) */
export function superFrom(house) { return superOn(house) && Number.isFinite(house.superAuto.from) ? house.superAuto.from : null; }

/* whether the partner's changes land at once or wait for Apply — his own setting (Settings → Your instructions → Your
 * partner's changes land), in either mode. Through 2.12.38 Super automatic landed them at once over it; his word,
 * 19 October 2026: "if the setting need manual apply for partner it's still need manual apply" (2.12.39) */
export function appliesOf(house) { return house && house.partnerApplies === 'wait' ? 'wait' : 'now'; }

/* WHEN WHAT HAPPENS BY ITSELF WAS SWITCHED ON (null: off) — fix: the checker's fixes, by his own switch or by Super
 * automatic (the earlier of the two when both are on); lift: a passage under his mark written again, his own switch
 * alone. A fix goes in by itself on every passage checked while it is on, written before too (checker.js autoAfter;
 * every page is checked, in either mode, checker.js wanted); a passage is lifted only when written from then on;
 * and a page being written by itself stops the moment the switch that started it is off (writer.js runVersion). Pure. */
export function autoOf(house) {
  const on = (x) => (x && x.on && Number.isFinite(x.from) ? x.from : null);
  const own = on(house && house.autoFix);
  const all = superFrom(house);
  return { fix: own === null ? all : all === null ? own : Math.min(own, all), lift: on(house && house.autoLift) };
}
