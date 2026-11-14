# V2-05a adversarial RLS / authorisation review

- Scope: `git diff v2/phase-04-jobs-reliability...8bda1c6` (migrations 000046–000067 and the RLS-relevant app paths),
  run against the local stack with all migrations through 000067 applied.
- Method: hostile review with no implementer context. The per-plan records and wave notes were not read. Every finding
  below was reproduced in SQL on 127.0.0.1:54322 as `authenticated`/`anon`, with `request.jwt.claims` and
  `request.headers` set the way PostgREST sets them, inside `BEGIN … ROLLBACK`. Afterwards the stack had no fixture rows
  left (checked).
- Reviewer: adversarial Claude reviewer (fresh context), 2026-11-14.

## Summary

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 3 |
| Low | 3 |
| Info | 4 |

The core of the model holds. Binding to the active clinic, the `has_permission` matrix, composite FKs,
`clinical_notes` RLS and guard, and the storage policies all resisted every cross-clinic and cross-role attack tried
(see "Attacks that failed"). The findings are in places where a write policy or grant is broader than the rule it
implements: invitation bearer hashes, `api_keys` columns other than `scopes`, `in_app_notifications` columns, and actor
columns that no one binds to `auth.uid()`.

## Shared fixture

All reproductions start with this fixture (synthetic, rolled back). Clinics A and B. A has an owner (OA), an admin
(AD), a doctor (DR), a receptionist (RC) and a nurse (NU). B has an owner (OB). DUAL is a doctor in A and a
receptionist in B.

```sql
begin;
insert into auth.users (id, email) values
 ('e0000000-0000-4000-8000-000000000101','adv-oa@example.test'),   -- OA
 ('e0000000-0000-4000-8000-000000000102','adv-ad@example.test'),   -- AD
 ('e0000000-0000-4000-8000-000000000103','adv-dr@example.test'),   -- DR
 ('e0000000-0000-4000-8000-000000000104','adv-rc@example.test'),   -- RC
 ('e0000000-0000-4000-8000-000000000105','adv-nu@example.test'),   -- NU
 ('e0000000-0000-4000-8000-000000000201','adv-ob@example.test'),   -- OB
 ('e0000000-0000-4000-8000-000000000301','adv-dual@example.test'); -- DUAL
insert into public.tenants (id, name) values
 ('e0000000-0000-4000-8000-00000000000a','Synthetic Adv A'), ('e0000000-0000-4000-8000-00000000000b','Synthetic Adv B');
insert into public.memberships (user_id, tenant_id, role) values
 (OA,A,'owner'),(AD,A,'admin'),(DR,A,'doctor'),(RC,A,'receptionist'),(NU,A,'nurse'),(OB,B,'owner'),
 (DUAL,A,'doctor'),(DUAL,B,'receptionist');
-- + one patient per clinic, visits (A: DR's and DUAL's; B: OB's), one prescription in B
-- Principal switch (exactly what PostgREST sets):
create function pg_temp.as_user(p_uid text, p_tenant text) returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub',p_uid,'role','authenticated')::text, true);
  perform set_config('request.headers', case when p_tenant is null then '' else
          json_build_object('x-clinicos-tenant',p_tenant)::text end, true);
end $f$;
```

The full scripts are in the session scratchpad (`fx.sql`, `fx2.sql`, `t1.sql` to `t8.sql`). The essential statements
are quoted below each finding.

---

## HIGH

### H-1 An admin can make a second account an owner by replaying a pending owner invitation's `token_hash`

`invitations_select` (000057) gives every `staff:invite` holder (owners and admins) the `token_hash` column of every
invitation in the clinic, including owner/admin invitations that only an owner may create. `public.consume_invitation`
takes the hash itself as the bearer credential, not the raw token. It also does not check the caller against
`invited_address`. An admin can therefore read the hash of the owner's pending "owner" invitation and consume it from
any other signed-in account they control. That account becomes an owner of the clinic, with `exports:create`, role
changes and full clinical access. This defeats the "owner/admin roles only by an owner" rule that `invitations_insert`
enforces.

