-- Read-only integrity diagnostics (V2-05 plan 05-03; BACKEND_MIGRATION_PLAN §3 D0-D10, R-15).
--
-- LOCAL STACK ONLY. Run through `npm run db:diagnostics -- --label <label>` (scripts/db/diagnostics.mjs), which
-- refuses any non-loopback target, wraps this file in a READ ONLY transaction that is rolled back, and writes only
-- the counts to the phase evidence. Never point this file at a hosted database (CLAUDE.md; research Pitfall 12).
--
-- Each query is preceded by a marker line `@@ <id> <kind>` that the runner parses:
--   count  one row, one numeric column            -> the number
--   pairs  rows of (label, count[, …])            -> { label: count }
--   rows   any rows                               -> the row count (the rows themselves are never written)
--
-- §3 D0-D10 are reproduced verbatim (statement text unchanged; only the markers are added). D6 is a plain query (no
-- constraint is assumed). Two additions follow the verbatim block, because §3 says "repeat pattern for each
-- child→parent pair" and plan 05-03 step 5 requires D1 and D5 to be 0 for EVERY composite FK it adds:
--   D1x  every child→parent pair of 000049_composite_fks_expand (tenant parents)
--   D5x  every doctor reference that 000049 binds to memberships(user_id, tenant_id)
-- plus V0 (row volume per table, first) and FKNV (foreign keys still NOT VALID, last).
-- `prescription_items` has no tenant_id before 000048: its D1x row reads the column through to_jsonb, so it is 0
-- (not an error) on a database that predates the column.

\echo '@@ V0 pairs'
-- V0. Volume (not in §3): rows per table the checks read, so a report shows it did not run on an empty database.
select 'tenants' t, count(*) from public.tenants
union all select 'memberships', count(*) from public.memberships
union all select 'patients', count(*) from public.patients
union all select 'visits', count(*) from public.visits
union all select 'invoices', count(*) from public.invoices
union all select 'payments', count(*) from public.payments
union all select 'prescriptions', count(*) from public.prescriptions
union all select 'prescription_items', count(*) from public.prescription_items
union all select 'patient_documents', count(*) from public.patient_documents
union all select 'communication_queue', count(*) from public.communication_queue
union all select 'webhook_delivery_queue', count(*) from public.webhook_delivery_queue;

\echo '@@ D0 rows'
-- D0. Migration history actually applied (drift check vs repo 000001–000018)
select version, name from supabase_migrations.schema_migrations order by version;

\echo '@@ D1 pairs'
-- D1. Cross-tenant references (DB-01). Repeat pattern for each child→parent pair.
select 'visits→patients' chk, count(*) from visits v join patients p on p.id = v.patient_id where v.tenant_id <> p.tenant_id
union all select 'invoices→visits', count(*) from invoices i join visits v on v.id = i.visit_id where i.tenant_id <> v.tenant_id
union all select 'prescriptions→visits', count(*) from prescriptions r join visits v on v.id = r.visit_id where r.tenant_id <> v.tenant_id
union all select 'diagnoses→visits', count(*) from consultation_diagnoses d join visits v on v.id = d.visit_id where d.tenant_id <> v.tenant_id
union all select 'documents→patients', count(*) from patient_documents d join patients p on p.id = d.patient_id where d.tenant_id <> p.tenant_id
union all select 'payments→invoices', count(*) from payments x join invoices i on i.id = x.invoice_id where x.tenant_id <> i.tenant_id
union all select 'queue_tokens→visits', count(*) from queue_tokens q join visits v on v.id = q.visit_id where q.tenant_id <> v.tenant_id
union all select 'comm_queue→patients', count(*) from communication_queue c join patients p on p.id = c.patient_id where c.tenant_id <> p.tenant_id;

