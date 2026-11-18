-- Migration: 000041_messaging_review_fixes.sql
-- V2-04 plan 04-07a (review triage 04-07-REVIEW-TRIAGE.md: H-SMS, M-ROLE, M-DEDUPE, M-REPLAY, M-RXEVENT and the
-- 04-07a Lows "lab_result.ready validates the document" and "early delivery report kept"). Rulings R-6, R-24, R-44.
--
--   1. ops.message_templates gains `params` (the only template_params keys a row of that template may carry) and
--      `request_roles` (the roles that may queue it from a request; empty = system only). H-SMS / M-ROLE.
--   2. private.enqueue_message_internal: template_params keys must be declared by the template, values are a string,
--      number or null of at most 1 024 characters (H-SMS: no `mobiles` / `template_id` / `sender` / `short_url` can ride along).
--   3. public.enqueue_message (request path): the template must be request-callable and the caller must hold one of its
--      roles (42501 FORBIDDEN; the role sets mirror lib/permissions per call site, checked by
--      tests/messaging/request-template-roles-db.spec.ts); message_type = template_id; values at most 256 characters;
--      metadata allow-listed (ids of the subject rows and up to three buttons; `visit_id` must be the visit); run_at at
--      most 90 days ahead; a caller's dedupe key is stored as `member:<uid>:<key>` (M-DEDUPE), so it can never be a
--      system key. public.enqueue_message_system refuses a key in that namespace.
--   4. ops.replay_job refuses a message.send whose row was redacted (`[redacted]` in template_params or metadata): it
--      would reach the patient with a broken link (M-REPLAY). The runbook answer is "share again from the app".
--   5. private.webhook_event_subject: `prescription.issued` only for an active prescription that is signed (or, on the
--      API path, has items), keyed per prescription and state; the request path requires the signed state, so the empty
--      draft no longer queues it and the sign-time event is the one integrators receive (M-RXEVENT). `lab_result.ready`
--      requires the document's patient (and visit, when set) to belong to the document's clinic and to each other.
--   6. A delivery report that arrives before `communication_queue_finish` wrote the provider id is kept in
--      ops.early_delivery_reports (id, status, time, reason code; no phone) and applied when the id is written
--      (trigger), instead of being recorded as handled and lost. Unclaimed reports are purged after 1 day.
--
-- Raised reasons (lib/db/errors.ts RPC_REASON_CODES): INPUT_INVALID, TEMPLATE_NOT_ALLOWED, FORBIDDEN (42501),
-- EVENT_NOT_ALLOWED, JOB_NOT_REPLAYABLE (all existing).

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Template parameter allow-list and request roles
-- ---------------------------------------------------------------------------------------------------------------------

