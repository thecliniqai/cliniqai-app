# 09C-REVIEW-SEC: adversarial security review, V2-09c

Reviewer: isolated Opus security auditor, fresh context. The auditor's role writes no files, so the orchestrator saved
its report here verbatim in substance. Scope `git diff 02b2f49e..HEAD`. Every attack ran on the local stack as
`authenticated` with session settings, in rolled-back transactions, on synthetic data.

**Result:** 0 Critical, 0 High, 2 Medium, 4 Low, 3 Hardening.

## Findings

### S-1 · Medium · A forged brand id gets an allergen past ALLERGY_MATCH (T-09C-06, T-09C-05)
- **Where:**
  - `000118_rx_allergy_check.sql:216-219`: the brand id is only checked to exist, never tied to `medicine_name` or `generic_name`.
  - `:99-106` (`private.rx_allergy_matches`): when the allergy is coded and the line has substances, only the substances are compared; the name is never a backstop.
  - `:302-312`: the add check.
  - `features/prescriptions/schema.ts:158`: `cdci_brand_id` accepts any string.
  - `000119:398-405`: `repeat_visit_plan` copies such lines.
  - `features/prescriptions/allergy.ts:31-40`: the TypeScript twin has the same gap.
- **Proof (P1):** the allergy is `{Qzxsecamox}`. A line `{"medicine_name":"Qzxsecamox 500","generic_name":"Qzxsecamox","cdci_brand_id":"<a valid paracetamol brand>"}` is accepted with `allergy_override = NULL` and no override count in the audit. `rx_allergy_context` returns `matches: []`, so Sign is not blocked and the printed Rx names the allergen.
- **Who:** any prescriber, through the server action or PostgREST.
- **Fix:**
  - For a sent `cdci_brand_id`, take the name, generic and form from the catalogue, or refuse with `INPUT_INVALID` on a mismatch.
  - Treat a line as matching on substance overlap OR name match, so the printed name is always checked.
  - Add a pgTAP case that fails without the fix.

### S-2 · Medium · The allergy list can be changed outside the command with no meaningful audit
- **Where:**
  - `features/patients/service.ts:78-84`: `changedFields` omits `allergies` and `chronic_conditions`.
  - `:108`: allergies are written directly.
  - `:135`: the audit row says `fields_changed:["no_changes"]`.
  - `patients` has a table-level UPDATE grant for `authenticated`. `patients_clinical_fields_guard` checks only `consultations:view`, and nothing audits the change.
- **Proof (P4b):** a nurse's direct UPDATE stored `{"line1\nline2",""}` and wrote no `patient.allergies_record` row. Any nurse, doctor or owner can empty a patient's allergies with no trace, and ALLERGY_MATCH then never fires for that patient.
- **Fix:**
  - Add the two fields to `changedFields` (names only).
  - Send the edit modal's allergy changes through `record_patient_allergies`.
  - In a new migration, either restrict the column grant or add an `AFTER UPDATE OF allergies` trigger that writes a counts-only audit row.
  - Add a test that fails without the fix.

### S-3 · Low · The v1 API Rx writer (`app/api/v1/prescriptions/route.ts:249-266`) skips the allergy check and idempotency
It uses the service role, stores an unchecked `cdci_brand_id`, and gives the header the default A4 paper instead of the clinic's setting. R-1 defers this path to V2-12, but the threat register does not list it. **Fix:** record it as an accepted risk owned by V2-12, or answer 409.

### S-4 · Low · Photos fall back to the original with EXIF and GPS in more cases than T-09C-10 states
- **Where:**
  - `lib/files/compress-image.ts:160,170,178,182,189`: the original is sent when decoding fails, when there is no 2D context, when `toBlob` returns null, when the result is over the limit, and on any exception.
  - `components/ui/file-drop.tsx:100`: `catch(() => original)`.
  - `lib/log/client.ts:11`: `reportClientError` does nothing in production, so the fallback is never logged.
- **Fix:**
  - Run `stripJpegMetadata` on raw bytes in the pass-through path.
  - Strip PNG `eXIf`/`tEXt` and WebP `EXIF` chunks, or refuse the file.
  - Optionally strip on the server; count fallbacks on the server.

### S-5 · Low · "Not recorded" is not the database default
`patients.allergies DEFAULT '{}'`, and `app/api/v1/patients/route.ts:141` writes `input.allergies || []`. **Fix:** a migration setting `DEFAULT NULL`, and `?? null` in the route.

### S-6 · Low · `record_patient_allergies` writes onto an erased (DPDP) patient (`000118:561`)
Proved: `ok` was returned and the value stored on an `is_deleted`/`erased_at` record. **Fix:** exclude erased patients from the lookup, return `PATIENT_NOT_FOUND`, and add a pgTAP case.

### S-7 · Hardening · `doctor_custom_medicines_select` covers the whole tenant
A nurse can read another doctor's custom medicines and doses. **Fix:** add `doctor_id = auth.uid()` to the policy.

### S-8 · Hardening · `change_prescription` and `repeat_visit_plan` read `patients.allergies` without a lock
They read at `000118:300` and `000119:383`. A concurrent allergy record can be missed. **Fix:** `SELECT ... FOR SHARE`.

### S-9 · Hardening · PDF route errors (`app/api/visits/[id]/prescription-pdf/route.ts:22-31,48`)
The error responses have no `Cache-Control: private, no-store`, and a locked clinic gets a 500 instead of the 403 `SUBSCRIPTION_LOCKED`.

## Threat register

| Threat | Status |
|---|---|
| T-09C-01 command authz/tenant | CLOSED |
| T-09C-02 grant narrowing | CLOSED |
| T-09C-03 search injection/escaping | CLOSED |
| T-09C-04 favourites own-doctor (SA-02) | CLOSED |
| T-09C-05 allergy check in both commands | CLOSED (residuals S-1, S-3) |
| T-09C-06 client cannot claim no match | **OPEN (Medium): S-1** |
| T-09C-07 allergy record | CLOSED (residuals S-2, S-5, S-6) |
| T-09C-08 repeat_visit_plan | CLOSED |
| T-09C-09 PDF naming/cache | CLOSED |
| T-09C-10 image metadata | **OPEN (Medium): S-4** |
| T-09C-11 archive write-once | CLOSED |
| T-09C-12 WhatsApp opt-in | CLOSED (stricter than planned) |
| T-09C-13 rate limiting | Accepted; needs a SECURITY.md accepted-risk entry |
| T-09C-SC supply chain | CLOSED (no dependency change) |

## Checked and holding

- **SECURITY DEFINER functions:** every one pins `search_path = ''`, and EXECUTE goes to `authenticated` only.
- **Tenant:** taken from the session, and claims check the actor.
- **`private.rx_allergy_matches`:** it is pure and not exposed through PostgREST, so it is no oracle.
- **Audit and logs:** audit rows hold counts only, and override reasons never reach audit or logs.
- **No new service-role client.**
- **Uploads:** the type list and the server's byte-signature check are unchanged.

Proof scripts were kept in the session scratchpad (`proofs.sql`, `proofs2.sql`, `proofs3.sql`), and none is committed.
