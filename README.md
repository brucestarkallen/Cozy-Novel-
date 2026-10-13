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
6. Use **Quick RP** to choose a person and explore the scene. **Keep exploration** saves only the exploration. **Keep events** prepares a sourced event proposal for you to accept or edit, with optional knowledge and state details. **Turn into prose** creates a candidate to compare before insertion.

Chapters and scenes can be renamed, annotated and reordered. Use arrow controls with a keyboard or drag scenes within a chapter. Fictional time is independent of manuscript order. History preserves later versions when you restore an earlier one. The Story Bible distinguishes author facts, plans, beliefs, secrets, future ideas and derived memories. Automatic source readings create reversible typed records from accepted passages, without requiring biographies or forms for ordinary use. Review and undo are secondary Story Bible details. Unfinished or failed readings remain visible; they never block writing. Historical Quick RP excludes unscoped profile developments, whole scene summaries and unsupported future information. Original profiles stay available with their history; explicitly stable biography can be declared separately.

## Connect a model

Open **Connections**. Choose a provider preset, name the connection, enter the API key, then **Fetch models** or enter the model yourself. **Test connection** sends a small provider request and may use billable tokens. **Validate and save connection** saves configuration without DNS lookup or a model call. **Use** assigns it, and the compact model picker changes the writer for the open novel.

Save several models from the same provider or different providers. **Copy** makes an independent editable profile. **Change**, **Test**, **Details** and **Remove** are available for each one. Choose a default writer and optional helper, or set explicit novel assignments. A global default never replaces a novel override. Helpers fall back to the selected writer. Removing a connection explains its assignments and retains request history.

Choose **Remember this API key on this device** deliberately if you want it available after a normal service restart. Otherwise the key lasts only while the local service runs. Profile metadata always remains. Remembered keys use a separate restricted local file; permissions are not encryption. The previous primary and helper identities migrate without deleting their settings or historical receipts. A missing memory only key is shown as **Key needed**.

The local relay is preferred. **Browser direct** is an explicit alternative only when the endpoint permits browser CORS access. Its key stays in page memory and is exposed to the running application environment. It cannot be remembered across a page restart. Transport never changes silently after an error. See [provider details](docs/PROVIDERS.md).

In **Writing style**, choose automatic, review only or disabled **Story Brain**, and separately control recommendation bubbles. New novels enable quiet source reading. Existing explicit disabled preferences stay disabled. Accepted source reading continues under its original scene and revision even when you switch panels. Pending coverage and reversible updates remain in Story Bible details.

**Plan and references** opens optional Director guidance, Literary Editor review, Smart recall, exact text references and reusable styles. These tools do not establish future events or rewrite manuscript text. An Editor replacement is a separate candidate. References remain outside canon. All optional model tools are explicit requests except the bounded source reading enabled in Writing style.

Use **Focus writing** to keep the manuscript and direction composer, or **Focus reading** to hide writing controls. **Return to studio** exits either mode. **Aa** controls theme, paper, size, width, spacing, dialogue tint and the decorative background. On a phone, switch between Chapters, Write, Partner and Story Bible. Unsent directions, questions, RP actions and temporary revision instructions save as recoverable creative drafts, with their original owners.

## Where your writing is saved

The browser saves in the independent `cozynovel.v1` IndexedDB database. **Saved in browser** appears after the transaction completes. This is your immediate working copy. Browser persistent storage is useful but is not an independent backup.

The local server saves changed records to `~/.cozynovel/library.sqlite3`. **Saved to device through checkpoint N** confirms acknowledged work. **Device save pending** means newer browser work is still queued. A browser only or conflict message means you should not assume the device copy is current. Browser changes remain local when the server is unavailable.

Device snapshots live under `~/.cozynovel/backups`. Optional saved connection profiles live in `~/.cozynovel/connections.json` with restricted file permissions. Those permissions are not encryption. Keep the entire device directory private.

A hosted or offline static copy still supports manual writing, reading, revisions and portable exports. AI uses either the preferred local relay or explicitly configured browser direct transport. Browser security is never bypassed.

## Back up and recover

Use **Backups**, then **Download full backup**. This portable JSON file includes novels, exact text, ordering, revisions, Story Bible records, candidates, exploration branches and provenance. Credentials are excluded. **Export manuscript** produces only the accepted book in text, Markdown or printable HTML. It is not a full backup.

To restore, select a valid Cozy Novel backup and review its titles and counts. **Import as separate copies** gives the records new identities. **Restore browser library** saves a recovery snapshot first and then replaces the browser library with a new generation. Invalid or RP backups are rejected without changing your work.

Device replacement is a separate **Preview device restore** step. A preview captures a specific committed browser snapshot. If you write after preparing it, prepare a fresh preview. Other tabs may keep visible unsaved drafts, which are not part of that snapshot. It creates a device recovery snapshot before replacement. If browser and device disagree, download both versions before choosing a restore. A conflict never silently chooses the newer timestamp. If a restore response is lost, use **Check interrupted device restore**. The app checks the exact durable operation before reconciling pending saves. Unknown outcomes retain both copies and keep committed writers fenced; visible drafts can still be copied or downloaded.

Archive is the normal removal action. Include archived work in the library to recover it. Discarded candidates and explorations also remain recoverable. History and backups are never automatically pruned.

## Update safely

Make a full portable backup and a device snapshot first, stop this server, then update only this repository:

```sh
cd ~/cozynovel
git pull --ff-only origin main
cozynovel
```

If Git reports local edits or a conflict, keep them and resolve the conflict rather than resetting them away. This update migrates IndexedDB additively to physical version 3 while keeping the database name and portable format. Refresh or close other Cozy Novel tabs after saving their visible drafts. Old code cannot reopen version 3, and the updated local service rejects older writers. No database reset is required. The browser offers **Save and refresh** when a new offline shell is ready. Finish or stop generation before refreshing.

Code rollback and data restore are separate operations. Retain a copy of the previous code before an update. Do not open newer data with code that cannot read its schema. To inspect an older version safely, use a separate checkout, a separate explicit data directory and a different port. The service refuses unsupported device schema versions.

## Diagnostics and verification

**Backups**, then **Redacted diagnostic**, downloads application version, browser identity, record counts and job states without manuscript text or credentials. Request receipts inside a novel show the model, selected sources, omissions, estimates and actual usage when provided.

Developer checks use Node, Python and Playwright with synthetic stories and a local mock provider. See [verification evidence and limits](docs/VERIFICATION.md), [release handoff](HANDOFF.md), [data and API contract](docs/API.md) and [architecture](SPEC.md). No live provider quality or physical Android and Termux claim follows from desktop tests.

Release 1.2 evidence, screenshots, migration results and limitations are recorded in [the release report](docs/RELEASE_1_2.md). No live model account or physical Android device was tested. Make a full portable backup before updating, finish or stop generation, and save visible input before refreshing older tabs. Do not reset your database.
