import { assert } from "../core/schema.js";
const ANY = "(?:.|\\n)",
  WORD = "[^\\t \\r\\n]+";
export const STRUCTURED_TEMPLATES = [
  {
    id: "opening",
    label: "Literary opening",
    guide: "Your exact opening followed by new prose.",
    text: "The rain had softened the afternoon.",
  },
  {
    id: "quiet",
    label: "Quiet beat",
    guide:
      "A generated scene heading is omitted. Only the prose after keep is shown.",
    text: "Scene: [[line]]\n[[keep]]The afternoon settled around them.",
  },
  {
    id: "dialogue",
    label: "One complete dialogue line",
    guide:
      "The model supplies a short dialogue line, then stops at the explicit boundary.",
    text: "“[[words:3-12]],” she said.[[end]]",
  },
];
function literal(text) {
  return text
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}
function limits(raw, defaultValue = "1") {
  const match = (raw || defaultValue).match(/^(\d+)(?:-(\d+))?$/);
  assert(match, "Use an integer or a range in this template slot.");
  const lo = Number(match[1]),
    hi = Number(match[2] || lo);
  assert(
    lo >= 1 && hi >= lo && hi <= 1000,
    "Template slot range must be ordered and at most 1000.",
  );
  return [lo, hi];
}
function wordRange(raw, defaultValue) {
  const [lo, hi] = limits(raw, defaultValue);
  return (
    WORD +
    (hi === 1 ? "" : "(?: " + WORD + "){" + (lo - 1) + "," + (hi - 1) + "}")
  );
}
function slot(body) {
  const [name, ...parts] = body.split(":"),
    value = parts.join(":");
  switch (name.toLowerCase()) {
    case "w":
    case "words":
      return wordRange(value, "1");
    case "opt":
    case "options": {
      const options = value.split("|").filter(Boolean);
      assert(options.length, "Supply template options.");
      return "(?:" + options.map(literal).join("|") + ")";
    }
    case "line":
    case "free":
      return "[^\\n]+";
    case "lines": {
      const [lo, hi] = limits(value, "1");
      return "[^\\n]+(?:\\n[^\\n]+){" + (lo - 1) + "," + (hi - 1) + "}";
    }
    case "num":
      return "-?[0-9]+";
    case "number": {
      const [lo, hi] = limits(value);
      return (
        "(?:" +
        Array.from({ length: hi - lo + 1 }, (_, i) => String(lo + i)).join(
          "|",
        ) +
        ")"
      );
    }
    case "emotion":
    case "mood":
      return "(?:calm|curious|hopeful|tired|amused|sad|angry|afraid|tense|relieved|confused|grateful|lonely|content|surprised|determined|nervous|wary|tender)";
    case "name":
      return "[A-Z][A-Za-z']+(?: [A-Z][A-Za-z']+){0,2}";
    case "action":
      return wordRange(value, "1-6");
    case "thought":
      return wordRange(value, "1-10");
    case "re":
    case "regex":
      assert(
        value.length <= 400 && !/[(){}]|\\[1-9]|\*\*|\+\+/.test(value),
        "Use a simple bounded custom pattern without groups, backreferences or repeated quantifiers.",
      );
      new RegExp(value);
      return "(?:" + value + ")";
    default:
      throw new Error("Unknown structured template slot: " + name);
  }
}
function pattern(text) {
  let output = "",
    at = 0;
  for (const m of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    output += literal(text.slice(at, m.index)) + slot(m[1]);
    at = m.index + m[0].length;
  }
  return output + literal(text.slice(at));
}
export function templatePlan(c) {
  let template = c.prefill || "",
    mustEnd = /\[\[(end|stop|eos)\]\]\s*$/i.test(template);
  if (mustEnd) template = template.replace(/\[\[(end|stop|eos)\]\]\s*$/i, "");
  const parts = template.split(/\[\[keep\]\]/i);
  assert(parts.length <= 2, "Use only one keep marker.");
  const hidden = parts.length === 2 ? parts[0] : "",
    shown = parts.at(-1);
  const head = pattern(hidden + shown);
  let wire =
    "^" +
    head +
    (mustEnd ? "$" : ANY + "{" + Number(c.prefillMinChars || 1) + ",}$");
  if (c.prefillBanned && c.capabilities?.schemaExclusions)
    wire =
      "^(?!" +
      ANY +
      "*(?:" +
      c.prefillBanned.split("\n").filter(Boolean).map(literal).join("|") +
      "))" +
      head +
      (mustEnd ? "$" : ANY + "{" + Number(c.prefillMinChars || 1) + ",}$");
  return {
    pattern: wire,
    head,
    hiddenPattern: hidden
      ? "^(" + pattern(hidden) + ")" + pattern(shown)
      : null,
    mustEnd,
    shown,
  };
}
export function structuredFormat(c) {
  const p = templatePlan(c);
  return {
    type: "json_schema",
    json_schema: {
      name: "novel_prose",
      strict: true,
      schema: {
        type: "object",
        properties: { prose: { type: "string", pattern: p.pattern } },
        required: ["prose"],
        additionalProperties: false,
      },
    },
  };
}
export function structuredText(raw, c) {
  const result = JSON.parse(raw);
  assert(
    typeof result.prose === "string" && Object.keys(result).length === 1,
    "Malformed structured prose response. The original output is recoverable outside the manuscript.",
  );
  const plan = templatePlan(c);
  assert(
    new RegExp(plan.pattern).test(result.prose),
    "The response did not match its structured template. Review the original output.",
  );
  let shown = result.prose;
  if (plan.hiddenPattern) {
    const match = new RegExp(plan.hiddenPattern).exec(shown);
    assert(match, "The hidden template prefix was incomplete.");
    shown = shown.slice(match[1].length);
  }
  // A model supplied control block remains outside literary prose. It is not a claim of access to hidden reasoning.
  shown = shown.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, "");
  assert(
    !/<\/?think>|\[\[(keep|end|stop|eos)\]\]/i.test(shown),
    "Unresolved output control markers remain. Review the original output.",
  );
  const excluded = (c.prefillBanned || "").split("\n").filter(Boolean);
  assert(
    !excluded.some((s) =>
      shown.toLocaleLowerCase().includes(s.toLocaleLowerCase()),
    ),
    "The output contained an excluded phrase. It is retained for review.",
  );
  return shown;
}
