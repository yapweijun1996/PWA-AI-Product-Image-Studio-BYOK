# Documentation Index

| Directory | Primary documents | Purpose |
|---|---|---|
| [00 Governance](00-governance/SSOT_POLICY.md) | SSOT_POLICY, DECISION_REGISTER, REQUIREMENTS_TRACEABILITY, EVIDENCE_STATUS, GLOSSARY | Authority and traceability |
| [01 Product](01-product/PRD.md) | PRD, PERSONAS, USER_FLOWS, UX_SPEC, FEATURE_PRIORITY, KPI_SUCCESS | What and why |
| [02 Architecture](02-architecture/SYSTEM_ARCHITECTURE.md) | SYSTEM_ARCHITECTURE, IMAGE_PIPELINE, JOB_ORCHESTRATION, PWA_OFFLINE, DEPLOYMENT, ADR, [PI_TEXT_BOUNDARY](02-architecture/PI_TEXT_BOUNDARY.md) | How the proposed system is divided |
| [03 Security](03-security/BYOK_SECURITY.md) | BYOK_SECURITY, THREAT_MODEL, PRIVACY_DATA_LIFECYCLE | Trust boundaries and controls |
| [04 Data](04-data/DATA_MODEL.md) | DATA_MODEL, INDEXEDDB_AND_MIGRATION, EXPORT_IMPORT | Entities, persistence and portability |
| [05 API](05-api/API_CONTRACT.md) | API_CONTRACT, OPENAI_ADAPTER, ERROR_RETRY_COST | Gateway behavior and vendor adapter |
| [06 AI](06-ai/BRAND_LOCK_ENGINE.md) | BRAND_LOCK_ENGINE, SEVEN_STYLE_ENGINE, VISUAL_QA, PROMPT_CONTRACT | Identity protection / AI prompts |
| [07 Quality](07-quality/TEST_STRATEGY.md) | TEST_STRATEGY, E2E_ACCEPTANCE, SECURITY_PERFORMANCE, RELEASE_GATES, EVIDENCE_TEMPLATE | Validation and release decision |
| [08 Delivery](08-delivery/ROADMAP.md) | ROADMAP, EPIC, TASK, AI_AGENT_HANDOFF, DEV_OPERATIONS | Execution handoff |
| [09 Research](09-research/SOURCES.md) | SOURCES, COST_MODEL, COMPETITION, PILOT_EXPERIMENT, [BYOK_FIDELITY_FOLLOWUP](09-research/BYOK_FIDELITY_FOLLOWUP.md), [UI_UX_LAYOUT_RESEARCH](09-research/UI_UX_LAYOUT_RESEARCH.md), [PI_OPENAI_SPIKE](09-research/PI_OPENAI_SPIKE.md), [SPIKE_TEST_PLAN](09-research/SPIKE_TEST_PLAN.md), [PERSONA_REVIEW](09-research/PERSONA_REVIEW_2026-10-30.md), [CODE_REVIEW](09-research/CODE_REVIEW_2026-10-30.md) | Verification, viability, cost, layout, spikes and reviewer findings |
| [10 Design](10-design/DESIGN_SYSTEM.md) | [DESIGN_SYSTEM](10-design/DESIGN_SYSTEM.md), [VISUAL_ANCHORS](10-design/VISUAL_ANCHORS.md) | Proposed visual system and image catalog |

## Document semantics

Every architecture diagram and interface here is **proposed** unless a future evidence record changes its status. Data schemas and OpenAPI are proposed **contracts**, not deployed endpoints. Source dates matter; consult [SOURCES](09-research/SOURCES.md) before relying on vendor API details.

## AI agent handoff

Start with repository `AGENTS.md` and [AI_AGENT_HANDOFF](08-delivery/AI_AGENT_HANDOFF.md); execute one task ID at a time, update code evidence and SSOT documents together, and do not change user-confirmed product invariants without consent.
