-- Migration: 000035_message_enqueue.sql
-- V2-04 plan 04-03a (P0-12, ADR-0005 D3 + proposed A2; rulings R-6 revised, R-7, R-20, R-23, R-24, R-44).
--
-- Patient messages leave the request path. A request only enqueues; the job runner sends.
--
--   public.enqueue_message (authenticated)          tenant from the subject row; it must equal p_tenant_id (the
--   public.enqueue_message_system (service_role)    caller's session-derived active tenant) and be a membership
--        -> private.enqueue_message_internal         definer writer in the non-exposed `private` schema (R-44):
--                                                    template allow-list, recipient = the patient's or guardian's
--                                                    number (R-24), params <= 4 KB, delivery dedupe key
--        -> communication_queue INSERT
--        -> AFTER INSERT trigger                     ops.enqueue_job('message.send', tenant, {queue_id},
--                                                    'msg:' || id, next_retry_at, max_retries + 2) (R-23)
--   handler message.send (lib/jobs/internal)        communication_queue_claim -> provider -> finish | dead_letter
--   ops.jobs AFTER UPDATE (dead, message.send)      delivery row -> dead_letter + one "Message Delivery Failed" note
--   ops.reap_delivery_rows() (pg_cron each minute)  rows stuck in `processing` > 240 s -> failed / outcome_unknown (R-7)
--
-- Contract for communication_queue (pulled forward from 04-03c's 000037 by the orchestrator's 04-03a done list):
-- members lose every INSERT privilege (the column grants of 000024 and the insert policy) and EXECUTE on
-- communication_queue_claim / communication_queue_finish; they keep SELECT on the status columns (the communication
-- log). Only the definer writers, triggers and the service role write the table. webhook_delivery_queue is 04-03b/c.
--
-- Open rows written before this migration get their job here (idempotent through the job dedupe key).
-- Raised reasons (lib/db/errors.ts RPC_REASON_CODES): SUBJECT_MISMATCH (P0002 -> NOT_FOUND; P0001 -> NOT_FOUND),
-- TEMPLATE_NOT_ALLOWED and RECIPIENT_NOT_ALLOWED (P0001 -> VALIDATION_FAILED), INPUT_INVALID, ACTOR_INVALID.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. communication_queue: delivery dedupe key
-- ---------------------------------------------------------------------------------------------------------------------

ALTER TABLE public.communication_queue
    ADD COLUMN IF NOT EXISTS dedupe_key TEXT
        CONSTRAINT communication_queue_dedupe_key_length CHECK (char_length(dedupe_key) BETWEEN 1 AND 200);

CREATE UNIQUE INDEX IF NOT EXISTS communication_queue_tenant_dedupe_key
    ON public.communication_queue (tenant_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Template allow-list (R-24). Seeded from the code at 04-03a; V2-12 extends it by migration.
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE ops.message_templates (
    template_id TEXT PRIMARY KEY CHECK (template_id ~ '^[a-z][a-z0-9_]{0,99}$'),
    channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'in_app')),
    unmatched_ok BOOLEAN NOT NULL DEFAULT false
);

COMMENT ON TABLE ops.message_templates IS
    'V2-04 04-03a (R-24): templates a queued message may use, per channel. unmatched_ok: may be sent to a sender no '
    'patient matches (04-03c bot reply). Read only by the definer writers.';

