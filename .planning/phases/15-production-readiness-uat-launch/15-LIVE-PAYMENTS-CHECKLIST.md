# V2-15 live payments checklist (PO fills; ids and dates only)

Runbook: `docs/runbooks/razorpay-live.md`. No keys, secrets, customer names, phone numbers or e-mail addresses here.
If live mode is late, the PO writes the comp fallback decision in the last section instead.

| # | Item | Done (date) | Provider id / note |
|---|---|---|---|
| 1 | KYC complete | | |
| 2 | Live key id prefix is `rzp_live_` (yes/no only) | | |
| 3 | Live webhook created, secret in the production store | | webhook id |
| 4 | Live Standard plan, 176882 paise | | plan id |
| 5 | Plan id inserted through `platform.create_plan_price`; no test-looking ids; no AI plan ids | | live_ids / test_like_ids counts |
| 6 | Webhook delivery: all signature_valid | | event ids checked |
| 7 | UPI mandate: Rs 5 authorised, auto-refunded | | subscription id, payment id, refund id |
| 8 | Card mandate: Rs 5 authorised, auto-refunded | | subscription id, payment id, refund id |
| 9 | Cancel at period end verified | | subscription id |
| 10 | One live `uat` redemption by the PO's test clinic: deferred `start_at`, no debit | | subscription id, start_at date |
| 11 | AutoPay from the installed PWA, Android | | R12 result |
| 12 | AutoPay from the installed PWA, iOS (incl. reload on return) | | R12 result |

## Comp fallback (only if live mode is late)

Written decision by the PO (date): ______ . Reason: ______ . Tenants granted `comp_until`: <count>. Live mode becomes a
G7 blocker; sections 1 to 5 of the runbook are redone before G7.
