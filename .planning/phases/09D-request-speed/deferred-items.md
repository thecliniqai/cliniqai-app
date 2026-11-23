# 09D deferred items (out of scope, found while verifying)

| Found | Item | Why deferred |
| --- | --- | --- |
| 2026-11-23 | `tests/security/review2-fixes-db.spec.ts` › "reschedule links: only the hash is stored and the raw link still works once" fails with 409 when run on a Monday: it reschedules to "today + 13 days, 05:00 UTC", which is a Sunday (clinic closed, no slot). Reproduced on the base commit `0acb544c` (same 409), so it is not caused by 09D. Fix: pick the next weekday inside the seed-slot rule instead of a fixed +13 days. | Pre-existing, date-dependent test defect in an unrelated area (public reschedule links). |
