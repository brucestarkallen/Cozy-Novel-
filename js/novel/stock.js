/* Cozy Novel — js/novel/stock.js — STOCK WORDING, COUNTED.
 *
 * The phrases machine-made fiction reaches for far more often than people
 * who write books do, found by count rather than by asking a model: a model
 * reading for them misses most of them (Measuring AI "Slop", arXiv
 * 2509.19163: its judges flagged a few in a hundred where readers flagged a
 * third).
 *
 * Where the list comes from: the Antislop phrase list (sam-paech/antislop-
 * sampler, slop_phrases_2025-04-07.json, Apache-2.0 — the phrases most
 * frequent in a large set of machine-written stories) ranked against
 * EQ-Bench's baseline of human writing (EQ-bench/creative-writing-bench,
 * data/human_writing_profile.json), the way the Antislop paper ranks them
 * (arXiv 2510.15061: how much more often a phrase stands in that writing
 * than in books people write). Only phrases hundreds of times more common
 * there are here. A phrase people use about as much — "took a deep breath",
 * the commonest three words of the human baseline, "took a step back", "one
 * last time", "her heart skipped a beat" — is not. A few more come from the
 * Antislop sampler's own hand-kept list ("a testament to", "maybe, just
 * maybe", "a tapestry woven…").
 *
 * Beside them, the swivel — "It wasn't fear. It was relief.", "It's not
 * about X, it's Y", "Not fear, but…" — Antislop's own pattern (several times
 * more common in that writing), and a construct his craft bans in narration.
 *
 * Only narration is read: what people say inside quotation marks is theirs.
 * Pure: no store, no screen. */

import { countWords } from '../util.js';

const P = '(?:my|his|her|their|your|its|our)';

