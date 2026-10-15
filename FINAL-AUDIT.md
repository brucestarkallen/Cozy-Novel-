# Final product audit, 2.9.3

This release reviews the application beyond the earlier theme, instruction and
notes work. Its priority is keeping a novel coherent, preserving the writer's
words and choices, and making scenes feel particular to their people. Confirmed
failures were reproduced before repair. Tests use temporary books and local
stand-in providers; existing books, credentials and paid models are untouched.

## Scope

| Area | Reviewed behavior |
| --- | --- |
| Writing and scenes | New prose, another take, rewrites, selected rewrites, Go on, scene openings, player agency, scene placement, conversion and custom storyteller voices. |
| Instructions | Writer, narrator, partner, crafts, triggered modules, viewpoint, tense, closing words, own-voice entries and the judge's criteria. |
| Automatic work | Changed-passage notes, chapter summaries, automatic About/Style, whole-book rereads, note audits, proofreading, comparisons, automatic fixes and bounded rewrite attempts. |
| Data | Saving, conflict replay, browser journal, removed records, whole-library restore, backup validation, safety copies, imports and complete exports. |
| Providers | Request construction, exact dials, structured output, fragmented streams, started replies, thinking separation, stop/error paths, recovery and usage reporting. |
| Interface | Shelf, book, chapters, notes, partner, scenes, checker, settings, connections, modules, search, dialogs, exports, keyboard focus, responsive layouts and reduced motion. |
| Delivery | Termux launcher, installation, legacy import, service worker, update behavior, repository history and normal fast-forward publication. |

## Writing quality

The default crafts no longer force jealousy, hostility, escalating opponents,
universal sound barriers or ignorance despite established expertise. Disagreement,
inference and conflict follow the people and the world. Existing secrets and
explicit revelation locks still hold.

Where affection belongs, the guidance makes room for remembered preferences,
shared work, private jokes, reliable presence and comfortable silence. Bonds can
grow gradually. Friendship remains meaningful in its own right; kindness does not
automatically become romance. Warmth is available without making every genre or
character sentimental. The judge recognizes credible cooperation and quiet beats.

A scene opening leaves an undecided arrival to the player. The narrator leaves
the player's decisions, feelings and private history to them unless invited.
A rewrite without a requested plot change preserves the settled events and
outcome while finding a better telling. Custom instruction boxes, edited modules,
identity words and intentional empty settings keep their exact contents.

## Reliability repairs

| Reproduced problem | Result after repair |
| --- | --- |
| A provider echoes a started reply or thinking seed across small stream chunks. | The opening appears once; an interrupted partial echo stays partial. |
| Stop leaves only thinking in the decoded answer, but a raw stream is used as prose. | An explicitly empty decoded story stays empty. Thinking remains separate. |
| A kept request shares nested content blocks with later changes. | The request snapshot is independent throughout its nested fields. |
| Old reads, saves, deletes, acknowledgements or journal recovery cross a whole-library restore. | Current clients use generation guards and response checks to keep old work out of the restored library and preserve new edits. Delayed notifications cannot rewind it. |
| Restoration fails while writing its generation; rapid restores reuse one safety-copy filename. | Failure rolls the library back; separate restores keep distinct safety copies. Invalid and duplicate backup records are refused. |
| Adding books from a backup drops unsent drafts. | Drafts accompany the imported books, with their book and scene references remapped. |
| Conversation actions replay over a different conversation or newer messages. | Actions remain attached to their conversation; destructive conflicts preserve the newer words and report failure. |
| A reply target disappears while its records are loading. | Unsent partner/scene words and narrator directions are returned. |
| An unconverted scene's anchor moves to another chapter or is removed. | Scene placement is repaired before narration or conversion. |
| Writing or export silently works around an unread chapter. | Missing chapters block the operation and produce an actionable message. |
| Multiple helper starts await the same window's lease together. | A local entry guard permits one reading run. |
| Automatic rewriting fails temporarily and remains suppressed for that version. | It becomes eligible again after a visible wait, honoring the provider's requested delay; deliberate Stop and user takeover remain respected. |
| Automatic About/Style arrives after a reread restart or conflicts with a manual correction on the phone. | Stale results are discarded; expected-before saves preserve manual corrections and mode changes even during conflict replay. |
| A quoted grading fault matches only part of a different word. | Evidence requires word boundaries where the script uses them; normal partial search and unspaced-script quotations remain available. |
| A comparison returns after Go on changes a version's text. | New comparisons are tied to the words actually compared and stale results are discarded. |
| Chapter-list updates replace the focused control. | Keyed rows preserve the actual focused control during normal saves and updates. |

Browser checks also cover persistent partner and scene drafts, conversation-specific
recovery, folded narrator directions, and drafts typed while an answer is pending.
Edit and ask again preserves existing draft words, and a clean draft follows newer
words saved in another window. The earlier [notes audit](NOTES-AUDIT.md) remains relevant to
note cards, their drafts, version readings and whole-book rebuilds.

