-- Migration: 000140_billing_invariants_fy.sql
-- V2-10 plan 10-01 (tracer; P1-06 / PO-4; decisions D-1, D-2, D-6, D-7, D-8, D-15; threat T-10-03).
--
-- Invoice numbers run per clinic per Indian financial year (April-March) from a counter, and the database refuses an invoice
-- header whose money does not add up.
--
-- 1. private.indian_fy(date) -> '2026-27': the FY a clinic-local calendar date falls in (1 Apr starts a new FY). IMMUTABLE. The
--    app twin is lib/fy (`indianFy`); both are checked against one case table (tests/fixtures/fy-cases.json, embedded in
--    billing_invariants.test.sql and compared by tests/money/fy.spec.ts).
-- 2. private.invoice_counters (tenant_id, fy, last_value): one row per clinic and FY. RLS on, no policy, no privilege for any API
--    role (a member can neither read nor rewind it). tenant_id -> tenants CASCADE. Seeded from any invoice already numbered in the
--    new form (none expected: D-7 leaves INV-YYYY-NNNNN rows as they are and starts every clinic at 1).
-- 3. private.next_invoice_number(p_tenant_id, p_at DEFAULT now()) -> 'INV/2026-27/00001': the FY of p_at in the clinic's zone
--    (public.tenant_local_date, ADR-016), the counter advanced with one INSERT ... ON CONFLICT DO UPDATE ... RETURNING. Concurrent
--    creators of one clinic and FY serialise on the counter row until commit, and a command that fails after taking a number rolls
--    the increment back with everything else: no gap, no duplicate (TARGET §7 rule 3). 5 digits, wider past 99999 (never cut).
--    No API grant (D-15: a callable counter lets a client burn numbers); called only by private.step_create_invoice.
--    lock_timeout 5s for the wait on the counter row (as next_queue_token, 000064).
-- 4. private.step_create_invoice: the number from next_invoice_number (the advisory lock and the count-based generator go);
--    the live-invoice lookup skips `void` as well as `cancelled`; a new invoice for a `cancelled` or `no_show` visit is refused
--    with VISIT_NOT_BILLABLE (P0001, D-8; the visit's existing live invoice is still returned as before); a discount above the
--    subtotal is refused with INPUT_INVALID (the new header CHECK would refuse it anyway; the reason keeps it a validation error).
-- 5. public.generate_tenant_invoice_number(uuid) is dropped (D-15): step_create_invoice was its only caller.
-- 6. invoices header CHECKs, added NOT VALID and then validated (rows that break them are fixed first, see 6a):
--      subtotal, discount, tax, total_amount each >= 0; discount <= subtotal; total_amount = subtotal - discount + tax;
--      total_amount <= 100,000,000.
-- 7. invoices status CHECK gains `void` (D-2; `draft` stays for old rows and is never written).
-- 8. invoices_one_live_per_visit recreated WHERE status NOT IN ('cancelled', 'void') (D-3: a void bill frees the visit).
-- Per-migration checklist: one new private table (RLS on, no policy, REVOKE ALL from every API role); two new private functions
-- (indian_fy IMMUTABLE invoker, next_invoice_number invoker; search_path '', no API grant); one private definer replaced with the
-- same signature and grants; one public definer dropped (definer_functions.test.sql and domain_policies.test.sql updated); six
-- CHECKs added and validated, one CHECK replaced, one partial unique index replaced. Data: invoice headers that break a new
-- CHECK are corrected in place (synthetic data only, PO-15; the count is raised as a NOTICE).

-- 1. FY of a clinic-local date --------------------------------------------------------------------------------------------------
CREATE FUNCTION private.indian_fy(p_date date)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
    SELECT y::text || '-' || lpad(((y + 1) % 100)::text, 2, '0')
      FROM (SELECT (extract(year FROM p_date)::int - CASE WHEN extract(month FROM p_date) < 4 THEN 1 ELSE 0 END) AS y) s
$$;
REVOKE ALL ON FUNCTION private.indian_fy(date) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.indian_fy(date) IS
    'V2-10 10-01 (D-6): the Indian financial year (April-March) of a clinic-local date, as ''2026-27''. Twin of lib/fy indianFy (shared case table tests/fixtures/fy-cases.json). No API grant.';

-- 2. Counter table ---------------------------------------------------------------------------------------------------------------
CREATE TABLE private.invoice_counters (
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    fy text NOT NULL CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
    last_value integer NOT NULL CHECK (last_value >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, fy)
);
COMMENT ON TABLE private.invoice_counters IS
    'V2-10 10-01 (D-6, T-10-03): last invoice number issued per clinic and Indian FY; written only by private.next_invoice_number inside the creating command (a rollback rolls the increment back). RLS on, no policy, no API grant.';
ALTER TABLE private.invoice_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.invoice_counters FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO private.invoice_counters (tenant_id, fy, last_value)
SELECT i.tenant_id, m[1], max(m[2]::int)
  FROM public.invoices i,
       LATERAL regexp_match(i.invoice_number, '^INV/([0-9]{4}-[0-9]{2})/([0-9]{5,9})$') AS m
 WHERE m IS NOT NULL
 GROUP BY i.tenant_id, m[1]
ON CONFLICT (tenant_id, fy) DO UPDATE SET last_value = greatest(private.invoice_counters.last_value, excluded.last_value);

-- 3. Next number ----------------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.next_invoice_number(p_tenant_id uuid, p_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_fy text;
    v_value integer;
BEGIN
    IF p_tenant_id IS NULL OR p_at IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    v_fy := private.indian_fy(public.tenant_local_date(p_tenant_id, p_at));

    INSERT INTO private.invoice_counters AS c (tenant_id, fy, last_value)
    VALUES (p_tenant_id, v_fy, 1)
    ON CONFLICT (tenant_id, fy) DO UPDATE SET last_value = c.last_value + 1, updated_at = now()
    RETURNING c.last_value INTO v_value;

    RETURN 'INV/' || v_fy || '/' || CASE WHEN v_value > 99999 THEN v_value::text ELSE lpad(v_value::text, 5, '0') END;
END;
$$;
REVOKE ALL ON FUNCTION private.next_invoice_number(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.next_invoice_number(uuid, timestamptz) IS
    'V2-10 10-01 (D-6, D-15, T-10-03): the next invoice number of the clinic for the FY of p_at in the clinic''s zone, INV/<fy>/<5 digits>, from private.invoice_counters (serialised on the counter row until commit; a rollback leaves no gap). Called only inside private.step_create_invoice; no API grant.';

-- 4. step_create_invoice --------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.step_create_invoice(
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
    SELECT v.id, v.patient_id, v.status INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- One live (not cancelled, not void) invoice per visit (invoices_one_live_per_visit, 000140): it is returned, nothing is written.
    SELECT i.id, i.invoice_number, i.status, i.total_amount INTO v_inv
      FROM public.invoices i
     WHERE i.tenant_id = p_tenant_id AND i.visit_id = p_visit_id AND i.status NOT IN ('cancelled', 'void')
       FOR UPDATE;
    IF FOUND THEN
        RETURN jsonb_build_object(
            'invoice_id', v_inv.id, 'invoice_number', v_inv.invoice_number, 'status', v_inv.status,
            'total_amount', v_inv.total_amount, 'existing', true
        );
    END IF;

    -- D-8 (10-01): no new bill for a visit that was cancelled or marked no-show.
    IF v_visit.status IN ('cancelled', 'no_show') THEN
        RAISE EXCEPTION 'VISIT_NOT_BILLABLE' USING ERRCODE = 'P0001';
    END IF;

    v_items := private.invoice_items_normalize(p_items);
    v_discount := round(COALESCE(p_discount, 0), 2);
    v_tax := round(COALESCE(p_tax, 0), 2);
    IF v_discount < 0 OR v_discount >= 100000000 OR v_tax < 0 OR v_tax >= 100000000 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(sum(round(x.unit_price * x.quantity, 2)), 0) INTO v_subtotal
      FROM jsonb_to_recordset(v_items) AS x(unit_price numeric, quantity integer);
    -- 10-01: discount <= subtotal (invoices_discount_within_subtotal); refused here with a validation reason.
    IF v_discount > v_subtotal THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    v_total := v_subtotal - v_discount + v_tax;
    IF v_total >= 100000000 THEN
        RAISE EXCEPTION 'INVOICE_TOTAL_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 10-01 (D-6): the number comes from the clinic's FY counter, taken as late as possible (the counter row stays locked
    -- until commit); a failure here or later rolls the increment back with the rest of the command.
    v_number := private.next_invoice_number(p_tenant_id);

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

    PERFORM private.log_command_audit(p_tenant_id, 'invoice.create', 'invoice', v_invoice_id,
                             jsonb_build_object('invoice_number', v_number, 'total_amount', v_total));

    RETURN jsonb_build_object(
        'invoice_id', v_invoice_id, 'invoice_number', v_number, 'status', 'issued',
        'total_amount', v_total, 'existing', false
    );
END;
$$;
REVOKE ALL ON FUNCTION private.step_create_invoice(uuid, uuid, jsonb, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.step_create_invoice(uuid, uuid, jsonb, numeric, numeric) IS
    'V2-07 07-02 (R-6, R-7), V2-10 10-01 (D-6, D-8): the visit''s live (not cancelled, not void) invoice, or a new one (number from private.next_invoice_number, header, items, invoice.create audit) in the caller''s transaction. VISIT_NOT_BILLABLE (P0001) for a new bill on a cancelled or no-show visit; INPUT_INVALID for a discount above the subtotal. The caller has checked actor, clinic and permission and holds the command claim; no API grant.';

-- 5. The count-based generator goes (D-15) ----------------------------------------------------------------------------------------
DROP FUNCTION public.generate_tenant_invoice_number(uuid);

-- 6. Header CHECKs ----------------------------------------------------------------------------------------------------------------
-- 6a. Rows that would break them (synthetic data only) are corrected first: negatives to 0, the discount capped at the subtotal,
--     the total recomputed. Each corrected row is counted in the NOTICE.
DO $$
DECLARE
    v_fixed integer;
BEGIN
    UPDATE public.invoices i
       SET subtotal = greatest(i.subtotal, 0),
           tax = greatest(i.tax, 0),
           discount = least(greatest(i.discount, 0), greatest(i.subtotal, 0)),
           total_amount = greatest(i.subtotal, 0) - least(greatest(i.discount, 0), greatest(i.subtotal, 0)) + greatest(i.tax, 0)
     WHERE i.subtotal < 0 OR i.discount < 0 OR i.tax < 0 OR i.total_amount < 0
        OR i.discount > i.subtotal
        OR i.total_amount <> i.subtotal - i.discount + i.tax;
    GET DIAGNOSTICS v_fixed = ROW_COUNT;
    RAISE NOTICE '000140: corrected % invoice header(s) that broke the new money CHECKs', v_fixed;
END;
$$;

ALTER TABLE public.invoices
    ADD CONSTRAINT invoices_subtotal_nonnegative CHECK (subtotal >= 0) NOT VALID,
    ADD CONSTRAINT invoices_discount_nonnegative CHECK (discount >= 0) NOT VALID,
    ADD CONSTRAINT invoices_tax_nonnegative CHECK (tax >= 0) NOT VALID,
    ADD CONSTRAINT invoices_total_nonnegative CHECK (total_amount >= 0) NOT VALID,
    ADD CONSTRAINT invoices_discount_within_subtotal CHECK (discount <= subtotal) NOT VALID,
    ADD CONSTRAINT invoices_total_identity CHECK (total_amount = subtotal - discount + tax) NOT VALID,
    ADD CONSTRAINT invoices_total_cap CHECK (total_amount <= 100000000) NOT VALID;
ALTER TABLE public.invoices VALIDATE CONSTRAINT invoices_subtotal_nonnegative;
ALTER TABLE public.invoices VALIDATE CONSTRAINT invoices_discount_nonnegative;
ALTER TABLE public.invoices VALIDATE CONSTRAINT invoices_tax_nonnegative;
ALTER TABLE public.invoices VALIDATE CONSTRAINT invoices_total_nonnegative;
ALTER TABLE public.invoices VALIDATE CONSTRAINT invoices_discount_within_subtotal;
ALTER TABLE public.invoices VALIDATE CONSTRAINT invoices_total_identity;
ALTER TABLE public.invoices VALIDATE CONSTRAINT invoices_total_cap;
COMMENT ON CONSTRAINT invoices_discount_within_subtotal ON public.invoices IS
    'V2-10 10-01 (P1-06): a discount never exceeds the subtotal (so the total is never clamped).';
COMMENT ON CONSTRAINT invoices_total_identity ON public.invoices IS
    'V2-10 10-01 (P1-06): total_amount = subtotal - discount + tax on every row.';
COMMENT ON CONSTRAINT invoices_total_cap ON public.invoices IS
    'V2-10 10-01 (P1-06): a bill total of at most 10 crore rupees (100,000,000).';

-- 7. Status: void (D-2) ------------------------------------------------------------------------------------------------------------
ALTER TABLE public.invoices DROP CONSTRAINT invoices_status_check;
ALTER TABLE public.invoices
    ADD CONSTRAINT invoices_status_check CHECK (status IN ('draft', 'issued', 'paid', 'cancelled', 'void')) NOT VALID;
ALTER TABLE public.invoices VALIDATE CONSTRAINT invoices_status_check;
COMMENT ON CONSTRAINT invoices_status_check ON public.invoices IS
    'V2-10 10-01 (D-2): issued, paid, cancelled, void; draft kept for old rows only (never written).';

-- 8. One live invoice per visit: cancelled and void are not live (D-3) -----------------------------------------------------------
DROP INDEX public.invoices_one_live_per_visit;
CREATE UNIQUE INDEX invoices_one_live_per_visit
    ON public.invoices (tenant_id, visit_id)
    WHERE status NOT IN ('cancelled', 'void');
COMMENT ON INDEX public.invoices_one_live_per_visit IS
    'V2-10 10-01 (D-3): at most one invoice per visit that is neither cancelled nor void.';
