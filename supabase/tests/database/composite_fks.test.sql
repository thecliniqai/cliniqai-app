-- composite_fks.test.sql — V2-05 plan 05-03 (P1-02, BACKEND C1-C3, DB-01, DB-02; R-12; T-05-04, T-05-05;
-- V2-02 OA-4 list; V2-03 triage M-XTENANT-WH).
--
-- A cross-tenant child insert fails for EVERY composite FK of 000049 (expected set asserted against pg_constraint):
-- each case clones a tenant-A fixture child row (new id, uniqueness-safe overrides) and points one reference at the
-- tenant-B parent (or, for doctor references, at a user who is a member of B only) → 23503. The same clone without
-- that override inserts (control), so the 23503 is the tenant mismatch and nothing else. Without 000049-000051 every
-- negative cell inserts ('ok'): the old single-column FKs check the id alone.
-- Also: SET NULL (<col>) children keep tenant_id when the parent is deleted; prescription_items.tenant_id is filled,
-- enforced and consistent; every composite FK is validated; the replaced single-column FKs are gone; deleting a
-- tenant still cascades through children that RESTRICT each other (teardown and purge depend on it).
-- Each cell runs in a subtransaction that is always rolled back (pg_temp.try); the file rolls back. Synthetic data.
begin;
select plan(105);

-- Fixtures (synthetic) -------------------------------------------------------------------------------------------
insert into auth.users (id, email) values ('cf000000-0000-4000-8000-000000000101', 'cfk-doctor-a@example.test'), ('cf000000-0000-4000-8000-000000000201', 'cfk-owner-b@example.test');
insert into public.tenants (id, name) values ('cf000000-0000-4000-8000-00000000000a', 'Synthetic CFK Clinic A'), ('cf000000-0000-4000-8000-00000000000b', 'Synthetic CFK Clinic B');
insert into public.memberships (user_id, tenant_id, role) values ('cf000000-0000-4000-8000-000000000101', 'cf000000-0000-4000-8000-00000000000a', 'doctor'), ('cf000000-0000-4000-8000-000000000201', 'cf000000-0000-4000-8000-00000000000b', 'owner');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-00000000000a', 'Synthetic CFK Patient A', '+919000000101', 'cf000000-0000-4000-8000-000000000101'),
  ('cf000000-0000-4000-8000-000000001002', 'cf000000-0000-4000-8000-00000000000b', 'Synthetic CFK Patient B', '+919000000102', 'cf000000-0000-4000-8000-000000000201');