Reproduction (t3.sql):

```sql
-- owner creates an owner invitation through RLS
select pg_temp.as_user(OA, A); set local role authenticated;
insert into invitations (tenant_id, role, token_hash, invited_address, created_by, expires_at)
values (A, 'owner', encode(sha256('raw-token-only-the-invitee-has'::bytea),'hex'), 'partner@example.test', OA, now()+interval '7 days');
reset role;
-- admin reads it
select pg_temp.as_user(AD, A); set local role authenticated;
select role, token_hash is not null from invitations;            -- owner | t
-- (hash copied out)
reset role;
-- admin's sock-puppet account, a member of no clinic
select pg_temp.as_user('…0999', null); set local role authenticated;
select public.consume_invitation('<hash read above>');           -- returns clinic A's id
reset role;
select role from memberships where user_id = '…0999';             -- owner
```

Observed: the sock-puppet account is inserted as `owner` of clinic A.

Notes: `consume_invitation` and the admin read of `token_hash` both predate this diff. But 000057 re-created
`invitations_select` without narrowing it, and 000061 lists `consume_invitation` as "exempt (token-scoped)", which
assumes the hash is secret. It is not secret from admins. 05-07a plans the fix (email match and confirmed caller), but
the current tree is exploitable.

Suggested fix: do not ship 05a to a shared environment before the 05-07a `consume_invitation` change, which needs a
confirmed caller whose email equals `invited_address`. Also stop exposing `token_hash` to `authenticated`: use a column
grant without `token_hash`, or a view or RPC for the staff list. Until then, either hide owner/admin invitation rows
from non-owners in `invitations_select`, or make `consume_invitation` take the raw token and hash it server-side.

---

## MEDIUM

### M-1 The `exports:create` scope guard can be bypassed: an admin can take over an owner's export-scoped API key by rewriting `key_hash`

000067's `api_keys_scope_guard` fires only on `UPDATE OF scopes`. `authenticated` holds UPDATE on every `api_keys`
column, including `key_hash`, `key_prefix`, `revoked_at` and `created_by`, and `api_keys_update` admits `clinic:manage`
(admins). An admin cannot add the scope, but they can point the owner's already-scoped key at a secret they know. They
can also un-revoke a revoked key and keep `created_by` as the owner, so the v1 actor and audit attribution show the
owner. This is the exact threat 000067 was written for (T-05-19, ruling 01-09).

Reproduction (t1.sql):

```sql
select pg_temp.as_user(OA, A); set local role authenticated;
insert into api_keys (id, tenant_id, name, key_prefix, key_hash, created_by, scopes)
values ('…c001', A, 'owner export key', 'clq_live_aaaaaaa', repeat('0',64), OA, '{exports:create}');
reset role;
select pg_temp.as_user(AD, A); set local role authenticated;
insert into api_keys (…, scopes) values (…, '{exports:create}');      -- ERROR API_KEY_SCOPE_FORBIDDEN (control)
update api_keys set key_hash = encode(sha256('clq_live_attacker_known_secret_value'::bytea),'hex'),
                    key_prefix = 'clq_live_attacke', revoked_at = null
 where id = '…c001' returning scopes;                                  -- UPDATE 1, scopes {exports:create}
```

`lib/api/auth.ts` looks keys up by `sha256(rawToken)`, so the admin's known token now authenticates with
`exports:create`.

Severity: rated Medium only because `/api/v1` is hard-off in production and in deployed tiers until P1-37
(`lib/api/enabled.ts`). It becomes High the moment v1 is enabled.

