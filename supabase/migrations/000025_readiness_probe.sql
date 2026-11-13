-- Migration: 000025_readiness_probe.sql
-- V2-03 plan 03-01 (P1-15, ADR-0005 "Readiness", C50 g).
--
-- `/api/ready` stops using the service-role client (three admin queries and a bucket check). It calls this one
-- SECURITY DEFINER function through the cookie client instead (anon when signed out). The function returns booleans
-- and counts only: no row, no tenant id, no message payload, no error text.
--
--   db                   true when the function ran at all
--   messages_pending     communication_queue rows waiting to be sent (pending or processing)
--   messages_failed_24h  communication_queue rows that failed or dead-lettered in the last 24 hours
--   webhooks_pending     webhook_delivery_queue rows waiting to be delivered
--   webhooks_failed_24h  webhook_delivery_queue rows that failed in the last 24 hours
--   latest_migration     the newest applied migration version (e.g. "000025"); proves which schema is live
--
-- Every count is served by the existing (status, next_retry_at) indexes. `search_path` is empty, so every name is
-- schema-qualified. Supabase's default privileges grant EXECUTE on new public functions to anon and authenticated;
-- those are revoked first and the two roles are granted explicitly.

CREATE OR REPLACE FUNCTION public.readiness_probe()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_since TIMESTAMPTZ := now() - INTERVAL '24 hours';
BEGIN
    RETURN jsonb_build_object(
        'db', true,
        'messages_pending', (
            SELECT count(*) FROM public.communication_queue q WHERE q.status IN ('pending', 'processing')
        ),
        'messages_failed_24h', (
            SELECT count(*) FROM public.communication_queue q
            WHERE q.status IN ('failed', 'dead_letter') AND q.updated_at >= v_since
        ),
        'webhooks_pending', (
            SELECT count(*) FROM public.webhook_delivery_queue w WHERE w.status = 'pending'
        ),
        'webhooks_failed_24h', (
            SELECT count(*) FROM public.webhook_delivery_queue w
            WHERE w.status = 'failed' AND w.updated_at >= v_since
        ),
        'latest_migration', (
            SELECT max(m.version) FROM supabase_migrations.schema_migrations m
        )
    );
END;
$$;

COMMENT ON FUNCTION public.readiness_probe() IS
    'V2-03 03-01: readiness counts for /api/ready (booleans and counts only; anon-executable by design).';

REVOKE ALL ON FUNCTION public.readiness_probe() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.readiness_probe() TO anon, authenticated, service_role;
