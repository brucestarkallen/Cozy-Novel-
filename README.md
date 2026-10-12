# Cozy-Novel-

A quiet, local writing studio for your novel. Write by hand, ask a model to develop a scene, compare alternatives, or step into a character's shoes. Your accepted text stays separate from AI candidates and exploratory branches.

## Install

Python 3.11 or newer is required. There is no application build step and no Node requirement for everyday use.

In Termux, install Git and Python first:

```sh
pkg install git python
git clone https://github.com/brucestarkallen/Cozy-Novel-.git ~/cozynovel
cd ~/cozynovel
sh install.sh
cozynovel
```

On a desktop with Git and Python installed:

```sh
git clone https://github.com/brucestarkallen/Cozy-Novel-.git ~/cozynovel
cd ~/cozynovel
python3 serve.py
```

Open **http://127.0.0.1:8081** in your browser. Keep the terminal open while using device saves and the model relay. If your Python command is `python`, use that instead of `python3`. The optional installer prints the exact launcher path and does not edit your shell settings.

If the port is occupied, the launcher leaves that process alone. Choose an explicit alternative with `python3 serve.py --port 8091`. A different port has separate browser storage, so make a portable backup before changing your everyday address.

**Keep Cozy Novel on a separate origin from the original RP app.** Do not place both under different paths on the same host and port. Two project paths on the same GitHub Pages hostname also share an origin. This repository does not deploy either application.

## Start writing

1. Choose **Start a novel** and enter a working title. No biography or outline is required.
2. Write in the manuscript, or enter a scene direction below it and choose **Write scene**.
3. Read the separate candidate. **Keep passage** inserts it with a recoverable revision. **Try another** preserves the earlier candidate.
4. Use a suggestion or your own direction to continue. A suggestion that also keeps a candidate says so explicitly.
5. Select exact manuscript text before **Revise selection**. Everything outside that range stays unchanged.
6. Use **Quick RP** to choose a person and explore the scene. **Keep exploration** saves only the exploration. **Keep events** asks you to review an event declaration. **Turn into prose** creates a candidate to compare before insertion.

Chapters and scenes can be renamed, annotated and reordered. Use arrow controls with a keyboard or drag scenes within a chapter. Fictional time is independent of manuscript order. History preserves later versions when you restore an earlier one. The Story Bible distinguishes author facts, plans, beliefs, secrets, future ideas and derived memories.

## Connect a model

Open **Connections**, choose the exact adapter, enter the model identifier and its complete API endpoint, then enter your key. **Validate and save connection** checks configuration without a paid model call. The local relay keeps the key outside the manuscript database. It remains in memory unless you explicitly choose local persistence.

One writing connection supports all workflows. An optional helper connection can handle suggestions and source readings. Disable automatic suggestions in **Writing style** if you prefer. Supported adapters are OpenAI Responses, compatible Chat Completions, Anthropic Messages and OpenRouter. See [provider details](docs/PROVIDERS.md).

## Where your writing is saved

The browser saves in the independent `cozynovel.v1` IndexedDB database. **Saved in browser** appears after the transaction completes. This is your immediate working copy. Browser persistent storage is useful but is not an independent backup.

The local server saves changed records to `~/.cozynovel/library.sqlite3`. **Saved to browser and device** confirms a device acknowledgement. A browser only or conflict message means you should not assume the device copy is current. Browser changes remain local when the server is unavailable.

Device snapshots live under `~/.cozynovel/backups`. Optional saved connection profiles live in `~/.cozynovel/connections.json` with restricted file permissions. Those permissions are not encryption. Keep the entire device directory private.

A hosted or offline static copy still supports manual writing, reading, revisions and portable exports. Its AI controls require this local relay. It does not expose a key entry workaround for unsupported browser cross origin transport.

## Back up and recover

Use **Backups**, then **Download full backup**. This portable JSON file includes novels, exact text, ordering, revisions, Story Bible records, candidates, exploration branches and provenance. Credentials are excluded. **Export manuscript** produces only the accepted book in text, Markdown or printable HTML. It is not a full backup.

To restore, select a valid Cozy Novel backup and review its titles and counts. **Import as separate copies** gives the records new identities. **Restore browser library** saves a recovery snapshot first and then replaces the browser library with a new generation. Invalid or RP backups are rejected without changing your work.

Device replacement is a separate **Preview device restore** step. It creates a device recovery snapshot before replacement. If browser and device disagree, download both versions before choosing a restore. A conflict never silently chooses the newer timestamp.

Archive is the normal removal action. Include archived work in the library to recover it. Discarded candidates and explorations also remain recoverable. History and backups are never automatically pruned.

## Update safely

Make a full portable backup and a device snapshot first, stop this server, then update only this repository:

```sh
cd ~/cozynovel
git pull --ff-only origin main
cozynovel
```

If Git reports local edits or a conflict, keep them and resolve the conflict rather than resetting them away. The browser offers **Save and refresh** when a new offline shell is ready. Finish or stop generation before refreshing.

Code rollback and data restore are separate operations. Retain a copy of the previous code before an update. Do not open newer data with code that cannot read its schema. To inspect an older version safely, use a separate checkout, a separate explicit data directory and a different port. The service refuses unsupported device schema versions.

## Diagnostics and verification

**Backups**, then **Redacted diagnostic**, downloads application version, browser identity, record counts and job states without manuscript text or credentials. Request receipts inside a novel show the model, selected sources, omissions, estimates and actual usage when provided.

Developer checks use Node, Python and Playwright with synthetic stories and a local mock provider. See [verification evidence and limits](docs/VERIFICATION.md), [release handoff](HANDOFF.md), [data and API contract](docs/API.md) and [architecture](SPEC.md). No live provider quality or physical Android and Termux claim follows from desktop tests.
