# Runbook: UAT operation (codes, invites, comp fallback, exit)

V2-15 plans 15-04 and 15-06 (SUB-COUPON-08, SUBSCRIPTIONS_AND_PLANS section 14.8). The PO runs it. Companion files:
`docs/runbooks/uat-slip.md` (paid launch late), `docs/uat/campaign-guide.md` (how the campaign runs day to day),
`docs/uat/tester-guide.md`, `docs/uat/invite-email.md`, `docs/uat/invite-whatsapp.md`.

Rules: **codes never appear in git, chat, logs or tickets.** The CSV of codes exists only on the PO's machine and in the
password manager until sent, then is deleted. No real names, phone numbers or e-mail addresses in any repository file;
invites are personalised only at send time.

## 1. Before inviting anyone

- Production passed the readiness check and the G6 items for infrastructure (`G6-CHECKLIST.md`).
- Public Terms, Privacy, Refund and Cancellation, Pricing and Contact pages are live (SUB-10).
- MSG91 appointment-reminder templates approved and the production messaging provider configured (readiness lists the
  real provider). If a template is not approved, tell testers reminders are off and why.
- `public_signup_open = false` stays: UAT clinics can only sign up with a code (13B D-10).
- SUB-D11: the PO decides the **UAT exit date** (`free_until`). Write it in the PO's calendar and in `PO-ACTIONS.md`.

## 2. Create the campaign and codes

Use `docs/runbooks/uat-campaign.sql` (15-06 code part; not yet in the repo, see 15-NOTES.md) in the production SQL editor
as the bootstrap admin. It calls `platform.*` RPCs only:

1. Create the `uat` campaign: 100 % off until `free_until` = the exit date; optional entitlement grants per section 14.8.
2. Generate **assigned single-use codes**, one per recruited clinic (the number of rows equals the number of clinics;
   the PO assigns the label of the clinic in their own notes, not in the database).
3. Export the CSV through the dashboard download. Verify only counts:

```sql
select count(*) as codes, count(*) filter (where redeemed_at is not null) as redeemed from <coupon codes table> where campaign = 'uat';
```

Before the first invite also run section 4 (comp fallback) in a dry reading so you know the exit if live billing is late.

## 3. Invite

1. Pick the channel (`docs/uat/invite-email.md` or `invite-whatsapp.md`), fill the placeholders at send time, send from
   the PO's own account (one message per clinic, code inside, nothing public).
2. Tell each clinic owner about the tester guide and the feedback channel.
3. Day 1: ask each owner to complete signup with the code, add one doctor and one receptionist, and confirm the invite
   e-mails arrive.

Redemption rules to remember: a tester admitted less than 14 days before `free_until` keeps the full trial and starts
paying only at trial end (`start_at = max(trial_end, free_until)`); the Rs 5 mandate authorisation is taken and
auto-refunded; no debit happens before `start_at`; T-3 and T-1 notices name the first debit date and the amount.

## 4. Comp fallback (live Razorpay not ready, or a UPI mandate cannot be deferred far enough)

Written choice by the PO (dated chat message) is required. Then per clinic, with `platform.*` (snippets in
`docs/runbooks/subscriptions-sql.md`): grant `comp_until` = the exit date; no provider subscription exists; the billing
page shows "UAT access". At G7 owners complete a normal AutoPay checkout (trial already consumed).

## 5. Refund exception path (SUB-COUPON-05)

A tester debited in error is refunded in full through the platform refund RPC with `reason_code = 'uat_tester'`; record
the payment id and refund id only. The tester gets the notice template in `docs/uat/campaign-guide.md`.

## 6. Day-to-day during UAT

Weekly: usage page check, alert e-mails reviewed, feedback triaged (`docs/uat/campaign-guide.md`), `/api/ready` provider
state. Monthly: restore drill (`docs/runbooks/restore-drill-aws.md`). Success metrics (interaction counts, error rate,
message delivery, UAT-to-paid intent) are read from the ops report and the PO's notes.

## 7. UAT exit checklist (feeds V2-16 and G7, section 17.2)

- [ ] GSTIN in `platform_settings` (needed before any debit).
- [ ] Razorpay live webhook verified (`razorpay-live.md`).
- [ ] Every `uat` redemption's first debit date and amount listed (query counts per clinic; ids only).
- [ ] T-3 and T-1 notices verified on one tester.
- [ ] `uat` campaign set to **paused** (no new redemptions after exit).
- [ ] Any tester who should not convert is cancelled **before** their first debit.
- [ ] **G7 passes at least 5 days before the earliest `free_until`**, or `docs/runbooks/uat-slip.md` is completed.
- [ ] Supabase Pro and PITR done (`free-tier-upgrade.md`), PITR drill recorded.
- [ ] Feedback summary and metrics recorded; go/no-go for paid launch by the PO.
