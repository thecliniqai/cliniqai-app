# 09D deferred items (out of scope, found while verifying)

| Found | Item | Why deferred |
| --- | --- | --- |
| 2026-11-23 | `tests/security/review2-fixes-db.spec.ts` › "reschedule links: only the hash is stored and the raw link still works once" fails with 409 when run on a Monday: it reschedules to "today + 13 days, 05:00 UTC", which is a Sunday (clinic closed, no slot). Reproduced on the base commit `0acb544c` (same 409), so it is not caused by 09D. Fix: pick the next weekday inside the seed-slot rule instead of a fixed +13 days. | Pre-existing, date-dependent test defect in an unrelated area (public reschedule links). |

09D-01a (2026-11-23):

| Found | Item | Status / why deferred |
| --- | --- | --- |
| 2026-11-23 | The review2 "reschedule links" row above (and the same flaw in review2 +11 days and review-fixes AR-L2 +12 days). | **Fixed** in 09D-01a, A-6 (`d7057bae`): the seeded doctor is open all seven days before those cases. |
| 2026-11-23 | Ruling R-S, S-1's stronger option: `session_is_live()` inside the definer commands (`change_member_role`, `remove_member`, the DPDP export audit RPC) and in the INSERT rules of `api_keys` and `webhook_subscriptions`, so a raw-JWT caller is also refused. | **V2-14 backlog** (ruling R-S). The database never had it, so 09D does not regress it; needs a migration. |
| 2026-11-23 | A-12: the receipt PDF's doctor-name fallback reads the signed-in user's JWT metadata name (stale for up to the token's 900 s, and the wrong person when the visit's doctor is someone else; the wrong-person part predates 09D). The profile screen's email/phone fallback also reads the claims. | Billing/receipts owner (V2-10). A fix needs a receipt-content test; the membership row (fresh) is the primary source in both. |
| 2026-11-23 | A-13: the e2e fixture can wrap `goto`/`reload` twice when a spec calls `routeLoopbackOnly` twice per context, and its 5 s streamed-reveal wait swallows its own timeout without an annotation. | Test-harness only (no product effect; a second wrap waits on an already-settled DOM). Goes with the 09E latency lane's reporting. |
