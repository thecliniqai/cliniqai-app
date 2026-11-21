-- 000112_consult_draft_save.sql — V2-09b 09B-01: the consult's save model (R-2, R-3; 09B-PLAN.md).
--
-- Additive column, new command, grant narrowing after inventory.
--
-- R-2 The version. `clinical_notes.draft_version integer NOT NULL DEFAULT 0` (CHECK >= 0) is raised by exactly 1 on every committed UPDATE of
--     the row, on every path, by the BEFORE UPDATE trigger `clinical_notes_version_bump`: a caller-supplied value is ignored. The trigger
--     name sorts after `clinical_notes_guard`, so a sealed row is refused by the guard before any bump. A nurse's vitals write therefore
--     raises the version too, and a doctor's stale save conflicts at the database.
-- R-3 One command per draft save. `public.save_consultation_draft(p_tenant_id, p_visit_id, p_expected_version, p_patch, p_client_request_id)`
--     in the V2-07 pattern (SECURITY DEFINER under the caller's JWT, search_path '', lock_timeout 2s, guard block, claim, locks, invariants,
--     writes, in-transaction audit, command_complete). The patch keys are limited to the six notes columns' names, `specialty`, `provenance`
--     and `follow_up` (plus the audit-only flag `conflict_overwrite`: see below), with jsonb types and a 256 kB bound checked (INPUT_INVALID).
--     It locks the visit (FOR NO KEY UPDATE) and the notes row (FOR UPDATE), refuses a sealed visit and an unsigned completed or cancelled one
--     (DRAFT_LOCKED), refuses a stale expected version (DRAFT_CONFLICT), then writes only the keys present: the notes columns (the vitals
--     recorder rule moved here from the app), `visits.specialty` when it differs, the AI provenance keys of `visits.metadata`, the visit's one
--     follow-up (upsert, or delete for null), and starts a `waiting` visit through the shared `private.step_start_consultation` when the
--     caller also holds appointments:edit (a business refusal of that step never fails the save, as the old best-effort start did).
--     Audit `consultation.draft_save` is command-only now (fields_changed, draft_version, conflict_overwrite).
--     `conflict_overwrite` is the one patch key that is not written to a table: the client sets it when the doctor chose "Keep mine" after a
--     conflict (R-5), so the audit row can say the save overwrote another writer's change. The plan's R-3 names the audit field without
--     naming its source; this is the smallest one that does not widen the signature.
-- Contract (after the writer inventory in 09B-NOTES.md, 09B-01): UPDATE on clinical_notes for `authenticated` is narrowed to (vitals), the
--     nurse's vitals path; INSERT, UPDATE and DELETE on follow_ups are revoked from `authenticated` (no request path writes them now: the
--     command is the writer). The service role keeps its grants (no request path, ADR-0005). A partial unique index keeps one follow-up
--     per visit (Q-17; no live data, PO-15).
--
-- Replaced bodies start from their latest definitions: public.start_consultation 000100:235 (its body moves into private.step_start_consultation;
-- every statement unchanged), private.log_command_audit 000106:93 (one action added), private.audit_client_actions 000109:312 (consultation.draft_save
-- and follow_up.record removed), private.audit_metadata_keys 000109:340 (draft_version, conflict_overwrite added). New reason codes (P0001):
-- DRAFT_CONFLICT, DRAFT_LOCKED. Per-migration checklist: the command keeps the V2-07 pattern and grants (EXECUTE for authenticated only); the
-- shared step and the trigger function have no API grant; no data change.

-- 1. The column and its trigger (R-2) -----------------------------------------------------------------------------------------------------
ALTER TABLE public.clinical_notes
    ADD COLUMN draft_version integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT clinical_notes_draft_version_check CHECK (draft_version >= 0);
COMMENT ON COLUMN public.clinical_notes.draft_version IS
    'V2-09b (R-2): raised by exactly 1 on every committed UPDATE of the row (trigger clinical_notes_version_bump); save_consultation_draft compares it under the row locks (DRAFT_CONFLICT).';

CREATE FUNCTION private.clinical_notes_version_bump()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- A value the caller supplied is ignored: the version only ever rises by one per committed update.
    NEW.draft_version := OLD.draft_version + 1;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.clinical_notes_version_bump() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.clinical_notes_version_bump() IS
    'V2-09b (R-2): BEFORE UPDATE trigger function (invoker) of clinical_notes: draft_version = old + 1. It fires after clinical_notes_guard (name order), so a refused write bumps nothing.';
