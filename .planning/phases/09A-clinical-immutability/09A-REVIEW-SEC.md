# V2-09a adversarial security review (09A-01 to 09A-04, migrations 000107 to 000110)

**Verdict: NOT READY TO MERGE. 2 High, 3 Medium, 3 Low, 2 Hardening, 0 Critical.**
The clinical row seal (000107, 000108) holds against every member role and every PostgREST, definer and replay path I traced.
The breaks are in the two newer guarantees. First, lab documents are not append-only: any `labs:edit` holder can rewrite a document row in place (S-1).
Second, the "write-once, hashed" Rx PDF is first-writer-wins for any `prescriptions:edit` holder. A forged PDF can be made the hash-verified archive (S-2), the archive can be poisoned for good (S-3), and the public share link serves the object without checking the hash at all (S-5).

**Cross-tenant: no cross-tenant path exists** in the new code for a member of any role or for an anonymous caller. Every finding below needs membership in the victim clinic (S-1, S-2, S-3, S-6, S-7) or the service-role key (S-4, S-5 tamper leg, S-9).
Facts checked:
- The route and the preview derive the tenant from the session (`resolveServiceContext`).
- `loadPrescriptionPdfSource`, `readHeader` and the archive UPDATE filter on `ctx.tenantId`.
- `archivePrescriptionPdf` refuses a payload of another tenant.
- `prescriptions_rx_insert` requires the key's tenant segment to be in `tenant_ids_with('prescriptions:edit')`, and its header/visit subquery runs under the caller's RLS, so it sees no foreign rows and leaks nothing.
- `reopen`/`finalize` pin `p_tenant_id` to the active clinic and filter every read on it.
- Every guard reads `OLD.tenant_id`/`NEW.tenant_id` of the row itself.
- The service role can move a draft header across tenants only when every composite FK is satisfied there (S-4); that role already has every tenant.

Method: static only. I read the four migrations against the bodies they replace, the generator, payload, route, preview, sharing and labs code, the grants and triggers in `scripts/drift/schema-snapshot.txt`, and the policies in 000013/000052/000054/000057/000058/000092. No command, test or stack was run.

---

## S-1 (High): lab documents are mutable in place. "Append-only" covers DELETE only

**Where**
- `supabase/migrations/000110_lab_documents_append_only.sql:21-22,25-44`: only DELETE is revoked and trapped.
- `supabase/migrations/000057_policies_admin_system.sql:270-273`: `patient_documents_update` (USING/WITH CHECK `labs:edit`).
- Table-wide privilege `grant table public.patient_documents UPDATE to authenticated` (schema snapshot l.2058).
- No BEFORE UPDATE trigger exists on `patient_documents` (only `patient_documents_fill_report_date` on INSERT and the new `patient_documents_no_delete`).
- The only constraint on the path is `patient_documents_storage_path_shape`, which checks the prefix `tenants/<tenant>/patients/<patient>/` (000022:38-56).

**Attack.** Any owner, doctor or nurse of the clinic (all hold `labs:edit`, `lib/permissions/matrix.ts`) can do this with their own JWT straight against PostgREST and Storage:
1. Upload a substitute file to `clinic-records` at `tenants/<T>/patients/<P>/labs/<anything>.pdf`. `clinic_records_lab_insert` admits any name under the patient's prefix.
2. `PATCH /rest/v1/patient_documents?id=eq.<doc>` with `{"storage_path":"tenants/<T>/patients/<P>/labs/<anything>.pdf"}`. RLS, privilege and the CHECK all pass, and no trigger fires.
3. The original report is now orphaned: it is still in storage but no row points to it.
   - The app's View (`getDocumentSignedUrl`, `features/labs/service.ts:241-260`) serves the substitute.
   - So does every share link already sent to the patient on WhatsApp: `share_token_object`/`share_token_resource` read the row's `storage_path` live, and `signSharedObject` signs it (`features/sharing/system.ts:85-110`).

