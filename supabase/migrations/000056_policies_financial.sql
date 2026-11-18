-- Migration: 000056_policies_financial.sql
-- V2-05 plan 05-02b (P1-01, PO-3, SECURITY_VERIFICATION_PLAN §6.1; rulings R-6, R-7, R-14, R-42; threats T-05-08,
-- T-05-09, T-05-39).
--
-- SELECT / INSERT / UPDATE policies of invoices, invoice_items and payments, set to their target rule from the 05-PLAN
-- "Target policy matrix" and bound to the caller's ACTIVE clinic (R-42; before: any member of any of the caller's
-- clinics read and wrote every invoice and payment, so a nurse or a doctor could collect).
--
--   invoices        S billing:view,    or consultations:edit and the invoice's visit is the caller's (own visit)
--                   I/U billing:collect, or consultations:edit and own visit (Sign & Bill, R-7)
--   invoice_items   as invoices, the own-visit test through the item's invoice
--   payments        S as invoices (through the payment's invoice); I billing:collect; U none (as before)
--
-- PO-3: receptionists, admins and owners collect (`billing:collect`); doctors and nurses do not. A doctor sees and
-- bills only the visits they are the doctor of (Sign & Bill routes the payment to reception unless they also hold
-- billing:collect: the owner of a solo clinic). Paid-invoice protection is V2-10's.
-- `record_payment` is SECURITY INVOKER, so the payments INSERT policy binds it from here; its own role check is
-- replaced in 05-02c (audit_v2).
-- `generate_tenant_invoice_number` (SECURITY DEFINER) gains the matching check: billing:collect or consultations:edit
-- in the active clinic (R-7), or the service role; anything else raises 42501.
-- DELETE policies are 05-04's (000052) and are not touched. Each helper call is wrapped in (select ...) (initPlan); the
-- own-visit EXISTS reads `visits` under the caller's RLS (appointments:view: every role that reaches it holds it).
-- Policy-only migration (plus one function body): no data is touched.

-- invoices -------------------------------------------------------------------------------------------------------
DROP POLICY invoices_select_tenant ON public.invoices;
DROP POLICY invoices_insert_tenant ON public.invoices;
DROP POLICY invoices_update_tenant ON public.invoices;

CREATE POLICY invoices_select ON public.invoices
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT authz.tenant_ids_with('billing:view'))
    OR (
      tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
      AND EXISTS (
        SELECT 1 FROM public.visits v
         WHERE v.tenant_id = invoices.tenant_id
           AND v.id = invoices.visit_id
           AND v.doctor_id = (SELECT auth.uid())
      )
    )
  );
CREATE POLICY invoices_insert ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT authz.tenant_ids_with('billing:collect'))
    OR (
      tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
      AND EXISTS (
        SELECT 1 FROM public.visits v
         WHERE v.tenant_id = invoices.tenant_id
           AND v.id = invoices.visit_id
           AND v.doctor_id = (SELECT auth.uid())
      )
    )
  );
CREATE POLICY invoices_update ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT authz.tenant_ids_with('billing:collect'))
    OR (
      tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
      AND EXISTS (
        SELECT 1 FROM public.visits v
         WHERE v.tenant_id = invoices.tenant_id
           AND v.id = invoices.visit_id
           AND v.doctor_id = (SELECT auth.uid())
      )
    )
  )
  WITH CHECK (
    tenant_id IN (SELECT authz.tenant_ids_with('billing:collect'))
    OR (
      tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
      AND EXISTS (
        SELECT 1 FROM public.visits v
         WHERE v.tenant_id = invoices.tenant_id
           AND v.id = invoices.visit_id
           AND v.doctor_id = (SELECT auth.uid())
      )
    )
  );

-- invoice_items (own visit through the item's invoice) -----------------------------------------------------------
DROP POLICY invoice_items_select_tenant ON public.invoice_items;
DROP POLICY invoice_items_insert_tenant ON public.invoice_items;
DROP POLICY invoice_items_update_tenant ON public.invoice_items;

CREATE POLICY invoice_items_select ON public.invoice_items
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT authz.tenant_ids_with('billing:view'))
    OR (
      tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
      AND EXISTS (
        SELECT 1 FROM public.invoices i
          JOIN public.visits v ON v.tenant_id = i.tenant_id AND v.id = i.visit_id
         WHERE i.tenant_id = invoice_items.tenant_id
           AND i.id = invoice_items.invoice_id
           AND v.doctor_id = (SELECT auth.uid())
      )
    )
  );
CREATE POLICY invoice_items_insert ON public.invoice_items
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT authz.tenant_ids_with('billing:collect'))
    OR (
      tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
      AND EXISTS (
        SELECT 1 FROM public.invoices i
          JOIN public.visits v ON v.tenant_id = i.tenant_id AND v.id = i.visit_id
         WHERE i.tenant_id = invoice_items.tenant_id
           AND i.id = invoice_items.invoice_id
           AND v.doctor_id = (SELECT auth.uid())
      )
    )
  );
CREATE POLICY invoice_items_update ON public.invoice_items
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT authz.tenant_ids_with('billing:collect'))
    OR (
      tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
      AND EXISTS (
        SELECT 1 FROM public.invoices i
          JOIN public.visits v ON v.tenant_id = i.tenant_id AND v.id = i.visit_id
         WHERE i.tenant_id = invoice_items.tenant_id
           AND i.id = invoice_items.invoice_id
           AND v.doctor_id = (SELECT auth.uid())
      )
    )
  )
  WITH CHECK (
    tenant_id IN (SELECT authz.tenant_ids_with('billing:collect'))
    OR (
      tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
      AND EXISTS (
        SELECT 1 FROM public.invoices i
          JOIN public.visits v ON v.tenant_id = i.tenant_id AND v.id = i.visit_id
         WHERE i.tenant_id = invoice_items.tenant_id
           AND i.id = invoice_items.invoice_id
           AND v.doctor_id = (SELECT auth.uid())
      )
    )
  );

-- payments (no UPDATE policy, as before; INSERT only by collectors) ----------------------------------------------
DROP POLICY payments_select_tenant ON public.payments;
DROP POLICY payments_insert_tenant ON public.payments;

CREATE POLICY payments_select ON public.payments
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT authz.tenant_ids_with('billing:view'))
    OR (
      tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
      AND EXISTS (
        SELECT 1 FROM public.invoices i
          JOIN public.visits v ON v.tenant_id = i.tenant_id AND v.id = i.visit_id
         WHERE i.tenant_id = payments.tenant_id
           AND i.id = payments.invoice_id
           AND v.doctor_id = (SELECT auth.uid())
      )
    )
  );
CREATE POLICY payments_insert ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('billing:collect')));

-- generate_tenant_invoice_number: billing:collect or consultations:edit (Sign & Bill, R-7) in the active clinic -------
CREATE OR REPLACE FUNCTION public.generate_tenant_invoice_number(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_year TEXT := to_char(now(), 'YYYY');
    v_count INTEGER;
BEGIN
    IF NOT (
        (SELECT auth.role()) = 'service_role'
        OR public.has_permission(p_tenant_id, 'billing:collect')
        OR public.has_permission(p_tenant_id, 'consultations:edit')
    ) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    SELECT count(*) + 1 INTO v_count
    FROM public.invoices i
    WHERE i.tenant_id = p_tenant_id
      AND i.invoice_number LIKE 'INV-' || v_year || '-%';

    RETURN 'INV-' || v_year || '-' || lpad(v_count::TEXT, 5, '0');
END;
$$;
