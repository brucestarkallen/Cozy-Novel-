# Cozy-Novel-

A quiet little room for writing a novel with a model beside you — on your phone, in Termux, in any browser.

You write the book chapter by chapter. Say what happens next and press **Write**, and your writer writes it onto the page; or write the words yourself and press **Add as my words**. Nothing is ever thrown away: another take, a rewrite or your own edit is a new *version* of the passage, and the earlier one is one arrow away.

While you write, a quiet **helper** keeps the book's notes — the people (who they are, how they stand with each other, where they are now), the places, the things worth remembering, the threads still open — and a summary of every chapter, so a book far longer than your model can read still fits. A **partner** talks the book over with you like a seasoned novelist, and when you ask it makes the change itself, each with its Undo. In **Scenes** you step into the story as one of its people while the narrator plays everyone else, then turn what happened into prose.

Your books live on the phone, in `~/.cozynovel`, never in a browser: close every tab, clear the browser, open another one — the book is exactly where you left it, and every open window shows the same book without a refresh.

## Install (once)

In Termux:

```sh
pkg install git python
git clone https://github.com/brucestarkallen/Cozy-Novel-.git ~/cozynovel
cd ~/cozynovel && bash install.sh
```

From then on, one word does everything:

```sh
cozynovel
```

It updates itself, starts the server (or replaces an older one that is still running), keeps the phone awake while you write, and opens **http://127.0.0.1:8081**. The server goes on running in the background after you leave Termux.

### Coming from the first Cozy Novel

Run this once:

```sh
cd ~/cozynovel && git pull && bash install.sh
```

then `cozynovel`. The first time it opens, your books, their chapters, notes, drafts and conversations, and your connections come across by themselves, once. The first Cozy Novel's own files are only read, never changed. (If you only pull and then type `cozynovel`, that works too: the new server takes the port from the old one and turns the command into the new one for next time.)

### On a computer

```sh
git clone https://github.com/brucestarkallen/Cozy-Novel-.git ~/cozynovel
cd ~/cozynovel
python3 serve.py
```

and open **http://127.0.0.1:8081**. Another port: `COZYNOVEL_PORT=8091 python3 serve.py`. Another folder for the books: `COZYNOVEL_HOME=/path python3 serve.py`.

## Writing