Suggested fix: revoke column UPDATE on `api_keys` from `authenticated` and grant only `name`, `revoked_at` and
`scopes`. Keys are minted server-side, so `key_hash`, `key_prefix` and `created_by` are needed only on INSERT. Also,
either refuse `revoked_at` going from non-null to null in the guard, or extend the trigger to `BEFORE UPDATE` (all
columns) and refuse changes to `key_hash`, `key_prefix`, `created_by` and `tenant_id` from signed-in callers.

### M-2 Any member can rewrite in-app notices that colleagues see, including owners (content and `link_url`)

The 05-PLAN target matrix says `in_app_notifications` UPDATE is "own (read/dismiss columns)". The implementation
differs in two ways:

- `authenticated` has UPDATE on every column (`title`, `message`, `link_url`, `recipient_*`, `tenant_id`, …).
- `in_app_notifications_update` USING also admits unaddressed broadcast notices and role notices, and WITH CHECK only
  checks the active tenant.

So a receptionist can rewrite a broadcast (or a `recipient_role = 'receptionist'` notice, which owners and admins also
see) with a phishing `link_url`. The notification drawer renders `link_url` as an `href`.

Reproduction (t2.sql):

```sql
insert into in_app_notifications (id, tenant_id, category, event_type, title, message, recipient_user_id)
values ('…d002', A, 'system', 'test', 'Broadcast', 'hello all', null);
select pg_temp.as_user(RC, A); set local role authenticated;
update in_app_notifications set message='Payroll moved, log in again', link_url='https://evil.example/login'
 where id='…d002';                                                    -- UPDATE 1
-- Without a WHERE clause the new row is checked only against WITH CHECK (tenant), so it can be re-addressed too:
update in_app_notifications set recipient_user_id = OA, title='Re-verify your account', link_url='https://evil.example/x';
                                                                      -- UPDATE 2 (own + broadcast now addressed to the owner)
```

Through PostgREST the unfiltered form is blocked by `safeupdate`, which is preloaded for `authenticator`. With an `id`
filter, Postgres also checks the new row against the SELECT policy, so re-addressing to someone else fails (observed:
42501). The content and `link_url` rewrite of any visible notice works through the Data API.

Suggested fix: `REVOKE UPDATE ON in_app_notifications FROM authenticated; GRANT UPDATE (is_read, read_at) …`. Then
limit UPDATE USING to `recipient_user_id = auth.uid()` as the matrix says. Read state for broadcasts needs a per-user
table, or accept that "mark read" on a broadcast is shared. Optionally add a CHECK that `link_url` is a relative path
(`^/[^/]`).

### M-3 Actor and sign-off columns are not bound to the caller: forged clinical sign-off, consent attribution and revision history

No policy or trigger ties `visits.signed_by`/`signed_at`/`status`, `visit_revisions.amended_by`,
`consent_records.recorded_by`, `referrals.referring_doctor_id` or `patients.created_by` to `auth.uid()`. Most of them
reference only `auth.users`, so they are not even limited to the clinic. Consequences:

- A receptionist (`appointments:edit`) can mark a visit `completed` and "signed by" a doctor. The app then treats the
  visit as locked.
- A receptionist can record a patient consent as given by the owner (DPDP evidence).
- A doctor can add amendment history attributed to another doctor, or send a referral as another doctor.
- `visits.patient_id` can be moved by any `appointments:edit` holder after completion. The visit's `clinical_notes`
  then follow the visit to the other patient, while its prescription keeps the original `patient_id`.

Reproduction (t7.sql, t6.sql, t8.sql). All return `ok rows=1`:

```sql
select pg_temp.as_user(RC, A); set local role authenticated;
update visits set status='completed', signed_by=DR, signed_at=now() where id='<A visit>';
insert into consent_records (tenant_id, patient_id, consent_type, status, recorded_by)
  values (A, PA, 'data_processing', 'granted', OA);
update visits set patient_id='<other A patient>' where id='<completed A visit with notes>';
select pg_temp.as_user(DUAL, A); set local role authenticated;
insert into visit_revisions (tenant_id, visit_id, revision_number, amended_by, amendment_reason, snapshot)
  values (A, '<DR visit>', 99, DR, 'forged', '{}');
select pg_temp.as_user(DR, A); set local role authenticated;
insert into referrals (…, referring_doctor_id, target_doctor_id, …) values (…, OA, OB, …);
```

