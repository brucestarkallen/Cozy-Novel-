# Local service protocol 1

Every path begins with `/api/novel/`. This service binds to loopback and does not enable CORS. Mutations require `Origin` matching the local service, `Content-Type: application/json` and `X-CozyNovel-Session` from status. Ordinary mutation bodies are bounded to 8 MiB; restore bodies to 64 MiB. The full portable file remains usable in browser workflows even when it exceeds a relay request limit.

`GET status` returns service `cozyNovel`, protocol, schemaVersion, libraryId, generation, serverRevision, a process session token and public connection profiles. It never returns keys.

`GET projects?cursor=0` returns up to 100 novel metadata records and nextCursor. `GET projects/{id}?cursor=0` returns up to 200 owned records and their required text bodies. `GET snapshot?cursor=0` uses the same bounded shape for the library. Each page includes the server revision. Clients reject a download if that revision changes between pages.

`POST projects/{id}/operations` accepts id, libraryId, libraryGeneration, novelId, kind, expectedVersion, expectedServerRevision, records, blobs and tombstones. Tombstone writes are deliberately rejected in this release; archives preserve ownership. Each blob has its SHA256 based id and exact text. The transaction validates ownership and references, checks generation and server revision, applies changes, and records the operation acknowledgement. Resending a committed ID returns its existing acknowledgement. Conflict status is HTTP 409 and never applies the conflicting operation.

`POST connections` configures primary or helper with adapter, full endpoint, model, limits, capability flags, supported parameters, optional pricing, secret, persistSecret and allowLocal. The secret is omitted from all responses. Saving validates configuration and destination without sending a model request.

`POST generate` accepts connectionId, requestId, adapter and the adapter's serialized stateless request. The profile fixes destination and model. Unsupported top level parameters, tools and provider conversation references are rejected. The response relays the provider's event stream. Provider HTTP error bodies are not copied into local errors.

`POST cancel` requests cancellation of a running requestId by closing its upstream connection. It cannot guarantee cancellation of provider billing.

`POST backups` creates a consistent SQLite backup in the owned device directory and returns its filename. Snapshots are not pruned automatically.

`POST restore/preview` validates `{backup}` and returns previewId, titles and serverRevision. Preview data expires after ten minutes. At most three previews are retained. `POST restore/commit` accepts previewId and expectedServerRevision, makes a recovery snapshot and replaces the device library in one explicit transaction.

No endpoint accepts a model supplied filesystem path or an arbitrary proxy destination. No RP endpoint is called or emulated.
