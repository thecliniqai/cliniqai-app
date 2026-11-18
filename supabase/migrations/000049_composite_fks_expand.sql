-- Migration: 000049_composite_fks_expand.sql
-- V2-05 plan 05-03 step 4 (P1-02, BACKEND_MIGRATION_PLAN §6 C2, DB-01, DB-02; rulings R-12; threats T-05-04, T-05-05,
-- T-05-06; V2-02 OA-4 list; V2-03 triage M-XTENANT-WH).
--
-- Composite tenant foreign keys: a child row may reference a parent only in its OWN clinic. Before this, every child
-- reference was a single-column FK on the parent id, and RLS checked only the child's own tenant_id, so a tenant-A
-- member could create an A row naming a tenant-B patient, visit, invoice or doctor (V2-02 OA-4; the app-level check in
-- lib/auth/tenant-refs.ts stays as the friendly-error layer, the constraint is the structural stop).
--
-- Expand step of expand → validate → contract (research Pattern 2):
-- - every FK is created NOT VALID (enforced for every new or changed row from now on; existing rows are proven by the
--   diagnostics D1x/D5x = 0 and then by 000050's VALIDATE);
-- - each is created with its FINAL delete action (R-12), so 000051 only drops the old single-column FKs:
--   RESTRICT  clinical and financial history (T-05-06; proven and policy-closed in 05-04);
--   CASCADE   rows that belong to their parent (invoice items, prescription items, share tokens of a document, API key
--             usage, webhook deliveries of a subscription);
--   SET NULL (<col>)  optional links; the column list (PG >= 15) nulls only the link: a plain SET NULL would also null
--             tenant_id and fail its NOT NULL (research Pitfall 3, verified);
-- - doctor references bind to `memberships (user_id, tenant_id)` (`unique_user_tenant`), RESTRICT: a visit, Rx,
--   follow-up, waitlist entry, schedule block, custom list or referral can name only a member of its own clinic (D5).
--   The FKs to auth.users stay (actor and doctor columns), as do every `tenant_id -> tenants` CASCADE (tenant purge
--   and test teardown: RI actions queued by a cascade fire at the end of the outer statement, so the RESTRICTs between
--   children of the same tenant do not block deleting the tenant) and `referrals.target_tenant_id` (cross-tenant by
--   design).
-- - webhook_delivery_queue -> webhook_subscriptions is the structural fix for V2-03 triage M-XTENANT-WH: a queue row
--   can no longer name another tenant's subscription (the V2-04 handler's tenant check stays as defence in depth).
-- - a `(tenant_id, <fk>)` btree index for every composite FK that has no index leading with those two columns yet (it
--   serves the FK check on parent delete and the RLS filter).
--
-- MATCH SIMPLE (the default): a row whose reference column is null is not checked, which is what the nullable links
-- (follow_ups.visit_id, waitlist doctor, …) need.

