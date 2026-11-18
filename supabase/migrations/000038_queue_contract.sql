-- Migration: 000038_queue_contract.sql
-- V2-04 plan 04-03c, contract step (R-38; closes V2-03 M-XTENANT-WH "revoke direct queue writes"; threats T-04-05,
-- T-04-06, T-04-25).
--
-- Every caller moved before this file: patient messages (04-03a, 000035), webhook events (04-03b, 000036) and the
-- inbound webhook's bot replies (04-03c, 000037 + this plan's route) go through the enqueue RPCs and the job runner;
-- `sendDirectSms` / `sendDirectWhatsApp` are deleted. The member-side revokes were pulled forward into 000035
-- (communication_queue) and 000036 (webhook_delivery_queue); this file
--
--   1. re-applies them idempotently (a no-op on a database migrated in order) and drops anon's remaining SELECT,
--   2. asserts the contract against the catalogue and fails the migration if any part is missing: no API role may
--      INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER either queue table (table or column level), anon holds
--      no privilege on either, every policy on them is FOR SELECT, and no API role may execute the queue's claim,
--      finish, dead-letter, delivery-report or inbound-dedupe functions,
--   3. adds ops.backfill_delivery_jobs() (stale `processing` rows → failed first; then one job per open row that has
--      none, with the trigger's dedupe key; idempotent) and calls it once.
--
-- Expand and contract ship in one PR (R-38): staging holds synthetic data and production is created fresh in V2-15,
-- so no environment runs pre-V2-04 code with real users. Staging order: docs/runbooks/staging.md §6.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Revokes (idempotent)
-- ---------------------------------------------------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.communication_queue FROM anon, authenticated;
REVOKE ALL ON TABLE public.communication_queue FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.webhook_delivery_queue FROM anon, authenticated;
REVOKE ALL ON TABLE public.webhook_delivery_queue FROM anon;

DO $$
DECLARE
    v_col RECORD;
BEGIN
    -- Column-level grants survive a table-level REVOKE.
    FOR v_col IN
        SELECT DISTINCT g.table_name, g.column_name, g.privilege_type, g.grantee
          FROM information_schema.column_privileges g
         WHERE g.table_schema = 'public'
           AND g.table_name IN ('communication_queue', 'webhook_delivery_queue')
           AND (
                (g.grantee IN ('anon', 'authenticated') AND g.privilege_type IN ('INSERT', 'UPDATE', 'REFERENCES'))
             OR (g.grantee = 'anon')
           )
    LOOP
        EXECUTE format(
            'REVOKE %s (%I) ON TABLE public.%I FROM %I',
            v_col.privilege_type, v_col.column_name, v_col.table_name, v_col.grantee
        );
    END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.communication_queue_claim(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.communication_queue_finish(UUID, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Contract assertions (the migration fails rather than ship a partial contract)
-- ---------------------------------------------------------------------------------------------------------------------

DO $$
DECLARE
    v_bad TEXT;
BEGIN
    -- has_*_privilege sees grants from any grantor and through PUBLIC (information_schema shows only some of them).
    SELECT string_agg(t.tbl || ':' || r.rolname || ':' || pr.priv, ', ') INTO v_bad
      FROM (VALUES ('public.communication_queue'), ('public.webhook_delivery_queue')) AS t(tbl)
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS pr(priv)
     WHERE (r.rolname = 'anon' OR pr.priv <> 'SELECT')
       AND (
            has_table_privilege(r.rolname, t.tbl, pr.priv)
         OR (pr.priv IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') AND has_any_column_privilege(r.rolname, t.tbl, pr.priv))
       );
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'queue contract: privilege left: %', v_bad;
    END IF;

    SELECT string_agg(p.tablename || ':' || p.policyname, ', ') INTO v_bad
      FROM pg_catalog.pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename IN ('communication_queue', 'webhook_delivery_queue')
       AND p.cmd <> 'SELECT';
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'queue contract: write policy left: %', v_bad;
    END IF;

    SELECT string_agg(f.sig || ':' || r.rolname, ', ') INTO v_bad
      FROM (VALUES
            ('public.communication_queue_claim(uuid)'),
            ('public.communication_queue_finish(uuid, boolean, text, text)'),
            ('public.communication_queue_dead_letter(uuid, text)'),
            ('public.communication_queue_apply_dlr(text, text, timestamp with time zone, text)'),
            ('public.webhook_delivery_claim(uuid)'),
            ('public.inbound_webhook_begin(text, text)'),
            ('public.inbound_webhook_finish(text, text, text)'),
            ('public.enqueue_unmatched_reply_system(text, text, text, text)'),
            ('public.enqueue_message_system(text, uuid, uuid, text, text, text, jsonb, text, uuid, jsonb, timestamp with time zone, text)')
           ) AS f(sig)
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
     WHERE has_function_privilege(r.rolname, f.sig::regprocedure, 'EXECUTE');
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'queue contract: API role may execute: %', v_bad;
    END IF;

    SELECT string_agg(p.oid::regprocedure::text || ':' || r.rolname, ', ') INTO v_bad
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
     WHERE p.proname = 'webhook_delivery_finish'
       AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'queue contract: API role may execute: %', v_bad;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Backfill: every open delivery row has its job
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION ops.backfill_delivery_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_created INTEGER := 0;
    v_row RECORD;
BEGIN
    -- 1. Rows stuck in `processing` for 240 s (2 × the runner lease) become failed / outcome_unknown first: the same
    --    rule as ops.reap_delivery_rows(), without its enqueue (step 2 counts what it creates).
    UPDATE public.communication_queue q
       SET status = 'failed', error_message = 'outcome_unknown', next_retry_at = now(), updated_at = now()
     WHERE q.status = 'processing'
       AND q.updated_at < now() - INTERVAL '240 seconds';
    UPDATE public.webhook_delivery_queue w
       SET status = 'failed', last_error = 'outcome_unknown', next_retry_at = now(), updated_at = now()
     WHERE w.status = 'processing'
       AND w.updated_at < now() - INTERVAL '240 seconds';

    -- 2. One job per open row that has none (the trigger's kind, payload, dedupe key and attempts).
    FOR v_row IN
        SELECT q.id, q.tenant_id, q.next_retry_at, q.max_retries
          FROM public.communication_queue q
         WHERE q.status IN ('pending', 'failed')
           AND NOT EXISTS (SELECT 1 FROM ops.jobs j WHERE j.dedupe_key = 'msg:' || q.id::text)
    LOOP
        PERFORM ops.enqueue_job(
            'message.send', v_row.tenant_id, jsonb_build_object('queue_id', v_row.id), 'msg:' || v_row.id::text,
            v_row.next_retry_at, least(greatest(v_row.max_retries, 0), 18) + 2
        );
        v_created := v_created + 1;
    END LOOP;

    -- A webhook row is open while pending, or failed by the reaper (outcome_unknown: webhook_delivery_claim takes it
    -- again); any other failed row is terminal.
    FOR v_row IN
        SELECT w.id, w.tenant_id, w.next_retry_at, w.max_retries
          FROM public.webhook_delivery_queue w
         WHERE (w.status = 'pending' OR (w.status = 'failed' AND w.last_error = 'outcome_unknown'))
           AND NOT EXISTS (SELECT 1 FROM ops.jobs j WHERE j.dedupe_key = 'wh:' || w.id::text)
    LOOP
        PERFORM ops.enqueue_job(
            'webhook.deliver', v_row.tenant_id, jsonb_build_object('delivery_id', v_row.id), 'wh:' || v_row.id::text,
            v_row.next_retry_at, least(greatest(v_row.max_retries, 1), 5) + 2
        );
        v_created := v_created + 1;
    END LOOP;

    RETURN v_created;
END;
$$;

REVOKE ALL ON FUNCTION ops.backfill_delivery_jobs() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION ops.backfill_delivery_jobs() IS
    'V2-04 04-03c (R-38): delivery rows in processing > 240 s → failed / outcome_unknown, then one job per open '
    'communication_queue / webhook_delivery_queue row that has none (trigger dedupe key). Returns the jobs created; '
    'a second call creates none. postgres only.';

SELECT ops.backfill_delivery_jobs();
