#!/usr/bin/env python3
"""Cozy Novel — the little server that lives on the phone.

Your books live here, in files under ~/.cozynovel, never in a browser. Close
every tab, clear the browser, open a different one: the book is exactly where
you left it, because the phone is the only place it was ever kept. Every open
tab is told the moment something changes, so they all show the same book
without a refresh — the way SillyTavern keeps its data.

What it does:
  1. hands out the app's own files (never from a stale cache)
  2. keeps the books: one file per record, each save numbered, a save made
     from an older copy is refused and handed the newer one, so no tab can
     ever write over newer work
  3. keeps the earlier copies of every chapter and book, a copy of
     everything once a day, and whatever was deleted for thirty days
  4. carries every call out to the model, so keys stay on the phone and no
     provider's browser rules can get in the way
  5. relights itself when this file changes, so an update is never invisible
"""

import errno
import gzip
import hashlib
import select
import signal
import socket
import http.server
import json
import os
import queue
import re
import shutil
import socketserver
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    import fcntl
except ImportError:  # not Linux or Android: nothing to lock the folder with
    fcntl = None

VERSION = "2.12.16"
ROOT = Path(__file__).resolve().parent
SELF = Path(__file__).resolve()
HOME = Path(os.environ.get("COZYNOVEL_HOME") or (Path.home() / ".cozynovel")).expanduser().resolve()
PORT = int(os.environ.get("COZYNOVEL_PORT") or "8081")

STORE = HOME / "store"        # store/<kind>/<id>.json   {"rev": n, "at": ms, "data": {...}}
HISTORY = HOME / "history"    # history/<kind>/<id>/<stamp>.json.gz — the copy before each save
TRASH = HOME / "trash"        # trash/<stamp>-<kind>-<id>.json.gz — deleted things, kept 30 days
COPIES = HOME / "copies"      # copies/cozynovel-YYYY-MM-DD.json.gz — everything, once a day
SENT = HOME / "sent"          # sent/<novel>/<key>.json.gz — what the model was sent
BRANCHES = HOME / "branch-operations"  # durable creation receipts; an unfinished branch is rolled back on open
USAGE = HOME / "usage.json"   # {"days": {"YYYY-MM-DD": {"<address>|<model>": {calls, in, out, cached, cacheWrite?, anthropic?, prices?, estimated}}}} — Usage and cost

KINDS = ("house", "novel", "chapter", "talk", "play", "draft")
# his settings, connections and instructions keep their earlier copies too; only
# the composer's unsent words (draft) do not — they change with every key
KEPT_HISTORY = ("house", "novel", "chapter", "talk", "play")
SAVES_KEPT = 30                     # each record remembers its newest saves (which tab, which words)
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,96}$")
COPY_RE = re.compile(r"^cozynovel-(?:\d{4}-\d{2}-\d{2}|before-[0-9a-z-]{1,40})\.json\.gz$")
TRASH_RE = re.compile(r"^\d{8}-\d{6}-\d{3}-[a-z]+-[A-Za-z0-9_-]{1,96}\.json\.gz$")
STAMP_RE = re.compile(r"^\d{8}-\d{6}-\d{3}$")

MAX_BODY = 512 * 1024 * 1024        # a whole library brought back can be big
TRASH_DAYS = 30
DAILY_KEEP = 14
SENT_KEEP = 60                      # the newest requests of each book keep what was sent
HISTORY_NEWEST = 8
HISTORY_HOURLY_FOR = 2 * 24 * 3600
HISTORY_DAILY_FOR = 31 * 24 * 3600


def _commit():
    """The exact code this server was started from. The launcher and every open
    page compare it with what is on disk: different means stale."""
    try:
        out = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"],
                             capture_output=True, text=True, timeout=5)
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


COMMIT = _commit()
LOCK = threading.RLock()
_branch_hidden = set()        # unfinished new records are never another page's book
# the model calls going through the relay right now: an update waits for them
CALLS = {"n": 0}
CALLS_LOCK = threading.Lock()
RELIGHT_WAIT_MAX = 15 * 60


def now_ms():
    return int(time.time() * 1000)


def stamp(at=None):
    t = time.time() if at is None else at
    return time.strftime("%Y%m%d-%H%M%S", time.localtime(t)) + "-%03d" % int((t % 1) * 1000)


def atomic_write_bytes(path: Path, data: bytes):
    """Through a temp file, so a half-written file can never exist (and a
    write that fails leaves no temp file behind)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise


def gz_bytes(obj) -> bytes:
    return gzip.compress(json.dumps(obj, ensure_ascii=False).encode("utf-8"), compresslevel=6)


def read_gz(path: Path):
    with gzip.open(path, "rb") as f:
        return json.loads(f.read().decode("utf-8"))


# ------------------------------------------------------------------ records

def record_path(kind, rid):
    return STORE / kind / (rid + ".json")


# The records handled last, parsed, with the file's time they were read or
# written at: a chapter of a few megabytes is read and parsed from the phone's
# flash for every save of it (every few seconds while a page is written), and
# that parse held the whole server — the words streaming through the relay
# waited on it (2.12.5). A record is served from here only while its file is
# the one it was read from; a caller never changes what it is handed.
_parsed = {}                  # (kind, rid) -> (mtime_ns, size, rec)
PARSED_KEPT = 8


def _parsed_get(kind, rid, p):
    hit = _parsed.get((kind, rid))
    if not hit:
        return None
    try:
        st = p.stat()
    except OSError:
        return None
    if hit[0] == st.st_mtime_ns and hit[1] == st.st_size:
        _parsed[(kind, rid)] = _parsed.pop((kind, rid))   # newest last
        return hit[2]
    return None


def _parsed_put(kind, rid, p, rec):
    try:
        st = p.stat()
    except OSError:
        return
    _parsed.pop((kind, rid), None)
    _parsed[(kind, rid)] = (st.st_mtime_ns, st.st_size, rec)
    while len(_parsed) > PARSED_KEPT:
        _parsed.pop(next(iter(_parsed)))


def read_record(kind, rid):
    """{"rev", "at", "data"} or None. A file that cannot be read is put back from
    its newest earlier copy (the unreadable one is kept beside it), so a book is
    never lost to a damaged file."""
    if (kind, rid) in _branch_hidden:
        return None
    p = record_path(kind, rid)
    kept = _parsed_get(kind, rid, p)
    if kept is not None:
        return kept
    try:
        with open(p, "rb") as f:
            rec = json.loads(f.read().decode("utf-8"))
        if isinstance(rec, dict) and isinstance(rec.get("data"), dict):
            _parsed_put(kind, rid, p, rec)
            return rec
        raise ValueError("not a record")
    except FileNotFoundError:
        return None
    except Exception as e:
        good = newest_history(kind, rid)
        print("could not read %s (%s) — %s" % (p, e, "put back from its newest earlier copy" if good else "kept aside as .unreadable"),
              file=sys.stderr)
        with LOCK:
            kept = False
            try:
                shutil.copyfile(p, p.with_name(p.name + ".unreadable"))
                kept = True
            except OSError:
                pass
            if not good:
                # nothing to put back: the damaged file is kept beside, never written over
                if kept:
                    try:
                        p.unlink()
                    except OSError:
                        pass
                return None
            good["rev"] = max(int(good.get("rev") or 0), gone_rev(kind, rid)) + 1
            atomic_write_bytes(p, json.dumps(good, ensure_ascii=False).encode("utf-8"))
        return good


def history_dir(kind, rid):
    return HISTORY / kind / rid


def newest_history(kind, rid):
    d = history_dir(kind, rid)
    if not d.is_dir():
        return None
    for f in sorted(d.glob("*.json.gz"), reverse=True):
        try:
            rec = read_gz(f)
            if isinstance(rec, dict) and isinstance(rec.get("data"), dict):
                return rec
        except Exception:
            continue
    return None


def keep_which(names, at=None):
    """Which earlier copies stay: the newest eight; then the newest of each hour
    for two days; then the newest of each day for a month. A name it cannot read
    is never thrown away."""
    at = time.time() if at is None else at
    dated = []
    for n in names:
        s = n[:19]
        try:
            dated.append((time.mktime(time.strptime(s[:15], "%Y%m%d-%H%M%S")), s, n))
        except ValueError:
            dated.append((at, "", n))
    dated.sort(reverse=True)
    keep, hours, days = set(), set(), set()
    for i, (t, s, n) in enumerate(dated):
        age = at - t
        if i < HISTORY_NEWEST or not s:
            keep.add(n)
        elif age <= HISTORY_HOURLY_FOR and s[:11] not in hours:
            keep.add(n)
        elif age <= HISTORY_DAILY_FOR and s[:8] not in days:
            keep.add(n)
        if s:
            hours.add(s[:11])
            days.add(s[:8])
    return keep


def keep_earlier(kind, rid, rec):
    """The copy about to be replaced goes into the record's history."""
    try:
        d = history_dir(kind, rid)
        d.mkdir(parents=True, exist_ok=True)
        atomic_write_bytes(d / (stamp() + ".json.gz"), gz_bytes(rec))
        names = [f.name for f in d.glob("*.json.gz")]
        keep = keep_which(names)
        for n in names:
            if n not in keep:
                (d / n).unlink(missing_ok=True)
    except Exception as e:  # a copy must never stop a save
        print("earlier copy skipped:", e, file=sys.stderr)


# ---- the numbers a deleted record had: a record made again under the same id
# (a conversation started over, something brought back) carries on from them,
# so no open page mistakes the new one for an older copy
GONE = HOME / "gone.json"
_gone = None


def _gone_map():
    global _gone
    if _gone is None:
        try:
            _gone = json.loads(GONE.read_text(encoding="utf-8"))
            if not isinstance(_gone, dict):
                _gone = {}
        except (OSError, ValueError):
            _gone = {}
    return _gone


def gone_rev(kind, rid):
    try:
        return int(_gone_map().get(kind + "/" + rid) or 0)
    except (TypeError, ValueError):
        return 0


def set_gone(kind, rid, rev):
    m = _gone_map()
    key = kind + "/" + rid
    if rev:
        m[key] = max(int(m.get(key) or 0), int(rev))
    elif key in m:
        del m[key]
    else:
        return
    try:
        atomic_write_bytes(GONE, json.dumps(m).encode("utf-8"))
    except OSError as e:
        print("could not keep the numbers of deleted records:", e, file=sys.stderr)


# ---- every record's rev, without reading the whole record each time
_revs = {}


