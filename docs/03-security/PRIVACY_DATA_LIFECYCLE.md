# Privacy, Rights, Retention and Deletion

## Data inventory

| Data | Location | Retention / deletion | Classification |
|---|---|---|---|
| Original product photos | Browser IndexedDB only P0 | Until user deletes, browser evicts or import/export; backup user-controlled | Merchant-confidential possible |
| Product facts / SKU | Browser IndexedDB | User-controlled | May contain personal/customer data; discourage uploads |
| Generated results and QA | Browser IndexedDB | User-controlled; export ZIP can retain copies | Merchant-confidential possible |
| BYOK provider key | Owner-controlled server secret configuration and transient authorized provider processing | Owner provisions, rotates and removes server configuration; provider revocation is separate; never sent to browser | Secret, extremely sensitive |
| Provider authorization session | Server session and HttpOnly cookie | Expires or disconnects independently of server key | Auth credential |
| Cookie/session ID | HttpOnly cookie + server | TTL or logout | Auth credential |
| Server telemetry | Redacted, aggregate only | Configurable 7–30 day log window; final retention policy open | Operational metadata |
| OpenAI provider input/output | Third-party provider | Governed by current OpenAI API terms/policies; verify separately | Third-party processing |

## User controls

Provide UI to delete one SKU or all local projects, warn about downloaded exports, disconnect the provider authorization session, and view the privacy disclosure. Disconnect does not delete the server-configured key or revoke it with the provider. Deleting locally cannot delete already downloaded ZIPs or automatically revoke files persisted by third parties.

## Images and commercial rights

Seller confirms ownership or authorization for source photography, brand logo, user-supplied promotional copy and rights to process with an AI vendor. Never remove watermark/rights notice by default. No fabricated safety or medical claims. UGC-style visuals may be AI-rendered scenes; do not portray them as verified customer testimonials. Regulated categories require manual approval and category-specific restrictions before publishing.

## Minimal data footprint

- Prefer no server storage of product images in P0. If proxy or provider SDK temporarily buffers image bytes, delete promptly and document.
- Avoid third-party trackers in editor; no photo/Key data in analytics.
- Store locally in versioned format; backup encrypted at user discretion only if explicitly implemented and tested.
- Hashes identify data integrity, not permissions. Do not hash a low-entropy human secret as substitute for encryption.

## Singapore/Malaysia expansion considerations

If actual personal data is collected, complete jurisdiction-specific privacy notices and legal review (e.g. Singapore PDPA, Malaysia PDPA as applicable). Do not describe this design as certified compliant. This project targets product photography and should discourage personal-identifiable photos in P0.
