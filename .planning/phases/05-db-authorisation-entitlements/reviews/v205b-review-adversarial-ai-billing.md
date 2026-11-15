# V2-05b adversarial review: AI gating, quota, subscriptions and billing

- Scope: `v2/phase-05b-membership-entitlements` at `5e9d1df` (diff from `d670b62`): migrations 000080–000086, the
  access-level helpers and `claim_jobs` in 000090, 000091 (AI gating), `lib/entitlements/require-entitlement.ts`,
  `lib/auth/tenant.ts`, `lib/api/auth.ts` (SUBSCRIPTION_LOCKED).
- Reviewer: isolated adversarial reviewer (fresh context; per-plan records and 05-WAVE-NOTES.md not read).
- Method: every probe ran on the local stack (127.0.0.1:54322) as `authenticated`, with `request.jwt.claims`
  (`sub`, `role`, `aal`) and `request.headers` (`x-clinicos-tenant`) set the way PostgREST sets them, inside
  `BEGIN … ROLLBACK` on synthetic clinics (`ad50…`). The one committed concurrency probe used synthetic `ad5c…` rows that
  were deleted afterwards (verified 0 tenants, users, patients, jobs, events, audit rows left). No source edits, no
  `db reset`, no hosted access, no `.env*` read.

## Counts

| Severity | Count |
|---|---|
| High | 1 |
| Medium | 1 |
| Low | 3 |
| Info | 7 |

---

## High

### H-1. The clinic owner or admin can triple the 1,500-draft trial quota (and pull a month's quota early) by changing `tenants.timezone`

**Where.** `private.ai_gate` (000091) computes the period from the clinic's own time zone:

```sql
'trial:' || to_char(public.tenant_local_date(r_tenant, v_trial_start), 'YYYY-MM-DD')   -- trialing
to_char(public.tenant_local_date(r_tenant, now()), 'YYYY-MM')                          -- otherwise
```

`public.tenant_local_date` reads `public.tenants.timezone`, and `authenticated` holds a column UPDATE grant on
`tenants.timezone` under the `tenants_update` policy (`clinic:manage`: owner **and** admin). There is no CHECK on the
column; `tenant_local_date` accepts offsets `^[+-]([01][0-9]|2[0-3])(:?[0-5][0-9])?$`, so any value from `-23` to `+23`
(46 hours of spread). The trial key is therefore not "the trial start" (AI_STRATEGY §4.6, PO-21) but "the trial start
as seen from whatever zone the clinic chose at the moment of the call". Changing the zone is not audited.

**Reproduction** (synthetic, rolled back; trial_start = now() − 1 day):

```sql
-- 1,500 units already used in the IST trial key
insert into public.ai_usage_monthly values (A, 'trial:<IST date of trial_start>', 'ai.scribe', 1500);
-- as doctor A, active clinic A:  select public.ai_preflight('ai.scribe', <visit A>);   → over_quota
-- as OWNER A (or ADMIN A), active clinic A, through the ordinary table grant:
update public.tenants set timezone = '-23' where id = A;                               → 1 row
-- as doctor A:                  select public.ai_preflight('ai.scribe', <visit A>);   → ok
--                               select public.ai_commit(public.ai_reserve('ai.scribe', <visit A>, 60)); → succeeds
```

Observed:

```
P1.0 preflight before (expect over_quota) | over_quota
P1.1 owner sets timezone -23              | -23
P1.2 preflight after                      | ok
P1.5 admin (not owner) can also set tz    | +00          (admin holds clinic:manage)
P1.6 audit rows for tz change             | 0
distinct trial keys reachable (-23..+23)  | trial:2026-11-13 trial:2026-11-14 trial:2026-11-15
units after filling each key in turn      | 1500 + 1500 + 1500 = 4500 in ONE trial
```

So a trial clinic gets up to 3 × 1,500 = 4,500 drafts (3× the Vertex cost PO-21 budgets for), by flipping a settings
field between batches. The same lever moves the monthly key (`YYYY-MM`) by up to ±23 h, so an override clinic (UAT,
"1,500 drafts per **IST** calendar month", AI §4.6) can spend two months' quota inside one 46-hour window at each month
boundary. The spec says IST; the code uses the clinic-chosen zone.