def rev_of(kind, rid):
    if (kind, rid) in _branch_hidden:
        return 0
    p = record_path(kind, rid)
    try:
        mt = p.stat().st_mtime_ns
    except OSError:
        return 0
    hit = _revs.get((kind, rid))
    if hit and hit[0] == mt:
        return hit[1]
    rec = read_record(kind, rid)
    rev = int(rec.get("rev") or 0) if rec else 0
    try:
        _revs[(kind, rid)] = (p.stat().st_mtime_ns, rev)
    except OSError:
        pass
    return rev


def write_record(kind, rid, rec, data_bytes=None):
    """data_bytes: the record's data as the page sent it, in JSON already — written
    as it came, around the record's own fields, instead of being turned back into
    JSON (a chapter of megabytes, every few seconds while it is written)."""
    p = record_path(kind, rid)
    if data_bytes is not None:
        head = json.dumps({k: v for k, v in rec.items() if k != "data"}, ensure_ascii=False).encode("utf-8")
        out = head[:-1] + b',"data":' + data_bytes + b"}"
    else:
        out = json.dumps(rec, ensure_ascii=False).encode("utf-8")
    atomic_write_bytes(p, out)
    _parsed_put(kind, rid, p, rec)
    try:
        _revs[(kind, rid)] = (p.stat().st_mtime_ns, int(rec.get("rev") or 0))
    except OSError:
        _revs.pop((kind, rid), None)


def put_record(kind, rid, data, base, by="", checkpoint=False, save="", expected_generation=None, data_bytes=None):
    """Save one record. base is the rev the page's copy was made from (0 = it
    believes the record is new). save names the words saved (the page's own
    name for this save), so a page can later tell whether a save of its
    landed. data_bytes: the data's JSON as the page sent it, written as it came.
    Returns (status, payload)."""
    with LOCK:
        if (kind, rid) in _branch_hidden:
            return 409, {"error": "that branch is still being made; try again in a moment"}
        if expected_generation is not None and expected_generation != generation():
            return 409, {"reload": True, "generation": generation(), "error": "a whole copy was brought back; the page is catching up"}
        cur = read_record(kind, rid)
        cur_rev = int(cur.get("rev") or 0) if cur else 0
        if base is not None:
            if cur is None and base > 0:
                # deleted meanwhile (trash, another tab): never brought back by a late save
                return 410, {"error": "deleted"}
            if cur is not None and base != cur_rev:
                return 409, {"rev": cur_rev, "data": cur["data"], "saves": cur.get("saves") or []}
        if cur is not None and kind in KEPT_HISTORY and not checkpoint:
            keep_earlier(kind, rid, cur)
        rev = (cur_rev if cur is not None else gone_rev(kind, rid)) + 1
        saves = list((cur.get("saves") if cur else None) or [])
        if save:
            saves.append([str(save)[:40], str(by)[:64], rev])
        rec = {"rev": rev, "at": now_ms(), "data": data, "saves": saves[-SAVES_KEPT:]}
        write_record(kind, rid, rec, data_bytes)
        if cur is None:
            set_gone(kind, rid, 0)
    announce({"kind": kind, "id": rid, "rev": rev, "by": by})
    return 200, {"rev": rev}


def all_records(kinds=KINDS):
    out = []
    for kind in kinds:
        d = STORE / kind
        if not d.is_dir():
            continue
        for p in sorted(d.glob("*.json")):
            rid = p.name[:-5]
            if not ID_RE.match(rid):
                continue
            rec = read_record(kind, rid)
            if rec:
                out.append({"kind": kind, "id": rid, "rev": rec.get("rev", 0), "data": rec["data"]})
    return out


_meta_cache = {}


def novel_list():
    """Every book on the shelf, with only what the shelf shows."""
    out = []
    d = STORE / "novel"
    if not d.is_dir():
        return out
    for p in d.glob("*.json"):
        rid = p.name[:-5]
        if not ID_RE.match(rid) or ("novel", rid) in _branch_hidden:
            continue
        try:
            mt = p.stat().st_mtime_ns
        except OSError:
            continue
        hit = _meta_cache.get(rid)
        if hit and hit[0] == mt:
            out.append(hit[1])
            continue
        rec = read_record("novel", rid)
        if not rec:
            continue
        meta = rec["data"].get("meta") if isinstance(rec["data"].get("meta"), dict) else {}
        row = {"id": rid, "rev": rec.get("rev", 0), "meta": meta}
        branch = rec["data"].get("branch")
        if isinstance(branch, dict):
            row["branch"] = {k: branch[k] for k in ("rootId", "fromId", "name", "at") if k in branch}
        _meta_cache[rid] = (mt, row)
        out.append(row)
    return out


# --------------------------------------------------------------------- trash

def trash_records(entries, title, kind, rid, by=""):
    """Move records into one bundle in the trash (kept thirty days)."""
    if not entries:
        return None
    name = "%s-%s-%s.json.gz" % (stamp(), kind, rid)
    TRASH.mkdir(parents=True, exist_ok=True)
    atomic_write_bytes(TRASH / name, gz_bytes({"kind": kind, "id": rid, "title": title, "at": now_ms(), "records": entries}))
    for e in entries:
        record_path(e["kind"], e["id"]).unlink(missing_ok=True)
        _revs.pop((e["kind"], e["id"]), None)
        set_gone(e["kind"], e["id"], int(e.get("rev") or 0))
        if e["kind"] == "novel":
            _meta_cache.pop(e["id"], None)
    for e in entries:
        announce({"kind": e["kind"], "id": e["id"], "deleted": True, "by": by})
    return name


def _book_title(nid):
    rec = read_record("novel", nid) if isinstance(nid, str) and ID_RE.match(nid) else None
    meta = (rec["data"].get("meta") if rec else None) or {}
    return str(meta.get("title") or "").strip()


def _opening(chapter, n=48):
    """A chapter with no name is known by its first words."""
    for p in chapter.get("passages") or []:
        if not isinstance(p, dict) or p.get("by") == "break":
            continue
        vs = p.get("versions") or []
        i = p.get("pick") if isinstance(p.get("pick"), int) and 0 <= p.get("pick") < len(vs) else len(vs) - 1
        text = " ".join(str((vs[i] or {}).get("text") or "").split()) if vs else ""
        if text:
            return text if len(text) <= n else text[:n].rsplit(" ", 1)[0] + "…"
    return ""


def trash_title(kind, data):
    """What Recently deleted calls a thing, in words he knows it by."""
    d = data if isinstance(data, dict) else {}
    if kind == "novel":
        return str((d.get("meta") or {}).get("title") or "")
    book = _book_title(d.get("novelId") or (d.get("id") if kind in ("talk", "draft") else ""))
    of = (" from “%s”" % book) if book else ""
    if kind == "chapter":
        name = str(d.get("name") or "").strip() or _opening(d)
        return ("“%s”%s" % (name, of)) if name else of.strip()
    if kind == "play":
        who = str(d.get("who") or "").strip()
        return ("%s plays%s" % (who, of)) if who else of.strip()
    return of.strip()


def delete_record(kind, rid, by=""):
    with LOCK:
        cur = read_record(kind, rid)
        if cur is None:
            return False
        entries = [{"kind": kind, "id": rid, "rev": cur.get("rev", 0), "data": cur["data"]}]
        title = trash_title(kind, cur["data"])
        if kind == "novel":
            # a book goes with everything that belongs to it, so it comes back whole
            for k in ("chapter", "talk", "play", "draft"):
                d = STORE / k
                if not d.is_dir():
                    continue
                for p in d.glob("*.json"):
                    oid = p.name[:-5]
                    other = read_record(k, oid)
                    if other and (other["data"].get("novelId") == rid or (k in ("talk", "draft") and oid == rid)):
                        entries.append({"kind": k, "id": oid, "rev": other.get("rev", 0), "data": other["data"]})
        trash_records(entries, title, kind, rid, by)
        return True


def trash_list():
    out = []
    if not TRASH.is_dir():
        return out
    for f in sorted(TRASH.glob("*.json.gz"), reverse=True):
        if not TRASH_RE.match(f.name):
            continue
        try:
            b = read_gz(f)
            out.append({"name": f.name, "kind": b.get("kind"), "id": b.get("id"), "title": b.get("title") or "",
                        "at": b.get("at") or 0, "count": len(b.get("records") or [])})
        except Exception:
            continue
    return out


def _joined_turns(old, now):
    """A conversation brought back beside the one there now: both kept, the
    earlier one first, nothing twice."""
    data = dict(now)
    seen = set()
    turns = []
    for t in (old.get("turns") or []) + (now.get("turns") or []):
        tid = t.get("id") if isinstance(t, dict) else None
        if tid and tid in seen:
            continue
        if tid:
            seen.add(tid)
        turns.append(t)
    data["turns"] = turns
    return data


def _put_back_in_book(kind, data, by):
    """A chapter or a scene brought back takes its place in its book again."""
    nid = data.get("novelId") if isinstance(data, dict) else None
    if kind not in ("chapter", "play") or not isinstance(nid, str) or not ID_RE.match(nid):
        return
    cur = read_record("novel", nid)
    if not cur:
        return
    book = cur["data"]
    rid = data.get("id")
    if not isinstance(rid, str):
        return
    if kind == "chapter":
        order = list(book.get("order") or [])
        if rid in order:
            return
        order.append(rid)
        book = dict(book, order=order)
        meta = dict(book.get("meta") or {})
        meta["chapters"] = len(order)
        book["meta"] = meta
    else:
        plays = list(book.get("plays") or [])
        if rid in plays:
            return
        book = dict(book, plays=[rid] + plays)
    keep_earlier("novel", nid, cur)
    rev = int(cur.get("rev") or 0) + 1
    write_record("novel", nid, {"rev": rev, "at": now_ms(), "data": book, "saves": cur.get("saves") or []})
    _meta_cache.pop(nid, None)
    announce({"kind": "novel", "id": nid, "rev": rev, "by": by})


