# V2-09a review A (isolated correctness review of `082d40e..ae1576c`, plans 09A-01 to 09A-04)

**Verdict: the seal itself (000107, 000108, the header guard in 000109, 000110) is sound for the row-level writers I could trace, but the Rx PDF integrity guarantee (R-12/R-13) can be defeated by any `prescriptions:edit` member, and the public share path ignores the hash: 1 High, 3 Medium, 3 Low. Fix A-1 before the PR gate; A-2 to A-4 in the fix round.**

Scope and method: static read of the four migrations, the replaced function bodies diffed against their latest previous definitions (`visits_integrity_guard` 000099, `step_sign_consultation` 000099, `finalize_visit_amendment` 000099, `webhook_event_subject` 000041, audit lists 000106/000103), the generator, payload builder, route, services, and the specs and pgTAP files that claim to prove them. Nothing was run. The replaced bodies differ from their predecessors only where the plan names (verified by `diff`): no accidental behaviour change found in 000107/000108/000109 function bodies, grants are replaced (REVOKE then column GRANT) not appended, every new trigger function has `search_path = ''` and EXECUTE revoked, trigger timing is BEFORE ROW. R-4a (tenant-gone exception) logic is correct for the cascade and the pgTAP/Vitest cases cover it.

---

## A-1 — High — The PDF pair and the upload are member-writable, so the "write-once, hashed" archive can hold attacker bytes and a poisoned hash

