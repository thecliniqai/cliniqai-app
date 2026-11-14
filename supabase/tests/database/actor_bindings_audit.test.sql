-- actor_bindings_audit.test.sql — V2-05 fix plan 05-11b, migration 000074: M-ACTOR for consents and referrals (05a
-- review RLS M-3, IND L2), RLS L-3 (referral target doctor), IND L6 (referral consent coverage), INT L-5 (log_audit
-- allow-lists) and IND L4 (template request_roles).
-- Synthetic data only; every probe and the file roll back.
begin;
select plan(34);

-- Fixtures ---------------------------------------------------------------------------------------------------------
-- Clinic A: owner (OA), doctor (DR), second doctor (D2), receptionist (RC), nurse (NU). Clinic B (listed in the
-- referral directory): owner (OB), doctor (DB), receptionist (RB). One patient in A, and an older in-network referral
-- (written before 000074: clinical summary, no consent).
insert into auth.users (id, email) values
  ('b11b0000-0000-4000-8000-000000000401', 'b11b-act-owner-a@example.test'),
  ('b11b0000-0000-4000-8000-000000000402', 'b11b-act-doctor-a@example.test'),
  ('b11b0000-0000-4000-8000-000000000403', 'b11b-act-doctor2-a@example.test'),
  ('b11b0000-0000-4000-8000-000000000404', 'b11b-act-reception-a@example.test'),
  ('b11b0000-0000-4000-8000-000000000405', 'b11b-act-nurse-a@example.test'),
  ('b11b0000-0000-4000-8000-000000000411', 'b11b-act-owner-b@example.test'),
  ('b11b0000-0000-4000-8000-000000000412', 'b11b-act-doctor-b@example.test'),
  ('b11b0000-0000-4000-8000-000000000413', 'b11b-act-reception-b@example.test');
insert into public.tenants (id, name, referral_directory_listed) values
  ('b11b0000-0000-4000-8000-00000000040a', 'Synthetic 05-11b Actor Clinic A', false),
  ('b11b0000-0000-4000-8000-00000000040b', 'Synthetic 05-11b Actor Clinic B', true);
insert into public.memberships (user_id, tenant_id, role) values
  ('b11b0000-0000-4000-8000-000000000401', 'b11b0000-0000-4000-8000-00000000040a', 'owner'),
  ('b11b0000-0000-4000-8000-000000000402', 'b11b0000-0000-4000-8000-00000000040a', 'doctor'),
  ('b11b0000-0000-4000-8000-000000000403', 'b11b0000-0000-4000-8000-00000000040a', 'doctor'),
  ('b11b0000-0000-4000-8000-000000000404', 'b11b0000-0000-4000-8000-00000000040a', 'receptionist'),
  ('b11b0000-0000-4000-8000-000000000405', 'b11b0000-0000-4000-8000-00000000040a', 'nurse'),
  ('b11b0000-0000-4000-8000-000000000411', 'b11b0000-0000-4000-8000-00000000040b', 'owner'),
  ('b11b0000-0000-4000-8000-000000000412', 'b11b0000-0000-4000-8000-00000000040b', 'doctor'),
  ('b11b0000-0000-4000-8000-000000000413', 'b11b0000-0000-4000-8000-00000000040b', 'receptionist');
insert into public.patients (id, tenant_id, full_name, phone, created_by) values
  ('b11b0000-0000-4000-8000-000000004001', 'b11b0000-0000-4000-8000-00000000040a', 'Synthetic Actor Patient',
   '+919000000821', 'b11b0000-0000-4000-8000-000000000401');
alter table public.referrals disable trigger referrals_directory_consent_guard;
insert into public.referrals (id, tenant_id, patient_id, referral_type, referring_doctor_id, referred_to_name,
                              reason_for_referral, target_tenant_id, clinical_summary) values
  ('b11b0000-0000-4000-8000-000000004002', 'b11b0000-0000-4000-8000-00000000040a', 'b11b0000-0000-4000-8000-000000004001',
   'in_network', 'b11b0000-0000-4000-8000-000000000402', 'Synthetic Clinic B', 'Synthetic reason',
   'b11b0000-0000-4000-8000-00000000040b', 'Synthetic legacy summary');
alter table public.referrals enable trigger referrals_directory_consent_guard;

