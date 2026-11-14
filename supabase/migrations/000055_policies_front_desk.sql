-- Migration: 000055_policies_front_desk.sql
-- V2-05 plan 05-02b (P1-01, P0-14 RLS part, PO-3, SECURITY_VERIFICATION_PLAN §6.1; rulings R-6, R-8, R-14, R-42;
-- threats T-05-10, T-05-39).
--
-- SELECT / INSERT / UPDATE policies of the front-desk tables, set to their target rule from the 05-PLAN "Target policy
-- matrix" and bound to the caller's ACTIVE clinic through the `authz` helpers (R-42; before: any membership in any of
-- the caller's clinics).
--
--   patients            S patients:view       I patients:edit   U patients:edit (+ patients_clinical_fields_guard)
--   consent_records     S patients:view       I patients:edit   U none
--   visits              S appointments:view   I/U appointments:edit
--   queue_tokens        S appointments:view   I/U appointments:edit
--   waitlist_entries    S appointments:view   I/U appointments:edit
--   schedule_blocks     S appointments:view   I/U own doctor_id with appointments:edit, or clinic:manage
--                                             (the service rule; a clinic-wide block, doctor_id null, is clinic:manage)
--   follow_ups          S appointments:view   I/U appointments:edit or consultations:edit
--   communication_queue S appointments:view   (writes revoked from API roles by V2-04 000035; no write policy exists)
--
-- Receptionists register patients (P0-14, PO-3: `patients:edit` since 000046) and update demographics; a change to
-- `allergies` or `chronic_conditions` needs consultations:view in the row's (active) clinic (R-8, SVP §6.1 "UPDATE
-- demographics only"). INSERT is not restricted: the registration desk may record them at intake. Receptionists still
-- READ both columns on `patients` (R-8; a second split is offered to the PO as a V2-08 follow-up).
-- DELETE policies are 05-04's (000052) and are not touched. Each helper call is wrapped in (select ...) (initPlan).
-- Policy-only migration (plus one guard trigger): no data is touched.

-- patients ------------------------------------------------------------------------------------------------------
DROP POLICY patients_select_member ON public.patients;
DROP POLICY patients_insert_member ON public.patients;
DROP POLICY patients_update_member ON public.patients;

CREATE POLICY patients_select ON public.patients
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('patients:view')));
CREATE POLICY patients_insert ON public.patients
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('patients:edit')));
CREATE POLICY patients_update ON public.patients
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('patients:edit')))
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('patients:edit')));

-- Guard (R-8, T-05-10): SECURITY INVOKER. A signed-in caller (auth.uid() set) without consultations:view in the row's
-- clinic (has_permission is bound to the active clinic) may not change allergies or chronic_conditions: 42501 with the
-- machine reason PATIENT_CLINICAL_FIELDS. System paths (service role, migrations: no auth.uid()) are not restricted.
CREATE FUNCTION public.patients_clinical_fields_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL
     AND (NEW.allergies IS DISTINCT FROM OLD.allergies
          OR NEW.chronic_conditions IS DISTINCT FROM OLD.chronic_conditions)
     AND NOT public.has_permission(NEW.tenant_id, 'consultations:view') THEN
    RAISE EXCEPTION 'PATIENT_CLINICAL_FIELDS' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.patients_clinical_fields_guard() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.patients_clinical_fields_guard() IS
  'V2-05 05-02b (R-8): BEFORE UPDATE on patients. A signed-in caller without consultations:view in the row''s clinic '
  'cannot change allergies or chronic_conditions (42501 PATIENT_CLINICAL_FIELDS); INSERT is not restricted.';
CREATE TRIGGER patients_clinical_fields_guard
  BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.patients_clinical_fields_guard();

-- consent_records (append-only: no UPDATE policy, as before) -----------------------------------------------------
DROP POLICY consent_records_select_member ON public.consent_records;
DROP POLICY consent_records_insert_member ON public.consent_records;

CREATE POLICY consent_records_select ON public.consent_records
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('patients:view')));
CREATE POLICY consent_records_insert ON public.consent_records
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('patients:edit')));

-- visits (non-clinical since 05-02a: the clinical content is in clinical_notes) ----------------------------------
DROP POLICY visits_select_member ON public.visits;
DROP POLICY visits_insert_member ON public.visits;
DROP POLICY visits_update_member ON public.visits;

CREATE POLICY visits_select ON public.visits
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('appointments:view')));
CREATE POLICY visits_insert ON public.visits
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit')));
CREATE POLICY visits_update ON public.visits
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit')))
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit')));

-- queue_tokens ---------------------------------------------------------------------------------------------------
DROP POLICY queue_tokens_select_member ON public.queue_tokens;
DROP POLICY queue_tokens_insert_member ON public.queue_tokens;
DROP POLICY queue_tokens_update_member ON public.queue_tokens;

CREATE POLICY queue_tokens_select ON public.queue_tokens
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('appointments:view')));
CREATE POLICY queue_tokens_insert ON public.queue_tokens
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit')));
CREATE POLICY queue_tokens_update ON public.queue_tokens
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit')))
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit')));

-- waitlist_entries -----------------------------------------------------------------------------------------------
DROP POLICY waitlist_entries_select_member ON public.waitlist_entries;
DROP POLICY waitlist_entries_insert_member ON public.waitlist_entries;
DROP POLICY waitlist_entries_update_member ON public.waitlist_entries;

CREATE POLICY waitlist_entries_select ON public.waitlist_entries
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('appointments:view')));
CREATE POLICY waitlist_entries_insert ON public.waitlist_entries
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit')));
CREATE POLICY waitlist_entries_update ON public.waitlist_entries
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit')))
  WITH CHECK (tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit')));

-- schedule_blocks (same rule as the DELETE policy of 000052 and the service: features/visits/scheduling-service.ts) --
DROP POLICY schedule_blocks_select_tenant ON public.schedule_blocks;
DROP POLICY schedule_blocks_insert_tenant ON public.schedule_blocks;
DROP POLICY schedule_blocks_update_tenant ON public.schedule_blocks;

CREATE POLICY schedule_blocks_select ON public.schedule_blocks
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('appointments:view')));
CREATE POLICY schedule_blocks_insert ON public.schedule_blocks
  FOR INSERT TO authenticated
  WITH CHECK (
    (doctor_id = (SELECT auth.uid()) AND tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit')))
    OR tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage'))
  );
CREATE POLICY schedule_blocks_update ON public.schedule_blocks
  FOR UPDATE TO authenticated
  USING (
    (doctor_id = (SELECT auth.uid()) AND tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit')))
    OR tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage'))
  )
  WITH CHECK (
    (doctor_id = (SELECT auth.uid()) AND tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit')))
    OR tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage'))
  );

-- follow_ups (booked by the front desk, recorded by the doctor at sign-off) --------------------------------------
DROP POLICY follow_ups_select_member ON public.follow_ups;
DROP POLICY follow_ups_insert_member ON public.follow_ups;
DROP POLICY follow_ups_update_member ON public.follow_ups;

CREATE POLICY follow_ups_select ON public.follow_ups
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('appointments:view')));
CREATE POLICY follow_ups_insert ON public.follow_ups
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit'))
    OR tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
  );
CREATE POLICY follow_ups_update ON public.follow_ups
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit'))
    OR tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
  )
  WITH CHECK (
    tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit'))
    OR tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
  );

-- communication_queue (SELECT only; V2-04 000035 revoked INSERT/UPDATE/DELETE from anon and authenticated) --------
DROP POLICY communication_queue_select_member ON public.communication_queue;

CREATE POLICY communication_queue_select ON public.communication_queue
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('appointments:view')));