Suggested fix: add BEFORE INSERT/UPDATE guards, or `WITH CHECK (… AND amended_by = auth.uid())`, for the actor columns
(`amended_by`, `recorded_by`, `referring_doctor_id`, `created_by` = caller when `auth.uid()` is set). Signing
(`signed_by`, `signed_at`, `status → completed`) should need `consultations:edit` with `signed_by = auth.uid()`; V2-07's
"one command" sign RPC is the natural home. Make `visits.patient_id` immutable once the visit has clinical content or
is completed, or allow it only through an RPC that also moves the visit's children consistently.

---

## LOW

### L-1 A doctor can reassign any visit to themselves and so gain read and edit access to its invoice

The invoice "own visit" carve-out (`visits.doctor_id = auth.uid()`) depends on a column that every `appointments:edit`
holder, doctors included, can update. A doctor who cannot see a colleague's invoice can set the visit's `doctor_id` to
themselves. They can then read and update that invoice (`total_amount`, `status`), payments and the receipt object.

```sql
select pg_temp.as_user(DUAL, A); set local role authenticated;
select count(*) from invoices;                                   -- 0
update visits set doctor_id = DUAL where id='<DR visit>';        -- ok
update invoices set total_amount=1, status='paid' where id='<DR invoice>';   -- ok rows=1
```

The plan accepts that paid-invoice protection is V2-10. Rated Low because the doctor already sees all clinical data
and the change shows in `doctor_id`. Fix: make `visits.doctor_id` changeable only before consultation starts, or only by
`clinic:manage`/`billing:collect` holders.

### L-2 `/api/v1` keys (role "admin", D-02) read and write clinical content that admins may not see (R-9)

`app/api/v1/visits/[id]` GET and PATCH use the system client and now embed and update `clinical_notes`. They do no
permission or scope check beyond the key itself. An admin (`clinic:manage`, no clinical keys) can mint a key in the app
and read every visit's notes through it. Latent, because v1 is hard-off until P1-37. Fix before P1-37: give keys
explicit scopes for clinical read and write (owner-granted, same guard as `exports:create`), or treat the key principal
as having no clinical permissions.

### L-3 `referrals.target_doctor_id` is unconstrained

`target_doctor_id` has no FK paired with `target_tenant_id`, so the originating clinic can name any user id, including
a user in a clinic that is not the target. Low: it is informational, and the target clinic's RLS does not depend on it.
Fix: a composite FK `(target_doctor_id, target_tenant_id) → memberships(user_id, tenant_id)` when both are set.

---

## INFO

- **I-1 Storage rx path segment 2 is not validated against the tenant.** A doctor in A can upload
  `A/<B's prescription id>/rx_v1.pdf` (`ok`). It stays in A's folder, so nothing crosses clinics, but the object can
  look as if it belongs to a prescription that does not exist in A. Optional: check the prescription exists in that
  tenant in the INSERT policy.
- **I-2 `log_audit` lets any member write audit entries with any action name in their active clinic.** Attribution is
  correct (`actor_id = auth.uid()`, role read from the membership), so this is noise injection only.
- **I-3 `authz.active_tenant_id()` accepts uppercase UUIDs and ignores non-object JSON** (an array header gives null).
  Both behaviours are correct. Duplicate `x-clinicos-tenant` headers cannot select a non-member clinic, because every
  candidate is checked against `memberships`.
- **I-4 No live PostgREST or Storage HTTP run in this review.** Creating synthetic users on the shared stack would leave
  state. The GUCs were set exactly as PostgREST sets them, and the repo claims an HTTP carrier spec
  (`tests/authz/active-tenant-carrier.spec.ts`). `safeupdate` was confirmed preloaded for `authenticator`, which is
  what limits M-2 to filtered updates.