## Verification and limits

All 32 suites passed: **1,831 checks, zero failures**.

| Verification | Passed |
| --- | ---: |
| Server, backups and API behavior | 63 |
| Full application workflow suite | 365 |
| Provider thinking parity | 348 |
| Sixteen focused instruction, craft, workflow and recovery suites | 256 |
| Thirteen Chromium browser suites | 799 |
| **Total** | **1,831** |

Thinking settings also had zero leaks across 32 connection configurations.
Browser coverage includes the main walk (75), extended walk (277), accessibility
(56), checker (27), cozy layouts (32), dialogs (48), exports (12), notes (13),
removal (15), settings (19), viewpoint (26), worlds (172) and composer drafts (27).
The commands are listed in [README.md](README.md).

The release runs also corrected test synchronization: assertions observe completed
replies, finished drawer transitions and a single shelf state during recovery.
The automatic-fix fixture now uses the same eligibility date as the real switch.
The affected checks and the complete extended browser walk passed afterward.

Browser checks use Chromium with narrow outer-screen, unfolded and desktop
viewports. All three worlds are checked in light and dark modes, including saved
preferences and reduced motion; visual review covered 18 theme, light and viewport
combinations. These are browser simulations, not tests on
physical Oppo Find N5 or Galaxy Z Fold7 hardware.

The helper and checker still need a running browser and Termux server. Temporary
faults can retry; missing credentials, unavailable storage and suspended Android
processes cannot be repaired by instructions alone. Legacy browser clients that
do not send generation headers remain compatible but do not receive the new
generation-based protection against old saves crossing a restore; current clients
send these headers.
Historical comparison records without text signatures remain compatible; newly
recorded comparisons receive the stronger protection against changed words.

The tests establish application behavior, saved state and delivered instructions.
They do not establish that every model will obey every direction, interpret every
fact correctly or produce moving prose. No paid literary benchmark was run.
The release does not claim mathematical freedom from bugs or universally perfect
writing. Model choice, story direction and the reader's judgment still matter.

## Branches and Timeline follow-up, 2.10.0

Story branches are independent books because Notes belong to a book, not to a
chapter. Passage boundaries keep the manuscript prefix. A scene branch also
keeps its conversation prefix and returns before that scene's converted prose.
The partner's separate-book action explicitly keeps the current manuscript;
it does not claim to reconstruct historical edits from an old conversation.
Cozy Tavern's branch history informed record copying, source boundaries,
checkpoint preservation, crash recovery and independent request archives.

The branch persistence checks exercise source edits and deletion, library
replacement, concurrent duplicate requests, failed record writes, interrupted
creation and startup recovery, hidden incomplete copies, and sent-history
independence. Client checks cover drafts, copied change ownership, delayed
navigation and failure messages. Conservative note rebuilding prevents later
generated knowledge from entering an earlier branch when old checkpoints
cannot prove the earlier state. Current authored premise, plans and note
fields remain the writer's chosen input.

Timeline is a view of the history behind Notes. It does not create a second
editable relationship bible or another writer-context dump. Its compact events
live on passage versions, with exact quotes and source fingerprints. Tests
exercise selection, edits, moves, deletion, restoration, strict passage
boundaries, long readings, malformed responses, attributed beliefs and stale
replies. Opening it makes no model call. Existing pages without event readings
show incomplete coverage; the existing whole-book reread can backfill them.
Played scenes enter manuscript history once converted into selected prose.

Backup-import tests reproduce literal IDs being replaced inside authored prose
by the former whole-JSON text replacement. Structured address remapping now
preserves those words, draft spacing, saved requests, reading signatures and
Timeline evidence, while importing related branches into their own family.

Chromium checks cover branch isolation, family navigation and naming, scene
and partner semantics, Timeline filters and source links, keyboard focus, Back,
and narrow/unfolded layouts. Temporary synthetic books and local stand-ins
only are used. Browser dimensions approximate foldable layouts; actual Oppo
Find N5 and Galaxy Fold7 hardware was not available. Exact evidence validates
where a Timeline event came from; its interpretation still depends on the
chosen model and can be checked against the displayed quote.

The broad application run exposed two small-context regressions after adding
Timeline instructions. The helper now measures actual fixed request words and
source wrappers instead of stacking guessed allowances. The original tests
pass at the same 6,000-token context, with request-plus-reply bounds checked.

Final follow-up validation: **39 suites, 1,974 passed, zero final failures**
(1,089 server/application/focused checks; 885 Chromium browser checks). The
full application suite passed 365/365 after the sizing repair; the extended
browser walkthrough passed 277/277. Focused branch browser tests passed 49/49
on the final restore guard, including lost acknowledgements followed by
reload, retained intervening edits, and destination deletion after commit.