\echo '@@ D2 pairs'
-- D2. Share tokens pointing at another tenant's resource (ARC-05)
select t.resource_type, count(*) from document_share_tokens t
left join prescriptions r on t.resource_type='prescription' and r.id=t.resource_id
left join invoices i      on t.resource_type='invoice'      and i.id=t.resource_id
left join referrals f     on t.resource_type='referral'     and f.id=t.resource_id
left join patient_documents d on t.resource_type='patient_document' and d.id=coalesce(t.resource_id,t.document_id)
where coalesce(r.tenant_id,i.tenant_id,f.tenant_id,d.tenant_id) <> t.tenant_id
group by 1;

\echo '@@ D3 count'
-- D3. Storage paths outside the owning tenant prefix (ARC-06)
select count(*) from patient_documents
where storage_path not like 'tenants/' || tenant_id || '/%' and storage_path not like tenant_id || '/%';

\echo '@@ D4a rows'
-- D4. Possible role escalation (RLS-01): memberships whose role differs from the consumed invitation,
--     and tenants with >1 owner (review each manually)
select m.tenant_id, m.user_id, i.role invited_role, m.role current_role
from memberships m join invitations i on i.tenant_id=m.tenant_id and i.consumed_by=m.user_id
where i.role <> m.role;
\echo '@@ D4b rows'
select tenant_id, count(*) owners from memberships where role='owner' group by 1 having count(*)>1;

\echo '@@ D5 count'
-- D5. Clinician not a member of the visit's tenant (DB-02)
select count(*) from visits v where not exists
 (select 1 from memberships m where m.tenant_id=v.tenant_id and m.user_id=v.doctor_id);

\echo '@@ D6 count'
-- D6. Overlapping non-overbooked scheduled appointments (DB-08)
select count(*) from visits a join visits b
  on a.tenant_id=b.tenant_id and a.doctor_id=b.doctor_id and a.id<b.id
 and tstzrange(a.scheduled_at, a.scheduled_at + make_interval(mins=>a.estimated_duration_minutes))
  && tstzrange(b.scheduled_at, b.scheduled_at + make_interval(mins=>b.estimated_duration_minutes))
where a.origin_type='scheduled' and b.origin_type='scheduled'
  and not a.is_overbooked and not b.is_overbooked
  and a.status not in ('cancelled','no_show') and b.status not in ('cancelled','no_show');

\echo '@@ D7a count'
-- D7. Billing integrity (DB-10..12)
select count(*) dup_active_invoices from (select tenant_id, visit_id from invoices where status<>'cancelled' group by 1,2 having count(*)>1) s;
\echo '@@ D7b count'
select count(*) bad_item_totals from invoice_items where total_price <> round(unit_price*quantity,2);
\echo '@@ D7c count'
select count(*) bad_invoice_totals from invoices where total_amount <> greatest(subtotal-discount+tax,0);
\echo '@@ D7d rows'
select i.id from invoices i join payments p on p.invoice_id=i.id group by i.id, i.total_amount having sum(p.amount) > i.total_amount;
\echo '@@ D7e count'
select count(*) non_standard_numbers from invoices where invoice_number !~ '^INV-\d{4}-\d{5}$';

\echo '@@ D8a count'
-- D8. Status coherence (DB-15..17)
select count(*) from visits where status='completed' and signed_at is null;
\echo '@@ D8b count'
select count(*) from visits where origin_type='scheduled' and scheduled_at is null;
\echo '@@ D8c count'
select count(*) from patients where is_deleted <> (erased_at is not null) or status not in ('active','erased');
\echo '@@ D8d count'
select count(*) from schedule_blocks where end_time <= start_time;

\echo '@@ D9a pairs'
-- D9. Queue health / scheduler evidence (ARC-14)
select status, count(*), min(next_retry_at) from communication_queue group by 1;
\echo '@@ D9b pairs'
select status, count(*), min(next_retry_at) from webhook_delivery_queue group by 1;

\echo '@@ D10a count'
-- D10. Dead objects
select count(*) from consultations;  -- expected 0
\echo '@@ D10b count'
select count(*) from patients where phone !~ '^\+[1-9][0-9]{7,14}$';