def trash_restore(name, by=""):
    if not TRASH_RE.match(name):
        return False
    f = TRASH / name
    if not f.exists():
        return False
    b = read_gz(f)
    with LOCK:
        records = [e for e in (b.get("records") or []) if e.get("kind") in KINDS and isinstance(e.get("id"), str)
                   and ID_RE.match(e["id"]) and isinstance(e.get("data"), dict)]
        # the book first, so what belonged to it finds it there
        records.sort(key=lambda e: 0 if e["kind"] == "novel" else 1)
        for e in records:
            kind, rid = e["kind"], e["id"]
            cur = read_record(kind, rid)
            data = e["data"]
            if cur is not None:
                # something lives under this id now (a conversation started over):
                # it is never written over — its earlier copy is kept, and a
                # conversation keeps both its turns and the ones brought back
                keep_earlier(kind, rid, cur)
                if kind in ("talk", "play"):
                    data = _joined_turns(data, cur["data"])
            rev = max(int(e.get("rev") or 0), int(cur.get("rev") or 0) if cur else 0, gone_rev(kind, rid)) + 1
            write_record(kind, rid, {"rev": rev, "at": now_ms(), "data": data, "saves": (cur.get("saves") if cur else None) or []})
            set_gone(kind, rid, 0)
            announce({"kind": kind, "id": rid, "rev": rev, "by": by})
        if not any(e["kind"] == "novel" for e in records):
            for e in records:
                _put_back_in_book(e["kind"], e["data"], by)
        f.unlink(missing_ok=True)
    return True


def prune_trash():
    if not TRASH.is_dir():
        return
    limit = time.time() - TRASH_DAYS * 86400
    for f in TRASH.glob("*.json.gz"):
        try:
            if f.stat().st_mtime < limit:
                f.unlink(missing_ok=True)
        except OSError:
            pass


def trash_ids():
    """What waits in Recently deleted, as (kind, id) — None when a bundle
    cannot be read, so nothing is ever taken for gone on a guess."""
    out = set()
    if not TRASH.is_dir():
        return out
    for f in TRASH.glob("*.json.gz"):
        if not TRASH_RE.match(f.name):
            continue
        try:
            b = read_gz(f)
        except Exception:
            return None
        for e in b.get("records") or []:
            if isinstance(e, dict) and isinstance(e.get("kind"), str) and isinstance(e.get("id"), str):
                out.add((e["kind"], e["id"]))
    return out


def _newest_mtime(d):
    newest = 0.0
    for f in d.rglob("*"):
        try:
            newest = max(newest, f.stat().st_mtime)
        except OSError:
            continue
    return newest


def sweep_gone(at=None):
    """Everything of a record goes with it (Cozy Tavern M160, M389, M525):
    its earlier copies, and for a book what its pages were sent, stay only
    while it can come back — on the shelf, or in Recently deleted. Once it is
    gone for good, and nothing of it is newer than Recently deleted keeps
    things, they go too: the phone does not fill with them, and no copy
    carries them. Returns how many folders went."""
    waiting = trash_ids()
    if waiting is None:
        return 0
    limit = (time.time() if at is None else at) - TRASH_DAYS * 86400
    swept = 0
    with LOCK:
        places = [(kind, HISTORY / kind) for kind in KINDS] + [("novel", SENT)]
        for kind, base in places:
            if not base.is_dir():
                continue
            for d in base.iterdir():
                if not d.is_dir() or not ID_RE.match(d.name) or record_path(kind, d.name).exists() or (kind, d.name) in waiting:
                    continue
                if _newest_mtime(d) < limit:
                    shutil.rmtree(d, ignore_errors=True)
                    swept += 1
    return swept


# ------------------------------------------------------- copies of everything

def library_snapshot(with_sent=False):
    snap = {"format": "cozynovel-library", "version": 2, "app": VERSION, "at": now_ms(), "records": all_records()}
    if with_sent:
        sent = {}
        # only the books in the copy: a book gone from the shelf is never carried in one (Cozy Tavern M525)
        books = {e["id"] for e in snap["records"] if e["kind"] == "novel"}
        if SENT.is_dir():
            for d in SENT.iterdir():
                if not d.is_dir() or not ID_RE.match(d.name) or d.name not in books:
                    continue
                for f in d.glob("*.json.gz"):
                    key = f.name[:-8]
                    try:
                        sent.setdefault(d.name, {})[key] = read_gz(f)
                    except Exception:
                        continue
        snap["sent"] = sent
    return snap


def daily_copy(force=False):
    """A copy of everything once a day; the newest fourteen are kept."""
    try:
        COPIES.mkdir(parents=True, exist_ok=True)
        name = "cozynovel-" + time.strftime("%Y-%m-%d") + ".json.gz"
        if not force and (COPIES / name).exists():
            return name
        with LOCK:
            snap = library_snapshot()
        if not snap["records"]:
            return ""
        atomic_write_bytes(COPIES / name, gz_bytes(snap))
        dailies = sorted([f for f in COPIES.glob("cozynovel-????-??-??.json.gz")], reverse=True)
        for old in dailies[DAILY_KEEP:]:
            old.unlink(missing_ok=True)
        befores = sorted(COPIES.glob("cozynovel-before-*.json.gz"), reverse=True)
        for old in befores[DAILY_KEEP:]:
            old.unlink(missing_ok=True)
        return name
    except Exception as e:
        print("daily copy skipped:", e, file=sys.stderr)
        return ""


# ---- what an earlier copy holds, said beside it in its list (his report,
# 2.12.3: "everything looks the same" — which copy still had his passage 2?):
# a chapter's passages, words and a print of its words (copies that read the
# same, and the one that reads as the chapter does now, are said so); a copy
# of everything, its books and words. Read once per copy.
_copy_counts = {}


def _picked(p):
    vs = p.get("versions") if isinstance(p.get("versions"), list) else []
    if not vs:
        return None
    i = p.get("pick")
    return vs[i] if isinstance(i, int) and not isinstance(i, bool) and 0 <= i < len(vs) else vs[-1]


def chapter_info(data):
    """{passages, words, print} of a chapter's words as they show."""
    passages = data.get("passages") if isinstance(data, dict) else None
    n = words = 0
    shown = []
    for p in passages if isinstance(passages, list) else []:
        if not isinstance(p, dict):
            continue
        if p.get("by") == "break":
            shown.append("—")
            continue
        v = _picked(p)
        if v is None:
            continue
        text = str((v or {}).get("text") or "")
        n += 1
        words += len(text.split())
        shown.append(text)
    return {"passages": n, "words": words, "print": hashlib.sha1(json.dumps(shown).encode("utf-8")).hexdigest()[:16]}


def _cached(f, read):
    try:
        st = f.stat()
    except OSError:
        return None
    key = str(f)
    got = _copy_counts.get(key)
    if got and got[0] == (st.st_mtime_ns, st.st_size):
        return got[1]
    try:
        info = read(read_gz(f))
    except Exception:
        info = None
    if len(_copy_counts) > 2000:
        _copy_counts.clear()
    _copy_counts[key] = ((st.st_mtime_ns, st.st_size), info)
    return info


def copy_counts(f):
    return _cached(f, lambda rec: chapter_info(rec.get("data")) if isinstance(rec, dict) and isinstance(rec.get("data"), dict) else None)


def library_counts(f):
    def read(snap):
        books = words = 0
        for e in snap.get("records") or []:
            if not isinstance(e, dict) or not isinstance(e.get("data"), dict):
                continue
            if e.get("kind") == "novel":
                books += 1
            elif e.get("kind") == "chapter":
                words += chapter_info(e["data"])["words"]
        return {"books": books, "words": words}
    return _cached(f, read)


SEEN_VERSION = HOME / ".version-seen"


def copy_before_update():
    """Everything as it is, kept whole the first time a new version of the app
    starts on it — before the new code opens a single book (his report, 2.12.3:
    "your update broke my passage 2"): whatever an update does, the library as
    it was is one Bring back away. Kept with the copies made before a copy was
    brought back (the newest fourteen of those)."""
    mark = "%s:%s" % (VERSION, COMMIT or "")
    try:
        seen = SEEN_VERSION.read_text(encoding="utf-8").strip()
    except OSError:
        seen = ""
    if seen == mark:
        return ""
    name = ""
    try:
        with LOCK:
            snap = library_snapshot()
        if snap["records"]:
            COPIES.mkdir(parents=True, exist_ok=True)
            name = "cozynovel-before-update-%s.json.gz" % time.strftime("%Y%m%d-%H%M%S")
            atomic_write_bytes(COPIES / name, gz_bytes(snap))
            befores = sorted(COPIES.glob("cozynovel-before-*.json.gz"), key=lambda f: f.stat().st_mtime, reverse=True)
            for old in befores[DAILY_KEEP:]:
                old.unlink(missing_ok=True)
        atomic_write_bytes(SEEN_VERSION, mark.encode("utf-8"))
    except Exception as e:
        print("the copy before the update was skipped:", e, file=sys.stderr)
        return ""
    return name


def copies_list():
    out = []
    if not COPIES.is_dir():
        return out
    for f in COPIES.glob("*.json.gz"):
        if not COPY_RE.match(f.name):
            continue
        try:
            st = f.stat()
        except OSError:
            continue
        row = {"name": f.name, "at": int(st.st_mtime * 1000), "size": st.st_size}
        counts = library_counts(f)
        if counts:
            row.update(counts)
        out.append(row)
    out.sort(key=lambda r: r["at"], reverse=True)
    return out


def valid_snapshot(snap):
    if not isinstance(snap, dict) or snap.get("format") != "cozynovel-library" or not isinstance(snap.get("records"), list):
        return "that file is not a Cozy Novel copy"
    names = set()
    for e in snap["records"]:
        if not isinstance(e, dict) or e.get("kind") not in KINDS or not isinstance(e.get("id"), str) \
                or not ID_RE.match(e["id"]) or not isinstance(e.get("data"), dict):
            return "that copy has a damaged record in it, so nothing was changed"
        name = (e["kind"], e["id"])
        if name in names:
            return "that copy has two records with the same name, so nothing was changed"
        names.add(name)
        rev = e.get("rev", 0)
        if not isinstance(rev, int) or isinstance(rev, bool) or rev < 0:
            return "that copy has a damaged save number in it, so nothing was changed"
    return ""


