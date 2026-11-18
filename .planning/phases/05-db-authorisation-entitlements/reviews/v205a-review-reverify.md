# V2-05a re-verification of the 05a review fixes (adversarial)

- Commit: `505d10e` (branch `v2/phase-05-db-authorisation-entitlements`). Local stack at migration `000074`
  (`select max(version) from supabase_migrations.schema_migrations` → `000074`). No reset was needed or run.
- Method: isolated re-verifier, no implementer context. I re-ran each original reproduction from the three reports, then
  looked for a new route to the same outcome. I read the fix records (05-11a/b/c) only after the probes. Every probe ran
  on 127.0.0.1:54322 as `authenticated`, with `request.jwt.claims` and `request.headers` (`x-clinicos-tenant`) set the
  way PostgREST sets them. Each probe ran inside `BEGIN … SAVEPOINT … ROLLBACK` on a synthetic fixture: clinics A and B;
  owner OA, admin AD, doctors DR and DR2, receptionist RC and nurse NU in A; owner OB in B; PUP, a confirmed account
  with no membership; patients P1 and P2. V1 is DR's signed, completed visit for P1, with notes, an Rx and an issued
  ₹500 invoice. V2 is DR2's unsigned visit and V3 is DR's unsigned visit for P2. Afterwards I confirmed that no fixture
  rows were left (0 users, tenants and visits).
- Probe scripts (session scratchpad, not in the repo): `fx.sql` (fixture), `h_visit.sql`, `m_signed.sql`,
  `m_actor.sql`, `m_dur_tok.sql`, `m_notice_key_inv.sql`, `m_invoice.sql`, `legit_amend.sql`, `diag.sql`.
- No source edits, commits or pushes. No `.env*` read. No hosted Supabase used.

## Summary

| ID | Status | One line |
|---|---|---|
| H-VISIT | **CLOSED** | Re-keying, forged or cleared sign-off, and reopening without an amendment row are all refused. A sibling route through child rows is new finding N-1. |
| H-INVITE | **CLOSED** | `token_hash` cannot be selected or filtered on. `consume_invitation` binds to the caller's confirmed email. |
| M-ACTOR | **CLOSED** (triaged columns) | consent, referral, prescription and amendment actors are bound to the caller. `patients.created_by` is still forgeable (N-5, Low). |
| M-SIGNED | **PARTIAL** | Notes and vitals of a signed visit are locked. But the amendment row's `snapshot` is whatever the caller sends, so any doctor can replace signed content and leave no faithful record (N-2). |
| M-DURATION | **CLOSED** | CHECK 5–480 is validated. The app and v1 use the same bounds. |
| M-TOKEN | **CLOSED** | No INSERT on `queue_tokens`. Members can update only priority, called_at and completed_at. `issue_queue_token` reuses a visit's token. |
| M-INVOICE | **PARTIAL** | Direct invoice UPDATE, a paid INSERT and a direct payment INSERT are refused. A doctor can still flip an invoice to `paid`, or zero it, by editing `invoice_items` (N-3). |
| M-NOTICE | **CLOSED** | Members can update only `is_read` and `read_at`. Content and links cannot be written. |
| M-APIKEY | **CLOSED** | A member can update only `name`, `revoked_at` and `updated_at`. A revoked key stays revoked. DELETE is revoked. |
| M-APINOTES | **CLOSED for `/visits`** | `/api/v1/patients/[id]` PUT still lets a key write `allergies` and `chronic_conditions` (N-6, latent). |

New findings: **3 Medium** (N-1, N-2, N-3), **1 Medium, latent** (N-6), **2 Low** (N-4, N-5), **1 Low/Info** (N-7),
**1 Low** (N-8), **1 Info** (N-9). No regression on the legitimate paths tested (see the end).

---

## H-VISIT: CLOSED

