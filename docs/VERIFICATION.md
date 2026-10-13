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

## 1.1 correction evidence, 13 October 2026

The first release assessment was reopened. The audit baseline was reproduced with actual IndexedDB and HTTP boundaries before repair. The earlier 18 unit, 10 server and 25 browser results did not cover those four defects. These new results supersede the acceptance assessment while retaining the earlier history above.

The environment remained Python 3.12.14, Node 24.19.0, Playwright 1.62.1 and Chromium 153.0.8010.0. No product dependency was upgraded. Development formatting used Prettier 3.6.2. Python 3.11 minimum, physical Android, Termux, foldables and non Chromium engines remain unexecuted.

### Executed regressions

* `node --test tests/unit/*.test.js`: 18 passed, including the original stream, authority, large budget, backup and cache contracts.
* `python -m unittest discover -s tests/server -v`: 13 passed. Added durable restore acknowledgement after SQLite store restart, idempotent replay without another snapshot, changed content under a reused restore ID, expired preview, independently changed device revision, old writer rejection and changed operation replay rejection.
* `node tests/browser/journey.mjs`: 25 groups passed through the real UI, IndexedDB, HTTP relay and SQLite, with a synthetic upstream. The café journey now also asserts six automatic typed facts and an introduced supporting person without biography entry. It uses an established B, switches to automatically established C, receives a useful event proposal, accepts a sourced knowledge change, adapts exactly selected events, revises, reopens and restores a portable backup.
* `node tests/browser/audit.mjs`: all four repaired audit cases passed. The test holds A until B's real scheduled flush executes while busy, then proves B drains automatically. A preview preceding a new edit is rejected with its pending operation retained. Historical profile, full summary and late knowledge markers are absent from serialized context. New scene metadata and source membership invalidate the earlier request.
* `node tests/browser/restore.mjs`: passed with real IndexedDB and HTTP. A manual write and candidate checkpoint wait behind the commit barrier, then retain two pending operations with consecutive post restore revision positions. Lost response leaves an unknown journal and fences committed writers. Repository close and reopen recovers the durable outcome, and replay returns the same acknowledgement. Legacy missing outbox payloads produce a manifest disagreement while both copies remain available.
* `node tests/browser/tabs.mjs`: two actual pages share one coordinated drain. Deferred A and B produce two revision transitions with no duplicate application. Lost acknowledgement keeps the same operation ID; resend does not advance the device again. Disposal after upstream commit leaves pending work, which a replacement synchronizer acknowledges without reapplication.
* `node tests/browser/corrections.mjs`: baseline modules loaded directly from commit 66bc76f seed an actual version 1 IndexedDB fixture. Migration retains all 19 records and six exact bodies, including revision ancestry, alternatives, custom prompts, profile history, manual declarations, branches, event provenance and a disabled setting. An old connection is fenced while its visible draft remains. Context checks cover later information in profiles, summaries, notes, knowledge, relationships, conditions, memory and exploration events. Stable biography, private ownership and genuine conditional intentions remain. Metadata, newly eligible facts and prompts change freshness; a receipt does not. A mutation after the final check is rejected by its transaction precondition.

Typed source reading applies six facts and one new identity, retains an unresolved prerequisite for review, remains idempotent, respects manual declarations, records incomplete coverage, supersedes a completed plan reversibly, and preserves failed helper coverage. Retry removes an abandoned response's typed state and identity from the active branch. Character switch creates no event. Keeping events inserts no prose. Accepted adaptation coverage does not grow after later turns, and abandoned identities are not promoted.

A 39000 character long response and retained earlier turns were processed in five synthetic reading segments. Each saved segment was at most 12000 characters. Merged per turn ranges distinguish fully read turns from remaining coverage. Ordinary RP context used a 7993 character transcript window in the 8000 character test budget, with omissions disclosed and originals retained.

The fake source reader in the ownership regressions is a synthetic analysis boundary. The café UI and the four relay adapters use the real network path to the deterministic provider fixture. Neither establishes live model semantics, literary quality, account compatibility or actual paid cost. No live credential was used.

### Additional defects found during correction

The acceptance and continuation race required a pending acceptance promise. A canon baseSceneId triggered exploration specific backup validation and was corrected. Separate copy remapping omitted parentSessionId; mapping now names reference fields and preserves ordinary strings. Adaptation could promote a person from an abandoned branch, and now checks covered turn ownership. Partial exploration readings could claim later turns; ranges and immutable turn references now provide explicit coverage. Metadata saving raced against operational novel versions; coordinated record versions preserve real conflicts while avoiding unrelated bookkeeping failures. Browser and device payload versions are written together, so manifest comparison covers identical acknowledged records. Manual writers are bound to their browser generation after a library replacement. Generation preparation disables acceptance before asynchronous work begins, closing an early click race. Explicit scene continuations establish historical order without requiring numeric dates, and cycles are rejected. Missing stored bodies fail visibly instead of presenting a blank saved manuscript.

### Observed performance and limitations

The 3,069,090 character, 101 scene unit fixture retained its old conditional promise under both 200000 and 500000 configurations. With no forced pins, it selected eight sources and about 999 serialized input tokens, taking 54 ms and 28 ms in the recorded correction run. With dense pins, it selected 26 sources at an estimated 187260 tokens in 249 ms, and 53 sources at an estimated 466656 tokens in 436 ms. Output allowance remained 2000 tokens with the configured safety margin. Counting is estimated serialized UTF8 bytes divided by three, not a tokenizer or provider acceptance result.

A 200000 character browser scene opened in 1.3 ms and saved a revision in 17.4 ms in the final integration run. Results vary between runs and certify neither mobile hardware nor maximum capacity. Immutable scene bodies are read on demand after a consistent metadata capture rather than loading every manuscript body for each request.

Screenshots were inspected at 1440 by 1000 and 390 by 844. Event review shows the original transcript, a filled proposal and accessible acceptance, with secondary structured state details. Browser interaction and data assertions, rather than these pictures, establish persistence. New visual and machine readable evidence is under docs/evidence/corrections/.

The restart check covers SQLite store restart and browser repository reopen. There was no physical power loss campaign or full operating system crash simulation. Coordinated mutation is unavailable without Web Locks; those browsers retain manual writing and export, with device synchronization and destructive restore blocked. Legacy unsourced profiles and exploration catalogs disclose missing historical scope instead of fabricating it. Optional reader failures can leave visible pending coverage, and source quotes locate evidence without mechanically proving its meaning. Large device operations remain bounded to 8 MiB and restores to 64 MiB, with local work retained on a size error.

No known failing executed contract remains. These limits are unverified environments and interpretive quality boundaries, not claims of flawless preservation or perfect simulation. The original RP working tree, installation, data and tests were not used. A read only remote check observed its independently newer main head daa7c9ec346ed53d1fab55f770ef71a2a0ade57c; this task writes and publishes only Cozy Novel.
