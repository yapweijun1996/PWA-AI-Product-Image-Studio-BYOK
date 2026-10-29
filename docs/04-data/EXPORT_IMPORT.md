# Portable Project Export / Import Contract

## Goals

User can leave the app with their original photos, approved outputs, masks, verified facts, job/cost/QA lineage. A backup is not dependent on app operator cloud storage. A **portable project** can include rejected draft metadata but must visibly distinguish it from approved output.

## Implemented subset

The browser currently exports and imports one product, its facts and immutable original images. ZIPs contain `project.json`, `export-manifest.json` and `originals/<assetId>.<extension>`; hashes and source references are verified before an add-only IndexedDB transaction. The import preview shows the exact uncompressed archive bytes and warns that actual browser storage use differs. Duplicate product, SKU or source IDs are rejected, including races after preview. User-visible progress and cancellation are available before commit.

Only product and export-manifest schema version `1.0.0` is supported. No historical schema or migration contract exists yet; unsupported versions, masks, jobs, generated outputs, QA and receipts are rejected rather than silently omitted. This subset does not satisfy the complete portable-project target below. Integrate those record types and their tested migrations as their features are implemented.

Backups are unencrypted and may contain sensitive project details, original images and EXIF metadata. Choose a trusted destination. The application rejects certain recognizable credential patterns in project metadata, but this heuristic cannot detect every secret and does not inspect image pixels or metadata for secrets. Never put credentials in product data or source images.

The current limits are 340 MiB compressed archive, 18 entries, 1 MiB per JSON file, 20 MiB per original, 322 MiB total expanded bytes and a 200:1 expansion ratio. Import rejects encrypted, executable, linked, duplicate, unsupported or unsafe entries, verifies ZIP integrity and hashes, and checks image headers and dimensions. These controls do not replace independent security review or real-device storage testing.


## ZIP structure (target)

```text
sku-project-<short-id>.zip
├── project.json                 # Product schema + original asset references
├── export-manifest.json         # version, hashes, provenance and approval
├── originals/<assetId>.png
├── masks/<maskId>.png
├── outputs/approved/<assetId>.png
├── outputs/drafts/<assetId>.png # optional, labeled unapproved
├── qa/<qaId>.json
└── receipts/jobs.json           # attempt/cost records, no secrets
```

## Export invariants

- `approvedOnly=true` by default; drafts are optional and clearly named as non-approved; never imply a rejected asset is commercially approved.
- SHA-256 for each file payload; manifest declares schema version, createdAt, projectId, filename, MIME, bytes, source/attempt lineage and `approved` flag.
- Export verifies no credential-related fields appear. Sanitize names and paths; no absolute paths or untrusted `../`.
- Format conversion PNG/JPEG/WebP: record format, dimensions, resampling/quality flags; transparent assets exported as JPEG need explicit background fill, not black artifacts.
- Output channel presets require actual current platform rule validation; defaults use generic sizes, not claims of official compliance.

## Import validation

1. Validate ZIP central directory, fixed max entries, max compressed/uncompressed bytes and ratio, path traversal, link/symlink contents, MIME and image dimensions.
2. Require supported manifest version, local cross-reference integrity, unique IDs and SHA-256 digest matches.
3. Display conflict: merge as new project with remapped IDs or reject; never silently overwrite same SKU.
4. Preview exact import count and storage impact. Commit in all-or-nothing logical transaction; show recovery if partial staged data must be cleaned.
5. Revalidate QA claims; if source asset missing/corrupt, APPROVED must be downgraded to "needs verification" rather than inherited blindly.

## Compatibility

`export-manifest.schema.json` is the target JSON contract. Demo fixture is in [`fixtures/sample-export-manifest.json`](../../fixtures/sample-export-manifest.json); its dummy hashes and product IDs are synthetic test data.
