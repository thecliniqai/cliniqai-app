-- Migration: 000061_definer_active_tenant.sql
-- V2-05 plan 05-02c (P1-01; ruling R-42; threat T-05-39; V2-03 03-07 D1 finding 2; 05-01b and 05-02b wave notes).
--
-- The SECURITY DEFINER sweep: every definer function in `public` and `private` that authorises a signed-in user by
-- clinic stops trusting "any membership" (`current_user_tenant_ids()`, `current_user_has_role(...)`, a bare
-- `memberships` lookup of the row's clinic) and is bound to the session's ACTIVE clinic (`authz.active_tenant_id()`,
-- the bound `authz.*` helpers or `has_permission`). Before, a member of clinics A and B acting in A could mint share
-- links to B's documents, enqueue messages and webhook events for B, change roles in B, read B's queue-token counter
-- and search B's custom medicines by naming B's ids. Bodies are the current ones with only the tenant/role check
-- changed (each change is commented in place):
--
--   enqueue_message, enqueue_webhook_event   p_tenant_id must be the active clinic (its p_tenant_id contract stays);
--                                            the template role list is read there; the test ping needs clinic:manage
--   private.outbox_payment_recorded          a session's payment must be in the active clinic
--   create_share_token, revoke_share_token   the resource's / token's clinic must be the active clinic; the role list
--                                            (`share_type_roles`) follows the RLS keys of the resources since 05-02b
--                                            (prescription prescriptions:view, invoice billing:view or a doctor's own
--                                            visit, patient_document labs:view, referral consultations:view)
--   change_member_role                       the target's clinic must be the active clinic
--   referral_source_clinics                  consultations:view in the active clinic (the target register's rule)
--   generate_daily_queue_token               appointments:edit in the active clinic (05-08 replaces it)
--   search_medicines                         the active clinic (the doctor-id rule is unchanged)
--   communication_queue_claim / _finish      service_role only; their session branch is bound too
--   current_user_has_role,                   kept (signatures), bodies bound to the active clinic, so a forgotten
--   current_user_is_admin_or_owner           caller cannot fall back to "any membership"; no policy or function
--                                            calls them any more
--
-- Already bound: generate_tenant_invoice_number (05-02b), log_audit and record_payment (000060), the authz helpers and
-- has_permission (05-01b). Exempt, with the reason (pinned by supabase/tests/database/definer_functions.test.sql):
-- token-scoped anon functions (resolve_share_token, consume_reschedule_token, get_reschedule_context), the invitation
-- token (consume_invitation), clinic creation (create_clinic_with_owner), service_role-only and trigger functions,
-- the anon readiness probe and error ingest. `public.current_user_tenant_ids()` keeps its signature and meaning (the
-- member helper) with no remaining policy or function user.
-- Also: `get_tenant_table_rls_policies` (service_role, the RLS catalogue helper) gets `pg_temp` last on its pinned
-- search_path, so every definer function's search_path is '' or ends in pg_temp (definer_functions.test.sql).

-- Share links (05-01b wave note: "create_share_token still accepts any membership"). The resource's clinic must be the
-- session's ACTIVE clinic (before: any clinic the caller belonged to, so a dual member acting in A minted a link to
-- B's receipt). The role rule is `share_type_roles` (kept in sync with SHARE_LINK_PERMISSIONS), read in the active
-- clinic; an invoice link additionally needs billing:view, or a doctor's own visit (consultations:edit, R-7: the Sign &
-- Bill consolidated message), the rule the invoices table applies.
CREATE OR REPLACE FUNCTION public.share_type_roles(p_type TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_type
        WHEN 'prescription'     THEN ARRAY['owner', 'doctor']
        WHEN 'invoice'          THEN ARRAY['owner', 'admin', 'doctor', 'receptionist']
        WHEN 'patient_document' THEN ARRAY['owner', 'doctor', 'nurse']
        WHEN 'referral'         THEN ARRAY['owner', 'doctor', 'nurse']
        WHEN 'appointment'      THEN ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']
        ELSE ARRAY[]::TEXT[]
    END;
$$;

-- True when the caller may hold a link to invoice p_invoice of p_tenant: billing:view there, or consultations:edit
-- there and the invoice's visit is theirs. Invoker; called by the two definer functions below only.
CREATE FUNCTION private.share_invoice_allowed(p_tenant UUID, p_invoice UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT public.has_permission(p_tenant, 'billing:view')
        OR (
            public.has_permission(p_tenant, 'consultations:edit')
            AND EXISTS (
                SELECT 1
                  FROM public.invoices i
                  JOIN public.visits v ON v.tenant_id = i.tenant_id AND v.id = i.visit_id
                 WHERE i.tenant_id = p_tenant
                   AND i.id = p_invoice
                   AND v.doctor_id = auth.uid()
            )
        )
$$;
REVOKE ALL ON FUNCTION private.share_invoice_allowed(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_share_token(p_resource_type TEXT, p_resource_id UUID)
RETURNS TABLE (token TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_tenant UUID;
    v_role TEXT;
    v_id UUID;
    v_token TEXT := encode(extensions.gen_random_bytes(32), 'hex');
    v_expires TIMESTAMPTZ := now() + INTERVAL '7 days';
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;

    IF p_resource_type IS NULL OR p_resource_type NOT IN ('patient_document', 'prescription', 'invoice', 'referral') THEN
        RAISE EXCEPTION 'invalid_resource_type' USING ERRCODE = '22023';
    END IF;

    v_tenant := public.share_resource_tenant(p_resource_type, p_resource_id);

    -- 05-02c (R-42): only a resource of the session's active clinic.
    IF v_tenant IS NOT NULL AND v_tenant = authz.active_tenant_id() THEN
        SELECT m.role INTO v_role FROM public.memberships m WHERE m.tenant_id = v_tenant AND m.user_id = v_uid;
    END IF;

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT (v_role = ANY (public.share_type_roles(p_resource_type)))
       OR (p_resource_type = 'invoice' AND NOT private.share_invoice_allowed(v_tenant, p_resource_id)) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.document_share_tokens
        (tenant_id, document_id, resource_type, resource_id, token_hash, expires_at, created_by)
    VALUES (
        v_tenant,
        CASE WHEN p_resource_type = 'patient_document' THEN p_resource_id END,
        p_resource_type,
        p_resource_id,
        public.share_token_hash(v_token),
        v_expires,
        v_uid
    )
    RETURNING id INTO v_id;

    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, entity_type, entity_id, metadata)
    VALUES (
        v_tenant,
        v_uid,
        v_role,
        'share_token.create',
        p_resource_type,
        p_resource_id,
        jsonb_build_object('token_id', v_id, 'expires_at', v_expires)
    );

    RETURN QUERY SELECT v_token, v_expires;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_share_token(p_token_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    t public.document_share_tokens;
    v_role TEXT;
    v_now TIMESTAMPTZ := now();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO t FROM public.document_share_tokens s WHERE s.id = p_token_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    -- 05-02c (R-42): only a token of the session's active clinic.
    IF t.tenant_id = authz.active_tenant_id() THEN
        SELECT m.role INTO v_role FROM public.memberships m WHERE m.tenant_id = t.tenant_id AND m.user_id = v_uid;
    END IF;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT (v_role = ANY (public.share_type_roles(t.resource_type)))
       OR (t.resource_type = 'invoice' AND NOT private.share_invoice_allowed(t.tenant_id, t.resource_id)) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF t.revoked_at IS NOT NULL THEN
        RETURN t.revoked_at;
    END IF;

    UPDATE public.document_share_tokens SET revoked_at = v_now WHERE id = t.id;

    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, entity_type, entity_id, metadata)
    VALUES (
        t.tenant_id,
        v_uid,
        v_role,
        'share_token.revoke',
        t.resource_type,
        COALESCE(t.resource_id, t.document_id),
        jsonb_build_object('token_id', t.id)
    );

    RETURN v_now;
END;
$$;

-- Bound bodies (current definitions, tenant/role check changed) ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_message(p_tenant_id uuid, p_patient_id uuid, p_visit_id uuid, p_channel text, p_message_type text, p_template_id text, p_template_params jsonb, p_recipient_phone text, p_recipient_user_id uuid, p_metadata jsonb, p_run_at timestamp with time zone DEFAULT now(), p_dedupe_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
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
    -- session-derived) AND that tenant must be the session's ACTIVE clinic (05-02c, R-42; before: any membership).
    -- Missing, foreign and other-clinic subjects all read the same (P0002): existence is never revealed. Checked
    -- before anything else about the call.
    IF p_tenant_id IS NULL
        OR p_tenant_id IS DISTINCT FROM authz.active_tenant_id()
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
    IF NOT EXISTS (
        SELECT 1 FROM public.memberships m
         WHERE m.tenant_id = p_tenant_id AND m.user_id = v_uid AND m.role = ANY (v_template.request_roles)
    ) THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_webhook_event(p_tenant_id uuid, p_event_type text, p_subject_id uuid, p_subscription_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
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
    -- p_tenant_id (ServiceContext.tenantId, session-derived) must be the session's ACTIVE clinic (05-02c, R-42).
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM authz.active_tenant_id() THEN
        RAISE EXCEPTION 'SUBJECT_MISMATCH' USING ERRCODE = 'P0002';
    END IF;
    IF p_event_type = 'ping' AND NOT public.has_permission(p_tenant_id, 'clinic:manage') THEN
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
$function$;

CREATE OR REPLACE FUNCTION private.outbox_payment_recorded(p_payment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    -- A session's payment must be in its ACTIVE clinic (05-02c, R-42; before: any membership of the payment's clinic).
    IF auth.uid() IS NOT NULL AND v_payment.tenant_id IS DISTINCT FROM authz.active_tenant_id() THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.change_member_role(p_membership_id uuid, p_role text)
 RETURNS public.memberships
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid UUID := auth.uid();
    v_target public.memberships;
    v_caller_role TEXT;
    v_old_role TEXT;
    v_owners INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;

    IF p_role IS NULL OR p_role NOT IN ('owner', 'admin', 'doctor', 'receptionist', 'nurse') THEN
        RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_target FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    -- The tenant comes from the target row; it must be the session's ACTIVE clinic (05-02c, R-42; before: any clinic
    -- the caller belonged to) and the caller's role is read there.
    IF v_target.tenant_id IS DISTINCT FROM authz.active_tenant_id() THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT m.role INTO v_caller_role
    FROM public.memberships m
    WHERE m.tenant_id = v_target.tenant_id AND m.user_id = v_uid;

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_caller_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF (p_role IN ('owner', 'admin') OR v_target.role IN ('owner', 'admin')) AND v_caller_role <> 'owner' THEN
        RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501';
    END IF;

    IF v_target.role = p_role THEN
        RETURN v_target;
    END IF;

    IF v_target.role = 'owner' THEN
        -- Serialise concurrent demotions of the tenant's owners, then count.
        PERFORM 1 FROM public.memberships
        WHERE tenant_id = v_target.tenant_id AND role = 'owner'
        FOR UPDATE;

        SELECT count(*) INTO v_owners
        FROM public.memberships
        WHERE tenant_id = v_target.tenant_id AND role = 'owner';

        IF v_owners <= 1 THEN
            RAISE EXCEPTION 'last_owner' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    v_old_role := v_target.role;

    UPDATE public.memberships
    SET role = p_role
    WHERE id = p_membership_id
    RETURNING * INTO v_target;

    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, entity_type, entity_id, metadata)
    VALUES (
        v_target.tenant_id,
        v_uid,
        v_caller_role,
        'staff.member.role_change',
        'membership',
        v_target.id,
        jsonb_build_object('target_user_id', v_target.user_id, 'from_role', v_old_role, 'to_role', p_role)
    );

    RETURN v_target;
END;
$function$;

CREATE OR REPLACE FUNCTION public.referral_source_clinics(p_ids uuid[])
 RETURNS TABLE(id uuid, name text, phone text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT t.id, t.name, t.phone
    FROM public.tenants t
    WHERE t.id = ANY (p_ids)
      AND EXISTS (
          SELECT 1
          FROM public.referrals r
          WHERE r.tenant_id = t.id
            AND r.target_tenant_id IS NOT NULL
            AND r.target_tenant_id IN (SELECT authz.tenant_ids_with('consultations:view'))
      );
$function$;

CREATE OR REPLACE FUNCTION public.generate_daily_queue_token(p_tenant_id uuid, p_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_next_token INTEGER;
BEGIN
    IF NOT (
        (SELECT auth.role()) = 'service_role'
        OR p_tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit'))
    ) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(MAX(q.token_number), 0) + 1
    INTO v_next_token
    FROM public.queue_tokens q
    WHERE q.tenant_id = p_tenant_id AND q.date = p_date;

    RETURN v_next_token;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_medicines(p_query text, p_doctor_id uuid, p_tenant_id uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(id text, medicine_name text, generic_name text, dose_form text, default_dosage text, default_timing text, default_duration text, is_custom boolean, is_favorite boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_clean_query TEXT := trim(COALESCE(p_query, ''));
BEGIN
    IF NOT (
        (SELECT auth.role()) = 'service_role'
        OR (
            p_tenant_id IN (SELECT authz.full_tenant_ids())
            AND p_doctor_id = auth.uid()
        )
    ) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH custom_matches AS (
        SELECT
            cm.id::TEXT AS id,
            cm.medicine_name,
            cm.generic_name,
            cm.dose_form,
            cm.default_dosage,
            cm.default_timing,
            cm.default_duration,
            true AS is_custom,
            true AS is_favorite,
            cm.use_count
        FROM public.doctor_custom_medicines cm
        WHERE cm.tenant_id = p_tenant_id
          AND cm.doctor_id = p_doctor_id
          AND (
              v_clean_query = ''
              OR cm.medicine_name ILIKE '%' || v_clean_query || '%'
              OR COALESCE(cm.generic_name, '') ILIKE '%' || v_clean_query || '%'
          )
    ),
    cdci_matches AS (
        SELECT
            c.id,
            c.brand_name AS medicine_name,
            c.generic_name,
            c.dose_form,
            NULL::TEXT AS default_dosage,
            'After food'::TEXT AS default_timing,
            '5 days'::TEXT AS default_duration,
            false AS is_custom,
            false AS is_favorite,
            0 AS use_count
        FROM public.cdci_medicines_search c
        WHERE (
            v_clean_query = ''
            OR c.brand_name ILIKE '%' || v_clean_query || '%'
            OR COALESCE(c.generic_name, '') ILIKE '%' || v_clean_query || '%'
            OR c.search_vector @@ to_tsquery('simple', replace(v_clean_query, ' ', ' & ') || ':*')
            OR public.similarity(c.brand_name, v_clean_query) > 0.2
            OR (c.generic_name IS NOT NULL AND public.similarity(c.generic_name, v_clean_query) > 0.2)
        )
        AND NOT EXISTS (
            SELECT 1 FROM custom_matches cm2 WHERE lower(cm2.medicine_name) = lower(c.brand_name)
        )
    )
    SELECT
        q.id,
        q.medicine_name,
        q.generic_name,
        q.dose_form,
        q.default_dosage,
        q.default_timing,
        q.default_duration,
        q.is_custom,
        q.is_favorite
    FROM (
        SELECT * FROM custom_matches
        UNION ALL
        SELECT * FROM cdci_matches
    ) q
    ORDER BY q.is_favorite DESC, q.use_count DESC, q.medicine_name ASC
    LIMIT p_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.communication_queue_claim(p_id uuid)
 RETURNS SETOF public.communication_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    RETURN QUERY
    UPDATE public.communication_queue q
    SET status = 'processing', updated_at = now()
    WHERE q.id = p_id
      AND q.status IN ('pending', 'failed')
      AND q.next_retry_at <= now()
      AND (
          v_uid IS NULL
          OR (q.created_by = v_uid AND q.tenant_id = authz.active_tenant_id())
      )
    RETURNING q.*;
END;
$function$;

CREATE OR REPLACE FUNCTION public.communication_queue_finish(p_id uuid, p_success boolean, p_external_message_id text, p_error text)
 RETURNS TABLE(new_status text, new_retry_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    RETURN QUERY
    UPDATE public.communication_queue q
    SET status = CASE
            WHEN p_success THEN 'sent'
            WHEN q.retry_count + 1 >= q.max_retries THEN 'dead_letter'
            ELSE 'failed'
        END,
        sent_at = CASE WHEN p_success THEN now() ELSE q.sent_at END,
        external_message_id = CASE WHEN p_success THEN left(p_external_message_id, 200) ELSE q.external_message_id END,
        retry_count = CASE WHEN p_success THEN q.retry_count ELSE q.retry_count + 1 END,
        next_retry_at = CASE
            WHEN p_success THEN q.next_retry_at
            WHEN q.retry_count + 1 <= 1 THEN now() + INTERVAL '1 minute'
            WHEN q.retry_count + 1 = 2 THEN now() + INTERVAL '5 minutes'
            ELSE now() + INTERVAL '15 minutes'
        END,
        error_message = CASE
            WHEN p_success THEN NULL
            ELSE left(COALESCE(NULLIF(p_error, ''), 'Delivery failed'), 500)
        END,
        updated_at = now()
    WHERE q.id = p_id
      AND q.status = 'processing'
      AND (
          v_uid IS NULL
          OR (q.created_by = v_uid AND q.tenant_id = authz.active_tenant_id())
      )
    RETURNING q.status, q.retry_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_user_has_role(p_tenant_id uuid, p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.tenant_id = p_tenant_id
          AND m.tenant_id = authz.active_tenant_id()
          AND m.user_id = auth.uid()
          AND m.role = ANY (p_roles)
    );
$function$;

CREATE OR REPLACE FUNCTION public.current_user_is_admin_or_owner(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.tenant_id = p_tenant_id
          AND m.tenant_id = authz.active_tenant_id()
          AND m.user_id = auth.uid()
          AND m.role IN ('owner', 'admin')
    );
$function$;

ALTER FUNCTION public.get_tenant_table_rls_policies() SET search_path = public, pg_catalog, pg_temp;
