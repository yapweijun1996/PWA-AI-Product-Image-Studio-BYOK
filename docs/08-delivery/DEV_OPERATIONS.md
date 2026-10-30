# Development, CI, Observability and Recovery Runbook (Proposed)

## Dev workflow

- Before coding, capture repo HEAD, flags, environment, docs version; do not guess versions installed in nonexistent code.
- Suggested stack: React + TypeScript + Vite; Tailwind CSS; IndexedDB/Dexie; Canvas/Web Worker; Vite PWA/Workbox; Cloudflare Worker Gateway. Pin dependencies and run `npm audit`/lockfile review as appropriate.
- Use strict TS and stable contracts; never build against assumed provider output. Implement stubs before live provider connection.
- Complete the static build before starting the local gateway. It snapshots the allowlisted build files in memory at startup; rebuilding its directory does not update the running process. To adopt a completed new build, wait for in-flight attempts to settle, preserve UNKNOWN outcomes and the journal, then restart the gateway. Restart invalidates local app/provider sessions; reconnect explicitly. Do not rebuild the static directory concurrently with gateway startup.
- The local snapshot requires Node's `O_NOFOLLOW` support and fails to start when it is unavailable. Only the final path component is protected this way; the configured build tree and its ancestors must be trusted and stable during startup. This does not provide isolation against a hostile local filesystem writer.

## CI gates

`typecheck → lint → unit → schema/OpenAPI validation → integration w/ stub → browser smoke → no-secret scan → docs/links check`. Real provider API call is a manually approved, cost-capped staging smoke, never CI job with merchant keys.

## Observability

- Client local: attempt ID/state, duration, model/quality/size, errors, estimated/observed usage status. No Key/full prompt/source image in automatic telemetry.
- Gateway redacted: request ID, authenticated principal pseudonymous ID, endpoint, model, billed-outcome ambiguity, latency bucket, status, rate response. Not raw credentials or product data.
- Alert: unusual 429/5xx, repeated unknown charges, failed session revoke, mismatch deployment version, image decoding errors.

## Operations playbooks

**API 401:** expire session; check selected model/organization verification; user reconnect. No retry with operator's own API Key.  
**API 429:** obey Retry-After, pause pending queue, show cost/limit guidance.  
**Gateway 5xx:** avoid auto resubmission if request may have reached provider, preserve UNKNOWN.  
**DB quota:** offer ZIP export/cleanup; do not overwrite original.  
**Bad SW deployment:** show update recovery; rollback static build compatible with IndexedDB; avoid silent refresh.  
**Secret incident:** revoke application/provider authorization sessions, remove and rotate the owner-configured server key and revoke it at the provider as appropriate; investigate redacted logs and affected users, then follow the incident response process. Disconnect alone does not remove or revoke the key.

## Release record

No release is claimed in this bundle. Record actual URL, account, environment, branch SHA, release tag, Service Worker build ID, database migration version, smoke logs, owner approval, rollback commit and incident contact after deployment.
