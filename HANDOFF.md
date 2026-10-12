# Cozy Novel first release handoff

Product: Cozy Novel. Repository ID: 1416185068. Branch: main.

The initial source baseline was dae80185cf44925fe199f4911f00e4ad7c3f831f. It contained only the README. The heading remains unchanged. This release was implemented independently and includes no RP application module or data.

## Delivered workflows

The library creates, resumes, renames, duplicates, archives and recovers novels. Chapters and scenes retain independent order, metadata and fictional time. The studio includes manual writing, AI directions, candidate comparison and acceptance, alternative candidates, exact selection revision, history recovery, reading, search, bookmarks, themes and phone workspace switching.

The writing partner discusses scoped sources without changing the book. Story Bible records separate facts, events, beliefs, knowledge, secrets, conditions, plans and future ideas. Entity names have stable identities and recoverable profile versions. Author corrections explicitly choose a temporal or retroactive scope. Optional suggestions and derived memory proposals stay attached to their original source.

Quick RP has independent player control, narrative viewpoint, Direct instructions, transcript branches and recovery. Keeping a session, declaring its events and adapting it into prose have distinct outcomes. An adaptation is reviewed before it joins the manuscript. Events previously kept are marked as having prose rather than counted again.

All four requested provider transports are implemented behind one local relay. There is one foreground writer and a bounded optional helper. Credentials are separate from manuscript storage. Streaming failures preserve partial output, and interrupted jobs never make automatic paid retries. Request receipts identify selected sources, context estimates, omissions and reported usage.

Browser revisions and operation outboxes are atomic. Device SQLite applies changed records with expected revisions and idempotent acknowledgements. Full backups, separate copy imports, staged restores, recovery snapshots and manuscript exports are available. The owned offline shell supports manual writing without the local service.

## Important decisions

Plain text editing avoids fragile rich text mutations. Markdown imports preserve source text rather than guessing structure. Derived memory acceptance is explicitly reviewed. Numeric time anchors are separate from chapter order. Removal remains recoverable archive or discard. The AI connection requires the local relay; no hosted key workaround or deployment is included.

There is a limited module descriptor for future integration. It exposes disposal and an explicit theme preference interface, not unrestricted repository access. A combined home, cross application data transfer and a shared origin deployment require separate work.

## Files and responsibilities

`index.html`, `css/`, `assets/` and `js/ui/` provide the writing and reading interfaces. `js/core/`, `js/storage/` and `js/novel/` validate identities, persist exact text, retain revisions, coordinate device saves and enforce candidate acceptance. `js/story/`, `js/context/`, `js/ai/` and `js/rp/` contain source authority, retrieval, provider transport and exploration ownership. `js/export/` creates safe manuscript files.

`serve.py` and `server/` own loopback security, the SQLite device store and configured relay profiles. `install.sh` and `cozynovel` are independent launchers. `sw.js` and the manifest own only Cozy Novel assets. `tests/` contains synthetic verification. README, SPEC, API and provider documentation describe operation and limits. HISTORY is append only.

## Evidence and limits

The exact executed checks, versions, observed defects, measurements, screenshots and limitations are in docs/VERIFICATION.md. Live model quality and actual account compatibility were not tested. Physical Android and Termux were not available. The relay has explicit body limits, and large portable backups need proportional memory. No test establishes perfect psychological simulation or novel consistency.

For the next task, fetch current main first and inspect uncommitted work. Preserve text and source history. Do not reopen the original RP repository or installation for this app's tests. An ordinary verified fix may be committed and pushed under the owner's standing authorization; deployment and destructive actions require separate authority.
