# Working on Cozy Novel

Read this before changing anything. It is the map of the code and the rules the
owner keeps. The owner reads plain words, not jargon: name things the way the
screen names them.

## What it is

One page (`index.html`, `css/novel.css`, `js/`) served by one Python file
(`serve.py`) that also keeps the data. No build step, no packages, no
framework. It runs in Termux on the owner's phone; the browser is only a
window onto the server.

## The parts

| file | what it does |
| --- | --- |
| `serve.py` | the server: the app's files (never cached), the records (one JSON file each, numbered saves, a save from an older copy refused with the newer one), earlier copies, the day's copies, Recently deleted (30 days), the news line to every open page, the relay that carries every model call (keys never leave the phone), the import of the first Cozy Novel, replacing an older server on the port, and relighting itself when an update lands (its own file changing, or the code moving to a new commit) |
| `cozynovel.sh`, `install.sh` | the one word `cozynovel`: pull, make sure the running server is this code, wake lock, open the page |
| `sw.js` | a service worker that caches nothing: it exists so the app sits on the home screen and so the 1.x worker (which served stale copies) is retired |
| `js/store.js` | records in the page: open, change by *steps* (written by id, so they replay over a newer copy after a refused save), save, the news line (one visible window holds it for every window of the browser and hands the news on), the journal of unsaved work in IndexedDB for when Android closes a tab |
| `js/app.js` | the front door: routes (`#/`, `#/n/<book>/<chapter>`), the bars, full screen and reading mode, updates landing by themselves |
| `js/ui/*` | the screens: `shelf`, `desk` (the page, the box, the scroller and passage numbers), `panes` (chapters, notes, partner and its changes, scenes), `settings`, `book` (About this book, Manual / Automatic), `sent` (what was sent), `dom` (sheets, menus, the Back stack, toasts), `think` (the thinking, streamed open then folded), `full` (full screen), `prose`, `look` |
| `js/novel/shape.js` | what a book is made of, and the steps that change it (pure) |
| `js/novel/writer.js` | writing: a new passage, another take, rewrite, rewrite the selected words, Go on, a scene into prose, his own words, his edits; repairs a page left "being written" by a closed window |
| `js/novel/archivist.js` | the helper: reads what changed, keeps the notes and the chapter summaries and names, What it's about / How it reads for a book set to Automatic, undo of a reading, its light |
| `js/novel/talk.js` | the partner and the scenes; the partner's reading of whole chapters |
| `js/novel/changes.js` | the partner's changes: read from its answer, made (a new version, never an overwrite), refused with the reason, undone |
| `js/novel/context.js` | what each one is handed: his instructions, the book, the notes, the chapter, sized to the model's room (older chapters as summaries, never both); where the book and its notes ride (system, his notes, the writer's notebook) |
| `js/novel/prompts.js` | every word the app itself sends, and the starting words of his boxes |
| `js/novel/files.js` | EPUB, printable, Markdown, text out; text and Markdown in; the 1.x import |
| `js/model/providers.js`, `js/model/call.js` | the model layer, ported from Cozy Tavern / CozyMaker: each provider's wire, thinking, the dials, prefill, lessons a model teaches about itself, plain error words |

## The rules (the owner's, not negotiable)

- **Everything he set is sent exactly; what he left empty is not sent.** The only thing ever raised is a floor that prevents a cut-off page (thinking room, the helper's room).
- **His own instructions come first, word for word, in the system message.** The book and its notes ride after them — in the system message, or as he chooses as his notes (user) or the writer's notebook (assistant).
- **Every word the app says is natural and in his voice** — never "AI", "assistant", "user", "system", "prompt", "persona", "role", "the author", never a second "You are": his writer may be Batman. The book is said once to be fiction for grown readers, uncensored; the helper is told the same, so it never softens what it keeps.
- **Every setting with starting words has Back to the default.**
- **A page is never asked again by itself after a real failure.** Lessons (a refused dial, "too long", a renamed length field) fit the request and send it again; anything else says the reason in plain words. Only the helper waits out a passing fault and tries again by itself.
- **Nothing he wrote is ever lost:** versions, never overwrites; the edit box keeps its words on Back; an empty answer leaves no empty passage; earlier copies and Recently deleted for everything.
- **The data lives on the device, the same in every browser.** Browser storage holds only per-browser conveniences (which columns are docked, which sections are folded) and the journal of work not yet on the phone, which goes to the phone the moment it answers.
- **Updates land without a manual refresh**, and the app repairs what it can detect.
- **One button, one meaning; controls named the way the screen names them;** busy sections fold closed; no debug surfaces; no content filters.
- **The phone's Back closes what is open, top first, before it leaves the book.** Every overlay goes through `onBack()` in `js/ui/dom.js`.

## Working on it

- A symptom is not the bug: find why it happens, then search the whole codebase for the same pattern.
- After a change, list what else it touches and check each path.
- Tests run the feature and look at what came back — never at the source. Run all of them before saying anything works:

  ```sh
  python3 tests/server.py
  node tests/app.mjs
  node tests/thinking.mjs
  python3 tests/browser/walk_main.py   # needs: pip install playwright (and a Chromium)
  python3 tests/browser/walk_more.py
  ```

- Synthetic data in temporary folders only; stand-in models only (`tests/fake_provider.py`, `tests/scripted_provider.py`). Never a paid call.
- `README.md` keeps its first line `# Cozy-Novel-`. `HISTORY.md` is append-only. Bump `VERSION` in `serve.py` with each release.
- Never force-push or rewrite history; the owner's phone updates with `git pull --ff-only`.
- Cozy Tavern and Cozy Chat are read for reference only — never edited or pushed from here.
