-- Migration: 000072_billing_totals_rpc_only.sql
-- V2-05 fix plan 05-11b, finding M-INVOICE, billing part (05a review IND M2, RLS L-1, IND Info 3). The visit
-- `doctor_id` part of M-INVOICE is 05-11a's.
--
-- Before: `invoices_update` admitted every column to collectors and to the doctor of the invoice's visit, so a doctor
-- could set their visit's invoice to `paid` (or zero its total) with no payment row, no `invoice.payment_recorded`
-- audit and no outbox event; and a collector could INSERT `payments` directly, bypassing record_payment's
-- overpayment check, status transition, audit and outbox.
--
-- 1. invoices: UPDATE is revoked from anon/authenticated and `invoices_update` is dropped (matrix: rpc_only). The
--    totals and the status are derived, never typed:
--      - `private.invoices_insert_guard` (BEFORE INSERT, user path = current_user authenticated/anon): status only
--        `draft` or `issued` (42501 INVOICE_STATUS_RPC_ONLY otherwise: "paid" comes only from record_payment);
--        subtotal/discount/tax not negative (P0001 INPUT_INVALID); `total_amount` is stamped as
--        greatest(subtotal - discount + tax, 0), the formula the app already used.
--      - `private.invoice_items_sync_invoice` (AFTER INSERT/UPDATE/DELETE on invoice_items, every writer, SECURITY
--        DEFINER because callers hold no UPDATE on invoices): recomputes the invoice's subtotal (sum of its items'
--        total_price), total_amount, and for an `issued`/`paid` invoice the status (`paid` iff payments cover a total
--        above 0, else `issued`; `draft`/`cancelled` are left alone), under the invoice row lock. This replaces the
--        recompute the app ran after adding or removing a charge (features/billing/service.ts), which needed the
--        UPDATE grant.
-- 2. payments: INSERT is revoked from authenticated and `payments_insert` is dropped (matrix: rpc_only). Paying goes
--    through `public.record_payment` only (billing:collect, payment row, audit, outbox in one transaction).
-- 3. `public.record_payment` becomes SECURITY DEFINER (body unchanged otherwise): the caller no longer holds the
--    privileges it writes with. Its own checks already bind it: the user path needs a session, p_tenant_id = the active
--    clinic (else INVOICE_NOT_FOUND) and billing:collect there (else 42501 FORBIDDEN); the system path is the service
--    role (now read from the `role` setting, since current_user is the owner inside a definer) with a system actor
--    from the closed set. EXECUTE stays authenticated + service_role. payments_actor_guard is unchanged (it stamps
--    recorded_by on the user path; record_payment writes it explicitly).
-- Per-migration checklist: two new private functions (no EXECUTE for API roles: trigger functions), one definer
-- conversion (definer_functions.test.sql), grants only narrow; no data changed. Expand-safe for the previous app build
-- except its own totals recompute after an item change, which now fails silently (its result was never checked) while
-- the trigger keeps the totals right.

-- 1. invoices ------------------------------------------------------------------------------------------------------------
REVOKE UPDATE ON public.invoices FROM anon, authenticated;
DROP POLICY invoices_update ON public.invoices;

CREATE FUNCTION private.invoices_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF current_user NOT IN ('authenticated', 'anon') THEN
        RETURN NEW;
    END IF;
    IF NEW.status NOT IN ('draft', 'issued') THEN
        RAISE EXCEPTION 'INVOICE_STATUS_RPC_ONLY' USING ERRCODE = '42501';
    END IF;
    IF NEW.subtotal < 0 OR NEW.discount < 0 OR NEW.tax < 0 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    NEW.total_amount := GREATEST(NEW.subtotal - NEW.discount + NEW.tax, 0);
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.invoices_insert_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER invoices_insert_guard
BEFORE INSERT ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION private.invoices_insert_guard();

CREATE FUNCTION private.invoice_items_sync_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_keys UUID[][];
    v_tenant UUID;
    v_invoice UUID;
    v_inv RECORD;
    v_subtotal NUMERIC;
    v_total NUMERIC;
    v_paid NUMERIC;
    i INT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_keys := ARRAY[ARRAY[OLD.tenant_id, OLD.invoice_id]];
    ELSIF TG_OP = 'UPDATE' AND (OLD.tenant_id, OLD.invoice_id) IS DISTINCT FROM (NEW.tenant_id, NEW.invoice_id) THEN
        v_keys := ARRAY[ARRAY[OLD.tenant_id, OLD.invoice_id], ARRAY[NEW.tenant_id, NEW.invoice_id]];
    ELSE
        v_keys := ARRAY[ARRAY[NEW.tenant_id, NEW.invoice_id]];
    END IF;

    FOR i IN 1 .. array_length(v_keys, 1) LOOP
        v_tenant := v_keys[i][1];
        v_invoice := v_keys[i][2];

        SELECT inv.discount, inv.tax, inv.status
          INTO v_inv
          FROM public.invoices inv
         WHERE inv.tenant_id = v_tenant AND inv.id = v_invoice
           FOR UPDATE;
        CONTINUE WHEN NOT FOUND; -- the invoice itself is being deleted (cascade)

        SELECT COALESCE(sum(it.total_price), 0) INTO v_subtotal
          FROM public.invoice_items it
         WHERE it.tenant_id = v_tenant AND it.invoice_id = v_invoice;
        v_total := GREATEST(v_subtotal - v_inv.discount + v_inv.tax, 0);

        SELECT COALESCE(sum(p.amount), 0) INTO v_paid
          FROM public.payments p
         WHERE p.tenant_id = v_tenant AND p.invoice_id = v_invoice;

        UPDATE public.invoices inv
           SET subtotal = v_subtotal,
               total_amount = v_total,
               status = CASE
                            WHEN inv.status IN ('issued', 'paid')
                                THEN CASE WHEN v_total > 0 AND v_paid >= v_total THEN 'paid' ELSE 'issued' END
                            ELSE inv.status
                        END,
               updated_at = now()
         WHERE inv.tenant_id = v_tenant AND inv.id = v_invoice;
    END LOOP;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.invoice_items_sync_invoice() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER invoice_items_sync_invoice
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW
EXECUTE FUNCTION private.invoice_items_sync_invoice();

-- 2. payments ------------------------------------------------------------------------------------------------------------
REVOKE INSERT ON public.payments FROM anon, authenticated;
DROP POLICY payments_insert ON public.payments;

-- 3. record_payment: SECURITY DEFINER ---------------------------------------------------------------------------------
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
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
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

REVOKE ALL ON FUNCTION public.record_payment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, TEXT) TO authenticated, service_role;
