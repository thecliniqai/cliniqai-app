-- Migration: 000052_delete_policies.sql
-- V2-05 plan 05-04 (P1-08, BACKEND_MIGRATION_PLAN C4, research Pitfall 11; rulings R-21, R-22; threats T-05-06, T-05-07).
--
-- Every DELETE policy on a public table, set to its FINAL rule from the 05-PLAN "Target policy matrix" (DELETE column).
-- From here on 05-04 owns DELETE; 05-02a/b/c rewrite only SELECT/INSERT/UPDATE.
--
-- 1. Parent rows lose DELETE entirely (clinical and financial history is never deleted by a member; 05-03 made their
--    children ON DELETE RESTRICT): visits (`visits_delete_member`), prescriptions, queue_tokens, waitlist_entries.
-- 2. The child deletes the app performs get the role the product needs, bound to the ACTIVE clinic through the
--    `authz` helpers (R-42), not the legacy owner/admin-only or any-membership rules. Today three of them are silent
--    no-ops for the user who performs them (Pitfall 11): a doctor removing a draft Rx item or a diagnosis (owner/admin
--    only) and anyone deleting an invoice item (no DELETE policy at all).
--      consultation_diagnoses   consultations:edit
--      prescription_items       prescriptions:edit   (its own tenant_id since 05-03)
--      invoice_items            billing:collect
--      follow_ups               consultations:edit
--      doctor_custom_*          consultations:edit and own doctor_id
--      schedule_blocks          own doctor_id with appointments:edit, or clinic:manage (same as the service rule)
--      patient_documents        labs:edit
--      in_app_notifications     own row (recipient) in the active clinic
--      api_keys, api_key_usage_daily, webhook_subscriptions   clinic:manage
-- 3. Tables whose only policy was `FOR ALL` (which also grants DELETE) are split: SELECT, INSERT and UPDATE policies
--    with the SAME legacy predicate as before (no change for those operations; 05-02b/05-02c replace them) plus the
--    final DELETE policy above, or none (consultations, referrals of the originating clinic, tenant_messaging_config).
--
-- DELETE policies are permission-only: draft/signed predicates are V2-09a's (R-21). webhook_delivery_queue and
-- communication_queue keep no DELETE (V2-04 revoked API-role writes). Storage DELETE policies are replaced with the
-- per-class storage policies in 05-02c (it replaces every storage.objects policy of the two buckets).
-- Each helper call is wrapped in (select ...) so it is evaluated once per statement (initPlan).
-- Policy-only migration: no data is touched; idempotence comes from the migration ledger (drop ... ; create ...).

-- 1. Parent rows: no member DELETE ---------------------------------------------------------------------------------
DROP POLICY visits_delete_member ON public.visits;
DROP POLICY prescriptions_delete_member ON public.prescriptions;
DROP POLICY queue_tokens_delete_member ON public.queue_tokens;
DROP POLICY waitlist_entries_delete_member ON public.waitlist_entries;

-- 2. Child rows: the final rule -----------------------------------------------------------------------------------
DROP POLICY consultation_diagnoses_delete_member ON public.consultation_diagnoses;
CREATE POLICY consultation_diagnoses_delete ON public.consultation_diagnoses
  FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')));

DROP POLICY prescription_items_delete_member ON public.prescription_items;
CREATE POLICY prescription_items_delete ON public.prescription_items
  FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('prescriptions:edit')));

CREATE POLICY invoice_items_delete ON public.invoice_items
  FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('billing:collect')));

DROP POLICY follow_ups_delete_member ON public.follow_ups;
CREATE POLICY follow_ups_delete ON public.follow_ups
  FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')));

DROP POLICY doctor_custom_diagnoses_delete_member ON public.doctor_custom_diagnoses;
CREATE POLICY doctor_custom_diagnoses_delete ON public.doctor_custom_diagnoses
  FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')) AND doctor_id = (SELECT auth.uid()));

DROP POLICY doctor_custom_medicines_delete_member ON public.doctor_custom_medicines;
CREATE POLICY doctor_custom_medicines_delete ON public.doctor_custom_medicines
  FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')) AND doctor_id = (SELECT auth.uid()));

DROP POLICY doctor_prescription_templates_delete_member ON public.doctor_prescription_templates;
CREATE POLICY doctor_prescription_templates_delete ON public.doctor_prescription_templates
  FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')) AND doctor_id = (SELECT auth.uid()));

DROP POLICY schedule_blocks_delete_tenant ON public.schedule_blocks;
CREATE POLICY schedule_blocks_delete ON public.schedule_blocks
  FOR DELETE TO authenticated
  USING (
    (doctor_id = (SELECT auth.uid()) AND tenant_id IN (SELECT authz.tenant_ids_with('appointments:edit')))
    OR tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage'))
  );

-- 3. FOR ALL policies split: S/I/U keep their legacy predicate verbatim, DELETE gets the final rule (or none) -------

-- patient_documents: DELETE labs:edit
DROP POLICY patient_documents_tenant_isolation ON public.patient_documents;
CREATE POLICY patient_documents_tenant_isolation_select ON public.patient_documents
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY patient_documents_tenant_isolation_insert ON public.patient_documents
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY patient_documents_tenant_isolation_update ON public.patient_documents
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY patient_documents_delete ON public.patient_documents
  FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('labs:edit')));

