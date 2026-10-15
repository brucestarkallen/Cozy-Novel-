#!/usr/bin/env python3
"""Branches are complete independent books, even after a failed save or restart.
Real HTTP handlers, real files in temporary folders, and no model calls.
    python3 tests/branch_storage.py
"""
import copy
import errno
import http.client
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest

APP = Path(__file__).resolve().parents[1]


class BranchStorage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="cozy-branch-storage-")
        self.home = Path(self.tmp.name)
        old = os.environ.get("COZYNOVEL_HOME")
        os.environ["COZYNOVEL_HOME"] = str(self.home)
        try:
            spec = importlib.util.spec_from_file_location("branch_server", APP / "serve.py")
            self.m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.m)
        finally:
            if old is None:
                os.environ.pop("COZYNOVEL_HOME", None)
            else:
                os.environ["COZYNOVEL_HOME"] = old
        for d in (self.m.STORE, self.m.HISTORY, self.m.TRASH, self.m.COPIES, self.m.SENT):
            d.mkdir(parents=True, exist_ok=True)
        self.server = self.m.Server(("127.0.0.1", 0), self.m.Handler)
        self.port = self.server.server_address[1]
        self.m.PORT = self.port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.seed()

    def tearDown(self):
        self.stop()
        self.tmp.cleanup()

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(timeout=2)
            self.server = None

    def request(self, method, path, body=None, port=None):
        port = self.port if port is None else port
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        try:
            c.request(method, path, json.dumps(body) if body is not None else None,
                      {"Content-Type": "application/json", "X-Client": "branch-test", "Origin": "http://127.0.0.1:%s" % port})
            r = c.getresponse()
            return r.status, json.loads(r.read())
        finally:
            c.close()

    def seed(self):
        records = [
            ("novel", "n-source", {"id": "n-source", "meta": {"title": "The original", "opened": 10}, "order": ["ch-source"], "plays": ["pl-source"]}),
            ("chapter", "ch-source", {"id": "ch-source", "novelId": "n-source", "passages": [{"id": "p-one", "versions": [{"id": "v-one", "text": "The first words.", "sent": "s-one", "sentMore": ["s-more"]}]}]}),
            ("play", "pl-source", {"id": "pl-source", "novelId": "n-source", "chapterId": "ch-source", "turns": []}),
            ("talk", "n-source", {"id": "n-source", "novelId": "n-source", "turns": []}),
            ("draft", "n-source", {"id": "n-source", "novelId": "n-source", "direction": "Mine, unsent."}),
        ]
        for kind, rid, data in records:
            self.m.put_record(kind, rid, data, 0)
        self.m.put_record("house", "house", {"private": "settings stay here"}, 0)
        for key in ("s-one", "s-more", "s-unused"):
            self.m.sent_put("n-source", key, {"messages": [{"content": "Exact sent words " + key}], "chapterId": "ch-source"})

    def payload(self, target="n-branch"):
        code, snapshot = self.request("GET", "/api/branches/n-source")
        self.assertEqual(code, 200, snapshot)
        records = copy.deepcopy(snapshot["records"])
        for e in records:
            e.pop("rev", None)
            e["id"] = e["id"].replace("source", target[2:])
            e["data"] = json.loads(json.dumps(e["data"]).replace("n-source", target).replace("ch-source", "ch-" + target[2:]).replace("pl-source", "pl-" + target[2:]))
            if e["kind"] == "novel":
                e["data"]["branch"] = {"rootId": "n-source", "fromId": "n-source", "name": "Another way", "at": 100, "point": {"kind": "book"}}
        return {"sourceId": "n-source", "sourceSentId": "n-source", "requestId": target,
                "generation": snapshot["generation"], "revisions": [{k: e[k] for k in ("kind", "id", "rev")} for e in snapshot["records"]], "records": records}

    def assertAbsent(self, payload):
        for e in payload["records"]:
            self.assertFalse(self.m.record_path(e["kind"], e["id"]).exists(), e)
        self.assertFalse((self.m.SENT / payload["requestId"]).exists())

    def test_snapshot_and_whole_creation_preserve_source_and_sent_words(self):
        before = {str(p.relative_to(self.home)): p.read_bytes() for p in self.m.STORE.rglob("*.json")}
        payload = self.payload()
        announced = []
        original = self.m.announce
        def announce(event):
            if event.get("id") == "n-branch":
                self.assertTrue(all(self.m.read_record(e["kind"], e["id"]) for e in payload["records"]))
                self.assertIsNotNone(self.m.sent_get("n-branch", "s-one"))
            announced.append(event)
            original(event)
        self.m.announce = announce
        code, out = self.request("POST", "/api/branches", payload)
        self.assertEqual((code, out.get("novelId"), out.get("chapterId")), (200, "n-branch", "ch-branch"))
        for name, raw in before.items():
            self.assertEqual((self.home / name).read_bytes(), raw)
        self.assertEqual(len(announced), len(payload["records"]))
        for key in ("s-one", "s-more"):
            self.assertEqual((self.m.SENT / "n-source" / (key + ".json.gz")).read_bytes(), (self.m.SENT / "n-branch" / (key + ".json.gz")).read_bytes())
        self.assertFalse((self.m.SENT / "n-branch" / "s-unused.json.gz").exists())
        self.m.delete_record("novel", "n-source")
        import shutil
        shutil.rmtree(self.m.SENT / "n-source")
        self.assertIn("Exact sent words", self.request("GET", "/api/sent/n-branch/s-one")[1]["messages"][0]["content"])
        row = next(r for r in self.request("GET", "/api/novels")[1]["novels"] if r["id"] == "n-branch")
        self.assertEqual(row["branch"], {"rootId": "n-source", "fromId": "n-source", "name": "Another way", "at": 100})

    def test_source_revision_vector_detects_edits_additions_and_deletion(self):
        payload = self.payload()
        data = self.m.read_record("chapter", "ch-source")["data"]
        data["passages"][0]["versions"][0]["text"] = "Changed in another window."
        self.m.put_record("chapter", "ch-source", data, 1)
        code, out = self.request("POST", "/api/branches", payload)
        self.assertEqual(code, 409)
        self.assertTrue(out.get("changed"))
        self.assertAbsent(payload)
        payload = self.payload()
        self.m.put_record("play", "pl-extra", {"id": "pl-extra", "novelId": "n-source", "chapterId": "ch-source"}, 0)
        self.assertEqual(self.request("POST", "/api/branches", payload)[0], 409)
        self.assertAbsent(payload)
        self.m.delete_record("play", "pl-extra")
        payload = self.payload()
        self.m.delete_record("novel", "n-source")
        self.assertEqual(self.request("POST", "/api/branches", payload)[0], 410)
        self.assertAbsent(payload)

    def test_payload_cannot_write_settings_or_foreign_or_incomplete_records(self):
        base = self.payload()
        variants = []
        x = copy.deepcopy(base); x["records"].append({"kind": "house", "id": "house", "data": {"id": "house"}}); variants.append(x)
        x = copy.deepcopy(base); next(e for e in x["records"] if e["kind"] == "chapter")["data"]["novelId"] = "n-source"; variants.append(x)
        x = copy.deepcopy(base); x["records"] = [e for e in x["records"] if e["kind"] != "chapter"]; variants.append(x)
        x = copy.deepcopy(base); x["records"].append(copy.deepcopy(x["records"][0])); variants.append(x)
        x = copy.deepcopy(base); x["sourceSentId"] = "someone-else"; variants.append(x)
        x = copy.deepcopy(base); x["revisions"] = []; variants.append(x)
        for x in variants:
            code, out = self.request("POST", "/api/branches", x)
            self.assertIn(code, (400, 409), out)
            self.assertAbsent(base)
        self.assertEqual(self.m.read_record("house", "house")["data"], {"private": "settings stay here"})

    def test_lost_ack_retry_does_not_overwrite_edits_or_resurrect_deleted_branch(self):
        payload = self.payload()
        first = self.request("POST", "/api/branches", payload)
        self.assertEqual(first[0], 200)
        d = self.m.read_record("chapter", "ch-branch")["data"]
        d["name"] = "Edited after creation"
        self.m.put_record("chapter", "ch-branch", d, 1)
        self.assertEqual(self.request("POST", "/api/branches", payload), first)
        self.assertEqual(self.m.read_record("chapter", "ch-branch")["data"]["name"], "Edited after creation")
        changed = copy.deepcopy(payload); changed["records"][0]["data"]["extra"] = "changed request"
        self.assertEqual(self.request("POST", "/api/branches", changed)[0], 409)
        self.m.delete_record("novel", "n-branch")
        self.assertEqual(self.request("POST", "/api/branches", payload)[0], 410)
        self.assertIsNone(self.m.read_record("novel", "n-branch"))

    def test_restore_rejects_old_operation_even_when_its_target_was_removed(self):
        payload = self.payload()
        before = self.m.library_snapshot(with_sent=True)
        self.assertEqual(self.request("POST", "/api/branches", payload)[0], 200)
        self.m.replace_library(before)
        code, out = self.request("POST", "/api/branches", payload)
        self.assertEqual(code, 409)
        self.assertTrue(out.get("reload"))
        self.assertAbsent(payload)

    def test_duplicate_requests_commit_once(self):
        payload = self.payload()
        gate = threading.Barrier(3)
        results = []
        def send():
            gate.wait()
            results.append(self.request("POST", "/api/branches", payload))
        threads = [threading.Thread(target=send) for _ in range(2)]
        for t in threads: t.start()
        gate.wait()
        for t in threads: t.join(timeout=10)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[0][0], 200)
        self.assertTrue(all(self.m.read_record(e["kind"], e["id"])["rev"] == 1 for e in payload["records"]))

    def test_readers_wait_for_complete_commit(self):
        payload = self.payload()
        wrote = threading.Event(); release = threading.Event(); seen = threading.Event()
        original = self.m.write_record
        def slow(kind, rid, rec):
            original(kind, rid, rec)
            if rid == "ch-branch":
                wrote.set()
                if not release.wait(8): raise RuntimeError("fixture release missing")
        self.m.write_record = slow
        result = []
        writer = threading.Thread(target=lambda: result.append(self.request("POST", "/api/branches", payload)))
        writer.start(); self.assertTrue(wrote.wait(5))
        observed = []
        def read():
            observed.append(self.request("GET", "/api/novels")); seen.set()
        reader = threading.Thread(target=read); reader.start()
        try:
            self.assertFalse(seen.wait(0.15), "the shelf saw a half-written branch")
        finally:
            release.set(); writer.join(timeout=10); reader.join(timeout=10)
        self.assertEqual(result[0][0], 200)
        self.assertIn("n-branch", [r["id"] for r in observed[0][1]["novels"]])

    def test_write_failure_rolls_back_without_events_and_can_retry(self):
        payload = self.payload()
        original = self.m.write_record
        events = []
        self.m.announce = events.append
        count = [0]
        def fail(kind, rid, rec):
            count[0] += 1
            if count[0] == 2: raise OSError(errno.ENOSPC, "fixture full disk")
            original(kind, rid, rec)
        self.m.write_record = fail
        code, out = self.request("POST", "/api/branches", payload)
        self.assertEqual(code, 507, out)
        self.assertAbsent(payload)
        self.assertEqual(events, [])
        self.m.write_record = original
        self.assertEqual(self.request("POST", "/api/branches", payload)[0], 200)

    def test_failed_commit_and_cleanup_stay_hidden_until_retry(self):
        payload = self.payload()
        receipt, undo = self.m._branch_receipt, self.m._undo_branch
        events = []
        self.m.announce = events.append
        def fail_commit(path, body):
            if body["state"] == "committed": raise OSError(errno.ENOSPC, "fixture commit failure")
            return receipt(path, body)
        def fail_cleanup(*args):
            raise OSError(errno.EACCES, "fixture temporary cleanup failure")
        self.m._branch_receipt, self.m._undo_branch = fail_commit, fail_cleanup
        self.assertEqual(self.request("POST", "/api/branches", payload)[0], 500)
        self.assertTrue(self.m.record_path("novel", "n-branch").exists(), "fixture wrote the book before its commit failed")
        self.assertIsNone(self.request("GET", "/api/store/novel/n-branch")[1]["data"])
        self.assertNotIn("n-branch", [r["id"] for r in self.request("GET", "/api/novels")[1]["novels"]])
        self.assertNotIn("n-branch", [r["id"] for r in self.request("GET", "/api/backup")[1]["records"]])
        self.assertEqual(self.request("GET", "/api/sent/n-branch/s-one")[0], 404)
        self.assertEqual(events, [])
        self.m._branch_receipt, self.m._undo_branch = receipt, undo
        self.assertEqual(self.request("POST", "/api/branches", payload)[0], 200)
        self.assertTrue(self.request("GET", "/api/store/novel/n-branch")[1]["data"])

    def test_a_removed_target_name_is_never_reused(self):
        payload = self.payload()
        self.m.put_record("chapter", "ch-branch", {"id": "ch-branch", "novelId": "another-book"}, 0)
        self.m.delete_record("chapter", "ch-branch")
        self.assertEqual(self.request("POST", "/api/branches", payload)[0], 409)
        self.assertAbsent(payload)

    def test_interrupted_write_is_cleaned_by_real_startup_then_same_request_works(self):
        payload = self.payload()
        self.stop()
        specfile = self.home / "fixture.json"
        specfile.write_text(json.dumps(payload))
        code = """import importlib.util,json,os,sys
spec=importlib.util.spec_from_file_location('app',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
old=m.write_record
def cut(kind,rid,rec):
 old(kind,rid,rec)
 os._exit(77)
m.write_record=cut
m.create_branch(json.load(open(sys.argv[2])))
"""
        env = dict(os.environ, COZYNOVEL_HOME=str(self.home), COZYNOVEL_PORT=str(self.port))
        stopped = subprocess.run([sys.executable, "-c", code, str(APP / "serve.py"), str(specfile)], env=env, timeout=10)
        self.assertEqual(stopped.returncode, 77)
        self.assertTrue((self.m.BRANCHES / "n-branch.json").is_file())
        self.assertTrue(any(self.m.record_path(e["kind"], e["id"]).exists() for e in payload["records"]))
        process = subprocess.Popen([sys.executable, str(APP / "serve.py")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        try:
            for _ in range(80):
                try:
                    if self.request("GET", "/api/version")[0] == 200: break
                except OSError:
                    pass
                time.sleep(0.05)
            else: self.fail("restarted server did not answer")
            self.assertAbsent(payload)
            self.assertEqual(self.request("POST", "/api/branches", payload)[0], 200)
            # A committed receipt also survives restarting the server.
            process.terminate(); process.wait(timeout=5); process.stdout.close()
            process = subprocess.Popen([sys.executable, str(APP / "serve.py")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            for _ in range(80):
                try:
                    if self.request("GET", "/api/version")[0] == 200: break
                except OSError: pass
                time.sleep(0.05)
            self.assertEqual(self.request("POST", "/api/branches", payload)[0], 200)
            self.request("DELETE", "/api/store/novel/n-branch")
            self.assertEqual(self.request("POST", "/api/branches", payload)[0], 410)
        finally:
            process.terminate(); process.wait(timeout=5); process.stdout.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
