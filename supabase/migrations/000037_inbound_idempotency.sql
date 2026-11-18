-- Migration: 000037_inbound_idempotency.sql
-- V2-04 plan 04-03c (P0-12 inbound idempotency; rulings R-7, R-25, R-35, R-43; threats T-04-08, T-04-10, T-04-16,
-- T-04-23).
--
-- 1. ops.inbound_webhook_events: the shared dedupe store of inbound server-to-server callbacks (MSG91 inbound messages
--    and delivery reports; the Supabase Auth Send Email hook's `webhook-id`). Provider, key and timestamps only: no
--    payload, no phone, no address (PII never reaches it).
--      public.inbound_webhook_begin(provider, key)  -> process | duplicate | in_flight   (service role only)
--      public.inbound_webhook_finish(provider, key, processed | ignored | failed)        (service role only)
--    A provider retry of a callback that finished answers `duplicate` (no side effect); one that arrives while the first
--    is still running answers `in_flight`; a `failed` attempt, or one unfinished for 5 minutes (a crash), is processed
--    again (`process`). Side effects stay idempotent on a reprocess: status-guarded updates and dedupe keys.
-- 2. public.communication_queue_apply_dlr: one transaction for a delivery report's monotonic status change and its
--    audit row (`delivered` never overwrites `read`; `failed` never overwrites `delivered` or `read`; a repeat changes
--    nothing and writes no second audit row).
-- 3. public.enqueue_unmatched_reply_system + job kind `message.reply_unmatched` (R-25): the bot reply to a sender no
--    patient matches is a tenant-less job `{ to, template_id }`; its phone is erased (`payload := {"redacted": true}`)
--    the moment the job leaves pending/running.
-- 4. ops.replay_job(id) (R-35, postgres only): a dead job back to pending with its delivery row.
--
-- Raised reasons (lib/db/errors.ts RPC_REASON_CODES): INPUT_INVALID, ACTOR_INVALID, RECIPIENT_NOT_ALLOWED,
-- TEMPLATE_NOT_ALLOWED, JOB_NOT_REPLAYABLE.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Inbound dedupe store
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE ops.inbound_webhook_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider TEXT NOT NULL CHECK (provider IN ('msg91', 'supabase_auth_hook')),
    dedupe_key TEXT NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    outcome TEXT CHECK (outcome IN ('processed', 'ignored', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
    CONSTRAINT inbound_webhook_events_provider_key UNIQUE (provider, dedupe_key)
);

-- Retention (R-2: 30 days) is 04-06's ops.cleanup; this index serves it.
CREATE INDEX inbound_webhook_events_received_at ON ops.inbound_webhook_events (received_at);

COMMENT ON TABLE ops.inbound_webhook_events IS
    'V2-04 04-03c (P0-12, R-43): one row per inbound callback key (MSG91 message id / delivery report, Send Email hook '
    'webhook-id). Provider, key, timestamps and outcome only; never a payload. Written only by inbound_webhook_begin '
    'and inbound_webhook_finish.';

ALTER TABLE ops.inbound_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ops.inbound_webhook_events FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.inbound_webhook_begin(p_provider TEXT, p_dedupe_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_id BIGINT;
    v_received TIMESTAMPTZ;
    v_processed TIMESTAMPTZ;
    v_outcome TEXT;
BEGIN
    IF p_provider IS NULL OR p_provider NOT IN ('msg91', 'supabase_auth_hook')
        OR p_dedupe_key IS NULL OR char_length(p_dedupe_key) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- A concurrent insert of the same key waits here for the first transaction, then conflicts.
    INSERT INTO ops.inbound_webhook_events (provider, dedupe_key)
    VALUES (p_provider, p_dedupe_key)
    ON CONFLICT (provider, dedupe_key) DO NOTHING;
    IF FOUND THEN
        RETURN 'process';
    END IF;

    SELECT e.id, e.received_at, e.processed_at, e.outcome
      INTO v_id, v_received, v_processed, v_outcome
      FROM ops.inbound_webhook_events e
     WHERE e.provider = p_provider AND e.dedupe_key = p_dedupe_key
       FOR UPDATE;

    IF v_processed IS NOT NULL THEN
        RETURN 'duplicate';
    END IF;

    -- A failed attempt, or one that never finished within 5 minutes (the instance crashed), is processed again.
    IF v_outcome = 'failed' OR v_received < now() - INTERVAL '5 minutes' THEN
        UPDATE ops.inbound_webhook_events e
           SET received_at = now(),
               outcome = NULL,
               attempts = e.attempts + 1
         WHERE e.id = v_id;
        RETURN 'process';
    END IF;

    RETURN 'in_flight';
END;
$$;

REVOKE ALL ON FUNCTION public.inbound_webhook_begin(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inbound_webhook_begin(TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.inbound_webhook_begin(TEXT, TEXT) IS
    'V2-04 04-03c: claims an inbound callback key. process (new, failed before, or unfinished for 5 min) | duplicate '
    '(finished) | in_flight (another instance is processing it). service_role only.';

CREATE FUNCTION public.inbound_webhook_finish(p_provider TEXT, p_dedupe_key TEXT, p_outcome TEXT)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
BEGIN
    IF p_provider IS NULL OR p_provider NOT IN ('msg91', 'supabase_auth_hook')
        OR p_dedupe_key IS NULL OR char_length(p_dedupe_key) NOT BETWEEN 1 AND 200
        OR p_outcome IS NULL OR p_outcome NOT IN ('processed', 'ignored', 'failed') THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    UPDATE ops.inbound_webhook_events e
       SET outcome = p_outcome,
           processed_at = CASE WHEN p_outcome = 'failed' THEN NULL ELSE now() END
     WHERE e.provider = p_provider
       AND e.dedupe_key = p_dedupe_key
       AND e.processed_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.inbound_webhook_finish(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inbound_webhook_finish(TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.inbound_webhook_finish(TEXT, TEXT, TEXT) IS
    'V2-04 04-03c: records the outcome of a claimed inbound callback key: processed | ignored (finished, later '
    'repeats are duplicates) or failed (the next delivery processes it again). service_role only.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Delivery reports: monotonic transition + audit row in one transaction
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION public.communication_queue_apply_dlr(
    p_external_message_id TEXT,
    p_status TEXT,
    p_at TIMESTAMPTZ,
    p_reason_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_row RECORD;
    v_matches INTEGER;
    v_at TIMESTAMPTZ := least(coalesce(p_at, now()), now());
    v_reason TEXT := ops.job_error_code(coalesce(nullif(btrim(p_reason_code), ''), 'dlr_failed'));
    v_new TEXT;
    v_meta JSONB;
    v_audit JSONB;
BEGIN
    IF p_external_message_id IS NULL OR char_length(p_external_message_id) NOT BETWEEN 1 AND 200
        OR p_status IS NULL OR p_status NOT IN ('delivered', 'read', 'failed') THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- The provider's id names one message. Two rows with the same id are ambiguous: nothing is changed (as before).
    SELECT count(*) INTO v_matches
      FROM public.communication_queue q
     WHERE q.external_message_id = p_external_message_id;
    IF v_matches <> 1 THEN
        RETURN jsonb_build_object('queue_id', NULL, 'applied', false);
    END IF;

    SELECT q.id, q.tenant_id, q.status, q.message_type, q.recipient_phone, q.metadata
      INTO v_row
      FROM public.communication_queue q
     WHERE q.external_message_id = p_external_message_id
       FOR UPDATE;

    v_new := CASE
        WHEN p_status = 'delivered' AND v_row.status NOT IN ('delivered', 'read', 'cancelled') THEN 'delivered'
        WHEN p_status = 'read' AND v_row.status NOT IN ('read', 'cancelled') THEN 'read'
        WHEN p_status = 'failed' AND v_row.status NOT IN ('delivered', 'read', 'dead_letter', 'cancelled') THEN 'dead_letter'
        ELSE NULL
    END;

    IF v_new IS NULL THEN
        RETURN jsonb_build_object(
            'queue_id', v_row.id, 'tenant_id', v_row.tenant_id, 'applied', false,
            'new_status', v_row.status, 'message_type', v_row.message_type
        );
    END IF;

    v_meta := coalesce(v_row.metadata, '{}'::jsonb) || CASE p_status
        WHEN 'delivered' THEN jsonb_build_object('delivered_at', v_at)
        WHEN 'read' THEN jsonb_build_object('read_at', v_at)
        ELSE jsonb_build_object('failed_at', now(), 'failure_reason', v_reason)
    END;

    UPDATE public.communication_queue q
       SET status = v_new,
           metadata = v_meta,
           -- next_retry_at is NOT NULL and left as is: dead_letter is terminal and never claimed again.
           error_message = CASE WHEN p_status = 'failed' THEN v_reason ELSE q.error_message END,
           updated_at = now()
     WHERE q.id = v_row.id;

    -- No recipient phone (personal data) in the audit trail (01-10).
    v_audit := jsonb_build_object(
        'requestId', p_external_message_id,
        'status', v_new,
        'queue_id', v_row.id,
        'message_type', v_row.message_type
    ) || CASE p_status
        WHEN 'delivered' THEN jsonb_build_object('delivered_at', v_at)
        WHEN 'read' THEN jsonb_build_object('read_at', v_at)
        ELSE jsonb_build_object('reason', v_reason)
    END;

    INSERT INTO public.audit_logs (
        tenant_id, actor_id, actor_role, actor_type, action, entity_type, entity_id, occurred_at, metadata
    ) VALUES (
        v_row.tenant_id, NULL, 'system', 'system', 'communication_dlr_' || p_status, 'communication_queue', v_row.id,
        now(), v_audit
    );

    RETURN jsonb_build_object(
        'queue_id', v_row.id, 'tenant_id', v_row.tenant_id, 'applied', true, 'new_status', v_new,
        'message_type', v_row.message_type, 'recipient_phone', v_row.recipient_phone
    );
END;
$$;

REVOKE ALL ON FUNCTION public.communication_queue_apply_dlr(TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.communication_queue_apply_dlr(TEXT, TEXT, TIMESTAMPTZ, TEXT) TO service_role;

COMMENT ON FUNCTION public.communication_queue_apply_dlr(TEXT, TEXT, TIMESTAMPTZ, TEXT) IS
    'V2-04 04-03c: applies an MSG91 delivery report (delivered | read | failed) to the one queue row with that provider '
    'id: monotonic (delivered never overwrites read; failed never overwrites delivered or read), status + audit row in '
    'one transaction, a repeat is applied=false. Returns {queue_id, tenant_id, applied, new_status, message_type} '
    '(+ recipient_phone when applied, for the urgent-failure note). service_role only.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Unmatched-sender bot reply (R-25): a tenant-less job whose phone is erased when it finishes
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION public.enqueue_unmatched_reply_system(
    p_system_actor TEXT,
    p_to TEXT,
    p_template_id TEXT,
    p_dedupe_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
BEGIN
    IF auth.uid() IS NOT NULL OR p_system_actor IS DISTINCT FROM 'system:messaging_webhook' THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_dedupe_key IS NULL OR char_length(p_dedupe_key) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_to IS NULL OR p_to !~ '^\+91[6-9][0-9]{9}$' THEN
        RAISE EXCEPTION 'RECIPIENT_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM ops.message_templates t
         WHERE t.template_id = p_template_id AND t.channel = 'whatsapp' AND t.unmatched_ok
    ) THEN
        RAISE EXCEPTION 'TEMPLATE_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;

    RETURN ops.enqueue_job(
        'message.reply_unmatched', NULL, jsonb_build_object('to', p_to, 'template_id', p_template_id),
        p_dedupe_key, now(), 3
    );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_unmatched_reply_system(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_unmatched_reply_system(TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.enqueue_unmatched_reply_system(TEXT, TEXT, TEXT, TEXT) IS
    'V2-04 04-03c (R-25): queues the bot reply to an inbound sender no patient matches: a tenant-less '
    'message.reply_unmatched job {to, template_id}; only system:messaging_webhook, an Indian mobile in E.164 and an '
    'unmatched_ok WhatsApp template. Same dedupe key → the same job. service_role only.';

CREATE FUNCTION ops.redact_reply_unmatched_payload()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.payload := jsonb_build_object('redacted', true);
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ops.redact_reply_unmatched_payload() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER jobs_reply_unmatched_redact
    BEFORE UPDATE ON ops.jobs
    FOR EACH ROW
    WHEN (NEW.kind = 'message.reply_unmatched' AND NEW.status NOT IN ('pending', 'running'))
    EXECUTE FUNCTION ops.redact_reply_unmatched_payload();

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Dead-letter replay (R-35): postgres only (SQL editor), runbook docs/runbooks/jobs.md §11
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION ops.replay_job(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_job RECORD;
BEGIN
    SELECT j.id, j.kind, j.status, j.payload INTO v_job FROM ops.jobs j WHERE j.id = p_id FOR UPDATE;
    -- Not found, not dead, or an unmatched reply whose phone is already erased: nothing to replay.
    IF NOT FOUND OR v_job.status <> 'dead' OR v_job.kind = 'message.reply_unmatched' THEN
        RAISE EXCEPTION 'JOB_NOT_REPLAYABLE' USING ERRCODE = 'P0001';
    END IF;

    UPDATE ops.jobs j
       SET status = 'pending',
           attempts = 0,
           run_at = now(),
           finished_at = NULL,
           locked_until = NULL,
           lease_token = NULL,
           locked_by = NULL,
           updated_at = now()
     WHERE j.id = v_job.id;

    IF v_job.kind = 'message.send' THEN
        UPDATE public.communication_queue q
           SET status = 'pending', retry_count = 0, next_retry_at = now(), error_message = NULL, updated_at = now()
         WHERE q.id = (v_job.payload ->> 'queue_id')::uuid
           AND q.status IN ('failed', 'dead_letter');
    ELSIF v_job.kind = 'webhook.deliver' THEN
        UPDATE public.webhook_delivery_queue w
           SET status = 'pending', retry_count = 0, next_retry_at = now(), last_error = NULL, updated_at = now()
         WHERE w.id = (v_job.payload ->> 'delivery_id')::uuid
           AND w.status = 'failed';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION ops.replay_job(UUID) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION ops.replay_job(UUID) IS
    'V2-04 04-03c (R-35): replays a dead job: pending, attempts 0, due now; a message.send / webhook.deliver delivery '
    'row goes back to pending with retry_count 0. Raises JOB_NOT_REPLAYABLE for a missing or non-dead job and for '
    'message.reply_unmatched (its phone is erased). postgres only.';
