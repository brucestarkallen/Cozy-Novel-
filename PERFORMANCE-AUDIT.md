# Room visibility follow-up — 2.10.3

The 2.10.2 reading-viewport background covered the room outside the manuscript.
That was an unwanted visual change. The backing is now an opaque, stationary
gradient limited to the page width, leaving the illustration visible around it.

Original Study also selected its picture by aspect ratio. At width 853, a
height change from 1080 to 965 and back reproduced `mobile.webp` →
`desktop.webp` → `mobile.webp`. Picture selection now uses width alone, so
height changes retain the image while folding and unfolding still change it.

The room previously stretched between all four fixed viewport edges. It now
uses `100lvh`, with a `100vh` fallback, anchored at the top. This prevents the
artwork’s size and crop following mobile browser-control height changes. A
single composited background layer separates it from shelf scrolling.

The browser walkthrough uses synthetic books and visits the home screen,
manuscript, menus, Notes, Partner, Scenes, Suggestions and Settings at narrow
and unfolded widths. `walk_room_backing.py` compares screenshots of the room
before and after a 700-pixel shelf scroll with ambient motion paused: all room
pixels match in three themes, both lights and two widths. It also checks that
the paper remains centered with visible room gutters at 360, 412 and 853 pixels.

This is actual browser rendering evidence, not proof of Android compositor
behavior. The original complaint was not reproduced in a fixed-size desktop
viewport. Android’s moving browser controls and minimize/restore GPU behavior
still require physical-device confirmation; no 120 FPS claim is made.

Checked with 47 suites: 2,138 checks passed, zero failures. The theme/foldable suite passed again after the photograph-selection fix. The visual walkthrough captured and reviewed 33 screen states at 360, 412 and 853 pixels. Synthetic temporary books and local stand-in providers only; no paid calls. Physical Android compositor restoration and 120 Hz behavior remain unverified.

## Previous follow-up — 2.10.2

The follow-up addressed visible flashing through to the room, sluggish scrolling
and returning from a minimized app. The earlier 2.10.1 measurements below remain
a record of that release, not proof that those symptoms were resolved.

- The reading viewport itself now has an opaque paper background, as Tavern's
  thread has its own background. It no longer depends solely on the tiles of a
  potentially very long inner page. Pane and sheet scrolling bodies also have
  explicit opaque backgrounds; the bars use solid theme colors. The long page's
  decorative wash is bounded to one viewport and its large shadow is removed.
- The document scroll root and inner reading surfaces use `overscroll-behavior:
  none`, preventing the browser's edge stretch/glow and scroll chaining. The
  writing view does not create an outer document scroll beside its inner one.
- Returning to the shelf reproduced cover and welcome opacity of **0** on the
  first frames. Replayed entrance fades are removed. Menus and sheets also keep
  their content opaque while their short movement remains. The room's ambient
  animation is still available.
- Notes no longer uses `content-visibility: auto` with guessed offscreen card
  heights. This trades some initial layout savings for stable real geometry
  during fast scrolling. The old cold-Notes percentage below must not be used
  as a measurement of 2.10.2. Retained cards and pane caching remain.
- Tavern's page marker caches its offsets after layout changes. Novel now does
  the same, refreshing after prose, viewport or size changes. An idle manuscript
  also stops measuring a streaming follow target on each scroll event. A
  150-passage synthetic chapter, scrolled over 120 frames after settling, went
  from **1,211 bounding-rectangle reads to 0 additional reads**. This is a work
  count, not an FPS claim.
- A keyboard-sized resize reproduced replacement of the new-scene form and
  loss of its entered name. The form and scene list now retain their elements,
  and setup fields use the existing draft journal across pane changes and
  reloads. Async loading has a visible status rather than an empty pane.
- Each narrator answer displays its saved input-token count. Provider-reported
  counts take priority; estimates say “About,” and older unrecorded counts say
  so. The count follows the selected answer and agrees with “What was sent.”

The new `walk_surface_stability.py` covers the bottom of a long chapter in all
three themes and both lights, scene setup during keyboard/foldable resizing,
scene token counts, shelf-return frames, and visibility/resync handlers.
Visibility events in a desktop browser do **not** reproduce Android reclaiming
GPU resources while an app is minimized. That device-specific return path and
120 Hz behavior still require testing on the user's phone.