-- in_app_notifications: DELETE own row in the active clinic
DROP POLICY in_app_notifications_tenant_isolation ON public.in_app_notifications;
CREATE POLICY in_app_notifications_tenant_isolation_select ON public.in_app_notifications
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY in_app_notifications_tenant_isolation_insert ON public.in_app_notifications
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY in_app_notifications_tenant_isolation_update ON public.in_app_notifications
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY in_app_notifications_delete ON public.in_app_notifications
  FOR DELETE TO authenticated
  USING (recipient_user_id = (SELECT auth.uid()) AND tenant_id IN (SELECT authz.full_tenant_ids()));

-- consultations (dead table, R-34): no DELETE
DROP POLICY consultations_tenant_isolation ON public.consultations;
CREATE POLICY consultations_tenant_isolation_select ON public.consultations
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY consultations_tenant_isolation_insert ON public.consultations
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY consultations_tenant_isolation_update ON public.consultations
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- referrals (originating clinic): no DELETE; the target-clinic SELECT/UPDATE policies are unchanged
DROP POLICY referrals_originating_tenant_manage ON public.referrals;
CREATE POLICY referrals_originating_tenant_manage_select ON public.referrals
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY referrals_originating_tenant_manage_insert ON public.referrals
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY referrals_originating_tenant_manage_update ON public.referrals
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- tenant_messaging_config: no DELETE
DROP POLICY tenant_messaging_config_tenant_isolation ON public.tenant_messaging_config;
CREATE POLICY tenant_messaging_config_tenant_isolation_select ON public.tenant_messaging_config
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY tenant_messaging_config_tenant_isolation_insert ON public.tenant_messaging_config
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY tenant_messaging_config_tenant_isolation_update ON public.tenant_messaging_config
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- api_keys, api_key_usage_daily, webhook_subscriptions: S/I/U keep the inline owner/admin rule; DELETE clinic:manage
DROP POLICY api_keys_owner_admin ON public.api_keys;
CREATE POLICY api_keys_owner_admin_select ON public.api_keys
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.memberships
                 WHERE memberships.tenant_id = api_keys.tenant_id AND memberships.user_id = auth.uid()
                   AND memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])));
CREATE POLICY api_keys_owner_admin_insert ON public.api_keys
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.memberships
                      WHERE memberships.tenant_id = api_keys.tenant_id AND memberships.user_id = auth.uid()
                        AND memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])));
CREATE POLICY api_keys_owner_admin_update ON public.api_keys
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.memberships
                 WHERE memberships.tenant_id = api_keys.tenant_id AND memberships.user_id = auth.uid()
                   AND memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.memberships
                      WHERE memberships.tenant_id = api_keys.tenant_id AND memberships.user_id = auth.uid()
                        AND memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])));
CREATE POLICY api_keys_delete ON public.api_keys
  FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));

DROP POLICY api_key_usage_owner_admin ON public.api_key_usage_daily;
CREATE POLICY api_key_usage_owner_admin_select ON public.api_key_usage_daily
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.memberships
                 WHERE memberships.tenant_id = api_key_usage_daily.tenant_id AND memberships.user_id = auth.uid()
                   AND memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])));
CREATE POLICY api_key_usage_owner_admin_insert ON public.api_key_usage_daily
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.memberships
                      WHERE memberships.tenant_id = api_key_usage_daily.tenant_id AND memberships.user_id = auth.uid()
                        AND memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])));
CREATE POLICY api_key_usage_owner_admin_update ON public.api_key_usage_daily
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.memberships
                 WHERE memberships.tenant_id = api_key_usage_daily.tenant_id AND memberships.user_id = auth.uid()
                   AND memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.memberships
                      WHERE memberships.tenant_id = api_key_usage_daily.tenant_id AND memberships.user_id = auth.uid()
                        AND memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])));
CREATE POLICY api_key_usage_daily_delete ON public.api_key_usage_daily
  FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));

DROP POLICY webhook_subs_owner_admin ON public.webhook_subscriptions;
CREATE POLICY webhook_subs_owner_admin_select ON public.webhook_subscriptions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.memberships
                 WHERE memberships.tenant_id = webhook_subscriptions.tenant_id AND memberships.user_id = auth.uid()
                   AND memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])));
CREATE POLICY webhook_subs_owner_admin_insert ON public.webhook_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.memberships
                      WHERE memberships.tenant_id = webhook_subscriptions.tenant_id AND memberships.user_id = auth.uid()
                        AND memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])));
CREATE POLICY webhook_subs_owner_admin_update ON public.webhook_subscriptions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.memberships
                 WHERE memberships.tenant_id = webhook_subscriptions.tenant_id AND memberships.user_id = auth.uid()
                   AND memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.memberships
                      WHERE memberships.tenant_id = webhook_subscriptions.tenant_id AND memberships.user_id = auth.uid()
                        AND memberships.role = ANY (ARRAY['owner'::text, 'admin'::text])));
CREATE POLICY webhook_subscriptions_delete ON public.webhook_subscriptions
  FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('clinic:manage')));