-- ---------------------------------------------------------------------------------------------------------------
-- Additions for plan 05-03 (not in §3): the D1 / D5 pattern repeated for every pair the composite FKs cover.
-- ---------------------------------------------------------------------------------------------------------------

\echo '@@ D1x pairs'
-- D1x. Cross-tenant references, every child→parent pair of 000049 (tenant parents).
select 'visits.patient_id→patients' chk, count(*) from public.visits c join public.patients p on p.id = c.patient_id where c.tenant_id <> p.tenant_id
union all select 'invoices.patient_id→patients', count(*) from public.invoices c join public.patients p on p.id = c.patient_id where c.tenant_id <> p.tenant_id
union all select 'invoices.visit_id→visits', count(*) from public.invoices c join public.visits p on p.id = c.visit_id where c.tenant_id <> p.tenant_id
union all select 'invoice_items.invoice_id→invoices', count(*) from public.invoice_items c join public.invoices p on p.id = c.invoice_id where c.tenant_id <> p.tenant_id
union all select 'payments.invoice_id→invoices', count(*) from public.payments c join public.invoices p on p.id = c.invoice_id where c.tenant_id <> p.tenant_id
union all select 'prescriptions.patient_id→patients', count(*) from public.prescriptions c join public.patients p on p.id = c.patient_id where c.tenant_id <> p.tenant_id
union all select 'prescriptions.visit_id→visits', count(*) from public.prescriptions c join public.visits p on p.id = c.visit_id where c.tenant_id <> p.tenant_id
union all select 'prescription_items.prescription_id→prescriptions', count(*) from public.prescription_items c join public.prescriptions p on p.id = c.prescription_id where (to_jsonb(c) ->> 'tenant_id')::uuid <> p.tenant_id
union all select 'consultation_diagnoses.patient_id→patients', count(*) from public.consultation_diagnoses c join public.patients p on p.id = c.patient_id where c.tenant_id <> p.tenant_id
union all select 'consultation_diagnoses.visit_id→visits', count(*) from public.consultation_diagnoses c join public.visits p on p.id = c.visit_id where c.tenant_id <> p.tenant_id
union all select 'consultations.patient_id→patients', count(*) from public.consultations c join public.patients p on p.id = c.patient_id where c.tenant_id <> p.tenant_id
union all select 'consent_records.patient_id→patients', count(*) from public.consent_records c join public.patients p on p.id = c.patient_id where c.tenant_id <> p.tenant_id
union all select 'follow_ups.patient_id→patients', count(*) from public.follow_ups c join public.patients p on p.id = c.patient_id where c.tenant_id <> p.tenant_id
union all select 'follow_ups.visit_id→visits', count(*) from public.follow_ups c join public.visits p on p.id = c.visit_id where c.tenant_id <> p.tenant_id
union all select 'patient_documents.patient_id→patients', count(*) from public.patient_documents c join public.patients p on p.id = c.patient_id where c.tenant_id <> p.tenant_id
union all select 'patient_documents.visit_id→visits', count(*) from public.patient_documents c join public.visits p on p.id = c.visit_id where c.tenant_id <> p.tenant_id
union all select 'document_share_tokens.document_id→patient_documents', count(*) from public.document_share_tokens c join public.patient_documents p on p.id = c.document_id where c.tenant_id <> p.tenant_id
union all select 'communication_queue.patient_id→patients', count(*) from public.communication_queue c join public.patients p on p.id = c.patient_id where c.tenant_id <> p.tenant_id
union all select 'communication_queue.appointment_id→visits', count(*) from public.communication_queue c join public.visits p on p.id = c.appointment_id where c.tenant_id <> p.tenant_id
union all select 'queue_tokens.visit_id→visits', count(*) from public.queue_tokens c join public.visits p on p.id = c.visit_id where c.tenant_id <> p.tenant_id
union all select 'visit_revisions.visit_id→visits', count(*) from public.visit_revisions c join public.visits p on p.id = c.visit_id where c.tenant_id <> p.tenant_id
union all select 'waitlist_entries.patient_id→patients', count(*) from public.waitlist_entries c join public.patients p on p.id = c.patient_id where c.tenant_id <> p.tenant_id
union all select 'waitlist_entries.promoted_visit_id→visits', count(*) from public.waitlist_entries c join public.visits p on p.id = c.promoted_visit_id where c.tenant_id <> p.tenant_id
union all select 'referrals.patient_id→patients', count(*) from public.referrals c join public.patients p on p.id = c.patient_id where c.tenant_id <> p.tenant_id
union all select 'referrals.visit_id→visits', count(*) from public.referrals c join public.visits p on p.id = c.visit_id where c.tenant_id <> p.tenant_id
union all select 'api_key_usage_daily.api_key_id→api_keys', count(*) from public.api_key_usage_daily c join public.api_keys p on p.id = c.api_key_id where c.tenant_id <> p.tenant_id
union all select 'audit_logs.api_key_id→api_keys', count(*) from public.audit_logs c join public.api_keys p on p.id = c.api_key_id where c.tenant_id <> p.tenant_id
union all select 'webhook_delivery_queue.subscription_id→webhook_subscriptions', count(*) from public.webhook_delivery_queue c join public.webhook_subscriptions p on p.id = c.subscription_id where c.tenant_id <> p.tenant_id;

