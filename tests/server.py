#!/usr/bin/env python3
"""Cozy Novel — tests/server.py: the phone's server, run for real.

Starts serve.py on a temporary data folder and talks to it the way pages do —
over kept-alive connections, with base revisions, fingerprints and every kind
of record — then reads back what it holds. Synthetic data only; nothing
outside the temporary folders is touched.

    python3 tests/server.py
"""
import gzip
import http.client
import json
import os
import shutil
import signal
import socket
import sqlite3
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
PORT = 18611
UP_PORT = 18612
passed = []
failed = []


def check(name, ok, detail=""):
    (passed if ok else failed).append(name)
    print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else "  — " + str(detail)))


def free_port(port):
    s = socket.socket()
    try:
        return s.connect_ex(("127.0.0.1", port)) != 0
    finally:
        s.close()


def start(home, port=PORT, extra_env=None, app=APP):
    env = dict(os.environ, COZYNOVEL_HOME=str(home), COZYNOVEL_PORT=str(port), **(extra_env or {}))
    p = subprocess.Popen([sys.executable, str(app / "serve.py")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for _ in range(100):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/api/version" % port, timeout=1).read()
            return p
        except Exception:
            time.sleep(0.1)
    p.terminate()
    raise SystemExit("the server did not start: " + p.stdout.read().decode()[-2000:])


class Page:
    """One kept-alive connection, like a browser tab's."""
    def __init__(self, port=PORT, client="tab-test"):
        self.c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        self.client = client
        self.port = port

    def ask(self, method, path, body=None, headers=None):
        h = {"X-Client": self.client, "Origin": "http://127.0.0.1:%d" % self.port, **(headers or {})}
        data = None
        if body is not None:
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        self.c.request(method, path, body=data, headers=h)
        r = self.c.getresponse()
        raw = r.read()
        try:
            return r.status, json.loads(raw.decode() or "null")
        except ValueError:
            return r.status, raw.decode(errors="replace")

    def put(self, kind, rid, data, base, save="", checkpoint=False):
        h = {"X-Base": str(base)}
        if save:
            h["X-Save"] = save
        if checkpoint:
            h["X-Checkpoint"] = "1"
        return self.ask("PUT", "/api/store/%s/%s" % (kind, rid), {"data": data}, h)


def main():
    home = Path(tempfile.mkdtemp(prefix="cozynovel-test-"))
    srv = start(home)
    try:
        run(home)
        run_relay(home)
    finally:
        srv.terminate()
        out = srv.stdout.read().decode()
        if "Traceback" in out:
            failed.append("server raised")
            print(out[-3000:])
    run_first_cozynovel()
    run_update_lands()
    run_launcher()
    run_pages_leave()
    run_gone_and_restore()
    run_left_half_made()
    shutil.rmtree(home, ignore_errors=True)
    print("\nserver: %d passed, %d failed" % (len(passed), len(failed)))
    sys.exit(1 if failed else 0)


def run(home):
    print("saves")
    pg = Page()
    st, out = pg.put("novel", "n-t1", {"meta": {"title": "One"}, "order": ["c-t1"], "plays": []}, 0, save="h1")
    check("a new record is made at rev 1", st == 200 and out["rev"] == 1, out)
    st, out = pg.put("chapter", "c-t1", {"novelId": "n-t1", "passages": [{"id": "p1"}]}, 0)
    check("its chapter too", st == 200 and out["rev"] == 1, out)
    st, out = pg.put("novel", "n-t1", {"meta": {"title": "One, again"}, "order": ["c-t1"], "plays": []}, 1, save="h2")
    check("a save from the newest copy is taken", st == 200 and out["rev"] == 2, out)
    st, out = pg.put("novel", "n-t1", {"meta": {"title": "stale"}, "order": [], "plays": []}, 1)
    check("a save from an older copy is refused with the newer copy", st == 409 and out["rev"] == 2 and out["data"]["meta"]["title"] == "One, again", out)
    st, out = pg.ask("GET", "/api/store/novel/n-t1")
    check("the phone names the saves it took", st == 200 and [s[0] for s in out.get("saves", [])] == ["h1", "h2"] and out["saves"][1][1] == "tab-test", out)
    st, out = pg.ask("GET", "/api/store/novel/n-none")
    check("a record not there is said plainly", st == 200 and out["data"] is None, out)
    # the page's own shape, {"data":…} and nothing else: the words are written as they came (never turned back into
    # JSON on the phone), and read back the same — odd letters, quotes, a space inside the body and a key beside it too
    odd = {"novelId": "n-t1", "passages": [{"id": "p1", "versions": [{"id": "v1", "text": "“Wait,” she said — a \\ backslash, a \"quote\", an emoji 🙂 and a 틀 door.\nNew line."}]}], "n": 1.5, "nothing": None, "yes": True}
    raw = ('{"data":' + json.dumps(odd, ensure_ascii=False) + '}').encode("utf-8")
    st, out = pg.ask("PUT", "/api/store/chapter/c-odd", raw, {"X-Base": "0", "X-Save": "s-odd"})
    st2, got = pg.ask("GET", "/api/store/chapter/c-odd")
    kept = json.loads((home / "store" / "chapter" / "c-odd.json").read_text(encoding="utf-8"))
    check("a save in the page's own shape is kept exactly as sent, and its file reads as one record",
          st == 200 and st2 == 200 and got["data"] == odd and kept["data"] == odd and kept["rev"] == 1 and kept["saves"][0][0] == "s-odd", (st, st2, got, kept))
    raw2 = ('{"data":' + json.dumps(dict(odd, n=2), ensure_ascii=False) + ' }  ').encode("utf-8")
    st, out = pg.ask("PUT", "/api/store/chapter/c-odd", raw2, {"X-Base": "1"})
    st2, got = pg.ask("GET", "/api/store/chapter/c-odd")
    check("spaces after the words change nothing", st == 200 and st2 == 200 and got["data"] == dict(odd, n=2), (st, got))
    raw3 = ('{"data":' + json.dumps(dict(odd, n=3), ensure_ascii=False) + ',"other":1}').encode("utf-8")
    st, out = pg.ask("PUT", "/api/store/chapter/c-odd", raw3, {"X-Base": "2"})
    st2, got = pg.ask("GET", "/api/store/chapter/c-odd")
    check("a body with more than the data beside it is kept the long way, the same", st == 200 and st2 == 200 and got["data"] == dict(odd, n=3) and got["rev"] == 3, (st, got))
    # a record the phone handled last is served from memory — only while its file is the one it read: a file changed
    # behind its back (a copy put back by hand) is read anew, and a save from the copy it served is held to the file
    path = home / "store" / "chapter" / "c-odd.json"
    behind = json.loads(path.read_text(encoding="utf-8"))
    behind["rev"] = 9
    behind["data"]["n"] = 9
    time.sleep(0.02)
    path.write_text(json.dumps(behind, ensure_ascii=False), encoding="utf-8")
    st2, got = pg.ask("GET", "/api/store/chapter/c-odd")
    check("a record's file changed behind the phone's back is read anew, not served from memory", st2 == 200 and got["rev"] == 9 and got["data"]["n"] == 9, got)
    st, out = pg.ask("PUT", "/api/store/chapter/c-odd", raw3, {"X-Base": "3"})
    check("a save made from the copy served before it is refused with the newer one", st == 409 and out["rev"] == 9, out)
    st, out = pg.ask("DELETE", "/api/store/chapter/c-odd")
    st2, got = pg.ask("GET", "/api/store/chapter/c-odd")
    check("a record deleted is gone from memory too", st == 200 and st2 == 200 and got["data"] is None, (st, got))

    print("a book's lease: one browser at a time")
    a, b = Page(client="tab-a"), Page(client="tab-b")
    st, out = a.ask("POST", "/api/lease", {"key": "helper:n-t1", "ttl": 5000})
    check("a lease is given to the first to ask", st == 200 and out == {"ok": True}, out)
    st, out = b.ask("POST", "/api/lease", {"key": "helper:n-t1", "ttl": 5000})
    check("another browser is told it is held, and for how long", st == 200 and out["ok"] is False and 0 < out["left"] <= 5000, out)
    st, out = b.ask("POST", "/api/lease", {"key": "checker:n-t1", "ttl": 5000})
    check("the checker's lease is its own", out == {"ok": True}, out)
    st, out = a.ask("POST", "/api/lease", {"key": "helper:n-t1", "ttl": 5000})
    check("its holder renews it", out == {"ok": True}, out)
    st, out = b.ask("POST", "/api/lease", {"key": "helper:n-t1", "release": True})
    st, out = b.ask("POST", "/api/lease", {"key": "helper:n-t1", "ttl": 5000})
    check("only its holder lets it go", out["ok"] is False, out)
    st, out = a.ask("POST", "/api/lease", {"key": "helper:n-t1", "release": True})
    st, out = b.ask("POST", "/api/lease", {"key": "helper:n-t1", "ttl": 5000})
    check("let go, the next to ask has it", out == {"ok": True}, out)
    time.sleep(5.3)
    st, out = a.ask("POST", "/api/lease", {"key": "helper:n-t1", "ttl": 5000})
    check("a lease nobody renewed runs out", out == {"ok": True}, out)
    st, out = a.ask("POST", "/api/lease", {"key": "../../etc", "ttl": 5000})
    check("only a book's helper or checker has a lease", st == 400, out)
    st, out = a.ask("POST", "/api/lease", {"key": "helper:n-t1", "ttl": 5000}, {"Origin": "http://evil.example"})
    check("a page from elsewhere is turned away", st == 403, out)

    print("kept-alive connections")
    st, _ = pg.ask("POST", "/api/copies/now", {})
    st2, out2 = pg.ask("GET", "/api/copies")
    check("a request after a body the handler did not need is read whole", st == 200 and st2 == 200 and out2["copies"], (st, st2, out2))
    st, _ = pg.ask("PUT", "/api/store/nope/x", {"data": {}}, {"X-Base": "0"})
    st2, _ = pg.ask("GET", "/api/version")
    check("a refused request leaves the connection clean", st == 400 and st2 == 200, (st, st2))

    print("history")
    for i in range(12):
        pg.put("chapter", "c-t1", {"novelId": "n-t1", "passages": [{"id": "p1"}], "n": i}, i + 1)
    st, out = pg.ask("GET", "/api/history/chapter/c-t1")
    check("earlier copies are kept (the newest eight, then by the hour)", st == 200 and 8 <= len(out["copies"]) <= 12, len(out.get("copies", [])))
    before = len(out["copies"])
    pg.put("chapter", "c-t1", {"novelId": "n-t1", "passages": [{"id": "p1"}], "n": 99}, 13, checkpoint=True)
    st, out = pg.ask("GET", "/api/history/chapter/c-t1")
    check("a checkpoint save adds no earlier copy", len(out["copies"]) == before, (before, len(out["copies"])))
    # each earlier copy of a chapter says what it holds (his report, 2.12.3: which copy still has passage 2?)
    two = {"novelId": "n-t1", "passages": [
        {"id": "p1", "versions": [{"id": "v1", "text": "The lamp was cold."}, {"id": "v2", "text": "The lamp was cold and dark tonight."}], "pick": 1},
        {"id": "pb", "by": "break", "versions": []},
        {"id": "p2", "versions": [{"id": "v3", "text": "My beautiful passage two."}]}]}
    st, cur = pg.ask("GET", "/api/store/chapter/c-t1")
    pg.put("chapter", "c-t1", two, cur["rev"])
    pg.put("chapter", "c-t1", {"novelId": "n-t1", "passages": [two["passages"][0]]}, cur["rev"] + 1)
    st, out = pg.ask("GET", "/api/history/chapter/c-t1")
    newest = out["copies"][0]
    check("an earlier copy of a chapter says its passages and words — the version on show of each, never a scene break",
          (newest.get("passages"), newest.get("words")) == (2, 11), newest)
    st, got = pg.ask("GET", "/api/history/chapter/c-t1/" + newest["stamp"])
    check("and it holds what it says", st == 200 and [p["id"] for p in got["data"]["passages"]] == ["p1", "pb", "p2"], got if st != 200 else "")
    st, got = pg.ask("GET", "/api/history/chapter/c-t1/20200101-000000-000")
    check("a copy no longer kept is said as not kept (the page lists them again)", st == 404, (st, got))
    pg.put("house", "house", {"connections": [{"id": "c1"}]}, 0)
    pg.put("house", "house", {"connections": [{"id": "c1"}, {"id": "c2"}]}, 1)
    st, out = pg.ask("GET", "/api/history/house/house")
    check("his settings keep earlier copies too", st == 200 and len(out["copies"]) == 1, out)

    print("trash and coming back")
    pg.put("talk", "n-t1", {"novelId": "n-t1", "turns": [{"id": "t-old", "by": "you"}]}, 0)
    pg.put("draft", "n-t1", {"novelId": "n-t1", "direction": "next"}, 0)
    pg.put("play", "pl-1", {"id": "pl-1", "novelId": "n-t1", "turns": []}, 0)
    st, out = pg.ask("DELETE", "/api/store/talk/n-t1")
    st, out = pg.ask("GET", "/api/store/talk/n-t1")
    check("a deleted record keeps its number", out["data"] is None and out["rev"] == 1, out)
    st, out = pg.put("talk", "n-t1", {"novelId": "n-t1", "turns": [{"id": "t-new", "by": "you"}]}, 0)
    check("made again, it carries on from that number", st == 200 and out["rev"] == 2, out)
    st, trash = pg.ask("GET", "/api/trash")
    talk = [t for t in trash["trash"] if t["kind"] == "talk"][0]
    st, out = pg.ask("POST", "/api/trash/%s/restore" % talk["name"], {})
    st2, got = pg.ask("GET", "/api/store/talk/n-t1")
    ids = [t["id"] for t in got["data"]["turns"]]
    check("a conversation brought back keeps the one there now too", st == 200 and ids == ["t-old", "t-new"] and got["rev"] == 3, (st, ids, got.get("rev")))
    st, hist = pg.ask("GET", "/api/history/talk/n-t1")
    check("and the one there before it is kept as an earlier copy", len(hist["copies"]) >= 1, hist)

    pg.put("chapter", "c-t2", {"id": "c-t2", "novelId": "n-t1", "passages": []}, 0)
    st, nv = pg.ask("GET", "/api/store/novel/n-t1")
    pg.put("novel", "n-t1", dict(nv["data"], order=["c-t1", "c-t2"], plays=["pl-1"]), nv["rev"])
    pg.ask("DELETE", "/api/store/chapter/c-t2")
    st, nv = pg.ask("GET", "/api/store/novel/n-t1")
    pg.put("novel", "n-t1", dict(nv["data"], order=["c-t1"]), nv["rev"])
    pg.ask("DELETE", "/api/store/play/pl-1")
    st, nv = pg.ask("GET", "/api/store/novel/n-t1")
    pg.put("novel", "n-t1", dict(nv["data"], plays=[]), nv["rev"])
    st, trash = pg.ask("GET", "/api/trash")
    for kind in ("chapter", "play"):
        item = [t for t in trash["trash"] if t["kind"] == kind][0]
        pg.ask("POST", "/api/trash/%s/restore" % item["name"], {})
    st, nv = pg.ask("GET", "/api/store/novel/n-t1")
    check("a chapter brought back is in its book again", "c-t2" in nv["data"]["order"], nv["data"]["order"])
    check("a scene brought back is in its book again", "pl-1" in nv["data"]["plays"], nv["data"]["plays"])

    st, out = pg.ask("POST", "/api/revs", [["novel", "n-t1"], ["talk", "n-t1"], ["chapter", "c-gone"], ["chapter", "c-t1"]])
    revs = out["revs"]
    check("one question answers many revisions", revs["novel/n-t1"] == nv["rev"] and revs["talk/n-t1"] == 3 and revs["chapter/c-gone"] == 0 and revs["chapter/c-t1"] >= 13, revs)

    st, out = pg.ask("DELETE", "/api/store/novel/n-t1")
    st, trash = pg.ask("GET", "/api/trash")
    book = [t for t in trash["trash"] if t["kind"] == "novel"][0]
    check("a book goes with everything of it", book["count"] == 6, book)
    st, out = pg.ask("POST", "/api/revs", [["novel", "n-t1"]])
    check("a deleted book's number is told as gone", out["revs"]["novel/n-t1"] < 0, out)
    pg.ask("POST", "/api/trash/%s/restore" % book["name"], {})
    st, got = pg.ask("GET", "/api/store/chapter/c-t2")
    st2, nv = pg.ask("GET", "/api/store/novel/n-t1")
    check("and comes back whole, later numbered", got["data"] is not None and nv["data"] is not None and nv["rev"] > 0, (got, nv.get("rev")))

    print("copies of everything")
    st, out = pg.ask("POST", "/api/copies/now", {})
    name = out.get("name")
    st, ver = pg.ask("GET", "/api/version")
    gen = ver["generation"]
    pg.put("novel", "n-extra", {"meta": {"title": "Extra"}, "order": [], "plays": []}, 0)
    st, out = pg.ask("POST", "/api/copies/%s/restore" % name, {})
    st2, extra = pg.ask("GET", "/api/store/novel/n-extra")
    st3, ver2 = pg.ask("GET", "/api/version")
    check("a copy brought back makes the library exactly that copy", st == 200 and extra["data"] is None, (st, out, extra))
    check("with a copy of what was there first", bool(out.get("safety")) and (home / "copies" / out["safety"]).exists(), out)
    check("and the library's generation counts up", ver2["generation"] == gen + 1, (gen, ver2))
    st, out = pg.ask("POST", "/api/restore", {"format": "nope", "records": []})
    st2, nv = pg.ask("GET", "/api/store/novel/n-t1")
    check("a file that is not a copy changes nothing", st == 400 and nv["data"] is not None, (st, out))

    print("only this phone's own page")
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
    c.request("PUT", "/api/store/novel/n-x", body=b'{"data":{}}', headers={"Origin": "http://evil.example", "Content-Type": "application/json"})
    r = c.getresponse(); r.read()
    check("a write from another web page is turned away", r.status == 403, r.status)
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
    c.request("GET", "/api/store/house/house", headers={"Host": "evil.example:%d" % PORT})
    r = c.getresponse(); r.read()
    check("a read under another address's name is turned away", r.status == 403, r.status)

    print("damaged files")
    (home / "store" / "chapter" / "c-bad.json").write_text("{not json", encoding="utf-8")
    st, out = pg.ask("GET", "/api/store/chapter/c-bad")
    check("a damaged record with no earlier copy is set aside, never read as data", out["data"] is None and (home / "store" / "chapter" / "c-bad.json.unreadable").exists(), out)
    pg.put("chapter", "c-bad", {"novelId": "n-t1", "passages": []}, 0)
    check("and a new save does not touch the damaged words", (home / "store" / "chapter" / "c-bad.json.unreadable").read_text() == "{not json")

    print("live news")
    s = socket.create_connection(("127.0.0.1", PORT))
    s.sendall(b"GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n\r\n" % PORT)
    s.settimeout(5)
    got = b""
    while b"hello" not in got:
        got += s.recv(4096)
    check("a page is greeted with the commit and generation", b'"generation"' in got)
    pg.put("draft", "n-live", {"direction": "x"}, 0)
    got = b""
    t0 = time.time()
    while b"n-live" not in got and time.time() - t0 < 5:
        got += s.recv(4096)
    check("every change is told at once", b"n-live" in got)
    s.close()

    print("the first Cozy Novel's files")
    db = sqlite3.connect(str(home / "library.sqlite3"))
    db.executescript("CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT, novel TEXT, body TEXT); CREATE TABLE blobs (id TEXT PRIMARY KEY, text TEXT);")
    db.execute("INSERT INTO records VALUES ('novel_1','novel','novel_1',?)", (json.dumps({"id": "novel_1", "type": "novel", "title": "Old"}),))
    db.commit(); db.close()
    st, peek = pg.ask("GET", "/api/legacy?peek=1")
    check("a quick look says the old library is there, without reading it", peek.get("found") is True and "records" not in peek and peek["stamp"], peek)
    st, full = pg.ask("GET", "/api/legacy")
    check("and reading it brings its records", full["records"][0]["title"] == "Old" and full["stamp"] == peek["stamp"], full)


def run_relay(home):
    print("the line out to a model")
    gone = threading.Event()
    talked = threading.Event()

    class Up(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            if body.get("fail"):
                data = json.dumps({"error": {"message": "nope"}}).encode()
                self.send_response(400); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
                return
            if not body.get("stream"):
                data = json.dumps({"choices": [{"message": {"content": "whole"}}]}).encode()
                self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(b'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'); self.wfile.flush()
            talked.set()
            if body.get("think_silently"):
                # a model thinking in silence: nothing for a long while
                self.connection.settimeout(15)
                try:
                    if self.connection.recv(1) == b"":
                        gone.set()
                except OSError:
                    gone.set()
                return
            self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()

    up = ThreadingHTTPServer(("127.0.0.1", UP_PORT), Up)
    threading.Thread(target=up.serve_forever, daemon=True).start()
    pg = Page()
    url = "http://127.0.0.1:%d/v1/chat/completions" % UP_PORT
    st, out = pg.ask("POST", "/api/call", {"url": url, "headers": {}, "body": {"stream": False}, "stream": False})
    check("a whole answer comes back as the provider sent it", st == 200 and out["choices"][0]["message"]["content"] == "whole", out)
    st, out = pg.ask("POST", "/api/call", {"url": url, "headers": {}, "body": {"fail": True}, "stream": True})
    check("a refusal comes back with its status and words", out.get("error") == "provider" and out.get("status") == 400 and "nope" in out.get("detail", ""), out)
    st, out = pg.ask("POST", "/api/call", {"url": "http://127.0.0.1:1/v1/chat/completions", "headers": {}, "body": {}, "stream": True})
    check("an address nothing answers is said to be one", out.get("error") == "transport", out)
    st, out = pg.ask("POST", "/api/call", {"url": url, "headers": {}, "body": {"stream": True}, "stream": True})
    check("a stream comes back word for word", "Hi" in str(out) and "[DONE]" in str(out), out)
    # Stop while the model thinks in silence: the provider is hung up on at once
    s = socket.create_connection(("127.0.0.1", PORT))
    req = json.dumps({"url": url, "headers": {}, "body": {"stream": True, "think_silently": True}, "stream": True}).encode()
    s.sendall(b"POST /api/call HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s" % (PORT, len(req), req))
    talked.wait(5)
    time.sleep(0.3)
    t0 = time.time()
    s.close()
    gone.wait(5)
    check("Stop reaches the provider even while it is silent", gone.is_set() and time.time() - t0 < 2.5, time.time() - t0)
    up.shutdown()


def run_first_cozynovel():
    print("coming from the first Cozy Novel")
    folder = Path(tempfile.mkdtemp(prefix="cozynovel-app-"))
    home = Path(tempfile.mkdtemp(prefix="cozynovel-home-"))
    prefix = Path(tempfile.mkdtemp(prefix="cozynovel-prefix-"))
    try:
        # the first version, installed and running from this folder
        old = subprocess.run(["git", "-C", str(APP), "archive", "f0f58a7"], capture_output=True)
        if old.returncode != 0:
            check("the first version's files are at hand", False, old.stderr.decode()[:200])
            return
        subprocess.run(["tar", "-x", "-C", str(folder)], input=old.stdout, check=True)
        (prefix / "bin").mkdir()
        (prefix / "bin" / "cozynovel").write_text("#!/usr/bin/env sh\n# Cozy Novel installed launcher\nexec python3 '%s/serve.py' \"$@\"\n" % folder)
        first = subprocess.Popen([sys.executable, str(folder / "serve.py"), "--port", str(PORT + 5), "--data-dir", str(home)],
                                 cwd=str(folder), stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        for _ in range(80):
            if not free_port(PORT + 5):
                break
            time.sleep(0.1)
        # the update lands on disk: the same folder now holds 2.0
        for item in folder.iterdir():
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()
        for item in APP.iterdir():
            if item.name in (".git", "tests", "__pycache__"):
                continue
            (shutil.copytree if item.is_dir() else shutil.copy2)(item, folder / item.name)
        new = start(home, port=PORT + 5, extra_env={"PREFIX": str(prefix)}, app=folder)
        try:
            st, ver = Page(PORT + 5).ask("GET", "/api/version")
            check("the new server takes the port from the first one by itself", ver.get("version", "").startswith("2."), ver)
            check("the first one is gone", first.wait(timeout=5) is not None)
            text = (prefix / "bin" / "cozynovel").read_text()
            check("and the cozynovel command now updates and opens the app", "cozynovel.sh" in text and str(folder) in text, text)
        finally:
            new.terminate()
            new.wait(timeout=5)
    finally:
        try:
            first.kill()
        except Exception:
            pass
        for d in (folder, home, prefix):
            shutil.rmtree(d, ignore_errors=True)


def run_update_lands():
    """An update pulled into the app's folder relights the server by itself —
    even one that changed only the page's own files — and the page it sends
    says which code it is."""
    print("an update lands by itself")
    folder = Path(tempfile.mkdtemp(prefix="cozynovel-git-"))
    home = Path(tempfile.mkdtemp(prefix="cozynovel-home-"))
    port = PORT + 7
    git = lambda *a: subprocess.run(["git", "-C", str(folder), "-c", "user.name=t", "-c", "user.email=t@t", *a], capture_output=True, text=True)
    srv = None
    try:
        for item in APP.iterdir():
            if item.name in (".git", "tests", "__pycache__"):
                continue
            (shutil.copytree if item.is_dir() else shutil.copy2)(item, folder / item.name)
        git("init", "-q")
        git("add", "-A")
        git("commit", "-q", "-m", "one")
        first = git("rev-parse", "HEAD").stdout.strip()
        srv = start(home, port=port, app=folder)
        page = urllib.request.urlopen("http://127.0.0.1:%d/" % port, timeout=5).read().decode()
        check("the page says which code it is", '<meta name="cozynovel-commit" content="%s">' % first in page, page[:400])
        check("a first start on an empty library keeps no copy", not list((home / "copies").glob("cozynovel-before-update-*")), list((home / "copies").glob("*")))
        # the book as it stands before the update
        Page(port).put("chapter", "c-up", {"id": "c-up", "passages": [{"id": "p2", "versions": [{"id": "v", "text": "Passage two, before the update."}]}]}, 0)
        # a page being written through the relay while the update lands: the
        # update waits for it, and never cuts it short
        class Slow(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *a):
                pass
            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(b'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'); self.wfile.flush()
                time.sleep(4)
                self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()
        slow = ThreadingHTTPServer(("127.0.0.1", UP_PORT + 3), Slow)
        threading.Thread(target=slow.serve_forever, daemon=True).start()
        streamed = {}
        def page_being_written():
            req = urllib.request.Request("http://127.0.0.1:%d/api/call" % port, method="POST", headers={"Content-Type": "application/json", "X-Client": "tab-test", "Origin": "http://127.0.0.1:%d" % port},
                                         data=json.dumps({"url": "http://127.0.0.1:%d/v1/chat/completions" % (UP_PORT + 3), "headers": {}, "body": {"stream": True}, "stream": True}).encode())
            try:
                streamed["text"] = urllib.request.urlopen(req, timeout=20).read().decode()
            except Exception as e:
                streamed["text"] = "broke: %s" % e
        writing = threading.Thread(target=page_being_written)
        writing.start()
        time.sleep(0.8)
        # a pull that changes only the page's own files
        util = folder / "js" / "util.js"
        util.write_text(util.read_text() + "\n/* a later version */\n")
        git("commit", "-q", "-am", "two")
        second = git("rev-parse", "HEAD").stdout.strip()
        time.sleep(2.6)
        try:
            during = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/api/version" % port, timeout=1).read()).get("commit", "")
        except Exception:
            during = ""
        writing.join(15)
        slow.shutdown()
        check("an update waits for a page being written through it — the page comes whole", during == first and "[DONE]" in streamed.get("text", ""), (during[:7], first[:7], streamed.get("text", "")[-80:]))
        got = ""
        for _ in range(60):
            try:
                got = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/api/version" % port, timeout=1).read()).get("commit", "")
            except Exception:
                got = ""
            if got == second:
                break
            time.sleep(0.25)
        check("a pull that changed only the page's files relights the server with it", got == second, (first[:7], second[:7], got[:7]))
        # everything as it was, kept whole before the new code opened a book (his report, 2.12.3: "your update broke my passage 2")
        kept = sorted((home / "copies").glob("cozynovel-before-update-*.json.gz"))
        held = []
        if kept:
            import gzip
            snap = json.loads(gzip.decompress(kept[0].read_bytes()).decode())
            held = [r["data"]["passages"][0]["versions"][0]["text"] for r in snap["records"] if r["kind"] == "chapter" and r["id"] == "c-up"]
        st, listed = Page(port).ask("GET", "/api/copies")
        check("an update keeps a copy of everything first — listed with the copies, the book as it stood",
              len(kept) == 1 and held == ["Passage two, before the update."] and any(c["name"] == kept[0].name for c in listed["copies"]), (kept, held))
    finally:
        if srv:
            srv.terminate()
            try:
                srv.wait(timeout=5)
            except Exception:
                srv.kill()
        # the relit server is a new process under the same pid; make sure nothing is left on the port
        for _ in range(20):
            if free_port(port):
                break
            time.sleep(0.25)
        for d in (folder, home):
            shutil.rmtree(d, ignore_errors=True)


def run_launcher():
    """The one word says which Cozy Novel it opened."""
    print("the cozynovel word")
    folder = Path(tempfile.mkdtemp(prefix="cozynovel-app-"))
    home = Path(tempfile.mkdtemp(prefix="cozynovel-home-"))
    port = PORT + 11
    try:
        for item in APP.iterdir():
            if item.name in (".git", "tests", "__pycache__"):
                continue
            (shutil.copytree if item.is_dir() else shutil.copy2)(item, folder / item.name)
        env = dict(os.environ, COZYNOVEL_PORT=str(port), COZYNOVEL_HOME=str(home), PATH="/usr/bin:/bin")
        out = subprocess.run(["bash", str(folder / "cozynovel.sh")], env=env, capture_output=True, text=True, timeout=60).stdout
        version = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/api/version" % port, timeout=2).read()).get("version", "")
        check("it says which Cozy Novel is open", version and ("Cozy Novel %s is open at http://127.0.0.1:%d" % (version, port)) in out, out)
    finally:
        try:
            req = urllib.request.Request("http://127.0.0.1:%d/api/quit" % port, data=b"{}", method="POST", headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:%d" % port})
            urllib.request.urlopen(req, timeout=3).read()
        except Exception:
            pass
        for _ in range(20):
            if free_port(port):
                break
            time.sleep(0.25)
        for d in (folder, home):
            shutil.rmtree(d, ignore_errors=True)


def run_gone_and_restore():
    """What a book gone for good leaves behind is swept; a whole copy carries
    only the shelf's books; a copy that cannot be brought back whole is not
    brought back at all; the pages are told the library's new generation."""
    print("what a gone book leaves, and copies brought back")
    home = Path(tempfile.mkdtemp(prefix="cozynovel-gone-"))
    port = PORT + 13
    old = time.time() - 40 * 86400

    def put_gz(path, obj, at=None):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(gzip.compress(json.dumps(obj).encode()))
        if at:
            os.utime(path, (at, at))

    def rec(kind, rid, data, rev=1):
        p = home / "store" / kind / (rid + ".json")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"rev": rev, "at": 1, "data": data}))

    H, SENT = home / "history", home / "sent"
    # a book on the shelf, with its earlier copies and what its pages were sent
    rec("novel", "n-live", {"meta": {"title": "Live"}, "order": [], "plays": []})
    put_gz(H / "novel" / "n-live" / "20200101-000000-000.json.gz", {"rev": 0, "data": {}}, old)
    put_gz(SENT / "n-live" / "k1.json.gz", {"messages": []}, old)
    # gone for good, long ago
    put_gz(H / "chapter" / "c-gone" / "20200101-000000-000.json.gz", {"rev": 0, "data": {}}, old)
    put_gz(SENT / "n-gone" / "k1.json.gz", {"messages": []}, old)
    # gone, but waiting in Recently deleted
    put_gz(home / "trash" / ("%s-000-novel-n-trashed.json.gz" % time.strftime("%Y%m%d-%H%M%S")), {"kind": "novel", "id": "n-trashed", "title": "Trashed", "at": 1,
           "records": [{"kind": "novel", "id": "n-trashed", "rev": 1, "data": {"meta": {"title": "Trashed"}}}, {"kind": "chapter", "id": "c-trashed", "rev": 1, "data": {"novelId": "n-trashed"}}]})
    put_gz(H / "chapter" / "c-trashed" / "20200101-000000-000.json.gz", {"rev": 0, "data": {}}, old)
    put_gz(SENT / "n-trashed" / "k1.json.gz", {"messages": []}, old)
    # gone lately: kept as long as Recently deleted would keep it
    put_gz(H / "chapter" / "c-lately" / "20260101-000000-000.json.gz", {"rev": 0, "data": {}})
    srv = start(home, port)
    try:
        for _ in range(60):
            if not (H / "chapter" / "c-gone").exists() and not (SENT / "n-gone").exists():
                break
            time.sleep(0.1)
        check("a record gone for good leaves nothing behind: its earlier copies, a book's sent words",
              not (H / "chapter" / "c-gone").exists() and not (SENT / "n-gone").exists(), sorted(str(p.relative_to(home)) for p in home.rglob("*") if p.is_dir()))
        check("…never what a book on the shelf, one in Recently deleted, or one gone lately keeps",
              (H / "novel" / "n-live").exists() and (SENT / "n-live").exists() and (H / "chapter" / "c-trashed").exists() and (SENT / "n-trashed").exists() and (H / "chapter" / "c-lately").exists())
        pg = Page(port)
        st, snap = pg.ask("GET", "/api/backup")
        check("a whole copy carries what the shelf's books were sent, and nothing of a book gone from it", st == 200 and sorted((snap.get("sent") or {}).keys()) == ["n-live"], (st, sorted((snap.get("sent") or {}).keys()) if isinstance(snap, dict) else snap))

        # a copy that cannot be brought back whole is not brought back at all
        pg.put("chapter", "c-live1", {"novelId": "n-live", "passages": [{"id": "p1"}]}, 0)
        st, nv = pg.ask("GET", "/api/store/novel/n-live")
        pg.put("novel", "n-live", dict(nv["data"], order=["c-live1"]), nv["rev"])
        st, ver = pg.ask("GET", "/api/version")
        gen = ver["generation"]
        # a place no record can be written (standing in for a phone that has run out of room)
        boom = home / "store" / "chapter" / "c-boom.json"
        boom.mkdir()
        (boom / "x").write_text("x")
        copy = {"format": "cozynovel-library", "records": [
            {"kind": "novel", "id": "n-copy", "rev": 1, "data": {"meta": {"title": "From the copy"}, "order": ["c-copy", "c-boom"], "plays": []}},
            {"kind": "chapter", "id": "c-copy", "rev": 1, "data": {"novelId": "n-copy", "passages": []}},
            {"kind": "chapter", "id": "c-boom", "rev": 1, "data": {"novelId": "n-copy", "passages": []}}],
            "sent": {"n-copy": {"k9": {"messages": []}}}}
        st, out = pg.ask("POST", "/api/restore", copy)
        _, a = pg.ask("GET", "/api/store/novel/n-live")
        _, b = pg.ask("GET", "/api/store/chapter/c-live1")
        _, c = pg.ask("GET", "/api/store/novel/n-copy")
        _, d = pg.ask("GET", "/api/store/chapter/c-copy")
        _, ver2 = pg.ask("GET", "/api/version")
        check("a copy that cannot be brought back whole leaves everything as it was, and says so",
              st == 500 and "everything is as it was" in (out or {}).get("error", "") and a["data"] and a["data"]["order"] == ["c-live1"] and b["data"] is not None
              and c["data"] is None and d["data"] is None and ver2["generation"] == gen, (st, out, a.get("data"), c.get("data"), d.get("data"), gen, ver2.get("generation")))
        check("…what its pages were sent too, and no half-written file is left",
              (SENT / "n-live" / "k1.json.gz").exists() and (SENT / "n-trashed" / "k1.json.gz").exists() and not (SENT / "n-copy").exists()
              and not any(p.name.endswith(".tmp") for p in (home / "store" / "chapter").iterdir()) and not list(home.glob("sent.before-*")))
        # brought back whole: every page is told the library's new generation, and a book in Recently deleted keeps its sent words
        shutil.rmtree(boom)
        s = socket.create_connection(("127.0.0.1", port))
        s.sendall(b"GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n\r\n" % port)
        s.settimeout(5)
        got = b""
        while b"hello" not in got:
            got += s.recv(4096)
        st, out = Page(port).ask("POST", "/api/restore", copy)
        got = b""
        t0 = time.time()
        while b"reload" not in got and time.time() - t0 < 5:
            got += s.recv(4096)
        s.close()
        _, ver3 = pg.ask("GET", "/api/version")
        told = [json.loads(line[6:]) for line in got.decode().split("\n") if line.startswith("data: ") and "reload" in line]
        check("a copy brought back tells every page the library's new generation", st == 200 and told and told[0].get("generation") == ver3["generation"] == gen + 1, (st, told, ver3.get("generation"), gen))
        check("…and a book waiting in Recently deleted keeps what its pages were sent; one the copy does not hold goes",
              (SENT / "n-copy" / "k9.json.gz").exists() and (SENT / "n-trashed" / "k1.json.gz").exists() and not (SENT / "n-live").exists() and not list(home.glob("sent.before-*")))
    finally:
        srv.terminate()
        out = srv.stdout.read().decode()
        if "Traceback" in out:
            failed.append("server raised (gone and restore)")
            print(out[-3000:])
        shutil.rmtree(home, ignore_errors=True)


def run_pages_leave():
    """Android closes a tab — or he does — while its save is on the way. The
    server goes on serving, and writes nothing about the page that left into
    the log the launcher shows him when the server will not start."""
    print("pages that go away before their answer")
    home = Path(tempfile.mkdtemp(prefix="cozynovel-home-"))
    port = PORT + 9
    srv = start(home, port=port)
    try:
        for i in range(40):
            s = socket.create_connection(("127.0.0.1", port))
            body = json.dumps({"data": {"novelId": "n-1", "passages": [{"id": "p1"}], "n": i}}).encode()
            head = ("PUT /api/store/chapter/c-gone-%d HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nX-Client: tab-gone\r\n"
                    "Origin: http://127.0.0.1:%d\r\nX-Base: 0\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n"
                    % (i, port, port, len(body))).encode()
            s.sendall(head + body)
            # gone at once, the way a closed tab goes: a reset, not a goodbye
            s.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
            s.close()
        time.sleep(0.5)
        st, out = Page(port).ask("GET", "/api/version")
        check("the server still answers after forty pages left mid-save", st == 200 and isinstance(out, dict) and out.get("version"), (st, out))
    finally:
        srv.terminate()
        log = srv.stdout.read().decode()
        shutil.rmtree(home, ignore_errors=True)
    check("and writes nothing about the pages that left into its log", "Traceback" not in log and "Error" not in log, log[-1500:])



def run_left_half_made():
    """A branch receipt that cannot be read never keeps the server from
    starting: it is set aside, the readable ones are still put right. And a
    library number that cannot be read just now never reads as 0."""
    print("what a stop left half made")
    home = Path(tempfile.mkdtemp(prefix="cozynovel-home-"))
    port = PORT + 17
    ops = home / "branch-operations"
    ops.mkdir(parents=True)
    (ops / "a-garbled.json").write_text("{not json", encoding="utf-8")
    (ops / "b-odd.json").write_text(json.dumps({"state": "building", "novelId": "n-odd", "targets": "not a list"}), encoding="utf-8")
    (ops / "c-half.json").write_text(json.dumps({"state": "building", "novelId": "n-half", "targets": [["novel", "n-half"]]}), encoding="utf-8")
    (home / "store" / "novel").mkdir(parents=True)
    (home / "store" / "novel" / "n-half.json").write_text(json.dumps({"rev": 1, "at": 1, "data": {"id": "n-half", "title": "Half made"}}), encoding="utf-8")
    (home / "store" / "novel" / "n-kept.json").write_text(json.dumps({"rev": 1, "at": 1, "data": {"id": "n-kept", "title": "His book"}}), encoding="utf-8")
    (home / "generation").write_text("7", encoding="utf-8")
    srv = None
    try:
        srv = start(home, port=port)
        page = Page(port)
        st, out = page.ask("GET", "/api/version")
        check("the server starts past a receipt it cannot read", st == 200 and isinstance(out, dict), (st, out))
        check("the unreadable receipts are set aside, said as such", (ops / "a-garbled.json.unreadable").exists() and (ops / "b-odd.json.unreadable").exists()
              and not (ops / "a-garbled.json").exists() and not (ops / "b-odd.json").exists(), sorted(x.name for x in ops.iterdir()))
        check("the readable one is still put right: its half-made book is gone, its receipt cleared",
              not (home / "store" / "novel" / "n-half.json").exists() and not (ops / "c-half.json").exists(), sorted(x.name for x in ops.iterdir()))
        st, out = page.ask("GET", "/api/store/novel/n-kept")
        check("and his own book is untouched", st == 200 and (out or {}).get("data", {}).get("title") == "His book", (st, out))
        st, out = page.ask("GET", "/api/version")
        check("the library's number is read", out.get("generation") == 7, out)
        (home / "generation").unlink()
        (home / "generation").mkdir()
        st, out = page.ask("GET", "/api/version")
        check("a number that cannot be read just now keeps the last one read, never 0", out.get("generation") == 7, out)
    finally:
        if srv:
            srv.terminate()
            log = srv.stdout.read().decode()
            check("the log says which receipt was set aside, with no traceback",
                  "a-garbled.json" in log and "b-odd.json" in log and "Traceback" not in log, log[-1500:])
        shutil.rmtree(home, ignore_errors=True)


if __name__ == "__main__":
    main()
