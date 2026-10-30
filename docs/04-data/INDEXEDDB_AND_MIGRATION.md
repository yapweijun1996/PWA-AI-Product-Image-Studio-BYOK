# Local Persistence: IndexedDB, Blobs and Migration

## Principle

Use browser IndexedDB for source photos, masks, generated result Blobs, QA and job state. Service Worker cache owns only public static shell. Credential values never belong in either.

## IndexedDB schema v1 plan

| Store | Key | Useful indexes | Retention |
|---|---|---|---|
| products | productId | sku, updatedAt | until explicit delete / browser eviction |
| sourceAssets | assetId | productId, sha256 | source immutable |
| masks | maskId | sourceAssetId, version | derived immutable versions |
| jobs | jobId | productId, status, createdAt | revision history |
| attempts | attemptId | jobId, status, submittedAt | append-only, redact Key |
| generatedAssets | assetId | attemptId, productId | user-controlled |
| qaReports | qaId | assetId, createdAt | append-only + decision events |
| userSettings | key | none | strictly non-secret prefs |
| migrations | version | appliedAt | diagnostic record |

Current implementation creates these stores in IndexedDB version 1. `products.sku` is a unique index on the trimmed, case-sensitive SKU; product records are checked against the canonical product JSON Schema on writes and reads using a build-time-generated validator compatible with a no-`unsafe-eval` CSP. SKU creation, confirmed facts, original-image Blobs, immutable mask versions, seven-style jobs, attempts, scene Blobs, composite recipes, local outputs and QA records are implemented; related metadata and Blobs commit atomically. Mask records carry source and mask hashes, oriented dimensions and version; concurrent stale saves and conflicting unresolved generation attempts are rejected. Product/fact/original/mask backup and add-only restore have scoped Chromium evidence. Backup of jobs and generated outputs, QA, receipts and historical schema migrations is not supported; export fails rather than omitting a project's jobs or outputs. An enforced Chromium quota test exercised source-save rollback and retry; natural exhaustion and physical-device behavior remain unverified. See [the backup contract](EXPORT_IMPORT.md) and [task ledger](../08-delivery/TASK.md).

## Transaction semantics

- Upload: validate size/type/dimensions first; write original and product metadata in one logical operation; if Blob can't be committed, do not claim saved. If transaction cannot safely contain entire image pipeline, model staged assets as TEMP then atomically publish only after hash check.
- Generation: persist the attempt before the network call; provider success becomes GENERATED only after its Blob write succeeds. If persistence fails after a possible remote result, retain UNKNOWN and do not automatically resend. Eligible terminal attempts can be explicitly reviewed without changing the original outcome; a new call needs fresh consent and UUID. A recovery window and lost-asset download are not yet implemented.
- Budget receipts: each new local Studio attempt records its non-secret browser-tab budget session ID and prior estimate; preparation checks that total against all same-session attempts in the same readwrite transaction. The saved success and image include sanitized usage and, when calculable, the rate snapshot. Legacy attempts without session fields remain readable; malformed partial session metadata blocks generation rather than being counted as zero. Session limits themselves are `sessionStorage` preferences, not provider-wide limits.
- STRICT composites: a distinct unapproved generated-asset record stores its source, mask and scene IDs and hashes, fixed scale/offset mapping and output hash. Before append, the client re-renders verified inputs and compares decoded pixels against the preview, then rechecks ownership, hashes, current mask version and attempt in one transaction. A cancelled in-progress transaction aborts; an already committed save cannot be undone by cancellation. The current backup still refuses projects with these outputs.
- Visual QA: an append-only report and a separate decision are bound to the verified product snapshot, original, active mask, scene and exact composite hashes. Before any append, the transaction re-verifies inputs, re-renders the composite and checks the reviewer-displayed product and output fingerprints; stale evidence fails closed. A per-asset history head records event hashes to detect partial corruption, not an attacker able to rewrite both events and head. The current decision is derived only for the latest review and matching provenance. Cross-tab change notifications are best-effort; transaction checks remain authoritative. An output bundle contains selected approved conversions and provenance, not restorable QA records or a complete backup.
- Deletion: cascade only associated local records after explicit user confirmation; preserve unrelated shared assets by reference count.

## Storage limits / eviction

Target: use `navigator.storage.estimate()` to show approximate remaining capacity and `navigator.storage.persist()` where supported. Treat its outcome as advisory. Over quota: stop write, preserve original, display size and cleanup options. The current ZIP backup covers product, originals and masks only; full portability is pending. Explain user owns backups and browser can evict origin data.

## Migration protocol

1. Each document has `schemaVersion`. Client DB has monotonically increasing integer schema version.
2. Before migration, create user-visible export/backup for risky changes. Never modify original source Blob during migration.
3. Migration functions deterministic and idempotent under repeat. Snapshot/touch only targeted stores; validate result against JSON schema.
4. Unknown future version: read-only preview or explicit "requires newer app" error. Do not silently import and drop fields.
5. N→N+1 SW reload must not break in-flight edit or trigger schema downgrade.

## Backup security

ZIP includes original assets and potentially confidential seller photos; prompt before downloading/exporting or uploading it elsewhere. Do not embed API Key, session cookie, vault token or location/system diagnostics.
