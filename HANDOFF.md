# Cozy Novel 1.1 correction handoff

Product: Cozy Novel. Repository ID: 1416185068. Branch: main.

The correction base is 66bc76f234689724105cc5acd495f3d5e5e8348a. The initial source baseline was dae80185cf44925fe199f4911f00e4ad7c3f831f. It contained only the README. The heading remains unchanged. This release was implemented independently and includes no RP application module or data.

## Delivered workflows

The library creates, resumes, renames, duplicates, archives and recovers novels. Chapters and scenes retain independent order, metadata and fictional time. The studio includes manual writing, AI directions, candidate comparison and acceptance, alternative candidates, exact selection revision, history recovery, reading, search, bookmarks, themes and phone workspace switching.

The writing partner discusses scoped sources without changing the book. Story Bible records separate facts, events, beliefs, knowledge, secrets, conditions, plans and future ideas. Entity names have stable identities and recoverable profile versions. Author corrections explicitly choose a temporal or retroactive scope. Optional suggestions and typed source readings stay attached to their original source. Quiet automatic Story Brain maintenance creates reversible identities, knowledge, beliefs, conditions, relationships, plans, events and summaries from accepted material. More than three facts can be read; three visible recommendations are a separate limit. Ambiguous or unsupported interpretations stay reviewable.

Quick RP has independent player control, narrative viewpoint, Direct instructions, transcript branches and recovery. Keeping a session, declaring its events and adapting it into prose have distinct outcomes. An adaptation is reviewed before it joins the manuscript. Events previously kept are marked as having prose rather than counted again.

All four requested provider transports are implemented behind one local relay. There is one foreground writer and a bounded optional helper. Credentials are separate from manuscript storage. Streaming failures preserve partial output, and interrupted jobs never make automatic paid retries. Request receipts identify selected sources, context estimates, omissions and reported usage.

Browser revisions and operation outboxes are atomic. Device SQLite applies changed records with expected revisions and idempotent acknowledgements. Full backups, separate copy imports, staged restores, recovery snapshots and manuscript exports are available. The owned offline shell supports manual writing without the local service.

## Important decisions

Plain text editing avoids fragile rich text mutations. Markdown imports preserve source text rather than guessing structure. Automatic derived reading is the new novel default, with review only and disabled modes. Legacy disabled automatic reading stays disabled. Numeric time anchors are separate from chapter order. Removal remains recoverable archive or discard. The AI connection requires the local relay; no hosted key workaround or deployment is included.

There is a limited module descriptor for future integration. It exposes disposal and an explicit theme preference interface, not unrestricted repository access. A combined home, cross application data transfer and a shared origin deployment require separate work.

## Files and responsibilities

`index.html`, `css/`, `assets/` and `js/ui/` provide the writing and reading interfaces. `js/core/`, `js/storage/` and `js/novel/` validate identities, persist exact text, retain revisions, coordinate device saves and enforce candidate acceptance. `js/story/`, `js/context/`, `js/ai/` and `js/rp/` contain source authority, retrieval, provider transport and exploration ownership. `js/export/` creates safe manuscript files.

`serve.py` and `server/` own loopback security, the SQLite device store and configured relay profiles. `install.sh` and `cozynovel` are independent launchers. `sw.js` and the manifest own only Cozy Novel assets. `tests/` contains synthetic verification. README, SPEC, API and provider documentation describe operation and limits. HISTORY is append only.

## Evidence and limits

The exact executed checks, versions, observed defects, measurements, screenshots and limitations are in docs/VERIFICATION.md. Live model quality and actual account compatibility were not tested. Physical Android and Termux were not available. The relay has explicit body limits, and large portable backups need proportional memory. No test establishes perfect psychological simulation or novel consistency.

For the next task, fetch current main first and inspect uncommitted work. Preserve text and source history. Do not reopen the original RP repository or installation for this app's tests. An ordinary verified fix may be committed and pushed under the owner's standing authorization; deployment and destructive actions require separate authority.

## Correction findings and decisions

The four audit defects were reproduced against real browser IndexedDB and the HTTP service before changing them. DeviceSync.flush now drains fresh pending operations under one cross tab lock. It cannot announce a device checkpoint while matching work remains queued. Restore captures coverage and rejects a changed browser commit boundary. Durable acknowledgements survive SQLite restart and are not deleted by replacement. Only included, owned IDs retire after a verified acknowledgement.

Context assembly applies one temporal policy across profiles, summaries, notes, canon and branch sources. Current freeform profiles with no fictional scope remain exact in author view and history; unsafe historical claims are withheld with a receipt reason. Stable biography is an explicit author declaration. Context membership, metadata, prompts, profile scope, branch heads and provider serialization are reselected locally for freshness. Transaction preconditions close the check and application gap. Receipts and usage do not alter the semantic epoch.

The introductory RP person is exploration scoped. Branch readings contain typed conditions and knowledge, plus explicit unfinished coverage. Event keeping proposes text and optional structured state for author review. Adaptation records an exact transcript range and cannot promote abandoned branch identities. Source reading failures remain pending and never rewrite or block the book. Long helper inputs and saved evidence use bounded segments and immutable original turn references.

Additional integration defects corrected here included the acceptance and continuation race, canon baseSceneId validation incorrectly assuming an exploration shape, missing parentSessionId in copy remapping, abandoned entity promotion, incomplete turn coverage claiming later turns, and old source coordinates during incremental invalidation. Newly changed source ranges are checked against revision edit maps; earlier untouched evidence remains recoverable.

## Upgrade and remaining limits

Update code and restart only the Cozy Novel service, then save and refresh Cozy Novel tabs. IndexedDB physical version 2 is additive. Portable backups, SQLite schema and service protocol stay at 1, with synchronization writer contract 2. Old database writers cannot reopen the migrated version, and old service writers are rejected. Browser only writing remains available when safe Web Locks coordination is unsupported; destructive restore is unavailable there.

No known failing regression remains in the executed synthetic contracts. Automatic interpretations are not semantically guaranteed. An interrupted, malformed or preempted reader can leave explicit unfinished work for a later deliberate reading. Three bounded scene reading calls are the automatic ceiling per accepted passage; long exploration reading advances one segment per normal helper opportunity. No full library scan or automatic paid transport retry is performed. Historical claims in older freeform profiles may need scoped author review. Legacy explorations without a saved catalog disclose that limitation and retain their original manuscript and transcript.

Real account compatibility, paid usage, literary quality, physical Android, Termux and other browser engines remain unverified. The exercised restart case is SQLite store restart plus browser repository reopen, not a physical device power failure. Large backup and restore requests retain the documented 64 MiB relay limit; ordinary operations retain 8 MiB. No limit was raised to hide a size failure.

The only Git working tree and publication destination used for edits is brucestarkallen/Cozy-Novel-. No RP runtime, personal data or installation was accessed. A read only remote head check showed the protected RP main had independently advanced from the handoff baseline to daa7c9ec346ed53d1fab55f770ef71a2a0ade57c. This work did not write to that repository and makes no claim about its installation or personal data.

Final correction verification: 18 unit tests, 13 server tests, 25 main browser contract groups, plus the four standalone browser regression runners passed. Refer to docs/evidence/corrections for exact captured output and screenshots.