| Probe (as) | SQL | Result |
|---|---|---|
| HV1 RC | `update visits set patient_id=P2 where id=V1` | 42501 `VISIT_KEY_IMMUTABLE` |
| HV2 RC | `update visits set signed_by=DR2 where id=V1` | 42501 `VISIT_SIGNOFF_FORBIDDEN` |
| HV3 RC | `… set signed_at=null, signed_by=null, status='in_consultation' where id=V1` | 42501 `VISIT_SIGNOFF_FORBIDDEN` |
| HV4 RC | `… set status='booked' where id=V1` | 42501 `VISIT_SIGNED_STATUS_FORBIDDEN` |
| HV5/6 RC | sign unsigned V2 as DR / as self | 42501 `VISIT_SIGNOFF_FORBIDDEN` (both) |
| HV7 DR2 | sign V3 naming DR | 42501 `VISIT_SIGNOFF_FORBIDDEN` |
| HV8 DR | `set status='in_consultation'` on V1 with no amendment row | 42501 `VISIT_REOPEN_NEEDS_AMENDMENT` |
| HV9 RC | INSERT a visit already signed | 42501 `VISIT_SIGNOFF_FORBIDDEN` |
| HV10 RC | INSERT with `created_by = OA` | 42501 `VISIT_ACTOR_NOT_CALLER` |
| HV11 service_role | re-key `patient_id` | 42501 `VISIT_KEY_IMMUTABLE` (every path) |
| HV15 DR | take DR2's unsigned visit (`doctor_id = DR`) | 42501 `VISIT_DOCTOR_REASSIGN_FORBIDDEN` |
| HV16 RC | change `doctor_id` of signed V1 | 42501 `VISIT_SIGNED_DOCTOR_IMMUTABLE` |
| HV17 RC | cancel signed V1 | 42501 `VISIT_SIGNED_STATUS_FORBIDDEN` |
| reopened V1, RC | `set status='completed'` | 42501 `VISIT_SIGNED_STATUS_FORBIDDEN` |
| catalogue | `visits_tenant_signed_by_fkey` | `convalidated = t` |

Other routes tried:
- HV12, service role (no `auth.uid()`): `update visits set status='in_consultation' where id=V1` succeeds. The visit
  is reopened with no amendment row. The only service-role writer that faces a caller is v1 PATCH, and it refuses any
  change to a completed or signed visit (`isVisitLocked` and the `.neq('status','completed').is('signed_at', null)`
  filter). Not reachable today; see N-9.
- HV13 and HV14: unsigned visits are not frozen, by design. See N-4 for the one consequence that matters.
- New route to the same outcome: the encounter's **child clinical rows** can still be moved to another patient.
  See N-1.

## H-INVITE: CLOSED

