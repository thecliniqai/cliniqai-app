-- Migration: 000141_sign_and_bill_context.sql
-- V2-10 10-02 (D-10, D-11; the two items 09E deferred: Sign & Bill pre-filled ₹500 instead of the clinic fee, and sent no visit version to
-- complete_and_bill). Sign & Bill makes ONE read when it opens:
--
-- public.sign_and_bill_context(p_tenant_id, p_visit_id) returns one jsonb, or NULL:
--   fee       {consultation, followup}: the clinic's default consultation and follow-up fee as the database holds them now (numeric rupees, or null when the
--             clinic set none). Fees are read with the bill and never held (09E R-13).
--   methods   the clinic's accepted payment methods (text array, as stored; cash/upi/card).
--   visit     {id, row_version, status}: the version the modal sends back as complete_and_bill's p_expected_version (ROW_CHANGED when it moved).
--   invoice   {id, row_version, total, paid} of the visit's live invoice (status not cancelled or void), or null; paid = the sum of its payments.
-- Gates (NULL otherwise): a session; p_tenant_id the session's active, full clinic (public.has_permission); billing:collect there (any visit of the clinic),
-- or consultations:edit there AND the visit's own doctor (the doctor bills only their own visit, as complete_and_bill's invoice step); the visit exists in
-- p_tenant_id; no NULL argument. No PHI: ids, a status, versions, money and the clinic's methods only (allow-list asserted by pgTAP).
-- SECURITY INVOKER, STABLE: RLS applies to every table it reads (tenants, visits, invoices, payments); one snapshot for every part.
-- consult_screen (000124) is not changed.
-- Per-migration checklist: one new public function (STABLE INVOKER, search_path '', EXECUTE for authenticated only: REVOKE from PUBLIC, anon,
-- service_role). No table, column, policy, trigger, grant or data change. Expand-only.

CREATE FUNCTION public.sign_and_bill_context(p_tenant_id uuid, p_visit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_visit record;
    v_tenant record;
    v_invoice jsonb;
BEGIN
    IF v_uid IS NULL OR p_tenant_id IS NULL OR p_visit_id IS NULL THEN
        RETURN NULL;
    END IF;
    IF NOT (public.has_permission(p_tenant_id, 'billing:collect') OR public.has_permission(p_tenant_id, 'consultations:edit')) THEN
        RETURN NULL;
    END IF;

    SELECT v.id, v.row_version, v.status, v.doctor_id INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    -- Without billing:collect only the visit's own doctor may bill it (consultations:edit alone is not enough for another doctor's visit).
    IF NOT public.has_permission(p_tenant_id, 'billing:collect') AND v_visit.doctor_id IS DISTINCT FROM v_uid THEN
        RETURN NULL;
    END IF;

    SELECT t.default_consultation_fee, t.default_followup_fee, t.accepted_payment_methods INTO v_tenant
      FROM public.tenants t
     WHERE t.id = p_tenant_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
               'id', i.id,
               'row_version', i.row_version,
               'total', i.total_amount,
               'paid', coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.tenant_id = i.tenant_id AND p.invoice_id = i.id), 0)
           )
      INTO v_invoice
      FROM public.invoices i
     WHERE i.tenant_id = p_tenant_id AND i.visit_id = p_visit_id AND i.status NOT IN ('cancelled', 'void')
     ORDER BY i.created_at DESC
     LIMIT 1;

    RETURN jsonb_build_object(
        'fee', jsonb_build_object('consultation', v_tenant.default_consultation_fee, 'followup', v_tenant.default_followup_fee),
        'methods', to_jsonb(coalesce(v_tenant.accepted_payment_methods, ARRAY[]::text[])),
        'visit', jsonb_build_object('id', v_visit.id, 'row_version', v_visit.row_version, 'status', v_visit.status),
        'invoice', v_invoice
    );
END;
$$;

REVOKE ALL ON FUNCTION public.sign_and_bill_context(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sign_and_bill_context(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.sign_and_bill_context(uuid, uuid) IS
    $c$V2-10 10-02 (D-10): what Sign & Bill reads when it opens, in one STABLE INVOKER read: fee {consultation, followup} (the clinic's defaults now, null when unset), methods (accepted payment methods), visit {id, row_version, status} (sent back as complete_and_bill's p_expected_version), invoice {id, row_version, total, paid} of the live invoice or null. NULL unless a session, p_tenant_id the active full clinic, and billing:collect there or consultations:edit and the visit's own doctor. No PHI.$c$;
