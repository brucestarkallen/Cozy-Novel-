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
- **The page** is the chapter. Tap a passage for its controls: **Another take**, **Rewrite…** (with a note on what should change — the change becomes what happens, and the writer follows it through everything it touches, never just patching the old words), **Edit**, and **⋯** for the rest — what the writer was sent, copy, *write from here* (a new passage after this one), a scene break, *start a new chapter from here*, remove. Under the controls a line says the passage's number, its words, how many tokens its request was (*about* when the provider gave no count of its own) and when.
- **The scroller** at the page's right edge shows the number of the passage under your eye; drag it to move through a long chapter quickly (it says *Passage 12 of 40* while you hold it).
- **Select a few words** and the one button says **Rewrite**: only those words are written again, the rest of the passage stays exactly as it is.
- **Stop** keeps what came. A passage that stopped partway says so and offers **Go on**, which carries it on from its last word.
- **The box at the bottom**: what happens next — your premise (or leave it empty, and the story carries on) — how much to write (Automatic — the writer judges how much the story needs and stops where your next premise comes in — or a few paragraphs, a scene, a long stretch, the rest of the chapter), **who decides how it turns out**, and who writes. **Writer decides**: your premise sets it going and the writer carries it through to where the story's own logic lands it — who comes out ahead, what it costs. **I decide**: the writer plays everything up to it in full and stops on the moment it hangs, for your next premise to settle. Either way the writer writes everyone — the main character too — and how everyone takes it; whatever your premise already says happens, happens. Each book keeps its own.
- **The book's title** at the top opens the chapters; **Notes**, **Partner**, **Search** and **⋯** (Scenes, About this book, Full screen, Reading mode, Settings) sit beside it. On a wide screen the chapters and notes stand beside the page.
- **Search** (the magnifier) finds any words — in **This book** or **All books**: the passages as they stand on the page, chapter names, the notes, what the book is about, the partner and the scenes. Capitals, accents, curly quotes and line breaks don't matter. Tap a place and you're there, the words marked for a moment.
- **Full screen** is the writing page with nothing above it — the bars go (and the browser's own, where it allows), the page and the box stay; moving to the next chapter keeps it. **Reading mode** is only the page, for reading. A scene has its own full screen button. Back, or the small button in the corner, brings the bars back.
- **About this book**: *What it's about* and *How it reads* are each **Manual** (only your words) or **Automatic** (your words, if any, and what the helper keeps of the book as it stands — current as the book goes on). Correct what the helper keeps and your correction stands until you press *Write it from the book again*. **Sound** is **Comic** (the world's sounds as sound effects in asterisks — \*CLANG!\* — as in Cozy Tavern) or **Novel** (the same sounds written into the sentences); voices are written out in quotes either way.
- The phone's **Back** closes whatever is open — a menu, a sheet, a drawer, the edit box (keeping what you typed) — before it ever leaves the book.

## The notes, the summaries and the partner

