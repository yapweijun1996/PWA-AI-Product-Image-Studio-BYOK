# Portable Project Export / Import Contract

## Goals

User can leave the app with their original photos, approved outputs, masks, verified facts, job/cost/QA lineage. A backup is not dependent on app operator cloud storage. A **portable project** can include rejected draft metadata but must visibly distinguish it from approved output.

## Full project backup

Version `2.0.0` archives contain one product, immutable originals, all stored mask versions, jobs, attempts, generated scenes, STRICT composites, optional billboard ad/copy layers, visual QA events and their history heads. Every payload has a manifest hash. Export refuses invalid, oversized or inconsistent projects rather than silently omitting data. Restore validates the complete graph and uses a single add-only IndexedDB transaction; duplicate product, SKU or record IDs are rejected, including races after preview.

A `5.0.0` project archive is used when any review or decision binds a protected-mask evidence digest. Version 5 also preserves historical review records and import trust barriers; older clients reject it. A v5 archive cannot be relabelled as v4 to bypass validation.

A `4.0.0` project archive is used when any saved composite binds a protected-mask evidence digest and no review or decision carries that digest. The digest must match its verified mask and the composite is re-rendered with that evidence during validation. Older clients reject v4; do not relabel it as v3. This remains an unkeyed integrity check and does not authenticate the data.

A `3.0.0` project archive is used when any mask includes source-bound protected-region evidence and no composite contains a protected-evidence digest. The mask editor can save up to 32 source-pixel areas by numeric coordinates. The mask JSON stores the source and mask hashes, oriented dimensions, one to 32 nonempty in-bounds source-pixel rectangles, evidence version and its SHA-256 digest. Validation checks the digest and requires source and mask alpha to be fully opaque in each rectangle. Older clients reject v3 archives and unfamiliar local mask fields; preserve the v3 archive and use a current client. Changing the manifest to claim v2 is rejected. An unkeyed hash is not authentication; regions are user-selected and do not establish completeness. Approval and export do not yet enforce this evidence.

Earlier `1.0.0` product/original/mask archives remain importable. Full project archives may contain historical v1 or structured v2 QA reports; existing v1 history is retained without rewriting. Clients predating structured QA cannot safely read archives containing v2 reports. The preview reports counts and uncompressed archive bytes; actual browser storage use differs. Cancellation is available before commit.

An unsigned ZIP and its hashes do **not** authenticate its provenance or reviewer. Imported reviews and decisions remain historical records and cannot approve an output. Each imported output needs a fresh local review and a separate decision before becoming eligible for the approved-output bundle. All imported attempts remain untrusted: same-job retry and gateway acknowledgement by imported ID are unavailable. Imported uncertain, interrupted, prepared, previously acknowledged or rate-limited attempts block new generation until the user explicitly reviews billing and rate limits externally and records a local-only acknowledgement; the original attempt and outcome remain unchanged. Imported timestamps cannot impose a trusted delay after this review. A separate gateway journal can still block requests. A new job requires a new attempt ID and fresh consent.

These local trust barriers and unkeyed history heads are not tamper-proof against an actor with direct write access to the browser's IndexedDB: such an actor can alter both review history and its local guard records. Protect the browser profile and device; independent production security acceptance remains open.

Backups are unencrypted and include prompts, estimates, product details, review notes, structured findings, images and potentially EXIF metadata. Choose a trusted destination. The metadata scanner rejects certain recognizable credential patterns, but cannot detect every secret and does not inspect image pixels or EXIF for secrets. Never put credentials in project data or images; provider keys, gateway sessions and credentials are not part of the archive.

Limits are 340 MiB compressed, 2,001 ZIP entries including the manifest, 1 MiB per JSON file, 20 MiB per image, 338 MiB total expanded, 512 mask versions and a 200:1 expansion ratio. Validation also rejects more than 268,435,456 estimated pixel-work units per pass: each original's pixels, twice the source pixel count for each mask, 1,048,576 per output, and for each composite an additional twice its source pixels plus three output-sized images, two more for an ad and one for a copy layer. This conservative bound can reject an otherwise valid large project; it never deletes or silently omits data. Cancellation is checked between validation steps and mask pixel strips, but an individual browser image decode cannot be interrupted. Import rejects encrypted, executable, linked, duplicate, unsupported or unsafe entries and checks integrity, hashes and references. These controls do not replace independent security review or real-device storage testing.

