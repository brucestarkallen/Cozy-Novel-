# Audit 2.12.42

What was checked for the release after 2.12.41 (`188bcdf`), and how to run each claim again. The commit that holds the fixes is the 2.12.42 commit on `main`.

## The brief

| Item | Disposition |
|---|---|
| Task 0, helper stages (rounds 6–8) | Reviewed. No new bug that writes the wrong words, loses his words, or loops. `stageCount` stays an absolute count on purpose (B5). |
| Task 0, premises and names (rounds 5 and 5b) | Reviewed the rename and `whose` paths the new Undo and Quick add ride on. No new bug found. Not every line of `bookEvidence` was re-proved with a new test; the existing suite still holds those. |
| Task 0, Quick add round 5 | Reviewed with B7. `splitSentences` was already the Quick add split. |
| Task 0, the store sweep | The new steps from this release return false when they cannot lay, and write only the field they own. See B5. |
| B1 silent automatic rewrite | Fixed. |
| B2 a change says made when it did not land | Fixed. |
| B3 two entries of one name | Fixed. |
| B4 rename Undo leaves a remade page | Fixed. |
| B5 new save steps | Checked. Checker counts compare-and-set. `stageCount` left absolute, and why. |
| B6 counts that overstate | The sentence count is fixed. Undo’s “n put back” is left, and why. |
| B7 Quick add and renames | Fixed. |
| B8 partner sentences split at “Dr.” | Fixed. |
| B9 several passages refused together | Left. It never loops, and making them continue inside the same look is not a small change. |
| A1–A12 | Walked as far as the code and the suites go. See below. |

## Fixes

### B1. A silent writer, asked again for ever

Before: with Write it again by itself on, or a sentence written again by itself, a writer that sent nothing came back as an ordinary miss. The checker waited one minute, then three, then ten, and asked again every ten minutes. It never counted toward letting that page or sentence be.

After: that rewrite is waited the way a helper’s or a checker’s ask is. The stall comes back with how long it was waited. It is counted on the version (`v.tries.lift` or `v.tries.span`). At the second counted stall that page or sentence is let be. His own Write, Rewrite or Go on is not held, and still goes out.

Test: `a silent writer on a page or a sentence written again by itself is asked, waited, counted and let be at the second — never a third time; his own Write it again still goes out`.

Mutation: the guard `out.leashed || out.refused` in `afterAutomatic` taken out. The test failed, AssertionError, “waited as long as it was waited”. The guard was put back. Re-run after `writer.js` changed again: passed.

The wait itself: `leash` forced off on an automatic rewrite (`leash: false` where an automatic job passes `leash: Boolean(job.auto)`). The test `how long the phone waits on a silent provider` failed, AssertionError, “written again by itself: three minutes past its leash”. The leash was put back. That is the code the suite below ran. An older wording of that test still expected the ten-minute background wait. The first full run of the suite failed on that one line (799 passed, 1 failed). The expectation was the bug. It now expects three minutes past the quiet leash, and the suite was run again.

### B2. “Made” when the change did not land

Before: after another window saved first, a change to a plan, a summary, a chapter’s name, the book’s words, a module, an entry or a card could fail to land, and the card still said made. Page words were the only kind `madeGone` understood, and only by exact words.

After: each of those is laid again where its own words still stand (`relayedOn`: the stretch of the change, a few words either side, the way a page already was). Where they do not stand, the card and the Quick add row say it no longer reads that way. Undo still uses the exact steps. His newer typing on a card is still his.

Input that lands: plan was “She waits at the gate. The rain has come.”, the change makes “She waits by the lamp at the gate. The rain has come.”, the other window has “She waits at the gate. The rain has come. He knows the house.” The phone keeps his extra sentence and takes “by the lamp”.

Input that does not land: the plan is now “Night fell on the road.” The old stretch is not there. His plan stays. The row says the plan no longer reads that way.

The old heir case still holds: “The heir.” made “The heir of the line.” is not laid onto “The heir, and he knows it.” His about stays.

Test: `a change to a plan, a summary, a chapter’s name, the book’s words, an entry or a card, laid again over another window`.

Mutation: `relayedOn` made to return null at once. The test failed, AssertionError: the plan stayed “She waits at the gate. The rain has come.” The function was put back.

### B3. Two entries of one name

Before: a new entry laid again looked up by id only. Another window’s entry of the same name has another id, so a second entry was made.

After: looked up as the bibliography looks an entry up, by name and kind. The same kind gets the new words after the words already there, and only when they are not already in it. Another kind stays two entries.

Test: `a new entry laid again over another window’s entry of the same name`.

Mutation: the merge taken out, so a new entry was always added. The test failed, AssertionError, 2 !== 1. The merge was put back.

### B4. Undo of a rename left one page renamed

Before: a rename that landed on words another window had just typed remade that page (the new name, the other window’s words kept as the words before). Undo looked for this window’s own “after” text, did not find it, and left the new name on that page only.

After: a version the rename made, still reading as that same rename of the words kept before it, gets those words put back. A page edited again after the rename does not read that way, and stays.