/* each a family: the forms the counts found, a pronoun or a tense apart */
export const STOCK = [
  /* the voice */
  String.raw`\bvoice\s+(?:was\s+)?barely\s+(?:above\s+a\s+whisper|a\s+whisper|a\s+breath|audible)\b`,
  String.raw`\bvoice\s+(?:was\s+)?(?:laced|tinged|dripping)\s+with\b`,
  String.raw`\bvoice\s+(?:surprisingly\s+)?steady\s+despite\b`,
  String.raw`\bvoice\s+trembling\s+slightly\b`,
  String.raw`\bvoice\s+(?:a\s+)?low,?\s+(?:rumble|growl)\b`,
  String.raw`\bvoice\s+devoid\s+of\b`,
  String.raw`\bvoice\s+(?:low|calm)\s+and\s+(?:measured|menacing|dangerous|gravelly)\b`,
  String.raw`\bvoice\s+steady\s+and\s+resolute\b`,
  String.raw`\blow,\s+resonant\b`,
  String.raw`\blow,\s+guttural\s+growl\b`,
  String.raw`\bwhisper(?:ed|ing|s)?\s+(?:about\s+)?in\s+hushed\s+tones\b`,
  /* the body standing in for a feeling */
  String.raw`\bheart\s+(?:hammered|hammering|hammers|pounded|pounding|pounds|thundered|thundering)\s+(?:against\s+${P}\s+(?:ribs|ribcage|chest|sternum)|in\s+${P}\s+chest)\b`,
  String.raw`\bheart\s+(?:pounding|racing|hammering)\s+with\s+(?:anticipation|a\s+mix(?:ture)?)\b`,
  String.raw`\bheart\s+heavy\s+with\b`,
  String.raw`\bheart\s+swelling\s+with\s+pride\b`,
  String.raw`\b(?:shivers?|chills?)\s+(?:ran|run|running|runs|raced|racing|crept|creeping|went|going|crawled|trickled)\s+(?:down|up)\s+${P}\s+spine\b`,
  String.raw`\bsen(?:t|d|ds|ding)\s+(?:a\s+)?(?:shivers?|chills?)\s+(?:down|up|through)\b`,
  String.raw`\bmind\s+(?:racing|raced|reeling|reeled)\s+(?:with|as)\b`,
  String.raw`,\s+${P}\s+mind\s+(?:already\s+)?(?:racing|reeling)\b`,
  String.raw`\bmind\s+raced,\s+trying\b`,
  String.raw`\bbrows?\s+(?:furrowed|furrowing|knitted)\s+(?:in|with)\s+(?:confusion|concentration|concern|thought|worry)\b`,
  String.raw`\b(?:smile|smirk|grin)\s+(?:playing|tugging|twitching)\s+(?:on|at)\s+(?:the\s+corners?\s+of\s+)?${P}\s+(?:lips|mouth)\b`,
  String.raw`\btugging\s+at\s+the\s+corners?\s+of\s+${P}\s+(?:mouth|lips)\b`,
  String.raw`\b(?:smile|grin|smirk)\s+spreading\s+across\b`,
  String.raw`\bknuckles\s+(?:turning|turned|going|gone)\s+white\b`,
  String.raw`\blump\s+(?:form|formed|forming|forms)\s+in\s+${P}\s+throat\b`,
  String.raw`\bswallowed\s+hard,\s+${P}\s+(?:mind|mouth|heart)\b`,
  String.raw`\b(?:panic|fear|dread|terror)\s+clawed\s+at\b`,
  String.raw`\bcold\s+dread\s+(?:creep|creeping|crept|settle|settled|settling|pooled|coiled)\b`,
  String.raw`\bfelt\s+a\s+cold\s+dread\b`,
  String.raw`\b(?:strange|odd),?\s+tingling\s+sensation\b`,
  String.raw`\bdeep\s+breath,\s+steel(?:ing|ed)\b`,
  String.raw`\btast(?:ed|ing|es)?\s+like\s+ash(?:es)?\b`,
  String.raw`\blike\s+ash(?:es)?\s+(?:in|on)\s+${P}\s+(?:mouth|tongue)\b`,
  String.raw`\bmetallic\s+tang\b`,
  /* feelings named the stock way */
  String.raw`\b(?:growing|strange|profound|renewed|newfound)\s+sense\s+of\s+(?:unease|dread|purpose|peace|calm|awe|foreboding|pride|wonder|relief|belonging|urgency)\b`,
  String.raw`\b(?:feel|felt|feeling)\s+a\s+sense\s+of\s+(?:peace|purpose|pride|calm|awe|excitement|unease|dread)\b`,
  String.raw`\b(?:couldn['’]t|could\s+not|can['’]t|cannot)\s+help\s+but\s+(?:feel|wonder|marvel|chuckle|glance)\b`,
  String.raw`\b(?:couldn['’]t|could\s+not|can['’]t|cannot)\s+shake\s+(?:off\s+)?the\s+feeling\b`,
  String.raw`\b(?:a\s+)?(?:mixture|mix)\s+of\s+(?:fear|awe|excitement|trepidation|curiosity|determination|relief|anticipation|wonder|amusement|surprise|confusion|concern|anger|sadness|disbelief)\s+and\s+(?:fear|awe|excitement|trepidation|curiosity|determination|relief|anticipation|wonder|amusement|surprise|confusion|concern|anger|sadness|disbelief|admiration|respect)\b`,
  String.raw`\b(?:eyes|faces?|voice)\s+(?:filled|etched|wide)\s+with\s+a\s+(?:mixture|mix)\b`,
  String.raw`\bfaces?\s+etched\s+with\b`,
  String.raw`\beyes\s+wide\s+with\s+(?:wonder|disbelief|terror)\b`,
  String.raw`\b(?:flicker|glimmer)\s+of\s+something\b`,
  String.raw`\b(?:felt|feel)\s+a\s+(?:flicker|glimmer)\s+of\s+hope\b`,
  String.raw`\b(?:wave|sense|rush|flood)\s+of\s+(?:\w+\s+){1,2}?(?:washed|washing|washes|wash)\s+over\b`,
  String.raw`\b(?:felt|feel|feeling)\s+a\s+surge\s+of\s+(?:determination|energy|adrenaline|power|panic|hope)\b`,
  String.raw`\bsurge\s+of\s+(?:energy|power)\s+coursing\b`,
  String.raw`\b(?:adrenaline|power|energy|magic)\s+coursing\s+through\s+${P}\s+veins\b`,
  String.raw`\b(?:faint|small|subtle|slight),\s+almost\s+imperceptible\b`,
  String.raw`\b(?:with\s+)?a\s+chilling\s+certainty\b`,
  String.raw`\bwith\s+a\s+certainty\s+that\s+chilled\b`,
  String.raw`\bresonat(?:ed|ing|es)\s+deep\s+within\b`,
  String.raw`\bunsure\s+(?:of\s+)?how\s+to\s+respond\b`,
  String.raw`\bsenses\s+on\s+high\s+alert\b`,
  String.raw`\bforce\s+of\s+a\s+physical\s+blow\b`,
  /* the room, the light, the air */
  String.raw`\bair(?:\s*,|\s+(?:was|hung|grew|had\s+grown|felt|seemed))?\s+(?:heavy\s+and\s+)?thick\s+with\b`,
  String.raw`\bair\s+(?:hung|grew)\s+(?:thick|heavy)\b`,
  String.raw`\b(?:words?|question|silence|accusation|threat)\s+(?:hung|hangs|hanging|lingered)\s+(?:heavy\s+|thick\s+)?in\s+the\s+air\b`,
  String.raw`\b(?:hung|hangs|hanging)\s+(?:heavy|thick)\s+in\s+the\s+air\b`,
  String.raw`\bhung\s+in\s+the\s+air,\s+(?:heavy|thick)\b`,
  String.raw`\bheavy\s+with\s+unspoken\b`,
  String.raw`\b(?:world|room|forest|city|crowd|air|night|house)\s+(?:seemed\s+to\s+)?(?:held|hold|holding|holds)\s+its\s+breath\b`,
  String.raw`\bsun\s+dipped\b`,
  String.raw`\bsun\s+hung\s+low\b`,
  String.raw`\bcasting\s+(?:a\s+|an\s+)?(?:long|warm|eerie|golden|ethereal|dancing|flickering|jagged|distorted|soft)(?:,\s+\w+)?\s+(?:shadows?|glow|hue|light)\b`,
  String.raw`\bpainting\s+the\s+sky\b`,
  String.raw`\bhues\s+of\s+(?:orange|pink|purple|gold|crimson|red|amber)\b`,
  String.raw`\bwarm,\s+golden\s+(?:glow|light|hue)\b`,
  String.raw`\bstars\s+began\s+to\s+twinkle\b`,
  String.raw`\bdust\s+motes\s+(?:danced|dancing)\b`,
  String.raw`\bscent\s+of\s+damp\s+earth\b`,
  String.raw`\bfluorescent\s+lights?\s+(?:hummed|flickered|buzzed)\b`,
  String.raw`\bflickering\s+(?:fluorescent|neon)\b`,
  String.raw`\bhum\s+of\s+(?:the\s+)?fluorescent\s+lights\b`,
  String.raw`\bflicker(?:ed|s|ing)\s+to\s+life\b`,
  String.raw`\bsterile\s+white\s+walls\b`,
  String.raw`\bintricately\s+carved\b`,
  String.raw`\bintricate\s+carvings\b`,
  String.raw`\blike\s+(?:polished\s+obsidian|molten\s+gold)\b`,
  String.raw`\bbygone\s+era\b`,
  /* people moving the stock way */
  String.raw`\b(?:eyes|gaze)\s+(?:locked|locking)\s+(?:onto|on\s+to)\b`,
  String.raw`\bgaze\s+sweeping\s+(?:across|over)\b`,
  String.raw`\beyes\s+scanning\s+the\s+(?:room|crowd|horizon)\b`,
  String.raw`\bfingers\s+(?:flying|dancing|danced)\s+(?:across|over)\b`,
  String.raw`\braised\s+a\s+hand,\s+silencing\b`,
  String.raw`\bsighed,\s+running\s+a\s+hand\b`,
  String.raw`\bhand\s+instinctively\s+reaching\b`,
  String.raw`\bmovements\s+(?:fluid|slow|smooth)\s+and\s+(?:graceful|deliberate|precise)\b`,
  String.raw`\b(?:chuckled|laughed|sighed|giggled|snorted|scoffed|groaned),\s+a\s+sound\s+like\b`,
  String.raw`\bfigure\s+emerged\s+from\s+the\s+shadows\b`,
  String.raw`\btall,\s+imposing\s+figure\b`,
  String.raw`\bexchanged\s+(?:uneasy|nervous)\s+glances\b`,
  String.raw`\bcollective\s+gasp\s+(?:rippled|went|swept)\b`,
  String.raw`\bcrowd\s+erupted\s+in(?:to)?\s+cheers\b`,
  String.raw`\beyes\s+(?:sparkling|twinkling|glinting|dancing)\s+with\s+(?:mischief|amusement)\b`,
  String.raw`\bmischievous\s+glint\b`,
  String.raw`\beyes\s+that\s+seemed\s+to\s+hold\b`,
  String.raw`\bcarefully\s+constructed\s+(?:facade|façade)\b`,
  /* time and what lies ahead */
  String.raw`\b(?:days|weeks|months)\s+(?:turned|bled|melted|blurred)\s+into\s+(?:weeks|months|years)\b`,
  String.raw`\b(?:felt|seemed)\s+like\s+an\s+eternity\b`,
  String.raw`\b(?:face|faced|facing)\s+whatever\b`,
  String.raw`\b(?:challenges|road|path|journey|trials)\s+(?:that\s+)?(?:lay|lies|laid|lying)\s+ahead\b`,
  String.raw`\b(?:road|path|journey)\s+ahead\s+would\s+be\b`,
  String.raw`\bwhat(?:ever)?\s+the\s+future\s+(?:held|holds|might\s+hold|would\s+hold)\b`,
  String.raw`\bchange\s+the\s+course\s+of\s+(?:human\s+)?history\b`,
  String.raw`\bforge\s+a\s+new\s+path\b`,
  String.raw`\bbeginning\s+of\s+a\s+new\s+chapter\b`,
  String.raw`\buncover\s+the\s+truth\b`,
  String.raw`\bpart\s+of\s+something\s+greater\b`,
  String.raw`\bsomething\s+far\s+more\s+(?:profound|sinister|dangerous|ancient)\b`,
  String.raw`\bdarkest\s+of\s+times\b`,
  String.raw`\bbeacon\s+of\s+hope\b`,
  String.raw`\b(?:power|resilience|strength|indomitable|triumph)\s+of\s+the\s+human\s+spirit\b`,
  /* the hand-kept list */
  String.raw`\ba\s+testament\s+to\b`,
  String.raw`\btapestry\s+(?:woven|of\s+(?:light|sound|colou?rs?|emotions?|memories|life|lives|stars|scents?|smells?))\b`,
  String.raw`\ba\s+(?:symphony|kaleidoscope)\s+of\b`,
  String.raw`\bmaybe,\s+just\s+maybe\b`,
  String.raw`\bperhaps,\s+just\s+perhaps\b`,
  String.raw`\blittle\s+did\s+(?:he|she|they|i|we)\s+know\b`,
  String.raw`\b(?:tension|fear|anticipation|excitement|silence|grief|anger|hostility)\s+(?:was|were|hung|felt)\s+(?:almost\s+)?palpable\b`,
];

