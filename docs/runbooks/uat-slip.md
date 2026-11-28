# Runbook: paid launch slips (UAT codes would debit too early)

V2-15 plan 15-04, SUB-COUPON-08, SUBSCRIPTIONS_AND_PLANS section 14.8 "If paid launch slips". `uat` codes fix the first
debit date (`start_at = free_until`) at signup, and UPI subscriptions cannot be updated at the provider. A late G7 (no
GSTIN, Supabase not on Pro, UAT extended by a section 9.1 trigger) would therefore debit testers automatically, possibly
with GST charged and no GSTIN.

**Hard rule: no debit may run without a GSTIN in `platform_settings`.**

## 1. When to run it

Decide at **T-10 days** before the earliest `free_until`: will G7 pass at least **5 days before** that date?
If yes, do nothing but keep the check on the calendar. If not, run this runbook **before T-3** (before the first notice
goes out). If a debit already happened, go to section 5.

Find the earliest date (counts and dates only):

```sql
select min(free_until) as earliest_free_until, count(*) as affected_tenants
from <uat redemption view> where campaign = 'uat';   -- adjust to the V2-13b view/table names
```

## 2. Steps (per affected tenant, through `platform.*` RPCs; never raw updates)

1. **Grant comp access** until the new date:
   `select platform.grant_comp_access('<tenant_id>', '<new date>', 'uat_slip', p_actor => '<admin_user_id>');`
   (exact name and arguments are in `docs/runbooks/subscriptions-sql.md`; use that file, not this line).
2. **Cancel the provider subscription before its first debit**, reason `uat_slip`
   (`platform` cancel RPC, or the Razorpay Dashboard if the RPC is not yet merged; record the provider subscription id).
   Access continues through comp.
3. Confirm: the tenant's billing page shows "UAT access until <new date>" and the provider shows the subscription
   cancelled with no pending charge.

Alternative (when the new date is within the provider's deferral limit): issue the owner the "Re-confirm AutoPay" task
(section 14.5 step 6) with a later `start_at`; this needs each owner's action, so prefer the comp path.

## 3. Tell the testers

Use the template in `docs/uat/campaign-guide.md` ("exit date moved"): the new date, that nothing is charged until
then, that owners will be asked to confirm AutoPay again at paid launch, and the support contact.

## 4. Verify

```sql
select count(*) as comped, count(*) filter (where provider_status = 'cancelled') as provider_cancelled
from <comp and subscription view> where reason = 'uat_slip';   -- both equal the affected tenant count
```

Dashboard check: the Razorpay subscriptions list shows no `authenticated` UAT subscription with a charge date before the
new launch date.

## 5. A tester was debited anyway

1. Stop: no further debits (cancel the subscription immediately).
2. Refund in full through the platform refund RPC with `reason_code = 'uat_tester'`.
3. If GST was charged without a GSTIN, record it in the incident timeline (`docs/runbooks/incident.md`, severity 2) and
   inform the PO's accountant if one exists.
4. Send the owner the apology and refund notice (template in `docs/uat/campaign-guide.md`).

## 6. After launch is ready

At G7, each affected owner completes a normal AutoPay checkout (the trial is consumed). Keep the `uat_slip` reason on the
audit trail.

```
earliest free_until: <date>   affected tenants: <n>
comped: <n>   provider cancelled: <n>   testers notified: yes/no
```
