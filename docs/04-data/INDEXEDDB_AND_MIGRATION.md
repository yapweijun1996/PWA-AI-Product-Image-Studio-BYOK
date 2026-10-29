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

Current implementation creates these stores in IndexedDB version 1. `products.sku` is a unique index on the trimmed, case-sensitive SKU; product records are checked against the canonical product JSON Schema on writes and reads using a build-time-generated validator compatible with a no-`unsafe-eval` CSP. SKU creation, confirmed facts and original-image Blob writes are implemented; product metadata and Blob commit atomically. Current product/fact/original backup and add-only restore have scoped Chromium evidence; masks, jobs, generated outputs, QA, receipts and historical schema migrations are not supported. Actual quota exhaustion remains unverified. See [the backup contract](EXPORT_IMPORT.md) and [task ledger](../08-delivery/TASK.md).

## Transaction semantics

- Upload: validate size/type/dimensions first; write original and product metadata in one logical operation; if Blob can't be committed, do not claim saved. If transaction cannot safely contain entire image pipeline, model staged assets as TEMP then atomically publish only after hash check.
- Generation: persist immutable attempt **before** network call; provider success becomes GENERATED only after Blob write succeeds. If persistence fails after remote result, report recovery window/asset download and don't mark stored.
- Approval: single transactional update from QA candidate + human decision to approved/export-eligible. Re-approval requires new event, not in-place overwrites.
- Deletion: cascade only associated local records after explicit user confirmation; preserve unrelated shared assets by reference count.

## Storage limits / eviction

Target: use `navigator.storage.estimate()` to show approximate remaining capacity and `navigator.storage.persist()` where supported. Treat its outcome as advisory. Over quota: stop write, preserve original, display size and cleanup options. The current ZIP backup covers only the supported local product and originals subset; full portability is pending. Explain user owns backups and browser can evict origin data.

## Migration protocol

1. Each document has `schemaVersion`. Client DB has monotonically increasing integer schema version.
2. Before migration, create user-visible export/backup for risky changes. Never modify original source Blob during migration.
3. Migration functions deterministic and idempotent under repeat. Snapshot/touch only targeted stores; validate result against JSON schema.
4. Unknown future version: read-only preview or explicit "requires newer app" error. Do not silently import and drop fields.
5. N→N+1 SW reload must not break in-flight edit or trigger schema downgrade.

## Backup security

ZIP includes original assets and potentially confidential seller photos; prompt before downloading/exporting or uploading it elsewhere. Do not embed API Key, session cookie, vault token or location/system diagnostics.
