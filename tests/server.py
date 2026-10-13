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

    def ask(self, method, path, body=None, headers=None):
        h = {"X-Client": self.client, "Origin": "http://127.0.0.1:%d" % PORT, **(headers or {})}
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


if __name__ == "__main__":
    main()
