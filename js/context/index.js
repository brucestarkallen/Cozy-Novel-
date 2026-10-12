// A small local index is refreshed only when this scene's accepted text changes.
// It is a retrieval hint, never an authority or a replacement for original text.
const STOP = new Set(
  "the and that this with from were was have has had for but not are she his her they them their then there into only would could should about been said some very which what when where who you your our out all its one".split(
    " ",
  ),
);
export function terms(text) {
  return [
    ...new Set(
      (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter(
        (word) => !STOP.has(word),
      ),
    ),
  ];
}
export function indexText(text) {
  return { terms: terms(text).slice(0, 12000), characters: text.length };
}
export function relevance(index, query) {
  let score = 0;
  for (const word of index) if (query.has(word)) score++;
  return score;
}
