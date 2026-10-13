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
    if "Check these passages from" in last_user:
        # the checker: a fix for the stand-in's own stock words, wherever they stand
        edits = []
        for m in re.finditer(r"\[(\d+\.\d+)\] ([\s\S]*?)(?=\n\n\[\d+\.\d+\] |\n\"\"\"|$)", last_user):
            num, text = m.group(1), m.group(2)
            if "patient and unhurried" in text:
                edits.append({"passage": num, "kind": "humanize", "find": "patient and unhurried", "replace": "patient, unhurried", "why": "lighter without the and"})
            if "letters anymore" in text:
                edits.append({"passage": num, "kind": "grammar", "find": "letters anymore", "replace": "letters any more", "why": "two words in British English"})
        return json.dumps({"edits": edits})
    if "for the writer to read before every page" in last_user:
        return json.dumps({"about": "A lighthouse keeper on a stormy coast and the letter that washed up at her feet.", "style": "Close third person on Mara, past tense; quiet, wry, salt-weathered."})
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
        }})
    if "Summarise " in last_user and "for the book's notes" in last_user:
        return json.dumps({"summary": "Mara Venn finds a bottle at the tide line with a letter inside that smells of tar and oranges.", "name": "The Bottle"})
    if "⟦" in last_user and "Write only the new words" in last_user:
        return "lit with a slow, amber glow"
    if "written again" in last_user and "The passage as it stands now" in last_user:
        return "A rewritten passage. Mara steadied the lamp with both hands and listened to the rain."
    if "stopped partway through" in last_user:
        return "and the tide, at last, came in."
    if "how it went" in last_user and "Narrator:" in last_user:
        return "Mara walked down to the shore, where the stranger stood with his collar up. “You found it,” he said. She did not ask how he knew."
    if "talking over our novel" in system:
        if "CHANGE THE PASSAGE" in last_user:
            return '<changes>[{"passage": "1.1", "find": "Rain hammered the glass", "replace": "Rain lashed the glass", "why": "a harder verb for the storm"}]</changes>\n\nI made the rain harder in the first line.'
        return "Maybe the letter is from her brother — the one who went to sea and never wrote."
    if "playing a scene from it" in system:
        told = "The wind howls along the cliff path. At the bottom of the steps, a stranger waits with his collar turned up against the rain."
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
    return "\n\n".join(words)


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
        text = answer_for(body)
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
            if think:
                for piece in ["Let me ", "think about ", "the scene."]:
                    chunk({"reasoning_content": piece})
                    time.sleep(0.5 if slow else 0.05)
            pieces = re.findall(r"\S+\s*", text)
            limit = body.get("max_tokens")
            cut = False
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
