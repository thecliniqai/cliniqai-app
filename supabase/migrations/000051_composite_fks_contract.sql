-- Migration: 000051_composite_fks_contract.sql
-- V2-05 plan 05-03 step 6 (P1-02, BACKEND_MIGRATION_PLAN §6 C2 "keep the old FKs until validated, then drop them").
--
-- Drops the single-column FKs that the validated composite FKs of 000049/000050 replace: ONLY references to tenant
-- parents (names from the catalogue at 000046). Their delete actions (mostly CASCADE) would otherwise still apply next
-- to the composite FKs' RESTRICT / SET NULL (<col>), and PostgREST would see two relationships between the same pair
-- of tables (ambiguous embeds). Kept: every `tenant_id -> tenants` FK, every FK to auth.users (doctor and actor
-- columns), `referrals.target_tenant_id` and `referrals.target_doctor_id` (cross-tenant by design).
-- Constraint-only drop: no data is touched.

ALTER TABLE public.visits DROP CONSTRAINT visits_patient_id_fkey;
ALTER TABLE public.invoices DROP CONSTRAINT invoices_patient_id_fkey;
ALTER TABLE public.invoices DROP CONSTRAINT invoices_visit_id_fkey;
ALTER TABLE public.payments DROP CONSTRAINT payments_invoice_id_fkey;
ALTER TABLE public.prescriptions DROP CONSTRAINT prescriptions_patient_id_fkey;
ALTER TABLE public.prescriptions DROP CONSTRAINT prescriptions_visit_id_fkey;
ALTER TABLE public.consultation_diagnoses DROP CONSTRAINT consultation_diagnoses_patient_id_fkey;
ALTER TABLE public.consultation_diagnoses DROP CONSTRAINT consultation_diagnoses_visit_id_fkey;
ALTER TABLE public.consultations DROP CONSTRAINT consultations_patient_id_fkey;
ALTER TABLE public.consent_records DROP CONSTRAINT consent_records_patient_id_fkey;
ALTER TABLE public.follow_ups DROP CONSTRAINT follow_ups_patient_id_fkey;
ALTER TABLE public.patient_documents DROP CONSTRAINT patient_documents_patient_id_fkey;
ALTER TABLE public.communication_queue DROP CONSTRAINT communication_queue_patient_id_fkey;
ALTER TABLE public.queue_tokens DROP CONSTRAINT queue_tokens_visit_id_fkey;
ALTER TABLE public.visit_revisions DROP CONSTRAINT visit_revisions_visit_id_fkey;
ALTER TABLE public.waitlist_entries DROP CONSTRAINT waitlist_entries_patient_id_fkey;
ALTER TABLE public.waitlist_entries DROP CONSTRAINT waitlist_entries_promoted_visit_id_fkey;
ALTER TABLE public.referrals DROP CONSTRAINT referrals_patient_id_fkey;
ALTER TABLE public.invoice_items DROP CONSTRAINT invoice_items_invoice_id_fkey;
ALTER TABLE public.prescription_items DROP CONSTRAINT prescription_items_prescription_id_fkey;
ALTER TABLE public.document_share_tokens DROP CONSTRAINT document_share_tokens_document_id_fkey;
ALTER TABLE public.api_key_usage_daily DROP CONSTRAINT api_key_usage_daily_api_key_id_fkey;
ALTER TABLE public.webhook_delivery_queue DROP CONSTRAINT webhook_delivery_queue_subscription_id_fkey;
ALTER TABLE public.follow_ups DROP CONSTRAINT follow_ups_visit_id_fkey;
ALTER TABLE public.patient_documents DROP CONSTRAINT patient_documents_visit_id_fkey;
ALTER TABLE public.communication_queue DROP CONSTRAINT communication_queue_appointment_id_fkey;
ALTER TABLE public.referrals DROP CONSTRAINT referrals_visit_id_fkey;
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_api_key_id_fkey;
