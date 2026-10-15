#!/usr/bin/env python3
"""Failure injection for whole-library restores. Temporary records only."""
import importlib.util
import os
from pathlib import Path
import tempfile
from unittest.mock import patch

passed = 0


def check(name, fn):
    global passed
    fn()
    passed += 1
    print("ok   " + name)


with tempfile.TemporaryDirectory(prefix="cozynovel-backup-integrity-") as home:
    with patch.dict(os.environ, {"COZYNOVEL_HOME": home}):
        spec = importlib.util.spec_from_file_location("cozy_backup_test", Path(__file__).resolve().parent.parent / "serve.py")
        app = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(app)

    def snapshot(words):
        return {"format": "cozynovel-library", "records": [{"kind": "novel", "id": "n-kept", "data": {"id": "n-kept", "value": words}}]}

    def generation_failure():
        app.put_record("novel", "n-kept", {"id": "n-kept", "value": "words before restore"}, 0)
        with patch.object(app, "set_generation", side_effect=OSError("simulated generation write failure")):
            try:
                app.replace_library(snapshot("words in restore"))
            except (OSError, RuntimeError):
                pass
            else:
                raise AssertionError("the write failure must be reported")
        assert app.read_record("novel", "n-kept")["data"]["value"] == "words before restore", "failed restore must put the complete old library back"
        assert app.generation() == 0

    check("a failed generation write rolls the whole library back", generation_failure)

    def distinct_copies():
        strftime = app.time.strftime
        with patch.object(app.time, "strftime", side_effect=lambda fmt, *args: "20261015-100000" if fmt == "%Y%m%d-%H%M%S" else strftime(fmt, *args)):
            first = app.replace_library(snapshot("first restored library"))
            second = app.replace_library(snapshot("second restored library"))
        assert first != second, "two restores in one second must not overwrite the first safety copy"
        assert app.read_gz(app.COPIES / first)["records"][0]["data"]["value"] == "words before restore"
        assert app.read_gz(app.COPIES / second)["records"][0]["data"]["value"] == "first restored library"

    check("rapid restores keep a distinct safety copy for each previous library", distinct_copies)

    def invalid_revisions():
        for rev in [None, True, -1, "broken", 1.5]:
            bad = snapshot("damaged restore")
            bad["records"][0]["rev"] = rev
            try:
                app.replace_library(bad)
            except ValueError:
                pass
            else:
                raise AssertionError("invalid saved revision accepted: " + repr(rev))
            assert app.read_record("novel", "n-kept")["data"]["value"] == "second restored library"

    check("damaged revision numbers are refused before changing any record", invalid_revisions)

print("\nbackup integrity: %d passed, 0 failed" % passed)
