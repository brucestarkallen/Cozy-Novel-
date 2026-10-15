# Notes audit, 2.9.2

The notes have several layers of protection, but generated facts still need a
model to read and understand the book. This audit tests the application's
behavior; it does not claim that every model will interpret every scene correctly.

## How the notes work

The helper reads finished passages and changes to earlier writing. It keeps
People, Places, things worth remembering, and Threads. A person's enduring
description is separate from their relationships and current location. Secrets,
beliefs, plans, dreams and flashbacks are supposed to remain identified as such.
The writer receives the notes with instructions that the actual passages take
priority wherever newer writing has not been read into them yet.

A reading keeps the passage version it read and the before/after cards it
changed. Switching versions can restore those changes without another request
when they still fit. Changes further back are read with both the old and new
words, preserving later readings and manual corrections. Put back, Read again,
and Undo the last reading provide different ways to undo or repeat that work.

Every six readings, and when requested, the helper checks the notes against the
current book. Older unaudited notes are checked on opening. Large note sets are
checked in groups, with one accumulated report and Undo. The check can correct
facts, merge duplicates, and resolve threads. Protected fields on manually
edited cards stay protected. Mechanical checks prevent unsupported names and
figures being introduced by the audit, but cannot prove every sentence true.

A whole-book reread builds replacement notes while the writer continues with
the last complete set. Explicit manual corrections take effect during that
rebuild. Partial automatic descriptions do not replace the complete ones. Undo
of the reread preserves manual corrections made since it started.

## Confirmed problems and repairs

| Problem reproduced | Behavior after repair |
| --- | --- |
| A missing chapter answered `null`, allowing the helper to continue as if it were empty. | Missing chapters stop the work, leave the notes intact and show a retrying failure. They never count as finished work. |
| An audit accepted an old reply after a passage or chapter was added, the order changed, or notes/premise were edited. | The reply is discarded and a fresh check remains due. The ordered book and note inputs are compared by value. |
| Malformed note lists or null rows could be accepted as a completed reading; an empty verdict could appear to pass an audit. | Invalid shapes receive the existing bounded JSON repair. A check needs an explicit yes before reporting the notes clear. An explicit empty change object remains a valid ordinary reading. |
| Later rows of one answer were mistaken for edits made while waiting, losing useful details on an existing or newly created card. | Rows are compared with the notes at the start of the fold. Fuller descriptions can be kept while conflicting current locations keep the first answer and report the conflict. |
| A stale reply could restore an alias just removed, or delete a card changed since the request. | Changed aliases and cards are preserved. Refused removals are reported. |
| A card saved from one window could overwrite untouched fields changed in another window. | Hand edits and direct partner edits replay only the fields they wrote over the newer saved record. |
| A delayed save could recreate a card removed in another window. | An existing card stays removed; the editor retains the typed correction for Add. |
| Unsaved note-editor text survived Back only in the page's memory. | Drafts use the book's existing device-saved draft record and save journal. Reloading recovers the words without applying them to the card. Add also recovers drafts whose cards were removed while the editor was closed. Acknowledged saves clear their own draft. |
| A reread exposed partially rebuilt automatic descriptions and held back explicit manual corrections. | Automatic text stays at the last complete version; manual card edits/removals and corrected automatic text remain visible to the writer. |

## Automatic recovery and boundaries

- Temporary request failures retry after one, three, then ten minutes, respecting
  a longer provider delay. Try again now can retry immediately.
- Invalid credentials and permanent connection failures wait for a corrected
  connection. A repeatedly unreadable part is set aside visibly, with Read it
  again, rather than being silently treated as understood.
- One renewable lease per book prevents competing helper runs. Lost ownership
  blocks results. Interrupted multipart readings are rolled back and restarted.
- Summaries reject replies to changed chapters and preserve version caches.
  Current user summaries and manually named chapters are protected.
- Saving, earlier copies, whole-library backups and Recently deleted also cover
  the existing draft records, including note-editor drafts.

The helper runs in the browser. Termux and a usable connection are needed, and
Android can suspend browser work until the app is active again. Already-saved
cards and drafts remain on the device. A successful check is evidence of what
the helper read at that time, not a guarantee about later writing or every
possible interpretation of a scene.

## Verification

`tests/notes_integrity.mjs` checks delayed audits, malformed replies, missing
chapters, alias conflicts, card removal, duplicate rows, partner edits across
save conflicts, and whole-book reread visibility through the actual modules,
server and a local scripted provider.

`tests/browser/walk_notes.py` forces real save conflicts in Chromium and checks
the edited fields, preserved remote facts, removed cards, recovered words,
drafts across reloads, and clearing a draft only after a successful save. It
makes no model calls. The existing helper reliability suite and all five
required server/application/thinking/browser suites are also run for this release.

Final release checks: **1,228 passed, zero failures**.

| Suite | Passed |
| --- | ---: |
| Server | 63 |
| Application | 365 |
| Thinking/provider parity | 348 |
| Main browser walk | 75 |
| Extended browser walk | 277 |
| Helper and summary reliability | 20 |
| Notes integrity | 17 |
| Note editing and reload recovery in Chromium | 13 |
| Instruction delivery | 33 |
| Writing, scenes and concurrent partner changes | 17 |

All data was synthetic and all providers were local stand-ins. No paid model was
called. These checks verify the application's behavior and delivered requests,
not the factual accuracy of a live model's interpretation of a particular book.
