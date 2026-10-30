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

## Node and container restrictions are not the IPC boundary

A local Node 22 container experiment found that disabling container networking, dropping capabilities, making the root read-only and using an unprivileged user did not prevent that process from starting another Node executable. Enabling Node's permission model denied the tested `child_process.spawnSync` calls, but the same process still opened a TCP server and client on loopback inside its isolated network namespace. These are narrow observations, not an escape or a complete sandbox test. [Node 22 documentation](https://nodejs.org/docs/latest-v22.x/api/permissions.html) explicitly says its permission model does not provide security against malicious code and identifies inherited descriptors and other limitations.

Consequently, neither a shell-free image, `--network none` nor Node permissions establish authenticated IPC or OS-level no-exec isolation. A production candidate must identify the peer and broker and restrict the channel and inherited descriptors, then verify those controls on the actual Pi runtime; no real key is authorized by this experiment.

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

## Version-specific SDK integration seam — 2026-10-31

The locally installed Pi coding agent and its `pi-ai` dependency both report version 1.4.0. Their distributed TypeScript declarations expose `ModelRuntime.registerNativeProvider`, a provider factory accepting a model catalog and chat stream implementation, and stream methods returning an assistant-message event stream. The existing [synthetic probe](../../app/spikes/pi-seccomp/probe.mjs) already registers Pi's faux provider and runs an in-memory session with a synthetic tool; it does not implement a broker. The current upstream [SDK guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) and [provider migration notes](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md) describe host-controlled runtime/provider composition, but their moving `main` branch is not a version-pinned contract for 1.4.0.

**Candidate only:** A future isolated host could register a narrowly scoped provider implementation that translates the Pi stream interface to an independently authenticated, bounded broker operation. The host must not receive a real upstream credential or choose arbitrary endpoints. The broker, rather than Pi's provider configuration or a prompt, must enforce authorization, model policy, spending limits, cancellation and UNKNOWN handling. The shape, streaming semantics, error mapping, authentication and security of such a bridge remain unimplemented and unreviewed; the interface's existence is not proof that the bridge is safe or feasible. Pin and verify the exact SDK/runtime and design against the actual deployment architecture before implementation or key use.

### Synthetic provider plumbing observation — 2026-10-31

The existing disposable Linux ARM64 probe now registers a custom provider for a keyless in-memory Pi 1.4.0 session and forwards one scripted request to an in-process faux model. Both control and filtered containers returned the scripted response with one forwarded call and one faux-model call. Direct calls using an unexpected synthetic model ID or provider ID were rejected before forwarding. This checks only the exercised SDK stream plumbing and local fixture predicate: no real broker, IPC, principal binding, budget, provider credential, network request, cancellation, crash recovery or production security property was tested. It does not satisfy T-032/T-034 or authorize enabling Pi in the app. The [probe README](../../app/spikes/pi-seccomp/README.md) states its execution and limitations.

## Linux seccomp no-exec feasibility observation

A disposable ARM64 Linux container experiment used Node 22.23.4 and `@earendil-works/pi-coding-agent` 1.4.0, installed without package lifecycle scripts. A startup-loaded native library installed a `no_new_privs` seccomp-BPF filter that checked the AArch64 audit architecture and returned `EPERM` for `execve` and `execveat`. Under network mode `none`, read-only root, dropped capabilities, `no-new-privileges`, an unprivileged UID and a bounded tmpfs, a Pi in-memory session with an empty resource loader and no tools initialized. Attempts to start `/bin/sh` and a second Node process returned `EPERM`; a Node worker-thread shell attempt also returned `EPERM`. Without the filter, the same container started both executables. Direct Node entry was necessary: applying the filter to the default shell entrypoint blocked that entrypoint from executing Node.

The same filtered session could create and use a loopback TCP connection and read a deliberately supplied synthetic environment marker. No real key, provider call or external network was used. This is an experiment, not a reviewed launcher or a complete security boundary: the runtime inherited an environment, the test did not authenticate an IPC peer, and `LD_PRELOAD` startup enforcement, library integrity, descriptor inheritance, file isolation, platform and syscall ABI handling, process privilege separation and other escape paths remain unresolved. The filter's tested AArch64 behavior cannot be extrapolated to other architectures or production deployments. The [Linux kernel seccomp documentation](https://docs.kernel.org/userspace-api/seccomp_filter.html) describes filtering and inheritance; [no-new-privileges documentation](https://cdn.kernel.org/doc/html/latest/userspace-api/no_new_privs.html) describes the privilege flag and its limits. These observations do not satisfy T-032 or authorize T-033, key use or deployment.

The opt-in [reproduction spike](../../app/spikes/pi-seccomp/README.md) pins the Pi package and Node base image, uses an allowlisted Docker build context and runs both a control and filtered container. It is deliberately separate from the application and prints only synthetic outcomes. Its npm dependency lock and public Alpine build packages are experimental inputs, not a production supply-chain approval.


## Synthetic Pi model and tool workload under the no-exec filter

The reproducible ARM64 experiment now also creates a separate in-memory Pi SDK session with a scripted faux model, an in-memory synthetic auth fixture and only a synthetic echo tool. In both control and filtered containers, a valid call reached the tool once; a call with invalid arguments and a call to the unavailable `bash` tool produced tool errors without invoking the echo tool again. Six scripted model responses completed. The existing shell, Node and worker-thread subprocess controls continued to pass: execution succeeded in the control and returned `EPERM` with the filter. No real provider, customer data, credential or network was used.

This validates only the exercised SDK and filter combination. The faux model is deterministic, the arguments are synthetic, and there is no authenticated broker IPC, principal binding, actual provider, image operation or independent sandbox review. Pi's tool allowlist is not a process isolation boundary; the same environment marker and loopback limitations described above still apply. T-032 and T-034 remain open and T-033 remains gated.

## Synthetic Linux peer-identity experiment

A disposable Linux ARM64 experiment used a Unix-domain stream socket shared by separate, network-disabled containers. The server inspected `SO_PEERCRED` and accepted UID 1002 while rejecting UID 1003. Two independent clients with UID 1002 were both accepted. This demonstrates the narrow limitation that peer UID alone cannot distinguish runs or principals that share an OS identity; it does not demonstrate an authenticated Pi-to-broker channel.

The [reproducible probe](../../app/spikes/pi-peercred/README.md) uses only synthetic processes and a temporary Docker volume. Its shared directory and socket permissions are deliberately permissive and unsuitable for production. [Linux unix(7)](https://man7.org/linux/man-pages/man7/unix.7.html) describes peer credentials as captured at connection time. [Docker's UID mapping documentation](https://docs.docker.com/engine/security/rootless/uid-gid-mapping/) explains that mappings vary with daemon configuration. The observed result therefore does not establish behavior across all user namespaces or platforms.

The probe does not authenticate the server, bind browser principal or run, handle replay or revocation, prove secret isolation, or exercise Pi. A reviewed private IPC path, principal-bound capabilities, OS sandbox and security review remain required. This is evidence for T-032/T-034 design, not acceptance of either task or authorization to use real credentials.
