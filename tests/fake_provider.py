#!/usr/bin/env python3
"""A stand-in model for the tests: OpenAI-shaped chat completions that stream,
and a models list. It answers each kind of request the app makes the way a
real model would be expected to, records every request, and can be slow,
think, refuse a dial, or fail — so the app's own handling of each is run.
Never used by the app itself."""
import json
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REQUESTS = []
LOCK = threading.Lock()

PROSE = [
    "Rain hammered the glass of the lantern room, and Mara Venn wiped the salt from her hands before she touched the lamp.",
    "Below, the sea worked at the rocks of Crane Point the way it had for a thousand years, patient and unhurried.",
    "She found the bottle at the tide line just after dawn, green glass gone milky with age, a curl of paper inside.",
    "“Nobody writes letters anymore,” she said to the gulls, and the gulls, as usual, had nothing to add.",
    "The paper smelled of tar and something sweeter, like oranges left too long in a drawer.",
]


def answer_for(body):
    msgs = body.get("messages") or []
    system = "\n".join(m.get("content", "") for m in msgs if m.get("role") == "system" and isinstance(m.get("content"), str))
    last_user = ""
    for m in reversed(msgs):
        if m.get("role") == "user":
            last_user = m.get("content") or ""
            break
    if 'Answer with only this: {"entries": [the numbers]}' in last_user:
        # the helper picking what a page needs from the bibliography (2.12.27): the entries whose line says the
        # premise's own word PICKME, else none
        asked = last_user.split("Entries it doesn’t have:", 1)[0]
        rows = last_user.split("Entries it doesn’t have:", 1)[-1].split("\n\nName the ones", 1)[0]
        want = [int(m.group(1)) for m in re.finditer(r"^(\d+)\. .*PICKME", rows, re.M)] if "PICKME" in asked else []
        return json.dumps({"entries": want})
    if "Read these passages for the Timeline alone" in last_user:
        # the Timeline read for itself (2.12.37): an honest reading of every passage shown, with no turns in it
        return json.dumps({"timeline": [{"source": x, "events": []} for x in re.findall(r"^(Chapter [^\n]+?, passage \d+):$", last_user, re.M)]})
    if "Hold my words against the book as it stands" in last_user or "I looked up the words you quoted" in last_user:
        # Quick add (2.12.37): each "X is ..." sentence of his words an entry — written up in its own words, the way a
        # series bible writes it, never his sentence pasted (2.12.40: so a walk can tell a pasted entry from a written
        # one); black hair where a page gives silver, a conflict quoting the page's own sentence. Asked again with the
        # rows as they stand: the entries again.
        asked = next((m.get("content") for m in msgs if m.get("role") == "user" and isinstance(m.get("content"), str) and "Hold my words against the book as it stands" in m.get("content")), last_user)
        said = asked.split('to go into my bibliography now:\n"""\n', 1)[-1].split('\n"""', 1)[0]
        # (the walk's own words that tell it how to answer — never part of what he adds)
        flags = set(re.findall(r"\b(HELDBACK|LONE|ASIDE|SHAPE|TALK)\b", said))
        said = re.sub(r"\b(?:HELDBACK|LONE|ASIDE|SHAPE|TALK)\s*", "", said)
        entries, conflicts = [], []
        for sentence in re.split(r"(?<=[.!?])\s+", said):
            m = re.match(r"^(?:The )?([A-Z][\w’' -]+?) is (.+?)[.!?]?$", sentence.strip())
            if m:
                name, what = m.group(1).strip(), m.group(2).strip()
                entries.append({"name": name, "kind": "groups" if "council" in what else "lore", "line": what[:1].upper() + what[1:], "text": f"{name}: {what}."})
        if "I looked up the words you quoted" in last_user:
            return json.dumps({"entries": entries})

        # (2.12.63, the review) TALK: it talks first, as it is asked to — a promise, then a line that leads into the
        # record, and the record in a fence
        def answer(obj):
            if "TALK" not in flags:
                return json.dumps(obj)
            return "I checked it against the book, and nothing on the page says otherwise. It goes in as you said.\n\nHere’s the record:\n```json\n" + json.dumps(obj) + "\n```"

        # (2.12.40, the review) HELDBACK: his newer word changes words a page holds, and the entry it writes says it —
        # asked again, it gives no entry for it, so that entry waits; LONE: his newer word changes his own entry's words, and
        # it writes no entry to carry it; ASIDE: it says the book says otherwise in words that stand nowhere
        if "HELDBACK" in flags:
            page = re.search(r"[^.\n\"]*silver hair[^.\n\"]*", asked.split("The passages of the book that name", 1)[-1])
            return answer({"verdict": "Your newer word goes in.", "changes": [{"mine": "Emilia has black hair", "was": page.group(0).strip() if page else "silver hair", "where": "your entry", "why": "your newer word"}],
                               "entries": [{"name": "Emilia Vermaine", "kind": "people", "line": "An elder vampire.", "text": "Emilia has black hair now."}]})
        if "LONE" in flags:
            return answer({"verdict": "Your newer word goes in.", "changes": [{"mine": "Emilia has a brother", "was": "She has no family of her own yet", "where": "your entry Emilia Vermaine", "why": "your newer word"}], "entries": []})
        # (2.12.41, the fourth review) SHAPE: the same, with its own words for it — words his never say, so they cannot go
        # in as they are
        if "SHAPE" in flags:
            return answer({"verdict": "Your newer word goes in.", "changes": [{"mine": "Emilia has a brother", "was": "She has no family of her own yet", "now": "Emilia has a brother who rules the Order.", "where": "your entry Emilia Vermaine", "why": "your newer word"}], "entries": []})
        if "ASIDE" in flags:
            return answer({"verdict": "Green eyes wait for your word.", "conflicts": [{"mine": "her eyes are green", "against": "her eyes were always grey", "where": "Chapter One, Passage 1", "why": "grey"}], "entries": entries})
        if "black hair" in said:
            page = re.search(r"[^.\n\"]*silver hair[^.\n\"]*", last_user.split("The passages of the book that name", 1)[-1])
            if page:
                conflicts.append({"mine": "black hair", "against": page.group(0).strip(), "where": "Chapter One, Passage 1", "why": "the page gives silver"})
        return answer({"verdict": f"{len(entries)} go in; {len(conflicts)} wait for your word.", "conflicts": conflicts, "entries": entries})
    if "Add the quotation marks each spoken line is missing" in last_user:
        # the marks' mender (2.12.34): a speech opened while one is still open is closed before the space in front of it
        out = []
        for m in re.finditer(r"^(\d+)\. «(.*)»$", last_user, re.M):
            line = m.group(2)
            opened = False
            fixed = None
            for i, ch in enumerate(line):
                if ch != '"':
                    continue
                before = line[i - 1] if i else " "
                after = line[i + 1] if i + 1 < len(line) else " "
                opens = before.isspace() and not after.isspace()
                if opens and opened:
                    j = i
                    while j > 0 and line[j - 1].isspace():
                        j -= 1
                    fixed = line[:j] + '"' + line[j:]
                    break
                opened = opens
            if fixed:
                out.append({"n": int(m.group(1)), "text": fixed})
        return json.dumps({"paragraphs": out})
    if "Find every slip of the hand in them" in last_user:
        # the proofreader (2.12.35): two words run together, and two sentences run together with a comma
        edits = []
        part = last_user.split("each numbered as it is on the page:", 1)[-1].split("Proofread them the way", 1)[0]
        for m in re.finditer(r"\[(\d+\.\d+)\] ([\s\S]*?)(?=\n\n\[\d+\.\d+\] |\n\"\"\"|$)", part):
            num, text = m.group(1), m.group(2)
            if "wassentiment" in text:
                edits.append({"passage": num, "find": "it wassentiment", "replace": "it was sentiment", "why": "two words run together"})
            if "to ash, She" in text:
                edits.append({"passage": num, "find": "to ash, She looked", "replace": "to ash. She looked", "why": "two sentences run together with a comma"})
        return json.dumps({"edits": edits})
    if "Read it as one chapter" in last_user:
        # the checker reading a chapter whole (2.12.33): a cup set down earlier and still in her hand later
        edits = []
        part = last_user.split("— each passage numbered as it is on the page:", 1)[-1].split("Read it as one chapter", 1)[0]
        if "She set the cup down on the sill" in last_user:
            for m in re.finditer(r"\[(\d+\.\d+)\] ([\s\S]*?)(?=\n\n\[\d+\.\d+\] |\n\"\"\"|$)", part):
                if "the cup still warm in her hand" in m.group(2):
                    edits.append({"passage": m.group(1), "kind": "continuity", "find": "the cup still warm in her hand", "replace": "the cup cooling on the sill", "why": "she set it down", "says": "She set the cup down on the sill"})
        return json.dumps({"edits": edits})
    if "Check these passages from" in last_user:
        # the checker: a fix for the stand-in's own stock words, wherever they stand
        edits = []
        # (only the passages to check: the story before them and the request's own words are not passages)
        checked = last_user.split("Check these passages from", 1)[1].split("Suggest only what is worth changing", 1)[0]
        for m in re.finditer(r"\[(\d+\.\d+)\] ([\s\S]*?)(?=\n\n\[\d+\.\d+\] |\n\"\"\"|$)", checked):
            num, text = m.group(1), m.group(2)
            if "patient and unhurried" in text:
                edits.append({"passage": num, "kind": "humanize", "find": "patient and unhurried", "replace": "patient, unhurried", "why": "lighter without the and"})
            if "letters anymore" in text:
                edits.append({"passage": num, "kind": "grammar", "find": "letters anymore", "replace": "letters any more", "why": "two words in British English"})
            if "The choice was made by her" in text:
                edits.append({"passage": num, "kind": "clarity", "find": "The choice was made by her", "replace": "She chose", "why": "the plain active carries it better"})
        # (asked for its grades alone: graded the same way)
        if "Then judge each passage" not in last_user and "Answer every check of every passage" not in last_user:
            return json.dumps({"edits": edits})
        # the judge: every check passed — but a passage that ends on what it all meant fails "ending",
        # and one that says what a look meant fails "shown" too
        grades = []
        for m in re.finditer(r"\[(\d+\.\d+)\] ([\s\S]*?)(?=\n\n\[\d+\.\d+\] |\n\"\"\"|$)", checked):
            num, text = m.group(1), m.group(2)
            checks = {k: "yes" for k in ["opening", "canon", "shown", "pacing", "specific", "fresh", "sentences", "people", "moves", "ending"]}
            faults = []
            if "And she knew, at last, that she was home." in text:
                checks["ending"] = "no"
                faults.append({"check": "ending", "words": "And she knew, at last, that she was home.", "why": "closes on what it all meant"})
            if "a look that meant he was sorry" in text:
                checks["shown"] = "no"
                faults.append({"check": "shown", "words": "a look that meant he was sorry", "why": "says what the look meant"})
            grade = {"passage": num, "checks": checks, "faults": faults}
            if faults:
                grade["lift"] = "End on what Mara does next, and let his look stand without saying what it means."
            grades.append(grade)
        return json.dumps({"edits": edits, "grades": grades})
    if "Which is the better page" in last_user:
        # head to head: the page that has the lamp lit is the better, whichever side it stands on
        a = last_user.split("Page A:")[-1].split("Page B:")[0]
        b = last_user.split("Page B:")[-1]
        better = "A" if "LAMP LIT" in a and "LAMP LIT" not in b else "B" if "LAMP LIT" in b and "LAMP LIT" not in a else "same"
        return json.dumps({"better": better, "why": "the lamp is lit on that page"})
    if "for the writer to read before every page" in last_user:
        return json.dumps({"about": "A lighthouse keeper on a stormy coast and the letter that washed up at her feet.", "style": "Close third person on Mara, past tense; quiet, wry, salt-weathered."})
    if 'Answer with {"ok": true} and nothing else.' in last_user:
        return '{"ok": true}'
    if "Check every card against the book as it stands" in last_user:
        return json.dumps({"clear": True, "verdict": "Every card holds true to the book."})
    if "Update the notes for what this changes" in last_user:
        kept = {}
        if '"about": "what the book is about' in last_user:
            kept["about"] = "A lighthouse keeper on a stormy coast and the letter that washed up at her feet."
        if '"style": "how the book reads' in last_user:
            kept["style"] = "Close third person on Mara, past tense; quiet, wry, salt-weathered."
        return json.dumps({**kept, **{
            "people": [{"name": "Mara Venn", "aka": ["the keeper"], "about": "The lighthouse keeper at Crane Point; dry, solitary, kind to gulls.", "now": "In the lantern room with the letter from the bottle."}],
            "places": [{"name": "Crane Point", "about": "A lighthouse on black rocks above a restless sea."}],
            "lore": [{"name": "The bottle", "about": "Green glass gone milky, a curl of paper inside that smells of tar and oranges."}],
            "threads": [{"name": "Who sent the letter?", "about": "A letter in a bottle washed up at dawn; nobody knows who wrote it.", "open": True}],
            "chapterName": "The Bottle",
            # an honest reading of the Timeline for every passage shown with new words: no turns (2.12.37 — a reading that
            # gives none for a passage has it read for its turns alone after)
            "timeline": [{"source": x, "events": []} for x in dict.fromkeys(re.findall(r"^(Passage \d+)$", last_user, re.M))],
            # a version that says SECOND TAKE has a note of its own (each version its own notes)
            **({"lore": [{"name": "The bottle", "about": "Green glass gone milky, a curl of paper inside that smells of tar and oranges."}, {"name": "The second take", "about": "Only this version holds it."}]} if "SECOND TAKE" in last_user.split("The notes as they stand:")[-1].split('New in')[-1] else {}),
        }})
    if "Write the summary again with every one" in last_user:
        # a summary asked again for the names and figures it left out
        return json.dumps({"summary": "Mara Venn finds a bottle at the tide line below the lighthouse at Crane Point, with a letter inside that smells of tar and oranges."})
    if "Summarise " in last_user and "for the book's notes" in last_user:
        return json.dumps({"summary": "Mara Venn finds a bottle at the tide line with a letter inside that smells of tar and oranges.", "name": "The Bottle"})
    if "⟦" in last_user and "Write only the new words" in last_user:
        return "lit with a slow, amber glow"
    if "written again" in last_user and "Here it is as it stands now" in last_user:
        return "A rewritten passage. Mara steadied the lamp with both hands and listened to the rain."
    if "stopped partway through" in last_user:
        return "and the tide, at last, came in."
    if "how it went" in last_user and "Narrator:" in last_user:
        return "Mara walked down to the shore, where the stranger stood with his collar up. “You found it,” he said. She did not ask how he knew."
    if "talking over our novel" in system:
        if "CUT CHANGES" in last_user:
            # a reply that runs out of room inside its changes block
            return '<changes>[{"passage": "1.1", "text": "A whole new passage that goes on and on' + CUT_MARK
        if "HAND IT TO THE WRITER" in last_user:
            return '<changes>[{"passage": "1.1", "rewrite": "A fiercer storm; keep the sea as it is.", "why": "the storm is too tame"}]</changes>\n\nHanded to the writer with my note.'
        if "TAKE OUT THE PASSAGE" in last_user:
            return '<changes>[{"passage": "1.1", "remove": true, "why": "too quiet"}]</changes>\n\nIt can go.'
        if "TWO CHANGES" in last_user:
            return '<changes>[{"passage": "1.1", "find": "Rain hammered the glass", "replace": "Rain lashed the glass", "why": "a harder verb"}, {"passage": "1.1", "find": "The sea was grey", "replace": "The sea was black", "why": "darker"}]</changes>\n\nTwo changes to the first passage.'
        if "CHANGE THE PASSAGE" in last_user:
            return '<changes>[{"passage": "1.1", "find": "Rain hammered the glass", "replace": "Rain lashed the glass", "why": "a harder verb for the storm"}]</changes>\n\nI made the rain harder in the first line.'
        return "Maybe the letter is from her brother — the one who went to sea and never wrote.\n\n<direction>Mara learns the letter is from her brother, who went to sea and never wrote.</direction>"
    if "playing a scene from it" in system:
        told = "The wind howls along the cliff path. *Crack!* A shutter slams somewhere above. At the bottom of the steps, a stranger waits with his collar turned up against the rain."
        if "three different things" in system:
            # Three choices on: the ways it could go, after the telling
            told += "\n\n<choices>\n1. Mara asks the stranger his name.\n2. Mara turns back up the steps.\n3. Mara holds out the letter.\n</choices>"
        return told
    direction = ""
    m = re.search(r"What happens(?: next)?: (.+)", last_user)
    if m:
        direction = m.group(1).strip()
    words = list(PROSE)
    if direction:
        words.insert(1, "(" + direction + ")")
    if "rest of this chapter" in last_user or "whole chapter" in last_user:
        words = words + words
    # two writers, two pages: the thinking model lights the lamp (the judge's head to head tells them apart)
    if body.get("model") == "fake-thinker" and "THE LAMP" in last_user:
        words.append("LAMP LIT.")
    # a writer that titles its page anyway (the page takes the heading off and keeps it)
    if "HEADING PLEASE" in last_user:
        words.insert(0, "# Chapter Three: The Storm")
    # Super automatic (2.12.28): asked whether this part ends the chapter, a premise with CLOSE IT in it does
    if "CLOSE IT" in last_user and "on a line of its own after the last words" in last_user:
        words.append("END OF CHAPTER")
    return "\n\n".join(words)