The same UPDATE can also:
- point `storage_path` at a key with no object (the report is "deleted" from the record);
- move the document to another patient of the clinic (set `patient_id` and a matching path, after re-uploading under that prefix);
- attach it to or detach it from a signed visit (`visit_id`);
- flip `is_abnormal`, rewrite `title`, `report_date`, `notes`, `original_filename`, `mime_type`, `created_at`;
- forge `uploaded_by` to any `auth.users` id (FK to `auth.users` only).

Nothing is audited. This contradicts R-14 and the acceptance row "No member can delete a lab document row or its object, or overwrite the object" in effect, and the 000110 header ("nobody overwrites the file"). The pgTAP control `lab_documents_append_only.test.sql:139-140` asserts the UPDATE privilege as intended behaviour, so the tests do not catch this.

**Fix** (new migration):
- `REVOKE UPDATE ON public.patient_documents FROM authenticated;`
- Re-grant only columns that are honestly editable metadata, if any (`notes`?). The app has no UPDATE path today (grep: none in `features/labs`), so revoking all is safe.
- Add a BEFORE UPDATE trigger on every path that freezes `id, tenant_id, patient_id, storage_path, original_filename, mime_type, file_size_bytes, uploaded_by, created_at, report_date, title, is_abnormal`. The only exception is `visit_id` going to NULL by the FK's `ON DELETE SET NULL` (system path, visit gone), as the follow-ups carve-out does.
- Add a pgTAP case per role for each frozen column, plus a share-link test showing the served bytes do not change.

## S-2 (High): any `prescriptions:edit` holder can make a forged PDF the hash-verified Rx archive (planting before archive)

**Where**
- `000109_rx_pdf_write_once.sql:290-309`: `prescriptions_rx_insert` admits any member with `prescriptions:edit` while the header is signed, sealed and has no hash.
- `000109_rx_pdf_write_once.sql:173`: `GRANT UPDATE (pdf_storage_path, pdf_sha256, updated_at)` to authenticated.
- `000109_rx_pdf_write_once.sql:86-101`: the guard accepts any well-formed hash, and a path without a hash.
- `features/prescriptions/pdf/generator.ts:139-153`: on a 409 the archiver adopts whatever object is at the key.
- `generator.ts:283-296`: trust-on-first-use of a path with no hash.
- `generator.ts:178-184`: the archive audit row is written under the archiver's identity.

The 000109 rules make the pair write-once. They do not make the archive *the server's render*: the archive is whatever object reaches the key first, and members can reach it directly.

**Attack A: a colleague or the owner, against another doctor's Rx.**
1. Doctor A clicks Sign. `sign_consultation` commits, and only then does the server load the rows, render with react-pdf and upload (`completeAndSignConsultation` then `archiveSealedPrescriptionPdf`). That takes hundreds of ms to seconds.
2. Doctor B or the owner polls `GET /rest/v1/prescriptions?select=id,tenant_id,visit_id,version&signed_at=not.is.null&pdf_sha256=is.null`. As soon as the row appears, they `POST /storage/v1/object/prescriptions/<T>/<V>/rx_v1.pdf` with forged bytes. The INSERT policy passes: the header is signed, sealed and has no hash.
3. A's upload gets 409. The archiver downloads B's bytes, hashes them and records the pair (status `adopted`), and writes `prescription.generate_pdf` **as doctor A**.
4. From then on the route and the preview serve B's PDF with `verified: true`, and the share link sends it to the patient or pharmacy. The sealed rows say one thing; the medico-legal PDF says another, and it is attributed to A.

B can also skip racing the upload and just set `pdf_storage_path` (canonical) first. The legacy branch then trusts whatever object B uploads before the next read.

