-- Migration: 000036_webhook_enqueue.sql
-- V2-04 plan 04-03b (P0-12, ADR-0005 D3 + proposed A2; rulings R-6 revised, R-7, R-19, R-23, R-26, R-44).
--
-- Outbound webhooks leave the request path. A request only enqueues; the job runner delivers.
--
--   public.enqueue_webhook_event (authenticated)        closed event set; the event data is built HERE from the
--   public.enqueue_webhook_event_system (service_role)  subject row (no caller payload, R-26); the subject's tenant
--        -> private.webhook_event_subject                must equal p_tenant_id (the caller's session-derived active
--        -> private.enqueue_webhook_internal             tenant) and be a membership (R-6); `ping` is owner/admin only,
--                                                        5 per tenant per 60 s (03-13d). The writer reads the tenant's
--                                                        subscriptions as definer, so doctor/receptionist events are
--                                                        no longer dropped by the owner/admin-only RLS (R-19).
--        -> webhook_delivery_queue INSERT                one row per subscription, event_key dedupe (outbound
--                                                        idempotency: the same event twice queues once)
--        -> AFTER INSERT trigger                         ops.enqueue_job('webhook.deliver', tenant, {delivery_id},
--                                                        'wh:' || id, next_retry_at, least(max_retries, 5) + 2) (R-23);
--                                                        also gives 03-07's record_payment outbox rows their job
--   handler webhook.deliver (lib/jobs/internal)         webhook_delivery_claim -> pinned POST -> webhook_delivery_finish
--   ops.jobs AFTER UPDATE (dead, webhook.deliver)        an open delivery row -> failed (job_dead)
--   ops.reap_delivery_rows() (pg_cron each minute)       now also webhook rows stuck in `processing` > 240 s (R-7)
--
-- The claim is the single writer that closes the 03-10 double POST (enqueue-time background dispatch racing the cron
-- tick): both of those writers are deleted with this plan, and one row is claimed by one handler.
--
-- Contract for webhook_delivery_queue (pulled forward from 04-03c's contract, as 04-03a did for communication_queue):
-- members keep SELECT (owner/admin, the delivery-log UI) and lose every write; anon loses everything.
-- Raised reasons (lib/db/errors.ts RPC_REASON_CODES): EVENT_NOT_ALLOWED (P0001 -> VALIDATION_FAILED), RATE_LIMITED
-- (P0001 -> RATE_LIMITED), SUBJECT_MISMATCH (P0002 -> NOT_FOUND), INPUT_INVALID, ACTOR_INVALID; 42501 for a ping by a
-- role other than owner/admin.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. webhook_delivery_queue: event key (outbound idempotency), last error code, closed status set
-- ---------------------------------------------------------------------------------------------------------------------

ALTER TABLE public.webhook_delivery_queue
    ADD COLUMN IF NOT EXISTS event_key TEXT
        CONSTRAINT webhook_delivery_queue_event_key_length CHECK (char_length(event_key) BETWEEN 1 AND 200),
    ADD COLUMN IF NOT EXISTS last_error TEXT
        CONSTRAINT webhook_delivery_queue_last_error_length CHECK (char_length(last_error) <= 200);

COMMENT ON COLUMN public.webhook_delivery_queue.event_key IS
    'V2-04 04-03b: the event''s idempotency key (<event_type>:<subject_id>[:<scheduled_at>], ping:<uuid>, '
    'payment.recorded:<payment_id>); one row per subscription and key.';
COMMENT ON COLUMN public.webhook_delivery_queue.last_error IS
    'V2-04 04-03b: machine code of the last failed attempt (http_503, ssrf_blocked, outcome_unknown, job_dead:<code>); '
    'never a response body or free text.';

CREATE UNIQUE INDEX IF NOT EXISTS webhook_delivery_queue_subscription_event_key
    ON public.webhook_delivery_queue (subscription_id, event_key)
    WHERE event_key IS NOT NULL;

UPDATE public.webhook_delivery_queue
   SET status = 'failed', updated_at = now()
 WHERE status NOT IN ('pending', 'processing', 'delivered', 'failed');

ALTER TABLE public.webhook_delivery_queue
    ADD CONSTRAINT webhook_delivery_queue_status_check
        CHECK (status IN ('pending', 'processing', 'delivered', 'failed')) NOT VALID;
ALTER TABLE public.webhook_delivery_queue VALIDATE CONSTRAINT webhook_delivery_queue_status_check;

CREATE INDEX IF NOT EXISTS idx_webhook_queue_processing_updated
    ON public.webhook_delivery_queue (updated_at)
    WHERE status = 'processing';

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. One webhook.deliver job per delivery row (R-23)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION ops.webhook_delivery_enqueue_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status = 'pending' THEN
        PERFORM ops.enqueue_job(
            'webhook.deliver',
            NEW.tenant_id,
            jsonb_build_object('delivery_id', NEW.id),
            'wh:' || NEW.id::text,
            NEW.next_retry_at,
            least(greatest(NEW.max_retries, 1), 5) + 2
        );
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION ops.webhook_delivery_enqueue_job() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER webhook_delivery_queue_enqueue_job
    AFTER INSERT ON public.webhook_delivery_queue
    FOR EACH ROW EXECUTE FUNCTION ops.webhook_delivery_enqueue_job();

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. record_payment's outbox writer now sets the event key (03-07 handover: the writer, not record_payment)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.outbox_payment_recorded(p_payment_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payment RECORD;
    v_invoice RECORD;
    v_paid NUMERIC;
    v_body TEXT;
    v_count INTEGER;
BEGIN
    -- Only the payment record_payment is inserting in this call (it sets the marker just before its INSERT, inside
    -- the same function call, savepoint or not). A replayed or older payment id is refused.
    IF p_payment_id IS NULL
       OR current_setting('clinicos.record_payment_id', true) IS DISTINCT FROM p_payment_id::text THEN
        RAISE EXCEPTION 'OUTBOX_SUBJECT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT p.id, p.tenant_id, p.invoice_id, p.amount, p.payment_method, p.recorded_at
    INTO v_payment
    FROM public.payments p
    WHERE p.id = p_payment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'OUTBOX_SUBJECT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.memberships m
        WHERE m.tenant_id = v_payment.tenant_id
          AND m.user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'OUTBOX_SUBJECT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT i.status, i.total_amount INTO v_invoice
    FROM public.invoices i
    WHERE i.id = v_payment.invoice_id;

    SELECT COALESCE(sum(p.amount), 0) INTO v_paid
    FROM public.payments p
    WHERE p.invoice_id = v_payment.invoice_id
      AND p.tenant_id = v_payment.tenant_id;

    -- The standard envelope ({ id, event, created_at, data }) stored as raw text once, so the HMAC is stable across
    -- retries. Ids, amounts and statuses only: no patient field.
    v_body := jsonb_build_object(
        'id', gen_random_uuid(),
        'event', 'payment.recorded',
        'created_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'data', jsonb_build_object(
            'payment_id', v_payment.id,
            'invoice_id', v_payment.invoice_id,
            'amount', v_payment.amount,
            'payment_method', v_payment.payment_method,
            'recorded_at', to_char(v_payment.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'invoice_status', v_invoice.status,
            'paid_total', v_paid
        )
    )::text;

    -- 04-03b: event_key (one row per subscription and payment); the row's trigger creates its webhook.deliver job.
    INSERT INTO public.webhook_delivery_queue
        (tenant_id, subscription_id, event_type, payload, status, retry_count, max_retries, next_retry_at, event_key)
    SELECT v_payment.tenant_id, s.id, 'payment.recorded', v_body, 'pending', 0, 5, now(),
           'payment.recorded:' || v_payment.id::text
    FROM public.webhook_subscriptions s
    WHERE s.tenant_id = v_payment.tenant_id
      AND s.is_active
      AND s.event_types @> ARRAY['payment.recorded']
    ON CONFLICT (subscription_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION private.outbox_payment_recorded(UUID) IS
    'V2-03 03-07/03-13c, V2-04 04-03b: payment.recorded outbox fan-out for the payment record_payment is inserting in '
    'this call (marker clinicos.record_payment_id; works inside savepoints); event_key payment.recorded:<payment_id>.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Delivery claim and finish (service role only): the single writer of a row's delivery state
-- ---------------------------------------------------------------------------------------------------------------------

-- Atomic claim: pending (or reaped as outcome_unknown) and due -> processing. Returns the row and its subscription
-- (incl. the subscription's tenant, which the handler checks against the row's). A terminal `failed` row is never
-- claimed again, so a lost job write cannot re-send a terminal failure.
CREATE FUNCTION public.webhook_delivery_claim(p_id UUID)
RETURNS TABLE (
    id UUID,
    tenant_id UUID,
    subscription_id UUID,
    event_type TEXT,
    payload TEXT,
    retry_count INTEGER,
    max_retries INTEGER,
    subscription_tenant_id UUID,
    endpoint_url TEXT,
    signing_secret TEXT,
    is_active BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY
    WITH claimed AS (
        UPDATE public.webhook_delivery_queue q
           SET status = 'processing', updated_at = now()
         WHERE q.id = p_id
           AND (q.status = 'pending' OR (q.status = 'failed' AND q.last_error = 'outcome_unknown'))
           AND q.next_retry_at <= now()
        RETURNING q.id, q.tenant_id, q.subscription_id, q.event_type, q.payload, q.retry_count, q.max_retries
    )
    SELECT c.id, c.tenant_id, c.subscription_id, c.event_type, c.payload, c.retry_count, c.max_retries,
           s.tenant_id, s.endpoint_url, s.signing_secret, s.is_active
      FROM claimed c
      LEFT JOIN public.webhook_subscriptions s ON s.id = c.subscription_id;
END;
$$;

REVOKE ALL ON FUNCTION public.webhook_delivery_claim(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webhook_delivery_claim(UUID) TO service_role;

-- Records a claimed attempt. Success -> delivered. A retryable failure with attempts left -> pending at the V2-03
-- dispatcher curve (1 m, 5 m, 15 m, 1 h, 6 h); attempts are counted against least(max_retries, 5) (03-13d
-- MAX_WEBHOOK_RETRIES: a row's own value can never raise it). Otherwise failed (terminal). Only a `processing` row.
CREATE FUNCTION public.webhook_delivery_finish(
    p_id UUID,
    p_success BOOLEAN,
    p_status_code INTEGER,
    p_error_code TEXT,
    p_duration_ms INTEGER,
    p_retryable BOOLEAN
)
RETURNS TABLE (new_status TEXT, next_retry_at TIMESTAMPTZ)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
#variable_conflict use_column
DECLARE
    v_success BOOLEAN := coalesce(p_success, false);
    v_retryable BOOLEAN := coalesce(p_retryable, false) AND NOT coalesce(p_success, false);
BEGIN
    RETURN QUERY
    WITH attempt AS (
        SELECT q.id,
               greatest(q.retry_count, 0) + 1 AS attempts,
               least(greatest(q.max_retries, 1), 5) AS cap
          FROM public.webhook_delivery_queue q
         WHERE q.id = p_id AND q.status = 'processing'
    )
    UPDATE public.webhook_delivery_queue q
       SET status = CASE
               WHEN v_success THEN 'delivered'
               WHEN v_retryable AND a.attempts < a.cap THEN 'pending'
               ELSE 'failed'
           END,
           retry_count = CASE WHEN v_retryable THEN a.attempts ELSE q.retry_count END,
           next_retry_at = CASE
               WHEN v_retryable AND a.attempts < a.cap THEN now() + CASE a.attempts
                   WHEN 1 THEN INTERVAL '1 minute'
                   WHEN 2 THEN INTERVAL '5 minutes'
                   WHEN 3 THEN INTERVAL '15 minutes'
                   WHEN 4 THEN INTERVAL '1 hour'
                   ELSE INTERVAL '6 hours'
               END
               ELSE q.next_retry_at
           END,
           response_status = p_status_code,
           duration_ms = greatest(coalesce(p_duration_ms, 0), 0),
           delivered_at = CASE WHEN v_success THEN now() ELSE q.delivered_at END,
           last_error = CASE WHEN v_success THEN NULL ELSE ops.job_error_code(p_error_code) END,
           updated_at = now()
      FROM attempt a
     WHERE q.id = a.id AND q.status = 'processing'
    RETURNING q.status, q.next_retry_at;
END;
$$;

REVOKE ALL ON FUNCTION public.webhook_delivery_finish(UUID, BOOLEAN, INTEGER, TEXT, INTEGER, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webhook_delivery_finish(UUID, BOOLEAN, INTEGER, TEXT, INTEGER, BOOLEAN) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Event data built from the subject row (R-26) and the writer (R-44)
-- ---------------------------------------------------------------------------------------------------------------------

-- An instant as JavaScript's toISOString() writes it (the format the app sent for created_at/completed_at/timestamp).
CREATE FUNCTION private.webhook_iso(p_at TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

REVOKE ALL ON FUNCTION private.webhook_iso(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role;

-- The closed event set and, per event, its subject table, its data object (exactly the fields the call site sent
-- before 04-03b), its event key and whether the subject is in the state the event describes. Reads as definer and
-- raises nothing but EVENT_NOT_ALLOWED / INPUT_INVALID: o_tenant is NULL when the subject does not exist, and the
-- callers decide in an order that never tells a caller whether a row of another clinic exists.
-- TimeZone UTC: `scheduled_at` is written as PostgREST wrote it to the app before (2026-11-20T05:00:00+00:00).
CREATE FUNCTION private.webhook_event_subject(
    p_event_type TEXT,
    p_subject_id UUID,
    OUT o_tenant UUID,
    OUT o_data JSONB,
    OUT o_event_key TEXT,
    OUT o_state_ok BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET "TimeZone" = 'UTC'
AS $$
BEGIN
    IF p_subject_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    CASE p_event_type
    WHEN 'appointment.rescheduled' THEN
        SELECT v.tenant_id,
               jsonb_build_object('appointment_id', v.id, 'scheduled_at', v.scheduled_at),
               'appointment.rescheduled:' || v.id::text || ':' || coalesce(to_jsonb(v.scheduled_at) #>> '{}', ''),
               v.scheduled_at IS NOT NULL
          INTO o_tenant, o_data, o_event_key, o_state_ok
          FROM public.visits v WHERE v.id = p_subject_id;
    WHEN 'appointment.cancelled' THEN
        SELECT v.tenant_id,
               jsonb_build_object(
                   'appointment_id', v.id,
                   'reason', coalesce(NULLIF(v.metadata ->> 'cancellation_reason', ''), 'clinic_cancelled')
               ),
               'appointment.cancelled:' || v.id::text,
               v.status = 'cancelled'
          INTO o_tenant, o_data, o_event_key, o_state_ok
          FROM public.visits v WHERE v.id = p_subject_id;
    WHEN 'visit.completed' THEN
        SELECT v.tenant_id,
               jsonb_build_object(
                   'visit_id', v.id,
                   'patient_id', v.patient_id,
                   'doctor_id', v.doctor_id,
                   'completed_at', private.webhook_iso(coalesce(v.signed_at, v.updated_at))
               ),
               'visit.completed:' || v.id::text,
               v.status = 'completed'
          INTO o_tenant, o_data, o_event_key, o_state_ok
          FROM public.visits v WHERE v.id = p_subject_id;
    WHEN 'prescription.issued' THEN
        SELECT p.tenant_id,
               jsonb_build_object('prescription_id', p.id, 'patient_id', p.patient_id, 'visit_id', p.visit_id),
               'prescription.issued:' || p.id::text,
               true
          INTO o_tenant, o_data, o_event_key, o_state_ok
          FROM public.prescriptions p WHERE p.id = p_subject_id;
    WHEN 'lab_result.ready' THEN
        SELECT d.tenant_id,
               jsonb_build_object('document_id', d.id, 'patient_id', d.patient_id, 'title', d.title),
               'lab_result.ready:' || d.id::text,
               true
          INTO o_tenant, o_data, o_event_key, o_state_ok
          FROM public.patient_documents d WHERE d.id = p_subject_id;
    WHEN 'ping' THEN
        SELECT s.tenant_id,
               jsonb_build_object(
                   'type', 'test_ping',
                   'message', 'Webhook verification ping from ClinicQ Developer Settings',
                   'timestamp', private.webhook_iso(now())
               ),
               'ping:' || gen_random_uuid()::text,
               true
          INTO o_tenant, o_data, o_event_key, o_state_ok
          FROM public.webhook_subscriptions s WHERE s.id = p_subject_id;
    ELSE
        RAISE EXCEPTION 'EVENT_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END CASE;
END;
$$;

REVOKE ALL ON FUNCTION private.webhook_event_subject(TEXT, UUID) FROM PUBLIC, anon, authenticated, service_role;

-- The only writer of webhook_delivery_queue rows for request and system paths (R-44): reads the active subscriptions
-- of p_tenant_id for the event AS DEFINER (R-19), builds the envelope text once ({ id, event, created_at, data },
-- stored raw for a stable HMAC) and inserts one row per subscription; a key already queued for a subscription is
-- skipped. p_subscription_id targets that one subscription (the test ping) instead of the event's subscribers.
CREATE FUNCTION private.enqueue_webhook_internal(
    p_tenant_id UUID,
    p_event_type TEXT,
    p_data JSONB,
    p_event_key TEXT,
    p_subscription_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_body TEXT;
    v_ids UUID[];
BEGIN
    IF p_tenant_id IS NULL
        OR p_event_type IS NULL OR p_event_type !~ '^[a-z][a-z_]*(\.[a-z_]+)*$' OR char_length(p_event_type) > 64
        OR p_data IS NULL OR jsonb_typeof(p_data) <> 'object' OR octet_length(p_data::text) > 4096
        OR p_event_key IS NULL OR char_length(p_event_key) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    v_body := jsonb_build_object(
        'id', gen_random_uuid(),
        'event', p_event_type,
        'created_at', private.webhook_iso(now()),
        'data', p_data
    )::text;

    WITH inserted AS (
        INSERT INTO public.webhook_delivery_queue
            (tenant_id, subscription_id, event_type, payload, status, retry_count, max_retries, next_retry_at, event_key)
        SELECT p_tenant_id, s.id, p_event_type, v_body, 'pending', 0, 5, now(), p_event_key
          FROM public.webhook_subscriptions s
         WHERE s.tenant_id = p_tenant_id
           AND s.is_active
           AND CASE
                   WHEN p_subscription_id IS NULL THEN s.event_types @> ARRAY[p_event_type]
                   ELSE s.id = p_subscription_id
               END
        ON CONFLICT (subscription_id, event_key) WHERE event_key IS NOT NULL DO NOTHING
        RETURNING id
    )
    SELECT coalesce(array_agg(i.id), ARRAY[]::UUID[]) INTO v_ids FROM inserted i;

    RETURN jsonb_build_object('queued', cardinality(v_ids), 'delivery_ids', to_jsonb(v_ids));
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_webhook_internal(UUID, TEXT, JSONB, TEXT, UUID)
    FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.enqueue_webhook_internal(UUID, TEXT, JSONB, TEXT, UUID) IS
    'V2-04 04-03b (R-19, R-44): the only writer of webhook_delivery_queue rows for request and system paths. Callers '
    'resolve the tenant from the subject first. Returns {queued, delivery_ids}.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Request path: public.enqueue_webhook_event (R-6 revised; 03-07 D1 finding 2; R-26)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION public.enqueue_webhook_event(
    p_tenant_id UUID,
    p_event_type TEXT,
    p_subject_id UUID,
    p_subscription_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_subject RECORD;
    v_recent INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_event_type IS NULL OR p_event_type NOT IN (
        'appointment.rescheduled', 'appointment.cancelled', 'visit.completed', 'prescription.issued',
        'lab_result.ready', 'ping'
    ) THEN
        RAISE EXCEPTION 'EVENT_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;
    -- Only the test ping targets one subscription, and its subject IS that subscription.
    IF p_subscription_id IS NOT NULL AND (p_event_type <> 'ping' OR p_subscription_id IS DISTINCT FROM p_subject_id) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- p_tenant_id (ServiceContext.tenantId, session-derived) must be one of the caller's clinics.
    IF p_tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.current_user_tenant_ids() t WHERE t = p_tenant_id) THEN
        RAISE EXCEPTION 'SUBJECT_MISMATCH' USING ERRCODE = 'P0002';
    END IF;
    IF p_event_type = 'ping' AND NOT public.current_user_has_role(p_tenant_id, ARRAY['owner', 'admin']) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_subject FROM private.webhook_event_subject(p_event_type, p_subject_id);
    -- The subject must exist in the caller's active clinic: a missing row and another clinic's row read the same, and a
    -- member of clinics A and B working in A cannot raise an event about B's row.
    IF v_subject.o_tenant IS DISTINCT FROM p_tenant_id THEN
        RAISE EXCEPTION 'SUBJECT_MISMATCH' USING ERRCODE = 'P0002';
    END IF;
    IF NOT v_subject.o_state_ok THEN
        RAISE EXCEPTION 'EVENT_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;

    IF p_event_type = 'ping' THEN
        -- 03-13d: 5 pings per tenant per 60 s, counted from the tenant's ping rows so it holds across instances; the
        -- transaction lock makes concurrent pings of one tenant count one after the other.
        PERFORM pg_advisory_xact_lock(hashtextextended('webhook_ping:' || p_tenant_id::text, 0));
        SELECT count(*) INTO v_recent
          FROM public.webhook_delivery_queue q
         WHERE q.tenant_id = p_tenant_id
           AND q.event_type = 'ping'
           AND q.created_at >= now() - INTERVAL '60 seconds';
        IF v_recent >= 5 THEN
            RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE = 'P0001';
        END IF;
        RETURN private.enqueue_webhook_internal(p_tenant_id, 'ping', v_subject.o_data, v_subject.o_event_key, p_subject_id);
    END IF;

    RETURN private.enqueue_webhook_internal(p_tenant_id, p_event_type, v_subject.o_data, v_subject.o_event_key, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_webhook_event(UUID, TEXT, UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_webhook_event(UUID, TEXT, UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. System path: public.enqueue_webhook_event_system (service role, closed actor set as 04-03a)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION public.enqueue_webhook_event_system(
    p_system_actor TEXT,
    p_event_type TEXT,
    p_subject_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_subject RECORD;
BEGIN
    IF auth.uid() IS NOT NULL OR p_system_actor IS NULL OR p_system_actor NOT IN (
        'system:messaging_webhook', 'system:patient_self_service_reschedule', 'system:api_v1', 'system:jobs'
    ) THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- No ping on the system path (it is a clinic owner's/admin's action).
    IF p_event_type IS NULL OR p_event_type NOT IN (
        'appointment.rescheduled', 'appointment.cancelled', 'visit.completed', 'prescription.issued', 'lab_result.ready'
    ) THEN
        RAISE EXCEPTION 'EVENT_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_subject FROM private.webhook_event_subject(p_event_type, p_subject_id);
    IF v_subject.o_tenant IS NULL THEN
        RAISE EXCEPTION 'SUBJECT_MISMATCH' USING ERRCODE = 'P0002';
    END IF;
    IF NOT v_subject.o_state_ok THEN
        RAISE EXCEPTION 'EVENT_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;

    RETURN private.enqueue_webhook_internal(v_subject.o_tenant, p_event_type, v_subject.o_data, v_subject.o_event_key, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_webhook_event_system(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_webhook_event_system(TEXT, TEXT, UUID) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. A dead webhook.deliver job fails its open delivery row
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION ops.webhook_job_dead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_delivery_id UUID;
BEGIN
    BEGIN
        v_delivery_id := (NEW.payload ->> 'delivery_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RETURN NULL;
    END;
    IF v_delivery_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE public.webhook_delivery_queue q
       SET status = 'failed',
           last_error = left('job_dead:' || coalesce(NEW.last_error, ''), 200),
           updated_at = now()
     WHERE q.id = v_delivery_id
       AND (q.status IN ('pending', 'processing') OR (q.status = 'failed' AND q.last_error = 'outcome_unknown'));
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION ops.webhook_job_dead() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER jobs_webhook_dead
    AFTER UPDATE OF status ON ops.jobs
    FOR EACH ROW
    WHEN (NEW.status = 'dead' AND OLD.status IS DISTINCT FROM 'dead' AND NEW.kind = 'webhook.deliver')
    EXECUTE FUNCTION ops.webhook_job_dead();

-- ---------------------------------------------------------------------------------------------------------------------
-- 9. Delivery-row reaper (R-7) now covers webhook rows: a row stuck in `processing` (the handler crashed after the
--    claim) becomes failed / outcome_unknown, which the claim accepts again (at-least-once). Body otherwise as 000035.
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.reap_delivery_rows()
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_count INTEGER := 0;
    v_row RECORD;
BEGIN
    -- 240 s = 2 × the runner lease (120 s): a live sender (handler bound 12 s / 8 s) never holds a row this long.
    FOR v_row IN
        UPDATE public.communication_queue q
           SET status = 'failed',
               error_message = 'outcome_unknown',
               next_retry_at = now(),
               updated_at = now()
         WHERE q.status = 'processing'
           AND q.updated_at < now() - INTERVAL '240 seconds'
        RETURNING q.id, q.tenant_id, q.max_retries
    LOOP
        v_count := v_count + 1;
        -- Rows written before 000035 have no job yet; for every other row this returns the existing one.
        PERFORM ops.enqueue_job(
            'message.send', v_row.tenant_id, jsonb_build_object('queue_id', v_row.id), 'msg:' || v_row.id::text,
            now(), least(greatest(v_row.max_retries, 0), 18) + 2
        );
    END LOOP;

    FOR v_row IN
        UPDATE public.webhook_delivery_queue w
           SET status = 'failed',
               last_error = 'outcome_unknown',
               next_retry_at = now(),
               updated_at = now()
         WHERE w.status = 'processing'
           AND w.updated_at < now() - INTERVAL '240 seconds'
        RETURNING w.id, w.tenant_id, w.max_retries
    LOOP
        v_count := v_count + 1;
        PERFORM ops.enqueue_job(
            'webhook.deliver', v_row.tenant_id, jsonb_build_object('delivery_id', v_row.id), 'wh:' || v_row.id::text,
            now(), least(greatest(v_row.max_retries, 1), 5) + 2
        );
    END LOOP;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION ops.reap_delivery_rows() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 10. Contract: members no longer write webhook_delivery_queue (M-XTENANT-WH; T-04-06, T-04-25)
-- ---------------------------------------------------------------------------------------------------------------------

DROP POLICY IF EXISTS "webhook_queue_owner_admin" ON public.webhook_delivery_queue;
CREATE POLICY "webhook_queue_select_owner_admin"
ON public.webhook_delivery_queue
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.tenant_id = webhook_delivery_queue.tenant_id
          AND memberships.user_id = auth.uid()
          AND memberships.role IN ('owner', 'admin')
    )
);

REVOKE ALL ON TABLE public.webhook_delivery_queue FROM anon, authenticated;
GRANT SELECT ON TABLE public.webhook_delivery_queue TO authenticated;

DO $$
DECLARE
    v_col RECORD;
BEGIN
    -- Column-level grants survive a table-level REVOKE.
    FOR v_col IN
        SELECT DISTINCT g.column_name, g.privilege_type, g.grantee
          FROM information_schema.column_privileges g
         WHERE g.table_schema = 'public'
           AND g.table_name = 'webhook_delivery_queue'
           AND g.grantee IN ('anon', 'authenticated')
           AND g.privilege_type IN ('INSERT', 'UPDATE', 'REFERENCES')
    LOOP
        EXECUTE format(
            'REVOKE %s (%I) ON TABLE public.webhook_delivery_queue FROM %I',
            v_col.privilege_type, v_col.column_name, v_col.grantee
        );
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 11. Open rows written before this migration get their job (idempotent: the job dedupe key). The cron route that
--     used to retry them is deleted with this plan.
-- ---------------------------------------------------------------------------------------------------------------------

SELECT count(ops.enqueue_job(
    'webhook.deliver', w.tenant_id, jsonb_build_object('delivery_id', w.id), 'wh:' || w.id::text,
    w.next_retry_at, least(greatest(w.max_retries, 1), 5) + 2
))
  FROM public.webhook_delivery_queue w
 WHERE w.status = 'pending';
