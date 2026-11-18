# V2-05a independent review

- Scope: `git diff v2/phase-04-jobs-reliability...8bda1c6` (branch `v2/phase-05-db-authorisation-entitlements`), focused on
  migrations 000046-000067, the app/feature server code they touch, `lib/` authz/audit/db helpers, and the pgTAP gate.
- Requirements read: `05-PLAN.md` (05a plans), `AUTHZ-MATRIX.md`, `CLAUDE.md`. The per-plan records and wave notes were
  read only after the findings below were formed, to drop or annotate items that are already tracked.
- Reviewer: isolated Claude reviewer (fresh context). Read-only: no source change, no commit, no `db reset`.
- Local stack at migration `000067` (empty data). Every probe ran as `authenticated` with synthetic JWT claims and the
  `x-clinicos-tenant` header inside `BEGIN … ROLLBACK`. Probe scripts are in the session scratchpad and are not part of
  the repo.

## Summary

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 5 |
| Low | 8 |
| Info | 6 |

Overall, the core of 05a holds up under adversarial reading. The authz helpers are bound to the active tenant, every
definer function has a pinned `search_path` and explicit grants, the composite FKs go through expand/validate/contract,
and the per-class storage policies are sound. The defects below are mostly in **column-level authority**: the policies
decide which rows a role may write, but several tables still let that role write every column of those rows. As a
result, front-desk and clinical roles can change fields that belong to a different role or to an RPC: sign-off
fields, invoice status, notification content, and API-key secrets.

---

## Medium

### M1. A receptionist (any `appointments:edit` holder) can un-sign a consultation and re-sign it in anyone's name
- **Where:** `supabase/migrations/000055_policies_front_desk.sql:90` (`visits_update`: `appointments:edit`, table-level
  UPDATE grant, no guard trigger); `visits.signed_by` keeps its single-column FK to `auth.users` only.
- **Verified by running:** a receptionist set `status='in_consultation', signed_at=NULL, signed_by=NULL` on a completed,
  signed visit. They then set `status='completed', signed_at=now(), signed_by=<an auth user with no membership in the
  clinic>`. Both updates succeeded.
- **Failure scenario:** a front-desk user takes their JWT from the browser session and PATCHes `/rest/v1/visits`
  directly. They can:
  - reopen a signed encounter without any `visit_revisions` amendment row. `isDraftLocked` then treats it as a draft,
    so any doctor can silently rewrite the notes;
  - forge who signed it and when. The signer can be any user id, even someone outside the clinic.

  05-02a moved clinical content off `visits` so the front desk could keep the visit row. The sign-off columns stayed on
  that row with front-desk write access.
- **Relation to plan:** R-21 defers draft/signed predicates to V2-09a. That covers immutability. It does not cover a
  non-clinician writing the clinical sign-off, or `signed_by` naming a non-member.
- **Fix:** add a BEFORE UPDATE guard on `visits`, keyed on `auth.uid() IS NOT NULL`. When `signed_at`, `signed_by`,
  `current_revision`, or `status` moving to or from `completed` changes, require `has_permission(NEW.tenant_id,
  'consultations:edit')` and `NEW.signed_by IS NULL OR NEW.signed_by = auth.uid()`. Then add a composite FK
  `(signed_by, tenant_id) → memberships(user_id, tenant_id)` (NOT VALID, then VALIDATE). Longer term, column grants
  that exclude these columns, with sign/reopen as definer RPCs (V2-07/V2-09a).

### M2. A doctor can mark an invoice paid or zero it without collecting, and can reach any invoice by reassigning the visit
- **Where:** `supabase/migrations/000056_policies_financial.sql:58-83` (`invoices_update`: the own-visit branch admits
  every column) together with `000055:90` (`visits_update`: a doctor holds `appointments:edit`, so they may change
  `visits.doctor_id`).
- **Verified by running:** as doctor 1:
  - the invoice of doctor 2's visit was invisible (count 0);
  - `UPDATE visits SET doctor_id = <self>` on that visit succeeded;
  - the invoice then became visible (count 1);
  - `UPDATE invoices SET status='paid', total_amount=0` succeeded.
- **Failure scenario:** PO-3 says "doctors and nurses do not collect", and the app gates this with `billing:collect`.
  But a doctor using the Data API can set any of their visits' invoices to `paid` (or set `total_amount`/`discount` to
  anything) with no payment row, no `invoice.payment_recorded` audit, and no outbox event. Reassigning a colleague's
  visit to themselves extends this to any invoice in the clinic. It also exposes the payments on it (`payments_select`
  own-visit branch). Reception then sees the bill as settled.
- **Relation to plan:** "Paid-invoice protection is V2-10's" covers edits to an already-paid invoice. Moving an invoice
  *into* `paid` without a payment is a separate collection bypass.