### Approved output bundle (not a project backup)

The browser can create a separate local ZIP for selected current, human-approved STRICT composites across the seven styles. It verifies the current product snapshot, source, source-specific mask, scene, recipe, output, review and decision lineage, re-renders and compares the composite, then rechecks the selected batch in one IndexedDB snapshot immediately before initiating download. Rejected, stale and unverifiable images are not eligible; a corrupt candidate surfaces an error rather than being silently treated as approved. Approval applies to the original composite; conversion requires separate human inspection and confirmation of every displayed converted output.

Ratios are 1024×1024 (1:1), 1024×1280 (4:5), 900×1600 (9:16) and 1600×900 (16:9). The entire square composite is uniformly fitted without cropping; PNG/WebP margins are transparent and JPEG margins are white. Downscaling and lossy encoders can change labels or colors, so inspect the preview at native pixels. Encoder fallback to a different MIME type is rejected. These are generic sizes, not marketplace compliance claims.

The output ZIP contains UUID-named outputs, per-output allowlisted provenance and a schema-validated `export-manifest.json` with file hashes. Versioned provenance includes the exact provider prompt, product name, category, selected confirmed facts, source/mask/scene/composite and product hashes, the protected-evidence digest when present, attempt/job/review/decision IDs and times, immediate `retryOf` predecessor when applicable, recipe, conversion metadata and available sanitized usage/cost snapshot. Billboard exports include the complete ad and, when copy is supplied, its frozen copy layer; the recipe contains the supplied copy. Reviewer notes, structured findings, original images and EXIF are omitted; full project backups retain QA history. This unencrypted bundle may contain sensitive imagery and project data and is **not importable as a project backup**. Limits: 100 outputs, 20 MiB per image and 320 MiB expanded data. Unsupported provenance fails closed.


## Full backup ZIP structure

```text
project.json
export-manifest.json
originals/<assetId>.<png|jpg|webp>
masks/<maskId>.json
masks/<maskId>.png
history/jobs/<jobId>.json
history/attempts/<attemptId>.json
history/assets/<assetId>.json
history/assets/<assetId>.png
history/ads/<assetId>.png          # optional billboard ad
history/copy-layers/<assetId>.png  # optional frozen copy layer
history/qa/<qaId>.json
history/heads/<assetId>.json
```

## Export invariants

- A full backup uses `approvedOnly=false` and marks its files unapproved; historical approval records are not inherited as current approvals. The separate approved-output bundle contains only currently approved selections.
- SHA-256 for each file payload; manifest declares schema version, createdAt, projectId, filename, MIME, bytes, source/attempt lineage and `approved` flag.
- Metadata is schema-checked and scanned for recognizable credential patterns; this cannot prove absence of secrets. Paths use fixed UUID-based names, never user-supplied absolute paths or `../`.
- Format conversion PNG/JPEG/WebP: record format, dimensions, resampling/quality flags; transparent assets exported as JPEG need explicit background fill, not black artifacts.
- Output channel presets require actual current platform rule validation; defaults use generic sizes, not claims of official compliance.

## Import validation

1. Validate ZIP central directory, fixed max entries, max compressed/uncompressed bytes and ratio, path traversal, link/symlink contents, MIME and image dimensions.
2. Require supported manifest version, local cross-reference integrity, unique IDs and SHA-256 digest matches.
3. Reject conflicts; never overwrite an existing product, SKU or record. ID remapping and merging are not implemented.
4. Preview counts and uncompressed archive bytes. Commit all records atomically or retain the previous database unchanged.
5. Preserve imported QA as untrusted history and require a fresh local review and decision, even when hashes match.

## Compatibility

`export-manifest.schema.json` is the target JSON contract. Demo fixture is in [`fixtures/sample-export-manifest.json`](../../fixtures/sample-export-manifest.json); its dummy hashes and product IDs are synthetic test data.
