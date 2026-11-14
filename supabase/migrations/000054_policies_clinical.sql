-- Migration: 000054_policies_clinical.sql
-- V2-05 plan 05-02b (P1-01, PO-3, SECURITY_VERIFICATION_PLAN §6.1; rulings R-6, R-9, R-14, R-34, R-42; threats
-- T-05-09, T-05-39).
--
-- SELECT / INSERT / UPDATE policies of the clinical tables, set to their target rule from the 05-PLAN "Target policy
-- matrix" and bound to the caller's ACTIVE clinic through the `authz` helpers (R-42). Until now each of these tables
-- admitted any member of any of the caller's clinics (`current_user_tenant_ids()`), whatever the role: a receptionist
-- or an admin read every diagnosis, prescription and referral, and a member of two clinics acting in A could write B.
--
--   consultation_diagnoses, consultations (dead, R-34), visit_revisions   S consultations:view
--                                                                          I consultations:edit
--                                                                          U consultations:edit (visit_revisions: none)
--   prescriptions, prescription_items (on its own tenant_id, 05-03)       S prescriptions:view, I/U prescriptions:edit
--   doctor_custom_diagnoses / _medicines / doctor_prescription_templates  S consultations:view
--                                                                          I/U consultations:edit AND own doctor_id
--   referrals, originating clinic                                          S consultations:view, I/U consultations:edit
--   referrals, target clinic (in-network)                                  S/U consultations:edit|view of the target
--
-- DELETE policies are 05-04's (000052) and are not touched. Admins hold no clinical key (R-9), nurses read
-- consultations but not prescriptions (matrix.ts), receptionists neither (PO-3).
-- `referrals_target_update_guard` stays (column/status restriction for the target clinic); its "originating clinic"
-- exemption moves from "any membership in the originating clinic" to consultations:edit in the active clinic, so a
-- member of both clinics acting as the target cannot rewrite the referral through the target policy.
-- Each helper call is wrapped in (select ...) so it is evaluated once per statement (initPlan).
-- Policy-only migration (plus one trigger function body): no data is touched; a replaced policy is dropped and
-- re-created here (per-migration checklist item 4).

-- consultation_diagnoses ------------------------------------------------------------------------------------------
DROP POLICY consultation_diagnoses_select_member ON public.consultation_diagnoses;
DROP POLICY consultation_diagnoses_insert_member ON public.consultation_diagnoses;
DROP POLICY consultation_diagnoses_update_member ON public.consultation_diagnoses;

CREATE POLICY consultation_diagnoses_select ON public.consultation_diagnoses
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:view')));
CREATE POLICY consultation_diagnoses_insert ON public.consultation_diagnoses
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')));
CREATE POLICY consultation_diagnoses_update ON public.consultation_diagnoses
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')))
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')));

-- consultations (dead table, dropped in V2-09b; R-34) ----------------------------------------------------------------
DROP POLICY consultations_tenant_isolation_select ON public.consultations;
DROP POLICY consultations_tenant_isolation_insert ON public.consultations;
DROP POLICY consultations_tenant_isolation_update ON public.consultations;

CREATE POLICY consultations_select ON public.consultations
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:view')));
CREATE POLICY consultations_insert ON public.consultations
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')));
CREATE POLICY consultations_update ON public.consultations
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')))
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')));

-- visit_revisions (append-only: no UPDATE policy) ----------------------------------------------------------------
DROP POLICY visit_revisions_select_member ON public.visit_revisions;
DROP POLICY visit_revisions_insert_member ON public.visit_revisions;

CREATE POLICY visit_revisions_select ON public.visit_revisions
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:view')));
CREATE POLICY visit_revisions_insert ON public.visit_revisions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')));

-- prescriptions --------------------------------------------------------------------------------------------------
DROP POLICY prescriptions_select_member ON public.prescriptions;
DROP POLICY prescriptions_insert_member ON public.prescriptions;
DROP POLICY prescriptions_update_member ON public.prescriptions;

CREATE POLICY prescriptions_select ON public.prescriptions
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('prescriptions:view')));
CREATE POLICY prescriptions_insert ON public.prescriptions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('prescriptions:edit')));
CREATE POLICY prescriptions_update ON public.prescriptions
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('prescriptions:edit')))
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('prescriptions:edit')));

-- prescription_items (its own tenant_id since 05-03: no subquery through prescriptions) --------------------------
DROP POLICY prescription_items_select_member ON public.prescription_items;
DROP POLICY prescription_items_insert_member ON public.prescription_items;
DROP POLICY prescription_items_update_member ON public.prescription_items;