Test: `the Undo of a name changed everywhere puts back a page it remade over another window’s words`.

Mutation: the second look (`vNow && keptWords && …`) forced false. The test failed, AssertionError, the page was not put back (“everything it changed has been changed again since”). The look was put back.

### B5. Save steps laid again

Checked the steps added after the sweep, and the ones this release adds.

- `triedCount`, `triedDone`, `autoCount`, `autoDone`, `wholeCount`, `duelCount`: each writes only when the copy still holds the exact count it was worked out from. A newer count from another window is left.
- `setSilent`: writes only this connection’s wait, and only while that wait still reads as it was found. His press in another window is not written over.
- `keptRowStep`: writes one record of what was kept, only while the version and that record still read as they did.
- The new lays (plan, summary, name, book field, module, entry, card, the rename’s second Undo, the sentence count) return false when they cannot lay, and do not write a whole record worked out here.
- `stageCount` writes an absolute number, closed over from this window, on purpose: a step played again after the phone already took it must not add one more (the comment on `stageCount`). Two windows counting the same stall before either save lands can leave the lower number, so a stage let be in one window can be asked once more. It does not loop: a replay never adds, and each window still stops at two. It was left so, rather than change the stall count without a test that two windows both run the helper.

### B6. Counts

The sentence written again by itself is counted only when that sentence is in the version’s words after the step is laid again. Another window’s page that no longer holds the sentence is not counted.

Test: `a sentence written again by itself is counted only when that sentence lands`. The page grew in the other window while the sentence was written (“The harbour smelled of tar. The rain fell.”), so the lay is the changed-meanwhile path. Before that save landed, the other window set the page to “The harbour smelled of smoke.”

Mutation: the `includes(sentence)` check taken out. The test failed, AssertionError, 1 !== 0, message “not counted when the sentence never landed”. The check was put back. Passed.

Left: Undo’s “n put back”, and the notes’ check’s record of what it changed, are worked out in this window before the phone answers. A step that then is not laid was still counted. Making Undo wait for the phone would change when the toast is said, and the local answer would still be the one this window saw. It is said here rather than made less honest a different way.

### B7. Quick add and a rename

A new Quick add row keeps the book’s rename count. The next request, and whether “keep mine” is the same words, carry his words through the renames since that row. Ask again puts those carried words back in the box. The row on the screen still shows what he typed. A row from before this, with no count, stays as he typed it: the book cannot say which renames came after it.

Test: `Quick add keeps the rename count of the row`. He said “Tom keeps a new watch.” The book renamed Tom to Thomas. The stored row still says Tom. Ask again would put Thomas in the box. The next request says “Thomas keeps a new watch.” and not Tom. Keep mine still matches.

Mutations, both restored:

- `wordsAgain` returned the words as typed. AssertionError: actual “Tom keeps a new watch.”, expected “Thomas keeps a new watch.”
- `carriedQuick` returned the row unchanged. AssertionError: the request did not match `/I said: “Thomas keeps a new watch\./`.

### B8. “Dr.” is not the end of the partner’s sentence

`claimsChange` split on a raw stop, so “Dr.” ended a sentence and the words after it could be read as a change the partner only mentioned. It now uses `splitSentences`, the same split as every other place that decides a sentence. What counts as a claim is unchanged.

Test: the existing `a change claimed only in words`, with “Dr. Updated the notes, and I left them.” (not a claim) and “Dr. Smith’s card has been updated.” (a claim). The first wording tried, with “yesterday” in it, stayed “not a claim” even with the raw split, because “yesterday” already keeps a sentence from counting. That sentence would not have proved the fix, so it was replaced with one that does.

Mutation: the raw split put back. AssertionError: “Dr. Updated the notes, and I left them.” was true, expected false. `splitSentences` put back. Passed.

### B9. Left

A group of passages the model refuses together still ends that look for about a second and a half, then each is asked alone. It does not loop. Continuing them inside the same look means restructuring the look. That is not a small change, so it was left.

## Areas

