# Backups (pointer)

> **Superseded (V2-04 04-05a, ruling R-10).** See [`docs/runbooks/backup-restore.md`](../runbooks/backup-restore.md).

This page used to describe daily managed snapshots, point-in-time recovery and multi-region retention. Those claims were
not verified and do not hold on the Supabase Free plan (no PITR, no downloadable managed backups; roadmap §9.1); they
were removed. The runbook describes what is built and tested: twice-daily age-encrypted dumps of staging to Cloudflare
R2 (30-day lifecycle), the restore drill into a second local stack, failure alerts, RPO ≤ 12 h and RTO ≤ 4 h (R-4).
The AWS `ap-south-1` option for go-live is [`docs/ops/backup-aws-golive.md`](../ops/backup-aws-golive.md).