def _become(records, sent, revs, putting_back=False):
    """The library made exactly these records (and, given, these words sent):
    whatever is not among them goes (its earlier copy kept), each of them is
    written later-numbered than anything before it. Putting things back, what
    cannot be taken away is passed over: the records that were are what
    matter then."""
    wanted = {(e["kind"], e["id"]) for e in records}
    for (kind, rid) in list(revs):
        if (kind, rid) not in wanted:
            if kind in KEPT_HISTORY:
                cur = read_record(kind, rid)
                if cur:
                    keep_earlier(kind, rid, cur)
            try:
                record_path(kind, rid).unlink(missing_ok=True)
            except OSError:
                if not putting_back:
                    raise
            _revs.pop((kind, rid), None)
            set_gone(kind, rid, revs[(kind, rid)])
    for e in records:
        rev = max(revs.get((e["kind"], e["id"]), 0), int(e.get("rev") or 0), gone_rev(e["kind"], e["id"])) + 1
        revs[(e["kind"], e["id"])] = rev
        write_record(e["kind"], e["id"], {"rev": rev, "at": now_ms(), "data": e["data"], "saves": []})
        set_gone(e["kind"], e["id"], 0)
    _meta_cache.clear()
    if isinstance(sent, dict):
        if SENT.is_dir():
            shutil.rmtree(SENT, ignore_errors=True)
        for nid, keys in sent.items():
            if not ID_RE.match(str(nid)) or not isinstance(keys, dict):
                continue
            for key, body in keys.items():
                if ID_RE.match(str(key)) and isinstance(body, dict):
                    atomic_write_bytes(SENT / nid / (key + ".json.gz"), gz_bytes(body))


def replace_library(snap, by=""):
    """Bring a whole copy back: everything here now is kept as a copy first,
    then the library becomes exactly the copy. Every open tab reloads. A copy
    that cannot be brought back whole is not brought back at all: the library
    is put back as it was (Cozy Tavern M675), never left half one, half the
    other. What waits in Recently deleted keeps what its pages were sent."""
    why = valid_snapshot(snap)
    if why:
        raise ValueError(why)
    with LOCK:
        before = library_snapshot(with_sent=True)
        COPIES.mkdir(parents=True, exist_ok=True)
        safety = "cozynovel-before-%s-%09d.json.gz" % (time.strftime("%Y%m%d-%H%M%S").lower(), time.time_ns() % 1000000000)
        aside = None
        try:
            if before["records"]:
                atomic_write_bytes(COPIES / safety, gz_bytes(before))
            # what was sent, set aside whole (one rename) while the copy's own is written
            if isinstance(snap.get("sent"), dict) and SENT.is_dir():
                aside = SENT.with_name("sent.before-%s" % stamp())
                os.replace(SENT, aside)
        except OSError as e:
            raise RuntimeError("what is here could not be kept first (%s), so nothing was changed" % (e.strerror or e)) from e
        # every record's number, here now and as it goes: whatever is written is numbered after it
        revs = {(e["kind"], e["id"]): int(e.get("rev") or 0) for e in before["records"]}
        try:
            _become(snap["records"], snap.get("sent"), revs)
            # Changing the library and its number is one operation. A phone
            # unable to keep the number must put the records back too.
            set_generation(generation() + 1)
        except Exception as e:
            reason = getattr(e, "strerror", None) or str(e) or e.__class__.__name__
            try:
                for e2 in snap["records"]:
                    revs.setdefault((e2["kind"], e2["id"]), max(rev_of(e2["kind"], e2["id"]), gone_rev(e2["kind"], e2["id"])))
                _become(before["records"], None, revs, putting_back=True)
                if isinstance(snap.get("sent"), dict):
                    shutil.rmtree(SENT, ignore_errors=True)
                    if aside is not None:
                        os.replace(aside, SENT)
            except Exception as e3:
                print("putting the library back failed:", e3, file=sys.stderr)
                announce({"resync": True})
                raise RuntimeError("the copy could not be brought back (%s), and putting things back failed too — "
                                   "what was here is kept whole in Backups → Copies kept on this phone" % reason) from e
            announce({"resync": True})
            raise RuntimeError("the copy could not be brought back (%s) — everything is as it was" % reason) from e
        if aside is not None:
            # a book in Recently deleted keeps what its pages were sent, to come back with
            # (Recently deleted unreadable just now: every book the copy does not hold keeps them,
            # for the hourly sweep to judge once it can read it)
            waiting = trash_ids()
            try:
                for d in aside.iterdir():
                    if d.is_dir() and (waiting is None or ("novel", d.name) in waiting) and not (SENT / d.name).exists():
                        SENT.mkdir(parents=True, exist_ok=True)
                        os.replace(d, SENT / d.name)
            except OSError as e:
                print("what a book in Recently deleted was sent could not all be kept:", e, file=sys.stderr)
            shutil.rmtree(aside, ignore_errors=True)
        # a page's unsaved work from before the copy came back is not played over it
        gen = generation()
    announce({"reload": True, "by": by, "generation": gen})
    return safety if before["records"] else ""


# ------------------------------------------------- the library's generation
# Counted up each time a whole copy is brought back: work a page kept waiting
# from before that moment is never played over the copy.
GENERATION = HOME / "generation"


_last_generation = [0]


def generation():
    """The library's number. A file that cannot be read just now never reads
    as 0 (every open page would take every answer for an old one): the last
    number read stands."""
    try:
        n = int(GENERATION.read_text(encoding="utf-8").strip() or 0)
    except FileNotFoundError:
        return _last_generation[0]
    except (OSError, ValueError):
        return _last_generation[0]
    _last_generation[0] = n
    return n


def set_generation(n):
    atomic_write_bytes(GENERATION, str(int(n)).encode("utf-8"))


# ------------------------------------------------------ a branch, whole at once

def _book_records(nid):
    """Called under LOCK: every record owned by a book, including an unlisted
    child a previous save left behind. A revision vector sees additions too."""
    records = all_records(("novel", "chapter", "talk", "play", "draft"))
    return [e for e in records if (e["kind"] == "novel" and e["id"] == nid) or
            (e["kind"] != "novel" and (e["data"].get("novelId") == nid or
             (e["kind"] in ("talk", "draft") and e["id"] == nid)))]


def branch_snapshot(nid):
    with LOCK:
        if not isinstance(nid, str) or not ID_RE.fullmatch(nid):
            return 400, {"ok": False, "error": "that book's name is not valid"}
        if not read_record("novel", nid):
            return 410, {"ok": False, "error": "that book has been removed"}
        records = _book_records(nid)
        novel = next(e["data"] for e in records if e["kind"] == "novel")
        owned = {(e["kind"], e["id"]) for e in records}
        if any(("chapter", cid) not in owned for cid in novel.get("order", [])) or any(
                ("play", pid) not in owned for pid in novel.get("plays", [])):
            return 409, {"ok": False, "error": "part of this book has not finished saving; try again in a moment"}
        return 200, {"ok": True, "generation": generation(), "records": records}


def _branch_targets(records, nid):
    """Validate the new book's complete ownership before the first write."""
    if not isinstance(records, list) or not records:
        return "the branch arrived without its pages"
    seen = set()
    for e in records:
        if not isinstance(e, dict) or e.get("kind") not in ("novel", "chapter", "talk", "play", "draft") or \
                not isinstance(e.get("id"), str) or not ID_RE.fullmatch(e["id"]) or not isinstance(e.get("data"), dict):
            return "the branch has an incomplete record"
        key = (e["kind"], e["id"])
        if key in seen:
            return "the branch has two records with the same name"
        seen.add(key)
        if e["data"].get("id") != e["id"]:
            return "a branch record names a different page"
        if e["kind"] == "novel":
            if e["id"] != nid:
                return "the branch must contain only its own book"
        elif e["data"].get("novelId") != nid:
            return "every part of a branch must belong to its new book"
        elif e["kind"] in ("talk", "draft") and e["id"] != nid:
            return "the branch's conversation and draft must name its book"
    if ("novel", nid) not in seen:
        return "the branch arrived without its book"
    novel = next(e["data"] for e in records if e["kind"] == "novel")
    for field, kind in (("order", "chapter"), ("plays", "play")):
        ids = novel.get(field, [])
        if not isinstance(ids, list) or any(not isinstance(x, str) for x in ids) or len(ids) != len(set(ids)) or \
                set(ids) != {e["id"] for e in records if e["kind"] == kind}:
            return "the branch's %s do not match what its book holds" % ("chapters" if kind == "chapter" else "scenes")
    if not novel.get("order"):
        return "a branch needs a chapter to open"
    distinct = [e["id"] for e in records if e["kind"] in ("novel", "chapter", "play")]
    if len(distinct) != len(set(distinct)):
        return "the branch's book, chapters and scenes need their own names"
    for e in records:
        if e["kind"] == "play" and e["data"].get("chapterId") not in novel["order"]:
            return "a branch's scene must stand in one of its chapters"
    return ""


def _sent_keys(value):
    keys = set()
    todo = [value]
    while todo:
        item = todo.pop()
        if isinstance(item, dict):
            sent = item.get("sent")
            if isinstance(sent, str) and ID_RE.fullmatch(sent):
                keys.add(sent)
            more = item.get("sentMore")
            if isinstance(more, list):
                keys.update(k for k in more if isinstance(k, str) and ID_RE.fullmatch(k))
            todo.extend(item.values())
        elif isinstance(item, list):
            todo.extend(item)
    return keys


def _sync_directory(path):
    """A committed receipt must not reach disk before the records it names."""
    fd = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _branch_receipt(path, receipt):
    atomic_write_bytes(path, json.dumps(receipt, ensure_ascii=False).encode("utf-8"))
    _sync_directory(path.parent)
    _sync_directory(HOME)


def _undo_branch(receipt, path):
    """Only freshly reserved names are here; no older record is ever touched."""
    targets = receipt.get("targets")
    nid = receipt.get("novelId")
    if not isinstance(targets, list) or not isinstance(nid, str) or not ID_RE.fullmatch(nid) or any(
            not isinstance(p, list) or len(p) != 2 or p[0] not in ("novel", "chapter", "talk", "play", "draft") or
            not isinstance(p[1], str) or not ID_RE.fullmatch(p[1]) for p in targets):
        raise ValueError("an unfinished branch's recovery record could not be read")
    names = {tuple(p) for p in targets}
    _branch_hidden.update(names)
    for kind, rid in names:
        target = record_path(kind, rid)
        target.unlink(missing_ok=True)
        target.with_name(target.name + ".tmp").unlink(missing_ok=True)
        _revs.pop((kind, rid), None)
        _meta_cache.pop(rid, None)
    if (SENT / nid).exists():
        shutil.rmtree(SENT / nid)
    for kind in {p[0] for p in targets}:
        if (STORE / kind).is_dir():
            _sync_directory(STORE / kind)
    if SENT.is_dir():
        _sync_directory(SENT)
    path.unlink(missing_ok=True)
    path.with_name(path.name + ".tmp").unlink(missing_ok=True)
    _sync_directory(path.parent)
    _branch_hidden.difference_update(names)


