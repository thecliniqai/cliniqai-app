# Runbook: Razorpay live mode (production)

V2-15 plan 15-02. Roadmap section 17.1 "Subscriptions, payments and UAT codes". Run by the PO; an agent follows it only
to answer questions. Agents never touch the live Razorpay account or the production database. Record **provider ids and
dates only** (no keys, no secrets, no customer details, no phone numbers or e-mail addresses).

Prices: Standard is Rs 1,499 plus 18 % GST, a plan amount of **176882 paise**. No AI plan ids exist (no AI is sold).
UAT clinics redeem `uat` codes and are not debited (SUB section 14.8), so live mode needs no GSTIN for UAT start; a
GSTIN is a paid-launch (G7) item.

## 0. Preconditions

- KYC complete in the Razorpay Dashboard (business, bank, website policies published: Terms, Privacy, Refund and
  Cancellation, Pricing, Contact). If KYC is late, skip to section 7 (comp fallback) and tell Claude in writing.
- Production Supabase project built from migrations and bootstrapped (`docs/runbooks/production-setup.md`).
- Production Vercel project exists; deployments use the production environment.

## 1. Live keys and webhook secret

1. Dashboard > switch to **Live mode** > Account and Settings > API keys > generate. The key id starts with `rzp_live_`.
2. Put the key id and key secret **only** into the Vercel production environment and your password manager. The app
   refuses any `rzp_test_` key when the environment is production (15-01 guard), so a wrong paste fails the deploy
   instead of charging in test mode.
3. Webhooks > Add: URL `https://<production-domain><billing webhook path>` (the Razorpay route added by V2-13b; read the path from `app/api/webhooks/`), a new random secret
   (`openssl rand -hex 32`, never reused from staging), and the events the app handles (the list is in
   `docs/runbooks/subscriptions-sql.md` and the billing webhook handler; at minimum the `subscription.*` and
   `payment.*` and `refund.*` families). Put the secret in the Vercel production environment and the password manager.
4. Redeploy production so the variables are read.

## 2. Live plan and its id

1. Dashboard > Subscriptions > Plans > create **Standard**: monthly, amount **176882 paise** (Rs 1,768.82), name
   `clinicOS Standard`. Copy the plan id (`plan_...`).
2. Insert it through the RPC, in the production SQL editor, as the bootstrap admin (see
   `docs/runbooks/production-bootstrap.sql`, which has the `platform.create_plan_price` call with a placeholder):

```sql
-- placeholders only; replace <...> before running
-- same call shape as docs/runbooks/subscriptions-sql.md; the amount is 176882 paise (check the units there)
select platform.create_plan_price('standard', 'flat_recurring', <amount per that runbook>, <GST basis points>, false,
                                  '<live plan id>', '<effective-from timestamp>', p_actor => '<admin_user_id>');
```

3. Verify (IDs and counts only):

```sql
select count(*) filter (where provider_plan_id like 'plan\_%') as live_ids,
       count(*) filter (where provider_plan_id ilike '%test%')  as test_like_ids
from public.plan_prices;
-- expected: live_ids >= 1, test_like_ids = 0 (the 000205 guard refuses test-looking ids in production)
```

## 3. Webhook delivery check

1. Dashboard > Webhooks > the production webhook > Send test event (or let the section 4 payment produce events).
2. In the production SQL editor run the verify query and paste the result into
   `.planning/phases/15-production-readiness-uat-launch/15-LIVE-PAYMENTS-CHECKLIST.md`:

```sql
-- table and column names are those of the V2-13b billing webhook ledger (provider event id, type, signature result,
-- time); adjust to the merged migration. Select ids and flags only, never payloads.
select * from <billing webhook events table> order by <received time> desc limit 10;
```

3. `node scripts/prod/verify-webhook-delivery.mjs <pasted-rows-file>` (15-02 code part; not yet in the repo, see
   15-NOTES.md) confirms every row has `signature_valid = true` and that no event id repeats. Until it exists, check
   the same two facts by eye.

## 4. Live Rs 5 mandate test (UPI app and card)

Use the PO's **own test clinic** on production (an owner account you control, never a real patient in the clinic).

1. Sign up the test clinic with a `uat` code (section 6) or without one if testing the plain trial path.
2. Billing page > set up AutoPay with a **UPI app**; approve the Rs 5 authorisation. Expected: the mandate is active and
   the Rs 5 is **auto-refunded** (see the refund in the Dashboard within the provider's stated time). Note the
   subscription id, the payment id and the refund id.
3. Repeat with a **card** (second test clinic or after cancelling the first).
4. Cancel at period end from the billing page. Expected: status shows cancelling, no further charge, access until the
   period end. Note the subscription id.
5. Do the AutoPay set-up once from the **installed PWA** on Android and on iOS (device run item R12,
   `15-DEVICE-RUN.md`). On iOS, if the app reloads on return it must show "Confirming your AutoPay" and never
   "Start trial" again.

## 5. One live `uat` redemption by the PO's test clinic

1. Section 6 creates the campaign; take one assigned code for the test clinic.
2. Redeem at signup. Expected: the subscription shows a **deferred `start_at`** (equal to `max(trial_end, free_until)`)
   in the Razorpay Dashboard, **no debit**, and the T-3 and T-1 notices name the first debit date.
3. Record the subscription id and the `start_at` date. Then cancel this subscription before the first debit unless the
   PO wants it to run (it is the PO's own clinic).

## 6. Campaign and codes

See `docs/runbooks/uat.md` (campaign and codes) and the `uat-campaign.sql` in the 15-06 code part. Codes are never put
in this repository, chat, logs or tickets.

## 7. Comp fallback if live mode is late (SUB section 14.8)

If KYC or the live plan is not ready by UAT start, the PO chooses **comp access** in writing (chat message, dated).
Then, for each UAT clinic: grant `comp_until` = the UAT exit date through `platform.*` (snippet in
`docs/runbooks/subscriptions-sql.md`), no provider subscription is created, and the billing page shows "UAT access".
The line "Razorpay live" in the G6 checklist is then satisfied by that written decision, and live mode becomes a
**G7** (paid launch) blocker. Redo sections 1 to 5 before G7.

## 8. Incidents specific to payments

- A debit without a GSTIN: stop, run `docs/runbooks/uat-slip.md` immediately, refund in full with reason
  `uat_tester`.
- Webhook signature failures: rotate the webhook secret (section 1, step 3), redeploy, resend the failed events from the
  Dashboard.
- Divergence alert (provider vs local state): `docs/runbooks/alerts.md` section on billing divergence.

## Verify block (paste back, ids only)

```
live key prefix check: key id starts with rzp_live_ (yes/no)
live_ids / test_like_ids: <n> / <n>
webhook rows checked: <n>, all signature_valid: yes/no
upi mandate subscription id, refund id: <ids>
card mandate subscription id, refund id: <ids>
cancel-at-period-end subscription id: <id>
uat redemption subscription id and start_at date: <id>, <date>
PWA AutoPay (Android, iOS): pass/fail
```
