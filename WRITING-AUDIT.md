# Writing and automatic-workflow audit

This audit covers the instructions and request assembly for writing, another take,
rewrites, selected-text rewrites, Go on, scene narration and conversion, ideas,
the partner and its changes, notes, chapter summaries, automatic book descriptions,
the notes auditor, proofreading, grading, comparisons and automatic improvements.
It also reviews saving, interrupted work, provider adaptation and update recovery.

## Point of view and tense

**About this book → Point of view & tense** offers first person, second person,
close third person and omniscient third person, with past or present tense.
**Follow the book** preserves the previous behavior: explicit instructions and
the established telling guide the prose. Other arrangements, such as alternating
narrators or future tense, can still be described in **How it reads**.

The choices reach the writer, narrator, partner, checker, comparisons and the
helper. Specific written instructions take priority; otherwise selected choices
take priority over an older passage or the helper's inferred style. They guide
new writing and do not rewrite existing pages. In Scenes, choosing first or
second person still leaves the player's decisions, speech and feelings to them.
Summaries remain factual reference prose, identifying the people behind “I” or
“you” without inventing an identity.

## What runs by itself

| Feature | Trigger and recovery | Deliberate boundary |
| --- | --- | --- |
| Notes | After writing or changing the book, and on opening it; version-specific readings settle changes, then unread changes are read. | Needs a helper connection. User-written fields are protected. |
| Chapter summaries and names | A chapter is summarized after moving past it, or after ten quiet minutes on the last chapter. Changed chapters become due again; matching saved summaries can be restored with a version. | User-named chapters stay named. Dense chapters may need several requests. |
| Automatic “What it's about” and “How it reads” | The helper derives them from the book and refreshes them as readings change it. | Manual mode and user corrections remain authoritative. |
| Notes audit | Every few readings, on explicit request, and for older notes that have not been audited. Large note sets are checked in groups. | An omitted detail in an excerpt is not proof it is false. |
| Checker and judge | Finished eligible passages are checked; evidence supports failures. A malformed grade gets a bounded repair attempt. | Imported and older writing is checked on request. Missing answers are not passes. |
| Apply fixes automatically | Only when its switch is on; small fixes create a version and are checked again. | Manual version choices, left suggestions and active edits are respected. |
| Rewrite below the target automatically | Only when its switch is on; bounded attempts, then the best graded take. | No unlimited rewrite loop; work yields to the user's writing. |
| The chapter read whole (2.12.33) | Once every passage of a chapter is checked and the chapter has ended, he asked, or it grew 4,000 words since its last read, the checker reads it start to end for where people and things are, who knows what, words said again, time and seams — in parts its model holds. Its fixes join each passage's suggestions; a continuity or seam fix quoting words of the story before it that stand there goes in by itself as any small fix. | Never what happens: the later words put right to the earlier, smallest fix. Read again only when the words change (not for its own fixes), ten minutes after the last at the soonest, six a day at most unless asked; never over a fix already there or one he left; a model that will not read it is let be after two tries until the words change. |
| Super automatic (2.12.28) | One switch in Who does what: What it's about and How it reads Automatic, the bibliography filled from the book, Smart recall on, the checker checking even with Nobody chosen (from when the switch went on), its fixes applied by themselves, the partner's changes at once, and the chapters ended by the writer — a page that ends its chapter is kept with `closes`, and the next page (Write, Add as my words, a scene from there) opens the next chapter. | His own switches are never changed and return when it is off; a passage under the mark is never rewritten by it, nor the mark set; his cards keep his words (the notes' check puts right only what the book contradicts, quoted); a chapter never ends on its opening page, between two passages or on a page cut short. |
| Temporary helper/checker failures | Retry after one, three, then ten minutes, respecting a longer provider delay. “Try again now” is available. | Invalid credentials or permanent connection failures stop the loop until corrected. Repeatedly unreadable material is reported as set aside. |
| Multiple browsers | Renewable book leases allow one helper and checker per book; lost ownership blocks writes. | A suspended browser must regain ownership. |
| Provider compatibility | Supported adaptations handle rejected options, context size, structured output and connection contention. | A failed user-requested page is not blindly regenerated. |
| Interrupted writing | Abandoned streaming markers are repaired when a book opens and during periodic checks; saved partial prose remains available. | “Go on” is a user action, with the original request preserved. |
| Saving and restoration | Unsaved changes retry, journal locally, and replay over newer saves; backups, earlier copies and Recently deleted remain available. | The device must become reachable; storage and credentials must work. |
| Updates | The server waits for active calls before restarting; the page waits for a quiet moment before reloading. | Browser drafts, dialogs and active work delay a page refresh. |

The helper and checker run in the browser, not as independent server workers.
Android can suspend or close that browser; model work then waits until the app
can run again. Termux must be running for requests and saves to reach the server.

## Changes made during this audit

- Reject a delayed summary when the chapter or its summary changed while the
  request was running. Keep repaired summaries in the version cache. Use current
  chapter excerpts instead of sending an obsolete summary as current facts.
- Split oversized individual paragraphs, including unspaced text, for helper
  reading and summaries. Read long old and replacement versions in bounded
  parts; roll back an unfinished reading instead of keeping half a correction.
- Require complete, intelligible grading answers. A long passage is not fully
  graded when one of its parts has no complete grade.
- Respect a changed helper/checker choice before sending further automatic work.
- Cancel an in-flight automatic rewrite when its switch is turned off. Stopping
  a background rewrite preserves a different version selected during its request.
- Keep scenes at their original insertion point, including an empty chapter or
  a scene break. Prevent a removed conversation reply from applying late changes.
- Refuse a late whole-field partner replacement when those words changed while
  the reply was running. Protect custom instructions, modules, summaries, names,
  notes and passages while retaining exact quoted edits and intentional follow-ups.
- Preserve the generating instructions through edits and fixes. “Go on” keeps
  rewrite directions and the played scene's transcript instead of inventing a
  new outcome after a cut-off conversion.
- *(2.11.1: the crafts are his V177 laws again; the point-of-view laws below are
  kept beside them — HISTORY.md, 2.11.1.)* Reconcile the default crafts with first, second, limited third and omniscient
  narration. Remove conflicting quotas and blanket stylistic prohibitions that
  flatten lyrical, quiet, comic or reflective writing. Preserve chosen voice,
  continuity, character knowledge and scene agency.
- Make partner guidance honest about excerpts and missing pages. Keep belief,
  uncertainty, dreams and flashbacks distinct from established events in notes
  and summaries. Judge the requested style instead of assuming one house style.
- Preserve supplied instruction/module whitespace. Handle malformed provider
  content blocks and avoid mistaking nested structured metadata for story text.

Untouched former starting instructions adopt the viewpoint-aware defaults. Custom
instructions and edited modules remain the user's words. Improved built-in
modules apply where their text has not been customized; **Back to the default**
is available for intentionally adopting the updated text in an edited module.

## Evidence and limits

The 2.9.3 whole-product follow-up is recorded in [FINAL-AUDIT.md](FINAL-AUDIT.md).
It resolves remaining forced-conflict rules, gives grounded warmth and friendship
room to develop, protects scene agency and settled rewrite events, and covers
streamed openings, conversation ownership, persistent composer drafts, restoration
races, automatic retries, manual-description protection and comparison freshness.

The 2.9.2 notes follow-up is documented in [NOTES-AUDIT.md](NOTES-AUDIT.md).
It covers missing chapters, stale audit replies, malformed lists, duplicate-row
merges, concurrent aliases and removals, field-specific saves, durable note drafts
and the complete-note boundary during a whole-book reread. Source problems are
reproduced with temporary books and local stand-ins before their repairs.
Version 2.9.2 passed **1,228 checks**, including all five required suites, 17
focused notes-integrity checks, 20 helper-reliability checks, and 13 browser
checks for note edits, save conflicts and reload recovery. The full count is
recorded in the notes audit.

*(2.11.1: the persona checks stand; the softened crafts this paragraph describes are his V177 laws again — HISTORY.md, 2.11.1.)* The 2.9.1 persona follow-up checks writer, scene and partner identities separately,
including rewrites, continuation, scene conversion, partner follow-ups and visible
thinking. App-added wording asks for the voice and humour described in the user's
instructions without assigning another identity. Default crafts allow deliberate
grammar, comedy and alternate versions of familiar characters, and no longer
require a fixed mental checklist or numeric contest procedure.
Remaining robot/model terminology and artificial identity labels in those defaults
are replaced with ordinary writing language. This is an edit to built-in guidance,
not a filter on custom instructions, stories, or the thoughts a provider returns.

A connection's prefill remains shared and literal. Separate instruction boxes and
purpose-specific **Words in the storyteller's own voice** provide distinct voices
for the writer and narrator. Optional structured thinking templates keep the form
the user explicitly selected; a normal request adds no such form. Ready-made
templates preserve literal names and report reserved marks that would change how
the template works. Request tests check delivery and retained words, not whether a
live model is funny or whether its private reasoning follows a prescribed voice.

Deletion checks also reproduce a late save from the same window after a book's
children have been removed, and a failed deletion discarding pending edits.
Removal now freezes the book and its open child records, saves pending work
before deleting, and keeps records editable if deletion fails. Restoring a book
refreshes watched records even after missed news. Failed chapter or scene removal
keeps its entry in the book. The server still protects against an already-sent
save from another window arriving after deletion.

Regression tests use synthetic books, the actual application modules and server,
Chromium, and scripted local providers. They check saved state and outgoing
requests, including delayed responses, missing grades, changed worker choices,
scene placement, request inheritance and viewpoint persistence. The ordinary
server, app, thinking and browser suites remain required.

Version 2.9.1 passed **1,262 checks** on the final implementation: server 63,
application 365, thinking/provider parity 348, main browser walk 75 and extended
browser walk 277; instruction delivery 33, crafts and module routing 63, provider
edges 7, literal prefill words 6, custom storytelling request paths 4, store removal
and restoration 6, and browser removal/failure/retry flows 15. All completed with
zero failures. The browser suite also verifies the updated narrator defaults,
reset/save behavior and migration with exact expected words.

Version 2.9.0 passed **1,300 checks**:

| Suite | Passed |
| --- | ---: |
| Server | 63 |
| Application | 365 |
| Thinking/provider parity | 348 |
| Main browser walk | 75 |
| Extended browser walk | 277 |
| Viewpoint and phone layouts | 26 |
| Instruction delivery and migration | 33 |
| Crafts and module routing | 55 |
| Helper and summary reliability | 20 |
| Checker and automatic-write boundaries | 14 |
| Malformed provider responses | 7 |
| Writing, scenes and concurrent partner changes | 17 |

These checks establish application behavior and instruction delivery. They do not
prove that every model will obey every instruction or that prose is objectively
perfect. No paid provider was called and no live literary-quality benchmark was
run. A stronger model and the book's own specific direction still matter.