-- Helper: as the user acting in p_header: run p_sql; rows affected/returned, 'denied:<message>' (42501) or
-- 'error:<sqlstate>:<message>'. With p_probe, the first column of p_probe (as postgres, same subtransaction) instead.
-- Always rolled back.
create function pg_temp.as_user(p_user uuid, p_header uuid, p_sql text, p_probe text default null) returns text
language plpgsql as $f$
declare
  v_rows bigint;
  v_out text;
begin
  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    perform set_config('request.headers',
      case when p_header is null then '' else json_build_object('x-clinicos-tenant', p_header)::text end, true);
    set local role authenticated;
    execute p_sql;
    get diagnostics v_rows = row_count;
    v_out := v_rows::text;
    if p_probe is not null then
      reset role;
      execute p_probe into v_out;
    end if;
    raise exception 'b11b sentinel' using errcode = 'P0S11';
  exception
    when sqlstate 'P0S11' then null;
    when insufficient_privilege then v_out := 'denied:' || sqlerrm;
    when others then v_out := 'error:' || sqlstate || ':' || sqlerrm;
  end;
  return v_out;
end;
$f$;

create function pg_temp.referral_sql(p_doctor text, p_extra_cols text default '', p_extra_vals text default '',
                                     p_target text default 'b11b0000-0000-4000-8000-00000000040b') returns text
language sql as $f$
  select format($q$insert into public.referrals (tenant_id, patient_id, referral_type, referring_doctor_id,
      referred_to_name, reason_for_referral, target_tenant_id%s)
    values ('b11b0000-0000-4000-8000-00000000040a', 'b11b0000-0000-4000-8000-000000004001', %L, %L,
      'Synthetic Clinic B', 'Synthetic reason', %s%s)$q$,
    p_extra_cols, case when p_target is null then 'out_of_network' else 'in_network' end, p_doctor,
    coalesce(quote_literal(p_target), 'null'), p_extra_vals)
$f$;

create function pg_temp.audit_sql(p_action text, p_metadata text default null) returns text language sql as $f$
  select format($q$select public.log_audit('b11b0000-0000-4000-8000-00000000040a', %L, 'patient',
      'b11b0000-0000-4000-8000-000000004001', %s)$q$, p_action, coalesce(quote_literal(p_metadata) || '::jsonb', 'null'))
$f$;

-- 1. consent_records: recorded_by is the caller (M-ACTOR) ----------------------------------------------------------------
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000404', 'b11b0000-0000-4000-8000-00000000040a',
  $$insert into public.consent_records (tenant_id, patient_id, consent_type, status, recorded_by)
    values ('b11b0000-0000-4000-8000-00000000040a', 'b11b0000-0000-4000-8000-000000004001', 'data_processing', 'granted',
            'b11b0000-0000-4000-8000-000000000401')$$),
  'denied:ACTOR_INVALID', 'a receptionist cannot record a consent as given by the owner (RLS M-3 repro)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000404', 'b11b0000-0000-4000-8000-00000000040a',
  $$insert into public.consent_records (tenant_id, patient_id, consent_type, status, recorded_by)
    values ('b11b0000-0000-4000-8000-00000000040a', 'b11b0000-0000-4000-8000-000000004001', 'data_processing', 'granted',
            'b11b0000-0000-4000-8000-000000000404')$$),
  '1', 'in their own name it is recorded (the app''s write)');
select lives_ok(
  $$insert into public.consent_records (tenant_id, patient_id, consent_type, status, recorded_by)
    values ('b11b0000-0000-4000-8000-00000000040a', 'b11b0000-0000-4000-8000-000000004001', 'data_processing', 'granted',
            'b11b0000-0000-4000-8000-000000000401')$$,
  'a system writer (no session) is not limited');