CUT_MARK = "\u27eacut\u27eb"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.endswith("/models"):
            return self.send_json({"data": [
                {"id": "fake-writer", "context_length": 200000},
                {"id": "fake-thinker", "context_length": 500000},
                {"id": "fake-small", "context_length": 9000},
            ]})
        if self.path == "/requests":
            with LOCK:
                return self.send_json({"requests": REQUESTS})
        if self.path == "/reset":
            with LOCK:
                REQUESTS.clear()
            return self.send_json({"ok": True})
        self.send_json({"error": "no"}, 404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        with LOCK:
            REQUESTS.append({"path": self.path, "headers": {k: v for k, v in self.headers.items() if k.lower() != "authorization"}, "auth": self.headers.get("Authorization", ""), "body": body, "at": time.time()})
        model = body.get("model", "")
        if self.headers.get("Authorization", "") != "Bearer test-key":
            return self.send_json({"error": {"message": "Invalid API key"}}, 401)
        if model == "fake-picky" and "top_k" in body:
            return self.send_json({"error": {"message": "Unrecognized request argument supplied: top_k"}}, 400)
        if model == "fake-small":
            size = sum(len(m.get("content") or "") for m in body.get("messages", []))
            if size > 9000 * 3:
                return self.send_json({"error": {"message": "This model's maximum context length is 9000 tokens. However, your messages resulted in %d tokens." % (size // 3)}}, 400)
        if model == "fake-broken":
            return self.send_json({"error": {"message": "The server had an error while processing your request."}}, 500)
        msgs0 = body.get("messages") or []
        asked0 = ""
        for m in reversed(msgs0):
            if m.get("role") == "user" and isinstance(m.get("content"), str):
                asked0 = m["content"]
                break
        if "SLOWFAIL" in asked0:
            # a page that fails after a while: time to go elsewhere first
            time.sleep(1.5)
            return self.send_json({"error": {"message": "The server had an error while processing your request."}}, 500)
        text = answer_for(body)
        forced_cut = text.endswith(CUT_MARK)
        if forced_cut:
            text = text[: -len(CUT_MARK)]
        msgs = body.get("messages") or []
        joined = " ".join((m.get("content") or "") for m in msgs if isinstance(m.get("content"), str))
        slow = "SLOW" in joined
        think = bool(body.get("reasoning_effort")) or (isinstance(body.get("thinking"), dict) and body["thinking"].get("type") == "enabled")
        if not body.get("stream"):
            msg = {"role": "assistant", "content": text}
            if think:
                msg["reasoning_content"] = "Let me think about the scene."
            return self.send_json({"choices": [{"message": msg, "finish_reason": "stop"}], "usage": {"prompt_tokens": len(joined) // 4, "completion_tokens": len(text) // 4}})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

        def chunk(delta, finish=None):
            obj = {"choices": [{"delta": delta, "finish_reason": finish}]}
            self.wfile.write(("data: " + json.dumps(obj) + "\n\n").encode())
            self.wfile.flush()
        try:
            if "ONLYTHINK" in asked0:
                # a model that only thinks and writes no page
                for piece in ["I weigh the storm ", "and the letter, ", "and write nothing yet."]:
                    chunk({"reasoning_content": piece})
                    time.sleep(0.05)
                chunk({}, "stop")
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
                return
            if think:
                for piece in ["Let me ", "think about ", "the scene."]:
                    chunk({"reasoning_content": piece})
                    time.sleep(0.5 if slow else 0.05)
            if "LOOK IT UP" in asked0:
                # its own web search: what it looked at, as OpenRouter's plugin sends it (one address that is no web page)
                chunk({"content": "", "annotations": [
                    {"type": "url_citation", "url_citation": {"url": "https://example.com/lighthouses", "title": "Lighthouses of the north coast"}},
                    {"type": "url_citation", "url_citation": {"url": "javascript:alert(1)", "title": "Not a page"}}]})
            pieces = re.findall(r"\S+\s*", text)
            limit = body.get("max_tokens")
            cut = forced_cut
            if model == "fake-cutter":
                pieces = pieces[: max(3, len(pieces) // 3)]
                cut = True
            for i, piece in enumerate(pieces):
                chunk({"content": piece})
                time.sleep(0.12 if slow else 0.003)
            chunk({}, "length" if cut else "stop")
            self.wfile.write(("data: " + json.dumps({"choices": [], "usage": {"prompt_tokens": len(joined) // 4, "completion_tokens": len(text) // 4}}) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 18299
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    srv.daemon_threads = True
    print("fake provider on", port, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
