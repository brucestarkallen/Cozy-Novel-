#!/usr/bin/env python3
"""A stand-in model for tests/app.mjs: OpenAI-shaped, streaming, told what to
do next by the test. Never used by the app itself.

POST /script  {"queue": [behaviour, ...]}  replaces the queue.
Each chat request takes the next behaviour (or a default by its kind):
  {"text": "...", "finish": "stop"|"length"|"content_filter", "delay": 0.0, "chunk": 7, "think": "...",
   "usage": {"prompt_tokens": n, "completion_tokens": n}}   (usage: sent at the end, as OpenAI does)
  {"status": 429, "message": "...", "retry_after": "120"}   refused before anything (with how long to wait, when given)
  {"most": n, "message": "...", "text": "..."}   a reply cap: every ask for more than n tokens refused (400) in those words, the first within it answered
  {"hang_after": "words"}                    those words, then silence until the caller goes
  {"midstream_error": "words", "message": "..."}  words, then an error in the stream
  {"abrupt": "words"}                        words, then the line closes with no finish
  {"deltas": [{...}, ...]}                   each delta sent as it is (any fields), then the text, if any
  {"pad_for": s, "pad": " "}                 after the words, the pad sent every 0.05 s for s seconds before the finish
  {"usage_in_choice": {...}}                 the count inside the finishing choice (Kimi's way)
  {"pause": s}                               after the deltas, a silence of s seconds before the text
  {"events": [{...}, ...]}                   each event sent as it is (Claude's stream), nothing else
POST /models {"data": [...]}  what the provider's list of models says (GET .../models); reset puts back the one model.
A request whose caller hung up partway is marked "hung_up" in /requests.
GET /requests  every request body seen.  GET /reset clears both."""
import json
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REQUESTS, QUEUE, LOCK = [], [], threading.Lock()
ONE_MODEL = [{"id": "scripted"}]
MODELS = list(ONE_MODEL)


JUDGE_CHECKS = ["opening", "canon", "shown", "pacing", "specific", "fresh", "sentences", "people", "moves", "ending"]


