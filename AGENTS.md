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
