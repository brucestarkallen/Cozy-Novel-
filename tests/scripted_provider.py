#!/usr/bin/env python3
"""A stand-in model for tests/app.mjs: OpenAI-shaped, streaming, told what to
do next by the test. Never used by the app itself.

POST /script  {"queue": [behaviour, ...]}  replaces the queue.
Each chat request takes the next behaviour (or a default by its kind):
  {"text": "...", "finish": "stop"|"length"|"content_filter", "delay": 0.0, "chunk": 7, "think": "..."}
  {"status": 429, "message": "..."}         refused before anything
  {"hang_after": "words"}                    those words, then silence until the caller goes
  {"midstream_error": "words", "message": "..."}  words, then an error in the stream
  {"abrupt": "words"}                        words, then the line closes with no finish
GET /requests  every request body seen.  GET /reset clears both."""
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REQUESTS, QUEUE, LOCK = [], [], threading.Lock()


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
            return self.js({"ok": True})
        if self.path.endswith("/models"):
            return self.js({"data": [{"id": "scripted"}]})
        self.js({"error": "no"}, 404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/script":
            with LOCK:
                QUEUE[:] = body.get("queue", [])
            return self.js({"ok": True})
        last_user = ""
        for m in reversed(body.get("messages") or []):
            if m.get("role") == "user":
                last_user = m.get("content") or ""
                break
        with LOCK:
            REQUESTS.append({"path": self.path, "body": body, "at": time.time()})
            if QUEUE:
                beh = QUEUE.pop(0)
            elif "Summarise " in last_user and "for the book's notes" in last_user:
                beh = {"text": json.dumps({"summary": "DEFAULT SUMMARY", "name": "Default Name"})}
            elif "Update the notes" in last_user or "could not be read as JSON" in last_user or "cut off before it finished" in last_user:
                beh = {"text": "{}"}
            else:
                beh = {"text": "echo"}
        if "status" in beh:
            return self.js({"error": {"message": beh.get("message", "error")}}, beh["status"])
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
            text = beh.get("text", "")
            step = max(1, int(beh.get("chunk", 7)))
            for i in range(0, len(text), step):
                chunk({"content": text[i:i + step]})
                if beh.get("delay"):
                    time.sleep(beh["delay"])
            chunk({}, beh.get("finish", "stop"))
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 18652
    s = ThreadingHTTPServer(("127.0.0.1", port), H)
    s.daemon_threads = True
    print("scripted provider on", port, flush=True)
    s.serve_forever()
