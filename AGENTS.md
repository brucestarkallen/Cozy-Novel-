# Cozy Novel engineering

This repository is Cozy Novel, repository ID 1416185068. Its established branch is main.

Preserve the original README heading. Preserve exact manuscript text, immutable revisions, candidate alternatives, exploration branches and provenance. HISTORY.md is append only.

All application resources belong to cozyNovel. Browser database: cozynovel.v1. Coordination and cache names start with cozynovel. Device data defaults to ~/.cozynovel. The local server binds to 127.0.0.1 on port 8081.

Never modify, import application modules from, run tests against, or publish to the original Cozy Tavern RP project. Do not read its saved data, keys or backup directory. Do not host the two applications on the same origin without a separate isolation audit.

There is no application build step. Python 3.11 or newer is the runtime requirement. Node and Playwright are development tools only. Use standard platform capabilities and no runtime CDN.

Every accepted manuscript operation must atomically write the revision, scene pointer, operation history and synchronization outbox. Hash text before opening an IndexedDB transaction. Recheck source revisions inside that transaction. Restores create a new library generation and a recovery snapshot.

Use synthetic data and temporary device directories for verification. Never make a paid provider call unless explicitly authorized for that verification. Tests using a synthetic provider do not establish live literary quality or real account compatibility.

Run focused checks for the changed contract. See docs/VERIFICATION.md. Review scope and credentials before committing. Refresh origin/main before a normal authorized push. Never force push, rewrite history, deploy, or discard another contributor's work.

When changing offline assets, update the owned cache version in sw.js so existing installations can receive a coherent shell. Never delete caches outside the exact Cozy Novel asset prefix.

Browser physical version is 3, portable schema and service protocol remain 1, and the synchronization writer contract is 3. Keep those versions independent. Create absent stores and indexes only during additive upgrades. Old tabs must retain visible drafts and close incompatible connections.

Use the library synchronization lock before the mutation lock. Never acquire them in the reverse order. All committed writers participate in the mutation gate; a durable committing or unknown restore journal fences them. Device restore retires only exact covered IDs after a matching durable acknowledgement. Do not remove the journal or clear the entire outbox to resolve a conflict.

Historical eligibility belongs in context/scope.js and applies to every source surface. Source readers are reversible interpretations, not primary truth. Preserve incomplete coverage, rejected batches and immutable turn boundaries. Request freshness includes deterministic source membership and transaction preconditions; jobs, receipts and usage must not invalidate themselves.

Connections have stable named identities, independent of writer and helper roles. Resolve a fresh assignment snapshot before each request and wait for pending selector changes. Keep relay secrets outside IndexedDB, receipts, portable backups and the repository. Saving is syntactic and must not require DNS or perform a model call; Test is an explicit bounded provider action. Connection file format 2 is separate from all manuscript and device versions.

Creative input drafts are source owned artifacts, never canon. Source reading tasks belong to immutable revisions and coverage, not the current panel. Branch supersession is an ancestry overlay. Undo retracts a derived contribution and preserves subsequent author development. Historical eligibility and author overview scope are separate.
