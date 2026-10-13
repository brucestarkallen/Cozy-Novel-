# Local service protocol 1

Every path begins with `/api/novel/`. This service binds to loopback and does not enable CORS. Mutations require `Origin` matching the local service, `Content-Type: application/json` and `X-CozyNovel-Session` from status. Ordinary mutation bodies are bounded to 8 MiB; restore bodies to 64 MiB. The full portable file remains usable in browser workflows even when it exceeds a relay request limit.

`GET status` returns service `cozyNovel`, protocol, syncVersion (3), minimumWriter (3), schemaVersion, libraryId, generation, serverRevision, a process session token and public connection profiles. It never returns keys.

`GET projects?cursor=0` returns up to 100 novel metadata records and nextCursor. `GET projects/{id}?cursor=0` returns up to 200 owned records and their required text bodies. `GET snapshot?cursor=0` uses the same bounded shape for the library. Each page includes the server revision. Clients reject a download if that revision changes between pages.

`POST projects/{id}/operations` accepts clientProtocol (3), id, libraryId, libraryGeneration, novelId, kind, expectedVersion, expectedServerRevision, records, blobs and tombstones. Tombstone writes are deliberately rejected in this release; archives preserve ownership. Each blob has its SHA256 based id and exact text. The transaction validates ownership and references, checks generation and server revision, applies changes, and records the operation acknowledgement. Resending a committed ID returns its existing acknowledgement. Conflict status is HTTP 409 and never applies the conflicting operation.

`POST connections` accepts `connectionProtocol:2` and a stable profile id, displayName, preset, explicit adapter and transport, baseUrl and endpoint, model, context and output limits, capability flags, parameters, pricing, prefill, reasoning and optional secret retention. Public responses contain profileVersion, secretReference and hasSecret, never key values. Saving validates syntax without DNS or provider calls. profileVersion detects stale profile edits. A supplied secretFromId may share a same origin credential when explicitly duplicating; a changed retention choice or edited key gets an independent reference. Old connection clients are rejected rather than allowed to replace migrated profiles.

`GET connections/{id}/models` makes an authenticated, bounded GET to the configured compatible models path. It cannot accept an arbitrary destination. Returned models and metadata are normalized by the browser against that profile's endpoint and model identity. Discovery failure leaves manual model entry available.

`POST connections/remove` accepts a stable id. It removes only that profile and unused secret references. The browser resolves affected assignments under its mutation gate and preserves receipts.

A Test uses the ordinary protected `POST generate` path with the exact selected model and transport, a small explicit output allowance and a 20 second browser deadline. It is separate from Save. Browser direct uses fetch against the configured endpoint, CORS, TLS and exact origin bound page memory credentials. It never sends the local session token upstream.

`POST generate` accepts connectionId, captured profileVersion, endpointIdentity, requestId, adapter and the adapter's serialized stateless request. The profile fixes destination and model. The captured version and endpoint must still match inside the relay profile lock before forwarding; a mismatch makes no upstream request. Unsupported top level parameters, arbitrary tools and provider conversation references are rejected. Explicit native web tool shapes, prompt cache fields and configured compatible reasoning or prefill extensions are narrowly allowlisted. The response relays the provider's event stream. Provider HTTP error bodies are not copied into local errors.

`POST cancel` requests cancellation of a running requestId by closing its upstream connection. It cannot guarantee cancellation of provider billing.

`POST backups` creates a consistent SQLite backup in the owned device directory and returns its filename. Snapshots are not pruned automatically.

`GET manifest?cursor=0` returns up to 200 `{id, hash}` record entries, nextCursor and the global serverRevision. Hashes cover canonical sorted record JSON, including immutable text body identities. It supports bounded reconciliation when an upgraded browser has an empty outbox that may have lost older pending saves. A mismatch preserves both copies and requires an explicit repair.

`POST restore/preview` accepts `{clientProtocol:3, restoreOperationId, snapshotDigest, snapshotJson}`. snapshotJson is the exact portable snapshot string. snapshotDigest is its SHA256 text identity. The durable preview returns restoreOperationId, snapshotDigest, titles and serverRevision. An uncommitted preview expires after ten minutes. Reusing its ID with different content fails.

`POST restore/commit` accepts `{clientProtocol:3, restoreOperationId, snapshotDigest, expectedServerRevision}`. It creates a consistent recovery SQLite snapshot, then replaces records and writes the durable restore acknowledgement in one explicit transaction. The restore_operations table is retained during replacement. Repeating the same committed identity returns the same acknowledgement after restart, without another replacement or snapshot.

`GET restore/operations/{restoreOperationId}` returns phase and, when committed, its exact acknowledgement. Unknown outcomes never authorize outbox removal or an automatic replacement.

An ordinary acknowledgement contains operationId, libraryId, libraryGeneration, expectedServerRevision and serverRevision. A restore acknowledgement contains restoreOperationId, snapshotDigest, libraryId, libraryGeneration, serverRevision and recoverySnapshot. Clients check every ownership field and the expected revision transition before retiring work. The server revision is global to this library, not a separate per novel counter.

Browser mutation and synchronization locks have a consistent order: synchronization first, mutation second. A device restore journal captures the browser generation, commit sequence and exact included pending IDs. Confirming a changed preview fails. Network work occurs outside IndexedDB transactions. A committing or unknown journal fences all cooperating browser writers, including streaming checkpoints. Physical IndexedDB version 3 prevents older version 1 and 2 writers from reopening the library; the service rejects old writer requests. Browsers without Web Locks retain manual browser writing but cannot perform coordinated device synchronization or destructive restore.

No endpoint accepts a model supplied filesystem path or an arbitrary proxy destination. No RP endpoint is called or emulated.

Connection persistence format 2 is separate from service protocol 1, portable schema 1 and synchronization writer contract 3. Its atomic owned JSON file contains named profiles and deliberately persisted secret references. Previous and legacy owned recovery files use restrictive permissions. Corrupt configuration is retained by a bounded content identity, with a warning and metadata recovery; secrets are not guessed. Unsupported future formats fail without modification.

An idempotent resend of a previously committed writer 2 operation is recognized using its legacy digest after upgrade. This does not allow a new writer 2 operation, a changed payload under the same ID, or an old generation write. Named profiles and role settings added to portable configuration contain no credentials.
