# Backup and restore (pointer)

> **Superseded (V2-04 04-05a, ruling R-10).** The backup and restore procedure is
> [`docs/runbooks/backup-restore.md`](../runbooks/backup-restore.md). The AWS design for go-live is
> [`docs/ops/backup-aws-golive.md`](backup-aws-golive.md).

The earlier text of this page described point-in-time recovery, WAL archiving, a 15-minute RPO and paid-plan backup
windows. None of that was verified against the project: the Supabase projects run on the Free plan, which has no PITR
and no downloadable managed backups (roadmap §9.1). Those claims were removed. What exists is in the runbook:

- staging: an age-encrypted logical dump plus a Storage object sync, twice a day, to a Cloudflare R2 bucket with a
  30-day lifecycle (`.github/workflows/backup.yml`, `ops/backup/backup.sh`);
- a scripted restore drill into a second local Supabase stack (`ops/restore-drill/run.sh`), run nightly on synthetic
  data and monthly by the PO on a staging archive;
- targets: RPO ≤ 12 hours, RTO ≤ 4 hours (ruling R-4); production backups are designed at go-live (V2-15).