insert into public.visits (id, tenant_id, patient_id, doctor_id, origin_type, created_by) values
  ('cf000000-0000-4000-8000-000000001003', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-000000000101', 'walk_in', 'cf000000-0000-4000-8000-000000000101'),
  ('cf000000-0000-4000-8000-000000001004', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-000000000101', 'walk_in', 'cf000000-0000-4000-8000-000000000101'),
  ('cf000000-0000-4000-8000-000000001010', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-000000000101', 'walk_in', 'cf000000-0000-4000-8000-000000000101'),
  ('cf000000-0000-4000-8000-000000001005', 'cf000000-0000-4000-8000-00000000000b', 'cf000000-0000-4000-8000-000000001002', 'cf000000-0000-4000-8000-000000000201', 'walk_in', 'cf000000-0000-4000-8000-000000000201');
insert into public.invoices (id, tenant_id, visit_id, patient_id, invoice_number) values
  ('cf000000-0000-4000-8000-000000001006', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001003', 'cf000000-0000-4000-8000-000000001001', 'CFK-0001'), ('cf000000-0000-4000-8000-000000001007', 'cf000000-0000-4000-8000-00000000000b', 'cf000000-0000-4000-8000-000000001005', 'cf000000-0000-4000-8000-000000001002', 'CFK-0001');
insert into public.prescriptions (id, tenant_id, visit_id, patient_id, doctor_id) values
  ('cf000000-0000-4000-8000-000000001008', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001003', 'cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-000000000101'), ('cf000000-0000-4000-8000-000000001009', 'cf000000-0000-4000-8000-00000000000b', 'cf000000-0000-4000-8000-000000001005', 'cf000000-0000-4000-8000-000000001002', 'cf000000-0000-4000-8000-000000000201');
insert into public.patient_documents (id, tenant_id, patient_id, visit_id, title, original_filename, storage_path, file_size_bytes, mime_type, uploaded_by) values
  ('cf000000-0000-4000-8000-00000000100a', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-000000001003', 'Synthetic report', 'cfk.pdf', 'tenants/cf000000-0000-4000-8000-00000000000a/patients/cf000000-0000-4000-8000-000000001001/labs/cfk.pdf', 10, 'application/pdf', 'cf000000-0000-4000-8000-000000000101'),
  ('cf000000-0000-4000-8000-00000000100b', 'cf000000-0000-4000-8000-00000000000b', 'cf000000-0000-4000-8000-000000001002', null, 'Synthetic report', 'cfk.pdf', 'tenants/cf000000-0000-4000-8000-00000000000b/patients/cf000000-0000-4000-8000-000000001002/labs/cfk.pdf', 10, 'application/pdf', 'cf000000-0000-4000-8000-000000000201');
insert into public.api_keys (id, tenant_id, name, key_prefix, key_hash, created_by) values
  ('cf000000-0000-4000-8000-00000000100c', 'cf000000-0000-4000-8000-00000000000a', 'Synthetic CFK key A', 'cfk', repeat('b', 64), 'cf000000-0000-4000-8000-000000000101'),
  ('cf000000-0000-4000-8000-000000001011', 'cf000000-0000-4000-8000-00000000000a', 'Synthetic CFK key A2', 'cfk', repeat('e', 64), 'cf000000-0000-4000-8000-000000000101'),
  ('cf000000-0000-4000-8000-00000000100d', 'cf000000-0000-4000-8000-00000000000b', 'Synthetic CFK key B', 'cfk', repeat('d', 64), 'cf000000-0000-4000-8000-000000000201');
insert into public.webhook_subscriptions (id, tenant_id, endpoint_url, event_types, signing_secret) values
  ('cf000000-0000-4000-8000-00000000100e', 'cf000000-0000-4000-8000-00000000000a', 'https://hooks.example.test/cfk-a', array['ping'], repeat('s', 32)),
  ('cf000000-0000-4000-8000-00000000100f', 'cf000000-0000-4000-8000-00000000000b', 'https://hooks.example.test/cfk-b', array['ping'], repeat('s', 32));
-- One tenant-A child row per child table.
insert into public.invoice_items (id, tenant_id, invoice_id, item_type, description) values ('cf000000-0000-4000-8000-000000002001', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001006', 'consultation', 'Synthetic item');
insert into public.payments (id, tenant_id, invoice_id, amount, payment_method, recorded_by) values ('cf000000-0000-4000-8000-000000002002', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001006', 100, 'cash', 'cf000000-0000-4000-8000-000000000101');
insert into public.prescription_items (id, prescription_id, medicine_name, dosage, duration) values ('cf000000-0000-4000-8000-000000002003', 'cf000000-0000-4000-8000-000000001008', 'Synthetic medicine', '1-0-1', '5 days');
insert into public.consultation_diagnoses (id, tenant_id, visit_id, patient_id, diagnosis_name) values ('cf000000-0000-4000-8000-000000002004', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001003', 'cf000000-0000-4000-8000-000000001001', 'Synthetic diagnosis');
insert into public.consultations (id, tenant_id, patient_id, doctor_id) values ('cf000000-0000-4000-8000-000000002005', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-000000000101');
insert into public.consent_records (id, tenant_id, patient_id, consent_type, status, recorded_by) values ('cf000000-0000-4000-8000-000000002006', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001001', 'teleconsultation', 'granted', 'cf000000-0000-4000-8000-000000000101');
insert into public.follow_ups (id, tenant_id, patient_id, visit_id, doctor_id, follow_up_date) values ('cf000000-0000-4000-8000-000000002007', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-000000001003', 'cf000000-0000-4000-8000-000000000101', '2030-01-01');
insert into public.document_share_tokens (id, tenant_id, document_id, resource_type, resource_id, token_hash) values ('cf000000-0000-4000-8000-000000002008', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-00000000100a', 'patient_document', 'cf000000-0000-4000-8000-00000000100a', repeat('a', 64));
insert into public.communication_queue (id, tenant_id, patient_id, appointment_id, channel, message_type, template_id, status) values ('cf000000-0000-4000-8000-000000002009', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-000000001003', 'in_app', 'synthetic', 'synthetic', 'cancelled');
insert into public.queue_tokens (id, tenant_id, visit_id, token_number) values ('cf000000-0000-4000-8000-00000000200a', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001003', 1);
insert into public.visit_revisions (id, tenant_id, visit_id, revision_number, amended_by, amendment_reason, snapshot) values ('cf000000-0000-4000-8000-00000000200b', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001003', 1, 'cf000000-0000-4000-8000-000000000101', 'Synthetic amendment', '{}'::jsonb);
insert into public.waitlist_entries (id, tenant_id, patient_id, promoted_visit_id, doctor_id, target_date, created_by) values ('cf000000-0000-4000-8000-00000000200c', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-000000001003', 'cf000000-0000-4000-8000-000000000101', '2030-01-01', 'cf000000-0000-4000-8000-000000000101');
insert into public.referrals (id, tenant_id, patient_id, visit_id, referral_type, referring_doctor_id, referred_to_name, reason_for_referral) values ('cf000000-0000-4000-8000-00000000200d', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-000000001003', 'out_of_network', 'cf000000-0000-4000-8000-000000000101', 'Synthetic specialist', 'Synthetic reason');
insert into public.api_key_usage_daily (tenant_id, api_key_id, date) values ('cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-00000000100c', '2030-01-01');
insert into public.audit_logs (tenant_id, api_key_id, actor_role, action, entity_type) values ('cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-00000000100c', 'api_key', 'cfk.fixture', 'synthetic');
insert into public.webhook_delivery_queue (id, tenant_id, subscription_id, event_type, payload, status) values ('cf000000-0000-4000-8000-00000000200f', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-00000000100e', 'ping', '{}', 'delivered');
insert into public.schedule_blocks (id, tenant_id, doctor_id, start_time, end_time, created_by) values ('cf000000-0000-4000-8000-000000002010', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000000101', '2030-01-01T09:00:00Z', '2030-01-01T10:00:00Z', 'cf000000-0000-4000-8000-000000000101');
insert into public.doctor_custom_diagnoses (id, tenant_id, doctor_id, diagnosis_name) values ('cf000000-0000-4000-8000-000000002011', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000000101', 'Synthetic CFK diagnosis');
insert into public.doctor_custom_medicines (id, tenant_id, doctor_id, medicine_name) values ('cf000000-0000-4000-8000-000000002012', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000000101', 'Synthetic CFK medicine');
insert into public.doctor_prescription_templates (id, tenant_id, doctor_id, template_name) values ('cf000000-0000-4000-8000-000000002013', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000000101', 'Synthetic CFK template');
-- SET NULL (<col>) children of the visit and the API key deleted below.
insert into public.follow_ups (id, tenant_id, patient_id, visit_id, doctor_id, follow_up_date) values ('cf000000-0000-4000-8000-000000002020', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-000000001010', 'cf000000-0000-4000-8000-000000000101', '2030-01-02');
insert into public.patient_documents (id, tenant_id, patient_id, visit_id, title, original_filename, storage_path, file_size_bytes, mime_type, uploaded_by) values
  ('cf000000-0000-4000-8000-000000002021', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-000000001010', 'Synthetic report 2', 'cfk2.pdf', 'tenants/cf000000-0000-4000-8000-00000000000a/patients/cf000000-0000-4000-8000-000000001001/labs/cfk2.pdf', 10, 'application/pdf', 'cf000000-0000-4000-8000-000000000101');
insert into public.communication_queue (id, tenant_id, patient_id, appointment_id, channel, message_type, template_id, status) values ('cf000000-0000-4000-8000-000000002022', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-000000001010', 'in_app', 'synthetic', 'synthetic', 'cancelled');
insert into public.referrals (id, tenant_id, patient_id, visit_id, referral_type, referring_doctor_id, referred_to_name, reason_for_referral) values ('cf000000-0000-4000-8000-000000002023', 'cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001001', 'cf000000-0000-4000-8000-000000001010', 'out_of_network', 'cf000000-0000-4000-8000-000000000101', 'Synthetic specialist', 'Synthetic reason');
insert into public.audit_logs (tenant_id, api_key_id, actor_role, action, entity_type) values ('cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001011', 'api_key', 'cfk.setnull', 'synthetic');

-- 05-02a: every visit gets a clinical_notes row (trigger). Remove those of the visits the clinical_notes clone case
-- names (1004 = the control's visit, 1005 = tenant B's), and of 1010 (it must keep only SET NULL children, section 5).
delete from public.clinical_notes where visit_id in ('cf000000-0000-4000-8000-000000001004', 'cf000000-0000-4000-8000-000000001005', 'cf000000-0000-4000-8000-000000001010');

-- Helpers ----------------------------------------------------------------------------------------------------------
-- Runs one statement in a subtransaction that is ALWAYS rolled back; returns 'ok' or the SQLSTATE it raised.
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
begin
  begin
    execute p_sql;
    raise exception 'cfk sentinel' using errcode = 'P0S01';
  exception when others then
    if sqlstate = 'P0S01' then return 'ok'; end if;
    return sqlstate;
  end;
end
$f$;
-- INSERT … SELECT of a clone of one existing row with some columns overridden.
create function pg_temp.clone(p_table text, p_where text, p_set jsonb) returns text language sql as $f$
  select format('insert into public.%1$I select (jsonb_populate_record(null::public.%1$I, to_jsonb(c) || %2$L::jsonb)).* from public.%1$I c where %3$s',
                p_table, p_set, p_where)
$f$;

create temp table cfk_case (fk text primary key, tbl text, where_ text, ok jsonb, bad jsonb, defn text, neg boolean) on commit drop;
insert into cfk_case values
  ('visits_tenant_patient_fkey', 'visits', $w$id = 'cf000000-0000-4000-8000-000000001003'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('patient_id', 'cf000000-0000-4000-8000-000000001002'), 'FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE RESTRICT', true),
  ('visits_tenant_doctor_fkey', 'visits', $w$id = 'cf000000-0000-4000-8000-000000001003'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('doctor_id', 'cf000000-0000-4000-8000-000000000201'), 'FOREIGN KEY (doctor_id, tenant_id) REFERENCES memberships(user_id, tenant_id) ON DELETE RESTRICT', true),
  -- 05-11a (H-VISIT, 000068): a visit's signer is a member of its clinic.
  ('visits_tenant_signed_by_fkey', 'visits', $w$id = 'cf000000-0000-4000-8000-000000001003'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('signed_by', 'cf000000-0000-4000-8000-000000000201'), 'FOREIGN KEY (signed_by, tenant_id) REFERENCES memberships(user_id, tenant_id) ON DELETE RESTRICT', true),
  ('invoices_tenant_patient_fkey', 'invoices', $w$id = 'cf000000-0000-4000-8000-000000001006'$w$, jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'CFK-0099', 'visit_id', 'cf000000-0000-4000-8000-000000001004'), jsonb_build_object('patient_id', 'cf000000-0000-4000-8000-000000001002'), 'FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE RESTRICT', true),
  ('invoices_tenant_visit_fkey', 'invoices', $w$id = 'cf000000-0000-4000-8000-000000001006'$w$, jsonb_build_object('id', gen_random_uuid(), 'invoice_number', 'CFK-0099', 'visit_id', 'cf000000-0000-4000-8000-000000001004'), jsonb_build_object('visit_id', 'cf000000-0000-4000-8000-000000001005'), 'FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id) ON DELETE RESTRICT', true),
  ('payments_tenant_invoice_fkey', 'payments', $w$id = 'cf000000-0000-4000-8000-000000002002'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('invoice_id', 'cf000000-0000-4000-8000-000000001007'), 'FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id) ON DELETE RESTRICT', true),
  ('prescriptions_tenant_patient_fkey', 'prescriptions', $w$id = 'cf000000-0000-4000-8000-000000001008'$w$, jsonb_build_object('id', gen_random_uuid(), 'version', 2), jsonb_build_object('patient_id', 'cf000000-0000-4000-8000-000000001002'), 'FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE RESTRICT', true),
  ('prescriptions_tenant_visit_fkey', 'prescriptions', $w$id = 'cf000000-0000-4000-8000-000000001008'$w$, jsonb_build_object('id', gen_random_uuid(), 'version', 2), jsonb_build_object('visit_id', 'cf000000-0000-4000-8000-000000001005'), 'FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id) ON DELETE RESTRICT', true),
  ('prescriptions_tenant_doctor_fkey', 'prescriptions', $w$id = 'cf000000-0000-4000-8000-000000001008'$w$, jsonb_build_object('id', gen_random_uuid(), 'version', 2), jsonb_build_object('doctor_id', 'cf000000-0000-4000-8000-000000000201'), 'FOREIGN KEY (doctor_id, tenant_id) REFERENCES memberships(user_id, tenant_id) ON DELETE RESTRICT', true),
  ('consultation_diagnoses_tenant_patient_fkey', 'consultation_diagnoses', $w$id = 'cf000000-0000-4000-8000-000000002004'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('patient_id', 'cf000000-0000-4000-8000-000000001002'), 'FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE RESTRICT', true),
  ('consultation_diagnoses_tenant_visit_fkey', 'consultation_diagnoses', $w$id = 'cf000000-0000-4000-8000-000000002004'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('visit_id', 'cf000000-0000-4000-8000-000000001005'), 'FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id) ON DELETE RESTRICT', true),
  ('consultations_tenant_patient_fkey', 'consultations', $w$id = 'cf000000-0000-4000-8000-000000002005'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('patient_id', 'cf000000-0000-4000-8000-000000001002'), 'FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE RESTRICT', true),
  ('consultations_tenant_doctor_fkey', 'consultations', $w$id = 'cf000000-0000-4000-8000-000000002005'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('doctor_id', 'cf000000-0000-4000-8000-000000000201'), 'FOREIGN KEY (doctor_id, tenant_id) REFERENCES memberships(user_id, tenant_id) ON DELETE RESTRICT', true),
  ('consent_records_tenant_patient_fkey', 'consent_records', $w$id = 'cf000000-0000-4000-8000-000000002006'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('patient_id', 'cf000000-0000-4000-8000-000000001002'), 'FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE RESTRICT', true),
  ('follow_ups_tenant_patient_fkey', 'follow_ups', $w$id = 'cf000000-0000-4000-8000-000000002007'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('patient_id', 'cf000000-0000-4000-8000-000000001002'), 'FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE RESTRICT', true),
  ('follow_ups_tenant_visit_fkey', 'follow_ups', $w$id = 'cf000000-0000-4000-8000-000000002007'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('visit_id', 'cf000000-0000-4000-8000-000000001005'), 'FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id) ON DELETE SET NULL (visit_id)', true),
  ('follow_ups_tenant_doctor_fkey', 'follow_ups', $w$id = 'cf000000-0000-4000-8000-000000002007'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('doctor_id', 'cf000000-0000-4000-8000-000000000201'), 'FOREIGN KEY (doctor_id, tenant_id) REFERENCES memberships(user_id, tenant_id) ON DELETE RESTRICT', true),
  ('patient_documents_tenant_patient_fkey', 'patient_documents', $w$id = 'cf000000-0000-4000-8000-00000000100a'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('patient_id', 'cf000000-0000-4000-8000-000000001002', 'storage_path', 'tenants/cf000000-0000-4000-8000-00000000000a/patients/cf000000-0000-4000-8000-000000001002/labs/cfk.pdf'), 'FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE RESTRICT', true),
  ('patient_documents_tenant_visit_fkey', 'patient_documents', $w$id = 'cf000000-0000-4000-8000-00000000100a'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('visit_id', 'cf000000-0000-4000-8000-000000001005'), 'FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id) ON DELETE SET NULL (visit_id)', true),
  ('document_share_tokens_tenant_document_fkey', 'document_share_tokens', $w$id = 'cf000000-0000-4000-8000-000000002008'$w$, jsonb_build_object('id', gen_random_uuid(), 'token_hash', repeat('c', 64)), jsonb_build_object('document_id', 'cf000000-0000-4000-8000-00000000100b'), 'FOREIGN KEY (tenant_id, document_id) REFERENCES patient_documents(tenant_id, id) ON DELETE CASCADE', true),
  ('communication_queue_tenant_patient_fkey', 'communication_queue', $w$id = 'cf000000-0000-4000-8000-000000002009'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('patient_id', 'cf000000-0000-4000-8000-000000001002'), 'FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE RESTRICT', true),
  ('communication_queue_tenant_appointment_fkey', 'communication_queue', $w$id = 'cf000000-0000-4000-8000-000000002009'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('appointment_id', 'cf000000-0000-4000-8000-000000001005'), 'FOREIGN KEY (tenant_id, appointment_id) REFERENCES visits(tenant_id, id) ON DELETE SET NULL (appointment_id)', true),
  ('queue_tokens_tenant_visit_fkey', 'queue_tokens', $w$id = 'cf000000-0000-4000-8000-00000000200a'$w$, jsonb_build_object('id', gen_random_uuid(), 'visit_id', 'cf000000-0000-4000-8000-000000001004', 'token_number', 2), jsonb_build_object('visit_id', 'cf000000-0000-4000-8000-000000001005'), 'FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id) ON DELETE RESTRICT', true),
  ('clinical_notes_tenant_visit_fkey', 'clinical_notes', $w$visit_id = 'cf000000-0000-4000-8000-000000001003'$w$, jsonb_build_object('visit_id', 'cf000000-0000-4000-8000-000000001004'), jsonb_build_object('visit_id', 'cf000000-0000-4000-8000-000000001005'), 'FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id) ON DELETE RESTRICT', true),
  ('visit_revisions_tenant_visit_fkey', 'visit_revisions', $w$id = 'cf000000-0000-4000-8000-00000000200b'$w$, jsonb_build_object('id', gen_random_uuid(), 'revision_number', 2), jsonb_build_object('visit_id', 'cf000000-0000-4000-8000-000000001005'), 'FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id) ON DELETE RESTRICT', true),
  ('waitlist_entries_tenant_patient_fkey', 'waitlist_entries', $w$id = 'cf000000-0000-4000-8000-00000000200c'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('patient_id', 'cf000000-0000-4000-8000-000000001002'), 'FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE RESTRICT', true),
  ('waitlist_entries_tenant_promoted_visit_fkey', 'waitlist_entries', $w$id = 'cf000000-0000-4000-8000-00000000200c'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('promoted_visit_id', 'cf000000-0000-4000-8000-000000001005'), 'FOREIGN KEY (tenant_id, promoted_visit_id) REFERENCES visits(tenant_id, id) ON DELETE RESTRICT', true),
  ('waitlist_entries_tenant_doctor_fkey', 'waitlist_entries', $w$id = 'cf000000-0000-4000-8000-00000000200c'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('doctor_id', 'cf000000-0000-4000-8000-000000000201'), 'FOREIGN KEY (doctor_id, tenant_id) REFERENCES memberships(user_id, tenant_id) ON DELETE RESTRICT', true),
  ('referrals_tenant_patient_fkey', 'referrals', $w$id = 'cf000000-0000-4000-8000-00000000200d'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('patient_id', 'cf000000-0000-4000-8000-000000001002'), 'FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE RESTRICT', true),
  ('referrals_tenant_visit_fkey', 'referrals', $w$id = 'cf000000-0000-4000-8000-00000000200d'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('visit_id', 'cf000000-0000-4000-8000-000000001005'), 'FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id) ON DELETE SET NULL (visit_id)', true),
  ('referrals_tenant_referring_doctor_fkey', 'referrals', $w$id = 'cf000000-0000-4000-8000-00000000200d'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('referring_doctor_id', 'cf000000-0000-4000-8000-000000000201'), 'FOREIGN KEY (referring_doctor_id, tenant_id) REFERENCES memberships(user_id, tenant_id) ON DELETE RESTRICT', true),
  ('invoice_items_tenant_invoice_fkey', 'invoice_items', $w$id = 'cf000000-0000-4000-8000-000000002001'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('invoice_id', 'cf000000-0000-4000-8000-000000001007'), 'FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id) ON DELETE CASCADE', true),
  ('prescription_items_tenant_prescription_fkey', 'prescription_items', $w$id = 'cf000000-0000-4000-8000-000000002003'$w$, jsonb_build_object('id', gen_random_uuid()), '{}'::jsonb, 'FOREIGN KEY (tenant_id, prescription_id) REFERENCES prescriptions(tenant_id, id) ON DELETE CASCADE', false),
  ('api_key_usage_daily_tenant_api_key_fkey', 'api_key_usage_daily', $w$api_key_id = 'cf000000-0000-4000-8000-00000000100c'$w$, jsonb_build_object('date', '2030-01-02'), jsonb_build_object('api_key_id', 'cf000000-0000-4000-8000-00000000100d'), 'FOREIGN KEY (tenant_id, api_key_id) REFERENCES api_keys(tenant_id, id) ON DELETE CASCADE', true),
  ('audit_logs_tenant_api_key_fkey', 'audit_logs', $w$action = 'cfk.fixture'$w$, jsonb_build_object('id', -1), jsonb_build_object('api_key_id', 'cf000000-0000-4000-8000-00000000100d'), 'FOREIGN KEY (tenant_id, api_key_id) REFERENCES api_keys(tenant_id, id) ON DELETE SET NULL (api_key_id)', true),
  ('webhook_delivery_queue_tenant_subscription_fkey', 'webhook_delivery_queue', $w$id = 'cf000000-0000-4000-8000-00000000200f'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('subscription_id', 'cf000000-0000-4000-8000-00000000100f'), 'FOREIGN KEY (tenant_id, subscription_id) REFERENCES webhook_subscriptions(tenant_id, id) ON DELETE CASCADE', true),
  ('schedule_blocks_tenant_doctor_fkey', 'schedule_blocks', $w$id = 'cf000000-0000-4000-8000-000000002010'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('doctor_id', 'cf000000-0000-4000-8000-000000000201'), 'FOREIGN KEY (doctor_id, tenant_id) REFERENCES memberships(user_id, tenant_id) ON DELETE RESTRICT', true),
  ('doctor_custom_diagnoses_tenant_doctor_fkey', 'doctor_custom_diagnoses', $w$id = 'cf000000-0000-4000-8000-000000002011'$w$, jsonb_build_object('id', gen_random_uuid(), 'diagnosis_name', 'Synthetic CFK diagnosis 2'), jsonb_build_object('doctor_id', 'cf000000-0000-4000-8000-000000000201'), 'FOREIGN KEY (doctor_id, tenant_id) REFERENCES memberships(user_id, tenant_id) ON DELETE RESTRICT', true),
  ('doctor_custom_medicines_tenant_doctor_fkey', 'doctor_custom_medicines', $w$id = 'cf000000-0000-4000-8000-000000002012'$w$, jsonb_build_object('id', gen_random_uuid(), 'medicine_name', 'Synthetic CFK medicine 2'), jsonb_build_object('doctor_id', 'cf000000-0000-4000-8000-000000000201'), 'FOREIGN KEY (doctor_id, tenant_id) REFERENCES memberships(user_id, tenant_id) ON DELETE RESTRICT', true),
  ('doctor_prescription_templates_tenant_doctor_fkey', 'doctor_prescription_templates', $w$id = 'cf000000-0000-4000-8000-000000002013'$w$, jsonb_build_object('id', gen_random_uuid()), jsonb_build_object('doctor_id', 'cf000000-0000-4000-8000-000000000201'), 'FOREIGN KEY (doctor_id, tenant_id) REFERENCES memberships(user_id, tenant_id) ON DELETE RESTRICT', true);

-- 1. The composite FK set is exactly the plan's (name, table, definition), all validated ------------------------------
select set_eq(
  $$select c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
      from pg_constraint c
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and cardinality(c.conkey) > 1$$,
  $$select tbl || ' ' || fk || ' ' || defn from cfk_case$$,
  'the composite tenant FKs are exactly the 38 of 05-03 plus clinical_notes (05-02a) and the visit signer (05-11a) (columns, parent, delete action)');
select is((select count(*)::int from pg_constraint c join pg_namespace n on n.oid = c.connamespace
            where c.contype = 'f' and not c.convalidated and n.nspname in ('public', 'ops', 'private')), 0,
  'no foreign key in public/ops/private is left NOT VALID');
select is_empty(
  $$select conname from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace
     and conname = any(array['visits_patient_id_fkey', 'invoices_patient_id_fkey', 'invoices_visit_id_fkey', 'payments_invoice_id_fkey', 'prescriptions_patient_id_fkey', 'prescriptions_visit_id_fkey', 'consultation_diagnoses_patient_id_fkey', 'consultation_diagnoses_visit_id_fkey', 'consultations_patient_id_fkey', 'consent_records_patient_id_fkey', 'follow_ups_patient_id_fkey', 'patient_documents_patient_id_fkey', 'communication_queue_patient_id_fkey', 'queue_tokens_visit_id_fkey', 'visit_revisions_visit_id_fkey', 'waitlist_entries_patient_id_fkey', 'waitlist_entries_promoted_visit_id_fkey', 'referrals_patient_id_fkey', 'invoice_items_invoice_id_fkey', 'prescription_items_prescription_id_fkey', 'document_share_tokens_document_id_fkey', 'api_key_usage_daily_api_key_id_fkey', 'webhook_delivery_queue_subscription_id_fkey', 'follow_ups_visit_id_fkey', 'patient_documents_visit_id_fkey', 'communication_queue_appointment_id_fkey', 'referrals_visit_id_fkey', 'audit_logs_api_key_id_fkey'])$$,
  'the 28 replaced single-column FKs to tenant parents are dropped');
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'referrals_target_tenant_id_fkey'),
  'FOREIGN KEY (target_tenant_id) REFERENCES tenants(id) ON DELETE SET NULL',
  'referrals.target_tenant_id stays a single-column FK (cross-tenant by design)');

-- 2. A tenant-A child naming a tenant-B parent (or a non-member doctor) fails 23503, for every composite FK ---------
select is(pg_temp.try(pg_temp.clone(tbl, where_, ok || bad)), '23503',
          fk || ': a tenant-A ' || tbl || ' row naming tenant B''s parent / a non-member doctor is refused (23503)')
  from cfk_case where neg order by fk;

-- 3. Control: the same clone in its own clinic inserts ----------------------------------------------------------------
select is(pg_temp.try(pg_temp.clone(tbl, where_, ok)), 'ok', fk || ': the same row within tenant A inserts (control)')
  from cfk_case order by fk;

-- 4. Named cases: M-XTENANT-WH, OA-4 visit, prescription_items ----------------------------------------------------------
select is(pg_temp.try($$insert into public.webhook_delivery_queue (tenant_id, subscription_id, event_type, payload)
                       values ('cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-00000000100f', 'ping', '{}')$$), '23503',
  'M-XTENANT-WH: as postgres (the only writer since V2-04), a tenant-A queue row naming tenant B''s subscription is refused');
select is(pg_temp.try($$update public.visits set patient_id = 'cf000000-0000-4000-8000-000000001002' where id = 'cf000000-0000-4000-8000-000000001003'$$), '42501',
  'an UPDATE re-pointing a tenant-A visit at a tenant-B patient is refused too (since 05-11a before the FK: patient_id is immutable)');
select is(pg_temp.try($$insert into public.prescription_items (tenant_id, prescription_id, medicine_name, dosage, duration)
                       values ('cf000000-0000-4000-8000-00000000000a', 'cf000000-0000-4000-8000-000000001009', 'Synthetic', '1-0-1', '5 days')$$), '23514',
  'prescription_items: a supplied tenant_id that differs from the prescription''s is refused (23514, fill trigger)');
select is(pg_temp.try($$update public.prescription_items set prescription_id = 'cf000000-0000-4000-8000-000000001009' where id = 'cf000000-0000-4000-8000-000000002003'$$), '42501',
  'prescription_items: re-pointing a tenant-A item at tenant B''s prescription is refused (since 05-11d before the FK: an item''s keys are immutable)');
insert into public.prescription_items (id, prescription_id, medicine_name, dosage, duration) values ('cf000000-0000-4000-8000-000000002030', 'cf000000-0000-4000-8000-000000001008', 'Synthetic', '1-0-1', '5 days');
select is((select tenant_id from public.prescription_items where id = 'cf000000-0000-4000-8000-000000002030'), 'cf000000-0000-4000-8000-00000000000a'::uuid,
  'prescription_items: an insert without tenant_id (the app path) gets its prescription''s tenant');
select col_not_null('public', 'prescription_items', 'tenant_id', 'prescription_items.tenant_id is NOT NULL');
select is_empty($$select i.id from public.prescription_items i join public.prescriptions p on p.id = i.prescription_id
                  where i.tenant_id is distinct from p.tenant_id$$,
  'every prescription item''s tenant_id equals its prescription''s (backfill and trigger)');
select fk_ok('public', 'prescription_items', 'tenant_id', 'public', 'tenants', 'id',
  'prescription_items.tenant_id references tenants(id)');

-- 5. SET NULL (<col>): deleting the parent nulls only the link column, never tenant_id ---------------------------------
select lives_ok($$delete from public.visits where id = 'cf000000-0000-4000-8000-000000001010'$$, 'a visit with only SET NULL children can be deleted (as postgres)');

select is((select visit_id from public.follow_ups where id = 'cf000000-0000-4000-8000-000000002020'), null::uuid, 'follow_ups.visit_id is set null when its visit is deleted');
select is((select tenant_id from public.follow_ups where id = 'cf000000-0000-4000-8000-000000002020'), 'cf000000-0000-4000-8000-00000000000a'::uuid, 'follow_ups.tenant_id is kept (SET NULL (visit_id) column list)');
select is((select visit_id from public.patient_documents where id = 'cf000000-0000-4000-8000-000000002021'), null::uuid, 'patient_documents.visit_id is set null when its visit is deleted');
select is((select tenant_id from public.patient_documents where id = 'cf000000-0000-4000-8000-000000002021'), 'cf000000-0000-4000-8000-00000000000a'::uuid, 'patient_documents.tenant_id is kept (SET NULL (visit_id) column list)');
select is((select appointment_id from public.communication_queue where id = 'cf000000-0000-4000-8000-000000002022'), null::uuid, 'communication_queue.appointment_id is set null when its visit is deleted');
select is((select tenant_id from public.communication_queue where id = 'cf000000-0000-4000-8000-000000002022'), 'cf000000-0000-4000-8000-00000000000a'::uuid, 'communication_queue.tenant_id is kept (SET NULL (appointment_id) column list)');
select is((select visit_id from public.referrals where id = 'cf000000-0000-4000-8000-000000002023'), null::uuid, 'referrals.visit_id is set null when its visit is deleted');
select is((select tenant_id from public.referrals where id = 'cf000000-0000-4000-8000-000000002023'), 'cf000000-0000-4000-8000-00000000000a'::uuid, 'referrals.tenant_id is kept (SET NULL (visit_id) column list)');
select lives_ok($$delete from public.api_keys where id = 'cf000000-0000-4000-8000-000000001011'$$, 'an API key referenced by an audit row can be deleted');
select is((select row(api_key_id, tenant_id)::text from public.audit_logs where action = 'cfk.setnull' and tenant_id = 'cf000000-0000-4000-8000-00000000000a'),
  row(null::uuid, 'cf000000-0000-4000-8000-00000000000a'::uuid)::text, 'audit_logs.api_key_id is set null and tenant_id kept (SET NULL (api_key_id))');

-- 6. RESTRICT holds for a parent with history; deleting the TENANT still cascades through every child -----------------
select is(pg_temp.try($$delete from public.patients where id = 'cf000000-0000-4000-8000-000000001001'$$), '23503',
  'a patient with visits cannot be deleted (RESTRICT)');
select lives_ok($$delete from public.tenants where id = 'cf000000-0000-4000-8000-00000000000a'$$,
  'deleting tenant A cascades through children that RESTRICT each other (teardown and purge)');
select is((select count(*)::int from public.visits where tenant_id = 'cf000000-0000-4000-8000-00000000000a')
        + (select count(*)::int from public.memberships where tenant_id = 'cf000000-0000-4000-8000-00000000000a')
        + (select count(*)::int from public.prescription_items where tenant_id = 'cf000000-0000-4000-8000-00000000000a')
        + (select count(*)::int from public.audit_logs where tenant_id = 'cf000000-0000-4000-8000-00000000000a'), 0,
  'no tenant-A visit, membership, prescription item or audit row is left');

select * from finish();
rollback;
