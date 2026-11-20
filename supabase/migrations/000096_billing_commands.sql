-- Migration: 000096_billing_commands.sql
-- V2-07 07-02 (R-1, R-2, R-3, R-6, R-7): the billing write path as atomic server commands.
--
-- Before: createVisitInvoice made four round trips (number RPC with a `INV-<year>-<Date.now()>` fallback, invoice insert,
-- items insert, app-side audit) and the checkout drawer chained it with record_payment as two commands. A failure after
-- the invoice insert left a live empty invoice that later retries returned; a guessed number could collide.
--
-- 1. private.invoice_items_normalize(jsonb): validates and normalises a command's item list (the createInvoiceSchema
--    rules plus bounds the numeric(10,2) columns need). INVOKER, no API grant: only the definer steps call it.
-- 2. private.step_create_invoice(...): the one invoice-creation body. Locks the visit, returns the visit's live invoice
--    (existing = true, nothing written) or creates it: number from generate_tenant_invoice_number only (R-6; a failure
--    fails the command; an advisory lock per clinic serialises numbering so two visits cannot draw the same number),
--    header, items (the invoice_items triggers recompute the totals) and the invoice.create audit row.
-- 3. private.step_record_payment(...): the payment body of record_payment (invariants, payment, status transition,
--    audit, outbox), unchanged in behaviour. public.record_payment keeps its signature, actor rule, replay and guards and
--    now calls it; collect_payment calls the same step (R-7). 07-03 complete_and_bill will too.
-- 4. public.create_invoice(...) and public.collect_payment(...): SECURITY DEFINER commands (R-1: invoices and payments
--    cannot be written directly by authenticated), with the record_payment guard block (actor, active clinic,
--    has_permission), a command claim (R-2), the visit locked FOR NO KEY UPDATE (concurrent commands on one visit run
--    one after the other and see each other's invoice), the shared steps, and command_complete.
-- Per-migration checklist: two new public definer commands (EXECUTE: authenticated only; no system path), three private
-- functions with no API grant, one function body replaced (record_payment, same signature, grants unchanged). No table,
-- column or data change; expand-safe: the previous app build keeps calling record_payment unchanged.

-- 1. item normaliser ------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.invoice_items_normalize(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_out jsonb := '[]'::jsonb;
    v_elem jsonb;
    v_ord bigint;
    v_type text;
    v_desc text;
    v_unit numeric;
    v_qty numeric;
    v_subtotal numeric := 0;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    FOR v_elem, v_ord IN SELECT e.value, e.ordinality FROM jsonb_array_elements(p_items) WITH ORDINALITY e LOOP
        IF jsonb_typeof(v_elem) <> 'object' THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        -- item_type defaults to 'consultation' and quantity to 1 (createInvoiceSchema).
        IF v_elem ? 'item_type' AND jsonb_typeof(v_elem -> 'item_type') <> 'string' THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_type := COALESCE(v_elem ->> 'item_type', 'consultation');
        IF v_type NOT IN ('consultation', 'procedure', 'medicine', 'other') THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        IF jsonb_typeof(v_elem -> 'description') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_desc := btrim(v_elem ->> 'description');
        IF char_length(v_desc) NOT BETWEEN 1 AND 200 OR v_desc ~ '[[:cntrl:]]' THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        IF jsonb_typeof(v_elem -> 'unit_price') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_unit := round((v_elem ->> 'unit_price')::numeric, 2);
        IF v_unit < 0 OR v_unit > 1000000 THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        IF v_elem ? 'quantity' AND jsonb_typeof(v_elem -> 'quantity') <> 'number' THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_qty := COALESCE((v_elem ->> 'quantity')::numeric, 1);
        IF v_qty <> trunc(v_qty) OR v_qty < 1 OR v_qty > 99 THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;

        v_subtotal := v_subtotal + round(v_unit * v_qty, 2);
        v_out := v_out || jsonb_build_array(jsonb_build_object(
            'item_type', v_type, 'description', v_desc, 'unit_price', v_unit, 'quantity', v_qty::integer
        ));
    END LOOP;

    -- numeric(10,2) holds below 100,000,000 (invoices.subtotal).
    IF v_subtotal >= 100000000 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION private.invoice_items_normalize(jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.invoice_items_normalize(jsonb) IS
    'V2-07 07-02: validates a command''s invoice item list (1-50 items, closed item_type, description 1-200, unit price 0-1,000,000 at 2 decimals, whole quantity 1-99, subtotal below 100,000,000) and returns it normalised. INPUT_INVALID (P0001).';

-- 2. step: get or create the visit's invoice --------------------------------------------------------------------------------
CREATE FUNCTION private.step_create_invoice(
    p_tenant_id uuid,
    p_visit_id uuid,
    p_items jsonb,
    p_discount numeric,
    p_tax numeric
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_visit RECORD;
    v_inv RECORD;
    v_items jsonb;
    v_number text;
    v_invoice_id uuid;
    v_subtotal numeric;
    v_discount numeric;
    v_tax numeric;
    v_total numeric;
BEGIN
    -- The visit is the aggregate root: commands on one visit run one after the other (NO KEY UPDATE conflicts with itself
    -- but not with the key-share locks other rows take on the visit).
    SELECT v.id, v.patient_id INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- One live (not cancelled) invoice per visit (invoices_one_live_per_visit, 000024): it is returned, nothing is written.
    SELECT i.id, i.invoice_number, i.status, i.total_amount INTO v_inv
      FROM public.invoices i
     WHERE i.tenant_id = p_tenant_id AND i.visit_id = p_visit_id AND i.status <> 'cancelled'
       FOR UPDATE;
    IF FOUND THEN
        RETURN jsonb_build_object(
            'invoice_id', v_inv.id, 'invoice_number', v_inv.invoice_number, 'status', v_inv.status,
            'total_amount', v_inv.total_amount, 'existing', true
        );
    END IF;

    v_items := private.invoice_items_normalize(p_items);
    v_discount := round(COALESCE(p_discount, 0), 2);
    v_tax := round(COALESCE(p_tax, 0), 2);
    IF v_discount < 0 OR v_discount >= 100000000 OR v_tax < 0 OR v_tax >= 100000000 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(sum(round(x.unit_price * x.quantity, 2)), 0) INTO v_subtotal
      FROM jsonb_to_recordset(v_items) AS x(unit_price numeric, quantity integer);
    v_total := GREATEST(v_subtotal - v_discount + v_tax, 0);
    IF v_total >= 100000000 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- R-6: the number comes from the sequence function only. It counts the year's numbers, so numbering is serialised per
    -- clinic until commit (lock_timeout 2s bounds the wait); a failure here fails the command, there is no fallback.
    PERFORM pg_advisory_xact_lock(hashtextextended('invoice_number:' || p_tenant_id::text, 0));
    v_number := public.generate_tenant_invoice_number(p_tenant_id);

    INSERT INTO public.invoices (tenant_id, visit_id, patient_id, invoice_number, subtotal, discount, tax, total_amount, status)
    VALUES (p_tenant_id, p_visit_id, v_visit.patient_id, v_number, v_subtotal, v_discount, v_tax, v_total, 'issued')
    RETURNING id INTO v_invoice_id;

    -- The invoice_items triggers (000072/000075) recompute subtotal and total from these rows.
    INSERT INTO public.invoice_items (tenant_id, invoice_id, item_type, description, unit_price, quantity, total_price)
    SELECT p_tenant_id, v_invoice_id, e.value ->> 'item_type', e.value ->> 'description',
           (e.value ->> 'unit_price')::numeric, (e.value ->> 'quantity')::integer,
           round((e.value ->> 'unit_price')::numeric * (e.value ->> 'quantity')::integer, 2)
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(value, ord)
     ORDER BY e.ord;

    PERFORM public.log_audit(p_tenant_id, 'invoice.create', 'invoice', v_invoice_id,
                             jsonb_build_object('invoice_number', v_number, 'total_amount', v_total));

    RETURN jsonb_build_object(
        'invoice_id', v_invoice_id, 'invoice_number', v_number, 'status', 'issued',
        'total_amount', v_total, 'existing', false
    );
END;
$$;
REVOKE ALL ON FUNCTION private.step_create_invoice(uuid, uuid, jsonb, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.step_create_invoice(uuid, uuid, jsonb, numeric, numeric) IS
    'V2-07 07-02 (R-6, R-7): the visit''s live invoice, or a new one (number, header, items, invoice.create audit) in the caller''s transaction. The caller has checked actor, clinic and permission and holds the command claim; no API grant.';

-- 3. step: record a payment ---------------------------------------------------------------------------------------------------
CREATE FUNCTION private.step_record_payment(
    p_tenant_id uuid,
    p_invoice_id uuid,
    p_amount numeric,
    p_method text,
    p_reference text,
    p_notes text,
    p_command_id uuid,
    p_system_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_is_system boolean := p_system_actor IS NOT NULL;
    v_invoice RECORD;
    v_paid numeric;
    v_payment_id uuid;
    v_new_status text;
    v_reference text := NULLIF(btrim(p_reference), '');
    v_notes text := NULLIF(btrim(p_notes), '');
    v_metadata jsonb;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) OR p_amount >= 100000000 THEN
        RAISE EXCEPTION 'AMOUNT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('cash', 'upi', 'card') THEN
        RAISE EXCEPTION 'METHOD_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF char_length(v_reference) > 100 OR char_length(v_notes) > 500 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- The aggregate root, in the given tenant only (a second lock in the same transaction is a no-op).
    SELECT i.id, i.tenant_id, i.total_amount, i.status INTO v_invoice
      FROM public.invoices i
     WHERE i.id = p_invoice_id AND i.tenant_id = p_tenant_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- Invariants.
    IF v_invoice.status NOT IN ('draft', 'issued') THEN
        RAISE EXCEPTION 'INVOICE_NOT_PAYABLE' USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(sum(p.amount), 0) INTO v_paid
      FROM public.payments p
     WHERE p.invoice_id = v_invoice.id AND p.tenant_id = v_invoice.tenant_id;
    IF p_amount > v_invoice.total_amount - v_paid THEN
        RAISE EXCEPTION 'OVERPAYMENT' USING ERRCODE = 'P0001';
    END IF;

    -- Payment. The id is chosen here and marked transaction-locally for the actor guard and the outbox writer.
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

    -- Status transition.
    v_paid := v_paid + p_amount;
    v_new_status := CASE WHEN v_paid >= v_invoice.total_amount THEN 'paid' ELSE v_invoice.status END;
    IF v_new_status <> v_invoice.status THEN
        UPDATE public.invoices SET status = v_new_status, updated_at = now() WHERE id = v_invoice.id;
    END IF;

    -- Audit (same transaction): the session's actor on the user path, the system actor on the system path.
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

    -- Outbox (same transaction), then clear the marker.
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
REVOKE ALL ON FUNCTION private.step_record_payment(uuid, uuid, numeric, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.step_record_payment(uuid, uuid, numeric, text, text, text, uuid, text) IS
    'V2-07 07-02 (R-7): the payment body shared by record_payment, collect_payment and (07-03) complete_and_bill: lock the invoice, refuse a settled invoice or an overpayment, insert the payment, move the invoice to paid, audit, payment.recorded outbox. A non-null p_system_actor is the system path. The caller has checked actor, clinic and permission; no API grant.';

-- record_payment: steps 6-10 moved to the shared step; the guard block, input checks and replay are unchanged -------------------
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
    v_reference TEXT := NULLIF(btrim(p_reference), '');
    v_notes TEXT := NULLIF(btrim(p_notes), '');
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

    -- 3. User path: the tenant is the session's ACTIVE clinic, and the caller collects there (billing:collect, PO-3).
    --    Another clinic reads as not found.
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

    -- 6.-10. Invariants, payment, status transition, audit, outbox: the shared step (V2-07 07-02, R-7).
    RETURN private.step_record_payment(v_invoice.tenant_id, v_invoice.id, p_amount, p_method, v_reference, v_notes,
                                       p_command_id, CASE WHEN v_is_system THEN p_system_actor ELSE NULL END);
END;
$function$;

-- 4a. create_invoice ----------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.create_invoice(
    p_tenant_id uuid,
    p_visit_id uuid,
    p_items jsonb,
    p_client_request_id uuid,
    p_discount numeric DEFAULT 0,
    p_tax numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_doctor uuid;
    v_replay jsonb;
    v_step jsonb;
    v_result jsonb;
BEGIN
    -- 1. Actor: a session; this command has no system path.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. The tenant is the session's ACTIVE clinic; another clinic reads as not found. Permission: a collector, or a
    --    clinician (consultations:edit) who is the visit's doctor (Sign & Bill, checked on the locked visit below).
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT (public.has_permission(p_tenant_id, 'billing:collect') OR public.has_permission(p_tenant_id, 'consultations:edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim; a replay returns the first result and writes nothing.
    v_replay := private.command_claim(
        p_tenant_id, p_client_request_id, 'public.create_invoice',
        md5(jsonb_build_object('visit', p_visit_id, 'items', p_items, 'discount', COALESCE(p_discount, 0), 'tax', COALESCE(p_tax, 0))::text)
    );
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the visit; the fine permission needs its doctor.
    SELECT v.doctor_id INTO v_doctor
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT (public.has_permission(p_tenant_id, 'billing:collect')
            OR (public.has_permission(p_tenant_id, 'consultations:edit') AND v_doctor IS NOT DISTINCT FROM v_uid)) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- 5. Writes, audit (in the step), result.
    v_step := private.step_create_invoice(p_tenant_id, p_visit_id, p_items, p_discount, p_tax);
    v_result := v_step || jsonb_build_object('replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.create_invoice(uuid, uuid, jsonb, uuid, numeric, numeric) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_invoice(uuid, uuid, jsonb, uuid, numeric, numeric) TO authenticated;
COMMENT ON FUNCTION public.create_invoice(uuid, uuid, jsonb, uuid, numeric, numeric) IS
    'V2-07 07-02 (R-1, R-6): creates the visit''s invoice (number, header, items, invoice.create audit) in one transaction, or returns its live invoice (existing = true). A collector (billing:collect) or the visit''s own doctor. Idempotent by p_client_request_id. Result: invoice_id, invoice_number, status, total_amount, existing, replayed.';

-- 4b. collect_payment -----------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.collect_payment(
    p_tenant_id uuid,
    p_visit_id uuid,
    p_items jsonb,
    p_amount numeric,
    p_method text,
    p_reference text,
    p_notes text,
    p_client_request_id uuid,
    p_discount numeric DEFAULT 0,
    p_tax numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_reference text := NULLIF(btrim(p_reference), '');
    v_notes text := NULLIF(btrim(p_notes), '');
    v_replay jsonb;
    v_visit_ok boolean;
    v_inv jsonb;
    v_pay jsonb;
    v_result jsonb;
BEGIN
    -- 1. Actor: a session; this command has no system path.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then billing:collect there (PO-3: owner, admin, receptionist).
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'billing:collect') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    -- Input (the payment rules of record_payment; the item list is validated when an invoice is created).
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) OR p_amount >= 100000000 THEN
        RAISE EXCEPTION 'AMOUNT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('cash', 'upi', 'card') THEN
        RAISE EXCEPTION 'METHOD_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF char_length(v_reference) > 100 OR char_length(v_notes) > 500 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim; a replay returns the first result and writes nothing.
    v_replay := private.command_claim(
        p_tenant_id, p_client_request_id, 'public.collect_payment',
        md5(jsonb_build_object('visit', p_visit_id, 'items', p_items, 'amount', p_amount, 'method', p_method,
                               'reference', v_reference, 'notes', v_notes,
                               'discount', COALESCE(p_discount, 0), 'tax', COALESCE(p_tax, 0))::text)
    );
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Get or create the visit's invoice (locks the visit), then pay it in the same transaction.
    SELECT true INTO v_visit_ok
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    v_inv := private.step_create_invoice(p_tenant_id, p_visit_id, p_items, p_discount, p_tax);
    v_pay := private.step_record_payment(p_tenant_id, (v_inv ->> 'invoice_id')::uuid, p_amount, p_method, v_reference,
                                         v_notes, p_client_request_id, NULL);

    v_result := (v_pay - 'replayed') || jsonb_build_object(
        'invoice_id', v_inv -> 'invoice_id',
        'invoice_number', v_inv -> 'invoice_number',
        'invoice_created', NOT (v_inv ->> 'existing')::boolean,
        'replayed', false
    );
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.collect_payment(uuid, uuid, jsonb, numeric, text, text, text, uuid, numeric, numeric) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.collect_payment(uuid, uuid, jsonb, numeric, text, text, text, uuid, numeric, numeric) TO authenticated;
COMMENT ON FUNCTION public.collect_payment(uuid, uuid, jsonb, numeric, text, text, text, uuid, numeric, numeric) IS
    'V2-07 07-02 (R-7): desk checkout in one transaction: the visit''s live invoice (created from p_items when there is none) and the payment (balance cap, status, audit, payment.recorded outbox). billing:collect. Idempotent by p_client_request_id. Result: invoice_id, invoice_number, invoice_created, payment_id, invoice_status, paid_total, total_amount, balance_due, replayed.';