def default_check(ask):
    part = ask[ask.index("Check these passages from"):]
    nums = []
    for n in re.findall(r"\[(\d+\.\d+)\]", part):
        if n not in nums:
            nums.append(n)
    grades = [{"passage": n, "checks": {k: "yes" for k in JUDGE_CHECKS}, "faults": []} for n in nums]
    if "Answer every check of every passage" in ask and "Suggest only what is worth changing" not in ask:
        return {"grades": grades}
    if "Then judge each passage" in ask:
        return {"edits": [], "grades": grades}
    return {"edits": []}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def js(self, obj, code=200):
        d = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(d)))
        self.end_headers()
        self.wfile.write(d)

    def do_GET(self):
        if self.path == "/requests":
            with LOCK:
                return self.js({"requests": REQUESTS})
        if self.path == "/reset":
            with LOCK:
                REQUESTS.clear()
                QUEUE.clear()
                MODELS[:] = list(ONE_MODEL)
            return self.js({"ok": True})
        if self.path.endswith("/models"):
            with LOCK:
                return self.js({"data": list(MODELS)})
        self.js({"error": "no"}, 404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/script":
            with LOCK:
                QUEUE[:] = body.get("queue", [])
            return self.js({"ok": True})
        if self.path == "/models":
            with LOCK:
                MODELS[:] = body.get("data", [])
            return self.js({"ok": True})
        last_user = ""
        for m in reversed(body.get("messages") or []):
            if m.get("role") == "user":
                last_user = m.get("content") or ""
                break
        entry = {"path": self.path, "body": body, "at": time.time()}
        with LOCK:
            REQUESTS.append(entry)
            backfill = "were read into the notes before the book’s bibliography was kept" in last_user
            # the helper picking what a page needs from the bibliography (2.12.27): nothing, unless the test queued an answer for it ({"pick": true})
            pick = 'Answer with only this: {"entries": [the numbers]}' in last_user
            # the checker reading a chapter whole (2.12.33): nothing found, unless the test queued an answer for it ({"whole": true})
            whole = "Read it as one chapter" in last_user
            # the marks' mender (2.12.34): sets nothing, unless the test queued an answer for it ({"marks": true})
            marks = "Add the quotation marks each spoken line is missing" in last_user
            # the proofreader (2.12.35): finds no slip, unless the test queued an answer for it ({"proof": true})
            proof = "Find every slip of the hand in them" in last_user
            # the Timeline read for itself (2.12.37): an honest reading with no turns, unless the test queued an answer for it ({"turns": true})
            turns = "Read these passages for the Timeline alone" in last_user
            title = "Give it a chapter title" in last_user
            # a provider that gives at most so many tokens in one reply ({"most": n, "message": "…"}): it turns away every ask
            # for more, in its own words, and answers the first that asks for no more (2.12.63)
            asked_most = body.get("max_tokens") or body.get("max_completion_tokens") or 0
            capped = bool(QUEUE) and isinstance(QUEUE[0].get("most"), int) and isinstance(asked_most, int) and asked_most > QUEUE[0]["most"]
            if capped:
                beh = {"status": 400, "message": QUEUE[0].get("message", "max_tokens is too large")}
            elif QUEUE and not (turns and not QUEUE[0].get("turns")) and not ('Answer with {"ok": true} and nothing else.' in last_user and not QUEUE[0].get("probe")) and not (backfill and not QUEUE[0].get("bib")) and not (pick and not QUEUE[0].get("pick")) and not (whole and not QUEUE[0].get("whole")) and not (QUEUE[0].get("whole") and not whole) and not (marks and not QUEUE[0].get("marks")) and not (QUEUE[0].get("marks") and not marks) and not (proof and not QUEUE[0].get("proof")) and not (QUEUE[0].get("proof") and not proof) and not (title and not QUEUE[0].get("title")) and not (QUEUE[0].get("title") and not title):
                beh = QUEUE.pop(0)
            elif turns:
                sources = re.findall(r"^(Chapter [^\n]+?, passage \d+):$", last_user, re.M)
                beh = {"text": json.dumps({"timeline": [{"source": x, "events": []} for x in sources]})}
            elif proof:
                beh = {"text": json.dumps({"edits": []})}
            elif whole:
                beh = {"text": json.dumps({"edits": []})}
            elif marks:
                beh = {"text": json.dumps({"paragraphs": []})}
            elif pick:
                beh = {"text": '{"entries": []}'}
            elif backfill:
                # the bibliography filled for pages read before it (2.12): nothing found, unless the test queued an answer for it ({"bib": true})
                beh = {"text": json.dumps({"bibliography": []})}
            elif 'Answer with {"ok": true} and nothing else.' in last_user:
                # the helper making sure its model is there: yes, unless the test says otherwise ({"probe": ...})
                beh = {"text": '{"ok": true}'}
            elif "Summarise " in last_user and "for the book's notes" in last_user:
                beh = {"text": json.dumps({"summary": "DEFAULT SUMMARY", "name": "Default Name"})}
            elif "Write the summary again with every one" in last_user:
                beh = {"text": json.dumps({"summary": "DEFAULT SUMMARY AGAIN"})}
            elif "for the writer to read before every page" in last_user:
                beh = {"text": json.dumps({"about": "DEFAULT ABOUT", "style": "DEFAULT STYLE"})}
            elif "Check these passages from" in last_user:
                # a checker that does as it is asked: nothing to fix — and, when the judge asks, every check of every passage passed
                beh = {"text": json.dumps(default_check(last_user))}
            elif "Its summary, as it stands" in last_user:
                # the summary check (2.11.3) of a model that finds the summary stands
                beh = {"text": json.dumps({"wrong": [], "missing": []})}
            elif "Which is the better page" in last_user:
                beh = {"text": json.dumps({"better": "same", "why": "DEFAULT DUEL"})}
            elif "Give it a chapter title" in last_user:
                beh = {"text": json.dumps({"name": "The Lantern"})}
            elif "Read these passages for the Timeline alone" in last_user:
                # the Timeline read for itself (2.12.37): an honest reading of every passage shown, with no turns in it
                sources = re.findall(r"^(Chapter [^\n]+?, passage \d+):$", last_user, re.M)
                beh = {"text": json.dumps({"timeline": [{"source": x, "events": []} for x in sources]})}
            elif "Update the notes" in last_user or "could not be read as JSON" in last_user or "cut off before it finished" in last_user:
                beh = {"text": "{}"}
            else:
                beh = {"text": "echo"}
        if "status" in beh:
            if beh.get("retry_after"):
                d = json.dumps({"error": {"message": beh.get("message", "error")}}).encode()
                self.send_response(beh["status"])
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(d)))
                self.send_header("Retry-After", str(beh["retry_after"]))
                self.end_headers()
                self.wfile.write(d)
                return
            return self.js({"error": {"message": beh.get("message", "error")}}, beh["status"])
        if body.get("stream") is not True and not beh.get("sse"):
            # asked without streaming: one JSON answer, as a provider gives it
            msg = {"role": "assistant", "content": beh.get("text", "")}
            if beh.get("think"):
                msg["reasoning_content"] = beh["think"]
            out = {"choices": [{"message": msg, "finish_reason": beh.get("finish", "stop")}]}
            if beh.get("usage"):
                out["usage"] = beh["usage"]
            return self.js(out)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

        def chunk(delta, finish=None):
            self.wfile.write(("data: " + json.dumps({"choices": [{"delta": delta, "finish_reason": finish}]}) + "\n\n").encode())
            self.wfile.flush()
        try:
            if beh.get("think"):
                chunk({"reasoning_content": beh["think"]})
            if "hang_after" in beh:
                if beh["hang_after"]:
                    chunk({"content": beh["hang_after"]})
                for _ in range(600):
                    time.sleep(0.1)
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                return
            if "midstream_error" in beh:
                chunk({"content": beh["midstream_error"]})
                self.wfile.write(("data: " + json.dumps({"error": {"message": beh.get("message", "boom"), "code": 500}}) + "\n\n").encode())
                self.wfile.flush()
                return
            if "abrupt" in beh:
                chunk({"content": beh["abrupt"]})
                return
            if beh.get("events"):
                for ev in beh["events"]:
                    self.wfile.write(("data: " + json.dumps(ev) + "\n\n").encode())
                    self.wfile.flush()
                return
            for d in beh.get("deltas") or []:
                chunk(d)
                if beh.get("delay"):
                    time.sleep(beh["delay"])
            if beh.get("pause"):
                time.sleep(float(beh["pause"]))
            text = beh.get("text", "")
            step = max(1, int(beh.get("chunk", 7)))
            for i in range(0, len(text), step):
                chunk({"content": text[i:i + step]})
                if beh.get("delay"):
                    time.sleep(beh["delay"])
            if beh.get("pad_for"):
                until = time.time() + float(beh["pad_for"])
                while time.time() < until:
                    chunk({"content": beh.get("pad", " ")})
                    time.sleep(0.05)
            if beh.get("usage_in_choice"):
                self.wfile.write(("data: " + json.dumps({"choices": [{"delta": {}, "finish_reason": beh.get("finish", "stop"), "usage": beh["usage_in_choice"]}]}) + "\n\n").encode())
            else:
                chunk({}, beh.get("finish", "stop"))
            if beh.get("usage"):
                self.wfile.write(("data: " + json.dumps({"choices": [], "usage": beh["usage"]}) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            with LOCK:
                entry["hung_up"] = time.time()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 18652
    s = ThreadingHTTPServer(("127.0.0.1", port), H)
    s.daemon_threads = True
    print("scripted provider on", port, flush=True)
    s.serve_forever()