---

## Attacks that failed (coverage)

Active-clinic binding (DUAL = doctor in A, receptionist in B, header names A unless stated):

- INSERT a patient into B → 42501 RLS. Read B's patients → 0. Move A's patient to B (`tenant_id` UPDATE) → 42501.
- `prescription_items` row pointing at B's prescription with tenant A → 23503 composite FK. With no tenant → 42501.
- Visit in A for B's patient → 23503 `visits_tenant_patient_fkey`. Invoice in A for B's visit → 42501.
- `clinical_notes` `tenant_id` swap → `CLINICAL_NOTES_KEY_IMMUTABLE`.
- `has_permission(B, 'patients:view')` → false.
- `change_member_role` on B's owner → `not_found`.
- `create_share_token` for B's prescription → `not_found`. `enqueue_webhook_event` for B → `SUBJECT_MISMATCH`.
- `next_queue_token` with B's visit, `generate_tenant_invoice_number(B)`, `search_medicines(…, B)` → all `forbidden`.
- `log_audit(B, …)` → `ACTOR_INVALID`.
- Storage INSERT of an rx object under B's prefix → 42501.
- UPDATE B's `tenants` row → 0 rows.
- Header B (receptionist): B's `clinical_notes`, prescriptions and referrals → 0 rows. A's `clinical_notes` → 0.
- No header with two memberships: `active_tenant_id()` → null and nothing visible. A non-UUID or non-member header →
  ignored.

Role matrix (in A):

- Receptionist: `clinical_notes` read → 0, update → 0 rows. Changing `allergies` → `PATIENT_CLINICAL_FIELDS`.
  Prescriptions and diagnoses → 0. Visits → visible (as intended).
- Nurse: vitals update → ok. `clinical_notes` text update → `CLINICAL_NOTES_VITALS_ONLY`. Prescriptions → 0.
- Admin: `clinical_notes` → 0. Self-promotion via `change_member_role` → `owner_required`. Owner's phone →
  `owner_required`. Doctor's credentials → `credentials_self_or_owner`. Inviting an owner directly → 42501. Adding the
  `exports:create` scope → `API_KEY_SCOPE_FORBIDDEN`. `memberships.role` → no column privilege.
- Owner changing `tenants.id` → 42501.

Referrals:

- Target = own clinic or an unlisted clinic → `REFERRAL_TARGET_NOT_LISTED`. A snapshot without consent →
  `REFERRAL_CONSENT_REQUIRED`.
- The target clinic editing `clinical_summary` or setting `status` other than acknowledge →
  `referral_target_update_forbidden`. Acknowledge → ok.
- The target cannot read the originating patient row. A dual member acting as receptionist in the target clinic sees no
  referral.

anon and grants:

- anon on `patients` → permission denied. anon on `has_permission` → permission denied. anon on schema `authz` →
  permission denied.
- Every public table has RLS enabled. There are no views in `public`.
- Definer functions executable by anon are only the documented token-scoped and probe set (`resolve_share_token`,
  `get_reschedule_context`, `consume_reschedule_token`, `ops_ingest_error`, `readiness_probe`).
- The only `private` function callable by authenticated is `outbox_payment_recorded`, which is gated by a per-call GUC
  marker and not exposed through PostgREST.
- `queue_token_counters` has no API grants. `payments`, `audit_logs` and `document_share_tokens` are read-only to
  `authenticated`.
- Storage: only the two private buckets, and every object policy is bound through `authz.tenant_ids_with`.

Not covered: platform-admin paths. The diff has no platform-admin SQL (no `platform_admin` objects in migrations).
Membership status and revocation (05-05) are not in this tree. Downgrading a role mid-session takes effect on the next
statement because every helper reads `memberships` live.
