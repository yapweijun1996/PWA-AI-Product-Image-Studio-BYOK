# Test Strategy — Test Pyramid and Evidence

## Test tiers

**Unit (fast, mocked):** prompt builder, category filtering, style ID uniqueness, cost formula, SKU facts provenance, state-machine transitions, mask compositing math, score calculation, JSON Schema and backup file name validation. Unit tests must not spend OpenAI API.

**Integration (mocked/provider stubs):** same-origin Gateway session/CSRF/authz; Key encryption+revocation, allowed model + parameters, error body, 429/timeout UNKNOWN and cost/usage parsing, IndexedDB transactions, masking and ZIP import/export. Use sanitized provider fixtures; no user Key in CI.

**Browser E2E (Playwright):** source upload and seven-style selection, one-style exact request count, image compare, QA rejection, mobile responsive, offline local edits, SW N→N+1 update. Test with stub gateway output and fixed asset hashes; browser evidence links required.

**Manual and real-user tests:** iPhone installed PWA (real device), Mac/Windows/Android, actual visual Brand Lock quality per category, accessible keyboard and VoiceOver, controlled live provider call with disposable restricted test Key after authorization.

## Fixtures

- Five product categories × four synthetic/authorized SKU photos (20 representative products; test proposal).
- Include bilingual high-contrast packaging, tiny text, reflective glass, rough edges, front-only photography, transparent PNG, landscape, tall product, screenshots with UI overlays.
- Invalids: wrong MIME, EXIF rotation, 100MP/decompression bomb, corrupt base64, oversized input, mismatched mask, ZIP traversal, missing product original, duplicate UUID, impossible top-down.
- Vendor stub: success with usage, success without usage, auth error, content reject, 429, 5xx, truncated JSON, lost connection after provider acceptance.

## Gates

- Typecheck, lint, unit, integration, schema and no-secret static checks must pass.
- E2E P0 FR tests 100% pass on supported browser matrix or documented no-go; actual provider smoke must be reviewed and cost-limited.
- Visual fidelity cannot be proved by unit tests; human approval of pilot outputs required.
- Security-critical Key leak, unauthorized generation or incorrect STRICT label = release BLOCKER.
- Test results must identify actual branch SHA, environment, dates, commands, pass/fail counts; never fabricate.

## Coverage mapping

Requirements: [RTM](../00-governance/REQUIREMENTS_TRACEABILITY.md). Detailed scenario IDs: [E2E_ACCEPTANCE](E2E_ACCEPTANCE.md). Release sign-off: [RELEASE_GATES](RELEASE_GATES.md).
