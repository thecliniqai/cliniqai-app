-- Migration: 000066_fk_indexes.sql
-- V2-05 plan 05-08 step 5 (P2-08 FK part; research "46 FKs without a supporting index"; risk K-2).
--
-- Every foreign key in the app schemas gets an index whose leading columns are exactly the FK's columns (in any
-- order), no exceptions. Without one, deleting or re-keying a parent row (an `auth.users` row for an actor or doctor
-- column, a clinic for `referrals.target_tenant_id`) scans the whole child table under lock, and RLS/joins on those
-- columns cannot use an index. 05-03 (000049) already added `(tenant_id, <fk>)` indexes for its composite FKs; what
-- is left are the single-column references to `auth.users` (actor, doctor, recipient columns) and the cross-clinic
-- `referrals.target_tenant_id`.
--
-- The list is generated from the catalogue at this migration (every FK in public, ops, private and authz without a
-- covering, non-partial index whose first N key columns are the FK's N columns); `fk_indexes.test.sql` re-runs the
-- same check and fails on any FK added later without its index. Plain B-tree indexes; the tables are small, so
-- `CREATE INDEX` inside the migration transaction is fine (no CONCURRENTLY, which a migration transaction cannot run).
-- Per-migration checklist: no new table or function; no data is changed.

CREATE INDEX idx_api_keys_created_by ON public.api_keys (created_by); -- api_keys_created_by_fkey -> auth.users
CREATE INDEX idx_audit_logs_actor_id ON public.audit_logs (actor_id); -- audit_logs_actor_id_fkey -> auth.users
CREATE INDEX idx_communication_queue_created_by ON public.communication_queue (created_by); -- communication_queue_created_by_fkey -> auth.users
CREATE INDEX idx_communication_queue_recipient_user_id ON public.communication_queue (recipient_user_id); -- communication_queue_recipient_user_id_fkey -> auth.users
CREATE INDEX idx_consent_records_recorded_by ON public.consent_records (recorded_by); -- consent_records_recorded_by_fkey -> auth.users
CREATE INDEX idx_consultations_doctor_id ON public.consultations (doctor_id); -- consultations_doctor_id_fkey -> auth.users
CREATE INDEX idx_doctor_custom_diagnoses_doctor_id ON public.doctor_custom_diagnoses (doctor_id); -- doctor_custom_diagnoses_doctor_id_fkey -> auth.users
CREATE INDEX idx_doctor_custom_medicines_doctor_id ON public.doctor_custom_medicines (doctor_id); -- doctor_custom_medicines_doctor_id_fkey -> auth.users
CREATE INDEX idx_doctor_prescription_templates_doctor_id ON public.doctor_prescription_templates (doctor_id); -- doctor_prescription_templates_doctor_id_fkey -> auth.users
CREATE INDEX idx_document_share_tokens_created_by ON public.document_share_tokens (created_by); -- document_share_tokens_created_by_fkey -> auth.users
CREATE INDEX idx_follow_ups_doctor_id ON public.follow_ups (doctor_id); -- follow_ups_doctor_id_fkey -> auth.users
CREATE INDEX idx_in_app_notifications_recipient_user_id ON public.in_app_notifications (recipient_user_id); -- in_app_notifications_recipient_user_id_fkey -> auth.users
CREATE INDEX idx_invitations_consumed_by ON public.invitations (consumed_by); -- invitations_consumed_by_fkey -> auth.users
CREATE INDEX idx_invitations_created_by ON public.invitations (created_by); -- invitations_created_by_fkey -> auth.users
CREATE INDEX idx_patient_documents_uploaded_by ON public.patient_documents (uploaded_by); -- patient_documents_uploaded_by_fkey -> auth.users
CREATE INDEX idx_patients_created_by ON public.patients (created_by); -- patients_created_by_fkey -> auth.users
CREATE INDEX idx_payments_recorded_by ON public.payments (recorded_by); -- payments_recorded_by_fkey -> auth.users
CREATE INDEX idx_prescriptions_doctor_id ON public.prescriptions (doctor_id); -- prescriptions_doctor_id_fkey -> auth.users
CREATE INDEX idx_referrals_closed_by ON public.referrals (closed_by); -- referrals_closed_by_fkey -> auth.users
CREATE INDEX idx_referrals_referring_doctor_id ON public.referrals (referring_doctor_id); -- referrals_referring_doctor_id_fkey -> auth.users
CREATE INDEX idx_referrals_target_doctor_id ON public.referrals (target_doctor_id); -- referrals_target_doctor_id_fkey -> auth.users
CREATE INDEX idx_referrals_target_tenant_id ON public.referrals (target_tenant_id); -- referrals_target_tenant_id_fkey -> tenants
CREATE INDEX idx_schedule_blocks_created_by ON public.schedule_blocks (created_by); -- schedule_blocks_created_by_fkey -> auth.users
CREATE INDEX idx_schedule_blocks_doctor_id ON public.schedule_blocks (doctor_id); -- schedule_blocks_doctor_id_fkey -> auth.users
CREATE INDEX idx_visit_revisions_amended_by ON public.visit_revisions (amended_by); -- visit_revisions_amended_by_fkey -> auth.users
CREATE INDEX idx_visits_created_by ON public.visits (created_by); -- visits_created_by_fkey -> auth.users
CREATE INDEX idx_visits_doctor_id ON public.visits (doctor_id); -- visits_doctor_id_fkey -> auth.users
CREATE INDEX idx_visits_signed_by ON public.visits (signed_by); -- visits_signed_by_fkey -> auth.users
CREATE INDEX idx_waitlist_entries_created_by ON public.waitlist_entries (created_by); -- waitlist_entries_created_by_fkey -> auth.users
CREATE INDEX idx_waitlist_entries_doctor_id ON public.waitlist_entries (doctor_id); -- waitlist_entries_doctor_id_fkey -> auth.users
CREATE INDEX idx_webhook_subscriptions_created_by ON public.webhook_subscriptions (created_by); -- webhook_subscriptions_created_by_fkey -> auth.users
