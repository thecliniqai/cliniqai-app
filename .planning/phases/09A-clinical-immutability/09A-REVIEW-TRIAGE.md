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

## 09A-06a outcome (executor, 2026-11-21)

"Failed without" was measured, not assumed. Database rows: `supabase/migrations/000111_clinical_review_fixes.sql` moved out, `db reset` to 000110,
the new pgTAP file and the DB-dependent Vitest specs run with the app fixes in place (28 of 40 pgTAP assertions failed; the 12 that passed are
fixtures and controls). App rows: database at 000111, each app fix reverted in the working tree by a scripted edit (then `git checkout` of those
files), the specs run, and for B-1, B-3, B-4 and B-6 the app rebuilt (`npm run e2e:build`) and the e2e run on desktop-chrome. B-4 was measured with
B-3 restored, so its test reached the dialog. pgTAP numbers below are the assertions of `supabase/tests/database/clinical_review_fixes.test.sql`.

| Row | Commit(s) | Test(s) | Failed without the fix |
|---|---|---|---|
| S-1 / A-4 | 62d3752 | pgTAP #35, #37; `lab_documents_append_only` #1, #2, #11, #12 (rewritten); Vitest `review2-fixes-db` "attack step 1 is refused ..." | yes (pgTAP #35, #37; the Vitest case) |
| S-2 / A-1 | 62d3752, f3b19cb | pgTAP #2-#5, #7, #10; `storage_policies` (owner upload refused); Vitest `rx-archive-signer` "the owner and a colleague doctor cannot store ...", "an object at the key that the signer did not store ... is never adopted", "the owner opening a sealed Rx with no archive gets a regenerated copy ..." | yes (DB run: all; app run: "the owner opening ..." and "never adopted") |
| S-3 | 62d3752, f3b19cb | pgTAP #6, #15; Vitest `rx-archive-signer` "S-3 / A-6: ... the signer's open clears the pair and archives again" | yes (both runs) |
| S-4 | 62d3752 | pgTAP #18, #19 | yes |
| S-5 / A-2 | 62d3752, e557ae9 | pgTAP #22; Vitest `rx-archive-signer` "an archived Rx is signed; a tampered one is refused ...", "after a finalize ... 'being prepared'"; `review-fixes-db` AR-M1 (pending link is 503, then the signer's archive is signed) | yes (DB run: the tampered case; app run: both S-5 cases and AR-M1) |
| A-3 | 62d3752, f3b19cb | pgTAP #24, #25; Vitest `rx-archive-signer` "the owner cannot reopen a colleague's signed visit whose Rx is not archived ..."; `amendment-rpc` "a second amendment cycle makes version 3" (now asserts RX_ARCHIVE_PENDING before the v2 archive) | yes |
| A-5 | 62d3752 | pgTAP #29 | yes |
| A-6 | f3b19cb | Vitest `rx-archive-signer` "S-3 / A-6: a missing archive is not audited as tampering ..." | yes (app run: an integrity row was written) |
| A-7 | c22b764 | Vitest `v1-doctor-guard` "PATCH /api/v1/appointments/[id] (reschedule) of a signed appointment is 409 VISIT_LOCKED ..." | yes |
| S-6 | not fixed (deferred to V2-12) | backlog line in 09A-NOTES 09A-06a | n/a |
| S-7 | 62d3752 | pgTAP #31-#34 | yes |
| S-8 | f3b19cb | Vitest `rx-archive-signer` "S-8: renderPrescriptionPdf prints the notice ...", and the notice assertions of the R-A, S-3 and tamper cases (`tests/helpers/pdf-text.ts` reads the page text) | yes |
| S-9 | 62d3752 | pgTAP #38-#40 | yes |
| S-10 | 62d3752 | pgTAP #16 (the visits SELECT policy hidden in-transaction) | yes |

Existing specs that asserted behaviour R-A removes were rewritten, not deleted: the "adopted" case of `rx-pdf-archive.spec.ts` now adopts only the
signer's own upload (the planted case is in `rx-archive-signer.spec.ts`); "legacy hash recorded on first read" became "a legacy header is never
trusted"; owner and colleague archive writes became refusals (`storage_policies.test.sql`, `rx_pdf_write_once.test.sql` matrix with an owner/doctor
split, `review2-fixes-db.spec.ts` okRx).

### 09A-05 review (B rows)

| Row | Commit(s) | Test(s) | Failed without the fix |
|---|---|---|---|
| B-1 | 92b01a8 | e2e `amendment-screens` "B-1: the vitals editor and a staged drug do not survive the sign-off refresh ..."; Vitest `workspace-review-fixes` (no vitals editor on a populated sealed record) | yes (e2e on the reverted build) |
| B-2 | 92b01a8 | Vitest `workspace-review-fixes` "B-2: ... v1 when sealed, 'v1 to v2' while first amended, v2 when finalized, 'v2 to v3' ..." (real rows); `workspace-sealed` fixtures use the stored `current_revision` | yes |
| B-3 | 92b01a8 | e2e `amendment-screens` "B-3 and B-4: focus lands on the banner after Amend and on the signed chip after Finalize ..." | yes (the banner was not focused) |
| B-4 | 92b01a8, d0602e8 | the same e2e: the Close button is gone within 1 s of Finalize, Escape and an outside click leave the dialog open | yes (with B-3 restored: the Close check failed; before d0602e8 that check was vacuous and Escape failed instead) |
| B-5 | 92b01a8 | Vitest `workspace-review-fixes` "B-5: ... a follow-up the database refuses makes saveConsultationDraft fail ..." (scoped fault trigger) | yes |
| B-6 | 92b01a8 | Vitest `workspace-sealed` (sealed and unsigned completed notes readOnly, not disabled), `workspace-review-fixes`; e2e `consult-rx-finish` "a signed consultation is read-only ..." (focusable, typing changes nothing), `amendment-screens` sealed screens | yes (Vitest and e2e) |
| B-7 | 92b01a8 | Vitest `workspace-review-fixes`: three populated sealed visits (one per specialty: vitals, complaint, investigation, advice, follow-up, specialty data; every input and select disabled, only non-mutating buttons enabled), the cancelled visit, the B-2 version fallback; `sealed-refusal-messages` "creating the draft prescription of a signed consultation that has none" | yes: the populated cases (they found the diagnosis "+ Note" control live on a sealed record, fixed in 92b01a8); the cancelled case and the draft-prescription case fail when their 09A-05 code is reverted |

The page-level axe check in `amendment-screens.spec.ts` is unchanged.