-- 2. referrals: actor columns (M-ACTOR) --------------------------------------------------------------------------------
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000402', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.referral_sql('b11b0000-0000-4000-8000-000000000403', '', '', null)),
  'denied:ACTOR_INVALID', 'a doctor cannot send a referral as another doctor (RLS M-3 repro)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000402', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.referral_sql('b11b0000-0000-4000-8000-000000000402', '', '', null)),
  '1', 'in their own name it is sent');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000403', 'b11b0000-0000-4000-8000-00000000040a',
  $$update public.referrals set referring_doctor_id = 'b11b0000-0000-4000-8000-000000000403'
     where id = 'b11b0000-0000-4000-8000-000000004002'$$),
  'denied:ACTOR_INVALID', 'nor take over a colleague''s referral');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000403', 'b11b0000-0000-4000-8000-00000000040a',
  $$update public.referrals set status = 'completed', closed_by = 'b11b0000-0000-4000-8000-000000000402'
     where id = 'b11b0000-0000-4000-8000-000000004002'$$),
  'denied:ACTOR_INVALID', 'nor close a referral in a colleague''s name');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000403', 'b11b0000-0000-4000-8000-00000000040a',
  $$update public.referrals set status = 'completed', closed_by = 'b11b0000-0000-4000-8000-000000000403',
            closure_notes = 'Synthetic return' where id = 'b11b0000-0000-4000-8000-000000004002'$$),
  '1', 'closing it in their own name works (closeReferralLoop), also on an older row without consent');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000412', 'b11b0000-0000-4000-8000-00000000040b',
  $$update public.referrals set status = 'acknowledged', acknowledged_at = now()
     where id = 'b11b0000-0000-4000-8000-000000004002'$$),
  '1', 'the target clinic still acknowledges an older referral');

-- 3. referrals: target doctor in the target clinic (RLS L-3) ---------------------------------------------------------------
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000402', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.referral_sql('b11b0000-0000-4000-8000-000000000402', ', target_doctor_id', ', ''b11b0000-0000-4000-8000-000000000403''')),
  'error:P0001:REFERRAL_TARGET_DOCTOR_INVALID', 'the target doctor cannot be a doctor of another clinic (RLS L-3 repro)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000402', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.referral_sql('b11b0000-0000-4000-8000-000000000402', ', target_doctor_id', ', ''b11b0000-0000-4000-8000-000000000413''')),
  'error:P0001:REFERRAL_TARGET_DOCTOR_INVALID', 'nor a receptionist of the target clinic');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000402', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.referral_sql('b11b0000-0000-4000-8000-000000000402', ', target_doctor_id', ', ''b11b0000-0000-4000-8000-000000000412''', null)),
  'error:P0001:REFERRAL_TARGET_DOCTOR_INVALID', 'nor anyone without a target clinic');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000402', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.referral_sql('b11b0000-0000-4000-8000-000000000402', ', target_doctor_id', ', ''b11b0000-0000-4000-8000-000000000412''')),
  '1', 'a doctor of the target clinic is accepted');