- **Fix:** add a BEFORE UPDATE guard on `invoices`. A change of `status` to `paid` is allowed only inside
  `record_payment`; use the transaction-local marker pattern already used for `payments_actor_guard`. A caller without
  `billing:collect` may not change `status`, `total_amount`, `discount`, `tax`, `visit_id` or `patient_id`, which
  leaves the Sign & Bill INSERT path unaffected. Separately, consider refusing a `visits.doctor_id` change once the
  visit has an invoice or a signed consultation, unless the caller holds `clinic:manage`.

### M3. Any recipient of a broadcast or role notice can rewrite its title, message and link for every colleague
- **Where:** `supabase/migrations/000057_policies_admin_system.sql:222-245` (`in_app_notifications_update`: `WITH CHECK`
  only tests the tenant). The table-level UPDATE grant covers every column (`id, tenant_id, recipient_*, title,
  message, link_url, metadata, …`). `000059` revoked only INSERT.
- **Verified by running:** a receptionist updated an unaddressed notice (`recipient_user_id` and `recipient_role` both
  NULL) to `title='Action needed', message='Re-enter your password', link_url='https://evil.example/login'`, and the
  update succeeded. Re-addressing it to another role was refused, but only because the new row then failed SELECT.
- **Failure scenario:** a staff member plants a phishing link or false instructions in a clinic-wide notice. Every
  colleague sees it in the notification drawer (`components/notifications/notification-drawer.tsx:257` renders
  `link_url` as the href). The matrix row (`self(recipient_user_id) AND full`) is only exercised on an addressed
  notice, so the generated tests cannot catch this.
- **Fix:** `REVOKE UPDATE ON public.in_app_notifications FROM authenticated; GRANT UPDATE (is_read, read_at) ON
  public.in_app_notifications TO authenticated;`. Make `WITH CHECK` mirror `USING`, and add a pgTAP case that rewrites
  `title`/`link_url` of a broadcast notice and expects 42501. Separately, a shared broadcast row has a single `is_read`,
  so one user marking it read marks it read for everyone. That is a pre-existing functional bug worth a per-user read
  table.

### M4. An admin can bypass the 000067 scope guard by re-keying the owner's export-scoped API key
- **Where:** `supabase/migrations/000067_api_key_scope_guard.sql:40-43` (trigger is `BEFORE INSERT OR UPDATE OF scopes`)
  and `000057:136-139` (`api_keys_update`: `clinic:manage`, table-level UPDATE grant on every column).
- **Verified by running (DB part):** an admin ran `UPDATE api_keys SET key_hash='<attacker hash>', created_by=<owner>`
  on an owner-created key whose `scopes = {exports:create}`, and it succeeded. Adding the scope to a key of their own
  was refused (API_KEY_SCOPE_FORBIDDEN), as designed.
- **By reading (use of the key):** `lib/api/auth.ts:102` authenticates by `key_hash`, and
  `features/dpdp/export.ts:78-92` grants the export when the key row carries the scope. The admin sets `key_hash =
  sha256('clq_live_<their secret>')` and then exports full patient dossiers, including clinical notes, with a key that
  carries the owner-only `exports:create` (ruling 01-09). That is exactly what 000067 was written to stop (T-05-19).
  The same column access also lets the admin:
  - clear `revoked_at` on a revoked scoped key;
  - set `created_by` to any user, which becomes `session.userId`. A v1 PATCH that completes a visit then records
    `signed_by` as that user (`app/api/v1/visits/[id]/route.ts:208-211`), so the admin can forge the signer.
- **Exploitability:** latent. `/api/v1` cannot be enabled in production or deployed tiers (PO-16,
  `lib/api/enabled.ts`). The DB write itself works in every tier today.
- **Fix:** restrict updatable columns (`REVOKE UPDATE … ; GRANT UPDATE (name, revoked_at, scopes, last_used_at,
  updated_at)`; the v1 path uses the service role). In the guard, refuse a user-path change of `key_hash`, `key_prefix`,
  `created_by` or `tenant_id`, and any `revoked_at` change from non-null back to null. Alternatively, fire the guard on
  every UPDATE and require each scope in `OLD.scopes ∪ NEW.scopes` when the row has any scope. Add a pgTAP case for
  the key_hash rewrite.

### M5. API keys, which admins can create, read every clinical note through `/api/v1/visits`, undoing R-9 for admins
- **Where:** `app/api/v1/visits/[id]/route.ts:82-88` and `app/api/v1/visits/route.ts:56` now embed `clinical_notes`
  explicitly (`clinicalNotesEmbed()`) on the service-role client. Any key works, and keys are created with
  `clinic:manage` (`features/api-keys/service.ts:102`), i.e. by admins.