| Area | What was checked | Result |
|---|---|---|
| A1 Writing a page | `runVersion` still returns the stall fields only as a stall, and a passing fault only when there is no leash. His own Write does not pass `leash`. The sentence count does not run for his own Rewrite of selected words (`auto` is false). Settings are not set here. | No new bug. The silent-writer test and the sentence-count test hold the new paths. |
| A2 The helper | `stallRule`, `setSilent`, `hisPress`, `stageCount` / `stageDone` / `stageStalled`. A silent model is one wait per connection. His press clears it. | No new loop. `stageCount` as in B5. |
| A3 Timeline and facts | Not rewritten this release. Renames still go through `renamesSince`. The timeline suite passed (13). | Nothing found to change. |
| A4 Checker | `afterAutomatic` uses the same stall rule as the helper. A stall is not a passing fault. Counts compare-and-set. | Held by the silent-writer test. |
| A5 Partner | `madeGone` on every kind of change the card can show. `claimsChange` via `splitSentences`. Rename Undo’s second look. Apply still waits when he set it to wait; that path was not weakened. | Held by the relay, entry, rename and claims tests. |
| A6 Quick add | `renameCount`, `carriedQuick`, `wordsAgain`, and the same `madeGone` on a book change and an added entry. | Held by the Quick add test. |
| A7 Premises, entries, whose | Card fields re-lay with `relayedOn` and skip a field that cannot be laid. `hisSince` still drops a field he typed newer. Undo of a note stays exact. `whose` was not given a new writer. | The heir test and “none is written over them” still pass: a stretch that is not in the newer words is not laid. |
| A8 Saving | New steps return false when the copy no longer reads as they found it. A false return is still queued; the condition is the compare when it is played again. A save the phone took is still taken off the list before the rest replay. That path was not changed. | See B5. |
| A9 Scenes | `renamesAt` still carries a telling through renames made while it was out. No new step writes a scene’s words from this window’s older copy. | Nothing found to change. The scene Undo test already in the suite still stands. |
| A10 Settings and Test | A stall is not reported as “Not working”. The leash fields are added, not a dial he did not set. Test was not retimed here. | Nothing found to change. |
| A11 The screen | A made change whose words are gone says “made, but …” with the same mark. Quick add’s Ask again refills the carried words; the row shows what he typed. No new control. | Not clicked through on a phone. The walks that ran are below. |
| A12 Docs | README, AGENTS and HISTORY updated to what the code does now. The helper’s reading request was hashed again. | md5 `8c1953420ccbe468b7053cd5f8cfae81`, the same at `188bcdf` and on this tree. |

## Left, and why

- Undo’s “n put back”, and the notes’ check’s count of what it changed, are this window’s count before the phone answers (B6).
- Quick add rows made before 2.12.42 have no rename count. They stay as typed.
- `stageCount` is an absolute count so a replay does not add one more (B5).
- Several passages refused together pause the look for about a second and a half (B9).
- The phone keeps the last 30 saves of a record. Past that, a lost answer can be played again. Unchanged.
- An old one-page name swap from before 2.12.41 can still look like a rename everywhere where the book cannot tell them apart. Unchanged.
- A tab hidden past three minutes of late timers was not confirmed. There is no phone browser here.

## The final run

On the code committed as 2.12.42. The node suites and the Python tests ran on this product code before the one test assertion above was reworded; that rewording does not change the product. The app suite below includes it.

| Run | Result |
|---|---|
| `node tests/app.mjs` (the whole suite) | 800 passed, 0 failed |
| checker_edges | 14 passed, 0 failed |
| instructions | 37 passed, 0 failed |
| craft | 179 passed |
| personas | 4 passed, 0 failed |
| workflows | 17 passed, 0 failed |
| final_workflows | 19 passed, 0 failed |
| notes_integrity | 24 passed, 0 failed |
| branches | 19 passed, 0 failed |
| archivist_reliability | 20 passed, 0 failed |
| timeline | 13 passed |
| automation_integrity | 15 passed, 0 failed |
| stream_integrity | 6 passed, 0 failed |
| thinking | 348 of 348 |
| prefill_words | 6 passed, 0 failed |
| provider_edges | 7 passed, 0 failed |
| branch_imports | 7 passed |
| storage_integrity | 12 passed, 0 failed |
| store_removal | 6 passed, 0 failed |
| search_integrity | 4 passed, 0 failed |
| search_performance | 5 passed, 0 failed |
| textshape_fuzz | 4 passed, 0 failed |
| `python3 tests/server.py` | 89 passed, 0 failed |
| `python3 tests/backup_integrity.py` | 3 passed, 0 failed |
| `python3 tests/branch_storage.py` | 11 tests, OK |
| bibliography, branch imports, branches, checks, composer drafts, exports, main, more, notes, overlap, desk / pane / search / world performance, quick add, reading colours, removal, room backing, settings, story map, summaries, surface stability, timeline, update performance, viewpoint, worlds | passed, same counts as 2.12.41 (44, 13, 49, 54, 27, 12, 81, 312, 17, 184, 21, 24, 13, 38, 60, 47, 24, 18, 26, 24, 17, 25, 35, 25, 26, 185) |
| accessibility | 48 passed, 1 failed. Same failure on `188bcdf`: the browser refused to resize a window it had taken full screen. Not this release. |
| cozy | 31 passed, 1 failed. Same on `188bcdf`: a long title at 412px. Not this release. No CSS was changed. |
| dialogs | 47 passed, 1 failed. Same on `188bcdf`: Begin a book, the sheet was not in the page in the same moment. Not this release. |
| helper reading request | md5 `8c1953420ccbe468b7053cd5f8cfae81` on this tree and on `188bcdf` |

## What was not checked, and why

- A real model: not run. The suites use the scripted stand-in.
- A phone’s own browser: none here. A tab hidden past three minutes of late timers was not confirmed for that reason.
- `profile_performance.py`: a profiler, with nothing to pass or fail. Not run.
- The three walks above fail the same way on the already-pushed 2.12.41. They were not treated as this release’s bugs, and no walk or style sheet was edited to hide them.

