-- Migration: 000027_record_payment_rpc.sql
-- V2-03 plan 03-07: D1 confirmation spike (C18, R-2, AD-7; TARGET_ARCHITECTURE §3.2, §6, §7.1).
--
-- One atomic command end to end as a SECURITY INVOKER plpgsql function called through the user-scoped supabase-js
-- client: the invoice row lock, the invariants, the payment insert, the status transition, the audit row and the
-- outbox rows commit or roll back together, under the caller's RLS, with `auth.uid()` as the actor.
--
-- Expand only. Nothing is dropped; existing readers and writers keep working:
--   payments.command_id          client-generated idempotency key, unique per tenant when present
--   payments.recorded_by_system  the closed system actor of a payment recorded on the system path (TARGET §7.1);
--                                exactly one of recorded_by / recorded_by_system is set (recorded_by loses NOT NULL)
--   authenticated/anon INSERT on payments becomes a column list without recorded_by_system, so a request-path
--   caller cannot forge a system payment. Contract step (revoke direct INSERT on payments and UPDATE of
--   invoices.status from authenticated so the RPC is the only writer) is handed to V2-07 (P1-05).
--
-- Outbox: webhook_subscriptions and webhook_delivery_queue are readable/writable by owner/admin only under RLS, so an
-- INVOKER function run by a doctor, nurse or receptionist cannot see the subscriptions it must fan out to. The fan-out
-- is therefore one SECURITY DEFINER writer, `private.outbox_payment_recorded(payment_id)`, in a schema PostgREST does
-- not expose. It takes only a payment id, builds the payload in SQL from that row, and refuses a payment that was not
-- inserted by the current transaction (row xmin = current transaction id) or, for a user caller, that lies outside
-- the caller's tenants. It cannot forge an event, replay an old payment or reach another tenant.
--
-- Timeouts: `SET lock_timeout = '2s'` bounds the wait for the invoice row lock (T-03-19); it is enforced per lock
-- wait inside the function. A function-level `SET statement_timeout` is NOT enforced for the statement that calls
-- the function (measured on the local stack, see 03-07-D1-SPIKE.md), so it is not set here: the role-level
-- `statement_timeout` of `authenticated` (8s locally) bounds the call.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. payments: idempotency key and system actor
-- ---------------------------------------------------------------------------------------------------------------------

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS command_id UUID;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS recorded_by_system TEXT;
ALTER TABLE public.payments ALTER COLUMN recorded_by DROP NOT NULL;

ALTER TABLE public.payments
    ADD CONSTRAINT payments_recorded_by_one_actor
    CHECK ((recorded_by IS NULL) <> (recorded_by_system IS NULL));

ALTER TABLE public.payments
    ADD CONSTRAINT payments_recorded_by_system_known
    CHECK (recorded_by_system IS NULL OR recorded_by_system IN ('system:payment_webhook'));

CREATE UNIQUE INDEX IF NOT EXISTS payments_tenant_command_id
    ON public.payments (tenant_id, command_id)
    WHERE command_id IS NOT NULL;

COMMENT ON COLUMN public.payments.command_id IS
    'V2-03 03-07: client-generated idempotency key of the record_payment command; unique per tenant when present.';
COMMENT ON COLUMN public.payments.recorded_by_system IS
    'V2-03 03-07: closed system actor of a payment recorded on the system path; written by the service role only.';

REVOKE INSERT ON public.payments FROM anon, authenticated;
GRANT INSERT (id, tenant_id, invoice_id, amount, payment_method, reference_number, notes, recorded_by, recorded_at, command_id)
    ON public.payments TO authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. private schema: definer helpers that INVOKER commands call, never served by PostgREST ([api] schemas)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

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
    SELECT p.id, p.tenant_id, p.invoice_id, p.amount, p.payment_method, p.recorded_at,
           (p.xmin = pg_current_xact_id()::xid) AS inserted_now
    INTO v_payment
    FROM public.payments p
    WHERE p.id = p_payment_id;

    IF NOT FOUND OR NOT v_payment.inserted_now THEN
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

    INSERT INTO public.webhook_delivery_queue
        (tenant_id, subscription_id, event_type, payload, status, retry_count, max_retries, next_retry_at)
    SELECT v_payment.tenant_id, s.id, 'payment.recorded', v_body, 'pending', 0, 5, now()
    FROM public.webhook_subscriptions s
    WHERE s.tenant_id = v_payment.tenant_id
      AND s.is_active
      AND s.event_types @> ARRAY['payment.recorded'];

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION private.outbox_payment_recorded(UUID) IS
    'V2-03 03-07: payment.recorded outbox fan-out for a payment inserted by the current transaction (definer: the outbox tables are owner/admin-only under RLS).';