-- 4. referrals: consent covers every clinical field the target reads (IND L6) ----------------------------------------------
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000402', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.referral_sql('b11b0000-0000-4000-8000-000000000402', ', clinical_summary', ', ''Synthetic summary''')),
  'error:P0001:REFERRAL_CONSENT_REQUIRED', 'an in-network clinical summary needs the patient''s consent (IND L6 repro)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000402', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.referral_sql('b11b0000-0000-4000-8000-000000000402', ', provisional_diagnosis', ', ''Synthetic diagnosis''')),
  'error:P0001:REFERRAL_CONSENT_REQUIRED', 'so does a provisional diagnosis');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000402', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.referral_sql('b11b0000-0000-4000-8000-000000000402', ', active_medications_snapshot', ', ''[{"name":"Synthetic"}]''::jsonb')),
  'error:P0001:REFERRAL_CONSENT_REQUIRED', 'and a medications snapshot');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000402', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.referral_sql('b11b0000-0000-4000-8000-000000000402', ', investigations_advised', ', ''{Synthetic test}''::text[]')),
  'error:P0001:REFERRAL_CONSENT_REQUIRED', 'and advised investigations');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000402', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.referral_sql('b11b0000-0000-4000-8000-000000000402', ', clinical_summary, patient_consents_history_sharing',
                       ', ''Synthetic summary'', true')),
  '1', 'with consent it is sent');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000402', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.referral_sql('b11b0000-0000-4000-8000-000000000402', ', clinical_summary', ', ''Synthetic summary''', null)),
  '1', 'an out-of-network letter (no target clinic) needs no in-system consent');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000402', 'b11b0000-0000-4000-8000-00000000040a',
  $$update public.referrals set provisional_diagnosis = 'Synthetic later diagnosis'
     where id = 'b11b0000-0000-4000-8000-000000004002'$$),
  'error:P0001:REFERRAL_CONSENT_REQUIRED', 'adding clinical content to an in-network referral later needs consent too');

-- 5. log_audit allow-lists (INT L-5) ----------------------------------------------------------------------------------------
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000404', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.audit_sql('dpdp.data_export', '{"status":"completed","format":"json"}')),
  'denied:AUDIT_ACTION_FORBIDDEN', 'a receptionist cannot plant a completed DPDP export (INT L-5 repro)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000401', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.audit_sql('dpdp.data_export', '{"status":"completed","format":"json"}')),
  '1', 'the owner (exports:create) audits the in-app export');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000401', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.audit_sql('dpdp.patient_erasure')),
  'denied:AUDIT_ACTION_FORBIDDEN', 'an erasure event for a patient who is not erased is refused, even for the owner');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000404', 'b11b0000-0000-4000-8000-00000000040a',
  'update public.patients set is_deleted = true, status = ''erased'' where id = ''b11b0000-0000-4000-8000-000000004001''; '
  || pg_temp.audit_sql('dpdp.patient_erasure', '{"status":"erased","retention_policy":"NMC_REGULATION_1.3.1_3_YEAR_MANDATE"}'),
  $$select count(*)::text from public.audit_logs where action = 'dpdp.patient_erasure'
     and entity_id = 'b11b0000-0000-4000-8000-000000004001'$$),
  '1', 'after the soft delete, a patients:edit holder records the erasure (erasePatientRecord''s order)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000401', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.audit_sql('auth.session_revoked')),
  'denied:AUDIT_ACTION_FORBIDDEN', 'auth.');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000401', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.audit_sql('billing.plan_changed')),
  'denied:AUDIT_ACTION_FORBIDDEN', 'billing.');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000401', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.audit_sql('ops.job_replayed')),
  'denied:AUDIT_ACTION_FORBIDDEN', 'ops.');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000405', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.audit_sql('invoice.payment_recorded', '{"invoice_id":"b11b0000-0000-4000-8000-000000004001"}')),
  'denied:AUDIT_ACTION_FORBIDDEN', 'a payment audit row is written only inside record_payment');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000405', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.audit_sql('patient.exported_everything')),
  'error:P0001:INPUT_INVALID', 'an action the app never writes is refused');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000405', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.audit_sql('patient.view', '{"free_text":"Synthetic note"}')),
  'error:P0001:INPUT_INVALID', 'a metadata key outside the allow-list is refused');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000405', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.audit_sql('patient.view', '{"reason":{"nested":"x"}}')),
  'error:P0001:INPUT_INVALID', 'an object value is refused');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000405', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.audit_sql('patient.view', '{"reason":"' || repeat('x', 501) || '"}')),
  'error:P0001:INPUT_INVALID', 'a string value over 500 characters is refused (metadata cap)');
select is(pg_temp.as_user('b11b0000-0000-4000-8000-000000000405', 'b11b0000-0000-4000-8000-00000000040a',
  pg_temp.audit_sql('patient.view', '{"view_context":"profile","fields_changed":["a","b"],"system_actor":"system:x"}'),
  $$select coalesce(string_agg(actor_role || ':' || metadata::text, ','), 'none') from public.audit_logs
     where tenant_id = 'b11b0000-0000-4000-8000-00000000040a' and action = 'patient.view'$$),
  'nurse:{"view_context": "profile", "fields_changed": ["a", "b"]}',
  'an allow-listed event is recorded as the caller, system_actor dropped');

-- 6. template request roles (IND L4) ---------------------------------------------------------------------------------------
select is((select string_agg(template_id || '=' || array_to_string(array(select unnest(request_roles) order by 1), '+'), ',' order by template_id)
             from ops.message_templates where cardinality(request_roles) > 0),
  'appointment_booked=admin+doctor+nurse+owner+receptionist,consultation_documents=doctor+owner,'
  || 'lab_report_uploaded=doctor+nurse+owner,prescription_ready=doctor+owner,receipt_issued=admin+owner+receptionist,'
  || 'referral_letter_issued=doctor+nurse+owner',
  'each request template admits the roles holding its call site''s permission (IND L4)');

select * from finish();
rollback;
