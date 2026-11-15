-- Migration: 000090_access_enforcement.sql
-- V2-05 plan 05-10a (SUB-02 enforcement core; SUBSCRIPTIONS_AND_PLANS §6.2, §7.2; roadmap acceptance 8 (RLS and
-- storage half) and 11; rulings R-14, R-27, R-28, R-40, R-42; research Pitfalls 7, 9, 10; threats T-05-31..T-05-34).
-- The database stops a clinic whose access level is not `full` (`billing_internal.tenant_access_level`, 05-09a):
--
-- 1. Helper BODIES only (R-14; no policy is rewritten):
--    - `authz.full_tenant_ids()` (and so `tenant_ids_with`, `has_permission`, every tenant-bound policy and every
--      storage class) admits the active clinic only while its level is `full` (the body proven by 05-09c's flip dry
--      run, plus 05-05's `status = 'active'`);
--    - `authz.billing_tenant_ids()`: owner/admin of the active clinic while its level is `full`, `locked` or
--      `onboarding` (a locked or onboarding owner still reads the subscription, Pitfall 7);
--    - `authz.member_tenant_ids()` and `authz.active_tenant_id()` are unchanged (any level: the clinic switcher, the
--      caller's own memberships, `tenants`).
-- 2. SECURITY DEFINER functions that bound the caller with `authz.active_tenant_id()` directly (not through a full-bound
--    helper) now bind the FULL active clinic: `(SELECT authz.full_tenant_ids() LIMIT 1)` in place of
--    `authz.active_tenant_id()` in change_member_role, create_share_token, revoke_share_token, enqueue_message,
--    enqueue_webhook_event, record_payment (user path), remove_member, private.invitation_manager_role
--    (resend/revoke), private.outbox_payment_recorded, communication_queue_claim/finish (session branch). A locked or
--    onboarding clinic reads as "not found" there, exactly as another clinic does. Functions that already go through
--    `tenant_ids_with`/`has_permission`/`full_tenant_ids` inherit the stop (invite_staff, issue_queue_token,
--    generate_tenant_invoice_number, search_medicines, referral_source_clinics, referral_directory_search).
--    `log_audit` (writes one audit row of the caller's active clinic, reads no tenant data) and the member wrappers
--    `my_tenant_access`/`my_entitlements` stay level-neutral (the billing page needs them).
-- 3. Token functions that bypass RLS for anon callers (Pitfall 9):
--    - `resolve_share_token`: a token of a clinic whose level is not `full` resolves to {"status": "clinic_unavailable"}
--      only, EXCEPT a prescription of an `expired` clinic (SUB-D6): metadata only ({"status": "ok", "restricted":
--      true}, no file, no access count); nothing at `archived` or later. Every answer for a live token carries the
--      level (`access`);
--    - `get_reschedule_context` / `consume_reschedule_token`: {"status": "clinic_unavailable"} before anything else;
--    - `share_token_object` (service role; the share routes sign through it): NULL unless the clinic is `full`.
-- 4. Jobs skip non-full clinics (R-27): `claim_jobs` first cancels the due jobs of the claimed kinds whose clinic is not
--    `full` (status `cancelled`, `last_error = 'tenant_not_full'`, `finished_at`), except kinds in a closed exempt set
--    (empty in V2-05; V2-13b adds owner billing notices), then claims as before. Tenant-less jobs are untouched.
--    Patient reminders of a locked clinic are never sent, and never sent late after a renewal.
-- Per-migration checklist: no new table or function; bodies replaced with CREATE OR REPLACE (signatures, owners,
-- grants and `search_path = ''` unchanged); helpers keep their EXECUTE grants; definer_functions.test.sql gains an
-- access-level leg per function; RPC_REASON_CODES unchanged (refusals reuse the existing not-found reasons).

-- 1. Helper bodies ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION authz.full_tenant_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT m.tenant_id
      FROM public.memberships m
     WHERE m.user_id = auth.uid()
       AND m.status = 'active'
       AND m.tenant_id = authz.active_tenant_id()
       AND billing_internal.tenant_access_level(m.tenant_id, now()) = 'full'
$function$;

CREATE OR REPLACE FUNCTION authz.billing_tenant_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
    SELECT m.tenant_id
      FROM public.memberships m
     WHERE m.user_id = auth.uid()
       AND m.status = 'active'
       AND m.tenant_id = authz.active_tenant_id()
       AND m.role IN ('owner', 'admin')
       AND billing_internal.tenant_access_level(m.tenant_id, now()) IN ('full', 'locked', 'onboarding')
$function$;

-- 2. Definer functions bound to the FULL active clinic ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.change_member_role(p_membership_id uuid, p_role text)
 RETURNS memberships
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
    -- 05-05: a removed or suspended membership has no role to change (reactivation is 05-07a's re-invite).
    IF NOT FOUND OR v_target.status <> 'active' THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    -- The tenant comes from the target row; it must be the session's ACTIVE clinic (05-02c, R-42) and the caller's
    -- role is read there (from an active membership, 05-05).
    IF v_target.tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;
    SELECT m.role INTO v_caller_role
    FROM public.memberships m
    WHERE m.tenant_id = v_target.tenant_id AND m.user_id = v_uid AND m.status = 'active';

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
        -- Serialise concurrent demotions/removals of the tenant's owners, then count the ACTIVE ones.
        PERFORM 1 FROM public.memberships
        WHERE tenant_id = v_target.tenant_id AND role = 'owner'
        FOR UPDATE;

        SELECT count(*) INTO v_owners
        FROM public.memberships
        WHERE tenant_id = v_target.tenant_id AND role = 'owner' AND status = 'active';

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


CREATE OR REPLACE FUNCTION public.create_share_token(p_resource_type text, p_resource_id uuid)
 RETURNS TABLE(token text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    IF v_tenant IS NOT NULL AND v_tenant = (SELECT authz.full_tenant_ids() LIMIT 1) THEN
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
$function$;


CREATE OR REPLACE FUNCTION public.revoke_share_token(p_token_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    IF t.tenant_id = (SELECT authz.full_tenant_ids() LIMIT 1) THEN
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
$function$;


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
        OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1)
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
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
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


CREATE OR REPLACE FUNCTION public.record_payment(p_tenant_id uuid, p_invoice_id uuid, p_amount numeric, p_method text, p_reference text, p_command_id uuid, p_notes text DEFAULT NULL::text, p_system_actor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
DECLARE
    v_uid UUID := auth.uid();
    v_is_system BOOLEAN;
    v_invoice RECORD;
    v_existing RECORD;
    v_paid NUMERIC;
    v_payment_id UUID;
    v_new_status TEXT;
    v_reference TEXT := NULLIF(btrim(p_reference), '');
    v_notes TEXT := NULLIF(btrim(p_notes), '');
    v_metadata JSONB;
BEGIN
    -- 1. Actor. User path: a session (auth.uid()) and no system actor. System path (TARGET §7.1): the service role,
    --    no session, and a system actor from the closed set.
    IF v_uid IS NOT NULL AND p_system_actor IS NULL THEN
        v_is_system := false;
    ELSIF v_uid IS NULL
        AND current_setting('role', true) = 'service_role'
        AND p_system_actor IN ('system:payment_webhook') THEN
        v_is_system := true;
    ELSE
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Input.
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) OR p_amount >= 100000000 THEN
        RAISE EXCEPTION 'AMOUNT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('cash', 'upi', 'card') THEN
        RAISE EXCEPTION 'METHOD_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF char_length(v_reference) > 100 OR char_length(v_notes) > 500 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. User path: the tenant is the session's ACTIVE clinic, checked here (05-02c; before: trusted from the server),
    --    and the caller collects there (billing:collect, PO-3). Another clinic reads as not found.
    IF NOT v_is_system THEN
        IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
            RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0002';
        END IF;
        IF NOT public.has_permission(p_tenant_id, 'billing:collect') THEN
            RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 4. Lock the aggregate root, in the given tenant only.
    SELECT i.id, i.tenant_id, i.total_amount, i.status
    INTO v_invoice
    FROM public.invoices i
    WHERE i.id = p_invoice_id
      AND i.tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- 5. Idempotent replay of this actor's own command only (H-PAY). Command ids are written by this function alone
    --    (payments_actor_guard), and a row of another actor with the same command id is a mismatch, never a replay.
    IF p_command_id IS NOT NULL THEN
        SELECT p.id, p.invoice_id, p.amount, p.payment_method, p.recorded_by, p.recorded_by_system
        INTO v_existing
        FROM public.payments p
        WHERE p.tenant_id = v_invoice.tenant_id
          AND p.command_id = p_command_id;

        IF FOUND THEN
            IF v_existing.invoice_id <> v_invoice.id
                OR v_existing.amount <> p_amount
                OR v_existing.payment_method <> p_method
                OR v_existing.recorded_by IS DISTINCT FROM (CASE WHEN v_is_system THEN NULL ELSE v_uid END)
                OR v_existing.recorded_by_system IS DISTINCT FROM (CASE WHEN v_is_system THEN p_system_actor ELSE NULL END) THEN
                RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH' USING ERRCODE = 'P0001';
            END IF;

            SELECT COALESCE(sum(p.amount), 0) INTO v_paid
            FROM public.payments p
            WHERE p.invoice_id = v_invoice.id
              AND p.tenant_id = v_invoice.tenant_id;

            RETURN jsonb_build_object(
                'payment_id', v_existing.id,
                'invoice_status', v_invoice.status,
                'paid_total', v_paid,
                'total_amount', v_invoice.total_amount,
                'balance_due', GREATEST(v_invoice.total_amount - v_paid, 0),
                'replayed', true
            );
        END IF;
    END IF;

    -- 6. Invariants.
    IF v_invoice.status NOT IN ('draft', 'issued') THEN
        RAISE EXCEPTION 'INVOICE_NOT_PAYABLE' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(sum(p.amount), 0) INTO v_paid
    FROM public.payments p
    WHERE p.invoice_id = v_invoice.id
      AND p.tenant_id = v_invoice.tenant_id;

    IF p_amount > v_invoice.total_amount - v_paid THEN
        RAISE EXCEPTION 'OVERPAYMENT' USING ERRCODE = 'P0001';
    END IF;

    -- 7. Payment. The id is chosen here and marked transaction-locally for the actor guard and the outbox writer; the
    --    function's own SET clauses restore the setting when the call ends. The user path never names
    --    recorded_by_system (no column privilege).
    v_payment_id := gen_random_uuid();
    PERFORM set_config('clinicos.record_payment_id', v_payment_id::text, true);

    IF v_is_system THEN
        INSERT INTO public.payments
            (id, tenant_id, invoice_id, amount, payment_method, reference_number, notes, recorded_by_system, command_id)
        VALUES
            (v_payment_id, v_invoice.tenant_id, v_invoice.id, p_amount, p_method, v_reference, v_notes, p_system_actor,
             p_command_id);
    ELSE
        INSERT INTO public.payments
            (id, tenant_id, invoice_id, amount, payment_method, reference_number, notes, recorded_by, command_id)
        VALUES
            (v_payment_id, v_invoice.tenant_id, v_invoice.id, p_amount, p_method, v_reference, v_notes, v_uid,
             p_command_id);
    END IF;

    -- 8. Status transition.
    v_paid := v_paid + p_amount;
    v_new_status := CASE WHEN v_paid >= v_invoice.total_amount THEN 'paid' ELSE v_invoice.status END;

    IF v_new_status <> v_invoice.status THEN
        UPDATE public.invoices
        SET status = v_new_status, updated_at = now()
        WHERE id = v_invoice.id;
    END IF;

    -- 9. Audit (same transaction). User path: log_audit (actor = the session, role = its role in the active clinic).
    --    System path: private.log_system_audit (service_role only) with the system actor.
    v_metadata := jsonb_build_object(
        'invoice_id', v_invoice.id,
        'payment_method', p_method,
        'old_status', v_invoice.status,
        'new_status', v_new_status
    );
    IF v_is_system THEN
        PERFORM private.log_system_audit(v_invoice.tenant_id, p_system_actor, 'invoice.payment_recorded', 'payment',
                                         v_payment_id, v_metadata);
    ELSE
        PERFORM public.log_audit(v_invoice.tenant_id, 'invoice.payment_recorded', 'payment', v_payment_id, v_metadata);
    END IF;

    -- 10. Outbox (same transaction), then clear the marker.
    PERFORM private.outbox_payment_recorded(v_payment_id);
    PERFORM set_config('clinicos.record_payment_id', '', true);

    RETURN jsonb_build_object(
        'payment_id', v_payment_id,
        'invoice_status', v_new_status,
        'paid_total', v_paid,
        'total_amount', v_invoice.total_amount,
        'balance_due', GREATEST(v_invoice.total_amount - v_paid, 0),
        'replayed', false
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.remove_member(p_membership_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '5s'
AS $function$
DECLARE
    v_uid UUID := auth.uid();
    v_target public.memberships;
    v_caller_role TEXT;
    v_reason TEXT := NULLIF(btrim(p_reason), '');
    v_owners INTEGER;
    v_keys INTEGER;
    v_invites INTEGER;
    v_sessions INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;
    IF v_reason IS NULL OR char_length(v_reason) > 500 OR v_reason ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- The tenant comes from the target row and must be the caller's active clinic (R-42); anything else reads as "not
    -- found" (another clinic's membership ids are never confirmed).
    SELECT * INTO v_target FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
    IF NOT FOUND OR v_target.tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    SELECT m.role INTO v_caller_role
      FROM public.memberships m
     WHERE m.tenant_id = v_target.tenant_id AND m.user_id = v_uid AND m.status = 'active';
    IF v_caller_role IS NULL OR NOT authz.role_has_permission(v_caller_role, 'staff:invite') THEN
        RAISE EXCEPTION 'STAFF_REMOVE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    IF v_target.role IN ('owner', 'admin') AND v_caller_role <> 'owner' THEN
        RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE = '42501';
    END IF;

    IF v_target.status = 'removed' THEN
        RAISE EXCEPTION 'MEMBER_NOT_ACTIVE' USING ERRCODE = 'P0001';
    END IF;

    IF v_target.role = 'owner' THEN
        -- Same lock as change_member_role: concurrent demotions and removals of owners serialise here.
        PERFORM 1 FROM public.memberships
         WHERE tenant_id = v_target.tenant_id AND role = 'owner'
           FOR UPDATE;
        SELECT count(*) INTO v_owners
          FROM public.memberships
         WHERE tenant_id = v_target.tenant_id AND role = 'owner' AND status = 'active';
        IF v_owners <= 1 THEN
            RAISE EXCEPTION 'LAST_OWNER' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF v_target.user_id = v_uid THEN
        RAISE EXCEPTION 'SELF_REMOVAL' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.memberships
       SET status = 'removed', removed_at = now(), removed_by = v_uid
     WHERE id = v_target.id;

    WITH k AS (
        UPDATE public.api_keys
           SET revoked_at = now(), updated_at = now()
         WHERE tenant_id = v_target.tenant_id AND created_by = v_target.user_id AND revoked_at IS NULL
        RETURNING 1
    )
    SELECT count(*) INTO v_keys FROM k;

    WITH i AS (
        UPDATE public.invitations
           SET revoked_at = now(), revoked_by = v_uid
         WHERE tenant_id = v_target.tenant_id AND created_by = v_target.user_id
           AND consumed_at IS NULL AND revoked_at IS NULL
        RETURNING 1
    )
    SELECT count(*) INTO v_invites FROM i;

    -- R-43: end every session of the removed user (refresh tokens cascade). A hosted database that refuses the delete
    -- leaves the removal in place; the 900 s access token is then the bound and the count is NULL.
    BEGIN
        WITH s AS (
            DELETE FROM auth.sessions WHERE user_id = v_target.user_id RETURNING 1
        )
        SELECT count(*) INTO v_sessions FROM s;
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_sessions := NULL;
    END;

    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, entity_type, entity_id, metadata)
    VALUES (
        v_target.tenant_id,
        v_uid,
        v_caller_role,
        'staff.removed',
        'membership',
        v_target.id,
        jsonb_build_object(
            'target_user_id', v_target.user_id,
            'role', v_target.role,
            'reason', v_reason,
            'keys_revoked', v_keys,
            'invites_revoked', v_invites,
            'sessions_revoked', v_sessions
        )
    );

    RETURN jsonb_build_object(
        'user_id', v_target.user_id,
        'keys_revoked', v_keys,
        'invites_revoked', v_invites,
        'sessions_revoked', v_sessions
    );
END;
$function$;


CREATE OR REPLACE FUNCTION private.invitation_manager_role(p_invitation_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
    v_row public.invitations;
    v_role TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_row FROM public.invitations WHERE id = p_invitation_id FOR UPDATE;
    IF NOT FOUND OR v_row.tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'INVITATION_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_role := private.invitation_inviter_role(v_row.tenant_id);
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'STAFF_INVITE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF v_row.role IN ('owner', 'admin') AND v_role <> 'owner' THEN
        RAISE EXCEPTION 'OWNER_REQUIRED' USING ERRCODE = '42501';
    END IF;
    RETURN v_role;
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
    IF auth.uid() IS NOT NULL AND v_payment.tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
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


CREATE OR REPLACE FUNCTION public.communication_queue_claim(p_id uuid)
 RETURNS SETOF communication_queue
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
          OR (q.created_by = v_uid AND q.tenant_id = (SELECT authz.full_tenant_ids() LIMIT 1))
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
          OR (q.created_by = v_uid AND q.tenant_id = (SELECT authz.full_tenant_ids() LIMIT 1))
      )
    RETURNING q.status, q.retry_count;
END;
$function$;


-- 3. Token functions (anon) and the share-object lookup (service role) ------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_share_token(p_token text, p_kinds text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    t public.document_share_tokens;
    v_rid UUID;
    v_res JSONB;
    v_clinic JSONB;
    v_level TEXT;
    v_sub_status TEXT;
BEGIN
    IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128 THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    SELECT * INTO t FROM public.document_share_tokens s
    WHERE s.token_hash = public.share_token_hash(p_token)
    FOR UPDATE;

    IF NOT FOUND
       OR t.resource_type NOT IN ('patient_document', 'prescription', 'invoice', 'referral')
       OR p_kinds IS NULL
       OR NOT (t.resource_type = ANY (p_kinds)) THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    -- 05-10a (SUB-02, SUB-D6): the clinic's access level decides before anything of the resource is read.
    v_level := billing_internal.tenant_access_level(t.tenant_id, now());
    IF v_level IS DISTINCT FROM 'full' THEN
        SELECT st.status INTO v_sub_status FROM public.tenant_subscriptions st WHERE st.tenant_id = t.tenant_id;
        -- An expired clinic's prescription resolves to metadata only (no file, no access count); nothing else of a
        -- non-full clinic resolves, and nothing at all from `archived` on.
        IF NOT (t.resource_type = 'prescription' AND v_sub_status = 'expired'
                AND t.revoked_at IS NULL AND t.expires_at > now()) THEN
            RETURN jsonb_build_object('status', 'clinic_unavailable');
        END IF;
    END IF;

    v_rid := COALESCE(t.resource_id, CASE WHEN t.resource_type = 'patient_document' THEN t.document_id END);

    SELECT jsonb_build_object('name', c.name, 'phone', c.phone, 'address', c.address, 'logo_url', c.logo_url)
    INTO v_clinic
    FROM public.tenants c
    WHERE c.id = t.tenant_id;

    IF t.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'revoked', 'clinic', v_clinic - 'address' - 'logo_url');
    END IF;

    IF t.expires_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired', 'clinic', v_clinic - 'address' - 'logo_url');
    END IF;

    v_res := public.share_token_resource(t.tenant_id, t.resource_type, v_rid);
    IF v_res IS NULL THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    IF v_level IS DISTINCT FROM 'full' THEN
        RETURN (v_res - '_bucket' - '_storage_path') || jsonb_build_object(
            'status', 'ok',
            'restricted', true,
            'access', v_level,
            'resource_type', t.resource_type,
            'expires_at', t.expires_at,
            'clinic', v_clinic - 'address' - 'logo_url'
        );
    END IF;

    UPDATE public.document_share_tokens
    SET access_count = access_count + 1,
        last_accessed_at = now()
    WHERE id = t.id;

    RETURN (v_res - '_bucket' - '_storage_path') || jsonb_build_object(
        'status', 'ok',
        'access', v_level,
        'resource_type', t.resource_type,
        'expires_at', t.expires_at,
        'clinic', v_clinic
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.get_reschedule_context(p_token text, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    t public.document_share_tokens;
    v public.visits;
    v_clinic JSONB;
    v_doctor JSONB;
    v_booked JSONB := '[]'::JSONB;
    v_from TIMESTAMPTZ;
    v_to TIMESTAMPTZ;
BEGIN
    IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128 THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    SELECT * INTO t FROM public.document_share_tokens s
    WHERE s.token_hash = public.share_token_hash(p_token) AND s.resource_type = 'appointment';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    -- 05-10a (SUB-02): a clinic whose access level is not `full` offers no online service.
    IF billing_internal.tenant_access_level(t.tenant_id, now()) IS DISTINCT FROM 'full' THEN
        RETURN jsonb_build_object('status', 'clinic_unavailable');
    END IF;
    IF t.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'revoked');
    END IF;
    IF t.expires_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired');
    END IF;

    SELECT * INTO v FROM public.visits x WHERE x.id = t.resource_id AND x.tenant_id = t.tenant_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    IF v.status IS NULL OR v.status NOT IN ('booked', 'confirmed') THEN
        RETURN jsonb_build_object('status', 'closed', 'visit_status', v.status);
    END IF;
    IF v.doctor_id IS NULL THEN
        RETURN jsonb_build_object('status', 'unavailable');
    END IF;

    SELECT jsonb_build_object('name', c.name, 'phone', c.phone, 'address', c.address)
    INTO v_clinic
    FROM public.tenants c
    WHERE c.id = t.tenant_id;

    SELECT jsonb_build_object(
        'full_name', m.full_name,
        'default_specialty', m.default_specialty,
        'default_slot_duration_minutes', m.default_slot_duration_minutes,
        'availability_schedule', m.availability_schedule
    ) INTO v_doctor
    FROM public.memberships m
    WHERE m.tenant_id = t.tenant_id AND m.user_id = v.doctor_id;

    v_from := GREATEST(p_from, now() - INTERVAL '1 day');
    v_to := LEAST(p_to, v_from + INTERVAL '1 day', now() + INTERVAL '91 days');

    IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_to >= v_from THEN
        SELECT COALESCE(jsonb_agg(b.scheduled_at ORDER BY b.scheduled_at), '[]'::JSONB)
        INTO v_booked
        FROM public.visits b
        WHERE b.tenant_id = t.tenant_id
          AND b.doctor_id = v.doctor_id
          AND b.scheduled_at >= v_from
          AND b.scheduled_at <= v_to
          AND b.status IN ('booked', 'confirmed', 'waiting', 'in_consultation');
    END IF;

    RETURN jsonb_build_object(
        'status', 'ok',
        'clinic', v_clinic,
        'doctor', COALESCE(v_doctor, '{}'::JSONB),
        'current_scheduled_at', v.scheduled_at,
        'booked', v_booked
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.consume_reschedule_token(p_token text, p_new_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    t public.document_share_tokens;
    v public.visits;
    v_slot INTERVAL;
BEGIN
    IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128 THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    SELECT * INTO t FROM public.document_share_tokens s
    WHERE s.token_hash = public.share_token_hash(p_token) AND s.resource_type = 'appointment'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    -- 05-10a (SUB-02): a clinic whose access level is not `full` offers no online service.
    IF billing_internal.tenant_access_level(t.tenant_id, now()) IS DISTINCT FROM 'full' THEN
        RETURN jsonb_build_object('status', 'clinic_unavailable');
    END IF;
    IF t.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'revoked');
    END IF;
    IF t.expires_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired');
    END IF;

    IF p_new_at IS NULL OR p_new_at <= now() THEN
        RETURN jsonb_build_object('status', 'invalid_time');
    END IF;
    IF p_new_at > now() + INTERVAL '90 days' THEN
        RETURN jsonb_build_object('status', 'too_far');
    END IF;

    SELECT * INTO v FROM public.visits x
    WHERE x.id = t.resource_id AND x.tenant_id = t.tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;
    IF v.status IS NULL OR v.status NOT IN ('booked', 'confirmed') THEN
        RETURN jsonb_build_object('status', 'closed', 'visit_status', v.status);
    END IF;
    IF v.doctor_id IS NULL THEN
        RETURN jsonb_build_object('status', 'unavailable');
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('reschedule:' || v.tenant_id::TEXT || ':' || v.doctor_id::TEXT, 0));

    SELECT make_interval(mins => LEAST(GREATEST(COALESCE(m.default_slot_duration_minutes, 15), 5), 120))
    INTO v_slot
    FROM public.memberships m
    WHERE m.tenant_id = v.tenant_id AND m.user_id = v.doctor_id;
    v_slot := COALESCE(v_slot, INTERVAL '15 minutes');

    IF EXISTS (
        SELECT 1
        FROM public.visits o
        WHERE o.tenant_id = v.tenant_id
          AND o.doctor_id = v.doctor_id
          AND o.id <> v.id
          AND o.status IN ('booked', 'confirmed', 'waiting', 'in_consultation')
          AND o.scheduled_at > p_new_at - v_slot
          AND o.scheduled_at < p_new_at + v_slot
    ) THEN
        RETURN jsonb_build_object('status', 'slot_taken');
    END IF;

    UPDATE public.document_share_tokens
    SET revoked_at = now(),
        access_count = access_count + 1,
        last_accessed_at = now()
    WHERE id = t.id;

    UPDATE public.visits
    SET scheduled_at = p_new_at,
        updated_at = now()
    WHERE id = v.id AND tenant_id = t.tenant_id;

    INSERT INTO public.in_app_notifications
        (tenant_id, recipient_role, category, event_type, title, message, link_url, metadata)
    VALUES (
        t.tenant_id,
        'receptionist',
        'queue',
        'appointment_rescheduled',
        'Appointment Rescheduled Online',
        'A patient has rescheduled their appointment to '
            || to_char(p_new_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') || '.',
        '/calendar',
        jsonb_build_object('appointment_id', v.id, 'new_scheduled_at', p_new_at)
    );

    RETURN jsonb_build_object('status', 'ok', 'new_scheduled_at', p_new_at);
END;
$function$;


CREATE OR REPLACE FUNCTION public.share_token_object(p_token text, p_kinds text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    t public.document_share_tokens;
    v_rid UUID;
    v_res JSONB;
BEGIN
    IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128 THEN
        RETURN NULL;
    END IF;

    SELECT * INTO t FROM public.document_share_tokens s WHERE s.token_hash = public.share_token_hash(p_token);

    IF NOT FOUND
       OR t.resource_type NOT IN ('patient_document', 'prescription', 'invoice', 'referral')
       OR p_kinds IS NULL
       OR NOT (t.resource_type = ANY (p_kinds))
       OR t.revoked_at IS NOT NULL
       OR t.expires_at <= now()
       -- 05-10a (SUB-02, R-28): nothing of a clinic whose access level is not `full` is signed or rendered.
       OR billing_internal.tenant_access_level(t.tenant_id, now()) IS DISTINCT FROM 'full' THEN
        RETURN NULL;
    END IF;

    v_rid := COALESCE(t.resource_id, CASE WHEN t.resource_type = 'patient_document' THEN t.document_id END);
    v_res := public.share_token_resource(t.tenant_id, t.resource_type, v_rid);
    IF v_res IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'tenant_id', t.tenant_id,
        'resource_type', t.resource_type,
        'resource_id', v_rid,
        'bucket', v_res ->> '_bucket',
        'storage_path', v_res ->> '_storage_path',
        'original_filename', v_res ->> 'original_filename'
    );
END;
$function$;


-- 4. Jobs of non-full clinics are cancelled at claim time (R-27) --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_jobs(p_kinds text[], p_batch integer, p_lease_seconds integer, p_worker text, p_per_tenant integer DEFAULT 10)
 RETURNS TABLE(id uuid, kind text, tenant_id uuid, payload jsonb, attempts integer, max_attempts integer, lease_token uuid, run_at timestamp with time zone, claim_order integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
#variable_conflict use_column
DECLARE
    -- Groups the tenant-less jobs (tenant_id NULL) as one "tenant" for fairness.
    v_none CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
    -- 05-10a (R-27): kinds that still run for a clinic that is not `full` (closed set; V2-13b adds owner billing
    -- notices). Empty in V2-05.
    v_exempt CONSTANT TEXT[] := ARRAY[]::TEXT[];
BEGIN
    IF p_kinds IS NULL OR cardinality(p_kinds) NOT BETWEEN 1 AND 50
       OR p_batch IS NULL OR p_batch NOT BETWEEN 1 AND 100
       OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 900
       OR p_per_tenant IS NULL OR p_per_tenant NOT BETWEEN 1 AND 100
       OR p_worker IS NULL OR btrim(p_worker) = '' THEN
        RAISE EXCEPTION 'invalid_claim' USING ERRCODE = '22023';
    END IF;

    -- 05-10a (R-27): due jobs of a clinic whose access level is not `full` are cancelled, never claimed, so a locked
    -- clinic sends no patient message and none is sent late after a renewal. Rows another runner holds are skipped.
    UPDATE ops.jobs j
       SET status = 'cancelled',
           last_error = 'tenant_not_full',
           finished_at = now(),
           locked_until = NULL,
           lease_token = NULL,
           locked_by = NULL,
           updated_at = now()
      FROM (
          SELECT x.id
            FROM ops.jobs x
           WHERE x.kind = ANY (p_kinds)
             AND NOT (x.kind = ANY (v_exempt))
             AND x.tenant_id IS NOT NULL
             AND ((x.status = 'pending' AND x.run_at <= now())
                  OR (x.status = 'running' AND x.locked_until < now() AND x.attempts < x.max_attempts))
             AND billing_internal.tenant_access_level(x.tenant_id, now()) IS DISTINCT FROM 'full'
           FOR UPDATE OF x SKIP LOCKED
      ) c
     WHERE j.id = c.id;

    -- Due = pending and run_at reached, or running with an expired lease and attempts left (a crashed or timed-out
    -- runner's job; a job that never started has attempts < max_attempts by construction). The due condition is
    -- repeated inside the locking subquery so that a row another runner claimed and committed after this statement's
    -- snapshot is re-checked on its new version and skipped.
    RETURN QUERY
    WITH due AS (
        SELECT coalesce(d.tenant_id, v_none) AS t, min(d.run_at) AS oldest
        FROM ops.jobs d
        WHERE d.kind = ANY (p_kinds)
          AND ((d.status = 'pending' AND d.run_at <= now())
               OR (d.status = 'running' AND d.locked_until < now() AND d.attempts < d.max_attempts))
        GROUP BY 1
    ),
    due_tenants AS (
        -- N-1: least recently served first (never served first), then oldest due work; at most one batch of tenants.
        -- N-1b: a hand-back restores the row's previous stamp, so only claims that were started count here.
        SELECT du.t, du.oldest, s.served
        FROM due du
        CROSS JOIN LATERAL (
            SELECT CASE
                       WHEN du.t = v_none THEN
                           (SELECT max(n.last_claimed_at) FROM ops.jobs n WHERE n.tenant_id IS NULL)
                       ELSE
                           (SELECT max(m.last_claimed_at) FROM ops.jobs m WHERE m.tenant_id = du.t)
                   END AS served
        ) s
        ORDER BY s.served ASC NULLS FIRST, du.oldest, du.t
        LIMIT p_batch
    ),
    locked AS (
        -- Up to p_per_tenant unlocked due rows per tenant (the per-tenant LIMIT in a LATERAL; FOR UPDATE cannot share a
        -- query level with the window functions below, which therefore sit in their own CTEs).
        SELECT x.id, x.run_at, dt.t, dt.oldest, dt.served
        FROM due_tenants dt
        CROSS JOIN LATERAL (
            SELECT j.id, j.run_at
            FROM ops.jobs j
            WHERE ((dt.t = v_none AND j.tenant_id IS NULL) OR j.tenant_id = dt.t)
              AND j.kind = ANY (p_kinds)
              AND ((j.status = 'pending' AND j.run_at <= now())
                   OR (j.status = 'running' AND j.locked_until < now() AND j.attempts < j.max_attempts))
            ORDER BY j.run_at, j.id
            LIMIT p_per_tenant
            FOR UPDATE OF j SKIP LOCKED
        ) x
    ),
    ranked AS (
        SELECT l.id, l.run_at, l.t, l.oldest, l.served,
               row_number() OVER (PARTITION BY l.t ORDER BY l.run_at, l.id) AS turn
        FROM locked l
    ),
    fair AS (
        -- Round-robin: every chosen tenant's first row, then every tenant's second, ...; within a round, the least
        -- recently served tenant first, then the oldest work. Round 1 has at most p_batch rows (one per chosen
        -- tenant), so every chosen tenant with an unlocked due row gets one. claim_order is this position (1 = first);
        -- the runner starts the batch in this order (N-1b).
        SELECT o.id, o.claim_order
        FROM (
            SELECT r.id,
                   row_number() OVER (ORDER BY r.turn, r.served ASC NULLS FIRST, r.oldest, r.t, r.run_at, r.id)
                       AS claim_order
            FROM ranked r
        ) o
        WHERE o.claim_order <= p_batch
    ),
    claimed AS (
        UPDATE ops.jobs j
           SET status = 'running',
               locked_until = now() + make_interval(secs => p_lease_seconds),
               lease_token = gen_random_uuid(),
               locked_by = left(btrim(p_worker), 64),
               started_at = NULL,
               first_claimed_at = coalesce(j.first_claimed_at, now()),
               -- N-1b: the stamp a hand-back restores. A re-claim of a row whose lease expired before it started keeps
               -- the older value (that claim never ran either). Old-row values on the right-hand side.
               prev_last_claimed_at = CASE
                   WHEN j.status = 'running' AND j.started_at IS NULL THEN j.prev_last_claimed_at
                   ELSE j.last_claimed_at
               END,
               last_claimed_at = now(),
               -- Old-row value: a re-claim of a running row means its previous lease expired.
               last_lease_expired_at = CASE WHEN j.status = 'running' THEN now() ELSE j.last_lease_expired_at END,
               updated_at = now()
          FROM fair f
         WHERE j.id = f.id
        RETURNING j.id, j.kind, j.tenant_id, j.payload, j.attempts, j.max_attempts, j.lease_token, j.run_at,
                  f.claim_order::INTEGER AS claim_order
    )
    SELECT c.id, c.kind, c.tenant_id, c.payload, c.attempts, c.max_attempts, c.lease_token, c.run_at, c.claim_order
    FROM claimed c
    ORDER BY c.claim_order;
END;
$function$;