CREATE TRIGGER clinical_notes_version_bump
    BEFORE UPDATE ON public.clinical_notes
    FOR EACH ROW EXECUTE FUNCTION private.clinical_notes_version_bump();

-- 2. One follow-up per visit (Q-17) -------------------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX follow_ups_one_per_visit ON public.follow_ups (tenant_id, visit_id) WHERE visit_id IS NOT NULL;

-- 3. The start step, shared (R-3) ----------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.step_start_consultation(p_tenant_id uuid, p_visit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_visit record;
    v_check jsonb;
    v_token integer;
BEGIN
    -- Lock the visit (commands on one visit run one after the other: the second of two starts sees the first).
    SELECT v.status INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF v_visit.status = 'in_consultation' THEN
        SELECT q.token_number INTO v_token FROM public.queue_tokens q WHERE q.tenant_id = p_tenant_id AND q.visit_id = p_visit_id;
        RETURN jsonb_build_object('visit_id', p_visit_id, 'token_number', v_token, 'already_started', true);
    END IF;

    -- Check in first (booked, confirmed, no-show, or waiting without a token; refuses completed, cancelled and another
    -- day's booking), then open the consult: the visit never stays checked in without having started.
    v_check := private.step_check_in(p_tenant_id, p_visit_id, 'normal');
    UPDATE public.visits SET status = 'in_consultation', updated_at = now()
     WHERE id = p_visit_id AND tenant_id = p_tenant_id;
    UPDATE public.queue_tokens SET called_at = now()
     WHERE tenant_id = p_tenant_id AND visit_id = p_visit_id AND called_at IS NULL;
    v_token := (v_check ->> 'token_number')::integer;

    PERFORM private.log_command_audit(p_tenant_id, 'visit.consultation_start', 'visit', p_visit_id,
                             jsonb_build_object('token_number', v_token));

    RETURN jsonb_build_object('visit_id', p_visit_id, 'token_number', v_token, 'already_started', false);
END;
$$;
REVOKE ALL ON FUNCTION private.step_start_consultation(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.step_start_consultation(uuid, uuid) IS
    'V2-09b 09B-01 (R-3): the body of start_consultation (V2-08 08-01b), shared with save_consultation_draft: lock the visit, check it in (private.step_check_in), move it to in_consultation with the token''s called_at, visit.consultation_start audit row. A visit already in consultation answers already_started with no second audit row. The caller has checked actor, clinic and permissions and holds the command claim; no API grant.';

CREATE OR REPLACE FUNCTION public.start_consultation(p_tenant_id uuid, p_visit_id uuid, p_client_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_replay jsonb;
    v_result jsonb;
BEGIN
    -- 1. Actor.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then consultations:edit (opening the consult) and appointments:edit (moving the visit) there.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT (public.has_permission(p_tenant_id, 'consultations:edit') AND public.has_permission(p_tenant_id, 'appointments:edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim.
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.start_consultation',
                                      private.command_request_hash(jsonb_build_object('visit', p_visit_id)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock, check in, open the consult, audit (the shared step), result.
    v_result := private.step_start_consultation(p_tenant_id, p_visit_id) || jsonb_build_object('replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.start_consultation(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.start_consultation(uuid, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.start_consultation(uuid, uuid, uuid) IS
    'V2-08 08-01b (R-1), V2-09b 09B-01: "Start Consultation" in one transaction: a booked, confirmed, no-show or token-less waiting visit is checked in first (private.step_check_in: token, waiting, queue.check_in audit row), then moved to in_consultation with the token''s called_at and the visit.consultation_start audit row (the shared private.step_start_consultation). consultations:edit and appointments:edit. VISIT_NOT_CHECKABLE (completed, cancelled) and VISIT_NOT_TODAY (another day) are P0001. A visit already in consultation answers already_started with no second audit row. Idempotent by p_client_request_id. Result: visit_id, token_number, already_started, replayed.';

-- 4. Audit allow-lists --------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.log_command_audit(p_tenant uuid, p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_role text;
    v_id bigint;
    v_key text;
    v_value jsonb;
BEGIN
    IF v_uid IS NULL OR p_tenant IS NULL OR p_tenant IS DISTINCT FROM authz.active_tenant_id() THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;
    SELECT m.role INTO v_role FROM public.memberships m WHERE m.tenant_id = p_tenant AND m.user_id = v_uid;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;
    -- Only the actions a command writes (log_audit refuses these): a closed list.
    IF p_action IS NULL OR p_action NOT IN ('visit.complete_and_sign', 'visit.reopen_for_amendment', 'visit.amend_finalized',
                                            'invoice.create', 'queue.check_in',
                                            'visit.consultation_start', 'visit.complete_at_desk',
                                            'visit.reschedule', 'visit.no_show', 'visit.cancel', 'visit.confirm',
                                            'visit.auto_promoted_from_waitlist', 'waitlist.add', 'waitlist.promote',
                                            'visit.create', 'consultation.draft_save')
       OR p_entity_type IS NULL OR p_entity_type !~ '^[a-z][a-z0-9_]{0,49}$'
       OR (p_metadata IS NOT NULL AND (jsonb_typeof(p_metadata) <> 'object' OR octet_length(p_metadata::text) > 4096)) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- Metadata: the same allow-listed keys and bounded scalar values as public.log_audit.
    IF p_metadata IS NOT NULL THEN
        IF (SELECT count(*) FROM jsonb_object_keys(p_metadata)) > 20 THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        FOR v_key, v_value IN SELECT e.key, e.value FROM jsonb_each(p_metadata) e LOOP
            IF NOT (v_key = ANY (private.audit_metadata_keys())) THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
            IF jsonb_typeof(v_value) = 'array' THEN
                IF jsonb_array_length(v_value) > 50
                   OR EXISTS (
                       SELECT 1 FROM jsonb_array_elements(v_value) a(el)
                        WHERE jsonb_typeof(a.el) NOT IN ('string', 'number', 'boolean', 'null')
                           OR (jsonb_typeof(a.el) = 'string' AND char_length(a.el #>> '{}') > 500)
                   ) THEN
                    RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
                END IF;
            ELSIF jsonb_typeof(v_value) = 'object'
                  OR (jsonb_typeof(v_value) = 'string' AND char_length(v_value #>> '{}') > 500) THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
    END IF;

    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, actor_type, api_key_id, action, entity_type, entity_id, metadata)
    VALUES (p_tenant, v_uid, v_role, 'user', NULL, p_action, p_entity_type, p_entity_id, p_metadata)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION private.log_command_audit(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.log_command_audit(uuid, text, text, uuid, jsonb) IS
    'V2-07 07-04a (F-1), V2-08 08-01b, 08-04a, 08-06a, V2-09b 000112: writes an audit row as the session user for the actions only a command writes (visit.complete_and_sign, visit.reopen_for_amendment, visit.amend_finalized, invoice.create, queue.check_in, visit.consultation_start, visit.complete_at_desk, visit.reschedule, visit.no_show, visit.cancel, visit.confirm, visit.auto_promoted_from_waitlist, waitlist.add, waitlist.promote, visit.create, consultation.draft_save), with log_audit''s metadata rules. The active clinic and a membership are required. No API grant: public.log_audit refuses these actions.';

CREATE OR REPLACE FUNCTION private.audit_client_actions()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'api_key.create', 'api_key.revoke', 'appointment.create',
        'clinic.profile.update', 'clinic.settings.update', 'consultation.amend', 'consultation.complete_sign',
        'consultation.share_consolidated_whatsapp', 'diagnosis.add', 'diagnosis.remove',
        'diagnosis.update_note', 'invoice.generate_receipt_pdf',
        'invoice.item_add', 'invoice.item_remove', 'invoice.payment_recorded', 'invoice.share_whatsapp',
        'lab_order.create', 'patient.consent.granted', 'patient.consent.withdrawn', 'patient.create',
        'patient.update', 'patient.view', 'patient_document.delete', 'patient_document.generate_share_token',
        'patient_document.share_whatsapp', 'patient_document.upload', 'prescription.create',
        'prescription.generate_pdf', 'prescription.item_add', 'prescription.item_remove',
        'prescription.pdf_integrity_failed',
        'prescription.share_whatsapp', 'prescription.template_save',
        'referral.acknowledge', 'referral.close_loop', 'referral.create', 'referral.share_whatsapp',
        'schedule_block.create', 'schedule_block.delete', 'staff.member.update', 'user.profile.update',
        'vitals.record',
        'webhook.create', 'webhook.delete',
        'dpdp.data_export', 'dpdp.patient_erasure'
    ]::TEXT[];
$$;
COMMENT ON FUNCTION private.audit_client_actions() IS
    'The actions public.log_audit accepts from a signed-in member (parity: lib/audit/audit.ts AUDIT_ACTIONS without the reserved prefixes, plus the two bound DPDP events; tests/audit/log-audit-allowlist.spec.ts). V2-08 08-06a (S-5): appointment.cancel, appointment.reschedule, queue.transition, visit.status_update and visit.create are no longer accepted; their writers are the commands (private.log_command_audit) and the API-key path (audit_logs insert by the service client). V2-09a 000109: prescription.pdf_integrity_failed (a served sealed Rx PDF whose bytes did not match the stored SHA-256). V2-09b 000112: consultation.draft_save is written by save_consultation_draft only, and follow_up.record is gone with the app-side follow-up writer.';

CREATE OR REPLACE FUNCTION private.audit_metadata_keys()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'amendment_reason', 'conflict_overwrite', 'consent_type', 'correlation_id', 'dose_form', 'draft_version', 'erased_at',
        'fields_changed',
        'follow_up_date', 'format', 'invoice_id', 'invoice_number', 'is_chronic', 'is_custom', 'is_initial_grant',
        'is_overbooked', 'items_count', 'late_arrival', 'letterhead_mode', 'new_scheduled_at', 'new_status',
        'old_scheduled_at', 'old_status', 'origin_type',
        'patient_consents_history_sharing', 'payment_method', 'priority', 'promoted_from_waitlist_id',
        'promoted_visit_id', 'reason', 'referral_type', 'retention_policy', 'revision_number', 'sha256', 'specialty', 'status',
        'storage_path', 'target_date', 'target_tenant_id', 'template_name', 'token_number', 'total_amount', 'urgency',
        'version', 'view_context'
    ]::TEXT[];
$$;

-- 5. The command (R-3) -----------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.save_consultation_draft(
    p_tenant_id uuid,
    p_visit_id uuid,
    p_expected_version integer,
    p_patch jsonb,
    p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_replay jsonb;
    v_visit record;
    v_notes record;
    v_key text;
    v_el jsonb;
    v_fields text[] := ARRAY[]::text[];
    v_mkeys constant text[] := ARRAY['systolic', 'diastolic', 'pulse', 'temperature', 'spo2', 'weight', 'height', 'respiratory_rate', 'bmi'];
    v_in jsonb;
    v_vitals jsonb;
    v_has_measure boolean;
    v_same boolean;
    v_prov jsonb;
    v_specialty text;
    v_metadata jsonb;
    v_overwrite boolean := false;
    v_started boolean := false;
    v_new_version integer;
    v_fu jsonb;
    v_fu_date date;
    v_result jsonb;
BEGIN
    -- 1. Actor: a session; this command has no system path.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. The tenant is the session's ACTIVE clinic (another clinic reads as not found), then consultations:edit there.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'consultations:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    -- Input: a visit, a version, and a patch of known keys and types, at most 256 kB.
    IF p_visit_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 0
       OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb
       OR octet_length(p_patch::text) > 262144 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
        IF v_key NOT IN ('vitals', 'chief_complaints', 'clinical_notes', 'specialty_data', 'investigations_advised', 'advice',
                         'specialty', 'provenance', 'follow_up', 'conflict_overwrite') THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
    IF (p_patch ? 'vitals' AND jsonb_typeof(p_patch -> 'vitals') NOT IN ('object', 'null'))
       OR (p_patch ? 'chief_complaints' AND jsonb_typeof(p_patch -> 'chief_complaints') <> 'array')
       OR (p_patch ? 'clinical_notes' AND jsonb_typeof(p_patch -> 'clinical_notes') NOT IN ('string', 'null'))
       OR (p_patch ? 'specialty_data' AND jsonb_typeof(p_patch -> 'specialty_data') NOT IN ('object', 'null'))
       OR (p_patch ? 'investigations_advised' AND jsonb_typeof(p_patch -> 'investigations_advised') <> 'array')
       OR (p_patch ? 'advice' AND jsonb_typeof(p_patch -> 'advice') <> 'array')
       OR (p_patch ? 'specialty' AND (jsonb_typeof(p_patch -> 'specialty') <> 'string'
                                      OR (p_patch ->> 'specialty') NOT IN ('general_physician', 'dental', 'pediatrics')))
       OR (p_patch ? 'provenance' AND jsonb_typeof(p_patch -> 'provenance') NOT IN ('object', 'null'))
       OR (p_patch ? 'follow_up' AND jsonb_typeof(p_patch -> 'follow_up') NOT IN ('object', 'null'))
       OR (p_patch ? 'conflict_overwrite' AND jsonb_typeof(p_patch -> 'conflict_overwrite') <> 'boolean') THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- The text-list columns hold strings only (at most 200 entries, 500 characters each).
    FOREACH v_key IN ARRAY ARRAY['investigations_advised', 'advice'] LOOP
        IF p_patch ? v_key THEN
            IF jsonb_array_length(p_patch -> v_key) > 200
               OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_patch -> v_key) a(el)
                           WHERE jsonb_typeof(a.el) <> 'string' OR char_length(a.el #>> '{}') > 500) THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END IF;
    END LOOP;
    IF p_patch ? 'chief_complaints' THEN
        IF jsonb_array_length(p_patch -> 'chief_complaints') > 100
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_patch -> 'chief_complaints') a(el) WHERE jsonb_typeof(a.el) <> 'object') THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END IF;
    -- Vitals: known keys only; the measurements are numbers or null (the ranges are the service's zod schema).
    IF p_patch ? 'vitals' AND jsonb_typeof(p_patch -> 'vitals') = 'object' THEN
        FOR v_key, v_el IN SELECT e.key, e.value FROM jsonb_each(p_patch -> 'vitals') e LOOP
            IF v_key = ANY (v_mkeys) OR v_key = 'sugar' THEN
                IF jsonb_typeof(v_el) NOT IN ('number', 'null') THEN
                    RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
                END IF;
            ELSIF v_key IN ('sugar_type', 'recorded_at', 'recorded_by') THEN
                IF jsonb_typeof(v_el) NOT IN ('string', 'null') OR char_length(v_el #>> '{}') > 64 THEN
                    RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
                END IF;
            ELSE
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
    END IF;
    -- Provenance: exactly the two AI keys the draft may carry (08-06a S-3).
    IF p_patch ? 'provenance' AND jsonb_typeof(p_patch -> 'provenance') = 'object' THEN
        v_prov := p_patch -> 'provenance';
        FOR v_key, v_el IN SELECT e.key, e.value FROM jsonb_each(v_prov) e LOOP
            IF v_key = 'ai_assisted' THEN
                IF jsonb_typeof(v_el) <> 'boolean' THEN
                    RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
                END IF;
            ELSIF v_key = 'ai_sections_used' THEN
                IF jsonb_typeof(v_el) <> 'array' OR jsonb_array_length(v_el) > 20
                   OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_el) a(x)
                               WHERE jsonb_typeof(a.x) <> 'string' OR char_length(a.x #>> '{}') > 40) THEN
                    RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
                END IF;
            ELSE
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
    END IF;
    -- Follow-up: a calendar date, a note of at most 500 characters, the UI's interval word is accepted and not stored.
    IF p_patch ? 'follow_up' AND jsonb_typeof(p_patch -> 'follow_up') = 'object' THEN
        v_fu := p_patch -> 'follow_up';
        FOR v_key IN SELECT jsonb_object_keys(v_fu) LOOP
            IF v_key NOT IN ('follow_up_date', 'notes', 'interval') THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
        IF jsonb_typeof(v_fu -> 'follow_up_date') IS DISTINCT FROM 'string'
           OR (v_fu ->> 'follow_up_date') !~ '^\d{4}-\d{2}-\d{2}$'
           OR (v_fu ? 'notes' AND (jsonb_typeof(v_fu -> 'notes') NOT IN ('string', 'null') OR char_length(v_fu ->> 'notes') > 500))
           OR (v_fu ? 'interval' AND jsonb_typeof(v_fu -> 'interval') NOT IN ('string', 'null')) THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        BEGIN
            v_fu_date := (v_fu ->> 'follow_up_date')::date;
        EXCEPTION WHEN data_exception THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END;
        IF to_char(v_fu_date, 'YYYY-MM-DD') <> (v_fu ->> 'follow_up_date') THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 3. Claim; a replay returns the first result and writes nothing.
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.save_consultation_draft',
                                      private.command_request_hash(jsonb_build_object(
                                          'visit', p_visit_id, 'expected_version', p_expected_version, 'patch', p_patch)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the visit, then its notes row (a sign-off, an amendment and another draft save on this visit run one after the other).
    SELECT v.status, v.signed_at, v.patient_id, v.specialty, v.metadata INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    SELECT n.draft_version, n.vitals INTO v_notes
      FROM public.clinical_notes n
     WHERE n.tenant_id = p_tenant_id AND n.visit_id = p_visit_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- A sealed visit (signed and not reopened) or an unsigned completed or cancelled one takes no draft (recordState, V2-09a R-2, R-11).
    IF v_visit.status IN ('completed', 'cancelled') OR (v_visit.signed_at IS NOT NULL AND v_visit.status <> 'in_consultation') THEN
        RAISE EXCEPTION 'DRAFT_LOCKED' USING ERRCODE = 'P0001';
    END IF;
    -- Optimistic concurrency: the draft was read at expected_version; anything else is another writer's change.
    IF v_notes.draft_version <> p_expected_version THEN
        RAISE EXCEPTION 'DRAFT_CONFLICT' USING ERRCODE = 'P0001';
    END IF;

    -- 5. Writes: only the keys present.
    v_overwrite := coalesce((p_patch ->> 'conflict_overwrite')::boolean, false);
    FOREACH v_key IN ARRAY ARRAY['vitals', 'chief_complaints', 'clinical_notes', 'specialty_data', 'investigations_advised', 'advice',
                                 'specialty', 'provenance', 'follow_up'] LOOP
        IF p_patch ? v_key THEN
            v_fields := v_fields || v_key;
        END IF;
    END LOOP;
    IF cardinality(v_fields) = 0 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- Vitals: the recorder is never caller-chosen (V2-01 F6, SEC-02). The same measurements as stored keep the stored recorder (a doctor
    -- saving a draft does not re-attribute a nurse's reading); changed measurements record the actor.
    v_vitals := v_notes.vitals;
    IF p_patch ? 'vitals' THEN
        v_in := CASE WHEN jsonb_typeof(p_patch -> 'vitals') = 'object' THEN (p_patch -> 'vitals') - 'recorded_by' ELSE '{}'::jsonb END;
        v_has_measure := EXISTS (SELECT 1 FROM unnest(v_mkeys) k WHERE jsonb_typeof(v_in -> k) = 'number');
        IF v_has_measure THEN
            v_same := NOT EXISTS (SELECT 1 FROM unnest(v_mkeys) k
                                   WHERE coalesce(v_in -> k, 'null'::jsonb) IS DISTINCT FROM coalesce(v_notes.vitals -> k, 'null'::jsonb));
            IF v_same AND jsonb_typeof(v_notes.vitals -> 'recorded_by') = 'string' THEN
                v_in := v_in || jsonb_build_object('recorded_by', v_notes.vitals -> 'recorded_by');
            ELSE
                v_in := v_in || jsonb_build_object('recorded_by', v_uid::text);
            END IF;
        END IF;
        v_vitals := v_in;
    END IF;

    UPDATE public.clinical_notes n
       SET vitals = v_vitals,
           chief_complaints = CASE WHEN p_patch ? 'chief_complaints' THEN p_patch -> 'chief_complaints' ELSE n.chief_complaints END,
           clinical_notes = CASE WHEN p_patch ? 'clinical_notes' THEN p_patch ->> 'clinical_notes' ELSE n.clinical_notes END,
           specialty_data = CASE WHEN p_patch ? 'specialty_data'
                                 THEN CASE WHEN jsonb_typeof(p_patch -> 'specialty_data') = 'object' THEN p_patch -> 'specialty_data' ELSE '{}'::jsonb END
                                 ELSE n.specialty_data END,
           investigations_advised = CASE WHEN p_patch ? 'investigations_advised'
                                         THEN ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'investigations_advised'))
                                         ELSE n.investigations_advised END,
           advice = CASE WHEN p_patch ? 'advice' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'advice')) ELSE n.advice END
     WHERE n.tenant_id = p_tenant_id AND n.visit_id = p_visit_id
    RETURNING n.draft_version INTO v_new_version;

    v_specialty := CASE WHEN p_patch ? 'specialty' THEN p_patch ->> 'specialty' ELSE v_visit.specialty END;
    v_metadata := coalesce(v_visit.metadata, '{}'::jsonb);
    IF p_patch ? 'provenance' AND jsonb_typeof(p_patch -> 'provenance') = 'object' THEN
        v_metadata := v_metadata || (p_patch -> 'provenance');
    END IF;
    IF v_specialty IS DISTINCT FROM v_visit.specialty OR v_metadata IS DISTINCT FROM coalesce(v_visit.metadata, '{}'::jsonb) THEN
        UPDATE public.visits v
           SET specialty = v_specialty, metadata = v_metadata, updated_at = now()
         WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id;
    END IF;

    IF p_patch ? 'follow_up' THEN
        IF jsonb_typeof(p_patch -> 'follow_up') = 'null' THEN
            DELETE FROM public.follow_ups f WHERE f.tenant_id = p_tenant_id AND f.visit_id = p_visit_id;
        ELSE
            INSERT INTO public.follow_ups (tenant_id, patient_id, visit_id, doctor_id, follow_up_date, notes, status)
            VALUES (p_tenant_id, v_visit.patient_id, p_visit_id, v_uid, v_fu_date, p_patch -> 'follow_up' ->> 'notes', 'scheduled')
            ON CONFLICT (tenant_id, visit_id) WHERE visit_id IS NOT NULL
            DO UPDATE SET follow_up_date = EXCLUDED.follow_up_date, notes = EXCLUDED.notes;
        END IF;
    END IF;

    -- A waiting visit moves to in_consultation as start_consultation does, when the caller may also move visits. A business refusal of
    -- the step (another day, not checkable: P0001) leaves the status as it was and never fails the save; its writes roll back with it.
    IF v_visit.status = 'waiting' AND public.has_permission(p_tenant_id, 'appointments:edit') THEN
        BEGIN
            PERFORM private.step_start_consultation(p_tenant_id, p_visit_id);
            v_started := true;
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
            v_started := false;
        END;
    END IF;

    PERFORM private.log_command_audit(p_tenant_id, 'consultation.draft_save', 'visit', p_visit_id,
                             jsonb_build_object('fields_changed', to_jsonb(v_fields), 'draft_version', v_new_version,
                                                'conflict_overwrite', v_overwrite));

    v_result := jsonb_build_object('visit_id', p_visit_id, 'draft_version', v_new_version, 'started', v_started, 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.save_consultation_draft(uuid, uuid, integer, jsonb, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_consultation_draft(uuid, uuid, integer, jsonb, uuid) TO authenticated;
COMMENT ON FUNCTION public.save_consultation_draft(uuid, uuid, integer, jsonb, uuid) IS
    'V2-09b 09B-01 (R-3): saves the consult draft in one transaction: the keys present in p_patch (vitals, chief_complaints, clinical_notes, specialty_data, investigations_advised, advice, specialty, provenance, follow_up) are written to clinical_notes, visits and follow_ups, a waiting visit is started (when the caller holds appointments:edit), and the consultation.draft_save audit row is written (fields_changed, draft_version, conflict_overwrite). consultations:edit. p_expected_version must equal clinical_notes.draft_version (DRAFT_CONFLICT, P0001); a sealed, completed or cancelled visit is DRAFT_LOCKED (P0001). The optional patch key conflict_overwrite (boolean) is audited, not stored. Idempotent by p_client_request_id. Result: visit_id, draft_version, started, replayed.';

-- 6. Contract: the writers are inventoried (09B-NOTES.md, 09B-01) -------------------------------------------------------------------------
REVOKE UPDATE ON public.clinical_notes FROM authenticated;
GRANT UPDATE (vitals) ON public.clinical_notes TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.follow_ups FROM authenticated;
