-- Migration: 000047_tenant_parent_keys.sql
-- V2-05 plan 05-03 step 2 (P1-02, BACKEND_MIGRATION_PLAN §6 C1, DB-01; ruling R-12; threat T-05-04).
-- Next free number after 05-01b's 000046.
--
-- `UNIQUE (tenant_id, id)` on every tenant parent a composite foreign key will reference (000049), so a child row can
-- name a parent only within its own clinic. `id` is already the primary key, so each pair is trivially unique; the
-- constraint exists to be referenced. Plain DDL inside the migration transaction: there is no production data
-- (PO-15), and CREATE INDEX CONCURRENTLY cannot run in a transaction (BACKEND C1's "CONCURRENTLY" note does not apply).
-- `memberships` already has `unique_user_tenant (user_id, tenant_id)`, which the doctor references reference as is.

ALTER TABLE public.patients              ADD CONSTRAINT patients_tenant_id_id_key              UNIQUE (tenant_id, id);
ALTER TABLE public.visits                ADD CONSTRAINT visits_tenant_id_id_key                UNIQUE (tenant_id, id);
ALTER TABLE public.invoices              ADD CONSTRAINT invoices_tenant_id_id_key              UNIQUE (tenant_id, id);
ALTER TABLE public.prescriptions         ADD CONSTRAINT prescriptions_tenant_id_id_key         UNIQUE (tenant_id, id);
ALTER TABLE public.patient_documents     ADD CONSTRAINT patient_documents_tenant_id_id_key     UNIQUE (tenant_id, id);
ALTER TABLE public.referrals             ADD CONSTRAINT referrals_tenant_id_id_key             UNIQUE (tenant_id, id);
ALTER TABLE public.api_keys              ADD CONSTRAINT api_keys_tenant_id_id_key              UNIQUE (tenant_id, id);
ALTER TABLE public.webhook_subscriptions ADD CONSTRAINT webhook_subscriptions_tenant_id_id_key UNIQUE (tenant_id, id);