REVOKE ALL ON FUNCTION private.outbox_payment_recorded(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.outbox_payment_recorded(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. public.record_payment: the atomic command
-- ---------------------------------------------------------------------------------------------------------------------
--
-- Errors (mapped to AppError by lib/db/errors.ts; the message is a machine reason, never data):
--   P0001 ACTOR_INVALID        neither a user session without p_system_actor, nor the service role with a known one
--   P0001 AMOUNT_INVALID       amount missing, <= 0, more than 2 decimals or too large
--   P0001 METHOD_INVALID       method outside cash/upi/card
--   P0001 INPUT_INVALID        reference > 100 or notes > 500 characters
--   P0002 INVOICE_NOT_FOUND    no such invoice in p_tenant_id, or RLS hides it (a tenant the caller is not in)
--   42501 FORBIDDEN            the caller's role in the invoice's tenant may not collect payments
--   P0001 IDEMPOTENCY_MISMATCH the command id was already used with a different invoice, amount or method
--   P0001 INVOICE_NOT_PAYABLE  the invoice is paid or cancelled
--   P0001 OVERPAYMENT          the amount exceeds the balance due
--   55P03                      the invoice row lock was not granted within lock_timeout
--
-- p_tenant_id is the caller's ACTIVE tenant, taken by the server from the session (ServiceContext.tenantId), never
-- from request input. It only narrows: RLS already limits the caller to tenants they belong to, but a member of
-- several clinics sees all of them, so without it a user working in clinic A could pay clinic B's invoice
-- (V2-02 AR-M2b; caught by the guard suite's dual-member leg). On the system path it is the tenant the job or
-- webhook resolved for its subject.
--
-- Returns { payment_id, invoice_status, paid_total, total_amount, balance_due, replayed }.

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
VOLATILE
SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_is_system BOOLEAN;
    v_actor_role TEXT;
    v_invoice RECORD;
    v_existing RECORD;
    v_paid NUMERIC;
    v_payment_id UUID;
    v_new_status TEXT;
    v_reference TEXT := NULLIF(btrim(p_reference), '');
    v_notes TEXT := NULLIF(btrim(p_notes), '');
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

    -- 3. Lock the aggregate root, in the active tenant only. Under RLS a tenant the caller is not in is invisible, and
    --    an invoice of another of the caller's tenants does not match p_tenant_id: not found, never "forbidden".
    SELECT i.id, i.tenant_id, i.total_amount, i.status
    INTO v_invoice
    FROM public.invoices i
    WHERE i.id = p_invoice_id
      AND i.tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- 4. Role. Mirrors ROLE_PERMISSIONS "appointments:edit" (the permission recordPayment checks) until V2-05
    --    has_permission(); tests/billing/record-payment-rpc.spec.ts keeps the list in parity with the matrix.
    IF NOT v_is_system THEN
        IF NOT public.current_user_has_role(
            v_invoice.tenant_id,
            ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']
        ) THEN
            RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
        END IF;

        SELECT m.role INTO v_actor_role
        FROM public.memberships m
        WHERE m.tenant_id = v_invoice.tenant_id
          AND m.user_id = v_uid;
    END IF;

    -- 5. Idempotent replay. Same-invoice duplicates are serialised by the lock above, so the first commit is seen here.
    IF p_command_id IS NOT NULL THEN
        SELECT p.id, p.invoice_id, p.amount, p.payment_method
        INTO v_existing
        FROM public.payments p
        WHERE p.tenant_id = v_invoice.tenant_id
          AND p.command_id = p_command_id;

        IF FOUND THEN
            IF v_existing.invoice_id <> v_invoice.id
                OR v_existing.amount <> p_amount
                OR v_existing.payment_method <> p_method THEN
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

    -- 7. Payment. Two statements: the user path never names recorded_by_system (no column privilege).
    IF v_is_system THEN
        INSERT INTO public.payments
            (tenant_id, invoice_id, amount, payment_method, reference_number, notes, recorded_by_system, command_id)
        VALUES
            (v_invoice.tenant_id, v_invoice.id, p_amount, p_method, v_reference, v_notes, p_system_actor, p_command_id)
        RETURNING id INTO v_payment_id;
    ELSE
        INSERT INTO public.payments
            (tenant_id, invoice_id, amount, payment_method, reference_number, notes, recorded_by, command_id)
        VALUES
            (v_invoice.tenant_id, v_invoice.id, p_amount, p_method, v_reference, v_notes, v_uid, p_command_id)
        RETURNING id INTO v_payment_id;
    END IF;

    -- 8. Status transition.
    v_paid := v_paid + p_amount;
    v_new_status := CASE WHEN v_paid >= v_invoice.total_amount THEN 'paid' ELSE v_invoice.status END;

    IF v_new_status <> v_invoice.status THEN
        UPDATE public.invoices
        SET status = v_new_status, updated_at = now()
        WHERE id = v_invoice.id;
    END IF;

    -- 9. Audit (same transaction; actor = auth.uid(), or the system actor).
    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, actor_type, action, entity_type, entity_id, metadata)
    VALUES (
        v_invoice.tenant_id,
        v_uid,
        CASE WHEN v_is_system THEN 'system' ELSE v_actor_role END,
        CASE WHEN v_is_system THEN 'system' ELSE 'user' END,
        'invoice.payment_recorded',
        'payment',
        v_payment_id,
        jsonb_build_object(
            'invoice_id', v_invoice.id,
            'payment_method', p_method,
            'old_status', v_invoice.status,
            'new_status', v_new_status
        ) || CASE WHEN v_is_system THEN jsonb_build_object('system_actor', p_system_actor) ELSE '{}'::jsonb END
    );

    -- 10. Outbox (same transaction).
    PERFORM private.outbox_payment_recorded(v_payment_id);

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

COMMENT ON FUNCTION public.record_payment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, TEXT) IS
    'V2-03 03-07 (D1 spike): records a payment atomically under the caller''s RLS: lock, invariants, payment, status, audit and outbox in one transaction.';

REVOKE ALL ON FUNCTION public.record_payment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, TEXT) TO authenticated, service_role;
