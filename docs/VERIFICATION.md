# Verification evidence and limits

Status: VERIFIED for the synthetic contracts below. Live literary quality and real account compatibility remain unverified. A passing test is not a guarantee of perfect continuity or an error free application.

## Environment

Executed in an isolated Linux workspace with Python 3.12.14, Node 24.19.0, Playwright 1.62.1 and headless Chromium 153.0.8010.0. Runtime code requires Python 3.11 or newer, but Python 3.11 itself was not executed. Prettier 3.6.2 was a development formatting tool only.

The normal Playwright browser CDN returned an unavailable HTML page instead of an archive. A local @sparticuz/chromium 153.0.0 development package supplied the executable used by Playwright. This changed no product dependency or system package. Screenshots were inspected at 1440 by 1000 and 390 by 844 CSS pixels. There was no physical Android, foldable, Termux, Safari, Firefox or Windows execution.

## Actual checks

`node --test tests/unit/*.test.js`: 18 tests passed. Coverage includes exact backup references, rejection of cyclic revision ancestry, explicit knowledge ownership and suspicion, later learning, flashback eligibility, scoped author corrections, within scene revelation boundaries, mandatory context overflow, large budgets, all stream dialects, split UTF8, comments, empty and usage only events, refusal, midstream errors, malformed completion, disconnect, abort, output limit preservation, parameter gating, foreign cache isolation and failed shell installation.

`python -m unittest discover -s tests/server -v`: 10 tests passed. Coverage includes device conflict preservation, idempotent lost acknowledgement replay, old generation rejection, transactional restore with a readable recovery snapshot, corrupt and foreign backup rejection, immutable revisions, source ownership, temporary directory containment, Host and Origin checks, mutation tokens, JSON content types, traversal rejection, forbidden relay destinations, separate secret storage, source directory protection and installer ownership.

The server suite exercised all four adapter request shapes through the real local HTTP relay and a deterministic local synthetic provider. It did not contact a real model account.

`node tests/browser/journey.mjs`: 25 contract groups passed in Chromium. The actual UI created a novel, configured a local mock connection, streamed and accepted the café passage, used a suggestion, followed a custom ice cream direction, entered Quick RP as B, switched to C without adding a turn, kept events without inserting prose, adapted them and accepted the prose without duplicate events. Reopening preserved text, revisions, state and provenance.

Additional browser checks proved exact preservation of an unselected Unicode prefix and suffix, stale candidate rejection after editing during a stream, later revision recovery after restoring an old version, exact portable backup roundtrip, rejection of corrupt and RP backups without changing existing records, inert rendering of malicious HTML, persistence of foreign sentinel storage, no horizontal overflow in the phone viewport, draft preservation across panels, synthetic composition input, real SQLite acknowledgements and offline reopening.

Domain contracts ran against real browser IndexedDB, including alternate candidates, a context snapshot whose scene changed before candidate creation, entity profile history, retry branches, recovery of earlier exploration turns, exclusion of discarded exploration and ignored suggestions from ordinary context, stale derived memories, late analysis, no automatic biography audit, imported copy ownership, rejected old generation writes, rejected cross novel writes, atomic movement between chapter orders, partial RP response checkpoints and interrupted job recovery without automatic retries.

Browser evidence is in [the browser report](evidence/browser-report.json) and [the contract report](evidence/contract-report.json). Visual evidence is [desktop](evidence/studio-desktop.png) and [phone](evidence/studio-phone.png). The pictured prose is deliberately synthetic test data, not evidence of literary quality.

## Measured observations

The context fixture held 3,069,090 characters across 101 scenes, including an important old conditional umbrella promise and irrelevant recent descriptions. With no forced pins, both 200000 and 500000 token configurations selected eight source identities and approximately 999 serialized input tokens. Assembly took 40 ms and 29 ms respectively in the final unit run. The larger configured capacity did not force irrelevant material into the request.