**Fix.**
1. Key the trial period on an immutable value: `'trial:' || to_char(s.trial_start AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`
   (SUB §4's billing anchor is IST), or better store the anchor (e.g. `tenant_subscriptions.trial_start` itself, or a
   `quota_period_anchor`) and never re-derive it from mutable tenant settings.
2. Key the month on `Asia/Kolkata` (AI §4.6 "IST calendar month"), not `tenants.timezone`.
3. Add a pgTAP leg: reserve/commit, change `tenants.timezone` as the owner to `-23` and `+23`, assert the same period
   and `over_quota`.
4. Independently: constrain `tenants.timezone` (an IANA name or a sane offset) and audit changes to it; it also drives
   queue-token dates and the API usage bucket.

---

## Medium

### M-1. `ai_commit` accepts an expired reservation, so usage exceeds the limit

**Where.** `public.ai_commit` deletes `WHERE r.id = p_reservation AND r.tenant_id = v_tenant` with no
`expires_at > now()` condition. Expired reservations stop counting at `expires_at` (by design), so a new reservation is
admitted into the slot, and then **both** commit.

**Reproduction** (rolled back; trial limit 1,500):

```sql
-- 1,499 used + one reservation e001 created 10 min ago, expired 1 min ago (slow provider / hung call)
select public.ai_reserve('ai.scribe', <visit A>, 10);         -- → new id (expired one does not count)
select public.ai_commit('…e001');                              -- → 1500
select public.ai_commit(<new id>);                             -- → 1501
```

Observed: `P2.4 units vs limit 1500 | 1501`. Nothing bounds how many expired reservations can still be committed, so
the overshoot is limited only by how many calls outlive `timeout + 30 s`. The gateway (V2-12) is not built yet, so
today the DB contract is the only guarantee, and it does not hold "units ≤ limit".

**Fix.** Choose one contract and encode it:
- (preferred) `ai_commit` of an expired reservation raises `AI_RESERVATION_EXPIRED` (P0001) and the gateway discards the
  draft (the provider call must be aborted at `p_timeout_s` anyway: make the gateway's abort signal ≤ the reserved
  timeout); or
- `ai_commit` re-checks `units + live ≥ limit` under the usage-row lock and records the overrun (still counting the
  unit, since the cost was spent) so the overshoot is visible and alertable.
Add a pgTAP leg for the expired-then-commit case (the current suite only proves expired reservations stop counting).

---

## Low

### L-1. Cancelling a locked clinic's `message.send` / `webhook.deliver` job leaves the delivery row open; the documented-safe backfill later re-sends it after renewal

**Where.** 000090 `claim_jobs` sets `ops.jobs.status = 'cancelled'` but leaves `communication_queue.status = 'pending'`
(and `webhook_delivery_queue` likewise). `ops.cleanup()` deletes cancelled jobs after 7 days. `ops.backfill_delivery_jobs()`
then sees an open row with no job and enqueues a new one; `docs/runbooks/jobs.md` §11 says it "can be run again safely".

**Reproduction** (rolled back): enqueue a reminder for clinic A → lapse A (`access_ends_at` in the past) →
`claim_jobs` → job `cancelled / tenant_not_full`, queue row `pending` → age the job 8 days, `ops.cleanup()` deletes it →
renew A → `ops.backfill_delivery_jobs()` → `claim_jobs` claims the stale reminder.

```
P5.1 job / queue row after cancel | cancelled | tenant_not_full | pending
P5.2 cleanup                      | 1
P5.3 runbook backfill             | t
P5.4 claimed again                | 1
```

This contradicts 000090's own promise "never sent late after a renewal" (it needs a manual backfill, hence Low), and
the rows stay "pending" forever in any UI that lists them.

**Fix.** In the same cancel statement, close the delivery row (`communication_queue.status = 'cancelled'`,
`error_message = 'tenant_not_full'`; the webhook row likewise), or make `backfill_delivery_jobs` skip rows older than the
reminder's relevance window / rows of clinics that are not `full`. Add the backfill step to the pgTAP leg.

