# KPI Framework and Pilot Exit Criteria

## North-star metric

**Cost per Human-Approved, Brand-Faithful Exported Asset (USD / approved asset)**, paired with accuracy guardrails. Formula = measured provider spend for all relevant attempts (incl. failed/unknown where billed) ÷ number of *approved and exported* usable assets; avoid treating all generated assets as successful.

## Primary metrics

| Metric | Definition | Initial pilot target (hypothesis, not benchmark) |
|---|---|---|
| Human Approval Rate | approved attempts / successfully rendered attempts | establish baseline; avoid optimizing it by hiding rejected images |
| Brand Hard-Veto Rate | attempts failing identity/label factual rule / rendered attempts | <5% for STRICT with good reference; target to test, not guarantee |
| Cost / approved asset | total provider cost incl. retry / approved exports | compare to pilot seller ceiling, no fixed claim yet |
| Time-to-first-approved | minutes from source verified to first usable export | <10 minutes as hypothesis; measure separately by device |
| Unknown Billing Event Rate | ambiguous submitted attempts / submitted attempts | <1% pilot target, always surface |
| Export Restore Integrity | hash-valid imports / tested backups | 100% for fixture suite |
| Offline Edit Continuity | offline edits / offline test attempts | 100% within supported local operations |
| Key Exposure Findings | actual key leakage in browser storage/logs/ZIP/tests | 0 blocking findings |
| PWA Update Completion | controlled update successes / update test runs | 100% of test matrix |

## Secondary metrics

- Completion funnel: upload → facts confirmed → mask accepted → BYOK connected → first job → first QA → first export.
- Per-style approval / retry rate and cost; segment by category and source quality.
- User opt-in satisfaction, willingness to pay, retention after seven days; do not claim predictive business success from engineering E2E.

## Metric hygiene

- Persist no key, raw sensitive photo, or private text in analytics. Events use random project/job identifiers and aggregate counts.
- `UNKNOWN` spends are displayed as unconfirmed until reconciled; do not silently treat as zero.
- Distinguish model cost estimate, observed token usage, and actual provider invoice; cached prices differ by API route.
- Document the sample size and uncertainty; avoid marketing claims based on 1–2 images.
