-- Migration: 000070_visit_integrity_contract.sql
-- V2-05 fix plan 05-11a step 3 (M-TOKEN). CONTRACT: members no longer write queue-token numbers.
--
-- Deploy order: the app that checks in through `issue_queue_token` (features/queue/service.ts, 05-11a) must be
-- serving before this runs on a shared database; an older build inserts `queue_tokens` itself and would fail at
-- check-in. With no production v2 database yet (PO-15) it ships with 000068-000069; the 05-b0 runbook records the
-- order for the first live cut-over.
--
-- 1. `authenticated` loses INSERT on `queue_tokens` and keeps UPDATE only on (priority, called_at, completed_at): the
--    token row is written by `issue_queue_token` (definer) alone, so `token_number`, `date`, `visit_id` and
--    `tenant_id` cannot be forged or rewound (INT M-2). The SELECT and UPDATE policies are unchanged; the INSERT
--    policy `queue_tokens_insert` is dropped (no privilege, no policy: matrix `rpc_only`).
-- 2. `next_queue_token` is dropped: without the INSERT privilege it would only advance the counter, so any member
--    could burn the day's numbers up to 9999 and stop check-in. `issue_queue_token` replaces it (000068).
--    `generate_daily_queue_token` (read-only, bound, no app caller) stays until 05-b0.

REVOKE INSERT, UPDATE ON public.queue_tokens FROM authenticated;
GRANT UPDATE (priority, called_at, completed_at) ON public.queue_tokens TO authenticated;
DROP POLICY queue_tokens_insert ON public.queue_tokens;

DROP FUNCTION public.next_queue_token(uuid);