### L-2. The "nothing is sold without a provider plan id" invariant is only checked when the switch is flipped

**Where.** `platform.set_product_availability` refuses `purchasable = true` without a price active now that carries a
`provider_plan_id`, but (a) the 000084 seed already has `standard` `purchasable = true` with its only price's
`provider_plan_id` NULL (verified locally), and (b) `platform.create_plan_price(…, p_provider_plan_id => NULL, …)` closes
the sold version and leaves the plan purchasable with no provider plan. `billing_internal.start_trial` checks
`p.purchasable` only, so it accepts such a price.

**Fix.** Either make `start_trial` (and the V2-13b checkout) require `pp.provider_plan_id IS NOT NULL`, or have
`create_plan_price` refuse a NULL provider id for a purchasable plan (or flip it to not purchasable and audit), and
record the seed exception explicitly ("provider id set in V2-13b before go-live") in a pgTAP/go-live check.

### L-3. Clearing a patient's AI objection leaves no trace, and nurses can do it

**Where.** `private.patients_ai_objection_stamp` overwrites `objected_at` / `objection_recorded_by` on every flag
change; there is no audit row (`audit_logs` count for the patient stayed 0 after set and clear). Any role with
`patients:edit` (nurse included, P3.4) can clear it; AI §4.6 says "editable by doctor or receptionist".

```
P3.1 doctor sets objected + forged stamp | <now> by <doctor>        (forgery overwritten: held)
P3.4 nurse clears objection              | null by <nurse>          (who/when of the objection is gone)
P3.5 audit rows for the patient          | 0
```

The objection is a DPDP control (⚖ in AI §4.6); after a clear-run-reset sequence there is no evidence the patient ever
objected. **Fix.** Write an audit row (`patient.ai_objection.set` / `.cleared`, actor, no PHI) from the trigger or the
action, and confirm with the PO whether nurses may clear it.

---

## Info