ALTER TABLE ops.message_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ops.message_templates FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO ops.message_templates (template_id, channel, unmatched_ok) VALUES
    -- features/*: lifecycle and share messages
    ('appointment_booked', 'whatsapp', false),
    ('appointment_rescheduled', 'whatsapp', false),
    ('appointment_cancelled', 'whatsapp', false),
    ('prescription_ready', 'whatsapp', false),
    ('lab_report_uploaded', 'whatsapp', false),
    ('referral_letter_issued', 'whatsapp', false),
    ('receipt_issued', 'whatsapp', false),
    ('consultation_documents', 'whatsapp', false),
    -- SMS fallback of the two lifecycle messages (message.send handler, D-09)
    ('appointment_booked_sms_fallback', 'sms', false),
    ('appointment_rescheduled_sms_fallback', 'sms', false),
    -- the five bot replies of app/api/webhooks/messaging/[provider]/route.ts (queued from 04-03c)
    ('appointment_confirmed_ack', 'whatsapp', false),
    ('appointment_cancelled_ack', 'whatsapp', false),
    ('appointment_reschedule_link', 'whatsapp', false),
    ('conversational_triage', 'whatsapp', false),
    ('bot_not_found', 'whatsapp', true)
ON CONFLICT (template_id) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------------------------------------------------

-- The 10-digit national number of an Indian mobile in any of the forms toIndianMobileE164 accepts (+91…, 91…, 0…, bare
-- ten digits, spaces or dashes), or NULL. Used only to compare a recipient with the patient's stored number.
CREATE FUNCTION private.indian_mobile_national(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN d ~ '^91[6-9][0-9]{9}$' THEN substr(d, 3)
        WHEN d ~ '^0[6-9][0-9]{9}$' THEN substr(d, 2)
        WHEN d ~ '^[6-9][0-9]{9}$' THEN d
        ELSE NULL
    END
    FROM (SELECT regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') AS d) s;
$$;

REVOKE ALL ON FUNCTION private.indian_mobile_national(TEXT) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. The writer (R-44): SECURITY DEFINER in `private`, no API role may execute it.
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION private.enqueue_message_internal(
    p_tenant_id UUID,
    p_patient_id UUID,
    p_visit_id UUID,
    p_channel TEXT,
    p_message_type TEXT,
    p_template_id TEXT,
    p_template_params JSONB,
    p_recipient_phone TEXT,
    p_recipient_user_id UUID,
    p_metadata JSONB,
    p_run_at TIMESTAMPTZ,
    p_dedupe_key TEXT,
    p_created_by UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_patient RECORD;
    v_recipient TEXT := NULLIF(btrim(p_recipient_phone), '');
    v_national TEXT;
    v_params JSONB := coalesce(p_template_params, '{}'::jsonb);
    v_metadata JSONB := coalesce(p_metadata, '{}'::jsonb);
    v_id UUID;
    v_status TEXT;
BEGIN
    IF p_tenant_id IS NULL OR p_patient_id IS NULL
        OR p_channel IS NULL OR p_channel NOT IN ('whatsapp', 'sms', 'in_app')
        OR p_message_type IS NULL OR p_message_type !~ '^[a-z][a-z0-9_]{0,63}$'
        OR jsonb_typeof(v_params) <> 'object' OR octet_length(v_params::text) > 4096
        OR jsonb_typeof(v_metadata) <> 'object' OR octet_length(v_metadata::text) > 4096
        OR (p_dedupe_key IS NOT NULL AND char_length(p_dedupe_key) NOT BETWEEN 1 AND 200) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM ops.message_templates t WHERE t.template_id = p_template_id AND t.channel = p_channel
    ) THEN
        RAISE EXCEPTION 'TEMPLATE_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;

    SELECT p.phone, p.guardian_phone INTO v_patient
      FROM public.patients p
     WHERE p.id = p_patient_id AND p.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SUBJECT_MISMATCH' USING ERRCODE = 'P0002';
    END IF;

    -- R-24: a phone message goes only to the patient's own number or the guardian's; no free-form numbers.
    IF p_channel IN ('whatsapp', 'sms') THEN
        v_recipient := coalesce(v_recipient, NULLIF(btrim(v_patient.phone), ''));
        v_national := private.indian_mobile_national(v_recipient);
        IF v_national IS NULL OR v_national IS DISTINCT FROM private.indian_mobile_national(v_patient.phone)
            AND v_national IS DISTINCT FROM private.indian_mobile_national(v_patient.guardian_phone) THEN
            RAISE EXCEPTION 'RECIPIENT_NOT_ALLOWED' USING ERRCODE = 'P0001';
        END IF;
    ELSIF v_recipient IS NOT NULL THEN
        RAISE EXCEPTION 'RECIPIENT_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;

    -- An in-app recipient must belong to the subject's clinic.
    IF p_recipient_user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.memberships m WHERE m.user_id = p_recipient_user_id AND m.tenant_id = p_tenant_id
    ) THEN
        RAISE EXCEPTION 'RECIPIENT_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.communication_queue (
        tenant_id, patient_id, appointment_id, channel, message_type, template_id, template_params,
        recipient_phone, recipient_user_id, max_retries, next_retry_at, metadata, created_by, dedupe_key
    )
    VALUES (
        p_tenant_id, p_patient_id, p_visit_id, p_channel, p_message_type, p_template_id, v_params,
        v_recipient, p_recipient_user_id, 3, greatest(coalesce(p_run_at, now()), now()), v_metadata, p_created_by,
        p_dedupe_key
    )
    ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING id, status INTO v_id, v_status;

    IF v_id IS NOT NULL THEN
        RETURN jsonb_build_object('id', v_id, 'status', v_status, 'deduped', false);
    END IF;

    SELECT q.id, q.status INTO v_id, v_status
      FROM public.communication_queue q
     WHERE q.tenant_id = p_tenant_id AND q.dedupe_key = p_dedupe_key;
    RETURN jsonb_build_object('id', v_id, 'status', v_status, 'deduped', true);
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_message_internal(
    UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, UUID, JSONB, TIMESTAMPTZ, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.enqueue_message_internal(
    UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, UUID, JSONB, TIMESTAMPTZ, TEXT, UUID
) IS
    'V2-04 04-03a (R-44): the only writer of communication_queue rows for request and system paths. Callers resolve '
    'the tenant from the subject first. Returns {id, status, deduped}.';

-- Reads the subject rows of a message as definer: the visit's tenant and patient, and the patient's tenant (NULL when a
-- given id does not exist). Raises nothing but INPUT_INVALID (no subject at all): the callers decide, in an order that
-- never tells a caller whether a row of another clinic exists.
CREATE FUNCTION private.message_subject(
    p_patient_id UUID,
    p_visit_id UUID,
    OUT visit_tenant UUID,
    OUT visit_patient UUID,
    OUT patient_tenant UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_visit_id IS NULL AND p_patient_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_visit_id IS NOT NULL THEN
        SELECT v.tenant_id, v.patient_id INTO visit_tenant, visit_patient FROM public.visits v WHERE v.id = p_visit_id;
    END IF;
    IF p_patient_id IS NOT NULL THEN
        SELECT p.tenant_id INTO patient_tenant FROM public.patients p WHERE p.id = p_patient_id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.message_subject(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Request path: public.enqueue_message (R-6 revised; 03-07 D1 finding 2)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION public.enqueue_message(
    p_tenant_id UUID,
    p_patient_id UUID,
    p_visit_id UUID,
    p_channel TEXT,
    p_message_type TEXT,
    p_template_id TEXT,
    p_template_params JSONB,
    p_recipient_phone TEXT,
    p_recipient_user_id UUID,
    p_metadata JSONB,
    p_run_at TIMESTAMPTZ DEFAULT now(),
    p_dedupe_key TEXT DEFAULT NULL
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
    v_patient_id UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_subject FROM private.message_subject(p_patient_id, p_visit_id);

    -- Every given subject row must exist in the caller's active tenant (p_tenant_id = ServiceContext.tenantId,
    -- session-derived) AND that tenant must be one of the caller's memberships. p_tenant_id only narrows: the row's
    -- tenant always comes from the subject. A member of clinics A and B working in A cannot enqueue for B's patient.
    -- Missing, foreign and other-clinic subjects all read the same (P0002): existence is never revealed.
    IF p_tenant_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.current_user_tenant_ids() t WHERE t = p_tenant_id)
        OR (p_visit_id IS NOT NULL AND v_subject.visit_tenant IS DISTINCT FROM p_tenant_id)
        OR (p_patient_id IS NOT NULL AND v_subject.patient_tenant IS DISTINCT FROM p_tenant_id) THEN
        RAISE EXCEPTION 'SUBJECT_MISMATCH' USING ERRCODE = 'P0002';
    END IF;
    -- Both rows are the caller's: a patient that is not the visit's patient is a mismatch the caller may be told.
    IF p_visit_id IS NOT NULL AND p_patient_id IS NOT NULL AND v_subject.visit_patient IS DISTINCT FROM p_patient_id THEN
        RAISE EXCEPTION 'SUBJECT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    v_patient_id := coalesce(p_patient_id, v_subject.visit_patient);

    RETURN private.enqueue_message_internal(
        p_tenant_id, v_patient_id, p_visit_id, p_channel, p_message_type, p_template_id,
        p_template_params, p_recipient_phone, p_recipient_user_id,
        coalesce(p_metadata, '{}'::jsonb) - 'system_actor', p_run_at, p_dedupe_key, v_uid
    );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_message(
    UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, UUID, JSONB, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_message(
    UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, UUID, JSONB, TIMESTAMPTZ, TEXT
) TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. System path: public.enqueue_message_system (service role, closed actor set)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION public.enqueue_message_system(
    p_system_actor TEXT,
    p_patient_id UUID,
    p_visit_id UUID,
    p_channel TEXT,
    p_message_type TEXT,
    p_template_id TEXT,
    p_template_params JSONB,
    p_recipient_phone TEXT,
    p_recipient_user_id UUID,
    p_metadata JSONB,
    p_run_at TIMESTAMPTZ DEFAULT now(),
    p_dedupe_key TEXT DEFAULT NULL
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

    SELECT * INTO v_subject FROM private.message_subject(p_patient_id, p_visit_id);
    IF (p_visit_id IS NOT NULL AND v_subject.visit_tenant IS NULL)
        OR (p_patient_id IS NOT NULL AND v_subject.patient_tenant IS NULL) THEN
        RAISE EXCEPTION 'SUBJECT_MISMATCH' USING ERRCODE = 'P0002';
    END IF;
    IF p_visit_id IS NOT NULL AND p_patient_id IS NOT NULL
        AND (v_subject.visit_tenant IS DISTINCT FROM v_subject.patient_tenant
             OR v_subject.visit_patient IS DISTINCT FROM p_patient_id) THEN
        RAISE EXCEPTION 'SUBJECT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

    RETURN private.enqueue_message_internal(
        coalesce(v_subject.visit_tenant, v_subject.patient_tenant), coalesce(p_patient_id, v_subject.visit_patient),
        p_visit_id, p_channel, p_message_type, p_template_id,
        p_template_params, p_recipient_phone, p_recipient_user_id,
        coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('system_actor', p_system_actor),
        p_run_at, p_dedupe_key, NULL
    );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_message_system(
    TEXT, UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, UUID, JSONB, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_message_system(
    TEXT, UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, UUID, JSONB, TIMESTAMPTZ, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. One message.send job per delivery row (R-23)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION ops.communication_queue_enqueue_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status = 'pending' THEN
        PERFORM ops.enqueue_job(
            'message.send',
            NEW.tenant_id,
            jsonb_build_object('queue_id', NEW.id),
            'msg:' || NEW.id::text,
            NEW.next_retry_at,
            least(greatest(NEW.max_retries, 0), 18) + 2
        );
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION ops.communication_queue_enqueue_job() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER communication_queue_enqueue_job
    AFTER INSERT ON public.communication_queue
    FOR EACH ROW EXECUTE FUNCTION ops.communication_queue_enqueue_job();

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. Non-retryable outcomes (R-20; 03-01 handover): disabled provider, synthetic recipient, MSG91 4xx
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION public.communication_queue_dead_letter(p_id UUID, p_error_code TEXT)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
BEGIN
    UPDATE public.communication_queue q
       SET status = 'dead_letter',
           error_message = ops.job_error_code(p_error_code),
           updated_at = now()
     WHERE q.id = p_id
       AND q.status IN ('pending', 'processing', 'failed');
END;
$$;

REVOKE ALL ON FUNCTION public.communication_queue_dead_letter(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.communication_queue_dead_letter(UUID, TEXT) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 9. A dead message.send job dead-letters its delivery row and tells the clinic once
-- ---------------------------------------------------------------------------------------------------------------------

CREATE FUNCTION ops.message_job_dead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_queue_id UUID;
    v_row RECORD;
BEGIN
    BEGIN
        v_queue_id := (NEW.payload ->> 'queue_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RETURN NULL;
    END;
    IF v_queue_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE public.communication_queue q
       SET status = 'dead_letter',
           error_message = left('job_dead:' || coalesce(NEW.last_error, ''), 500),
           updated_at = now()
     WHERE q.id = v_queue_id
       AND q.status IN ('pending', 'processing', 'failed');

    SELECT q.id, q.tenant_id, q.channel, q.message_type, q.error_message, q.status INTO v_row
      FROM public.communication_queue q
     WHERE q.id = v_queue_id;
    IF NOT FOUND OR v_row.status <> 'dead_letter' THEN
        RETURN NULL;
    END IF;

    -- Event #23 In-App Outbox Failure Alert (copy and metadata as the 04-02 dispatcher; never the recipient phone).
    IF NOT EXISTS (
        SELECT 1 FROM public.in_app_notifications n
         WHERE n.tenant_id = v_row.tenant_id
           AND n.event_type = 'delivery_failure_alert'
           AND n.metadata ->> 'queue_id' = v_row.id::text
    ) THEN
        INSERT INTO public.in_app_notifications (
            tenant_id, recipient_role, category, event_type, title, message, is_read, metadata
        ) VALUES (
            v_row.tenant_id, 'admin', 'system', 'delivery_failure_alert', 'Message Delivery Failed',
            'A ' || v_row.channel || ' message (' || v_row.message_type || ') failed permanently: '
                || coalesce(v_row.error_message, 'Unknown error'),
            false,
            jsonb_build_object('queue_id', v_row.id, 'channel', v_row.channel, 'message_type', v_row.message_type)
        );
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION ops.message_job_dead() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER jobs_message_dead
    AFTER UPDATE OF status ON ops.jobs
    FOR EACH ROW
    WHEN (NEW.status = 'dead' AND OLD.status IS DISTINCT FROM 'dead' AND NEW.kind = 'message.send')
    EXECUTE FUNCTION ops.message_job_dead();

-- ---------------------------------------------------------------------------------------------------------------------
-- 10. Delivery-row reaper (R-7): a row stuck in `processing` (the sender crashed after the claim) is retried
-- ---------------------------------------------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_comm_queue_processing_updated
    ON public.communication_queue (updated_at)
    WHERE status = 'processing';

CREATE FUNCTION ops.reap_delivery_rows()
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
    -- 240 s = 2 × the runner lease (120 s): a live sender (handler bound 12 s) never holds a row this long.
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
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION ops.reap_delivery_rows() FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule('delivery-reap', '* * * * *', 'select ops.reap_delivery_rows()');

-- ---------------------------------------------------------------------------------------------------------------------
-- 11. Contract: members no longer write communication_queue or drive its dispatch
-- ---------------------------------------------------------------------------------------------------------------------

DROP POLICY IF EXISTS "communication_queue_insert_member" ON public.communication_queue;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.communication_queue FROM anon, authenticated;

DO $$
DECLARE
    v_col RECORD;
BEGIN
    -- Column-level INSERT/UPDATE/REFERENCES grants (000024 granted INSERT on 12 columns) survive a table-level REVOKE.
    FOR v_col IN
        SELECT DISTINCT a.attname, g.privilege_type, g.grantee
          FROM information_schema.column_privileges g
          JOIN pg_catalog.pg_attribute a
            ON a.attrelid = 'public.communication_queue'::regclass AND a.attname = g.column_name
         WHERE g.table_schema = 'public'
           AND g.table_name = 'communication_queue'
           AND g.grantee IN ('anon', 'authenticated')
           AND g.privilege_type IN ('INSERT', 'UPDATE', 'REFERENCES')
    LOOP
        EXECUTE format(
            'REVOKE %s (%I) ON TABLE public.communication_queue FROM %I',
            v_col.privilege_type, v_col.attname, v_col.grantee
        );
    END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.communication_queue_claim(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.communication_queue_finish(UUID, BOOLEAN, TEXT, TEXT) FROM authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 12. Open rows written before this migration get their job (idempotent: the job dedupe key)
-- ---------------------------------------------------------------------------------------------------------------------

SELECT count(ops.enqueue_job(
    'message.send', q.tenant_id, jsonb_build_object('queue_id', q.id), 'msg:' || q.id::text,
    q.next_retry_at, least(greatest(q.max_retries, 0), 18) + 2
))
  FROM public.communication_queue q
 WHERE q.status IN ('pending', 'failed');
