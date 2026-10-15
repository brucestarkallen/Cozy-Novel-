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
- Reconcile the default crafts with first, second, limited third and omniscient
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

Regression tests use synthetic books, the actual application modules and server,
Chromium, and scripted local providers. They check saved state and outgoing
requests, including delayed responses, missing grades, changed worker choices,
scene placement, request inheritance and viewpoint persistence. The ordinary
server, app, thinking and browser suites remain required.

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
