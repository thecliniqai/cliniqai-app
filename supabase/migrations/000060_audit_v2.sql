-- Migration: 000060_audit_v2.sql
-- V2-05 plan 05-02c (P1-04 trigger part, PO-3; rulings R-20, R-42; threats T-05-08, T-05-12, T-05-39; V2-03 03-07
-- handover "record_payment: has_permission and a DB-checked p_tenant_id").
--
-- 1. `public.log_audit(...)`: the only way a signed-in user writes an audit row. SECURITY DEFINER; requires a session
--    and `p_tenant = authz.active_tenant_id()` (a membership of the active clinic, R-42), else 42501 ACTOR_INVALID; the
--    actor is the session (`actor_id = auth.uid()`, `actor_role` = the caller's role in that clinic, `actor_type =
--    'user'`, no api key, no `system_actor` in the metadata). Input is bounded (action/entity type shape, metadata an
--    object of at most 4 KiB). The caller-side metadata allow-list (`lib/audit/audit.ts` ALLOWED_METADATA_KEYS) is
--    unchanged; this function never receives PHI from the app.
-- 2. `audit_logs` INSERT is revoked from authenticated and anon and the "any member inserts" policy is dropped: a user
--    can no longer insert a row with a forged actor, tenant or role (before: any member of a clinic inserted rows for
--    it, and the 000029 guard only re-stamped the actor). SELECT moves to clinic:manage in the active clinic.
-- 3. `private.audit_logs_actor_guard` (000029, same name, `create or replace`): defence in depth behind the revoke — an
--    API-role writer (a future invoker path or a re-grant) whose row's tenant is not the active clinic is refused with
--    42501 (before: it only skipped the role lookup and let the row through).
-- 4. `public.record_payment` (V2-03 03-07; same signature, 000029 body otherwise): the user path checks the DB-side
--    active tenant (`p_tenant_id = authz.active_tenant_id()`, else INVOICE_NOT_FOUND / P0002: the server-supplied
--    tenant is no longer trusted) and `has_permission(p_tenant_id, 'billing:collect')` (else FORBIDDEN / 42501) BEFORE
--    the invoice is read, so a doctor or nurse is refused for the permission, not for an invoice their RLS hides; its
--    audit row goes through `log_audit` (the INSERT revoke would refuse the direct insert). The system path
--    (service_role + system actor), replay rules and the `clinicos.record_payment_id` marker are unchanged.
-- 5. `private.log_system_audit(...)`: the system path's writer (SECURITY DEFINER, EXECUTE for service_role only, the
--    closed system-actor set). `record_payment`'s system branch calls it, so no SECURITY INVOKER function inserts into
--    audit_logs at all.
-- Catalogue review: `record_payment` was the only SECURITY INVOKER function whose source inserts into audit_logs
-- (`pg_proc where not prosecdef and prosrc ~* 'insert into public.audit_logs'`); audit_v2.test.sql pins that none is
-- left. The definer writers (create/revoke_share_token, change_member_role, communication_queue_apply_dlr) insert as
-- the function owner and are bound to the active clinic in 000061.

-- 1. log_audit -------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.log_audit(
    p_tenant UUID,
    p_action TEXT,
    p_entity_type TEXT,
    p_entity_id UUID,
    p_metadata JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_role TEXT;
    v_id BIGINT;
BEGIN
    IF v_uid IS NULL OR p_tenant IS NULL OR p_tenant IS DISTINCT FROM authz.active_tenant_id() THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;

    SELECT m.role INTO v_role
      FROM public.memberships m
     WHERE m.tenant_id = p_tenant
       AND m.user_id = v_uid;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;

    IF p_action IS NULL OR p_action !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$' OR char_length(p_action) > 100
       OR p_entity_type IS NULL OR p_entity_type !~ '^[a-z][a-z0-9_]{0,49}$'
       OR (p_metadata IS NOT NULL AND (jsonb_typeof(p_metadata) <> 'object' OR octet_length(p_metadata::text) > 4096)) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, actor_type, api_key_id, action, entity_type, entity_id, metadata)
    VALUES (
        p_tenant,
        v_uid,
        v_role,
        'user',
        NULL,
        p_action,
        p_entity_type,
        p_entity_id,
        CASE WHEN p_metadata IS NULL THEN NULL ELSE p_metadata - 'system_actor' END
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit(UUID, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_audit(UUID, TEXT, TEXT, UUID, JSONB) TO authenticated;

COMMENT ON FUNCTION public.log_audit(UUID, TEXT, TEXT, UUID, JSONB) IS
    'V2-05 05-02c (R-20, T-05-12): a signed-in user''s audit row, actor forced from the session, tenant = active clinic.';

-- 1b. log_system_audit (service_role only)--------------------------------------------------------------------------
CREATE FUNCTION private.log_system_audit(
    p_tenant UUID,
    p_system_actor TEXT,
    p_action TEXT,
    p_entity_type TEXT,
    p_entity_id UUID,
    p_metadata JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id BIGINT;
BEGIN
    IF auth.uid() IS NOT NULL OR p_tenant IS NULL OR p_system_actor IS NULL
       OR p_system_actor NOT IN ('system:payment_webhook') THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_metadata IS NOT NULL AND jsonb_typeof(p_metadata) <> 'object' THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, actor_type, action, entity_type, entity_id, metadata)
    VALUES (
        p_tenant, NULL, 'system', 'system', p_action, p_entity_type, p_entity_id,
        coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('system_actor', p_system_actor)
    )
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION private.log_system_audit(UUID, TEXT, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.log_system_audit(UUID, TEXT, TEXT, TEXT, UUID, JSONB) TO service_role;

-- 2. INSERT revoke + policies ----------------------------------------------------------------------------------------
DROP POLICY audit_logs_insert_member ON public.audit_logs;
DROP POLICY audit_logs_select_owner_admin ON public.audit_logs;

CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));

REVOKE INSERT ON public.audit_logs FROM authenticated, anon;
REVOKE ALL ON SEQUENCE public.audit_logs_id_seq FROM authenticated, anon;

-- 3. actor guard (defence in depth) ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.audit_logs_actor_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
BEGIN
    IF current_user IN ('authenticated', 'anon') THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
        END IF;
        -- 05-02c: an API-role writer writes only for its active clinic (R-42).
        IF NEW.tenant_id IS NULL OR NEW.tenant_id IS DISTINCT FROM authz.active_tenant_id() THEN
            RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
        END IF;
        NEW.actor_id := auth.uid();
        NEW.actor_type := 'user';
        NEW.api_key_id := NULL;
        IF NEW.metadata IS NOT NULL AND jsonb_typeof(NEW.metadata) = 'object' THEN
            NEW.metadata := NEW.metadata - 'system_actor';
        END IF;
        SELECT m.role INTO v_role
        FROM public.memberships m
        WHERE m.tenant_id = NEW.tenant_id
          AND m.user_id = auth.uid();
        IF v_role IS NOT NULL THEN
            NEW.actor_role := v_role;
        ELSIF NEW.actor_role = 'system' THEN
            RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 4. record_payment -------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_payment(
    p_tenant_id UUID,
    p_invoice_id UUID,
    p_amount NUMERIC,
    p_method TEXT,
    p_reference TEXT,
    p_command_id UUID,
    p_notes TEXT DEFAULT NULL,
    p_system_actor TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
SET lock_timeout = '2s'
AS $$
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
        AND current_user = 'service_role'
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
        IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM authz.active_tenant_id() THEN
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
$$;
