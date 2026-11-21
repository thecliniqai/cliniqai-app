# V2-09a review triage (CTO delegate, 2026-11-21)

Sources: `09A-REVIEW-A.md` (isolated, Sonnet; scope 09A-01..04) and `09A-REVIEW-SEC.md` (adversarial, Opus; same scope).
No Critical. The seal on visits, notes, diagnoses, Rx items, follow-ups and amendment rows held on every traced path; no
cross-tenant path. Lean process: one fix round (09A-06a), executed after 09A-05. Every fix needs a test that fails
without it.

## Ruling R-A (Rx archive writer), CTO delegate

The reviewers' preferred fix (record the PDF pair through a service-role-only function from the request path) conflicts
with ADR-0005: the system client is for jobs and webhooks, never a request path. That is an architecture change, so it
is the PO's call. Within the current architecture:

- Only the **signing doctor** of the sealed visit (`visits.signed_by = auth.uid()`) may INSERT the canonical Rx object and
  set the PDF pair. Owners, other doctors and every other role lose both. The pair is set once (NULL → value), only at the
  header's own canonical key and version.
- The archive runs in the signer's own sign-off and finalize requests, as now. A lost archive self-heals only when the
  signer opens the record; anyone else gets an on-demand render that is never stored.
- Adopting an existing object is allowed only when its `storage.objects.owner` is the signer. Otherwise there is no
  adoption, and the incident is audited.
- **Residual risk for the PO:** the signer could archive a PDF that differs from their own sealed record. The sealed
  database record stays the source of truth. Closing this fully means a trusted archiver: a `rx.archive` job on the
  system client (ADR-0005 compliant) rendering from the database. Recommended for V2-14 hardening if the PO wants it.

## Rows

| ID | Sev | Decision | Fix (09A-06a) |
|---|---|---|---|
| S-1 / A-4 | High | Fix | `patient_documents`: UPDATE revoked from `authenticated` unless a request-path writer remains (inventory in the notes). If one remains, an every-path BEFORE UPDATE trigger freezes `storage_path`, `patient_id`, `visit_id`, `uploaded_by`, `tenant_id`, `created_at`. Any allowed edit (for example `is_abnormal`, `title`) is audited through a command. pgTAP and Vitest |
| S-2 / A-1 | High | Fix (R-A) | Signer-only INSERT on the canonical Rx key, and a signer-only, set-once pair. `authenticated` loses UPDATE of `pdf_storage_path` and `pdf_sha256` except through that rule (trigger or definer command, executor's choice; one SQL source). Adopt only an object owned by the signer. Drop "legacy hash recorded on first read" (no production data, PO-15). Specs: colleague and owner plant refused; colleague pair write refused; signer path works |
| S-3 | Med | Fix (R-A) | Covered by R-A. Also, a hash that does not match the object is an integrity failure: serve a fresh render (S-8 label) and audit. Never block the signer's own archive retry because of a garbage pair: a mismatched pair may be cleared only by the signer, and only when the object is missing |
| S-4 | Med | Fix | `prescriptions_actor_guard` key checks (`visit_id`, `tenant_id`, `patient_id`) on every path, including the service role. pgTAP |
| S-5 / A-2 | Med | Fix | The share link verifies `pdf_sha256` before signing the object URL. If it does not match: refuse and audit. If the new version is not archived yet: a fixed "being prepared, try again shortly" answer, never a stale or unverified object |
| A-3 | Med | Fix | `reopen_visit_for_amendment` refuses with `RX_ARCHIVE_PENDING` while the signed version's active header has no pair. The reopen service first tries the self-heal archive when the caller is the signer. Spec |
| A-5 | Low | Fix | Amendment snapshot includes `reason_for_visit` and `location_id` (replace the snapshot function in the new migration). pgTAP |
| A-6 | Low | Fix | A download error that is not a hash mismatch (not found, network) is not audited as tampering; it gets an on-demand render and a warn log |
| A-7 | Low | Fix | `PATCH /api/v1/appointments/[id]` on a signed visit answers 409 `VISIT_LOCKED` |
| S-6 | Low | Defer V2-12 | Several active prescriptions per visit happen only through the v1 API. V2-12 (API) enforces one active header per visit, or finalize re-signs all of them. Backlog row |
| S-7 | Low | Fix | `visit_revisions` INSERT revoked from `authenticated` (the commands are the writers); reason length 10–500 enforced by a CHECK. pgTAP |
| S-8 | Low | Fix | An on-demand render served in place of a failed or missing archive carries a visible "Regenerated copy, not the archived original" line |
| S-9 | Hard | Fix | TRUNCATE and TRIGGER revoked on the sealed tables from `service_role`, `authenticated` and `anon`. pgTAP grants |
| S-10 | Hard | Fix | A visit the caller cannot see is refused (not treated as sealed) when setting the PDF columns |

## PO decisions at the gate

1. **R-A residual:** accept signer-only archiving for v2.0, or schedule the trusted `rx.archive` job (V2-14).
2. **Q-5:** lab documents cannot be deleted until V2-11's void, which applies to wrong-patient uploads too.
3. **ADR-015 erratum (Q-1 in `09A-PLAN.md`).**