-- 1. Tenant parents: RESTRICT (clinical and financial history)
ALTER TABLE public.visits ADD CONSTRAINT visits_tenant_patient_fkey
  FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_tenant_patient_fkey
  FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_tenant_visit_fkey
  FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.payments ADD CONSTRAINT payments_tenant_invoice_fkey
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES public.invoices (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_tenant_patient_fkey
  FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_tenant_visit_fkey
  FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.consultation_diagnoses ADD CONSTRAINT consultation_diagnoses_tenant_patient_fkey
  FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.consultation_diagnoses ADD CONSTRAINT consultation_diagnoses_tenant_visit_fkey
  FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.consultations ADD CONSTRAINT consultations_tenant_patient_fkey
  FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_tenant_patient_fkey
  FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_tenant_patient_fkey
  FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.patient_documents ADD CONSTRAINT patient_documents_tenant_patient_fkey
  FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.communication_queue ADD CONSTRAINT communication_queue_tenant_patient_fkey
  FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.queue_tokens ADD CONSTRAINT queue_tokens_tenant_visit_fkey
  FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.visit_revisions ADD CONSTRAINT visit_revisions_tenant_visit_fkey
  FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.waitlist_entries ADD CONSTRAINT waitlist_entries_tenant_patient_fkey
  FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.waitlist_entries ADD CONSTRAINT waitlist_entries_tenant_promoted_visit_fkey
  FOREIGN KEY (tenant_id, promoted_visit_id) REFERENCES public.visits (tenant_id, id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.referrals ADD CONSTRAINT referrals_tenant_patient_fkey
  FOREIGN KEY (tenant_id, patient_id) REFERENCES public.patients (tenant_id, id) ON DELETE RESTRICT NOT VALID;

-- 2. Tenant parents: CASCADE (the child belongs to its parent)
ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_tenant_invoice_fkey
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES public.invoices (tenant_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.prescription_items ADD CONSTRAINT prescription_items_tenant_prescription_fkey
  FOREIGN KEY (tenant_id, prescription_id) REFERENCES public.prescriptions (tenant_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.document_share_tokens ADD CONSTRAINT document_share_tokens_tenant_document_fkey
  FOREIGN KEY (tenant_id, document_id) REFERENCES public.patient_documents (tenant_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.api_key_usage_daily ADD CONSTRAINT api_key_usage_daily_tenant_api_key_fkey
  FOREIGN KEY (tenant_id, api_key_id) REFERENCES public.api_keys (tenant_id, id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.webhook_delivery_queue ADD CONSTRAINT webhook_delivery_queue_tenant_subscription_fkey
  FOREIGN KEY (tenant_id, subscription_id) REFERENCES public.webhook_subscriptions (tenant_id, id) ON DELETE CASCADE NOT VALID;

-- 3. Optional links: SET NULL of the link column only (PG >= 15 column list)
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_tenant_visit_fkey
  FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits (tenant_id, id) ON DELETE SET NULL (visit_id) NOT VALID;
ALTER TABLE public.patient_documents ADD CONSTRAINT patient_documents_tenant_visit_fkey
  FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits (tenant_id, id) ON DELETE SET NULL (visit_id) NOT VALID;
ALTER TABLE public.communication_queue ADD CONSTRAINT communication_queue_tenant_appointment_fkey
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES public.visits (tenant_id, id) ON DELETE SET NULL (appointment_id) NOT VALID;
ALTER TABLE public.referrals ADD CONSTRAINT referrals_tenant_visit_fkey
  FOREIGN KEY (tenant_id, visit_id) REFERENCES public.visits (tenant_id, id) ON DELETE SET NULL (visit_id) NOT VALID;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_tenant_api_key_fkey
  FOREIGN KEY (tenant_id, api_key_id) REFERENCES public.api_keys (tenant_id, id) ON DELETE SET NULL (api_key_id) NOT VALID;

-- 4. Doctor references: a member of the row's own clinic (memberships.unique_user_tenant), RESTRICT
ALTER TABLE public.visits ADD CONSTRAINT visits_tenant_doctor_fkey
  FOREIGN KEY (doctor_id, tenant_id) REFERENCES public.memberships (user_id, tenant_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_tenant_doctor_fkey
  FOREIGN KEY (doctor_id, tenant_id) REFERENCES public.memberships (user_id, tenant_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.consultations ADD CONSTRAINT consultations_tenant_doctor_fkey
  FOREIGN KEY (doctor_id, tenant_id) REFERENCES public.memberships (user_id, tenant_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.follow_ups ADD CONSTRAINT follow_ups_tenant_doctor_fkey
  FOREIGN KEY (doctor_id, tenant_id) REFERENCES public.memberships (user_id, tenant_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.waitlist_entries ADD CONSTRAINT waitlist_entries_tenant_doctor_fkey
  FOREIGN KEY (doctor_id, tenant_id) REFERENCES public.memberships (user_id, tenant_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.schedule_blocks ADD CONSTRAINT schedule_blocks_tenant_doctor_fkey
  FOREIGN KEY (doctor_id, tenant_id) REFERENCES public.memberships (user_id, tenant_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.doctor_custom_diagnoses ADD CONSTRAINT doctor_custom_diagnoses_tenant_doctor_fkey
  FOREIGN KEY (doctor_id, tenant_id) REFERENCES public.memberships (user_id, tenant_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.doctor_custom_medicines ADD CONSTRAINT doctor_custom_medicines_tenant_doctor_fkey
  FOREIGN KEY (doctor_id, tenant_id) REFERENCES public.memberships (user_id, tenant_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.doctor_prescription_templates ADD CONSTRAINT doctor_prescription_templates_tenant_doctor_fkey
  FOREIGN KEY (doctor_id, tenant_id) REFERENCES public.memberships (user_id, tenant_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.referrals ADD CONSTRAINT referrals_tenant_referring_doctor_fkey
  FOREIGN KEY (referring_doctor_id, tenant_id) REFERENCES public.memberships (user_id, tenant_id) ON DELETE RESTRICT NOT VALID;

-- 5. (tenant_id, <fk>) indexes where none leads with those columns yet
CREATE INDEX idx_communication_queue_tenant_patient ON public.communication_queue (tenant_id, patient_id);
CREATE INDEX idx_queue_tokens_tenant_visit ON public.queue_tokens (tenant_id, visit_id);
CREATE INDEX idx_waitlist_entries_tenant_patient ON public.waitlist_entries (tenant_id, patient_id);
CREATE INDEX idx_waitlist_entries_tenant_promoted_visit ON public.waitlist_entries (tenant_id, promoted_visit_id);
CREATE INDEX idx_referrals_tenant_patient ON public.referrals (tenant_id, patient_id);
CREATE INDEX idx_document_share_tokens_tenant_document ON public.document_share_tokens (tenant_id, document_id);
CREATE INDEX idx_api_key_usage_daily_tenant_api_key ON public.api_key_usage_daily (tenant_id, api_key_id);
CREATE INDEX idx_webhook_delivery_queue_tenant_subscription ON public.webhook_delivery_queue (tenant_id, subscription_id);
CREATE INDEX idx_follow_ups_tenant_visit ON public.follow_ups (tenant_id, visit_id);
CREATE INDEX idx_patient_documents_tenant_visit ON public.patient_documents (tenant_id, visit_id);
CREATE INDEX idx_communication_queue_tenant_appointment ON public.communication_queue (tenant_id, appointment_id);
CREATE INDEX idx_referrals_tenant_visit ON public.referrals (tenant_id, visit_id);
CREATE INDEX idx_audit_logs_tenant_api_key ON public.audit_logs (tenant_id, api_key_id);
CREATE INDEX idx_prescriptions_tenant_doctor ON public.prescriptions (tenant_id, doctor_id);
CREATE INDEX idx_consultations_tenant_doctor ON public.consultations (tenant_id, doctor_id);
CREATE INDEX idx_follow_ups_tenant_doctor ON public.follow_ups (tenant_id, doctor_id);
CREATE INDEX idx_waitlist_entries_tenant_doctor ON public.waitlist_entries (tenant_id, doctor_id);
CREATE INDEX idx_referrals_tenant_referring_doctor ON public.referrals (tenant_id, referring_doctor_id);