**Where:** `supabase/migrations/000109_rx_pdf_write_once.sql:95-101` (NULL to a value is admitted for any caller on a sealed, signed header; only the path shape is checked), `:173` (`GRANT UPDATE (pdf_storage_path, pdf_sha256, updated_at) ... TO authenticated`), `:290-309` (INSERT policy admits any `prescriptions:edit` holder at the sealed header's own unarchived key); `features/prescriptions/pdf/generator.ts:139-154` (adopt-on-duplicate hashes whatever object is there).

**Failure scenarios (all verified in the code; two are already shown by the repo's own tests):**
1. Plant then adopt. Between the sign commit and the post-commit archive (or for as long as the archive stays missing: the self-heal runs only when someone opens the Rx), any member with `prescriptions:edit` (a second doctor, the owner) uploads arbitrary bytes to `<tenant>/<visit>/rx_v1.pdf`. The policy passes (header signed, `pdf_sha256 IS NULL`, visit sealed). `archivePrescriptionPdf` then gets a duplicate, downloads the planted object, hashes it and records it as the signed prescription. From then on the route verifies "successfully" against the attacker's own bytes, and the write-once guard makes it permanent for that version. `tests/prescriptions/rx-pdf-archive.spec.ts` "an object that exists with no recorded hash ... is adopted" asserts exactly this behaviour with bytes uploaded by the doctor's client, and the "planting" test's control line confirms the sealed key is writable by the doctor.
2. Hash poisoning without the app. A member calls PostgREST directly: `UPDATE prescriptions SET pdf_storage_path = <canonical>, pdf_sha256 = <any 64 hex> WHERE id = <sealed header>`. The column grant allows it and the guard checks only the path shape and NULL-to-value (`tests/security/review2-fixes-db.spec.ts` "okRx" case already shows a doctor writing the path on a sealed header). Once the hash is set the INSERT policy (`pdf_sha256 IS NULL`) refuses the real upload, so the object can never be archived at that key, every open logs `OBJECT_MISSING`, writes an `integrity_failed` audit row and serves a fresh render, and the pair cannot be corrected (RX_PDF_WRITE_ONCE). Only an amendment (finalize) clears it.
3. The SHA-256 therefore proves nothing about origin or even that the object is what the app rendered, which is the whole point of must_have "its SHA-256 is stored and checked".

**Fix:** take the pair write away from the member path. Preferred: a `SECURITY DEFINER` command `record_rx_pdf_archive(p_tenant, p_visit, p_version, p_sha256)` (V2-07 pattern) that requires `prescriptions:edit`, the sealed/signed/version conditions and, ideally, `visits.signed_by = auth.uid()` (or the same actor within a short window of `signed_at`), and revoke the column UPDATE grant on `pdf_storage_path`/`pdf_sha256` from `authenticated`. Tighten the INSERT policy the same way (signer only), and do not adopt a pre-existing object blindly: on a duplicate, render fresh and refuse to adopt unless the planner can establish provenance (e.g. an `archive_started` marker the signer wrote), otherwise record an audit `prescription.pdf_adopted` so it is at least detectable. Add the planting and direct-hash cases to `ac6-rewrite-signed-rx.spec.ts` as expected-refused.

---

## A-2 — Medium — The public share path serves the Rx object without the hash check and has no self-heal; an amendment breaks existing patient links until v(n+1) is archived

**Where:** `supabase/migrations/000022_share_path_and_token_hash.sql:106` (`_storage_path` = `share_object_path(... r.pdf_storage_path)`), `features/sharing/system.ts:85-120` (`signSharedObject` signs that path as-is; no `pdf_sha256` comparison).

**Scenario:** R-12 and must_have 3 say a served sealed Rx is compared with `pdf_sha256`. The patient/pharmacy link (`/r/<token>`, sent by the consolidated WhatsApp message) is a second serving path that bypasses it, so planted or tampered bytes (A-1, or a service-role overwrite) are handed to the patient with no audit row. Separately, `finalize_visit_amendment` now sets `pdf_storage_path = NULL` (000109:253), so every previously issued link resolves to a NULL path (`shareTokenObject` returns null) until someone opens the amended Rx in the app and triggers the self-heal; if the v2 archive fails the link stays dead. Before 09A the path stayed pointing at the (overwritten) object.

**Fix:** in `signSharedObject` for `kind = prescription`, read the header's `pdf_sha256`, download and compare (or serve through a verified route) and fall back to the on-demand render; archive v(n+1) inside the finalize flow with a retry, and decide explicitly whether links should follow the latest version (document it).

---

## A-3 — Medium — Reopen proceeds when the signed version could not be archived; the v1 PDF can then never exist

**Where:** `features/consultation/service.ts:709-710` (archive "best effort, never blocks") with `archiveSealedPrescriptionPdf` swallowing every error (`:661-675`); `supabase/migrations/000109_rx_pdf_write_once.sql:303` (INSERT policy requires the key's version to equal the header's current version).

**Scenario:** sign commits, the archive fails or has not run (storage hiccup, render error), the doctor presses Amend. The pre-reopen archive fails silently, the reopen command snapshots a header with a NULL pair, finalize raises `version` to 2 and clears the pair. `rx_v1.pdf` is now un-uploadable by every role (policy needs `version = 1`), and the snapshot holds no path or hash, so the signed version's PDF is permanently lost, which is the document R-12 exists to preserve. The same loss repeats for `rx_v2.pdf` if a second amendment starts before v2 was archived.

**Fix:** in `reopenVisitForAmendment`, after the best-effort archive re-read the header and refuse the reopen (retryable fixed message) when the sealed version has no `pdf_sha256`; or have `reopen_visit_for_amendment`/`finalize_visit_amendment` refuse while the sealed header's pair is NULL. Add the failing-archive case to `rx-pdf-archive.spec.ts`.

---

## A-4 — Medium — "Lab documents are append-only" is true for delete and the object, not for the row: `storage_path`, `patient_id` and the rest stay updatable by any `labs:edit` member

**Where:** `supabase/migrations/000110_lab_documents_append_only.sql` (only DELETE and the lab storage UPDATE/DELETE are removed); `patient_documents_update` policy (000057) and the table-wide UPDATE grant are untouched. `supabase/tests/database/lab_documents_append_only.test.sql` even asserts "a doctor still updates a document's notes (UPDATE)".

**Scenario:** a nurse or doctor uploads a new object (INSERT is allowed) and then `UPDATE patient_documents SET storage_path = <new key>` (or `patient_id`, `title`, `is_abnormal`, `report_date`). The document the app lists and links now shows different content (or belongs to another patient), and the original object is orphaned and unreachable with no audit row. That is "overwrite" at the row level and also the unrecorded way to move a wrong-patient upload that Q-5 says nobody can fix.

**Fix:** add a BEFORE UPDATE guard on `patient_documents` freezing `id, tenant_id, patient_id, storage_path, original_filename, file_size_bytes, mime_type, uploaded_by, created_at` for every writer (allow title/notes/is_abnormal only if the product wants edits, and audit them), plus a pgTAP/Vitest case that a `storage_path` UPDATE is refused. If the PO wants rows editable, say so in Q-5 and correct the must_have wording.

---

## A-5 — Low — The amendment snapshot omits `reason_for_visit` and `location_id`, which R-6 declares part of the signed record

**Where:** `supabase/migrations/000078_signed_visit_fields.sql:75-86` (snapshot `visit` object: status, signature, specialty, scheduled_at, note fields; no `reason_for_visit`, no `location_id`); `000107:113-120` locks both only while sealed.

**Scenario:** while the visit is amending (`in_consultation`) the lock is off, so a command or system-path writer can change either column and the signed value survives nowhere (the revision row is append-only but never captured it). Members cannot write them directly (000103 column grant), so this is a recoverability gap rather than an open hole.

**Fix:** extend the snapshot builder in a new migration to include both columns (the pre-000107 revisions simply lack them), or keep them locked during amendment unless a command changes them.

---

## A-6 — Low — `readArchivedPrescriptionPdf` treats any download error as tampering and audits it on every request

**Where:** `features/prescriptions/pdf/generator.ts:214-233`.

**Scenario:** a transient Storage error, timeout or throttle sets `stored = null`, which is logged at error level (`OBJECT_MISSING`) and written to the audit trail as `prescription.pdf_integrity_failed` with the stored hash. Each open (route and preview, so up to two per view) adds another row, so a flaky storage minute produces integrity-failure evidence against healthy documents and drowns a real tamper signal; the fresh render is served each time.

**Fix:** distinguish "not found" (404) from other errors (retry once, then serve a render without the integrity audit), and audit a given (header, reason) at most once per window.

---

## A-7 — Low — `PATCH /api/v1/appointments/[id]` (reschedule) of a signed visit now answers 403, not the fixed 409 the sibling routes use

**Where:** `app/api/v1/appointments/[id]/route.ts:117-123, 179-193` (only DELETE got the 409 mapping; plan 09A-01 step 6 covered cancel only).

**Scenario:** the service-role reschedule UPDATE hits `VISIT_SIGNED_FIELD_IMMUTABLE` (42501), `apiDbError` maps SQLSTATE 42501 to `FORBIDDEN` 403, which tells an API client its key lacks permission (and `doctor_id` changes hit `VISIT_SIGNED_DOCTOR_IMMUTABLE`, same mapping). The same client gets `VISIT_LOCKED` 409 on DELETE and on `PATCH /api/v1/visits/[id]`.

**Fix:** read `status, signed_at` in the PATCH fetch (it already selects `*`) and return `VISIT_LOCKED` 409 before the write, and map a 42501 from the update the way DELETE does.

---

## Checked and found sound (no finding)

- `visits_integrity_guard`: the diff against 000099 is exactly the system-path block, the `reason_for_visit` lock and `status IS DISTINCT FROM 'in_consultation'` (this widens the old `= 'completed'` lock to signed `cancelled` visits, which is correct and harmless).
- Reopen and finalize on the user path are unaffected (their `OLD.status = 'in_consultation'` branches skip the R-6 lock); `step_sign_consultation` ordering change (seal header, then sign visit) is the only body change and is needed.
- `prescriptions_seal_guard` PDF-pair state machine: clear-only-with-version-raise, NULL-to-value-once, version change never carries a pair, canonical path equality; no bypass found. `uq_prescriptions_visit_version` makes the I-1 "one version-1 header per visit" claim true.
- Tenant purge: `visits_sealed_delete_guard`, notes, items, diagnoses, follow-ups, revisions, header and `patient_documents_no_delete` all pass the tenant-gone cascade; the `follow_ups` SET NULL carve-out is preserved.
- Event key `...:signed:v<n>` is unique per version; the 000041 subject builder is the latest body (no later redefinition).
- Gate arithmetic in `assert-pgtap-report.mjs` adds up (8321 to 8454). The Vitest FLOOR is deliberately unchanged at 6455 while four plans added cases and removed several; its protective value shrinks until the close re-measure (note for the close, not a defect).