**Attack B: self-forgery, unbounded window.**
1. A doctor calls `POST /rest/v1/rpc/sign_consultation` directly (EXECUTE is granted to authenticated, 000099:1000). No archive runs.
2. The doctor uploads any PDF to `rx_v1.pdf`, then PATCHes the pair with its SHA-256.

Example: the signed rows say paracetamol, while the verified PDF the pharmacy receives says a scheduled drug. The same unbounded window exists after any failed post-commit archive and after an RPC-only finalize (09A-NOTES "a command-only finalize leaves the header with no pair").

The plan records this as accepted residual T-09A-06, on the basis that "the archive follows the commit immediately". The code does not bound the window: it is the server render time for others and infinite for the signer. The adopt and trust-on-first-use branches turn a planted object into a *verified* one. That basis does not hold, so the PO must re-decide rather than inherit the acceptance.

**Fix.** The archive must not be writable by member credentials. This touches CLAUDE.md "no service-role client in request paths", so the PO must approve it.
- (a) Drop `prescriptions_rx_insert` for authenticated, and `REVOKE UPDATE (pdf_storage_path, pdf_sha256)` from authenticated.
- (b) Archive in a server-only step:
  - The server re-reads the sealed rows with the caller's client (proving `prescriptions:view`), renders, and uploads with a narrowly scoped system client (or a `pdf.archive_prescription` job, plan Q-8).
  - It records the pair through `private.record_rx_archive(p_rx uuid, p_path text, p_sha text)`, EXECUTE for service_role only.
  - Self-heal on open calls the same step.
- (c) Delete the trust-on-first-use branch (`generator.ts:283-296`; PO-15: no v2 data exists).
- (d) In the guard, require path and hash to be set together in one statement.

If the PO keeps member-side archiving, at minimum do (c) and (d), never adopt an object the server did not just upload, and record T-09A-06 with the real window.

## S-3 (Medium): permanent archive poisoning. A sealed Rx can be made un-archivable forever

**Where.** `000109_rx_pdf_write_once.sql:86-101` (a hash is accepted with no check that the object exists or matches), `:290-309` (INSERT needs `pdf_sha256 IS NULL`), `generator.ts:126-128` (a recorded hash means "already archived") and `:216-234`.

**Attack.** In the same window as S-2 (any sealed, unarchived header of the clinic), an owner or doctor sends `PATCH /rest/v1/prescriptions?id=eq.<rx>` with `{"pdf_storage_path":"<T>/<V>/rx_v<n>.pdf","pdf_sha256":"000…0"}`. The guard admits it (sealed, signed, canonical path, shape-valid hash). Afterwards:
- no upload can ever succeed, because the INSERT policy needs the hash to be NULL;
- the pair is write-once, so it cannot be corrected;
- `archivePrescriptionPdf` returns `already_archived` without uploading;
- every open writes `prescription.pdf_integrity_failed` and serves a fresh render;
- the patient's or pharmacy's share link returns 404, because `signSharedObject` cannot sign a missing object.

The only way out is a reopen and finalize, which bumps the version and creates an amendment that never happened clinically.

**Fix.** S-2's fix removes the primitive. Independently, the pair guard should require the object to exist: a definer helper checking `storage.objects` for `bucket_id='prescriptions' AND name = NEW.pdf_storage_path`. Path and hash should also be set together.

## S-4 (Medium): the service role can graft a draft prescription onto a sealed visit (header key check is still user-path only)

**Where.** `000109_rx_pdf_write_once.sql:155-161`: `prescriptions_actor_guard` returns at `IF v_uid IS NULL THEN RETURN NEW` *before* the `PRESCRIPTION_KEY_IMMUTABLE` check. `prescriptions_seal_guard` (`:53-62`) computes `v_sealed` from `OLD.visit_id` only. Every other sealed table checks its keys on every path (000107: notes `:226-229`, items `:278-282`, diagnoses `:327-331`, follow-ups `:382-391`); the header is the exception.