CREATE POLICY prescription_items_select ON public.prescription_items
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('prescriptions:view')));
CREATE POLICY prescription_items_insert ON public.prescription_items
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('prescriptions:edit')));
CREATE POLICY prescription_items_update ON public.prescription_items
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('prescriptions:edit')))
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('prescriptions:edit')));

-- doctor_custom_diagnoses / doctor_custom_medicines / doctor_prescription_templates (a doctor's own rows) ----------
DROP POLICY doctor_custom_diagnoses_select_member ON public.doctor_custom_diagnoses;
DROP POLICY doctor_custom_diagnoses_insert_member ON public.doctor_custom_diagnoses;
DROP POLICY doctor_custom_diagnoses_update_member ON public.doctor_custom_diagnoses;

CREATE POLICY doctor_custom_diagnoses_select ON public.doctor_custom_diagnoses
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:view')));
CREATE POLICY doctor_custom_diagnoses_insert ON public.doctor_custom_diagnoses
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
    AND doctor_id = (SELECT auth.uid())
  );
CREATE POLICY doctor_custom_diagnoses_update ON public.doctor_custom_diagnoses
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
    AND doctor_id = (SELECT auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
    AND doctor_id = (SELECT auth.uid())
  );

DROP POLICY doctor_custom_medicines_select_member ON public.doctor_custom_medicines;
DROP POLICY doctor_custom_medicines_insert_member ON public.doctor_custom_medicines;
DROP POLICY doctor_custom_medicines_update_member ON public.doctor_custom_medicines;

CREATE POLICY doctor_custom_medicines_select ON public.doctor_custom_medicines
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:view')));
CREATE POLICY doctor_custom_medicines_insert ON public.doctor_custom_medicines
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
    AND doctor_id = (SELECT auth.uid())
  );
CREATE POLICY doctor_custom_medicines_update ON public.doctor_custom_medicines
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
    AND doctor_id = (SELECT auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
    AND doctor_id = (SELECT auth.uid())
  );

DROP POLICY doctor_prescription_templates_select_member ON public.doctor_prescription_templates;
DROP POLICY doctor_prescription_templates_insert_member ON public.doctor_prescription_templates;
DROP POLICY doctor_prescription_templates_update_member ON public.doctor_prescription_templates;

CREATE POLICY doctor_prescription_templates_select ON public.doctor_prescription_templates
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:view')));
CREATE POLICY doctor_prescription_templates_insert ON public.doctor_prescription_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
    AND doctor_id = (SELECT auth.uid())
  );
CREATE POLICY doctor_prescription_templates_update ON public.doctor_prescription_templates
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
    AND doctor_id = (SELECT auth.uid())
  )
  WITH CHECK (
    tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
    AND doctor_id = (SELECT auth.uid())
  );

-- referrals: originating clinic and (in-network) target clinic ----------------------------------------------------
-- The directory and consent checks on INSERT are 05-06's (`referrals_directory_consent`).
DROP POLICY referrals_originating_tenant_manage_select ON public.referrals;
DROP POLICY referrals_originating_tenant_manage_insert ON public.referrals;
DROP POLICY referrals_originating_tenant_manage_update ON public.referrals;
DROP POLICY referrals_target_tenant_select ON public.referrals;
DROP POLICY referrals_target_tenant_update ON public.referrals;

CREATE POLICY referrals_originating_select ON public.referrals
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:view')));
CREATE POLICY referrals_originating_insert ON public.referrals
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')));
CREATE POLICY referrals_originating_update ON public.referrals
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')))
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')));
CREATE POLICY referrals_target_select ON public.referrals
  FOR SELECT TO authenticated
  USING (
    target_tenant_id IS NOT NULL
    AND target_tenant_id IN (SELECT authz.tenant_ids_with('consultations:view'))
  );
CREATE POLICY referrals_target_update ON public.referrals
  FOR UPDATE TO authenticated
  USING (
    target_tenant_id IS NOT NULL
    AND target_tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
  )
  WITH CHECK (
    target_tenant_id IS NOT NULL
    AND target_tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
  );

-- The target clinic may only acknowledge (status sent → acknowledged); the originating clinic, acting in its own
-- active clinic with consultations:edit, is not restricted here (same body otherwise).
CREATE OR REPLACE FUNCTION public.referrals_target_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR public.has_permission(OLD.tenant_id, 'consultations:edit') THEN
        RETURN NEW;
    END IF;

    IF (to_jsonb(NEW) - ARRAY['status', 'acknowledged_at', 'updated_at'])
           IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'acknowledged_at', 'updated_at'])
       OR NOT (NEW.status = OLD.status OR (OLD.status = 'sent' AND NEW.status = 'acknowledged')) THEN
        RAISE EXCEPTION 'referral_target_update_forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;
