/* Cozy Novel — js/novel/summarycheck.js — THE SUMMARY CHECK (pure)
 *
 * Cozy Tavern's continuous audit and its keeper's detail check, for a book:
 * every summary the helper writes — a chapter's, a stretch's, a scene's
 * stretch — is held once against the words it stands for, and what the check
 * finds is put right in the summary itself. A fast model checks well what it
 * may write badly; and what it says is taken only where the words prove it,
 * so a check can put a summary right but never make it wrong:
 *
 *   - a wrong fact is mended only when the wrong words stand in the summary
 *     and the right words stand in the chapter (Cozy Tavern's applyAuditFixes:
 *     "both must appear exactly");
 *   - something left out is added only as one sentence that rests on words
 *     the chapter holds, with no figure the chapter never gives and no name
 *     it never names, after the sentence it follows;
 *   - and a summary the mends would leave with fewer of the chapter's names,
 *     or more figures it never gives, keeps its own words.
 *
 * Nothing here asks a model or touches the store (archivist.js does both).
 */
import { hashText, countWords } from '../util.js';
import { tokensMissing, figuresInvented, foldedText, nameInText } from './names.js';

export const MAX_FIXES = 6;
export const MAX_ADDS = 3;
export const ADD_WORDS = 80;

/* the words a check was made of: a summary is due again whenever its words are not these */
export const checkSig = (text) => hashText(String(text || '').trim());
export function checkedNow(entry) {
  return Boolean(entry && entry.checked && entry.checked.sig === checkSig(entry.text));
}

/* words compared as a reader sees them: case, spacing and the shape of quote marks aside */
const plain = (s) => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();
const has = (hay, needle) => Boolean(plain(needle)) && plain(hay).includes(plain(needle));

/* a name the sentence gives that neither the chapter nor the summary holds: a
 * capitalised word — its first word too, unless it is an ordinary word the
 * words themselves use ("The", "She") */