**Attack** (service-role key, for example a v1-API-style writer or a script):
1. Create or pick a draft header D, with items, on a draft visit of the clinic.
2. `UPDATE prescriptions SET visit_id = <sealed S>, patient_id = <any patient of the clinic>, version = <unused n>, signed_at = now() WHERE id = D`.
   - The actor guard skips (system path).
   - The seal guard sees OLD's draft visit (not sealed); the version change carries no pair, so nothing fires.
   - The FKs `(tenant_id, visit_id)` and `(tenant_id, patient_id)` are satisfied.
3. The sealed visit S now has an extra signed prescription with arbitrary items.
4. The PDF route serves the highest version (`payload.ts`, `.order("version", desc)`), so it self-heals, archives it (rx_v<n>.pdf), hashes it and serves it as the verified Rx of S.

This breaks R-4c ("child rows added to it are refused") and the must-have "cannot be updated … by the service role". It is not tested (no `visit_id` move case in `prescription_seal`, `rx_pdf_write_once`, `rx-seal.spec`, `ac6-rewrite-signed-rx.spec`). The same statement can also move a draft header to another tenant when the doctor is a member of both.

**Fix.** In `prescriptions_actor_guard`, move the `doctor_id/visit_id/patient_id/tenant_id` immutability check above the `v_uid IS NULL` return, so it applies on every path. In `prescriptions_seal_guard`, also refuse when `NEW.visit_id`'s visit is sealed. Add a pgTAP case: a service_role UPDATE of `visit_id` from a draft to a sealed visit gets 42501.

## S-5 (Medium): the hash is not checked on the main external serving path; tampered objects are served as genuine

**Where.** `features/sharing/system.ts:85-110` (`signSharedObject` signs `target.storage_path` for `prescription` tokens with no SHA-256 comparison) and `app/api/r/[token]/route.ts:47-51,88` (redirects to or returns the raw signed URL). Also `features/prescriptions/service.ts:575-584`: verify, then hand out a 5-minute raw signed URL (TOCTOU).

**Attack.**
1. An object at `<T>/<V>/rx_v<n>.pdf` differs from its recorded `pdf_sha256`. This happens through the service role or storage-admin access (T-09A-06 residual "the service role … could overwrite an object"), or through S-2.
2. The in-app route detects the mismatch. The patient's or pharmacy's WhatsApp link `/r/<token>` and `/api/r/<token>?download=true` do not: they serve the tampered bytes as the clinic's prescription.

R-12 ("serving a sealed Rx … compares its SHA-256 … never serves the mismatching bytes") and must-have 3 ("checked when the PDF is served") hold only for the authenticated route and the preview, not for the link that leaves the clinic. The notes' mitigation for the service-role residual ("the hash check on read catches it") does not cover this path.

**Fix.** For `resource_type = 'prescription'`:
- `share_token_object` returns `pdf_sha256`;
- the public route downloads the object with the system client, compares the hash, and streams the bytes itself (no redirect to a raw signed URL);
- on a mismatch it refuses (or serves a clearly marked re-render) and audits.

For the preview, return the route URL, which verifies, instead of a raw signed URL; or accept and record the TOCTOU.

## S-6 (Low): amendments of a visit with more than one header re-sign only the highest version and leave a stale "verified" PDF

**Where.** `000109_rx_pdf_write_once.sql:241-255` (finalize picks `ORDER BY p.version DESC LIMIT 1`, with no status or author filter). `app/api/v1/prescriptions/route.ts:194-248` (the v1 API creates version n+1 headers on draft **and amending** visits).