With the large scenes explicitly pinned, the same fixture selected 26 sources and an estimated 187260 input tokens under the 200000 total budget, and 53 sources and an estimated 466656 input tokens under the 500000 total budget. Assembly took 258 ms and 482 ms. The old promise survived, with 2000 output tokens and the safety margin reserved. These are estimates using serialized UTF8 bytes divided by three, not tokenizer measurements or live provider acceptance tests.

A separate 200000 character browser scene opened from IndexedDB in 1.1 ms and saved a revision in 15.4 ms in the final browser run. These are synthetic single environment observations, not Android performance certification or maximum library capacity claims.

## Defects found and corrected

1. A final Chat stream marker could replace a prior output limit reason with an ordinary stop. The marker now confirms completion without overwriting the earlier reason.
2. Derived memories sourced through accepted candidates could survive an edit to their owning scene. Source invalidation now follows those identities and keeps original evidence available.
3. Reloading the same scene after acceptance could restore an old direction over a newly typed direction. Same scene refresh now preserves the visible direction; acceptance protects the editor during its short transaction.
4. Adaptation acceptance could include an explicit event record twice through the stale record list and the adaptation update. The browser accepted the duplicate writes, while device validation rejected them. Only derived records are invalidated, updates are unique, and duplicates are now rejected before a browser operation enters the outbox.
5. A candidate created after context assembly could attach to a newer revision if an edit landed during assembly. Candidate creation now uses the immutable assembled revision. Context fingerprints also detect changes to selected sources and author instructions.
6. Entity edits initially lacked a recoverable profile version. Profile snapshots now preserve name, aliases, kind and biography under the stable entity identity.
7. Noncandidate streams needed their own partial checkpoints for abrupt closure. RP and partner responses now preserve checkpointed output, recover incomplete jobs without paid retries and expose unattached recovered responses.
8. Wrapping select controls in labels produced ambiguous accessible names. Controls now have explicit accessible labels.
9. A visible notice could push the save indicator below the viewport. The application layout now reserves space for its notice and save state.
10. Native numeric fields could reject fractional sampling parameters or prices. Fractional values are now accepted, while context and output token limits still require whole numbers. The browser journey configures temperature 0.7 and fractional prices.

## Isolation and publication boundary

Only the Cozy Novel repository was cloned, edited, tested and prepared for publication. No RP source module was imported or copied. No RP repository, saved story, browser database, provider key or backup directory was opened. Browser isolation tests used disposable sentinel caches and databases only. Captured application API requests used `/api/novel/`, and server writes used temporary Cozy Novel directories. The original README heading remains exact. The credential attachment was checked against the source tree without printing its secret; no match was present.

The service worker only handles an explicit owned asset list and deletes outdated caches with the exact `cozynovel.assets.` prefix. Tests do not establish that a future shared origin deployment would be safe. That deployment remains outside this release.

## Practical limits

No live model call was authorized or made. Real account authentication, provider model quirks, real refusal policies, live usage accounting and prose fidelity require testing with the chosen account. Filesystem permissions are not encryption. Cancellation requests cannot guarantee immediate billing cessation.

The relay bounds ordinary request bodies to 8 MiB and restore previews to 64 MiB. Very large imports, duplication or accumulated history can exceed a single synchronization operation. The browser copy remains intact and reports the device error; use portable backup before reorganizing very large work. Whole backup parsing and export still require memory proportional to that backup. The performance fixtures are not a maximum size certification.

The plain text editor, manual source review, explicit numeric chronology and local relay requirement are deliberate release choices. There is no rich text editor, EPUB or DOCX export, general purpose assistant, combined product hub, automatic cross application character transfer, or hosted deployment.

## Reproduce

The test fixtures never use personal stories or real keys. Development setup:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:server
npm run test:browser
```

If Chromium is provided separately, set `COZYNOVEL_CHROMIUM` to its executable when running the browser test. Reports and screenshots go to ignored `test-results/`. No Node installation is needed to run the writing application itself.
