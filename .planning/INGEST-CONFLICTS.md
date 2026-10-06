## Conflict Detection Report

### BLOCKERS (0)

No blockers detected.

### WARNINGS (0)

No warnings detected.

### INFO (2)

[INFO] No cross-source conflicts detected
  Note: single-document ingest — docs/clinic-management-prd.md is the only classification in CLASSIFICATIONS_DIR (type: PRD, confidence: high, cross_refs: empty). No ADR/SPEC/DOC sources present, no locked decisions, no competing PRD variants, no cross-ref cycles. MODE: new with empty EXISTING_CONTEXT, so no merge-mode comparisons applied.

[INFO] Source-flagged open question: billing module scope unconfirmed
  Note: docs/clinic-management-prd.md §4.10 marks the billing/invoicing module as "not explicitly requested but essential — flagged as an assumption; confirm before build", and §9 open question 1 repeats it as unresolved. REQ-billing-invoicing is extracted with acceptance criteria preserved and this status noted; the roadmapper should treat its scope as provisional pending user confirmation.
