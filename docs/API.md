# Local service protocol 1

Every path begins with `/api/novel/`. This service binds to loopback and does not enable CORS. Mutations require `Origin` matching the local service, `Content-Type: application/json` and `X-CozyNovel-Session` from status. Ordinary mutation bodies are bounded to 8 MiB; restore bodies to 64 MiB. The full portable file remains usable in browser workflows even when it exceeds a relay request limit.

`GET status` returns service `cozyNovel`, protocol, syncVersion (2), minimumWriter (2), schemaVersion, libraryId, generation, serverRevision, a process session token and public connection profiles. It never returns keys.

`GET projects?cursor=0` returns up to 100 novel metadata records and nextCursor. `GET projects/{id}?cursor=0` returns up to 200 owned records and their required text bodies. `GET snapshot?cursor=0` uses the same bounded shape for the library. Each page includes the server revision. Clients reject a download if that revision changes between pages.

`POST projects/{id}/operations` accepts clientProtocol (2), id, libraryId, libraryGeneration, novelId, kind, expectedVersion, expectedServerRevision, records, blobs and tombstones. Tombstone writes are deliberately rejected in this release; archives preserve ownership. Each blob has its SHA256 based id and exact text. The transaction validates ownership and references, checks generation and server revision, applies changes, and records the operation acknowledgement. Resending a committed ID returns its existing acknowledgement. Conflict status is HTTP 409 and never applies the conflicting operation.

`POST connections` configures primary or helper with adapter, full endpoint, model, limits, capability flags, supported parameters, optional pricing, secret, persistSecret and allowLocal. The secret is omitted from all responses. Saving validates configuration and destination without sending a model request.

`POST generate` accepts connectionId, requestId, adapter and the adapter's serialized stateless request. The profile fixes destination and model. Unsupported top level parameters, tools and provider conversation references are rejected. The response relays the provider's event stream. Provider HTTP error bodies are not copied into local errors.

`POST cancel` requests cancellation of a running requestId by closing its upstream connection. It cannot guarantee cancellation of provider billing.

`POST backups` creates a consistent SQLite backup in the owned device directory and returns its filename. Snapshots are not pruned automatically.

`GET manifest?cursor=0` returns up to 200 `{id, hash}` record entries, nextCursor and the global serverRevision. Hashes cover canonical sorted record JSON, including immutable text body identities. It supports bounded reconciliation when an upgraded browser has an empty outbox that may have lost older pending saves. A mismatch preserves both copies and requires an explicit repair.

`POST restore/preview` accepts `{clientProtocol:2, restoreOperationId, snapshotDigest, snapshotJson}`. snapshotJson is the exact portable snapshot string. snapshotDigest is its SHA256 text identity. The durable preview returns restoreOperationId, snapshotDigest, titles and serverRevision. An uncommitted preview expires after ten minutes. Reusing its ID with different content fails.

`POST restore/commit` accepts `{clientProtocol:2, restoreOperationId, snapshotDigest, expectedServerRevision}`. It creates a consistent recovery SQLite snapshot, then replaces records and writes the durable restore acknowledgement in one explicit transaction. The restore_operations table is retained during replacement. Repeating the same committed identity returns the same acknowledgement after restart, without another replacement or snapshot.

`GET restore/operations/{restoreOperationId}` returns phase and, when committed, its exact acknowledgement. Unknown outcomes never authorize outbox removal or an automatic replacement.

An ordinary acknowledgement contains operationId, libraryId, libraryGeneration, expectedServerRevision and serverRevision. A restore acknowledgement contains restoreOperationId, snapshotDigest, libraryId, libraryGeneration, serverRevision and recoverySnapshot. Clients check every ownership field and the expected revision transition before retiring work. The server revision is global to this library, not a separate per novel counter.

Browser mutation and synchronization locks have a consistent order: synchronization first, mutation second. A device restore journal captures the browser generation, commit sequence and exact included pending IDs. Confirming a changed preview fails. Network work occurs outside IndexedDB transactions. A committing or unknown journal fences all cooperating browser writers, including streaming checkpoints. Physical IndexedDB version 2 prevents old version 1 writers from reopening the library; the service rejects old writer requests. Browsers without Web Locks retain manual browser writing but cannot perform coordinated device synchronization or destructive restore.

No endpoint accepts a model supplied filesystem path or an arbitrary proxy destination. No RP endpoint is called or emulated.
