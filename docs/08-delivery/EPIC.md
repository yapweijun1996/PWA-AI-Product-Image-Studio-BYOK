# EPIC Catalogue / User Outcomes

| Epic | Outcome | Critical FR IDs | Dependency / gate |
|---|---|---|---|
| EP-01 Local SKU Workspace | Seller keeps a verified portable source of truth | FR-001..003,016..017,022 | schema + backup correctness |
| EP-02 Secure BYOK Gateway | Seller uses own provider Key without browser secret persistence | FR-009,024, NFR-001/002 | auth, custody decision, security review |
| EP-03 Image Generation Engine | Seller selects any 1–7 independent photo styles and sees cost | FR-006..010,014..015,021/023 | provider adapter, queue status and budget |
| EP-04 Brand Lock & Composite | Actual product graphics are not quietly redrawn | FR-004..005, NFR-003 | mask/original asset + camera feasibility |
| EP-05 QA & Export | Only reviewed trustworthy assets labeled approved | FR-011..013,022 | weighted QA, hard-veto, human approve |
| EP-06 Installable Mobile PWA | App-like offline user experience and safe updates | FR-018..020, NFR-006/007/010 | real iOS and SW upgrade E2E |
| EP-07 Release & Ops | Operators can diagnose costs, rate limits and incidents without leaking secrets | FR-023..024, NFR-005/009/011 | security test, pilot and owner approval |
| EP-08 Listing Studio Expansion | Seller manages catalog and copy / batches / ecommerce sync | FR-025..026 | post-MVP only |

An epic is complete only when all linked P0 tasks have code plus test evidence. Docs alone do not count.