Checked across all 46 suites: 2,120 distinct checks passed after affected reruns (1,094 server/application/focused checks and 1,026 Chromium browser checks). The initial run exposed three fixture issues: shelf recovery kept failing newer catch-up requests, search reload raced the sheet’s history cleanup, and the long scroll fixture unintentionally invoked the helper. The corrected shelf scenario, search suite and surface suite passed; the other extended scenarios completed successfully. Temporary books and local stand-in providers only; no paid calls. Physical Android minimize/reopen rendering and 120 Hz smoothness remain unverified.

## Earlier audit — 2.10.1

The reported stutter was most noticeable when opening menus, panes and switching
screens. The audit reproduced unnecessary work both during those interactions
and in the background behind them. The fixes keep the three rooms and their
ambient animation, and reduce the amount of work each interaction asks of the
browser.

## What changed

- Academy and Tokyo animated SVG groups were causing the full illustration to
  repaint on each frame. Their existing artwork now moves on small local HTML
  surfaces inside the SVG, preserving drawing order and clipping. The browser
  can composite those surfaces without continuously laying out and repainting
  the scene. Pause, reduced motion, hidden tabs and turning the room off still
  work. Reapplying unchanged appearance settings makes no DOM changes.
- Opening Notes, Partner or a scene used to rebuild its contents. Each book now
  keeps at most the most recent view of each tab; changing books clears those
  retained views. Individual cards and messages stay connected when their
  visible content has not changed. Hidden panes defer drawing until reopened;
  returning refreshes changed records and drafts. Timeline subscriptions are
  released when its view is left.
- The cold Notes trace identified an immediate scroll-position assignment after
  inserting the cards: it forced layout of 1,641 dirty objects inside the click
  handler. Notes now resets a changed view before altering its contents and lets
  the browser preserve the reading anchor for retained cards. Where supported,
  native `content-visibility: auto` defers offscreen card layout, remembers each
  card's measured size and keeps cards available to keyboard navigation and
  editing. Browsers without support use the ordinary layout.
- Routine manuscript saves no longer serialize all historical versions, saved
  requests and thinking to decide what to draw. Comparisons use the visible
  fields, and equal records arriving from the server retain the existing
  passages. Streaming keeps completed paragraphs and grows the unfinished text
  without replacing its nodes. Editor focus, selection and the rule that follows
  writing only until the reader scrolls away remain covered by tests.
- Independent branches retain passage and message IDs. The audit also reproduced
  live text from an original appearing in its branch while the original was
  being rewritten. Manuscript overlays now clear when changing books; Partner
  and scene overlays are keyed by their owning record as well as the turn.
  Finishing a reply elsewhere no longer redraws the visible conversation.
- The checker bubble, Suggestions, book covers, module reset buttons and shared
  labels avoid rebuilding for unrelated saves. Changes that affect the displayed
  findings and controls still invalidate their views. Timeline projections are
  reused until their evidence, order, filters or passage boundary changes.
- Search stops when its result limit is full, including before loading later
  books unnecessarily. The search sheet yields between batches, cancels stale
  queries and keeps the previous results visible while preparing replacements.
  Its folded-text cache now evicts older entries within a 16 MiB estimated
  working budget instead of retaining thousands of arbitrarily large texts and
  then discarding them all at once. A single unusually large source can still
  take longer than one batch budget to normalize.

## Focused measurements

The fixed-work checks establish these reductions independently of frame-rate
timing:

| Workload | Before | After |
| --- | --- | --- |
| Three idle seconds in Academy or Tokyo | 181 layouts, 362 paints | 0 layouts, 0 paints |
| Ten unchanged redraws of a 60-passage chapter with four versions each | 255.6 million serialized characters | No history serialization |
| Equal chapter record arriving from the server | 0 of 60 passage nodes retained | All 60 retained, with text selection |
| Twenty unrelated note-metadata saves with Suggestions open | 40 bubble mutations, 80 Suggestions-body mutations | 0 of either |
| Ten unchanged shelf refreshes | 30 list mutations; cover replaced | 0 mutations; cover and focus retained |
| Search already holding 100 allowed results, followed by 800 more passages | Later prose still searched | Later passage text never read |

Resting artwork comparisons across narrow and unfolded layouts in both light
and dark modes differed only at subpixel edges (at most 0.033% of pixels differed
by more than 12 in any RGB channel). Motion remains active in the performance
measurements; pausing the room is not required for the improvements.

