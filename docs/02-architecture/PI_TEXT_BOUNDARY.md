# Pi Text-Model Boundary — T-034 Candidate

**Status: PROPOSED, not implemented or security approved.** This is a reviewable candidate for [ADR-006](ADR.md); it does not change the gateway contract, grant access to a real key or satisfy T-032/T-034. The initial development gateway is loopback-only and has no text broker.

## Goal and non-negotiable boundaries

The browser-facing Pi agent needs a text-model path without receiving provider credentials, browser cookies, CSRF tokens, image-approval authority or unrestricted networking. The key-holding broker remains a separate trusted process. A prompt, SDK tool allowlist, loopback port or shared environment alone does not prove isolation. Local processes and user-controlled image/text inputs are potentially hostile. Public hosting and multi-user custody are not approved by this proposal.

## Candidate request lifecycle

1. The authenticated browser initiates an agent run through the trusted gateway with a bounded task context and explicit user-visible text-usage budget. Gateway validates the current principal and provider authorization and creates a short-lived, single-run capability **for the host**, never forwarding browser session, CSRF or image-approval credentials to Pi. The exact operation for delivery and OS identity binding must be selected and reviewed; a bearer token on an exposed loopback endpoint is insufficient.
2. The isolated host requests a fixed text operation over a private, authenticated, bounded IPC channel. The broker derives principal and run identity from the authenticated channel/capability, not request-provided identifiers. Inputs contain only allowed messages and explicit tool-result data; model identifier, endpoint, credentials, arbitrary HTTP headers and network destinations are not caller-controlled. Strict message/schema, byte, count and output-token bounds apply before dispatch. Treat prompt and tool content as data, not authorization.
3. Before every billable provider dispatch, atomically reserve a per-run and per-principal allowance against a server-owned budget and concurrency/request limit. Bind the reservation to run, principal and a unique request ID. The operator supplies a reviewed model allowlist and current price/usage policy; if the price, quota, authorization or reservation state is unavailable, fail closed before dispatch. Local estimates are not an account-wide provider spending cap.
4. The broker uses its own credential and fixed provider endpoint. It applies a bounded timeout and bounded response/stream size, disables automatic retries after ambiguous dispatch and returns only schema-validated, sanitized content and allowed usage. Unrecognized model tools, redirects or provider-directed URLs do not grant new capabilities. Provider text is untrusted and cannot directly authorize image generation or tool execution.
5. Record a minimal non-secret outcome and usage state. A confirmed pre-dispatch refusal releases its reservation; a definitive provider response reconciles it with known usage. If dispatch may have occurred but usage/outcome is unknown, retain an unresolved reservation and surface UNKNOWN for explicit review. A new billable attempt requires a fresh request ID and authorization under the agreed budget policy. Crash/restart recovery must not silently resend or discard unresolved records.
6. End, expiry, logout or revocation terminates access for new requests and removes short-lived capabilities. Cancellation cannot be presented as proof that a sent provider request was unbilled. Durable audit data must exclude credentials and raw provider errors; retention, deletion and minimal transcript requirements require owner/security review.

## Process isolation and IPC acceptance

- A reviewed OS sandbox must prevent the Pi process from reading broker memory, files, environment, secret mounts and browser credential stores, executing unapproved shell/programs or opening arbitrary network connections. Specify supported host OS, user/namespace boundaries, inherited descriptors, filesystem mounts, privilege changes, resource limits and lifecycle. A container with `/bin/sh` available is not a no-shell proof.
- IPC must authenticate both peer and broker, bind capability to one run/principal and expire/revoke safely. Test forged, replayed, expired and cross-principal capabilities, peer replacement and revoked in-flight access. No client-provided principal or path can expand access.
- Pi SDK must be pinned with a compatible Node runtime. Disable extension/resource autoload and only expose explicitly reviewed tools. Sandbox escape and tool-prompt injection tests must exercise the actual packaged runtime, not only a mocked registry.

## Verification matrix before enablement

| Boundary | Required synthetic evidence |
|---|---|
| Authentication | Forged, expired, replayed, cross-run and cross-principal IPC requests make zero provider calls; logout/revocation blocks subsequent calls. |
| Input and routing | Invalid schema, oversize input/output, model/URL/header injection and unauthorized tools are rejected before transport. |
| Budget | Concurrent reservations cannot exceed the server-enforced run/principal limits; exhausted or unknown policy fails before transport. Partial usage, missing usage and timeout do not release funds as if no charge occurred. |
| Failure and recovery | Test cancellation before/after dispatch, provider error, process crash, restart, duplicate IDs and ambiguous outcome. No automatic second dispatch or silent loss of unresolved reservation. |
| Isolation and redaction | Actual sandbox attempts to read fake broker secret, environment, file and network fail; fake credentials and raw provider error bodies are absent from browser, Pi transcript, logs and backups. |
| Integration | Fake transport and separate isolated principals exercise a browser-to-Pi-to-broker run end to end. A security reviewer signs off on threat model, IPC, secret lifecycle and evidence before a separately authorized bounded live call. |

## Open design questions

Select a supported OS sandbox and authenticated IPC transport; define approval UX and exact text-budget units, durable reservation storage/recovery, rate snapshot ownership, transcript retention, model capability and streaming semantics. Decide whether/how browser disconnect cancels an active run. These are unresolved design questions, not product decisions or evidence of implementation.