const OPENERS = new Set(['the', 'a', 'an', 'he', 'she', 'they', 'it', 'his', 'her', 'their', 'its', 'when', 'then', 'after', 'before', 'as', 'in', 'on', 'at', 'by', 'with', 'but', 'and', 'later', 'meanwhile', 'there', 'this', 'that', 'both', 'neither', 'no', 'one', 'once', 'while', 'until', 'so', 'yet', 'i', 'we', 'you']);
function strangeNames(add, source, summary) {
  const out = [];
  const known = foldedText(`${source}\n${summary}`);
  const words = ` ${plain(source)} `;
  for (const m of String(add || '').matchAll(/(?<![\p{L}\p{N}'’-])(\p{Lu}[\p{L}'’-]*)(?![\p{L}])/gu)) {
    const w = m[1].replace(/['’]s$/i, '');
    if (w.length < 2) continue;
    const first = !String(add).slice(0, m.index).trim() || /[.!?…]["”’)]*\s*$/.test(String(add).slice(0, m.index));
    if (first && (OPENERS.has(w.toLowerCase()) || words.includes(` ${w.toLowerCase()} `))) continue;
    if (!nameInText(known, w, { words: false })) out.push(w);
  }
  return out;
}

/* the names a text gives that the words also give: every capitalised word of it found in them as a name */
function namesOf(text, source) {
  const known = foldedText(source);
  const out = new Set();
  for (const m of String(text || '').matchAll(/(?<![\p{L}\p{N}'’-])(\p{Lu}[\p{L}'’-]+)(?![\p{L}])/gu)) {
    const w = m[1].replace(/['’]s$/i, '');
    if (w.length >= 2 && !OPENERS.has(w.toLowerCase()) && nameInText(known, w, { words: false }) && new RegExp(`(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u').test(source)) out.add(w);
  }
  return [...out];
}

/* where an added sentence goes: after the sentence holding `after`, or at the end */
function sentenceEnd(text, at) {
  const re = /[.!?…]["”’)]*(?=\s|$)/g;
  re.lastIndex = at;
  const m = re.exec(text);
  return m ? m.index + m[0].length : text.length;
}

/* The check's answer laid into the summary: {text, fixed: [{from, to}],
 * added: [sentence], refused: [why]} — text unchanged when nothing stood.
 * Every place is found in the summary as it was written, so a mend and an
 * addition after the sentence it mends both land. */
export function applyCheck(summary, answer, source) {
  const original = String(summary || '');
  const src = String(source || '');
  const refused = [];
  const fixed = [];
  const edits = [];
  for (const x of (Array.isArray(answer && answer.wrong) ? answer.wrong : []).slice(0, MAX_FIXES * 2)) {
    if (fixed.length >= MAX_FIXES) break;
    const from = typeof (x && x.summary) === 'string' ? x.summary.trim() : '';
    const to = typeof (x && x.words) === 'string' ? x.words.trim() : '';
    if (!from || !to || from === to) continue;
    if (!original.includes(from)) { refused.push(`“${from}” is not in the summary`); continue; }
    if (!has(src, to)) { refused.push(`“${to}” is not in the words it stands for`); continue; }
    if (to.length > 240) { refused.push(`“${to.slice(0, 40)}…” is more than a mend`); continue; }
    const at = original.indexOf(from);
    if (edits.some((p) => at < p.end && p.start < at + from.length)) continue;
    edits.push({ start: at, end: at + from.length, to });
    fixed.push({ from, to });
  }
  const added = [];
  for (const x of (Array.isArray(answer && answer.missing) ? answer.missing : []).slice(0, MAX_ADDS * 2)) {
    if (added.length >= MAX_ADDS) break;
    const add = typeof (x && x.add) === 'string' ? x.add.trim().replace(/\s+/g, ' ') : '';
    const rests = typeof (x && x.words) === 'string' ? x.words.trim() : '';
    const after = typeof (x && x.after) === 'string' ? x.after.trim() : '';
    if (!add) continue;
    if (countWords(add) > ADD_WORDS) { refused.push('an addition longer than a sentence'); continue; }
    if (countWords(rests) < 3 || !has(src, rests)) { refused.push(`“${add.slice(0, 40)}…” rests on no words it stands for`); continue; }
    if (figuresInvented(src, add).length) { refused.push(`“${add.slice(0, 40)}…” gives a figure the words never give`); continue; }
    const names = strangeNames(add, src, original);
    if (names.length) { refused.push(`“${add.slice(0, 40)}…” names ${names[0]}, whom the words never name`); continue; }
    if (has(original, add) || added.some((a) => has(a, add))) continue;
    const sentence = /[.!?…]["”’)]*$/.test(add) ? add : `${add}.`;
    let i = after && original.includes(after) ? sentenceEnd(original, original.indexOf(after) + after.length - 1) : original.length;
    /* never inside a mend: after it */
    for (const p of edits) if (i > p.start && i < p.end) i = sentenceEnd(original, p.end);
    edits.push({ start: i, end: i, to: ` ${sentence}`, add: true });
    added.push(sentence);
  }
  edits.sort((a, b) => a.start - b.start || (a.add ? 1 : 0) - (b.add ? 1 : 0));
  let text = '';
  let at = 0;
  for (const p of edits) { text += original.slice(at, p.start) + p.to; at = p.end; }
  text = (text + original.slice(at)).replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trim();
  if (!fixed.length && !added.length) return { text: original, fixed, added, refused };
  /* never a summary made worse by its mends: a name of the words' it gave now gone, fewer of their names, more figures
   * they never give, or much of it cut away (Cozy Tavern's shrink guard) */
  const before = tokensMissing(src, original).names.length;
  const after = tokensMissing(src, text).names.length;
  const lostName = namesOf(original, src).some((n) => !namesOf(text, src).includes(n));
  if (lostName || after > before || text.length < original.length * 0.6 || figuresInvented(src, text).length > figuresInvented(src, original).length) {
    return { text: original, fixed: [], added: [], refused: [...refused, 'the mends would have left it with less of the words than before'] };
  }
  return { text, fixed, added, refused };
}