- **People** (who they are, *with others* — how they stand with the people who matter to them, and why — and *right now*), **Places**, **Things worth remembering** (objects, facts, secrets and who knows them, rules of the world) and **Threads** (promises, secrets, questions still open) are what the writer reads before every page, so a name, a scar or a promise never drifts. **Chapter summaries** are something else: they stand in for whole chapters once the book is longer than the model can read (the newest chapters always ride whole; a chapter is never sent both whole and in short).
- The helper writes them the way Summaryception taught: only what changed, a first appearance described when it happens, feelings that carry over, who knows what, each cause kept with what it led to, nothing invented and nothing softened. A card you wrote stays yours: the helper keeps where they are now and how they stand with others, never your words.
- **Each version of a passage keeps its own notes**, like Cozy Tavern's ledger checkpoint for every swipe. **Another take**, a **Rewrite** or your **Edit** of the newest passage first takes what the old version put in the notes back out — the notes stand as they did before that passage — and the new version is read from there, as new; the writer of the new take is handed the notes as they stood before the passage, never the ones the old version made. The **arrows** back to a version read before bring its notes back at once, with no reading; so does taking out the newest passage. A passage further back that changes is read as a change (the helper is told what it used to say and what it says now), so later readings are never written over. A card you wrote or changed stays as you left it through all of this. A chapter that reads again as it once did gets its summary from then back, with no call.
- **The notes' auditor**, as Cozy Tavern audits its ledger: every few readings the helper holds the whole notes against the book as it stands — the versions on the page — and puts right whatever they still hold from words since rewritten or taken out, or have drifted on (who said what, who knows what, where someone is now, threads closed or missed); your own cards keep your words. Notes kept before 2.4.1 are checked this way by themselves the first time the book opens, so a fact an old take made up goes. **Check the notes against the book** (at the top of the notes) does it now; **Undo the last reading** puts back what it changed.
- **Lit** cards are what the helper changed last — marked *new* or *updated*, with which passage it read and when; **every card goes to the writer, lit or not**. *Yours* marks a card you wrote or changed. When the notes have not read the newest passages yet, the writer is told which, and that the passages are right where the two differ (Cozy Tavern's "Not in these notes yet"); a page about to be written waits a few seconds for a reading already on its way.
- **Readings — each version's notes** (at the foot of the notes) lists every reading the helper made, newest first: what it read, what it changed, and whether it is in the notes now, on show but not read yet, or an earlier version whose notes come back when you pick it. **Put back** takes out only what one reading changed (a card changed since stays); **Read again** puts it back and has the helper read that passage afresh.
- **In a scene**, **Tell the narrator** opens a second box under yours for a line to the narrator about how the scene should go (bring someone in, the storm gets worse) — never your character's words, and never written into the prose. **Three choices**, when on, has the narrator offer three different things your character might say or do next, as buttons under its part: tap one to play it.
- **The partner** — Cozy Tavern's housekeeper, for a book — sees every passage numbered as on the page (*Chapter Two, passage 3*). Ask it to change something and the change shows under its answer with **Undo** (or waits for **Apply**, as you choose in Settings): a passage (some of its words, or all of it written anew — a new version, your words one arrow away), a passage taken out, **the same words across chapters**, **a name everywhere at once** (every passage, chapter names, the notes, the book's own words — the name as a whole word, as written or in capitals; never an ordinary word like "Will"), a chapter's name or its summary, what the book is about, a card in the notes (added, brought up to date, renamed, taken out), or one of your modules' words when you ask. The same words across chapters match whole words only ("Ann" is never in "Annual"), and a name is never changed inside the name it becomes ("Oda" to "Oda Jovan" leaves "Oda Jovan" as it is) nor inside a hyphened name ("Mary" is not in "Mary-Jane"). Before it answers it can read a chapter whole, find every place some words stand, or read a module. A change that could not be made — its words not there, or there twice — is told back to it, in the same answer, so it puts it right (twice at most; every answer's changes are made); an answer that says it changed the book with no changes in it is asked once for the whole answer again, with them. Set to wait, a change that cannot land is said at once, not when you press Apply; **Edit by hand** changes its words before it goes in, and **Apply all** / **Leave all** settle every one waiting. **Undo all** puts back every change of one answer; an Undo that can put back only part (a place changed since) says so. **What it said, whole** shows an answer with its changes block. A premise it offers for the next page comes in a box of its own with **Use as the next direction**, which puts just that premise in the box under the page; an answer with no premise has none. Under each answer: **Another answer**, and **⋯** for Branch from here, What it said whole (when it made changes), What was sent, Copy and Remove; under your message, **Edit and ask again** and **⋯**. **Quick asks** (beside Send): check the notes against the book, tidy the notes, find what contradicts itself, four directions the story could go, read a character's psychology, critique the chapter open now, what the next chapter should do.
- **Conversations with the partner**, as Cozy Tavern keeps sessions: the open one is named at the top (**Conversation 1**); a tap lists the others, newest used first, to open one, and **Rename**, **Copy** or **Remove** this one (with Undo). **New** begins a fresh one and keeps this one in the list. **Branch from here**, under an answer, opens a copy up to that answer; a change copied with it stays the one it was made in, with its Undo there. **Edit and ask again**, under your message, puts your words back in the box and lets go of that message and everything after it (Undo brings them back). **Start over** empties the open conversation, with Undo; the changes it made stay in the book. Search finds words in every conversation, and opens the one they are in. The partner can go full screen.

## The checker's bubble

**The judge** grades each passage in the checker's reading — prose, people, continuity, pacing, pull, 0–10 — and a passage under your mark (9 unless you set another, Settings → Who does what) comes behind the bubble with fixes that lift it and **Write it again toward 9**. Nothing is repaired by itself: you decide, in one place. The checker also reads each passage with the story right before it, and suggests a mend where an opening doesn't carry on from the passage before.

The round bubble at the bottom right of the page is the **checker**, like Grammarly: each passage, once it's finished, is read for grammar, for wording that sounds machine-made rather than written (**Humanize**), for your **Words to avoid**, and for slips against the book and its notes (**Continuity**). **Green**: everything is checked and nothing needs changing. **Blue**: it's checking, or about to. **Yellow** with a number: suggestions waiting. **Red**: its connection is in trouble (it says why, and tries again by itself). **Grey**: nobody checks (**Settings → Who does what → The checker**).

Tap it for **Suggestions**: each one says what it would change and why, with **Apply** or **Leave it**, and **Apply all** at the top. Applying makes a new version of the passage — the words before are one arrow away — and every suggestion of one checking lands on that same version. What you leave is never offered again for that passage. A word on your list that slipped through is shown in its sentence with **Write it again**, which rewrites just that sentence without it. Writing from before the checker began, or brought in from a file, is checked only when you ask: **Check this chapter** or **Check the whole book**.

## The helper's light

The small dot on the **Notes** button is the helper: green when the notes are up to date, amber while it reads (or is about to), red when it couldn't — it tries again by itself and says why — and grey when no helper is chosen. **Undo the last reading** puts back only what that reading changed; a card you edited since stays as you left it. A chapter you name (or clear) is never renamed.

## Connections

Cozy Tavern's connection editor, field for field and in its words. **Settings → Connections → Add a connection**, start from the provider (DeepSeek, Kimi, Synthetic, OpenRouter, Z.ai, Claude, OpenAI, Gemini, Hermes Agent, or anything else that talks like OpenAI), call it something, paste the key, and pick a model from **Fetch what's on offer** or type its name. Every field says under it what it does and what is sent: **Thinking** (Not set — nothing is sent — or Off to Max, each spoken as the nearest level the address takes) and its **Thinking room**; Temperature, Top-p, Top-k, Min-p, the three penalties, **Stop text**, **Seed**; **Longest reply**; **The model's room**; the **prices** for Usage and cost; **Let it look things up** (Claude's own web search or OpenRouter's web plugin — for the pages, the partner and scenes, never the helper; what it looked at is listed under the passage).

**Start the reply for it (the prefill)**: as written — a started reply, or a thinking seed when it opens with `<think>` — or **Structured**: the model writes your opening itself, held to it by the answer's pattern, so it cannot refuse at the first word or ignore it (addresses that take JSON-schema answers; one that refuses is remembered for its model and gets the prefill as written). Structured has Cozy Tavern's **ready-made templates** (your words open every page; it plans first, unseen; it thinks in your words first; it weighs three paths) and **words it can never write** after your opening. **Keep the thinking open when a seed is sent**, **Workers riding this connection get it too**, the two field names, and **Test it**, which sends a tiny exchange with the prefill exactly as a page sends it and reads what came back. **Test** says whether thinking came back at your level (asking again at the top level when it did not, to tell the level from the address) and times one answer: how soon its first words came and how fast it writes. **Let go** removes a connection and its key.

**Usage and cost** counts every call — the writer, the helper, the checker, the partner, the narrator — as it lands, by connection and model, today, this month and everything kept, with the money from the prices you set.

What you set is exactly what is sent — temperature, top-p, thinking, the longest reply, prefill and the rest. What you leave empty is not sent at all, so the provider does what it normally does. The only thing ever raised is a floor that stops a page being cut off: a model that thinks gets room to think *and* write, and the helper gets room for its notes.

When a model refuses something (a dial it doesn't take, a request longer than it holds, a different name for the reply's length, thinking at a level it doesn't offer), the request is fitted and sent again, the lesson is kept on the connection, and the page says what was done. A page is never asked again by itself after a real failure: the reason is shown in plain words and you try again when you like.

**Who does what** chooses the writer (who also narrates scenes), the partner, the helper and the checker; the partner and helper are the writer, and the checker is the helper, unless you choose otherwise (or *Nobody — don't check*). A quick, inexpensive model is perfect for the helper and the checker. Keys stay on the phone: every call goes out through the little server.

**Presets** (top of Your instructions), as Cozy Tavern saves the storyteller's voice: **Save current preset** keeps *How you like it written*, *How the narrator tells scenes*, *How the partner talks*, both notes at the end, *Words to avoid* and your name together under a name (a Batman, a Light Yagami); **Use** puts every one of them back exactly as saved, with Undo; the one in use is marked; ⋯ saves over, renames, takes it out as a file or removes it (with Undo); **Bring a preset in** reads one back; **The starting words** puts the app's own back in every box. Whether each note at the end is sent, and the modules, stay as they are.

**Your instructions** are sent first, word for word — *How you like it written* to the writer (it starts with who the writer is: a master novelist), *How the narrator tells scenes* to the narrator (emptied, nothing of yours is sent), *How the partner talks* to the partner — like the main prompt of a SillyTavern preset; every box with starting words has **Back to the default**. **Modules** ride right after them — see below. A note at the end rides after your request, like post-history instructions — **A note at the end — the book** for the writer, **A note at the end — scenes** for the narrator of a scene you play (each empty, or its **Send it** switch off: nothing is sent, and your words wait in the box; the partner gets neither). **Words to avoid** (one to a line) are told to the writer, the narrator and the partner right after your own words, and the checker marks any that slip through. After your instructions, the book and its notes ride in the system message — or, as you choose (**The book and its notes ride as**), as your own notes in a user message or as the writer's notebook in an assistant message, as in Cozy Tavern.

Everything the app itself says is in your voice and plain words ("our novel", "I'm taking Joon's part"), never a machine's — so a writer you made Batman or Light Yagami stays Batman in its thinking — and it says once that the book is fiction for grown readers, written uncensored.

## The crafts and your modules

**Settings → Your instructions → Modules** holds what rides right after your own words. The app's come with it, made from your Simulation Engine preset as Cozy Tavern carries it: **The novel craft** for the writer (your laws turned from a roleplay into a novel — from your premise the writer writes every person, the main character too, keeps the book's point of view, and carries a rewrite's change through), **The scene craft** for the narrator of a scene you play (your character is yours alone), and Cozy Tavern's other rules — **When the scene turns intimate**, **When words won't carry it** (the contest's board, in a scene), **The sound of a voice**, and **Spectacle combat** (off until you choose). Tap one to see its words, who reads it (the writer, the narrator, your partner) and when it rides (always; when the scene turns intimate or a fight starts — it wakes by itself from your own words — what you ask for, and what you asked for or wrote last before that point (a scene break starts afresh), and in a scene where it starts and your last three moves — never from what the writer wrote; or Off). Change its words and they're yours, sent exactly; **Back to the default** (always in the module's sheet, greyed while it is as it came) puts the app's back, and **All back to the default** under the list does it for every one you changed, with Undo — your own modules stay. **Add your own module** for anything of yours.

The crafts are long (about 17,000 tokens each), so a model that holds less than your instructions and modules with room for its answer is never sent the page: it says so in plain words, naming what takes the room and the ways out that would help — lower **Longest reply** when that is what tips it, a model with more room, or a module switched off.

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
