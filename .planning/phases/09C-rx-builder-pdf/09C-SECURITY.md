---
phase: "09C"
slug: "rx-builder-pdf"
status: draft
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-22"
---

# Phase 09C — Security

> Per-phase security contract: threat register, accepted risks, and audit trail. Sources: the plan's threat register (`09C-PLAN.md`), the adversarial review
> (`09C-REVIEW-SEC.md`), the triage (`09C-REVIEW-TRIAGE.md`) and the fix round 09C-06a (`09C-NOTES.md`, migration `000120_rx_review_fixes`).
> Status values below are the fix round's own reading; the gate's verification and the PO's approval are still to come.

---

## Threat Register

| Threat ID | Component | Severity | Disposition | Mitigation | Status |
|-----------|-----------|----------|-------------|------------|--------|
| T-09C-01 | `change_prescription`, `repeat_visit_plan` (authz, tenant) | high | mitigate | session tenant, permission, closed key sets (000117 to 000119) | closed |
| T-09C-02 | Rx grant narrowing | high | mitigate | item writes revoked from `authenticated` (000117) | closed |
| T-09C-03 | medicine and substance search | medium | mitigate | fixed bodies, escaping (000117, 000118) | closed |
| T-09C-04 | favourites own-doctor (SA-02) | high | mitigate | doctor filter in `consult_assist_context` (000119) | closed |
| T-09C-05 | allergy check in both commands | high | mitigate | `private.rx_allergy_matches`; 000120 S-1 (substance OR name; a catalogue id must carry its brand's name), S-8 (FOR SHARE) | closed (residual S-3, accepted) |
| T-09C-06 | the client cannot claim "no match" | medium | mitigate | 000120 S-1 | closed by 09C-06a |
| T-09C-07 | allergy record | medium | mitigate | `record_patient_allergies`; 000120 S-2 (audit trigger for every writer), S-5 (no `{}` default), S-6 (erased refused), A-8 (stale write refused) | closed by 09C-06a |
| T-09C-08 | `repeat_visit_plan` | high | mitigate | source rules (000119); 000120 S-1 for copied ids | closed |
| T-09C-09 | PDF naming and cache | medium | mitigate | no patient name; 09C-06a S-9 (`private, no-store` on every answer, 403 `SUBSCRIPTION_LOCKED`) | closed |
| T-09C-10 | image metadata | medium | mitigate | 09C-06a A-6/S-4 (every pass-through strips JPEG APP1/APP13/COM, PNG eXIf/tEXt/iTXt/zTXt, WebP EXIF/XMP, or refuses) | closed by 09C-06a |
| T-09C-11 | archive write-once | high | mitigate | 09A pair unchanged | closed |
| T-09C-12 | WhatsApp opt-in | medium | mitigate | 09C-05 opt-in; 09C-06a A-19 (no send offered or queued for an opted-out patient or an unsigned Rx) | closed |
| T-09C-13 | rate limiting of the new routes and commands | low | accept | see the Accepted Risks Log | accepted |
| T-09C-SC | supply chain | low | mitigate | no dependency change | closed |
| S-7 | custom medicines read tenant-wide | low | mitigate | 000120: `doctor_custom_medicines_select` adds `doctor_id = auth.uid()` | closed by 09C-06a |

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-09C-01 | S-3 (T-09C-05 residual) | The v1 API prescription writer (`app/api/v1/prescriptions/route.ts`, service role, ADR-0005 register) skips the allergy check and the idempotency of `change_prescription`, stores an unchecked `cdci_brand_id` and gives the header the default A4 paper. R-1 defers the v1 API to V2-12, which replaces this writer. Until then an API key holder of a clinic can write a line the consult would have flagged; the consult's allergy context still flags such a line once it is read (000120 S-1: the name is always checked), and the review gate blocks Sign on an unresolved match. Owner: V2-12. | CTO delegate (09C-REVIEW-TRIAGE); PO to confirm at the 09C gate | 2026-11-22 |
| AR-09C-02 | T-09C-13 | No rate limit on the new search routes (`/api/prescriptions/medicines`, `/api/terminology/substances`) and the Rx commands beyond the session, the permission and the bounded inputs. They are member-only, tenant-scoped, and cheap (p95 under 50 ms for the reads, under 10 ms for the commands, `scripts/perf/command-latency.ts`). Rate limiting of member routes is V2-12 scope. Owner: V2-12. | CTO delegate (09C-REVIEW-TRIAGE); PO to confirm at the 09C gate | 2026-11-22 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-22 | 14 (+ S-7) | 12 | 2 (T-09C-06, T-09C-10) | isolated adversarial reviewer (`09C-REVIEW-SEC.md`) |
| 2026-11-22 | 14 (+ S-7) | 14 (2 accepted) | 0 | 09C-06a fix round (executor; to be re-verified by the gate's reviewer) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [ ] `threats_open: 0` confirmed by the gate's reviewer
- [ ] `status: verified` set in frontmatter

**Approval:** pending (PO, at the 09C gate)