| Probe | Result |
|---|---|
| AD `select role, token_hash from invitations` | 42501 permission denied (column grant) |
| AD `select role from invitations where token_hash like 'a%'` (filter oracle) | 42501 (a WHERE clause needs the column's SELECT privilege) |
| AD `select id, role, invited_address from invitations` | the owner invitation is listed without the hash (intended) |
| PUP (confirmed, different email) `consume_invitation(<owner hash>)` | 42501 `INVITATION_EMAIL_MISMATCH` |
| AD INSERT an `owner` or `admin` invitation addressed to PUP | RLS refusal (both) |
| PUP's email set to the invited address (different case) and confirmed | joins A (legitimate path works; case-insensitive match) |
| same, but `email_confirmed_at` null | 42501 `INVITATION_EMAIL_UNCONFIRMED` |

Other routes checked:
- `invitations` has no UPDATE or DELETE privilege, so `invited_address`, `role` and `token_hash` cannot be rewritten.
- `memberships` UPDATE columns are profile fields only, not `role`.
- No definer function returns the hash. The raw token is never returned or delivered (`features/staff/actions.ts`;
  delivery is AUTH-06).
- `token_hash` is UNIQUE, and a 256-bit hash cannot be guessed.
- Dependency (Info): the binding is only as strong as GoTrue's email confirmation. `supabase/config.toml` has
  `enable_confirmations = true` and `double_confirm_changes = true`. The hosted project must keep "Confirm email" on.
  Otherwise anyone can sign up as the invited address with `email_confirmed_at` already set. That still needs the raw
  token, so this is defence-in-depth, not a hole. Worth a line in the 05-b0 runbook.

## M-ACTOR: CLOSED (for the triaged columns)

| Probe | Result |
|---|---|
| MA1 RC inserts a consent with `recorded_by = OA` | 42501 `ACTOR_INVALID` (with `recorded_by = RC`: ok) |
| MA2 DR inserts a referral with `referring_doctor_id = OA` | 42501 `ACTOR_INVALID` |
| MA2b DR inserts as self, then `update … set referring_doctor_id = DR2` | 42501 `ACTOR_INVALID` |
| MA3 DR2 inserts an Rx with `doctor_id = DR` | 42501 `PRESCRIPTION_DOCTOR_NOT_CALLER` |
| MA3b DR inserts an Rx for V3 (patient P2) with `patient_id = P1` | 42501 `PRESCRIPTION_PATIENT_MISMATCH` |
| MA4 DR2 inserts `visit_revisions` with `amended_by = DR` | 42501 `AMENDMENT_AUTHOR_NOT_CALLER` |

Residual: `patients.created_by` (listed in RLS M-3 but left out of the triage row) can still be forged on INSERT and
UPDATE. See N-5. A catalogue sweep of the other member-writable actor columns found `follow_ups.doctor_id`,
`schedule_blocks.*`, `waitlist_entries.*`, `patient_documents.uploaded_by` and `webhook_subscriptions.created_by`.
These are scheduling or attribution fields with composite FKs to memberships where they exist. I treat them as
part of N-5.

## M-SIGNED: PARTIAL

| Probe | Result |
|---|---|
| MS1 DR `update clinical_notes set clinical_notes='rewritten' where visit_id=V1` | 42501 `CLINICAL_NOTES_VISIT_SIGNED` |
| MS2 NU `update clinical_notes set vitals='{"bp":"200/120"}' where visit_id=V1` | 42501 `CLINICAL_NOTES_VISIT_SIGNED` |
| MS3 DR2: amendment row with `snapshot='{}'`, reopen, rewrite notes and vitals, finalize as DR2 | **all succeed**. Afterwards: `exists(visit_revisions.snapshot like '%synthetic signed note%') = f`, `exists(audit_logs for V1) = f` |

The guard requires *an* amendment row by the caller, but nothing ties the row's `snapshot` to the content being
amended. The app builds the snapshot client-side (`features/consultation/service.ts` ~l.898) and inserts it with the
member's own JWT. So a direct PostgREST call can store `{}` and the original signed content is gone. See N-2. Signed
prescription items and diagnoses are not locked either (MS4–MS7, CD2). The triage deferred full immutability to V2-09a,
so I do not count that against M-SIGNED. The cross-patient part is N-1.

## M-DURATION: CLOSED

| Probe | Result |
|---|---|
| MD1 RC INSERT `estimated_duration_minutes = 0` | 23514 `visits_duration_range` |
| MD2 RC UPDATE to `2000000000` | 23514 |
| MD3 480 ok, 481 refused | as expected |
| catalogue | `visits_duration_range` validated |
| app | `features/visits/duration.ts`: `visitDurationSchema` 5–480; `apiVisitDuration` is used by v1 `/visits` and `/appointments` |

## M-TOKEN: CLOSED

| Probe | Result |
|---|---|
| MT1 RC `insert into queue_tokens … token_number = 2147483647` | 42501 permission denied |
| MT3 RC UPDATE `token_number` or `date` | 42501 permission denied. `priority` and `called_at`: ok |
| MT2 `issue_queue_token(V2)` ×2, then `(V3)` | 1/f, 1/t (reused), 2/f |
| MT4 OB (header B) issues a token for A's visit | 42501 `forbidden` |
| MT6 nonexistent visit | 42501 `forbidden` (no existence oracle) |
| MT7 catalogue | `next_queue_token` dropped; `queue_tokens_token_range` validated |
| MT8 `p_priority = 'nonsense'` | 23514 priority CHECK (raw constraint text; see N-8 note) |

Residual (Info): a receptionist can still use up a day's 9999 numbers by creating and checking in 9999 walk-ins. That
needs 9999 visit rows and is visible, so it is not a finding.

## M-INVOICE: PARTIAL

| Probe | Result |
|---|---|
| MI1 DR `update invoices set status='paid', total_amount=0` | 42501 permission denied |
| MI2 DR INSERT an invoice with `status='paid'` | 42501 `INVOICE_STATUS_RPC_ONLY` |
| MI3 RC `insert into payments …` | 42501 permission denied |
| MI4 DR `record_payment(…)` | 42501 `FORBIDDEN` |
| HV15 DR takes a colleague's visit to reach its invoice | 42501 `VISIT_DOCTOR_REASSIGN_FORBIDDEN` |
| MI8 DR2 (not the visit's doctor) | sees 0 invoices; item UPDATE → 0 rows |
| **MI5** RC `record_payment(I1, 100)` (status stays `issued`), then DR `update invoice_items set unit_price=100, total_price=100 where id=IT1` | **UPDATE 1 → invoice `paid`, total 100, paid 100**. Only the ₹100 payment audit exists; nothing records the ₹400 that was never collected |
| **MI6** DR inserts an item with `total_price = -500` | **ok → subtotal 0, total 0** |
| **MI7** DR sets `unit_price=500, quantity=1, total_price=1` | **ok → total 1** (no consistency CHECK) |

So a doctor without `billing:collect` can still move an invoice into `paid` without collecting, or zero it. The
original M2 reported exactly this outcome. It now runs through `invoice_items` and the definer
`invoice_items_sync_invoice`, which derives `paid`. See N-3.

## M-NOTICE: CLOSED

| Probe | Result |
|---|---|
| MN1 RC rewrites a broadcast's `message` and `link_url` | 42501 permission denied |
| MN2 RC rewrites the title of its own addressed notice | 42501 permission denied |
| MN3 RC marks a broadcast read | ok (read state is shared; assigned to V2-11) |
| MN4 RC INSERT | 42501. RC DELETE of a broadcast: 0 rows |
| MN5 system INSERT with `link_url` `//evil.example` or `/\evil.example` | 23514 `in_app_notifications_link_url_relative` |
| MN6 definer functions that write notices and are callable by members | only `consume_reschedule_token` (fixed text, `/calendar`) |

See N-7 for a gap in the link regex. It is defence-in-depth only, because no member can write `link_url`.

## M-APIKEY: CLOSED

| Probe | Result |
|---|---|
| MK1 AD rewrites the owner key's `key_hash` and `key_prefix` | 42501 permission denied (column grant) |
| MK2 AD clears `revoked_at` | 42501 `API_KEY_REVOKED` |
| MK3 AD sets `created_by` | 42501 permission denied |
| MK4 AD DELETE | 42501 permission denied |
| MK5 AD adds a scope (UPDATE) / inserts a scoped key / inserts with `created_by = OA` | 42501 permission denied / `API_KEY_SCOPE_FORBIDDEN` / `API_KEY_ACTOR_INVALID` |
| MK7 OA revokes; AD revokes | ok (legitimate revoke works) |
| lib/api/auth.ts | looks keys up `.is("revoked_at", null)`, so a future-dated `revoked_at` also counts as revoked (no "un-revocable key" trick) |

Info: admins can still SELECT `key_hash`. It is the SHA-256 of a 48-hex-character random secret, so this does not
lead to authentication. An owner cannot add a scope to an existing key (an approved deviation); no app path sets
scopes.

## M-APINOTES: CLOSED for `/api/v1/visits/*`

`lib/api/visit-dto.ts` `V1_VISIT_COLUMNS` contains no clinical columns. `hasClinicalField` and `status:'completed'`
both return 403 `CLINICAL_ACCESS_DENIED`. A locked visit is 409. I did not find a `clinicalNotesEmbed` in `app/api/v1`.
`/prescriptions`, `/referrals` and `/lab-orders` are assigned to P1-37. `/patients` is not, and it is N-6.

---

## New findings

### N-1 (Medium) A signed encounter's prescription items and diagnoses can be moved to another patient, and edited, by any doctor

The visit and the Rx header are now re-key-proof. Their child rows are not:
- `prescription_items`: UPDATE is allowed to any `prescriptions:edit` holder, there is no guard, and the composite FK
  covers the tenant only.
- `consultation_diagnoses`: UPDATE is allowed with no guard. Its `patient_id` is not tied to its visit's patient.

```sql
-- as DR2 (a doctor who is not the visit's doctor), header A
update prescription_items set prescription_id = '<RX2: V3, patient P2>' where prescription_id = '<RX1: signed V1, P1>';  -- UPDATE 1
update consultation_diagnoses set visit_id = '<V3: P2>' where visit_id = '<V1>';               -- UPDATE 1, row now V3 + patient_id P1 (inconsistent)
update consultation_diagnoses set visit_id = '<V3>', patient_id = '<P2>' where visit_id = '<V1>';   -- UPDATE 1
update prescription_items set medicine_name='…', dosage='4-4-4' where prescription_id = '<RX1>';  -- UPDATE 1 (signed Rx)
delete from prescription_items where prescription_id = '<RX1>';                                   -- DELETE 1
update prescriptions set version = 9, signed_at = null where id = '<RX1>';                       -- UPDATE 1
```

Impact: patient One's signed medicines and diagnoses show up in patient Two's record, PDF and DPDP export. This is the
patient-safety outcome of H-VISIT, reached through the children. Only clinicians can do it, which is why it is Medium,
not High. Signed-Rx immutability is V2-09a, but re-keying across patients is not an immutability question.

Fix:
- Add BEFORE UPDATE guards that make `prescription_items.prescription_id`/`tenant_id` and
  `consultation_diagnoses.visit_id`/`patient_id`/`tenant_id` immutable.
- On INSERT, require `consultation_diagnoses.patient_id` to equal the visit's patient (same pattern as
  `prescriptions_actor_guard`).
- Optionally, until V2-09a, apply the M-SIGNED rule to these children: no write while the parent visit is signed and
  not `in_consultation`.

### N-2 (Medium) Amendment rows take a caller-supplied snapshot, so signed content can be replaced with no faithful record

Probe MS3 (above), as DR2 on DR's signed V1:
1. Insert `visit_revisions(snapshot = '{}')`.
2. Reopen the visit.
3. Rewrite `clinical_notes` and `vitals`.
4. Finalize, signed by DR2.

All four steps succeed. Afterwards no revision snapshot and no audit row holds the original text. The app's own
reopen and finalize audits are written by the app, so a direct Data-API run leaves none.

Impact: M-SIGNED's intent ("refused unless reopened through the amendment path, amendment row written") is met in
form but not in effect. The medico-legal history of a signed note is whatever the amending doctor chose to store.

Fix: in `visit_revisions_actor_guard`, stamp `NEW.snapshot` server-side from `clinical_notes`,
`consultation_diagnoses` and the latest Rx with its items, ignoring the client value. The app's snapshot already has
this shape. Alternatively, move reopen into a definer RPC that writes the row and the status change together, and
also writes an audit row.

### N-3 (Medium) A doctor can settle or zero an invoice without collecting, through `invoice_items`

Probes MI5, MI6 and MI7 (above). The doctor's own-visit branch on `invoice_items` INSERT and UPDATE has no CHECK on
`unit_price`/`total_price`, no rule that `total_price = unit_price × quantity`, and no restriction on invoices that
have payments. `invoice_items_sync_invoice` (SECURITY DEFINER) then derives `status = 'paid'` once
`paid >= total > 0`. So:
- after a partial payment at reception, the doctor lowers an item and the invoice becomes `paid`;
- with no payment, a negative item zeroes the bill.

Neither change writes a payment, an `invoice.payment_recorded` audit or an outbox event. Rated Medium, the same as the
original M2: it is a PO-3 collection bypass, and it needs a doctor on their own visit.

Fix:
- `CHECK (unit_price >= 0 AND total_price = round(unit_price * quantity, 2))` on `invoice_items`. Use NOT VALID, then a
  diagnostic, then VALIDATE.
- Have the sync trigger never promote `issued → paid`. Only `record_payment` sets `paid`. The demotion `paid → issued`
  when items grow can stay.
- Optionally, limit the doctor's own-visit write branch to invoices with no payments.

### N-4 (Low) The front desk can mark an unsigned visit `completed`, which blocks the doctor's sign-off in the app

Probe HV13: RC `update visits set status='completed' where id=<unsigned V3>` gives UPDATE 1 with `signed_at` null. The
guard limits status only once a visit is signed. `completeAndSignConsultation` then refuses with "This consultation is
already signed." (`visit.status === "completed"`), and Sign & Bill refuses with it. The visit looks finished but
carries no signature. No signature is forged, and a doctor can still sign through the DB (the guard allows it). The
practical effect is a stuck encounter. The IND M1 fix text proposed gating "status moving to or from completed" on
`consultations:edit`.

Fix: in `visits_integrity_guard`, a change of `status` to `completed` on the user path requires `consultations:edit`
and the sign-off in the same write. Check the queue checkout path first: it treats completed as a no-op and only
transitions to completed after sign-off.

### N-5 (Low) Remaining unbound actor columns, notably `patients.created_by`

As RC: `insert into patients (…, created_by) values (…, OA)` succeeds (`forged_creator = t`), and
`update patients set created_by = DR where id = P1` gives UPDATE 1. `patients.created_by` was in RLS M-3's list but
not in the triage's M-ACTOR row. The DPDP export DTO already drops actor ids, so the impact is attribution inside the
clinic only. Fix: make `created_by` = `auth.uid()` on INSERT and immutable on UPDATE (user path), as for `visits`. Do
the same sweep for `patient_documents.uploaded_by`.

### N-6 (Medium, latent behind PO-16) An API key can write patients' allergies and chronic conditions, which its creator (an admin) cannot

`app/api/v1/patients/[id]/route.ts` PUT accepts `allergies` and `chronic_conditions` (its zod schema) and writes them
with the system client. With no `auth.uid()`, `patients_clinical_fields_guard` is skipped. In the app, an admin who
changes those fields gets 42501 `PATIENT_CLINICAL_FIELDS`, because admins lack `consultations:view`. Through a key the
admin mints, the same write succeeds. That is the M-APINOTES / R-9 argument on a route the fix did not cover, and it
is missing from 05-11c's P1-37 hand-off list (`/prescriptions`, `/referrals`, `/lab-orders`). An allergy changed
silently is a patient-safety issue. Latent only because `/api/v1` is hard-off in every deployed tier.

Fix: strip `allergies` and `chronic_conditions` from the v1 patient write schema, or answer 403
`CLINICAL_ACCESS_DENIED` as the visits route does. Add `/patients` (allergies and conditions, read and write) to the
P1-37 prerequisite list.

### N-7 (Low/Info) The relative-link CHECK accepts `/<TAB>/host`

`in_app_notifications_link_url_relative` is `'^/([^/\\]|$)'`. The value `E'/\t/evil.example'` passes, and browsers
strip ASCII tab and newline from URLs, so it resolves to `//evil.example` (off-site). `E'/\tevil.example'` was
accepted in MN5; the `/\t/` form follows from the same regex. No member can write `link_url` (column grant), so this
only matters if a system writer ever builds a link from user input. Fix: use `^/(?![/\\])[^\s]*$` or
`^/[A-Za-z0-9_\-./?=&%#]*$`, and refuse any control or whitespace character.

### N-8 (Low) A doctor can block every future amendment of any visit by squatting the revision number

Probe MS8: DR2 inserts `visit_revisions(visit_id = V1, revision_number = 2147483647, amended_by = DR2)`, which is
allowed. The app computes `max(revision_number) + 1` (`features/consultation/service.ts` l.896), which overflows, so
every later reopen of V1 fails with "Failed to create audit revision record." The row is attributed to DR2, so this is
visible. Fix: let the guard assign `revision_number` (`max + 1` under the visit row lock) and ignore the client value.
This fits N-2's server-side stamping.

Separately (Info, MT8): `issue_queue_token` with an invalid `p_priority` surfaces raw 23514 text that includes the
failing row. Validate `p_priority` in the RPC (P0001 `INPUT_INVALID`).

### N-9 (Info) Service-role writes can still reopen a signed visit without an amendment

Probe HV12: the guard's sign and status rules apply only when `auth.uid()` is set. v1 PATCH is the only caller-facing
service-role writer of `visits.status`, and it refuses locked visits, so this is not reachable today. Record it as a
P1-37 / V2-07 invariant: either move "signed visit status only via amendment" to every path, or keep every
service-role visit writer lock-filtered.

---

## Legitimate paths (regression check): none broken

| Path | Probe | Result |
|---|---|---|
| Doctor signs own visit (app-shape update: `status, signed_at, signed_by = self`, filter `signed_at is null`) | MI10 | ok |
| Doctor Sign & Bill: issued invoice for own visit + 2 items, discount 50 | MI10 | total stamped 650; items recompute subtotal 700 and total 650; status `issued` |
| Owner collects at the doctor's desk (`record_payment`, 650) | MI10b | `paid` |
| Receptionist collects in full / partially | MI9 / MI5 | `paid` / `issued` |
| Amend a signed visit (app flow: revision 1, reopen, nurse vitals, doctor notes, Rx version bump, finalize) and amend again (revision 2) | legit_amend | ok; `current_revision` 2 then 3 |
| Amendment by a second doctor, then by the original doctor | legit_amend ALT | ok |
| Reopen again without a new row after finalize | legit_amend ALT2 | refused (intended) |
| Nurse records vitals on an unsigned visit | MI12 | ok |
| Receptionist checks in twice / a second visit | MT2 | token reused / next token |
| Nurse check-in (`appointments:edit`) | MT5 | ok |
| Owner revokes a key; admin revokes a key | MK7 | ok |
| Receptionist records consent as self | MA1b | ok |
| Invitee with a confirmed matching email (different case) accepts | HI5 | joins the clinic |
| Mark a notice read | MN3 | ok |
| `log_audit` allow-lists vs `lib/audit/audit.ts` | DB function output vs the app arrays | every app action present; keys differ only by `actor_type` and `api_key_id` (intended) |

Notes:
- Finalize requires the signature to actually change (`v_sign_changed`). A finalize in the same transaction as the
  original sign-off, with an identical `now()`, is refused. My first fixture hit this. The app uses a fresh JS
  timestamp, so the app path is unaffected.
- Behaviour changes that are approved deviations, not regressions: an owner cannot add a scope to an existing key; a
  shared broadcast's read state is still shared.