- **The shelf** is your books, the one you touched last first. **A new book** asks only for a working title; what it's about and how it reads can come later (or paste a whole plot essential).
- **The page** is the chapter. Tap a passage for its controls: **Another take**, **Rewrite…** (with a note on what should change), **Edit**, and **⋯** for the rest — what the writer was sent, copy, *write from here* (a new passage after this one), a scene break, *start a new chapter from here*, remove. Under the controls a line says the passage's number, its words, how many tokens its request was (*about* when the provider gave no count of its own) and when.
- **The scroller** at the page's right edge shows the number of the passage under your eye; drag it to move through a long chapter quickly (it says *Passage 12 of 40* while you hold it).
- **Select a few words** and the one button says **Rewrite**: only those words are written again, the rest of the passage stays exactly as it is.
- **Stop** keeps what came. A passage that stopped partway says so and offers **Go on**, which carries it on from its last word.
- **The box at the bottom**: what happens next (or leave it empty, and the story carries on), how much to write (a few paragraphs, a scene, a long stretch, the rest of the chapter), and who writes.
- **The book's title** at the top opens the chapters; **Notes**, **Partner** and **⋯** (Scenes, About this book, Full screen, Reading mode, Settings) sit beside it. On a wide screen the chapters and notes stand beside the page.
- **Full screen** is the writing page with nothing above it — the bars go (and the browser's own, where it allows), the page and the box stay; moving to the next chapter keeps it. **Reading mode** is only the page, for reading. A scene has its own full screen button. Back, or the small button in the corner, brings the bars back.
- **About this book**: *What it's about* and *How it reads* are each **Manual** (only your words) or **Automatic** (your words, if any, and what the helper keeps of the book as it stands — current as the book goes on). Correct what the helper keeps and your correction stands until you press *Write it from the book again*.
- The phone's **Back** closes whatever is open — a menu, a sheet, a drawer, the edit box (keeping what you typed) — before it ever leaves the book.

## The notes, the summaries and the partner

- **People** (who they are, *with others* — how they stand with the people who matter to them, and why — and *right now*), **Places**, **Things worth remembering** (objects, facts, secrets and who knows them, rules of the world) and **Threads** (promises, secrets, questions still open) are what the writer reads before every page, so a name, a scar or a promise never drifts. **Chapter summaries** are something else: they stand in for whole chapters once the book is longer than the model can read (the newest chapters always ride whole; a chapter is never sent both whole and in short).
- The helper writes them the way Summaryception taught: only what changed, a first appearance described when it happens, feelings that carry over, who knows what, each cause kept with what it led to, nothing invented and nothing softened. A card you wrote stays yours: the helper keeps where they are now and how they stand with others, never your words.
- **The partner** sees every passage numbered as on the page (*Chapter Two, passage 3*). Ask it to change something — a passage, a chapter's name, what the book is about, a card in the notes — and the change shows under its answer with **Undo** (or waits for **Apply**, as you choose in Settings). A passage it changes becomes a new version; your words stay one arrow away. A chapter it only has in short it can ask to read whole.

## The helper's light

The small dot on the **Notes** button is the helper: green when the notes are up to date, amber while it reads (or is about to), red when it couldn't — it tries again by itself and says why — and grey when no helper is chosen. **Undo the last reading** puts back only what that reading changed; a card you edited since stays as you left it. A chapter you name (or clear) is never renamed.

## Connections

**Settings → Connections → New**, pick the provider (DeepSeek, Kimi, Synthetic, OpenRouter, Z.ai, Claude, OpenAI, Gemini, Hermes Agent, or anything else that talks like OpenAI), paste the key, and pick a model from **Show the models on offer** or type its name. **Try it** sends one small request.

What you set is exactly what is sent — temperature, top-p, thinking, the longest reply, prefill and the rest. What you leave empty is not sent at all, so the provider does what it normally does. The only thing ever raised is a floor that stops a page being cut off: a model that thinks gets room to think *and* write, and the helper gets room for its notes.

When a model refuses something (a dial it doesn't take, a request longer than it holds, a different name for the reply's length, thinking at a level it doesn't offer), the request is fitted and sent again, the lesson is kept on the connection, and the page says what was done. A page is never asked again by itself after a real failure: the reason is shown in plain words and you try again when you like.

**Who does what** chooses the writer (who also narrates scenes), the partner and the helper; the partner and helper are the writer unless you choose otherwise. A quick, inexpensive model is perfect for the helper. Keys stay on the phone: every call goes out through the little server.

**Your instructions** are sent first, word for word — *How you like it written* to the writer, *How the narrator tells scenes* to the narrator (emptied, the narrator reads yours for the writer), *How the partner talks* to the partner — like the main prompt of a SillyTavern preset; every box with starting words has **Back to the default**. The note at the end rides after your request, like post-history instructions. After your instructions, the book and its notes ride in the system message — or, as you choose (**The book and its notes ride as**), as your own notes in a user message or as the writer's notebook in an assistant message, as in Cozy Tavern.

Everything the app itself says is in your voice and plain words ("our novel", "I'm taking Joon's part"), never a machine's — so a writer you made Batman or Light Yagami stays Batman in its thinking — and it says once that the book is fiction for grown readers, written uncensored.

## Keeping it safe

- Every save is numbered; a window holding an older copy can never write over newer work — its change is played again over the newer copy.
- Every chapter and book keeps its earlier copies (the newest eight, then one an hour for two days, then one a day for a month): chapters list → **⋯ → Earlier copies of this chapter**.
- A copy of everything is kept once a day (the newest fourteen), and anything removed waits in **Settings → Backups → Recently deleted** for thirty days, with its name.
- **Take a copy of everything** downloads one file; **Bring a copy back** adds its books or puts everything back as it was (keeping a copy of what was there first).
- What you type while the server is away waits in the browser and is saved the moment it answers — even if Android closed the tab meanwhile.

## Taking the book out

**⋯ → About this book → Take it out as a file**: an e-book (EPUB), a printable book (print it to PDF from the browser), Markdown or plain text. **Bring in a book** on the shelf reads a `.txt` or `.md` file (its chapter headings become chapters, `***` a scene break) or a copy from Backups.

## For whoever works on it next

No build step: `index.html`, `css/`, `js/` and `serve.py` are the whole app. `AGENTS.md` maps the code and the rules it keeps. The checks:

```sh
python3 tests/server.py             # the server: saves, copies, trash, the relay, the upgrade from 1.x
node tests/app.mjs                  # the app's own modules against the real server and a scripted model
node tests/thinking.mjs             # thinking parity with Cozy Tavern
python3 tests/browser/walk_main.py  # the whole app in a real browser (needs playwright + chromium)
python3 tests/browser/walk_more.py
```

All of them use synthetic books in a temporary folder and stand-in models; nothing paid is ever called.
