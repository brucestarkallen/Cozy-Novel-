# Cozy Novel release contract

Cozy Novel is a standalone local creative writing studio. The author gives directions, reviews prose candidates, keeps chosen passages, discusses the novel, or explores a scene as a character. No combined product hub is implemented.

## Authority and preservation

Accepted text revisions and explicit author declarations establish novel truth. Plans, beliefs, future ideas, optional suggestions and explorations remain distinct. Entity IDs survive name changes. Profile editing does not replace words in manuscript text.

An AI candidate belongs to one novel, scene, base revision and exact UTF16 insertion range. Generation never changes the accepted text. Acceptance checks the source again. A stale candidate requires explicit comparison and placement as a new candidate. Selection edits preserve the untouched prefix and suffix exactly. Restoring a version adds a revision.

Quick RP owns its transcript and alternate branches. The player identity and narrative viewpoint are independent. Switching player does not create a turn. Keeping events records an author declaration with no inserted prose. Adaptation creates a reviewable candidate. Acceptance links provenance and marks the branch's existing event record as having prose rather than duplicating it.

## Architecture

HTML, CSS and browser ES modules run without compilation. IndexedDB holds normalized records and content addressed text bodies. All persistent record writes pass through Repository. A Python standard library service maintains transactional SQLite device storage and an explicitly configured model relay.

Story records carry information class, certainty, holder, temporal eligibility, source references and lifecycle status. Corrections retain superseded records. The optional source reader produces reviewable derived memories. No auditor blocks writing or mutates primary text.

Context selection is separate from provider serialization. An incremental local scene index ranks original passages using relevant terms and author pins. Mandatory author instructions and selected text cannot be silently truncated. Whole optional units are omitted when they do not fit, with a receipt. Numeric fictional time anchors filter later information. Unknown chronology remains labelled, and unknown earlier scene chronology is excluded from character exploration.

The primary connection is sufficient for every feature. An optional helper connection can handle suggestions and source readings. Supported transports are OpenAI Responses, compatible Chat Completions, Anthropic Messages and OpenRouter. Model capabilities remain explicit configuration. The application does not certify a user entered context limit.

Foreground prose uses one request. Optional analysis uses at most one bounded request after completion. There is no model call during typing, panel changes or reopening. An interrupted request preserves partial text and is never automatically restarted.

## Deliberate first release decisions

The manuscript editor is plain text. Markdown imports preserve the exact file as one scene, rather than guessing chapter boundaries. Manuscript export supports text, Markdown and safe printable HTML.

Chronology uses an optional numeric coordinate and a human readable label. This supports flashbacks without imposing a calendar system. The author reviews model derived memories before acceptance. This is stricter than automatically applying clear proposals and avoids making semantic certainty a software claim.

Removal is recoverable archive or discard. There is no automatic history pruning. The standalone application exposes a versioned module descriptor and disposal boundary; a combined host and cross application transfers remain future work.

The static application supports offline manual writing and portable exports. AI connections require the local relay. No browser key mode or security bypass is offered.

## Security and isolation

The local service checks Host, Origin, JSON content type, body limits and a per process application token. Static serving is allowlisted. Provider destinations are checked and pinned to a validated address for each connection; verified TLS is retained and redirects are not followed. Loopback model access needs explicit configuration.

Connection secrets live in memory by default. Optional persistence uses a separate restricted local file. Filesystem permissions are not encryption. Secrets never enter the manuscript database, model context or ordinary backups.

Application assets alone are cached. API requests are never cached. Cache cleanup uses the exact owned asset prefix. Updates wait for explicit refresh. Browser and device save states are reported separately. Same hostname and different repository paths are not isolated origins.
