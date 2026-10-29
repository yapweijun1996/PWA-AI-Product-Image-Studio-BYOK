# OpenAI Provider Adapter / 2026-10 Reference

**Snapshot date:** 2026-10-29. Validate vendor models, cost, params, verification requirements, API response shape and account eligibility again before coding. Source links in [SOURCES](../09-research/SOURCES.md).

## Supported initial options (proposal)

| Model ID | Product UI label | Intended usage |
|---|---|---|
| `gpt-image-2.5-flare` | Faster | Fast scene generation / previews |
| `gpt-image-2.5-sunburst` | Precision | More demanding reference edits / final candidates |

Official developer docs support `/v1/images/generations` and `/v1/images/edits`; Responses API + image_generation tool supports multi-step chat editing but is not necessary for P0. `gpt-image-1` was shut down on 2026-10-23; do NOT default to that retired model.

## Request mapping

| App intent | Provider | Notes |
|---|---|---|
| `generate_scene` | `POST https://api.openai.com/v1/images/generations` | Prompt should produce background/empty space; product composited later |
| `reference_edit` | `POST https://api.openai.com/v1/images/edits` | Use supplied source images/authorization, clear preserved features |
| `concept` | `POST .../images/generations` | Mark creative concept; no fidelity claims |

Quality: `low`, `medium`, `high`, `xhigh`, `max`, `auto` for 2.5 models. Recommend explicit `quality` and explicit `size` for repeatable cost comparisons. Transparent output: use PNG/WebP, not JPEG. 2.5 supports flexible dimensions under current documented constraints (multiples of 16, ratio 1:3–3:1, max edge 3840, bounded total pixel count); vendor rules can change. User app should validate before request. Mask/markup behavior may differ per API route/model; revalidate current docs before use.

## Truth boundaries

- Generation image may change product packaging, logos and Chinese text. STRICT requires actual original-product compositing.
- Do not assume AI can infer camera angle or recover hidden labels.
- Model result and decoded bytes are untrusted. Verify format, pixel dimensions, result count, usage types and errors.
- No model health claim, review rating or price can come from prompt improvisation.

## Usage and billing nuance

Official 2026-10 documentation: both GPT Image 2.5 models list Standard rates of $8/1M image input tokens, $30/1M image output tokens, $5/1M text input; cached rates are lower but the API route matters. **Cached image generation input pricing applies to Responses image generation tool, not direct Images API.** Images API response usage availability/details must be tested against chosen model and SDK; a missing `usage` is not evidence of free requests. If using Responses, count top-level mainline model cost as well as image tool usage. Retain API route, model, quality, dimensions and pricing snapshot with each attempt.

## API-key isolation

Bearer authorization is only set by trusted backend from server-resolved user vault. No frontend direct `api.openai.com` calls in public production and no user-provided base URL that could redirect authorization to attacker server.

## Error taxonomy

- `401/403` provider auth or project access, redact, show reconnect/permissions action.
- `429` provider rate; parse `Retry-After`, do not launch seven simultaneous attempts by default.
- `400` invalid prompt/model/size / content rejection; correct input, not blindly retry.
- `5xx` or connection timeout before definitive response: UNKNOWN if request may have reached provider; user-controlled retry only.
- Invalid returned bytes/usage: FAILED or QA block, never mark approved.

## Live contract probe checklist

Before production, verify a stub + one authorized low-cost real request: exact HTTP method/content type; provider request ID; generation/edit response; `usage` availability; quality/size support; image data format; timeout; organization verification; model rate limit headers; spend. Store only sanitized fixtures.
