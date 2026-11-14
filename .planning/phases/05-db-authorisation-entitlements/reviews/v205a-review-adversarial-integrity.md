# V2-05a adversarial review: storage, data integrity, migrations

Reviewer: isolated adversarial agent (no implementer context; per-plan records and wave notes not read).
Scope: `git diff v2/phase-04-jobs-reliability...8bda1c6`, migrations 000047–000067 plus the app code that uses them
(features/visits, features/queue, features/dpdp, features/labs, features/sharing, app/api/v1).
Method: every finding marked "proven" was reproduced against the local stack (PostgreSQL 17.11, 127.0.0.1:54322).
Each run was inside `BEGIN … ROLLBACK` with synthetic rows (tenants `RV Clinic A/B`, users `rv-*@example.test`,
patients "Synthetic One/Two"). Afterwards I checked that no RV tenant or user was left behind. I created no scratch
database and made no repo edits.

Fixture used by the reproductions (run inside BEGIN): 2 tenants; doctor, receptionist and nurse members of clinic A;
2 patients in A. To impersonate a member: `set_config('request.jwt.claims', '{"sub":<uid>,"role":"authenticated"}')`,
`set_config('request.headers', '{"x-clinicos-tenant":<A>}')`, then `SET LOCAL ROLE authenticated`.

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 3 |
| Low | 8 |
| Info | 5 |

---

## HIGH

### H-1 A receptionist can move a signed clinical encounter to another patient and forge its sign-off (proven)

`visits` keeps a full table-level UPDATE grant for `authenticated`. Its only UPDATE policy (000055) is
`appointments:edit` in the active clinic. Nothing restricts columns: there is no column privilege and no guard trigger
on `visits` (the only trigger is `visits_create_clinical_notes`). The clinical split (000053) moved the content into
`clinical_notes`, keyed by `visit_id`. Who that content belongs to is still decided by `visits.patient_id`, and any
front-desk role can rewrite that column. The composite FK (000049) only requires the new patient to be in the same
clinic.

Reproduction (receptionist, active clinic A):
```sql
-- as postgres: completed + signed visit V for patient One, notes 'synthetic note for patient one'
-- as receptionist:
select count(*) from public.clinical_notes;                       -- 0 (cannot read notes: correct)
update public.visits set patient_id = '<patient Two>', signed_by = '<receptionist uid>', status = 'booked'
 where id = '<V>' returning patient_id, status, signed_by;        -- UPDATE 1
-- as postgres:
select v.patient_id, n.clinical_notes from visits v join clinical_notes n on n.visit_id = v.id where v.id = '<V>';
--  patient Two | synthetic note for patient one
```
Observed: the update succeeds. Patient One's signed notes, vitals and advice now show in patient Two's history, and
in patient Two's DPDP export (`exportPatientDpdpArchive` selects visits by `patient_id` and embeds `clinical_notes`).
`signed_by` now names the receptionist. The visit is reopened (`status = 'booked'`), so the app's
`isDraftLocked`/sign-off lock no longer applies to it. The same works through PostgREST with the app's anon key and a
receptionist JWT. No audit row and no `visit_revisions` row is written.