\echo '@@ D5x pairs'
-- D5x. Doctor references whose user is not a member of the row's tenant (DB-02), every column 000049 binds.
select 'visits.doctor_id' chk, count(*) from public.visits t where t.doctor_id is not null and not exists (select 1 from public.memberships m where m.tenant_id = t.tenant_id and m.user_id = t.doctor_id)
union all select 'prescriptions.doctor_id', count(*) from public.prescriptions t where t.doctor_id is not null and not exists (select 1 from public.memberships m where m.tenant_id = t.tenant_id and m.user_id = t.doctor_id)
union all select 'consultations.doctor_id', count(*) from public.consultations t where t.doctor_id is not null and not exists (select 1 from public.memberships m where m.tenant_id = t.tenant_id and m.user_id = t.doctor_id)
union all select 'follow_ups.doctor_id', count(*) from public.follow_ups t where t.doctor_id is not null and not exists (select 1 from public.memberships m where m.tenant_id = t.tenant_id and m.user_id = t.doctor_id)
union all select 'waitlist_entries.doctor_id', count(*) from public.waitlist_entries t where t.doctor_id is not null and not exists (select 1 from public.memberships m where m.tenant_id = t.tenant_id and m.user_id = t.doctor_id)
union all select 'schedule_blocks.doctor_id', count(*) from public.schedule_blocks t where t.doctor_id is not null and not exists (select 1 from public.memberships m where m.tenant_id = t.tenant_id and m.user_id = t.doctor_id)
union all select 'doctor_custom_diagnoses.doctor_id', count(*) from public.doctor_custom_diagnoses t where t.doctor_id is not null and not exists (select 1 from public.memberships m where m.tenant_id = t.tenant_id and m.user_id = t.doctor_id)
union all select 'doctor_custom_medicines.doctor_id', count(*) from public.doctor_custom_medicines t where t.doctor_id is not null and not exists (select 1 from public.memberships m where m.tenant_id = t.tenant_id and m.user_id = t.doctor_id)
union all select 'doctor_prescription_templates.doctor_id', count(*) from public.doctor_prescription_templates t where t.doctor_id is not null and not exists (select 1 from public.memberships m where m.tenant_id = t.tenant_id and m.user_id = t.doctor_id)
union all select 'referrals.referring_doctor_id', count(*) from public.referrals t where t.referring_doctor_id is not null and not exists (select 1 from public.memberships m where m.tenant_id = t.tenant_id and m.user_id = t.referring_doctor_id);

\echo '@@ FKNV count'
-- Composite-FK state: foreign keys in the app schemas still NOT VALID (0 after 000050).
select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace
where c.contype = 'f' and not c.convalidated and n.nspname in ('public', 'ops', 'private');