- **By reading.** 05-02a/05-02b made clinical content invisible to admins (R-9: admins hold no clinical key). An admin
  creates a key in Settings and calls `GET /api/v1/visits/<id>`, which returns vitals, chief complaints and notes. Only
  the export was gated by a scope (05-06), and only that gate exists.
- **Exploitability:** latent behind PO-16, like M4.
- **Fix:** before P1-37 enables `/api/v1`, give keys a clinical-read scope with the same "only a holder of
  `consultations:view` may add it" rule as 000067, and omit `clinical_notes` fields for keys without it. Record this as
  a P1-37 prerequisite in the roadmap if not done now.

---

## Low

### L1. Zero-length (or huge) visits slip past `visits_no_double_booking`
- **Where:** `supabase/migrations/000063_visits_no_double_booking.sql:32-61`. There is no DB CHECK on
  `estimated_duration_minutes` (NOT NULL, default 15, any integer).
- **Verified by running:** a receptionist booked 10:00 for 15 minutes, then 10:05 with `estimated_duration_minutes =
  0` for the same doctor. Both inserts succeeded, because the empty range never overlaps. A negative value raises a
  raw 22000 from `tstzrange`. The app validates 5-180 (`features/visits/service.ts:36`), but
  `app/api/v1/appointments/route.ts:143` accepts any positive number, so a 10^6-minute booking blocks the doctor's
  calendar for years once v1 is on.
- **Fix:** `ALTER TABLE visits ADD CONSTRAINT visits_duration_bounds CHECK (estimated_duration_minutes BETWEEN 5 AND
  180) NOT VALID;` then VALIDATE in a later migration. Apply the same bounds in the v1 route.

### L2. Any doctor can issue or alter a prescription in another doctor's name
- **Where:** `000054:79-85` (`prescriptions_insert/update`: `prescriptions:edit` only). `doctor_id` is bound only by the
  composite FK to *some* membership of the clinic.
- **Verified by running:** doctor 2 inserted a prescription with `doctor_id = doctor 1`. The Rx PDF prints the
  prescriber's name and council registration from `doctor_id`.
- **Fix:** add a guard so that on the user path, INSERT requires `doctor_id = auth.uid()` and UPDATE keeps `doctor_id`
  immutable. Otherwise raise with the PO: the matrix is permission-only, and V2-09a covers signed immutability but not
  prescriber attribution.

### L3. 000053 breaks the previous app version as soon as it is applied
- **Where:** `000053_clinical_notes_expand.sql:138-151`. In one migration it clears the six `visits` columns and adds a
  VALID CHECK, which is the contract step of expand/contract.
- **Scenario:** between migration and deploy, the old build writes `vitals`/`clinical_notes` to `visits`. Saves fail
  with 23514, and anything written by an old instance after the backfill would otherwise be lost. PO-15 (no
  production) makes it Low today, but the same pattern on a live database violates CLAUDE.md's expand → migrate →
  contract rule.
- **Fix:** for future splits, add the CHECK `NOT VALID` only after the switched app is deployed, and re-run the
  idempotent backfill just before it. Note the deploy order in the 05-b0 runbook.

### L4. Message-template `request_roles` were not realigned with the 05-02b/c permission keys
- **Verified by running** (query on `ops.message_templates`):
  - `prescription_ready` and `consultation_documents` admit `nurse` (who lost `prescriptions:view`);
  - `lab_report_uploaded` admits `admin` and `receptionist` (no `labs:view`);
  - `referral_letter_issued` admits `admin` and `receptionist` (no `consultations:view`).

  000046 fixed only `receipt_issued`. The DB backstop (`enqueue_message`, 000061) is therefore wider than the app
  gate: a receptionist can RPC a lab-report or referral-letter WhatsApp (bounded params) to a patient directly.
- **Fix:** a migration that sets each template's `request_roles` to the roles holding its call site's permission, plus
  a parity spec over **every** request-callable template (today only `receipt_issued` is pinned).

### L5. Self-listed directory entries make impostor clinics a PHI sink
- **Where:** `000062:28-32, 76-108` with `tenants_update` (`clinic:manage`) and the open `create_clinic_with_owner`.
- **Scenario:** anyone can sign up, create a clinic named like a known hospital, set `referral_directory_listed = true`,
  and appear in other clinics' `referral_directory_search` results. Only `id, name` are returned, so a doctor picks by
  name and sends `clinical_summary`, `active_medications_snapshot`, the diagnosis and (with consent) the history
  snapshot to the impostor. R-35 approved a "simple, reversible opt-in". This is the residual risk, not a deviation.
- **Fix:** raise with the PO. Options: platform-admin approval of listings (a separate `directory_verified` flag set
  only by service role), returning a disambiguator (city or registration number) from the search, or listing only
  clinics with a verified registration.