Why High: misattributed clinical records (wrong patient's allergies, Rx advice or vitals) are a patient-safety and
medico-legal integrity failure. The phase's goal is that roles without `consultations:*` cannot affect clinical
content. Signed-record immutability is deferred to V2-09a (R-21), but that deferral covers draft/signed predicates. It
does not cover a front-desk role re-keying an encounter or writing the sign-off columns. 05-PLAN has no item that
covers this.

Suggested fix: add a BEFORE UPDATE guard on `visits`, mirroring `clinical_notes_guard`:
- `id`, `tenant_id` and `patient_id` are immutable, or `patient_id` may change only while the visit has no clinical
  content, no prescriptions, diagnoses or invoices, and `signed_at IS NULL`.
- `signed_at`, `signed_by` and `current_revision` change only for a caller with `consultations:edit` (or no
  `auth.uid()`).
- `doctor_id` cannot change once `signed_at` is set.
- A signed or `completed` visit's `status` can be changed only by `consultations:edit`.

Alternatively, revoke UPDATE on those columns from `authenticated` and move the writes behind definer RPCs. Add a
pgTAP case for the receptionist path above.

---

## MEDIUM

### M-1 A huge or zero `estimated_duration_minutes` defeats `visits_no_double_booking` or blocks a calendar for years (proven)

`estimated_duration_minutes` is `integer NOT NULL DEFAULT 15` with no CHECK. `visit_slot()` turns it straight into a
range:
- `0` gives an empty range `[t,t)`, which overlaps nothing. Two zero-length visits at the same time for the same doctor
  both insert (proven: `count = 2`). The constraint is bypassed with no `is_overbooked` flag set and no conflict dialog.
- A negative value raises `range lower bound must be less than or equal to range upper bound` (SQLSTATE 22000). That
  is mapped as a generic failure, not CONFLICT. On a legacy database with such a row, 000063 fails with this error, not
  with the documented 23P01, and D6 in `scripts/db/diagnostics.sql` errors the same way.
- `2000000000` (about 3,800 years) inserts fine. After that, every later scheduled, non-overbooked visit of that doctor
  fails with 23P01 (proven: a 2030 booking was refused).

Who can do it: the in-app zod schema bounds it (5–180), but these paths do not:
- `POST /api/v1/visits` accepts any `number > 0` and runs no slot check;
- `POST /api/v1/appointments` accepts any `number > 0`;
- any `appointments:edit` member can PATCH `visits` directly through PostgREST.

A fractional value from the API reaches the DB as an integer cast error, and its raw message is returned (see L-4).

Suggested fix: `ALTER TABLE visits ADD CONSTRAINT visits_duration_range CHECK (estimated_duration_minutes BETWEEN 5
AND 480) NOT VALID`, then VALIDATE after a diagnostic. Reuse the zod bounds in both v1 routes. Add a check for negative
or zero durations to the D6 preconditions.

### M-2 One inserted queue token stops check-in for the whole clinic for the rest of the day (proven)

`queue_tokens` still lets any `appointments:edit` member INSERT and UPDATE `token_number` directly (000055). There is
no CHECK on the range. `next_queue_token` folds `max(token_number)` of the day into the counter and adds 1.

Reproduction (receptionist, clinic A):
```sql
insert into public.queue_tokens (tenant_id, visit_id, token_number, date)
values ('<A>', '<visit1>', 2147483647, public.tenant_local_date('<A>', now()));
select * from public.next_queue_token('<visit2>');
-- ERROR: integer out of range (PL/pgSQL function next_queue_token line 15)
```
Observed: every later check-in that day fails with "Failed to generate queue token." The fold-in also means the
counter's claim that a member "can neither read nor rewind it" protects little, because a member can push it to any
value (0, negative or huge numbers are all accepted). The design closes the concurrency race, but not tampering.

Suggested fix: revoke INSERT on `queue_tokens`, and UPDATE of `token_number`/`date`, from `authenticated`. Have
`next_queue_token` insert the token row itself (one definer statement: counter + insert, which also removes the burned
number when the app insert fails). Failing that, add `CHECK (token_number BETWEEN 1 AND 9999)` and cap the fold-in.

### M-3 Clinical notes of a signed visit are freely rewritable, with no revision or audit (proven; immutability deferred to V2-09a)

`clinical_notes_guard` checks only key immutability and the nurse's vitals-only rule. It does not look at the visit's
`signed_at` or `status`, and no DB-side audit or revision is recorded.

Reproduction: completed visit, `signed_at` set, notes written. As the doctor (`consultations:edit`):
`update clinical_notes set clinical_notes = 'rewritten after signing'` gives UPDATE 1. As the nurse (`vitals:edit`):
`update clinical_notes set vitals = '{"bp":"200/120"}'` gives UPDATE 1. Afterwards `visit_revisions` = 0 and
`audit_logs` = 0 for the visit.

Observed: the app's sign-off lock lives only in the app. The visit row's write filter carries the lock, but the
notes write does not (see L-2 for the race). Any direct PostgREST call bypasses it. This follows from R-21's deferral,
but the new table is the natural place for the predicate and 05-02a shipped without it. Severity is Medium, not High,
because only clinical roles can do this.

Suggested fix (can land before V2-09a without breaking the amendment flow): in `clinical_notes_guard`, refuse an
update when the parent visit has `signed_at IS NOT NULL AND status <> 'in_consultation'`. That state is exactly the
app's `isDraftLocked` / reopen-for-amendment rule.

---

## LOW

### L-1 Partial or incomplete DPDP export is returned as success
In `features/dpdp/export.ts`, only the patient query's error is checked. An error from the encounters, prescriptions,
documents, invoices, payments or consent query is dropped (`data ?? []`), and the bundle ships with 200 and an audit
row `status: completed`. A Right-to-Access response can silently miss whole sections. Fix: check each `error` and throw
an `ExportIncompleteError` (500 with a fixed text). Separately (not a leak): the PDF path of
`/api/v1/patients/[id]/export` records `dpdp.data_export` twice, because the service has `skipAudit: false` and the
route records again.

### L-2 Notes and visit writes are non-atomic in `/api/v1/visits`
- PATCH writes `clinical_notes` before the locked visit update. A sign-off that lands in between leaves the signed
  visit's notes modified while the API returns 409. The implementer acknowledges this as a residual.
- POST inserts the visit and then updates `clinical_notes.chief_complaints`. If the second write fails, the client gets
  500 but the visit exists; a retry creates a duplicate visit, or 23P01 for a scheduled slot. Fix: one RPC per command
  (V2-07), or return 201 with a warning.

### L-3 The deadlock retry covers only `createVisit`
caf7779 retries once on 40P01 in `features/visits/service.ts`. The other writers that can hit the same race do not:
- `POST /api/v1/visits` and `POST`/`PATCH /api/v1/appointments` map 40P01 to `DATABASE_ERROR` 500 and return the raw
  message;
- `consume_reschedule_token` (40P01 becomes `not_found` for the patient).

With three or more concurrent racers, the single retry can deadlock again. The retry itself is safe: a deadlock rolls
back the whole PostgREST statement, including the AFTER INSERT `clinical_notes` row. Fix: share an `insertVisitWithRetry`
helper, or map 40P01 to CONFLICT ("try again") everywhere.

### L-4 Raw database error text in `/api/v1` responses
These routes return `error.message` / `insertErr?.message` / `updateErr?.message` in the body:
- `GET /visits`, `GET /visits/[id]`, and the PATCH fetch;
- `POST /visits` insert;
- `/appointments` GET, POST insert, and PATCH update and cancel;
- `/patients`, `/lab-orders`.

With the new constraints these now carry constraint names and key tuples, for example `Key (doctor_id,
tenant_id)=(…) is not present in table "memberships"`, `visits_clinical_content_moved`, the `visit_slot` range error,
and 22P02 text for a fractional duration. `referrals` was fixed in this diff; the rest were not. Fix: route every
error through `mapDbError` and fixed texts, and map 23503 to 422.

### L-5 `log_audit` lets any member write arbitrary events for their clinic (proven)
A receptionist called
`log_audit(A, 'dpdp.data_export', 'patient', <patient>, '{"free_text":"…","status":"completed"}')`, and the row was
stored with `actor_role = receptionist`. The actor is honest, but the action, entity and up to 4 KiB of free-form
metadata are caller-chosen. The app's `ALLOWED_METADATA_KEYS` allow-list is not enforced in SQL, so a direct RPC can
plant fake compliance events (a "completed" export the role may not perform) or PHI in `audit_logs`. Fix: enforce the
metadata key allow-list and an action allow-list (or prefix per permission) inside `log_audit`.

### L-6 Deleting an API key erases attribution in the audit trail
`audit_logs_tenant_api_key_fkey ... ON DELETE SET NULL (api_key_id)` plus the new `api_keys_delete` policy
(`clinic:manage`) means deleting a key nulls `api_key_id` on every audit row it produced. Also
`webhook_subscriptions` delete cascades its delivery history. Fix: allow only revoke (no DELETE) on `api_keys`, or make
the audit FK `RESTRICT`.

### L-7 Storage UPDATE and DELETE allow tampering inside a clinic
These are documented deferrals (R-23 to V2-09a/c); I list them because the per-class policies do not bind the
object's id segments to rows:
- Any `prescriptions:edit` holder can overwrite any `rx_vN.pdf` of the clinic, including another doctor's signed Rx
  served to patients by share link. The `<visit>` segment is not checked against the doctor or the visit.
- The receipt own-visit branch lets a doctor overwrite their visit's receipt PDF.
- Any `labs:edit` holder can DELETE any lab object straight through the Storage API, leaving a `patient_documents` row
  that points at nothing.

Fix (when versioned keys land): no UPDATE; DELETE only through the service after the row delete.

### L-8 Some legacy lab objects become unreadable
The lab class regex limits `<name>` to 255 characters. Legacy keys were `<patient>_<original>_<date>.<ext>` with an
unbounded original filename, so a legacy object whose name is longer than 255 characters fails SELECT and can no
longer be signed. The local DB holds no objects, so this is not proven against data. Fix: run the D3-style diagnostic
`select count(*) from storage.objects where bucket_id = 'clinic-records' and name !~ <lab regex> and name ~
'^tenants/.+/labs/'` before 000058 on any shared database.

---

## INFO

- **I-1 The doctor FK `RESTRICT` blocks any future staff offboarding.** No code deletes memberships today (000019
  revoked it, and no definer deletes). Once removal is built, a doctor with any visit, Rx, follow-up, custom list or
  schedule block cannot be removed. Plan a soft-deactivate (`memberships.status`) rather than DELETE.
- **I-2 000053 is not a pure expand.** It clears the six `visits` columns and adds a VALID CHECK in the same migration.
  An app build from before 05-02a that is still serving during deploy would show empty notes and fail every
  consultation save (23514). This is acceptable under PO-15 (no production data). For a live cut-over, split it into
  backfill + dual-read, then clear + CHECK after deploy.
- **I-3 Storage policies are bypassed when the storage provider is R2.** `getStorageProviderForDb` can return an R2
  provider with bucket-wide credentials. The 000058 policies then do not apply; only the app-side
  `isPatientStoragePath` check does.
- **I-4 Two concurrent check-ins of the same visit** both obtain a number. The second insert fails on
  `queue_tokens_visit_id_key`, which burns a number and returns "Failed to register queue entry" to one desk. This is
  cosmetic.
- **I-5 Counter design is otherwise sound.** Concurrent first-of-day callers serialise on the `ON CONFLICT` row lock
  (the loser gets `greatest(1, …)+1 = 2`). The day comes from `now()` in SQL, so callers cannot choose it.
  `tenant_local_date` matched `lib/datetime` (Intl) for 24 zone strings at a UTC 19:00 boundary (IST next day),
  including `EST`, `Etc/GMT-14`, `+05:30`, `-0800`, `+14`, `Z`, `IST`, a trailing-space name, `GMT+5`, `UTC+05:30` and
  `posix/…`. No parity gap was found.

---

## Attacks tried that failed (no finding)

- **Cross-tenant child rows:** after 000051 no single-column FK into a tenant parent remains. Every `*_id` without an
  FK is either a catalogue id, `audit_logs.entity_id`, `payments.command_id`, or `document_share_tokens.resource_id`,
  and the last is resolved tenant-scoped by `share_token_resource`/`consume_reschedule_token`.
- **FK index sweep:** every FK in public, ops and private has an index whose leading columns equal the FK columns.
- **Tenant purge:** `DELETE FROM tenants` with a visit, queue token, invoice and clinical_notes row cascades cleanly;
  the RESTRICTs do not block it. Deleting a patient or doctor membership with history is refused (23503), as intended.
- **Clinical content left in other places after 000053:** no SQL function, view or webhook payload builder still
  reads the six `visits` columns (`pg_proc` scan). `visit_revisions.snapshot` is `consultations:view` only.
  `audit_logs` SELECT is `clinic:manage` only, with INSERT revoked. `visits.metadata` carries only confirmation and AI
  flags.
- **Receptionist reading notes:** `clinical_notes` SELECT returns 0 rows for a receptionist.
- **Storage:** a malformed tenant segment is denied, not 22P01. A multi-clinic member cannot reach another clinic's
  prefix (`tenant_ids_with` is bound to the active clinic). Lab names cannot contain `/`, so there is no traversal.
  Uppercase UUIDs are denied.
- **DPDP export DTOs:** every query is filtered by `ctx.tenantId`. Embedded items follow composite FKs, so they are
  same-tenant. The allow-lists hold no storage path, token hash, staff id or tenant id on rows. `pickFields` copies own
  properties only.
- **Exclusion constraint semantics:** touching slots (10:00–10:15 and 10:15–10:30) do not conflict. A null
  `scheduled_at` is excluded from the predicate. `visit_slot` is truly time-zone independent (minutes only).
  `consume_reschedule_token` maps 23P01 to `slot_taken`, and the token stays usable.
- **Legacy `generate_daily_queue_token`:** still granted, but permission-checked and read-only, so it cannot be
  abused.
- **Composite-FK VALIDATE on dirty data:** fails with 23503 and rolls back, as documented. I reproduced the negative
  duration case in M-1 for 000063.
