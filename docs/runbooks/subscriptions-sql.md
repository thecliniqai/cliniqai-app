# Runbook: subscriptions, prices and product availability in SQL

V2-05 plan 05-09b (SUB-01, AI-18; SUBSCRIPTIONS_AND_PLANS.md §6.2, §8.1, §9.2; migration
`000085_platform_admin_rpcs`). Until the platform admin screens exist (V2-13c), every subscription, price and product
change is made with the vetted snippets below, in the Supabase SQL editor of the intended environment. They **call the
`platform.*` RPCs, never raw `UPDATE`s** on `tenant_subscriptions`, `plans`, `plan_prices` or
`tenant_entitlement_overrides`: the RPCs check the actor, keep `access_ends_at` and `version` consistent, and write the
audit trail (`platform_audit_log`) and the clinic's lifecycle log (`subscription_events`).

Agents never run these against a hosted project: the PO (or an operator with the PO's approval) runs them. Synthetic or
pilot data only. Reasons are stored in the audit trail: write a short business reason ("pilot clinic", "AI pilot"),
never a patient's or a person's details.

## Who may call the RPCs (the actor rule)

| Caller | `p_actor` | Requirement | Recorded as |
|---|---|---|---|
| SQL editor (`postgres`) or the service role | **required** | an active row in `platform_admins` (not revoked) | `p_actor`, channel `sql` |
| A signed-in user (the V2-13c admin UI) | **ignored** | `public.is_platform_admin()`: an active `platform_admins` row for the user **and** an `aal2` (MFA) session | the user, channel `ui` |

Anyone else is refused with `PLATFORM_ADMIN_REQUIRED` (42501); a missing, unknown or revoked `p_actor` with
`PLATFORM_ACTOR_INVALID` (42501). Nothing is written by a refused call. `anon` cannot reach the `platform` schema at all.

Note: the caller is read from the session's role (PostgREST's `SET ROLE`, else the connecting user), not from
`current_user`, which inside these SECURITY DEFINER functions is always their owner. The SQL editor must connect as
`postgres`; any other database user is treated as a signed-in caller and refused.

## Platform admins (bootstrap and revocation)

Admins are not a clinic role and cannot be added through any UI in v2.0 (SUB §9.2). Use a **dedicated admin
identity** (its own email, TOTP enrolled in V2-13c), never a clinic-owner test account. Every insert or update of
`platform_admins` is audited by a trigger (`platform_admin.granted` / `platform_admin.updated`).

```sql
-- Grant (the first admin: granted_by null; later admins: the granting admin's user id).
insert into public.platform_admins (user_id, granted_by) values ('<admin_user_id>', '<granting_admin_user_id or null>');
-- Revoke (never delete: the row and its audit trail stay).
update public.platform_admins set revoked_at = now() where user_id = '<admin_user_id>' and revoked_at is null;
-- Check
select user_id, granted_at, granted_by, revoked_at from public.platform_admins order by granted_at;
```

## Snippets

```sql
-- New price for NEW subscriptions (old price rows stay for grandfathered clinics).
-- plan, billing model (v2.0: flat_recurring only), base amount (paise, GST-exclusive), tax rate (bp), tax_inclusive
-- (must be false, PO-20), provider plan id (created in Razorpay for the derived charge amount, or null to prepare the
-- row first), active from (now or later; it must start after every existing version of the plan).
-- The plan's open version closes exactly when the new one starts; the cadence copies the previous version (monthly).
select platform.create_plan_price('standard', 'flat_recurring', 179900, 1800, false, '<razorpay_plan_id>',
                                  '2027-04-01 00:00+05:30', p_actor => '<admin_user_id>');

-- Make a product purchasable (refused with PRODUCT_PRICE_REQUIRED unless the plan has a price active NOW with a
-- provider plan id; a trial or retired plan is refused with PRODUCT_STATE_INVALID). Withdrawing needs no price.
select platform.set_product_availability('ai_voice_receptionist', p_purchasable => true, p_visibility => 'public',
                                         p_actor => '<admin_user_id>');

-- Extend a trial (status trialing only; 0 < interval <= 90 days). access_ends_at = new trial_end + the pending-charge
-- buffer (no buffer if the trial is being cancelled). The provider's first-charge date is not moved (V2-13b).
select platform.extend_trial('<tenant_id>', interval '7 days', 'pilot clinic', p_actor => '<admin_user_id>');

-- Grant AI evaluation (a boolean key takes no limit; an enabled limit key needs one). A second grant of the same key
-- replaces it. To switch a key off before expiry, grant it with p_enabled => false.
select platform.grant_override('<tenant_id>', 'ai.scribe', true, null, now() + interval '30 days', 'AI pilot',
                               p_actor => '<admin_user_id>');
select platform.grant_override('<tenant_id>', 'ai.scribe.monthly_drafts', true, 1500, now() + interval '30 days',
                               'AI pilot', p_actor => '<admin_user_id>');
```

## Comp a pilot clinic

A comp (`comp_until`) gives full access whatever the subscription status, except `purged` (SUB §6.1). It is a flag,
not a state: the status is unchanged, and access returns to the status rule when the comp ends or is cleared.

```sql
-- Comp for 90 days (the end must be in the future and less than five years away).
select platform.set_comp('<tenant_id>', now() + interval '90 days', 'pilot clinic', p_actor => '<admin_user_id>');
-- End the comp now.
select platform.set_comp('<tenant_id>', null, 'pilot ended', p_actor => '<admin_user_id>');
```

A comped clinic gets the Standard keys only if its subscription row points at a Standard price (`plan_price_id`); a
comp without a price has full access but no entitlement keys (research Pitfall 8). The local and staging demo clinics
are seeded `active` with the Standard price and a one-year comp (05-09c).

## Read a clinic's access level safely

`billing_internal.*` is executable by the service role only (never `authenticated`/`anon`, acceptance 9). In the SQL
editor (or as the service role) read the level at the current time with the system wrapper, which takes no `p_now`:

```sql
select public.tenant_access_for_system('<tenant_id>');            -- full | locked | onboarding | none | null (no row)
select status, trial_end, current_period_end, access_ends_at, comp_until, version
  from public.tenant_subscriptions where tenant_id = '<tenant_id>';
```

Time travel (`billing_internal.tenant_access_level(<tenant>, <p_now>)`) is for tests only; never build a decision on a
caller-supplied time.

## Audit

```sql
select occurred_at, channel, action, actor_id, target_tenant_id, payload
  from public.platform_audit_log order by occurred_at desc limit 50;
select occurred_at, type, from_status, to_status, actor_type, actor_id, reason
  from public.subscription_events where tenant_id = '<tenant_id>' order by occurred_at desc;
```

Neither table can be written by any API role or by the service role.
