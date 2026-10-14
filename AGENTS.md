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
| `js/ui/*` | the screens: `shelf`, `desk` (the page, the box with its chips — how much, who decides how it turns out, who writes — the scroller and passage numbers, words found shown and marked, what a page looked up), `panes` (chapters, notes — lit and yours explained, the readings list — partner and its changes and quick asks — Edit by hand, Apply all, Leave all, Undo all, What it said whole — its conversations, Branch from here, Edit and ask again, full screen, scenes with Tell the narrator and Three choices, the narrator's telling drawn as prose), `settings` (Cozy Tavern's connection editor, Usage and cost, presets, the notes' Send it switches, Modules each in a sheet of its own with Back to the default always there, and All back to the default), `book` (About this book, Manual / Automatic, Sound: Comic / Novel), `sent` (what was sent), `checks` (the checker's bubble on the page and Suggestions), `search` (Search: this book or all books, a tap goes there), `dom` (sheets, menus, the Back stack, toasts), `think` (the thinking, streamed open then folded), `full` (full screen: the page, a scene or the partner), `live` (words as they arrive: painted at most once a frame and never more than a fifth of the time, line by line; the follow law), `prose`, `look` |
| `js/novel/shape.js` | what a book is made of, and the steps that change it (pure) |
| `js/novel/writer.js` | writing: a new passage, another take, rewrite, rewrite the selected words, Go on, a scene into prose, his own words, his edits; repairs a page left "being written" by a closed window |
| `js/novel/archivist.js` | the helper: reads what changed, keeps the notes and the chapter summaries and names, What it's about / How it reads for a book set to Automatic, undo of a reading, its light; keeps each reading per version (`memory.readings`) and settles a version picked, written again or taken out from them (`settleNow`, `settle`); the readings list, Put back and Read again; a page waits up to five seconds for a reading on its way (`setNotesWait`); the notes' auditor (`auditNotes`, Cozy Tavern's ledger auditor): every `AUDIT_EVERY` readings, when he asks (`askAudit`), and once for notes kept before it (`firstCheck`, on opening a book), the whole notes held against the book as it stands — his own cards keep his words and are never taken out |
| `js/novel/readings.js` | each version its own notes (pure): a reading taken back or laid on again card by card, only where the card still reads as it did (`planOf`, `moved`); the newest read passage (`newestRead`); the notes as they stood before a passage (`notesBefore`, for the writer of another take or a rewrite); the passages the notes have not read yet (`unread`) |
| `js/novel/presets.js` | presets: the voice of his instructions saved under a name — the three boxes, both notes at the end, words to avoid, his name — used again exactly; the switches and modules stay (Cozy Tavern's voice presets) |
| `js/novel/talk.js` | the partner and the scenes (his line to the narrator rides after his move; the narrator's offered choices are kept out of the story); the partner's rounds within one answer — reads (chapters, `find:`, `module:`) and the re-asks for changes that missed or were only claimed (`claimsChange`), in the order they came; Edit by hand (`applyEdited`), Apply all / Leave all / Undo all (`settleAll`); the conversations (`newConversation`, `openConversation`, `copyConversation`, `renameConversation`, `removeConversation`, `startOver`, `editAndAskAgain`) — never while a reply is being written |
| `js/novel/conversations.js` | the partner's conversations (pure; Cozy Tavern's housekeeper sessions): the open one is the talk's `turns` (with `name`, `convId`, `named`), the others wait in `convs`; their steps, names and order by when they were last used; a copy's changes stay the conversation's they were made in (`copied`) |
| `js/novel/checker.js` | the checker: reads each finished passage once, with as much of the story right before it as its model holds (grammar, wording that sounds machine-made, his words to avoid, slips against the book, seams that don't hold); the judge (`judgeOf`, `gradesOf`: Cozy Tavern's benchmark for a novel — five grades and the whole, a passage under his mark offered with craft fixes and Write it again toward it), keeps what it would change on the chapter (`checks[passage][version]`, only while that version reads the same), Apply (one new version for a whole checking, `how: 'suggested'`), Leave it (remembered for that passage, `checksLeft`), Apply all, the bubble's state; writing from before `house.checksFrom`, or brought in, only when he asks (`checkAll`) |
| `js/novel/search.js` | finding words in a book (pure): capitals, accents, curly quotes and runs of spaces matched as one, each place with the words either side — passages as on the page, chapter names, notes, About this book, the partner, the scenes |
| `js/novel/changes.js` | the partner's changes (Cozy Tavern's housekeeper, for a book): read from its answer, made (a new version, never an overwrite), refused with the reason, undone — a passage (words, whole, taken out), the same words across chapters (whole words), a name everywhere (never an ordinary word, never inside the name it becomes or a hyphened name), a chapter's name or summary, the book's words, a card (renamed too — only one that is there), a module's words; `whyNot` looks at a change set to wait as it arrives; `readAsks` — a chapter, `find:` words, `module:` words; `editableOf` / `withEdits` — Edit by hand |
| `js/novel/context.js` | what each one is handed: his instructions, the modules that always ride (right after his words, in the part that stays the same page after page), the book, what this moment woke (an intimate scene, a fight — in the part that moves, before the notes), the notes, the chapter, sized to the model's room (older chapters as summaries, never both); where the book and its notes ride (system, his notes, the writer's notebook); a model too small for his instructions and modules is never sent a request — `refuse` says why (call.js) |
| `js/novel/crafts.js` | his Simulation Engine preset as Cozy Tavern carries it, made into the novel craft (the writer writes everyone, the main character too, from his premise) and the scene craft (the narrator; his character is his alone), and Cozy Tavern's other rules (intimate, the contest's board, the sound of a voice, spectacle); the sound law in its two forms (Comic: sound effects in asterisks; Novel: sounds in the sentences); `wakesOn`, the words that wake a rule (Cozy Tavern's patterns, and a novel's past tense and premises, with the plain English that only sounds like a fight or sex set aside) — read over his own words only, never a page (`hisWordsIn`/`hisWordsBefore` in shape.js, `hisLast` in talk.js). Words only, no machine words |
| `js/novel/modules.js` | the modules: the app's (from crafts.js) and his own (`house.modules[id]`; for one of the app's only what he changed, so its words follow the app's until he edits them), who reads each (writer, narrator, partner) and when (always, intimate, fight, off); `ridingFor` — what rides this time, with the book's sound law |
| `js/novel/prompts.js` | every word the app itself sends — who decides how it turns out (Writer decides / I decide), a rewrite that carries his change through — and the starting words of his boxes (the boxes still holding the words of before 2.3, untouched, get today's when the app starts); `lateFor`, his note at the end — the book's for the writer, the scenes' for the narrator, never the partner's (the one note of before 2.3.2 copied to the scenes' box once, `splitLate`) |
| `js/novel/files.js` | EPUB, printable, Markdown, text out; text and Markdown in; the 1.x import |
| `js/model/providers.js`, `js/model/call.js` | the model layer, ported from Cozy Tavern / CozyMaker: each provider's wire, thinking, the dials, prefill (as written or structured), web search (Claude's tool, OpenRouter's plugin), lessons a model teaches about itself (a structured refusal too), plain error words; Test (`tryConnection`: thinking at the level, again at the top, the speed), Test it (`testPrefill`), every call counted (`noteUsage` → `/api/usage`) |
| `js/model/structured.js` | Cozy Tavern's structured prefill: the template as a pattern, the JSON answer read as it streams, words it can never write, the ready-made templates (made for a novel) |

## The rules (the owner's, not negotiable)

- **The goal is a finished novel.** Continuity has to be perfect: the notes true to the book as it stands, the summaries good, and every passage carrying on smoothly from the end of the one before it. The writer is told to follow straight on from the last words; the checker suggests a mend wherever a seam doesn't hold; the notes' auditor puts the notes right.

- **Everything he set is sent exactly; what he left empty is not sent.** The only thing ever raised is a floor that prevents a cut-off page (thinking room, the helper's room).
- **His own instructions come first, word for word, in the system message** — then his words to avoid, when he listed any, then the modules (Settings → Your instructions → Modules: the novel craft for the writer, the scene craft for the narrator, his own). The book and its notes ride after them — in the system message, or as he chooses as his notes (user) or the writer's notebook (assistant). A rule that wakes (an intimate scene, a fight) rides in the system message's moving part, never as his words.
- **Every word the app says is natural and in his voice** — never "AI", "assistant", "user", "system", "prompt", "persona", "role", "the author", never a second "You are": his writer may be Batman. Who the writer is (a master novelist) is said only in the starting words of his own box, his to change. The crafts and rules are held to the same words. The book is said once to be fiction for grown readers, uncensored; the helper is told the same, so it never softens what it keeps.
- **Every setting with starting words has Back to the default.**
- **Every button and menu item says in a small line what it does** (Cozy Tavern's quiet lines): a menu item's `hint`, a settings button's quiet line under it.
- **The notes heal themselves.** Every few readings, and once for notes from before the auditor, the helper holds the whole notes against the book as it stands and puts right what no passage says any more.
- **Each version of a passage keeps its own notes.** The writer of another take or a rewrite is handed the notes as they stood before that passage; a version written again, picked or taken out is settled from the readings kept wherever that is exact (the newest read passage), and read as a change otherwise. A card he wrote or changed is never written over by any of it.
- **A page is never asked again by itself after a real failure.** Lessons (a refused dial, "too long", a renamed length field) fit the request and send it again; anything else says the reason in plain words. Only the helper and the checker wait out a passing fault and try again by themselves; a connection refused for good is not asked again until it changes.
- **Nothing he wrote is ever lost:** versions, never overwrites; the edit box keeps its words on Back; an empty answer leaves no empty passage; earlier copies and Recently deleted for everything. The checker only suggests: nothing changes until he applies it, and what he leaves stays left.
- **The data lives on the device, the same in every browser.** Browser storage holds only per-browser conveniences (which columns are docked, which sections are folded) and the journal of work not yet on the phone, which goes to the phone the moment it answers.
- **Updates land without a manual refresh**, and the app repairs what it can detect.
- **One button, one meaning; controls named the way the screen names them;** busy sections fold closed; no debug surfaces; no content filters.
- **The phone's Back closes what is open, top first, before it leaves the book.** Every overlay goes through `onBack()` in `js/ui/dom.js`.
- **Streaming never fights his hand.** While words stream, the page (and the partner and scenes beside it) follows them only until he moves it up; from then on it stays where he put it until he brings it back down or taps Follow the writing. A stream repaints only the paragraph its words land on, and nothing is drawn again for the writer's own saves of what it has streamed.

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
