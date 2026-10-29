# Portable Project Export / Import Contract

## Goals

User can leave the app with their original photos, approved outputs, masks, verified facts, job/cost/QA lineage. A backup is not dependent on app operator cloud storage. A **portable project** can include rejected draft metadata but must visibly distinguish it from approved output.

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
