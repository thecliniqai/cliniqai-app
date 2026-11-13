# V2-04 wave notes (orchestrator)

Cross-plan handoffs raised by implementers. Each later plan's implementer must read this file. Each plan commits only
its own rows.

| From | For | Note |
|---|---|---|
| 04-01 | 04-05a / orchestrator | Migration `000031_jobs_queue.sql` is committed (`60e339c`) with `EXPECTED_MIGRATION = "000031"`, the regenerated `scripts/drift/schema-snapshot.txt` and `types/database.ts`. The primary stack was reset with it (04-01 is wave 1's resetter). 04-05a: apply `000032` with `npx supabase migration up --local` (no reset needed), then bump to `000032` and regenerate the snapshot on top of this commit. |