def recover_branches():
    """Before serving, remove any creation interrupted before its commit.
    Committed receipts stay, so a retry after deletion never recreates a book."""
    with LOCK:
        if not BRANCHES.is_dir():
            return
        for path in sorted(BRANCHES.glob("*.json")):
            # one unreadable receipt never keeps the server from starting: it is
            # set aside beside the others, with what went wrong said in the log
            try:
                receipt = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(receipt, dict) and receipt.get("state") == "building":
                    _undo_branch(receipt, path)
            except (OSError, ValueError) as e:
                print(f"A branch left half made could not be cleared ({path.name}: {e}); it is kept as {path.name}.unreadable")
                try:
                    path.replace(path.with_name(path.name + ".unreadable"))
                except OSError:
                    pass


def create_branch(spec, by=""):
    if not isinstance(spec, dict):
        return 400, {"ok": False, "error": "the branch arrived incomplete"}
    nid, source = spec.get("requestId"), spec.get("sourceId")
    if not isinstance(nid, str) or not ID_RE.fullmatch(nid) or not isinstance(source, str) or not ID_RE.fullmatch(source) or nid == source:
        return 400, {"ok": False, "error": "the branch needs its own book name"}
    if spec.get("sourceSentId", source) != source:
        return 400, {"ok": False, "error": "a branch can carry only its own book's sent words"}
    gen = spec.get("generation")
    if not isinstance(gen, int) or isinstance(gen, bool) or gen < 0:
        return 400, {"ok": False, "error": "the branch did not say which copy of the library it belongs to"}
    records = spec.get("records")
    why = _branch_targets(records, nid)
    if why:
        return 400, {"ok": False, "error": why}
    revisions = spec.get("revisions")
    if not isinstance(revisions, list):
        return 400, {"ok": False, "error": "the branch did not name the saves it was copied from"}
    expected = {}
    for e in revisions:
        if not isinstance(e, dict) or e.get("kind") not in ("novel", "chapter", "talk", "play", "draft") or \
                not isinstance(e.get("id"), str) or not ID_RE.fullmatch(e["id"]) or \
                not isinstance(e.get("rev"), int) or isinstance(e["rev"], bool) or e["rev"] < 1:
            return 400, {"ok": False, "error": "a source save number is missing"}
        key = (e["kind"], e["id"])
        if key in expected:
            return 400, {"ok": False, "error": "a source save was named twice"}
        expected[key] = e["rev"]
    digest = hashlib.sha256(json.dumps(spec, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()
    path = BRANCHES / (nid + ".json")
    with LOCK:
        if gen != generation():
            return 409, {"ok": False, "reload": True, "generation": generation(), "error": "a whole copy was brought back; open the book again before branching"}
        if path.exists():
            receipt = json.loads(path.read_text(encoding="utf-8"))
            if receipt.get("state") == "building":
                _undo_branch(receipt, path)
            else:
                if receipt.get("generation") != gen or receipt.get("hash") != digest:
                    return 409, {"ok": False, "error": "that branch name has already been used"}
                if not read_record("novel", nid):
                    return 410, {"ok": False, "error": "that branch was already made and has since been removed"}
                return 200, receipt["result"]
        if not read_record("novel", source):
            return 410, {"ok": False, "error": "the book this branch came from has been removed"}
        current = {(e["kind"], e["id"]): e["rev"] for e in _book_records(source)}
        if current != expected:
            return 409, {"ok": False, "changed": True, "error": "the book changed while the branch was being made; try again from its newest copy"}
        for e in records:
            if record_path(e["kind"], e["id"]).exists() or gone_rev(e["kind"], e["id"]) or history_dir(e["kind"], e["id"]).exists():
                return 409, {"ok": False, "error": "one of this branch's names was already used; make the branch again"}
        if (SENT / nid).exists():
            return 409, {"ok": False, "error": "that branch name already has sent words; make the branch again"}
        novel = next(e["data"] for e in records if e["kind"] == "novel")
        lineage = novel.get("branch")
        if not isinstance(lineage, dict) or lineage.get("fromId") != source:
            return 400, {"ok": False, "error": "the branch does not name the book it came from"}
        result = {"ok": True, "novelId": nid, "chapterId": novel["order"][-1], "generation": gen}
        targets = [[e["kind"], e["id"]] for e in records]
        receipt = {"state": "building", "novelId": nid, "sourceId": source, "generation": gen,
                   "hash": digest, "targets": targets, "result": result}
        # A persisted reservation precedes every new file. Readers are held by
        # LOCK, and the hidden set also protects a failed rollback until retry.
        _branch_receipt(path, receipt)
        names = {tuple(p) for p in targets}
        _branch_hidden.update(names)
        try:
            for key in sorted(_sent_keys(records)):
                old = SENT / source / (key + ".json.gz")
                if old.is_file():
                    atomic_write_bytes(SENT / nid / old.name, old.read_bytes())
            # The shelf's book is the final data record written. No page sees
            # it until the commit receipt is durable and the lock is released.
            for e in sorted(records, key=lambda e: e["kind"] == "novel"):
                write_record(e["kind"], e["id"], {"rev": 1, "at": now_ms(), "data": e["data"], "saves": []})
            for kind in {e["kind"] for e in records}:
                _sync_directory(STORE / kind)
            _sync_directory(STORE)
            if (SENT / nid).is_dir():
                _sync_directory(SENT / nid)
                _sync_directory(SENT)
            receipt["state"] = "committed"
            _branch_receipt(path, receipt)
        except Exception:
            _undo_branch(receipt, path)
            raise
        _branch_hidden.difference_update(names)
        _meta_cache.pop(nid, None)
        # All announcements happen after commit, still under the lock: a
        # following deletion cannot be announced before this creation.
        for e in records:
            announce({"kind": e["kind"], "id": e["id"], "rev": 1, "by": by})
        return 200, result


# ---------------------------------------------------------------- usage and cost
# Every call to a model — the writer, the helper, the checker, the partner,
# the narrator — counted as it lands, by address and model, day by day (Cozy
# Tavern's meter). Settings → Usage and cost multiplies by the prices he set.

USAGE_DAYS = 400


def usage_read():
    try:
        d = json.loads(USAGE.read_text("utf-8"))
        return d if isinstance(d, dict) and isinstance(d.get("days"), dict) else {"days": {}}
    except FileNotFoundError:
        return {"days": {}}
    except Exception:
        return {"days": {}}


def _count(v):
    try:
        n = int(v)
        return n if 0 <= n < 10**12 else 0
    except (TypeError, ValueError):
        return 0


# ---------------------------------------------------------------- leases
# THE HELPER AND THE CHECKER, ONE BROWSER AT A TIME (Cozy Tavern M293, "two
# hands on one tale", made a lease the phone keeps). Windows of one browser
# already take turns among themselves; two browsers on one book did not, so
# both read the same new words into the notes and both checked the same
# passage — every call made twice, and each one's save laid over the other's.
# A browser holds a book's lease while it works, renewing it; another asking
# for it is told how long it is held, and waits. In memory only: a server
# that starts again lets every lease go, and the next asker takes it.
LEASES = {}
LEASE_LOCK = threading.Lock()
LEASE_KEY = re.compile(r"^(?:helper|checker):[A-Za-z0-9_-]{1,96}$")


def take_lease(key, holder, ttl_ms, release=False):
    now = time.time()
    with LEASE_LOCK:
        cur = LEASES.get(key)
        if cur and cur[1] <= now:
            LEASES.pop(key, None)
            cur = None
        if release:
            if cur and cur[0] == holder:
                LEASES.pop(key, None)
            return {"ok": True}
        if cur and cur[0] != holder:
            return {"ok": False, "left": int((cur[1] - now) * 1000)}
        LEASES[key] = (holder, now + max(5.0, min(300.0, ttl_ms / 1000.0)))
        return {"ok": True}


def usage_add(spec):
    if not isinstance(spec, dict):
        return False
    url = str(spec.get("url") or "")[:300]
    model = str(spec.get("model") or "")[:200]
    if not url or not model:
        return False
    day = str(spec.get("day") or time.strftime("%Y-%m-%d"))
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", day):
        day = time.strftime("%Y-%m-%d")
    key = url + "|" + model
    with LOCK:
        d = usage_read()
        row = d["days"].setdefault(day, {}).setdefault(key, {"calls": 0, "in": 0, "out": 0, "cached": 0, "estimated": 0})
        row["calls"] = _count(row.get("calls")) + 1
        row["in"] = _count(row.get("in")) + _count(spec.get("in"))
        row["out"] = _count(row.get("out")) + _count(spec.get("out"))
        row["cached"] = _count(row.get("cached")) + _count(spec.get("cached"))
        # Claude's writes into its cache, priced higher than plain input
        write = _count(spec.get("write"))
        if write or row.get("cacheWrite"):
            row["cacheWrite"] = _count(row.get("cacheWrite")) + write
        if spec.get("anthropic") is True:
            row["anthropic"] = True
        # the prices the connection had at the call: a connection let go since is still priced
        prices = spec.get("prices")
        if isinstance(prices, dict):
            kept = {}
            for k in ("in", "out", "cached"):
                v = prices.get(k)
                if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v < 1e6:
                    kept[k] = v
            if kept:
                row["prices"] = kept
        if spec.get("estimated"):
            row["estimated"] = _count(row.get("estimated")) + 1
        for old in sorted(d["days"].keys())[:-USAGE_DAYS]:
            del d["days"][old]
        atomic_write_bytes(USAGE, json.dumps(d).encode("utf-8"))
    return True


# ---------------------------------------------------------------- sent words

def sent_put(nid, key, body):
    d = SENT / nid
    with LOCK:
        atomic_write_bytes(d / (key + ".json.gz"), gz_bytes(body))
        files = sorted(d.glob("*.json.gz"), key=lambda f: f.stat().st_mtime, reverse=True)
        for old in files[SENT_KEEP:]:
            old.unlink(missing_ok=True)


def sent_get(nid, key):
    with LOCK:
        if ("novel", nid) in _branch_hidden:
            return None
        f = SENT / nid / (key + ".json.gz")
        try:
            return read_gz(f)
        except FileNotFoundError:
            return None


# ------------------------------------------------------------------ events

_listeners = []
_listeners_lock = threading.Lock()


def announce(event):
    line = json.dumps(event, ensure_ascii=False)
    with _listeners_lock:
        for q in list(_listeners):
            try:
                q.put_nowait(line)
            except queue.Full:
                # a page that stopped reading (Android froze its tab) fell behind:
                # it is told to read everything again the moment it reads on
                q.fell_behind = True


# ------------------------------------------------- the old Cozy Novel's books

def legacy_stamp():
    """A fingerprint of the first Cozy Novel's files (sizes and times), so a
    page can tell without reading them whether they were brought over already."""
    parts = []
    for name in ("library.sqlite3", "library.sqlite3-wal", "connections.json"):
        f = HOME / name
        try:
            st = f.stat()
            parts.append("%s:%d:%d" % (name, st.st_size, int(st.st_mtime)))
        except OSError:
            continue
    return "|".join(parts)


def legacy_read():
    """What the first Cozy Novel kept on this phone (its SQLite library and its
    saved connections), read from a copy — the old files are never changed."""
    out = {"records": [], "blobs": [], "profiles": {}, "secrets": {}, "stamp": legacy_stamp()}
    lib = HOME / "library.sqlite3"
    if lib.exists():
        tmp = Path(tempfile.mkdtemp(prefix="cozynovel-legacy-"))
        try:
            for suffix in ("", "-wal", "-shm"):
                src = HOME / ("library.sqlite3" + suffix)
                if src.exists():
                    shutil.copyfile(src, tmp / ("library.sqlite3" + suffix))
            db = sqlite3.connect(str(tmp / "library.sqlite3"))
            try:
                for (body,) in db.execute("SELECT body FROM records"):
                    try:
                        out["records"].append(json.loads(body))
                    except ValueError:
                        continue
                for (bid, text) in db.execute("SELECT id, text FROM blobs"):
                    out["blobs"].append({"id": bid, "text": text})
            finally:
                db.close()
        except Exception as e:
            out["error"] = "the old library could not be read: %s" % e
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    conns = HOME / "connections.json"
    if conns.exists():
        try:
            raw = json.loads(conns.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and raw.get("version") == 2:
                out["profiles"] = raw.get("profiles") or {}
                out["secrets"] = raw.get("secrets") or {}
            elif isinstance(raw, dict):
                out["profiles"] = {k: v for k, v in raw.items() if isinstance(v, dict)}
        except Exception:
            pass
    out["found"] = bool(out["records"] or out["profiles"])
    return out


# ---------------------------------------------------------- Hermes Agent's key
# Ported from CozyMaker and Cozy Chat: his Hermes Agent keeps its gateway key in
# its own files; when a call to a Hermes address on this phone is refused, the
# page asks here for the key Hermes accepts now. Only ever for this phone.
ENV_LINE = re.compile(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$')


def _hermes_homes():
    import glob
    out = [h for h in (os.environ.get("COZY_HERMES_HOME"), os.environ.get("HERMES_HOME"), "~/.hermes") if h]
    out = [os.path.abspath(os.path.expanduser(h)) for h in out]
    rootfs = os.path.join(os.environ.get("PREFIX") or "/data/data/com.termux/files/usr", "var", "lib", "proot-distro", "installed-rootfs")
    out += sorted(glob.glob(os.path.join(rootfs, "*", "root", ".hermes")))
    out += sorted(glob.glob(os.path.join(rootfs, "*", "home", "*", ".hermes")))
    seen = []
    for h in out:
        if h not in seen and os.path.isdir(h):
            seen.append(h)
    return seen


def _hermes_keys():
    import glob
    keys = []
    for h in _hermes_homes():
        for e in [os.path.join(h, ".env")] + sorted(glob.glob(os.path.join(h, "profiles", "*", ".env"))):
            try:
                with open(e, encoding="utf-8", errors="replace") as f:
                    for line in f:
                        m = ENV_LINE.match(line)
                        if m and m.group(1) == "API_SERVER_KEY":
                            v = m.group(2)
                            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                                v = v[1:-1]
                            if v:
                                keys.append(v)
            except OSError:
                pass
        try:
            with open(os.path.join(h, "config.yaml"), encoding="utf-8", errors="replace") as f:
                keys += re.findall(r'(?m)^\s*key:\s*["\']?([^\s"\'#]{16,})', f.read())
        except OSError:
            pass
    return list(dict.fromkeys(keys))


def hermes_key_for(url):
    u = urllib.parse.urlsplit(str(url or ""))
    if u.hostname not in ("127.0.0.1", "localhost", "::1"):
        return None
    base = str(url).rstrip("/")
    for suffix in ("/chat/completions", "/messages"):
        if base.endswith(suffix):
            base = base[: -len(suffix)]
    if not re.search(r"/v\d+$", base):
        base += "/v1"
    for k in _hermes_keys():
        req = urllib.request.Request(base.rstrip("/") + "/models", headers={"Authorization": "Bearer " + k})
        try:
            with urllib.request.urlopen(req, timeout=4) as r:
                if r.status == 200:
                    return k
        except Exception:
            continue
    return None


# ------------------------------------------------------------------ handler

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}
STATIC_FILES = {"index.html", "manifest.webmanifest", "sw.js"}
STATIC_DIRS = ("js/", "css/", "assets/")


def here_hosts():
    return {"127.0.0.1:%d" % PORT, "localhost:%d" % PORT, "[::1]:%d" % PORT}


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "CozyNovel/" + VERSION

    def log_message(self, fmt, *args):
        pass

    # Only this phone's own page. Any web page open in the browser can send a
    # request to 127.0.0.1; without these checks one could read the books and
    # keys (a page that renames itself to this address), or write over them.
    def from_here(self, write):
        host = (self.headers.get("Host") or "").strip().lower()
        why = ""
        if host and host not in here_hosts():
            why = "that request was not made to Cozy Novel's own address, so it was turned away"
        elif write:
            origin = self.headers.get("Origin")
            if origin is not None and origin.strip().lower() not in {"http://" + h for h in here_hosts()}:
                why = "that request did not come from Cozy Novel's own page, so it was turned away"
        if not why:
            return True
        self.close_connection = True
        self.send_json({"error": why}, 403)
        return False

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def take_body(self):
        """The request's whole body, read before anything is answered: a body
        left unread would be taken for the start of the next request on the
        same connection. A body too big to read closes the connection."""
        self._raw = None
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self.close_connection = True
            return
        if n <= 0:
            self._raw = b""
            return
        if n > MAX_BODY:
            self.close_connection = True
            return
        raw = self.rfile.read(n)
        if len(raw) != n:
            self.close_connection = True
            return
        self._raw = raw

    def read_body(self):
        """The whole body as JSON, or None. A body cut short (the phone put the
        page away mid-save) is never read as an empty record."""
        raw = getattr(self, "_raw", None)
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return None

    def data_bytes(self):
        """A save's data exactly as the page sent it, when the body is the page's
        own shape, {"data":…} and nothing else: those bytes are what the record
        keeps, never turned back into JSON here."""
        raw = getattr(self, "_raw", None)
        if not raw or not raw.startswith(b'{"data":') or not raw.rstrip().endswith(b"}"):
            return None
        inner = raw[len(b'{"data":'):raw.rstrip().rfind(b"}")]
        return inner if inner.lstrip().startswith(b"{") else None

    def client(self):
        return str(self.headers.get("X-Client") or "")[:64]

    def path_parts(self):
        path = urllib.parse.unquote(self.path.split("?", 1)[0])
        return path, [p for p in path.split("/") if p]

    def ok_id(self, kind, rid):
        return kind in KINDS and isinstance(rid, str) and bool(ID_RE.match(rid))

    # ---------------- GET

    def do_GET(self):
        path, parts = self.path_parts()
        if path.startswith("/api/"):
            if not self.from_here(False):
                return
            return self.api_get(path, parts)
        return self.serve_static(path)

    def api_get(self, path, parts):
        if path == "/api/version":
            return self.send_json({"app": "cozy-novel", "version": VERSION, "commit": COMMIT,
                                   "home": str(HOME), "port": PORT, "generation": generation()})
        if parts[:2] == ["api", "store"] and len(parts) == 4:
            if not self.ok_id(parts[2], parts[3]):
                return self.send_json({"error": "bad id"}, 400)
            with LOCK:
                rec = read_record(parts[2], parts[3])
                if rec is None:
                    # not there (yet): said plainly, not as a failure — with the
                    # number it had, when it was deleted
                    payload = {"rev": gone_rev(parts[2], parts[3]), "data": None, "generation": generation()}
                else:
                    payload = {"rev": rec.get("rev", 0), "data": rec["data"], "saves": rec.get("saves") or [], "generation": generation()}
            return self.send_json(payload)
        if path == "/api/novels":
            with LOCK:
                rows = novel_list()
            return self.send_json({"novels": rows})
        if parts[:2] == ["api", "branches"] and len(parts) == 3:
            code, payload = branch_snapshot(parts[2])
            return self.send_json(payload, code)
        if path == "/api/events":
            return self.events()
        if parts[:2] == ["api", "history"] and len(parts) == 4:
            if not self.ok_id(parts[2], parts[3]):
                return self.send_json({"error": "bad id"}, 400)
            d = history_dir(parts[2], parts[3])
            rows = []
            if d.is_dir():
                for f in sorted(d.glob("*.json.gz"), reverse=True):
                    s = f.name[:-8]
                    if not STAMP_RE.match(s):
                        continue
                    try:
                        at = int(time.mktime(time.strptime(s[:15], "%Y%m%d-%H%M%S")) * 1000) + int(s[16:])
                    except ValueError:
                        continue
                    row = {"stamp": s, "at": at, "size": f.stat().st_size}
                    if parts[2] == "chapter":
                        counts = copy_counts(f)
                        if counts:
                            row.update(counts)
                    rows.append(row)
            now = None
            if parts[2] == "chapter":
                cur = read_record(parts[2], parts[3])
                now = chapter_info(cur["data"]) if cur else None
            return self.send_json({"copies": rows, "now": now})
        if parts[:2] == ["api", "history"] and len(parts) == 5:
            if not self.ok_id(parts[2], parts[3]) or not STAMP_RE.match(parts[4]):
                return self.send_json({"error": "bad id"}, 400)
            f = history_dir(parts[2], parts[3]) / (parts[4] + ".json.gz")
            try:
                return self.send_json(read_gz(f))
            except FileNotFoundError:
                return self.send_json({"error": "not kept"}, 404)
            except Exception:
                return self.send_json({"error": "that copy could not be read"}, 500)
        if parts[:2] == ["api", "sent"] and len(parts) == 4:
            if not ID_RE.match(parts[2]) or not ID_RE.match(parts[3]):
                return self.send_json({"error": "bad id"}, 400)
            got = sent_get(parts[2], parts[3])
            if got is None:
                return self.send_json({"error": "not kept"}, 404)
            return self.send_json(got)
        if path == "/api/backup":
            return self.send_backup()
        if path == "/api/copies":
            return self.send_json({"copies": copies_list()})
        if path == "/api/trash":
            return self.send_json({"trash": trash_list()})
        if path == "/api/usage":
            return self.send_json(usage_read())
        if path == "/api/legacy":
            if "peek=1" in (self.path.split("?", 1)[1] if "?" in self.path else ""):
                stamp = legacy_stamp()
                return self.send_json({"found": bool(stamp), "stamp": stamp})
            return self.send_json(legacy_read())
        return self.send_json({"error": "unknown"}, 404)

    def events(self):
        """One long answer per open tab: a line every time something changes."""
        q = queue.Queue(maxsize=1000)
        with _listeners_lock:
            _listeners.append(q)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            hello = json.dumps({"hello": {"version": VERSION, "commit": COMMIT, "generation": generation()}})
            self.wfile.write(("data: %s\n\n" % hello).encode("utf-8"))
            self.wfile.flush()
            while True:
                try:
                    line = q.get(timeout=20)
                    self.wfile.write(("data: %s\n\n" % line).encode("utf-8"))
                except queue.Empty:
                    self.wfile.write(b": still here\n\n")
                if getattr(q, "fell_behind", False) and q.empty():
                    q.fell_behind = False
                    self.wfile.write(b'data: {"resync": true}\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with _listeners_lock:
                if q in _listeners:
                    _listeners.remove(q)

    def send_backup(self):
        with LOCK:
            snap = library_snapshot(with_sent=True)
        body = json.dumps(snap, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Disposition", 'attachment; filename="cozynovel-%s.json"' % time.strftime("%Y-%m-%d"))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def serve_static(self, path):
        rel = path.lstrip("/") or "index.html"
        if rel == "favicon.ico":
            rel = "assets/icon.svg"
        if not (rel in STATIC_FILES or rel.startswith(STATIC_DIRS)) or ".." in rel.split("/"):
            return self.send_json({"error": "not found"}, 404)
        target = (ROOT / rel).resolve()
        try:
            target.relative_to(ROOT)
        except ValueError:
            return self.send_json({"error": "not found"}, 404)
        if not target.is_file():
            return self.send_json({"error": "not found"}, 404)
        data = target.read_bytes()
        if rel == "index.html":
            # the page says which code it is, so it knows when the server runs newer code
            data = data.replace(b'<meta name="cozynovel-commit" content="">',
                                ('<meta name="cozynovel-commit" content="%s">' % re.sub(r"[^0-9a-f]", "", COMMIT)).encode("ascii"), 1)
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        # never a stale copy: a fix that cannot be seen is a fix that was never made
        self.send_header("Cache-Control", "no-store, must-revalidate")
        if rel == "sw.js":
            self.send_header("Service-Worker-Allowed", "/")
        self.end_headers()
        self.wfile.write(data)

    def do_HEAD(self):
        self.send_response(405)
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ---------------- PUT / DELETE / POST

    def do_PUT(self):
        self.take_body()
        path, parts = self.path_parts()
        if not self.from_here(True):
            return
        if parts[:2] == ["api", "store"] and len(parts) == 4:
            kind, rid = parts[2], parts[3]
            if not self.ok_id(kind, rid):
                return self.send_json({"error": "bad id"}, 400)
            body = self.read_body()
            if not isinstance(body, dict) or not isinstance(body.get("data"), dict):
                return self.send_json({"error": "that save arrived incomplete, so nothing was written"}, 400)
            raw = (self.headers.get("X-Base") or "").strip()
            raw_generation = (self.headers.get("X-Generation") or "").strip()
            try:
                base = int(raw) if raw else None
                expected_generation = int(raw_generation) if raw_generation else None
            except ValueError:
                return self.send_json({"error": "bad base"}, 400)
            checkpoint = (self.headers.get("X-Checkpoint") or "") == "1"
            save = re.sub(r"[^A-Za-z0-9_-]", "", str(self.headers.get("X-Save") or ""))[:40]
            # the data as sent, only when the body holds nothing but it (the parse above read it whole, so it is sound JSON)
            raw_data = self.data_bytes() if len(body) == 1 else None
            try:
                code, payload = put_record(kind, rid, body["data"], base, self.client(), checkpoint, save, expected_generation, raw_data)
            except OSError as e:
                return self.send_json({"error": "the phone could not write it: %s" % e.strerror}, 507 if e.errno == errno.ENOSPC else 500)
            return self.send_json(payload, code)
        if parts[:2] == ["api", "sent"] and len(parts) == 4:
            if not ID_RE.match(parts[2]) or not ID_RE.match(parts[3]):
                return self.send_json({"error": "bad id"}, 400)
            body = self.read_body()
            if not isinstance(body, dict):
                return self.send_json({"error": "that arrived incomplete"}, 400)
            try:
                sent_put(parts[2], parts[3], body)
            except OSError as e:
                return self.send_json({"error": "the phone could not write it: %s" % e.strerror}, 500)
            return self.send_json({"ok": True})
        return self.send_json({"error": "unknown"}, 404)

    def do_DELETE(self):
        self.take_body()
        path, parts = self.path_parts()
        if not self.from_here(True):
            return
        if parts[:2] == ["api", "store"] and len(parts) == 4:
            kind, rid = parts[2], parts[3]
            if not self.ok_id(kind, rid) or kind == "house":
                return self.send_json({"error": "bad id"}, 400)
            raw_generation = (self.headers.get("X-Generation") or "").strip()
            try:
                expected_generation = int(raw_generation) if raw_generation else None
            except ValueError:
                return self.send_json({"error": "bad generation"}, 400)
            with LOCK:
                if expected_generation is not None and expected_generation != generation():
                    return self.send_json({"reload": True, "generation": generation(), "error": "a whole copy was brought back; the page is catching up"}, 409)
                had = delete_record(kind, rid, self.client())
            return self.send_json({"ok": True, "had": had})
        return self.send_json({"error": "unknown"}, 404)

    def do_POST(self):
        self.take_body()
        path, parts = self.path_parts()
        if not self.from_here(True):
            return
        if path == "/api/call":
            return self.proxy_call()
        if path == "/api/branches":
            try:
                code, payload = create_branch(self.read_body(), self.client())
            except Exception as e:
                code = 507 if isinstance(e, OSError) and e.errno == errno.ENOSPC else 500
                payload = {"ok": False, "error": "the branch could not be kept: %s" % (getattr(e, "strerror", None) or str(e))}
            return self.send_json(payload, code)
        if path == "/api/revs":
            # which of these has changed: one answer for everything a page holds
            want = self.read_body()
            out = {}
            with LOCK:
                if isinstance(want, list):
                    for pair in want[:5000]:
                        if isinstance(pair, list) and len(pair) == 2 and self.ok_id(pair[0], pair[1]):
                            out[pair[0] + "/" + pair[1]] = rev_of(pair[0], pair[1]) or -gone_rev(pair[0], pair[1])
            return self.send_json({"revs": out})
        if path == "/api/lease":
            spec = self.read_body()
            holder = self.client()
            if not isinstance(spec, dict) or not isinstance(spec.get("key"), str) or not LEASE_KEY.match(spec["key"]) or not holder:
                return self.send_json({"error": "bad lease"}, 400)
            ttl = spec.get("ttl")
            ttl = ttl if isinstance(ttl, (int, float)) and not isinstance(ttl, bool) else 90000
            return self.send_json(take_lease(spec["key"], holder, ttl, release=spec.get("release") is True))
        if path == "/api/usage":
            ok = usage_add(self.read_body())
            return self.send_json({"ok": ok}, 200 if ok else 400)
        if path == "/api/usage/clear":
            with LOCK:
                atomic_write_bytes(USAGE, json.dumps({"days": {}}).encode("utf-8"))
            return self.send_json({"ok": True})
        if path == "/api/hermes/key":
            spec = self.read_body() or {}
            return self.send_json({"key": hermes_key_for(spec.get("url") if isinstance(spec, dict) else None)})
        if path == "/api/restore":
            snap = self.read_body()
            try:
                safety = replace_library(snap, self.client())
            except ValueError as e:
                return self.send_json({"error": str(e)}, 400)
            except Exception as e:
                return self.send_json({"error": str(e)}, 500)
            return self.send_json({"ok": True, "safety": safety})
        if parts[:2] == ["api", "copies"] and len(parts) == 4 and parts[3] == "restore":
            if not COPY_RE.match(parts[2]):
                return self.send_json({"error": "bad name"}, 400)
            try:
                snap = read_gz(COPIES / parts[2])
            except FileNotFoundError:
                return self.send_json({"error": "that copy is not kept any more"}, 404)
            except Exception:
                return self.send_json({"error": "that copy could not be read"}, 500)
            try:
                safety = replace_library(snap, self.client())
            except ValueError as e:
                return self.send_json({"error": str(e)}, 400)
            except Exception as e:
                return self.send_json({"error": str(e)}, 500)
            return self.send_json({"ok": True, "safety": safety})
        if path == "/api/copies/now":
            name = daily_copy(force=True)
            return self.send_json({"name": name} if name else {"error": "there is nothing to copy yet"}, 200 if name else 409)
        if parts[:2] == ["api", "trash"] and len(parts) == 4 and parts[3] == "restore":
            # told to every page, the asking one too: what comes back is not the copy it holds
            ok = trash_restore(parts[2], "")
            return self.send_json({"ok": ok}, 200 if ok else 404)
        if path == "/api/quit":
            # How the launcher replaces an old server: by asking whatever is on
            # THIS port to leave — never by process name, because Cozy Tavern,
            # Cozy Chat and CozyMaker all run a file called serve.py too.
            self.send_json({"ok": True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        return self.send_json({"error": "unknown"}, 404)

    # ---------------- the one way out to a model

    def proxy_call(self):
        # counted while it runs: an update never cuts a page being written
        with CALLS_LOCK:
            CALLS["n"] += 1
        try:
            return self.relay_call()
        finally:
            with CALLS_LOCK:
                CALLS["n"] -= 1

    def relay_call(self):
        spec = self.read_body()
        if not isinstance(spec, dict):
            return self.send_json({"error": "transport", "detail": "the request arrived incomplete"}, 200)
        url = str(spec.get("url") or "")
        if not (url.startswith("https://") or url.startswith("http://")):
            return self.send_json({"error": "transport", "detail": "that address does not look right: " + url[:80]}, 200)
        headers = spec.get("headers") if isinstance(spec.get("headers"), dict) else {}
        stream = bool(spec.get("stream"))
        if str(spec.get("method") or "POST").upper() == "GET":
            req = urllib.request.Request(url, method="GET")
        else:
            payload = json.dumps(spec.get("body") or {}, ensure_ascii=False).encode("utf-8")
            req = urllib.request.Request(url, data=payload, method="POST")
            req.add_header("Content-Type", "application/json")
        for k, v in headers.items():
            if isinstance(k, str) and isinstance(v, str):
                req.add_header(k, v)
        timeout = spec.get("timeout") if isinstance(spec.get("timeout"), (int, float)) else 600
        try:
            resp = urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", "replace")[:4000]
            except Exception:
                pass
            return self.send_json({"error": "provider", "status": e.code, "detail": detail,
                                   "retryAfter": e.headers.get("Retry-After") if e.headers else None}, 200)
        except Exception as e:
            return self.send_json({"error": "transport", "detail": str(e)[:400]}, 200)

        if not stream:
            try:
                data = resp.read()
            except Exception as e:
                return self.send_json({"error": "transport", "detail": "the answer broke off: " + str(e)[:300]}, 200)
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        # His Stop closes the page's side of this line. While the model is still
        # thinking in silence nothing is written to the page, so that would go
        # unnoticed until the next word: a watcher sees the page go and hangs up
        # on the provider at once, so it stops working (and charging) for nothing.
        done = threading.Event()

        def watch_page():
            conn = self.connection
            while not done.is_set():
                try:
                    ready, _, _ = select.select([conn], [], [], 0.5)
                    if not ready:
                        continue
                    if conn.recv(1, socket.MSG_PEEK):
                        continue   # the page said something more: not a hang-up
                except (OSError, ValueError):
                    pass
                if done.is_set():
                    return
                try:
                    sock = resp.fp.raw._sock
                    sock.shutdown(socket.SHUT_RDWR)
                except Exception:
                    try:
                        resp.close()
                    except Exception:
                        pass
                return

        threading.Thread(target=watch_page, daemon=True).start()

        def put(chunk):
            self.wfile.write(b"%X\r\n" % len(chunk))
            self.wfile.write(chunk)
            self.wfile.write(b"\r\n")
            self.wfile.flush()

        try:
            while True:
                try:
                    chunk = resp.read1(4096)
                except Exception as e:
                    # the provider's line dropping is said on the stream, so the page
                    # never mistakes a cut answer for a finished one
                    said = {"error": {"message": "the provider's line dropped partway through (" + str(e)[:200] + ")", "code": 503}}
                    put(("\n\ndata: " + json.dumps(said) + "\n\n").encode("utf-8"))
                    break
                if not chunk:
                    break
                put(chunk)
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass  # the page went away (Stop, or it was closed)
        finally:
            done.set()
            try:
                resp.close()
            except Exception:
                pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 128   # many tabs saving at once are queued, never refused

    def handle_error(self, request, client_address):
        # A page that went away before its answer — a tab he or Android closed
        # mid-save, a kept-alive line the browser let go — is no fault here: a
        # save it carried landed whole or not at all, and the page (or its
        # journal) asks again. Nothing about it goes into the log the launcher
        # shows him when the server will not start; anything else still does.
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
            return
        super().handle_error(request, client_address)


def _ref_files():
    """The files git rewrites when the code moves to another commit."""
    git = ROOT / ".git"
    if not git.is_dir():
        return []
    files = [git / "HEAD", git / "packed-refs"]
    try:
        head = (git / "HEAD").read_text().strip()
        if head.startswith("ref: "):
            files.append(git / head[5:])
    except OSError:
        pass
    return files


def _stamps(paths):
    out = []
    for p in paths:
        try:
            out.append(p.stat().st_mtime_ns)
        except OSError:
            out.append(None)
    return tuple(out)


def watch_self():
    """An update relights the server with the new code: this file changing,
    or the code moving to another commit (a pull that changed only the page's
    own files) — so every open page hears of it and refreshes by itself."""
    try:
        seen = SELF.stat().st_mtime
    except OSError:
        return
    refs = _ref_files()
    seen_refs = _stamps(refs)
    while True:
        time.sleep(2)
        try:
            now = SELF.stat().st_mtime
        except OSError:
            continue
        moved = False
        now_refs = _stamps(refs)
        if now_refs != seen_refs:
            seen_refs = now_refs
            refs = _ref_files()
            seen_refs = _stamps(refs)
            moved = bool(COMMIT) and _commit() not in ("", COMMIT)
        if now != seen or moved:
            time.sleep(0.6)  # let the update finish writing
            # a page being written, a reply streaming in: the update waits for
            # them, so it never cuts one short (Cozy Tavern M332) — a quarter
            # of an hour at most
            waited = 0.0
            while waited < RELIGHT_WAIT_MAX:
                with CALLS_LOCK:
                    busy = CALLS["n"]
                if not busy:
                    break
                time.sleep(0.5)
                waited += 0.5
            print("Cozy Novel was updated — relighting", file=sys.stderr)
            try:
                os.execv(sys.executable, [sys.executable, str(SELF)] + sys.argv[1:])
            except OSError:
                seen = now


def every_hour():
    def loop():
        while True:
            try:
                prune_trash()
                sweep_gone()
                daily_copy()
            except Exception as e:
                print("hourly care skipped:", e, file=sys.stderr)
            time.sleep(3600)
    threading.Thread(target=loop, daemon=True).start()


def hold_folder():
    """One server per data folder. Two servers on one folder would each number
    the saves on their own and take each other's for current."""
    HOME.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(HOME / ".server.lock"), os.O_RDWR | os.O_CREAT, 0o600)
    if fcntl is None:
        return fd
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as e:
        if e.errno not in (errno.EWOULDBLOCK, errno.EAGAIN):
            return fd
        try:
            held = os.read(fd, 100).decode("utf-8", "replace").strip()
        except OSError:
            held = ""
        os.close(fd)
        print("Cozy Novel is already running for %s%s, so this one stops." % (HOME, (" (port %s)" % held) if held else ""))
        sys.exit(3)
    os.ftruncate(fd, 0)
    os.write(fd, str(PORT).encode("utf-8"))
    return fd


LAUNCHER_MARK = "# Cozy Novel installed launcher"


def upgrade_launcher():
    """The first Cozy Novel's word in Termux ran this file in the front and
    never updated. It is replaced by the one that updates, keeps the server
    running when Termux closes, and opens the app — only ever our own file."""
    homes = []
    if os.environ.get("PREFIX"):
        homes.append(Path(os.environ["PREFIX"]) / "bin")
    homes.append(Path.home() / ".local" / "bin")
    for d in homes:
        f = d / "cozynovel"
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if LAUNCHER_MARK not in text or "cozynovel.sh" in text:
            continue
        try:
            tmp = f.with_name(f.name + ".tmp")
            tmp.write_text('#!/usr/bin/env bash\n%s\nexec "%s/cozynovel.sh" "$@"\n' % (LAUNCHER_MARK, ROOT), encoding="utf-8")
            tmp.chmod(0o755)
            os.replace(tmp, f)
            (ROOT / "cozynovel.sh").chmod(0o755)
            print("The cozynovel command was brought up to date.")
        except OSError as e:
            print("The cozynovel command could not be brought up to date:", e, file=sys.stderr)


def first_cozynovel_on_port():
    """Is the first Cozy Novel (1.x) the one holding the port? It answers here."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/novel/status" % PORT, timeout=2) as r:
            return r.status == 200 and b"sessionToken" in r.read(4096)
    except Exception:
        return False


def our_other_servers():
    """Processes running this very serve.py (by its path) — never another app's
    file of the same name."""
    out = []
    try:
        names = os.listdir("/proc")
    except OSError:
        return out
    for d in names:
        if not d.isdigit() or int(d) == os.getpid():
            continue
        try:
            with open("/proc/%s/cmdline" % d, "rb") as f:
                args = [a.decode("utf-8", "replace") for a in f.read().split(b"\0") if a]
        except OSError:
            continue
        try:
            cwd = os.readlink("/proc/%s/cwd" % d)
        except OSError:
            cwd = ""
        for a in args[1:3]:
            if not a.endswith("serve.py"):
                continue
            path = a if os.path.isabs(a) else os.path.join(cwd, a)
            if os.path.realpath(path) == str(SELF):
                out.append(int(d))
                break
    return out


def port_free():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        return s.connect_ex(("127.0.0.1", PORT)) != 0
    finally:
        s.close()


def replace_first_cozynovel():
    """The first Cozy Novel still running from this folder is asked to leave,
    so this one can take its port."""
    if not first_cozynovel_on_port():
        return False
    pids = our_other_servers()
    if not pids:
        return False
    print("The first Cozy Novel is still running — replacing it.")
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for pid in pids:
            try:
                os.kill(pid, sig)
            except OSError:
                pass
        for _ in range(50):
            if port_free():
                return True
            time.sleep(0.1)
    return port_free()


def main():
    if sys.version_info < (3, 8):
        raise SystemExit("Cozy Novel needs Python 3.8 or newer.")
    if HOME == ROOT or ROOT in HOME.parents:
        raise SystemExit("Keep the books outside the app folder (COZYNOVEL_HOME).")
    upgrade_launcher()
    lock = hold_folder()
    for d in (STORE, HISTORY, TRASH, COPIES, SENT):
        d.mkdir(parents=True, exist_ok=True)
    recover_branches()
    copy_before_update()
    try:
        httpd = Server(("127.0.0.1", PORT), Handler)
    except OSError:
        httpd = None
        if replace_first_cozynovel():
            try:
                httpd = Server(("127.0.0.1", PORT), Handler)
            except OSError:
                httpd = None
        if httpd is None:
            print("Port %d is held by another program. Stop it, or run: COZYNOVEL_PORT=8091 cozynovel" % PORT)
            sys.exit(1)
    every_hour()
    threading.Thread(target=watch_self, daemon=True).start()
    print("Cozy Novel %s — http://127.0.0.1:%d" % (VERSION, PORT))
    print("Your books live in %s" % HOME)
    with httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    os.close(lock)


if __name__ == "__main__":
    main()