- **I-1. Commit is bound to the caller's current membership, not the reservation.** If the doctor is removed, loses
  `consultations:edit`, or the request's active clinic differs, `ai_commit` raises `AI_FORBIDDEN` and the reservation
  simply expires: the call happened but no unit is counted (under-metering). The V2-12 gateway should commit through a
  path that does not depend on the caller still holding the role (e.g. bind the reservation to `tenant_id` + `id` and
  let the gateway's system context commit it), or accept and document the gap.
- **I-2. Reservations are not bound to a visit/patient/user.** The objection is checked at reserve time only; an
  objection recorded during the (≤ 330 s) reservation window does not stop the call. Re-check in the gateway's context
  builder (AI §4.4 step 4 already says it refuses) and keep the reservation short.
- **I-3. Comp on a stale `trialing` clinic keeps the trial AI entitlement for the whole comp.** With `comp_until` in
  the future and `status = 'trialing'` past `access_ends_at`, `resolve_entitlement` still picks the trial plan:
  `ai_preflight` → `ok`, `my_entitlements` → `ai.scribe.monthly_drafts = 1500` (P4.7/P4.8). Bounded by the single trial
  key, but PO-25 says preview access ends with the trial; confirm or resolve `trialing` past `trial_end` to the base plan.
- **I-4. `requireEntitlement`'s comment says `limit: null` = unlimited**, but `resolve_entitlement` never returns NULL
  (absent/NULL limits read as 0, and every boolean key reports 0). A V2-12 caller reading `limit === null` as
  "unlimited" would never match; one reading 0 as "no quota" is wrong for boolean keys. Fix the comment / type.
- **I-5. `platform.create_plan_price` accepts any `tax_rate_bp` (0…10000).** 1 bp produced a charge of 149915 paise.
  GST-exclusive is enforced; the 18 % rate is not. A guard (or an explicit allow-list) avoids a typo becoming a
  mandate amount.
- **I-6. `private.platform_actor` trusts the `role` GUC.** Locally, `set_config('role', 'service_role', true)` as
  `authenticated` succeeds (P3.19) because the session user may switch to it (through PostgREST the session user is
  `authenticator`, a member of `service_role`). It is safe today only because no exposed function lets a caller run
  `set_config` with a chosen name (checked: none in `public`/`private`). Keep that as a review rule; a future
  `set_config(p_name, …)` helper would turn `p_actor` into an admin impersonation.
- **I-7 (analysis, not reproduced). `claim_jobs` cancels and claims in two statements.** A due row skipped by the
  cancel pass's `SKIP LOCKED` (held by another transaction) can be claimed by the second statement if released in
  between, and a subscription flip committed between the statements is not re-checked. Narrow (`now()` is fixed per
  transaction), but repeating `tenant_access_level(...) = 'full' OR kind = ANY(v_exempt) OR tenant_id IS NULL` in the
  `locked` CTE closes it for free.

---

## Attacks that held

AI gating / quota
- Parallel reserves at the limit (committed synthetic rows, 12 concurrent sessions, override limit 1, **no usage row
  yet**, so the `INSERT … ON CONFLICT DO NOTHING` path raced): 1 reservation, 11 `AI_OVER_QUOTA`.
- Double commit → `AI_RESERVATION_NOT_FOUND`; release after commit → `false`.
- Commit of another clinic's reservation by a user who is a member of both, with the other clinic active →
  `AI_RESERVATION_NOT_FOUND`; preflight on another clinic's visit → `forbidden` (tenant from the visit, R-42).
- Nurse reserve → `AI_FORBIDDEN`; locked clinic: preflight `locked`, reserve `AI_LOCKED`, in-flight commit allowed (by
  design), owner opt-in refused.
- Feature = a limit key (`ai.scribe.monthly_drafts`) → `AI_FEATURE_UNKNOWN`; a boolean AI key without a
  `.monthly_drafts` limit resolves to limit 0 (fail closed).
- `ai_usage_monthly` / `ai_quota_reservations`: SELECT and DELETE denied to `authenticated`; `tenant_ai_settings`:
  direct UPDATE denied, other clinic's row invisible.
- Opt-in: admin, doctor, and owner of A naming clinic B → `AI_OPT_IN_OWNER_ONLY`.
- Objection stamp forgery (setting `objected_at` / `objection_recorded_by` with or without a flag change) is overwritten
  by the trigger; another clinic's owner cannot set the flag (0 rows).
- Trial → active: the period switches from `trial:<date>` to the month; standard without override → `not_entitled`
  (PO-25); in-flight trial reservations commit into the trial key.

Subscriptions / billing
- As a clinic owner: UPDATE `tenant_subscriptions`, INSERT `tenant_entitlement_overrides`, UPDATE `plans`, INSERT
  `plan_prices` → permission denied; `billing_internal.*` → permission denied for schema; SELECT overrides /
  `platform_settings` denied; hidden `standard_trial` plan invisible.
- `platform.set_comp` / `grant_override` / `set_product_availability` as owner (aal1 and forged-claim aal2) and as a
  real platform admin at aal1 → `PLATFORM_ADMIN_REQUIRED`; `p_actor` naming the owner is ignored on the JWT path.
- Admin making `ai_assist` purchasable without a provider-id price → `PRODUCT_PRICE_REQUIRED`.
- `my_tenant_access` / `my_entitlements` for a clinic the caller is not a member of → NULL / 0 rows; another clinic's
  `tenant_subscriptions` row invisible; a doctor sees none of their own (owner/admin only).
- Money: seeded Standard 149,900 paise @ 1,800 bp, `tax_inclusive = false` → `charge_amount_paise = 176882`;
  `create_plan_price` reproduces 176882; `tax_inclusive = true` is refused by CHECK and by the RPC.

Jobs
- Locked clinic's due `message.send` → `cancelled / tenant_not_full`; full clinic's job claimed; a locked clinic's
  future job left `pending` (not cancelled early).
- App: `requireEntitlement` / `assertTenantAccess` derive the clinic from the session (`getActiveMembership` +
  `my_tenant_access`), fail closed; `/api/v1` key auth answers 402 `SUBSCRIPTION_LOCKED` for a non-full clinic before
  counting usage.
