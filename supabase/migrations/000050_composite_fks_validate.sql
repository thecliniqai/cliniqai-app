-- Migration: 000050_composite_fks_validate.sql
-- V2-05 plan 05-03 step 5 (P1-02, BACKEND_MIGRATION_PLAN §6 C2; ruling R-12; R-15).
--
-- Validates every composite FK 000049 created NOT VALID. Precondition, checked on the local stack before this file was
-- written and recorded in the phase evidence (evidence/05a/diagnostics/after-expand-05-03.json): diagnostics D1, D1x
-- and D5, D5x are all 0 (no cross-tenant reference, no non-member doctor). On a database where a row still violates a
-- constraint, VALIDATE fails with 23503 and the whole migration rolls back (proven by
-- supabase/tests/database/migration_edge_cases_fk.test.sql): investigate it as a possible incident (BACKEND §3), never
-- delete it to make the migration pass.
--
-- VALIDATE takes SHARE UPDATE EXCLUSIVE on the child (and ROW SHARE on the parent), so writes continue meanwhile.

ALTER TABLE public.visits VALIDATE CONSTRAINT visits_tenant_patient_fkey;
ALTER TABLE public.invoices VALIDATE CONSTRAINT invoices_tenant_patient_fkey;
ALTER TABLE public.invoices VALIDATE CONSTRAINT invoices_tenant_visit_fkey;
ALTER TABLE public.payments VALIDATE CONSTRAINT payments_tenant_invoice_fkey;
ALTER TABLE public.prescriptions VALIDATE CONSTRAINT prescriptions_tenant_patient_fkey;
ALTER TABLE public.prescriptions VALIDATE CONSTRAINT prescriptions_tenant_visit_fkey;
ALTER TABLE public.consultation_diagnoses VALIDATE CONSTRAINT consultation_diagnoses_tenant_patient_fkey;
ALTER TABLE public.consultation_diagnoses VALIDATE CONSTRAINT consultation_diagnoses_tenant_visit_fkey;
ALTER TABLE public.consultations VALIDATE CONSTRAINT consultations_tenant_patient_fkey;
ALTER TABLE public.consent_records VALIDATE CONSTRAINT consent_records_tenant_patient_fkey;
ALTER TABLE public.follow_ups VALIDATE CONSTRAINT follow_ups_tenant_patient_fkey;
ALTER TABLE public.patient_documents VALIDATE CONSTRAINT patient_documents_tenant_patient_fkey;
ALTER TABLE public.communication_queue VALIDATE CONSTRAINT communication_queue_tenant_patient_fkey;
ALTER TABLE public.queue_tokens VALIDATE CONSTRAINT queue_tokens_tenant_visit_fkey;
ALTER TABLE public.visit_revisions VALIDATE CONSTRAINT visit_revisions_tenant_visit_fkey;
ALTER TABLE public.waitlist_entries VALIDATE CONSTRAINT waitlist_entries_tenant_patient_fkey;
ALTER TABLE public.waitlist_entries VALIDATE CONSTRAINT waitlist_entries_tenant_promoted_visit_fkey;
ALTER TABLE public.referrals VALIDATE CONSTRAINT referrals_tenant_patient_fkey;
ALTER TABLE public.invoice_items VALIDATE CONSTRAINT invoice_items_tenant_invoice_fkey;
ALTER TABLE public.prescription_items VALIDATE CONSTRAINT prescription_items_tenant_prescription_fkey;
ALTER TABLE public.document_share_tokens VALIDATE CONSTRAINT document_share_tokens_tenant_document_fkey;
ALTER TABLE public.api_key_usage_daily VALIDATE CONSTRAINT api_key_usage_daily_tenant_api_key_fkey;
ALTER TABLE public.webhook_delivery_queue VALIDATE CONSTRAINT webhook_delivery_queue_tenant_subscription_fkey;
ALTER TABLE public.follow_ups VALIDATE CONSTRAINT follow_ups_tenant_visit_fkey;
ALTER TABLE public.patient_documents VALIDATE CONSTRAINT patient_documents_tenant_visit_fkey;
ALTER TABLE public.communication_queue VALIDATE CONSTRAINT communication_queue_tenant_appointment_fkey;
ALTER TABLE public.referrals VALIDATE CONSTRAINT referrals_tenant_visit_fkey;
ALTER TABLE public.audit_logs VALIDATE CONSTRAINT audit_logs_tenant_api_key_fkey;
ALTER TABLE public.visits VALIDATE CONSTRAINT visits_tenant_doctor_fkey;
ALTER TABLE public.prescriptions VALIDATE CONSTRAINT prescriptions_tenant_doctor_fkey;
ALTER TABLE public.consultations VALIDATE CONSTRAINT consultations_tenant_doctor_fkey;
ALTER TABLE public.follow_ups VALIDATE CONSTRAINT follow_ups_tenant_doctor_fkey;
ALTER TABLE public.waitlist_entries VALIDATE CONSTRAINT waitlist_entries_tenant_doctor_fkey;
ALTER TABLE public.schedule_blocks VALIDATE CONSTRAINT schedule_blocks_tenant_doctor_fkey;
ALTER TABLE public.doctor_custom_diagnoses VALIDATE CONSTRAINT doctor_custom_diagnoses_tenant_doctor_fkey;
ALTER TABLE public.doctor_custom_medicines VALIDATE CONSTRAINT doctor_custom_medicines_tenant_doctor_fkey;
ALTER TABLE public.doctor_prescription_templates VALIDATE CONSTRAINT doctor_prescription_templates_tenant_doctor_fkey;
ALTER TABLE public.referrals VALIDATE CONSTRAINT referrals_tenant_referring_doctor_fkey;