### L6. The consent check covers only `consented_history_snapshot`
- **Where:** `000062:57-61`. Other clinical fields on the row (`clinical_summary`, `active_medications_snapshot`,
  `provisional_diagnosis`, `investigations_advised`) reach the target clinic (`referrals_target_select`) with
  `patient_consents_history_sharing = false`.
- **Note:** this matches plan step 1 literally. Flag it to the PO to confirm that the referral letter's own clinical
  content needs no DPDP consent.

### L7. Consent record write failures after a referral are ignored
- **Where:** `features/referrals/service.ts:190-209`. The `consent_records` insert result is not checked. A referral
  carrying a consented history snapshot can exist with no consent record, a gap in the DPDP trail. 05-06 moved this
  block after the insert but kept the unchecked write.
- **Fix:** check the error, then log it and surface it, or roll back via an RPC that writes both in one transaction.

### L8. v1 visit routes still return raw database text
- **Where:** `app/api/v1/visits/[id]/route.ts:91, 101, 162, 309` and `app/api/v1/visits/route.ts:97, 116, 270`
  (`error.message` / `err.message` in the response body). The lines are pre-existing, but this file was reworked in 05a
  and the newer branches use fixed texts. Latent behind PO-16.
- **Fix:** use a fixed message plus `errorTag` logging, as in the PATCH branches already converted.

---

## Info

1. **pgTAP gate still at the 05-01a floor.** `scripts/ci/assert-pgtap-report.mjs` has `FLOOR = 13` and
   `REQUIRED_FILES` lists 2 files at `8bda1c6`, while the lane now runs about 3000 tests, including
   `authz_matrix`/`authz_completeness`/`composite_fks`. If a security pgTAP file vanished or was skipped by discovery,
   CI would stay green. The wave notes already track this for the 05a gate. It must land before the gate evidence run.
2. **Global default privilege.** `000059:88` `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS
   FROM PUBLIC` applies to every schema, not only `public`. That is fine today (extensions are owned by
   `supabase_admin`, and btree_gist's functions keep PUBLIC EXECUTE), but document it: a future `CREATE EXTENSION` run
   as `postgres`, or a new schema's functions, will start closed.
3. **Direct payment INSERT.** A `billing:collect` holder can still insert `payments` directly through the column grant.
   This bypasses `record_payment`'s overpayment check, status transition, audit and outbox. It is matrix-approved and
   pre-existing; consider making payments RPC-only with the M2 guard.
4. **v1 PATCH ordering residual.** `app/api/v1/visits/[id]/route.ts:245-263` writes notes before the lock-filtered
   visit update, so a sign-off racing between the two writes leaves edited notes on a signed visit. This is
   acknowledged in code as V2-07/V2-09a.
5. **Vitals on signed visits.** `recordVisitVitals` (and any `consultations:edit` holder through `clinical_notes`) can
   change a signed visit's clinical content. This is pre-existing and V2-09a scope. `clinical_notes_guard` restricts
   columns, not the visit state.
6. **Checked and found sound.** All verified by running unless noted.
   - Tenant deletion cascades through every new RESTRICT composite FK.
   - Auth-user deletion of a doctor with history is refused by the pre-existing `visits_doctor_id_fkey`, not a new
     regression.
   - `queue_tokens.date` is filled in the clinic's zone.
   - No SQL function references the moved clinical columns.
   - Every SECURITY DEFINER function in `public/private/authz/ops` has `search_path=""` or ends in `pg_temp`, with no
     PUBLIC EXECUTE.
   - `anon` holds no table privilege in `public`.
   - `authz.active_tenant_id()` only accepts a header naming one of the caller's memberships (read).
   - `next_queue_token` serialises on the counter row (read).
   - The createVisit 40P01 retry is safe: each PostgREST call is its own transaction (read).

---

## Verified by running vs by reading

**Verified by running** (local stack, `authenticated` role with synthetic JWT claims and header, everything rolled
back):
- **M1:** receptionist un-sign and re-sign with a non-member signer.
- **M2:** doctor reassigns a visit, gains invoice visibility, sets `paid`/0.
- **M3:** receptionist rewrites a broadcast notice's title, message and link.
- **M4 (DB part):** admin rewrites `key_hash`/`created_by` of a scoped key; the scope-add refusal still works.
- **L1:** zero-duration overlapping booking accepted.
- **L2:** doctor 2 inserts an Rx naming doctor 1.
- **L4:** template role lists (catalogue query).
- **Info 6:** tenant cascade, user-delete refusal, token date fill, the definer/ACL catalogue sweep, function-source
  sweep for the moved columns, grant dump.

**By reading:**
- **M4:** use of the re-keyed key at the export route.
- **M5, L3, L5, L6, L7, L8.**
- **Info 1-5,** and the items marked "read" in Info 6.