**Attack** (a clinic using the v1 API):
1. The doctor's header H1 (v1) and an API-created H2 (v2) are both sealed at sign-off.
2. The doctor reopens and edits H1's items, which is allowed because the visit is amending.
3. The doctor finalizes. Only H2 is bumped to v3, re-signed and cleared. H1 keeps version 1, its old `signed_at` and its old pair `rx_v1.pdf`, while its items have changed.
4. Previewing H1 (`getPrescriptionPdfSignedUrl(prescriptionId=H1)`) serves the pre-amendment PDF as `verified`, which no longer matches the rows.
5. The finalizer re-signed an API-authored header they may never have opened, and the v1 API can inject a new header into an open amendment that then becomes "the" amended Rx.

**Fix.** Finalize should bump, re-sign and clear the pair of **every** active header of the visit (as sign-off seals every active one), or refuse with a fixed reason when the visit has more than one active header. The v1 API should refuse POST on an amending visit.

## S-7 (Low): any `consultations:edit` holder can write permanent fake "amendment" rows (now undeletable)

**Where.** `000054_policies_clinical.sql:67-69` (member INSERT policy on `visit_revisions`) with the table grant `INSERT to authenticated`; `000078_signed_visit_fields.sql:25-115` (the guard admits a direct insert on a sealed, completed visit); `000107_clinical_seal.sql:436-460` (rows now immutable on every path). There is no CHECK on `amendment_reason`.

**Attack.** A doctor or owner sends `POST /rest/v1/visit_revisions` with `{tenant_id, visit_id:<sealed>, amended_by:<self>, amendment_reason:<any length>}`. The row receives a database snapshot and a number, but no reopen and no `visit.reopen_for_amendment` audit row happen. The 10–500 character rule of the command is bypassed, and the text is unbounded. Repeated, this creates unbounded and **undeletable** rows (000107 removed every deletion path but the tenant purge), each copying the whole record. Any amendment-history view (V2-09b) will show amendments that never happened.

**Fix.** `DROP POLICY visit_revisions_insert` and `REVOKE INSERT ON public.visit_revisions FROM authenticated`. The reopen command is a definer and keeps working. Add `CHECK (char_length(btrim(amendment_reason)) BETWEEN 10 AND 500)` (NOT VALID, then validate).

## S-8 (Low): the integrity-failure fallback looks exactly like a genuine archive and is built from unsealed data

**Where.** `generator.ts:216-234` and `features/prescriptions/pdf/payload.ts` (doctor `full_name`/`qualifications`/`medical_council_reg_no` from `memberships`, patient demographics, clinic profile: all mutable, none sealed).

**Attack.** After S-3, or any tamper, every print of that Rx is a fresh render. Nothing in the bytes says it is not the archived original. Prescriber identity and registration number, patient identity and clinic details come from rows that owners and admins can edit after sign-off. The detection exists only in logs and the audit table.

**Fix.** Stamp the fallback render visibly ("Re-rendered copy – archived original failed verification on <date>"), or refuse to serve and show a fixed error. Record in R-12 that only the archive, not a re-render, is the signed artefact.

## S-9 (Hardening): TRUNCATE and TRIGGER privileges bypass the "every role" seal

**Where.** Schema snapshot grants: `TRUNCATE` and `TRIGGER` to `service_role` on `visits`, `clinical_notes`, `prescriptions`, `prescription_items`, `consultation_diagnoses`, `follow_ups`, `visit_revisions`, `patient_documents` (l.1881-1882, 1911-1912, 1988-1989, 2056-2057, 2124-2125, 2135-2136, 2238-2239, 2247-2248). R-3 (000107:12-14) lists `session_replication_role` and `DISABLE TRIGGER` as residuals, not TRUNCATE.

**Attack.** As postgres (owner) or as service_role over SQL (not through PostgREST), `TRUNCATE public.prescription_items` (or any sealed table) fires no row trigger and erases signed records. `TRUNCATE ... CASCADE` reaches the rest.

**Fix.** `REVOKE TRUNCATE, TRIGGER ON <sealed tables> FROM service_role, authenticated, anon`. Add `BEFORE TRUNCATE ... FOR EACH STATEMENT` triggers that raise 42501. List TRUNCATE under the R-3 residuals for the owner.

