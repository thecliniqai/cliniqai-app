# Runbook: alerts and the alert drill

V2-15 plan 15-03. Roadmap section 17.1 "queue-lag and dead-letter alerts tested by a drill; lifecycle, reconcile and
retention jobs scheduled and their alerts tested". The drill tool is `scripts/ops/alert-drill.mjs` (15-03 code part,
`--local` fires each alert once and clears it; `--print` prints the production steps). It is **not yet in the repo**
(see 15-NOTES.md); until it is merged, section 3 describes the manual equivalent. Run production drills yourself (PO);
agents never run anything against production.

## 1. The alerts

| Alert | Fires when | First look | Likely fix |
|---|---|---|---|
| `queue_lag` | the oldest due job or message waits longer than its threshold | `docs/runbooks/jobs.md` (runner, Vault secret, pg_cron) | check the runner secret pair, the `jobs` cron row, Vercel function errors |
| `dead_letter` | a message or job reached its attempt limit | the dead-letter count and reason codes (no payloads) | fix the provider issue, requeue through the documented RPC, never edit rows |
| `backup_stale` / backup failure | no `ops.backup_runs` ok row within 14 h, or a failed run | the "Production backup failing" issue, `docs/ops/backup-restore.md` | secrets, bucket, age recipients; rerun the workflow |
| heartbeat (FT-03) | the database keep-alive row is older than its window | `ops` heartbeat table | the free project may have paused: unpause in the dashboard, check pg_cron |
| quota (FT-04) | database size, Storage, egress or MAU nears the Free limit | Supabase usage page, `docs/runbooks/free-tier-upgrade.md` triggers | purge, or upgrade early per the triggers |
| billing divergence | provider state differs from local subscription state (reconcile job) | `platform` billing reconcile view | `docs/runbooks/razorpay-live.md` section 8 |
| `debit_without_gstin` | a provider debit exists while no GSTIN is in `platform_settings` | the divergence row | `docs/runbooks/uat-slip.md`, refund `uat_tester` |
| lifecycle / retention | the lifecycle, reconcile or retention job missed its schedule | `cron.job_run_details` summary (counts) | `docs/runbooks/jobs.md` |

Alerts reach the PO at `OPS_ALERT_EMAIL` (required in production, 15-01) and as GitHub issues for the backup
workflow. Use a mailbox the PO reads daily; test it (section 2).

## 2. Delivery test (once, before UAT)

Send the ops test alert (the `OPS_ALERT_EMAIL` path in `docs/runbooks/error-sink.md`); the message must arrive within five
minutes and must contain only ids and counts. Record the time received.

## 3. Drill (production, PO; same steps as `--print`)

For each alert in section 1, in this order and with at most one open at a time:

1. Create the condition the safe way the drill prints (for example insert one synthetic overdue job row flagged
   `drill`, or a synthetic failed `ops.backup_runs` row with reason `drill`). Use only rows the drill marks as
   synthetic; never alter real clinic data.
2. Wait for the next evaluation (up to 5 minutes) and confirm the alert e-mail or issue arrives.
3. Clear the condition (the drill prints the delete of its own synthetic row) and confirm the alert resolves.
4. Record the alert name, time fired, time cleared.

Local rehearsal: `node scripts/ops/alert-drill.mjs --local` against the local stack (CI runs it; agents may run it
only on the local stack and only with the PO's stack rules).

## 4. Verify block (paste back)

```
alert | fired at (IST) | cleared at (IST)
queue_lag | |
dead_letter | |
backup failure | |
heartbeat | |
quota | |
billing divergence | |
debit_without_gstin | |
lifecycle/retention missed job | |
ops test e-mail received: yes/no, minutes
```

## 5. After the drill

Drill rows are deleted; the alert history is kept. Repeat the drill after any change to alert thresholds and at each
monthly restore drill (V2-16).
