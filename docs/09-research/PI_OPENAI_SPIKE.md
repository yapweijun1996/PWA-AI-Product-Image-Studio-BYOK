# Pi and OpenAI BYOK Spike

**Date:** 2026-10-29 (Asia/Singapore). **Scope:** bounded local developer experiment, not a product implementation, security certification or production release. The owner explicitly requested the spike and provided an ignored local `.env`; no key value is recorded here. The [decision register](../00-governance/DECISION_REGISTER.md), [ADR-006](../02-architecture/ADR.md) and [task ledger](../08-delivery/TASK.md) remain the authorities for product decisions and implementation status.

## Results

| Probe | Result | Evidence and limit |
|---|---|---|
| Local Pi | PASS | `pi --version` returned `1.4.0`. |
| Credential presence | PASS | `.env` had a nonempty `OPENAI_API_KEY` entry; `git check-ignore` confirmed it is ignored. Presence alone does not establish broader account/model access. |
| Pi text request using OpenAI | PASS | Pi 1.4.0, `openai/gpt-4.1-mini`, thinking off; a fixed prompt returned `PI_SPIKE_OK`, exit 0. A prior sandboxed attempt returned `Connection error`; a network-authorized run succeeded. No tools, MCP, extensions, skills, context files or persistent session were enabled. |
| OpenAI image generation | PASS | One direct Images API generation using `gpt-image-2`, low quality, 1024×1024, `n=1`; command reported completion in 11.3 s. Output was checked as a valid PNG (dimensions 1024×1024 and PNG chunk CRCs). Synthetic unbranded mug, not a seller SKU. [View image](evidence/openai-image-spike.png). |
| Pi tool → image API | NOT TESTED | The image request was made by the bundled image generation CLI, **not** by Pi calling an image tool. Neither browser UI nor gateway integration was involved. |
| Billing and usage | UNKNOWN | One Pi text request and one image generation were submitted successfully; exact token usage and invoice cost were not captured. Provider billing is authoritative. The initial sandbox connection failure is not evidence of an image generation request. |

Image SHA-256: `2f385101aac46389fe204fbdf9d14667f9ece1b3af3f69bb93e576befc3f5f0a` (1,129,902 bytes). The image is a test artifact; its visual quality and brand fidelity are not assessed as product acceptance.

## Execution boundaries

- The Pi run used an ephemeral settings directory, `--no-session`, `--no-tools`, `--no-extensions`, `--no-mcp`, `--no-skills`, `--no-prompt-templates`, `--no-themes`, and `--no-context-files`. The model saw only the synthetic fixed prompt. An agent with no enabled tools cannot demonstrate an image tool call; this experiment deliberately does not claim otherwise.
- The image command used the built-in imagegen skill's CLI and the official OpenAI Python SDK `2.54.0` installed into a temporary directory. The CLI constructs `OpenAI()` with the SDK's default retry count. The installed SDK default was observed as 2, so the temporary copy's `DEFAULT_MAX_RETRIES` was changed to 0 and the `OpenAI` constructor default was verified before the request. The image CLI and global SDK installations were not modified. This temporary test configuration is not a production retry-control solution.
- The image prompt requested a plain, unbranded white ceramic mug on a neutral studio background, with no logos or text. The resulting illustration contains no protected seller image or private source asset.
- Provider key was loaded from the ignored `.env` into child-process environment memory only; output was sanitized, the key was not placed in prompts, source, CLI arguments, reports or logs. The Pi settings directory and temporary SDK copy were removed after testing. Network access was explicitly enabled for the successful requests.
- The project environment template is not itself loaded by an application yet. The isolated spike does not validate session encryption, authentication, per-user key custody, client storage, revocation, CSRF, gateway egress or retention controls.

## Interpretation and next experiment

The Pi CLI can access the selected OpenAI text model with the owner's supplied key, and the same key successfully generated one image via the direct Images API at the tested settings. These are two separate verified connections. They do **not** demonstrate that Pi's SDK or `codemode` can invoke this OpenAI image model, that the selected Pi model is appropriate for production, or that the browser application exists. Installed Pi 1.4.0 documentation describes image models through `codemode` and provides OpenRouter examples; direct OpenAI image-model compatibility with Pi remains unverified. [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), [Pi model guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md), [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation).

A follow-up integration experiment should use Pi's Node/Bun SDK with only a mock, schema-validated image-generation tool, an in-memory session, no default coding tools, no untrusted extensions and synthetic input. Verify the tool allowlist, scoped requests, cross-session isolation and UNKNOWN/no-automatic-retry semantics before considering a separately budgeted live image-tool invocation. This remains planned; it has not been implemented or tested in this spike.

**Subsequent evidence:** the [Pi mock preflight record](../08-delivery/TASK.md#pi-mock-preflight-observation--2026-10-29) describes a later, bounded synthetic SDK tool-call/schema experiment. It is partial evidence only and does not establish a Pi-to-OpenAI image tool, process isolation or a complete integration.