## S-10 (Hardening): the "invisible visit = sealed" rule fails open in the PDF-pair branch

**Where.** `000109_rx_pdf_write_once.sql:53-58,96-98`. On the user path `v_sealed := NOT EXISTS (open visit visible to the caller)`, so a visit the caller cannot see counts as sealed. That is fail-closed for the RX_SEALED diff, but the same flag *grants* "NULL to a value" for the pair.

**Attack.** A caller with `prescriptions:edit` (UPDATE RLS) but without `appointments:view` (visits RLS) could set the pair on a header of a draft or amending visit whose header is signed (an amending v1 with no archive). This is not reachable with today's role matrix, because owner and doctor both see visits. It becomes reachable as soon as a role or custom permission set separates the two.

**Fix.** Use a positive proof for the grant branch: `v_sealed_proven := EXISTS (visible visit that is signed and not in_consultation)` for the pair rule, and keep the fail-closed flag for the diff.

---

## Claims in 09A-NOTES checked and found to hold

- Signed visit, notes, diagnoses, items and follow-ups:
  - every member role is refused UPDATE, DELETE and child INSERT on a sealed visit by trigger and privilege;
  - the system path is refused the same (000107);
  - definer commands run under the caller's uid and meet the user-path rules.
- The visits trigger order is fine: `visits_integrity_guard` runs before `visits_metadata_guard` and `visits_status_transition_guard`, and neither rewrites NEW.
- No command other than `reopen_visit_for_amendment` can move `completed` to `in_consultation`: `start_consultation` goes through `step_check_in`, which refuses `completed`.
- Prescription header:
  - the column grant blocks member writes to `version`, `status`, `signed_at`, `amendment_reason`, `letterhead_mode`;
  - `uq_prescriptions_visit_version` plus "version = 1 on the request path" leaves one header per request-path visit, so no two headers share a canonical key.
- Finalize, reopen and sign:
  - replays are absorbed by `command_claim`;
  - two finalizes serialise on the visit row lock, and the second gets `AMENDMENT_NOT_OPEN`;
  - a cross-tenant `p_visit_id` gives `VISIT_NOT_FOUND`;
  - the sign-off seal-then-sign order is consistent with the new guard;
  - finalize clears the pair in the same statement that raises the version, and the v1 pair survives in the snapshot (`to_jsonb(p)`).
- Storage:
  - `rx` has no UPDATE or DELETE policy, so `upsert`, `update`, `move` and `remove` fail; `copy` needs INSERT, which is S-2's window;
  - an archive of a draft or amending visit, or at a future or wrong version, is refused by the INSERT policy;
  - the policy subquery runs under RLS and leaks nothing across tenants;
  - the per-class key regexes cannot be confused between the lab, receipt and referral classes;
  - `lab` UPDATE and DELETE are dropped.
- Archive race between two server archivers: the loser adopts the winner's bytes and the `.is('pdf_sha256', null)` UPDATE matches no row, which is consistent. A payload read across a concurrent reopen, edit and finalize is refused by the policy (visit not sealed) or by the version check in `archivePrescriptionPdf`.
- R-4a is not abusable. It needs `auth.uid() IS NULL` and a missing `tenants` row:
  - `anon` holds no privilege on these tables;
  - no request path deletes tenants;
  - service_role and postgres bypass RLS, so `tenants` cannot be hidden from them.
- PHI: the new log lines carry only an event, an `errorTag` code (error code or name, `lib/errors/error-tag.ts`), the request id and the tenant id. The new audit metadata is `version`, `sha256`, `storage_path` (UUID key) and `letterhead_mode`. The webhook payload adds `version` only. `amendment_reason` free text in `visit.amend_finalized` predates this phase.

_Reviewer: Claude (adversarial security review, fresh context), 2026-11-21. Static review of `git diff 082d40e..ae1576c`; nothing was executed._