ALTER TABLE ops.message_templates
    ADD COLUMN params TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    ADD COLUMN request_roles TEXT[] NOT NULL DEFAULT '{}'::TEXT[]
        CONSTRAINT message_templates_request_roles_known
        CHECK (request_roles <@ ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']::TEXT[]);

COMMENT ON COLUMN ops.message_templates.params IS
    'V2-04 04-07a (H-SMS): the only template_params keys a queued row of this template may carry (the call sites'' '
    'names and the positional names of lib/messaging/templates/mapping.ts). Any other key is INPUT_INVALID.';
COMMENT ON COLUMN ops.message_templates.request_roles IS
    'V2-04 04-07a (M-ROLE): roles that may queue this template through public.enqueue_message (the roles holding the '
    'call site''s permission in lib/permissions/matrix.ts). Empty: system path only (lifecycle follow-ups, SMS '
    'fallbacks, bot replies).';

-- Parameter sets. An SMS fallback carries a copy of its WhatsApp row's params (message.send handler), so its set equals
-- the WhatsApp template's.
UPDATE ops.message_templates t
   SET params = s.params, request_roles = s.roles
  FROM (VALUES
        ('appointment_booked',
            ARRAY['patient_name', 'doctor_name', 'clinic_name', 'appointment_time', 'date_time'],
            ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']),                -- appointments:edit
        ('appointment_rescheduled',
            ARRAY['patient_name', 'doctor_name', 'clinic_name', 'new_appointment_time', 'new_date_time'],
            ARRAY[]::TEXT[]),
        ('appointment_cancelled',
            ARRAY['patient_name', 'clinic_name', 'cancellation_reason', 'reason'],
            ARRAY[]::TEXT[]),
        ('prescription_ready',
            ARRAY['patient_name', 'doctor_name', 'clinic_name', 'document_url'],
            ARRAY['owner', 'doctor', 'nurse']),                                         -- consultations:view
        ('lab_report_uploaded',
            ARRAY['patient_name', 'clinic_name', 'test_name', 'document_title', 'document_url'],
            ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']),                -- patients:view
        ('referral_letter_issued',
            ARRAY['patient_name', 'doctor_name', 'clinic_name', 'referred_to_name', 'specialist_name', 'document_url'],
            ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']),                -- patients:view
        ('receipt_issued',
            ARRAY['patient_name', 'clinic_name', 'invoice_number', 'amount', 'amount_inr', 'document_url'],
            ARRAY['owner', 'admin']),                                                   -- billing:view
        ('consultation_documents',
            ARRAY['patient_name', 'doctor_name', 'clinic_name', 'amount', 'amount_inr', 'invoice_number',
                  'prescription_url', 'receipt_url'],
            ARRAY['owner', 'doctor', 'nurse']),                                         -- consultations:view
        ('appointment_booked_sms_fallback',
            ARRAY['patient_name', 'doctor_name', 'clinic_name', 'appointment_time', 'date_time'],
            ARRAY[]::TEXT[]),
        ('appointment_rescheduled_sms_fallback',
            ARRAY['patient_name', 'doctor_name', 'clinic_name', 'new_appointment_time', 'new_date_time'],
            ARRAY[]::TEXT[]),
        ('appointment_confirmed_ack', ARRAY['patient_name', 'message'], ARRAY[]::TEXT[]),
        ('appointment_cancelled_ack', ARRAY['patient_name', 'message'], ARRAY[]::TEXT[]),
        ('appointment_reschedule_link', ARRAY['patient_name', 'message'], ARRAY[]::TEXT[]),
        ('conversational_triage', ARRAY['patient_name', 'message'], ARRAY[]::TEXT[]),
        ('bot_not_found', ARRAY[]::TEXT[], ARRAY[]::TEXT[])
       ) AS s(template_id, params, roles)
 WHERE t.template_id = s.template_id;

DO $$
BEGIN
    -- Every seeded template got its sets (a template added later without them is system-only with no params).
    IF EXISTS (SELECT 1 FROM ops.message_templates t WHERE cardinality(t.params) = 0 AND t.template_id <> 'bot_not_found') THEN
        RAISE EXCEPTION '000041: a message template has no parameter set';
    END IF;
END;
$$;

-- True when every key of p_params is declared and every value is a string or a number of at most p_max characters (or
-- null, as before: the sender prints it).
CREATE FUNCTION private.message_params_ok(p_params JSONB, p_allowed TEXT[], p_max INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT jsonb_typeof(p_params) = 'object'
       AND NOT EXISTS (
            SELECT 1
              FROM jsonb_each(p_params) e
             WHERE NOT (e.key = ANY (coalesce(p_allowed, '{}'::TEXT[])))
                OR jsonb_typeof(e.value) NOT IN ('string', 'number', 'null')
                OR char_length(e.value #>> '{}') > p_max
       );
$$;

REVOKE ALL ON FUNCTION private.message_params_ok(JSONB, TEXT[], INTEGER) FROM PUBLIC, anon, authenticated, service_role;

-- Request-path metadata (M-ROLE, review B L-2): only the ids of the rows the message is about and up to three buttons.
-- `visit_id` must be the message's visit (the inbound route no longer reads metadata for correlation either).
CREATE FUNCTION private.request_message_metadata_ok(p_metadata JSONB, p_visit_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_entry RECORD;
    v_button JSONB;
    v_field RECORD;
BEGIN
    IF p_metadata IS NULL THEN
        RETURN true;
    END IF;
    IF jsonb_typeof(p_metadata) <> 'object' OR octet_length(p_metadata::text) > 2048 THEN
        RETURN false;
    END IF;
    FOR v_entry IN SELECT e.key, e.value FROM jsonb_each(p_metadata) e LOOP
        IF v_entry.key IN ('document_id', 'referral_id', 'prescription_id', 'invoice_id', 'visit_id') THEN
            CONTINUE WHEN jsonb_typeof(v_entry.value) = 'null';
            IF jsonb_typeof(v_entry.value) <> 'string'
                OR (v_entry.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                RETURN false;
            END IF;
            IF v_entry.key = 'visit_id' AND (v_entry.value #>> '{}')::uuid IS DISTINCT FROM p_visit_id THEN
                RETURN false;
            END IF;
        ELSIF v_entry.key = 'buttons' THEN
            IF jsonb_typeof(v_entry.value) <> 'array' OR jsonb_array_length(v_entry.value) > 3 THEN
                RETURN false;
            END IF;
            FOR v_button IN SELECT b.value FROM jsonb_array_elements(v_entry.value) b LOOP
                IF jsonb_typeof(v_button) <> 'object' THEN
                    RETURN false;
                END IF;
                FOR v_field IN SELECT f.key, f.value FROM jsonb_each(v_button) f LOOP
                    IF v_field.key NOT IN ('id', 'text', 'url') OR jsonb_typeof(v_field.value) <> 'string'
                        OR char_length(v_field.value #>> '{}') > 512 THEN
                        RETURN false;
                    END IF;
                END LOOP;
            END LOOP;
        ELSE
            RETURN false;
        END IF;
    END LOOP;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.request_message_metadata_ok(JSONB, UUID) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. The writer: parameter allow-list for both paths (H-SMS)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.enqueue_message_internal(
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
    v_allowed TEXT[];
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

    SELECT t.params INTO v_allowed
      FROM ops.message_templates t
     WHERE t.template_id = p_template_id AND t.channel = p_channel;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TEMPLATE_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;

    -- 04-07a H-SMS: only the template's own variables. A key the provider reads as a control field (`mobiles`,
    -- `template_id`, `sender`, `short_url`, …) is never declared, so it cannot reach the provider from a queued row.
    IF NOT private.message_params_ok(v_params, v_allowed, 1024) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
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

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Request path: role per template, bounded inputs, namespaced dedupe key (M-ROLE, M-DEDUPE)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_message(
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
    v_template RECORD;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_subject FROM private.message_subject(p_patient_id, p_visit_id);

    -- Every given subject row must exist in the caller's active tenant (p_tenant_id = ServiceContext.tenantId,
    -- session-derived) AND that tenant must be one of the caller's memberships. Missing, foreign and other-clinic
    -- subjects all read the same (P0002): existence is never revealed. Checked before anything else about the call.
    IF p_tenant_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM public.current_user_tenant_ids() t WHERE t = p_tenant_id)
        OR (p_visit_id IS NOT NULL AND v_subject.visit_tenant IS DISTINCT FROM p_tenant_id)
        OR (p_patient_id IS NOT NULL AND v_subject.patient_tenant IS DISTINCT FROM p_tenant_id) THEN
        RAISE EXCEPTION 'SUBJECT_MISMATCH' USING ERRCODE = 'P0002';
    END IF;
    IF p_visit_id IS NOT NULL AND p_patient_id IS NOT NULL AND v_subject.visit_patient IS DISTINCT FROM p_patient_id THEN
        RAISE EXCEPTION 'SUBJECT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    v_patient_id := coalesce(p_patient_id, v_subject.visit_patient);

    -- 04-07a M-ROLE: only a request-callable template (lifecycle follow-ups, SMS fallbacks and bot replies are system
    -- only), and only by a role that holds the call site's permission in this clinic.
    SELECT t.params, t.request_roles INTO v_template
      FROM ops.message_templates t
     WHERE t.template_id = p_template_id AND t.channel = p_channel;
    IF NOT FOUND OR cardinality(v_template.request_roles) = 0 THEN
        RAISE EXCEPTION 'TEMPLATE_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END IF;
    IF NOT public.current_user_has_role(p_tenant_id, v_template.request_roles) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- Bounded caller input: the type is the template's, short values, allow-listed metadata, at most 90 days ahead, and
    -- room for the dedupe namespace.
    IF p_message_type IS DISTINCT FROM p_template_id
        OR NOT private.message_params_ok(coalesce(p_template_params, '{}'::jsonb), v_template.params, 256)
        OR NOT private.request_message_metadata_ok(p_metadata, p_visit_id)
        OR (p_run_at IS NOT NULL AND p_run_at > now() + INTERVAL '90 days')
        OR (p_dedupe_key IS NOT NULL AND char_length(p_dedupe_key) NOT BETWEEN 1 AND 150) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    RETURN private.enqueue_message_internal(
        p_tenant_id, v_patient_id, p_visit_id, p_channel, p_message_type, p_template_id,
        p_template_params, p_recipient_phone, p_recipient_user_id,
        coalesce(p_metadata, '{}'::jsonb), p_run_at,
        -- 04-07a M-DEDUPE: a caller's key lives in its own namespace; it can never pre-empt a system key
        -- (appointment_cancelled:<visit>, msg-fallback:<id>, bot:<key>:<template>) or another member's.
        CASE WHEN p_dedupe_key IS NULL THEN NULL ELSE 'member:' || v_uid::text || ':' || p_dedupe_key END,
        v_uid
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_message_system(
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
    -- 04-07a M-DEDUPE: the member namespace belongs to the request path.
    IF p_dedupe_key IS NOT NULL AND p_dedupe_key LIKE 'member:%' THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
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

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Replay refuses a redacted message (M-REPLAY)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.replay_job(p_id UUID)
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

    -- 04-07a M-REPLAY: a dead-lettered row had its share links and tokens replaced by "[redacted]" (000024 scrub
    -- trigger). Sending it again would give the patient a broken link: refuse; the clinic shares again from the app.
    IF v_job.kind = 'message.send' AND EXISTS (
        SELECT 1
          FROM public.communication_queue q
         WHERE q.id = (v_job.payload ->> 'queue_id')::uuid
           AND (jsonb_path_exists(coalesce(q.template_params, '{}'::jsonb), 'strict $.** ? (@ == "[redacted]")')
                OR jsonb_path_exists(coalesce(q.metadata, '{}'::jsonb), 'strict $.** ? (@ == "[redacted]")'))
    ) THEN
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
    'V2-04 04-03c (R-35), 04-07a (M-REPLAY): replays a dead job: pending, attempts 0, due now; a message.send / '
    'webhook.deliver delivery row goes back to pending with retry_count 0. Raises JOB_NOT_REPLAYABLE for a missing or '
    'non-dead job, for message.reply_unmatched (its phone is erased) and for a message.send whose row was redacted '
    '(a share link would arrive broken: share again from the app). postgres only.';

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Webhook events: prescription.issued at signing, lab_result.ready only for a consistent document
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.webhook_event_subject(
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
        -- 04-07a M-RXEVENT: an active prescription that is signed (the consultation was signed) or, on the API path, was
        -- created with its items. The empty draft is not issued. The key carries the state, so the sign-time event is
        -- never suppressed by an earlier unsigned one.
        SELECT p.tenant_id,
               jsonb_build_object('prescription_id', p.id, 'patient_id', p.patient_id, 'visit_id', p.visit_id),
               'prescription.issued:' || p.id::text || ':'
                   || CASE WHEN p.signed_at IS NOT NULL THEN 'signed' ELSE 'created' END,
               p.status = 'active'
                   AND (p.signed_at IS NOT NULL
                        OR EXISTS (SELECT 1 FROM public.prescription_items i WHERE i.prescription_id = p.id))
          INTO o_tenant, o_data, o_event_key, o_state_ok
          FROM public.prescriptions p WHERE p.id = p_subject_id;
    WHEN 'lab_result.ready' THEN
        -- 04-07a (review B L-3): the document's patient is of the document's clinic, and its visit (when set) is that
        -- patient's visit in that clinic.
        SELECT d.tenant_id,
               jsonb_build_object('document_id', d.id, 'patient_id', d.patient_id, 'title', d.title),
               'lab_result.ready:' || d.id::text,
               EXISTS (SELECT 1 FROM public.patients pt WHERE pt.id = d.patient_id AND pt.tenant_id = d.tenant_id)
                   AND (d.visit_id IS NULL OR EXISTS (
                        SELECT 1 FROM public.visits v
                         WHERE v.id = d.visit_id AND v.tenant_id = d.tenant_id AND v.patient_id = d.patient_id
                   ))
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

CREATE OR REPLACE FUNCTION public.enqueue_webhook_event(
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
    -- 04-07a M-RXEVENT: from a request, a prescription is issued when the consultation is signed.
    IF p_event_type = 'prescription.issued' AND NOT EXISTS (
        SELECT 1 FROM public.prescriptions p WHERE p.id = p_subject_id AND p.signed_at IS NOT NULL
    ) THEN
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

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Early delivery reports are kept, then applied when the provider id is written
-- ---------------------------------------------------------------------------------------------------------------------

CREATE TABLE ops.early_delivery_reports (
    external_message_id TEXT NOT NULL CHECK (char_length(external_message_id) BETWEEN 1 AND 200),
    status TEXT NOT NULL CHECK (status IN ('delivered', 'read', 'failed')),
    reported_at TIMESTAMPTZ,
    reason_code TEXT CHECK (char_length(reason_code) <= 64),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (external_message_id, status)
);

CREATE INDEX early_delivery_reports_received_at ON ops.early_delivery_reports (received_at);

COMMENT ON TABLE ops.early_delivery_reports IS
    'V2-04 04-07a (review IND L2): MSG91 delivery reports whose provider id no queue row carries yet (the report beat '
    'communication_queue_finish). Provider id, status, time and a reason code only (no phone). Applied and removed '
    'when a row gets that id; purged after 1 day by communication_queue_apply_dlr.';

ALTER TABLE ops.early_delivery_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ops.early_delivery_reports FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.communication_queue_apply_dlr(
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

    SELECT count(*) INTO v_matches
      FROM public.communication_queue q
     WHERE q.external_message_id = p_external_message_id;

    -- 04-07a: no row carries the id yet (the report beat the sender's finish write). Keep it; the row's trigger applies
    -- it once the id is written. Reports nobody claims within a day are dropped here.
    IF v_matches = 0 THEN
        DELETE FROM ops.early_delivery_reports e WHERE e.received_at < now() - INTERVAL '1 day';
        INSERT INTO ops.early_delivery_reports (external_message_id, status, reported_at, reason_code)
        VALUES (p_external_message_id, p_status, p_at, CASE WHEN p_status = 'failed' THEN v_reason END)
        ON CONFLICT (external_message_id, status) DO NOTHING;
        RETURN jsonb_build_object('queue_id', NULL, 'applied', false, 'kept', true);
    END IF;

    -- The provider's id names one message. Two rows with the same id are ambiguous: nothing is changed (as before).
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

COMMENT ON FUNCTION public.communication_queue_apply_dlr(TEXT, TEXT, TIMESTAMPTZ, TEXT) IS
    'V2-04 04-03c, 04-07a: applies an MSG91 delivery report (delivered | read | failed) to the one queue row with that '
    'provider id: monotonic (delivered never overwrites read; failed never overwrites delivered or read), status + audit '
    'row in one transaction, a repeat is applied=false. A report for an id no row carries yet is kept (kept=true) and '
    'applied when the id is written. Returns {queue_id, tenant_id, applied, new_status, message_type} (+ '
    'recipient_phone when applied, for the urgent-failure note). service_role only.';

CREATE FUNCTION ops.communication_queue_apply_early_dlr()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_report RECORD;
BEGIN
    -- In report order (delivered, read, failed): the monotonic rules of apply_dlr decide what each one changes.
    FOR v_report IN
        SELECT e.status, e.reported_at, e.reason_code
          FROM ops.early_delivery_reports e
         WHERE e.external_message_id = NEW.external_message_id
         ORDER BY CASE e.status WHEN 'delivered' THEN 1 WHEN 'read' THEN 2 ELSE 3 END
           FOR UPDATE
    LOOP
        PERFORM public.communication_queue_apply_dlr(
            NEW.external_message_id, v_report.status, v_report.reported_at, v_report.reason_code
        );
    END LOOP;
    DELETE FROM ops.early_delivery_reports e WHERE e.external_message_id = NEW.external_message_id;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION ops.communication_queue_apply_early_dlr() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER communication_queue_apply_early_dlr
    AFTER UPDATE OF external_message_id ON public.communication_queue
    FOR EACH ROW
    WHEN (NEW.external_message_id IS NOT NULL AND OLD.external_message_id IS DISTINCT FROM NEW.external_message_id)
    EXECUTE FUNCTION ops.communication_queue_apply_early_dlr();