## Matched interaction profile

The comparison uses the previous release (`6728f27`) and these changes in
headless Chromium 154.0.8037.57. All three themes were measured at both widths,
in dark mode with ambient movement enabled. The table gives the median of
three additional 360-pixel Academy runs at 4× CPU throttling. Each value is the
trusted `click` Event Timing duration, from that input to the next paint; it is
a diagnostic click measurement, not a site-wide INP score.

| Interaction | Before | After |
| --- | ---: | ---: |
| More menu | 56 ms | 56 ms |
| First opening Notes | 240 ms | 128 ms |
| First opening Partner | 184 ms | 192 ms |
| Returning from Partner to Notes | 208 ms | 80 ms |

Notes opening improved by about 47%, and returning by about 62%. The first
Partner opening shows no demonstrated improvement: its handler work was
essentially unchanged, and the original samples ranged from 152 to 256 ms.
The More menu's median was unchanged. These measurements do not establish
that every interaction is faster.

Across the six matched theme/width cases, idle layout events fell from 493 to
zero and idle paints from 986 to zero. The 36 incoming passage edits removed
2,880 passage containers before and none afterward. The 72 single-card updates
removed 7,200 cards before and only the 72 changed cards afterward. Every case
retained all 100 original Notes cards across a Notes → Partner → Notes round
trip; previously none returned. Mutation counts during tab switches also count
cached bodies being detached, so exact node identity was measured separately.

Partner stream startup still updates message controls: it removed 19 turn
nodes per case, down from 74. Synthetic long scrolling reduced layout events
from 994 to 450 and paint events from 4,393 to 3,105 across the six cases.
The matched runs had no browser exceptions and used exactly one local provider
call per full case, with none during the transition-only repeats.

## How to repeat the profile

`tests/browser/profile_performance.py` creates a temporary synthetic book with
80 passages, 27,840 words, 100 note cards and 36 Partner turns. It measures
trusted clicks on More, Notes and Partner, returning to Notes, scrolling,
background note updates, a local Partner stream and incoming passage edits.
The benchmark records frame gaps, long tasks, browser layout/style/paint work,
removed elements, event timings and actual retained card nodes. It is a manual
diagnostic, with no timing threshold that could fail because a machine is busy.

For comparison, unpack the previous commit outside the checkout, then run the
same script and options against both copies. `COZY_PROFILE_APP` chooses the
application directory; the benchmark script always comes from this release.

```sh
COZY_PROFILE_APP=/path/to/previous python3 tests/browser/profile_performance.py --seconds 2 --output /tmp/cozy-before.json
python3 tests/browser/profile_performance.py --seconds 2 --output /tmp/cozy-after.json
```

The default cases cover Academy, Tokyo and Original Study at 360 and 853 pixels,
with 2× device pixel ratio and 4× CPU throttling. Only the local stand-in provider
is configured. No existing books or paid providers are used.

## Regression checks

All 45 suites finished with 2,095 passing checks and zero final failures:
1,094 server/application/focused checks and 1,001 Chromium browser checks.
The new checks cover retained nodes and text selection, stream ownership across
real branches, pane drafts and updates, offscreen card editing and keyboard
navigation, checker retry settings, shelf refreshes, animation state and search
cancellation. Existing writing, notes, recovery, branching, Timeline, exports,
settings and accessibility suites also passed. Tests used temporary synthetic
books and local stand-in providers; no paid calls were made.

The full run caught an empty-subtitle cover regression at three phone widths.
Empty subtitles now stay outside the cover until needed, and all 32 cozy-layout
checks passed on rerun. The import test also exposed a synchronization race:
it asserted that the existing book remained visible before the asynchronous
shelf list had arrived. A deliberately delayed response reproduced that race;
the test now establishes the visible-book precondition before importing.
All 10 import checks passed on rerun. Initial failures were retained in the
local test logs alongside the successful final results.

## Practical limits

These are Chromium browser measurements on synthetic books. Headless Chromium
normally runs at about 60 Hz; CPU throttling does not emulate a phone's GPU,
thermal limits or power settings. The work reductions are measurable, but this
environment cannot certify 120 fps on a physical Oppo Find N5 or Galaxy Fold7.
Initial rendering still scales with the amount of visible content. The changes
remove repeated work; they do not impose a limit on the size of a real library.
