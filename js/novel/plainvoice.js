/* Cozy Novel — js/novel/plainvoice.js — READ MY STANDING WORDS FOR AN ASSISTANT’S VOICE (Cozy Tavern M359, M360,
 * M363, ported whole). His own words — the three boxes, the notes at the end, his modules, his words in the
 * storyteller’s own voice — read over with no model and nothing sent: the words that make a teller sound like an
 * assistant are a short, knowable list, and every line that holds one is named where he can see it. It rewrites
 * nothing: his words are his. It only says: this line, this word, here.
 *   - BREAKS THE VOICE: the words that name the machinery (an assistant, a model, a prompt, the user, a policy) or the
 *     apologetic register nobody in a story uses ("I cannot", "I apologize", "Let me know").
 *   - SOUNDS LIKE A MANUAL: the register of documentation rather than of a person telling a story. */
export const VOICE_BREAKS = [
  ['as an ai', 'names the machine'], ['language model', 'names the machine'], ['\\bai\\b', 'names the machine'],
  ['\\bllm\\b', 'names the machine'], ['assistant', 'names the machine'], ['chatbot', 'names the machine'],
  /* M363: "User" in "User Pool Array" is a crowd of accounts on an in-story feed, not him — a user followed by the word
   * for what it is (a pool, an account, a handle, a list…) is someone ELSE's user, and is left alone */
  ['\\buser\\b(?!\\s*(?:pool|account|accounts|name|names|handle|handles|list|base|id|ids|count|profile|profiles|array|feed|post|posts)\\b)', 'calls him the user'],
  ['end user', 'calls him the user'],
  ['system prompt', 'names the machinery'], ['\\bprompt\\b', 'names the machinery'], ['\\btoken', 'names the machinery'],
  ['guidelines', 'names the rules of a machine'], ['\\bpolicy\\b', 'names the rules of a machine'], ['content policy', 'names the rules of a machine'],
  ['openai', 'names the maker'], ['anthropic', 'names the maker'], ['\\bgpt\\b', 'names the maker'], ['\\bclaude\\b', 'names the maker'],
  ['i cannot', 'the apologetic register'], ['i can.t help', 'the apologetic register'], ['i.m unable', 'the apologetic register'],
  ['i apologi', 'the apologetic register'], ['i.m sorry', 'the apologetic register'],
  ['let me know', 'talks to a customer'], ['feel free', 'talks to a customer'], ['i hope this helps', 'talks to a customer'],
  ['is there anything else', 'talks to a customer'], ['happy to help', 'talks to a customer'],
];
export const MANUAL_WORDS = [
  ['\\boutput\\b', 'documentation, not story'], ['\\binput\\b', 'documentation, not story'], ['\\bresponse\\b', 'documentation, not story'],
  ['\\bgenerate', 'documentation, not story'], ['\\bformat\\b', 'documentation, not story'], ['step.by.step', 'documentation, not story'],
  ['bullet point', 'documentation, not story'], ['\\bensure\\b', 'the register of a manual'], ['\\butilize', 'the register of a manual'],
  ['\\bdelve', 'the register of a manual'], ['it.s important to', 'the register of a manual'], ['\\bnote that\\b', 'the register of a manual'],
  ['in conclusion', 'the register of a manual'], ['\\boverall,', 'the register of a manual'],
];

const lineAt = (text, at) => {
  const from = text.lastIndexOf('\n', at) + 1;
  const to = text.indexOf('\n', at);
  return text.slice(from, to === -1 ? text.length : to).trim();
};

/* every line of his standing words that would make a teller sound like an assistant — ONE finding per line, with every
 * word in it that does it (a line is read once, not once per word) */
export function assistantVoice(text, { where = '' } = {}) {
  const body = String(text || '');
  if (!body.trim()) return [];
  const byLine = new Map();
  for (const [list, tier] of [[VOICE_BREAKS, 'breaks the voice'], [MANUAL_WORDS, 'sounds like a manual']]) {
    for (const [pattern, why] of list) {
      const re = new RegExp(pattern, 'ig');
      let hit;
      while ((hit = re.exec(body)) !== null) {
        const line = lineAt(body, hit.index);
        if (!line) continue;
        const kept = byLine.get(line) || { where, tier, why, line: line.length > 160 ? line.slice(0, 160) + '…' : line, full: line, words: [] };
        if (!kept.words.some((w) => w.toLowerCase() === hit[0].toLowerCase())) kept.words.push(hit[0]);
        if (tier === 'breaks the voice') { kept.tier = tier; if (!kept.why || kept.why === why) kept.why = why; }
        byLine.set(line, kept);
        if (byLine.size >= 120) break;
      }
    }
  }
  return [...byLine.values()];
}

/* the same, over every piece of standing words at once: [{name, text, mine}] -> the findings, worst first.
 * `mine` marks the words HE wrote (his frame, this tale's frame, his own rules) apart from the app's own rules. */
export function readStandingWords(pieces = []) {
  const out = [];
  for (const piece of Array.isArray(pieces) ? pieces : []) {
    if (!piece || typeof piece.text !== 'string') continue;
    for (const found of assistantVoice(piece.text, { where: String(piece.name || '') })) out.push({ ...found, mine: piece.mine !== false });
  }
  return out.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'breaks the voice' ? -1 : 1));
}

/* M360: FIFTY LINES IS NOT FIFTY PROBLEMS. A preset that instructs a storyteller is allowed to sound like instruction;
 * what breaks a teller's voice is the words that name the APPARATUS (an assistant, the user, a prompt, a policy) and
 * the apologetic register — and only where HE wrote them. The app's own rules are spoken in his voice when they are
 * sent (teller.js) and are not his to fix. So the reading is grouped: what matters, what is only register, and
 * what is not his at all. */
export function groupFindings(found = []) {
  const all = Array.isArray(found) ? found : [];
  const mine = all.filter((f) => f && f.mine !== false);
  return {
    machine: mine.filter((f) => f.tier === 'breaks the voice'),
    manual: mine.filter((f) => f.tier !== 'breaks the voice'),
    house: all.filter((f) => f && f.mine === false).length,
  };
}
/* the flagged lines as plain text — what he can hand to someone who will rewrite them, instead of the whole preset */
export function findingsText(found = []) {
  const { machine, manual } = groupFindings(found);
  /* M361: the WHOLE line — a line cut off with "…" cannot be rewritten by whoever it is handed to */
  const say = (f) => '— ' + f.where + ': ' + (f.full || f.line) + '\n  (' + f.words.join(', ') + ')';
  const out = [];
  if (machine.length) out.push('Lines that name the machine (' + machine.length + '):', ...machine.map(say));
  if (manual.length) out.push('', 'Lines that read like a manual (' + manual.length + '):', ...manual.map(say));
  return out.join('\n');
}