/* the swivel: "It wasn't X. It was Y." / "This isn't X — it's Y", "It's not
 * X, it's Y", and a sentence that opens "Not X, but Y" ("It wasn't until…",
 * "Not that it mattered" are other things) */
export const SWIVEL = [
  String.raw`\b(it|this|that)\s+(?:was|is)(?:n['’]t|\s+not)\s+(?!until\b|only\b)[^.!?;:\n"“”]{1,60}?[.;:—–]+\s*\1(?:\s+(?:was|is)|['’]s)\b`,
  String.raw`\b(it|this|that)['’]s\s+not\s+(?!until\b|only\b)[^.!?;:\n"“”]{1,60}?[,.;:—–]+\s*\1['’]s\b`,
  String.raw`(?:^|(?<=[.!?…]\s{1,3})|(?<=\n))Not\s+(?!that\b|only\b)[^.!?;:\n"“”]{1,40}?,?\s+but\s+[^.!?;:\n"“”]{1,40}`,
];

const compiled = { stock: null, swivel: null };
const all = () => {
  if (!compiled.stock) {
    compiled.stock = STOCK.map((s) => new RegExp(s, 'gi'));
    compiled.swivel = SWIVEL.map((s, i) => new RegExp(s, i === 2 ? 'g' : 'gi'));
  }
  return [...compiled.stock, ...compiled.swivel];
};

/* the words as narration: what is said inside quotes blanked out — double,
 * and single (‘…’ and '…', opened after no letter, closed by one no letter
 * follows, on one line: a book whose people speak in single quotes, Cozy
 * Tavern M471-1; "don’t" never opens one) — the rest where it stands (so a
 * place found here is the same place in the text) */
export function narrationOf(text) {
  const blank = (m) => ' '.repeat(m.length);
  return String(text || '')
    .replace(/"[^"\n]*"|“[^”\n]*”/g, blank)
    .replace(/(?<![\p{L}\p{N}])‘[^\n]{0,400}?’(?![\p{L}])/gu, blank)
    .replace(/(?<![\p{L}\p{N}])'[^\n]{0,400}?'(?![\p{L}])/gu, blank);
}

/* every place stock wording stands in the narration: {start, end, words,
 * family} (family: which kind of stock wording it is), in order, never two
 * over the same words. not: words of his (what he asked the writer for) —
 * a kind of stock wording that stands in them too is his, never counted
 * against the page (Cozy Tavern M355/M357) */
export function stockIn(text, { not = '' } = {}) {
  const t = String(text || '');
  const n = narrationOf(t);
  const hits = [];
  const res = all();
  const his = String(not || '').trim() ? familiesIn(String(not)) : null;
  res.forEach((re, family) => {
    if (his && his.has(family)) return;
    re.lastIndex = 0;
    for (const m of n.matchAll(re)) {
      let start = m.index;
      let end = start + m[0].length;
      while (start < end && /[\s,]/.test(t[start])) start++;
      while (end > start && /[\s,—–]/.test(t[end - 1])) end--;
      if (end <= start) continue;
      if (hits.some((h) => h.start < end && start < h.end)) continue;
      hits.push({ start, end, words: t.slice(start, end), family });
    }
  });
  return hits.sort((a, b) => a.start - b.start);
}

/* the kinds of stock wording some words of his name anywhere — inside quotes
 * too: an ask names the phrase it wants in quotes ("have her say “a testament
 * to” him") */
function familiesIn(text) {
  const out = new Set();
  all().forEach((re, family) => { re.lastIndex = 0; if (re.test(text)) out.add(family); re.lastIndex = 0; });
  return out;
}

/* how much of it a piece of writing holds: places, words, and places in every
 * thousand words (EQ-Bench reports its own count the same way) */
export function stockRate(text) {
  const words = countWords(text);
  const hits = stockIn(text).length;
  return { hits, words, per1000: words ? Math.round((hits / words) * 10000) / 10 : 0 };
}
