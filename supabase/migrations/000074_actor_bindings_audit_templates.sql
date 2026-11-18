-- Migration: 000074_actor_bindings_audit_templates.sql
-- V2-05 fix plan 05-11b: M-ACTOR for consents and referrals (05a review RLS M-3, IND L2), and the Lows
-- RLS L-3 (referral target doctor), IND L6 (referral consent coverage), INT L-5 (log_audit) and IND L4 (template
-- request_roles). Visits, prescriptions and amendments are 05-11a's (000068-000070).
--
-- 1. consent_records (M-ACTOR): `private.consent_records_actor_guard` (BEFORE INSERT; SECURITY INVOKER): with a
--    session, `recorded_by` must be the caller, else 42501 ACTOR_INVALID. Before, a receptionist could record a
--    patient's DPDP consent as given by the owner. System writers (no session) are not limited. No UPDATE/DELETE
--    privilege exists on the table (unchanged).
-- 2. referrals: `private.referrals_directory_consent_guard` (000062, SECURITY DEFINER, every writer) is replaced and
--    now fires on every INSERT and UPDATE:
--    a. M-ACTOR (user path, `auth.uid()` set): on INSERT `referring_doctor_id` is the caller; on UPDATE it never
--       changes; a `closed_by` that is set or changed names the caller. 42501 ACTOR_INVALID. Before, a doctor could
--       send a referral as another doctor. The v1 API (service role, doctor validated by `validateDoctorAssignment`)
--       is not limited.
--    b. RLS L-3: a non-null `target_doctor_id` needs a target clinic and must be a member of THAT clinic whose role
--       holds consultations:edit there (owner or doctor), else P0001 REFERRAL_TARGET_DOCTOR_INVALID. Checked when the
--       row is inserted or the target changes.
--    c. IND L6: consent covers every clinical field the target clinic can read (`referrals_target_select`): an
--       in-network referral (target clinic set) carrying a clinical summary, a provisional diagnosis, a medications
--       snapshot, advised investigations or a history snapshot needs `patient_consents_history_sharing`, else P0001
--       REFERRAL_CONSENT_REQUIRED (the existing reason). A history snapshot needs consent on any referral (000062).
--       `reason_for_referral` (NOT NULL, the purpose of the referral) is not gated. Checked on INSERT and when one of
--       those columns, the target or the consent flag changes, so acknowledging or closing an older row is not refused.
--    d. 000062's rule is kept: a non-null target must be a listed clinic other than the referral's own.
-- 3. log_audit (INT L-5): the user path accepts only the app's client actions (`private.audit_client_actions()`,
--    mirrors lib/audit/audit.ts AUDIT_ACTIONS without the reserved prefixes; parity spec), else P0001 INPUT_INVALID;
--    refuses the reserved prefixes `dpdp.`, `auth.`, `billing.`, `ops.` (42501 AUDIT_ACTION_FORBIDDEN) except the two
--    DPDP events the app writes on a session, each bound to the operation it records: `dpdp.data_export` needs
--    exports:create in the clinic (the in-app export, owner only); `dpdp.patient_erasure` needs patients:edit and a
--    patient of the clinic that IS erased (erasePatientRecord audits after the soft delete), so neither can be planted;
--    `invoice.payment_recorded` is written only inside record_payment (its transaction-local payment marker), else
--    42501 AUDIT_ACTION_FORBIDDEN. Metadata: an object (`system_actor` is still dropped) whose keys are the app's
--    allow-list (`private.audit_metadata_keys()`, = lib/audit/audit.ts AUDIT_METADATA_KEYS without `actor_type` and
--    `api_key_id`, which only the API-key path writes), at most 20 keys, each value a string of at most 500
--    characters, a number, a boolean, null, or an array of at most 50 such scalars; at most 4 KiB in all. Before, any
--    member could plant any action (a "completed" DPDP export) and up to 4 KiB of free text.
-- 4. ops.message_templates.request_roles (IND L4): each request-callable template admits exactly the roles holding
--    the permission its call site asserts (prescription_ready / consultation_documents: prescriptions:view;
--    lab_report_uploaded: labs:view; referral_letter_issued: consultations:view; receipt_issued: billing:view;
--    appointment_booked: appointments:edit). Nurses no longer request Rx/consultation messages, admins and
--    receptionists no longer request lab-report or referral-letter messages through enqueue_message.
-- Per-migration checklist: three new private functions (no EXECUTE for API roles; the two list functions are invoker,
-- called by the definer log_audit), one replaced definer trigger function (same name and grants), no table; data:
-- four template rows. Expand-safe: the app already writes recorded_by / referring_doctor_id / closed_by from the
-- session and only allow-listed actions and metadata keys.

-- 1. consent_records actor ---------------------------------------------------------------------------------------------
CREATE FUNCTION private.consent_records_actor_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NOT NULL AND NEW.recorded_by IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.consent_records_actor_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER consent_records_actor_guard
BEFORE INSERT ON public.consent_records
FOR EACH ROW
EXECUTE FUNCTION private.consent_records_actor_guard();

-- 2. referrals guard ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.referrals_directory_consent_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_target_changed BOOLEAN;
    v_clinical BOOLEAN;
BEGIN
    -- a. Actor columns (user path).
    IF v_uid IS NOT NULL THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.referring_doctor_id IS DISTINCT FROM v_uid
               OR (NEW.closed_by IS NOT NULL AND NEW.closed_by <> v_uid) THEN
                RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
            END IF;
        ELSIF NEW.referring_doctor_id IS DISTINCT FROM OLD.referring_doctor_id
              OR (NEW.closed_by IS DISTINCT FROM OLD.closed_by AND NEW.closed_by IS NOT NULL AND NEW.closed_by <> v_uid) THEN
            RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_target_changed := TG_OP = 'INSERT'
        OR NEW.target_tenant_id IS DISTINCT FROM OLD.target_tenant_id
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id;

    -- d. A listed target clinic other than the referral's own (000062).
    IF NEW.target_tenant_id IS NOT NULL AND v_target_changed THEN
        IF NEW.target_tenant_id = NEW.tenant_id
           OR NOT EXISTS (
               SELECT 1
               FROM public.tenants t
               WHERE t.id = NEW.target_tenant_id
                 AND t.referral_directory_listed
           ) THEN
            RAISE EXCEPTION 'REFERRAL_TARGET_NOT_LISTED' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- b. The target doctor practises in the target clinic.
    IF NEW.target_doctor_id IS NOT NULL
       AND (v_target_changed OR NEW.target_doctor_id IS DISTINCT FROM OLD.target_doctor_id) THEN
        IF NEW.target_tenant_id IS NULL
           OR NOT EXISTS (
               SELECT 1
               FROM public.memberships m
               WHERE m.tenant_id = NEW.target_tenant_id
                 AND m.user_id = NEW.target_doctor_id
                 AND authz.role_has_permission(m.role, 'consultations:edit')
           ) THEN
            RAISE EXCEPTION 'REFERRAL_TARGET_DOCTOR_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- c. Consent covers every clinical field the target clinic reads.
    IF TG_OP = 'INSERT'
       OR v_target_changed
       OR NEW.patient_consents_history_sharing IS DISTINCT FROM OLD.patient_consents_history_sharing
       OR NEW.consented_history_snapshot IS DISTINCT FROM OLD.consented_history_snapshot
       OR NEW.clinical_summary IS DISTINCT FROM OLD.clinical_summary
       OR NEW.provisional_diagnosis IS DISTINCT FROM OLD.provisional_diagnosis
       OR NEW.active_medications_snapshot IS DISTINCT FROM OLD.active_medications_snapshot
       OR NEW.investigations_advised IS DISTINCT FROM OLD.investigations_advised THEN

        IF NEW.consented_history_snapshot IS NOT NULL
           AND jsonb_typeof(NEW.consented_history_snapshot) <> 'null'
           AND NEW.patient_consents_history_sharing IS NOT TRUE THEN
            RAISE EXCEPTION 'REFERRAL_CONSENT_REQUIRED' USING ERRCODE = 'P0001';
        END IF;

        v_clinical := NULLIF(btrim(NEW.clinical_summary), '') IS NOT NULL
            OR NULLIF(btrim(NEW.provisional_diagnosis), '') IS NOT NULL
            OR (NEW.active_medications_snapshot IS NOT NULL
                AND NEW.active_medications_snapshot NOT IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb))
            OR coalesce(cardinality(NEW.investigations_advised), 0) > 0;

        IF NEW.target_tenant_id IS NOT NULL AND v_clinical AND NEW.patient_consents_history_sharing IS NOT TRUE THEN
            RAISE EXCEPTION 'REFERRAL_CONSENT_REQUIRED' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.referrals_directory_consent_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER referrals_directory_consent_guard ON public.referrals;
CREATE TRIGGER referrals_directory_consent_guard
BEFORE INSERT OR UPDATE ON public.referrals
FOR EACH ROW
EXECUTE FUNCTION private.referrals_directory_consent_guard();

-- 3. log_audit allow-lists ---------------------------------------------------------------------------------------------
-- The app's client actions (lib/audit/audit.ts AUDIT_ACTIONS) without the reserved prefixes, plus the two DPDP events
-- log_audit accepts under their own conditions (below). Keep in step with tests/audit/log-audit-allowlist.spec.ts.
CREATE FUNCTION private.audit_client_actions()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'api_key.create', 'api_key.revoke', 'appointment.cancel', 'appointment.create', 'appointment.reschedule',
        'clinic.profile.update', 'clinic.settings.update', 'consultation.amend', 'consultation.complete_sign',
        'consultation.draft_save', 'consultation.share_consolidated_whatsapp', 'diagnosis.add', 'diagnosis.remove',
        'diagnosis.update_note', 'follow_up.record', 'invoice.create', 'invoice.generate_receipt_pdf',
        'invoice.item_add', 'invoice.item_remove', 'invoice.payment_recorded', 'invoice.share_whatsapp',
        'lab_order.create', 'patient.consent.granted', 'patient.consent.withdrawn', 'patient.create',
        'patient.update', 'patient.view', 'patient_document.delete', 'patient_document.generate_share_token',
        'patient_document.share_whatsapp', 'patient_document.upload', 'prescription.create',
        'prescription.generate_pdf', 'prescription.item_add', 'prescription.item_remove',
        'prescription.share_whatsapp', 'prescription.template_save', 'queue.check_in', 'queue.transition',
        'referral.acknowledge', 'referral.close_loop', 'referral.create', 'referral.share_whatsapp',
        'schedule_block.create', 'schedule_block.delete', 'staff.member.update', 'user.profile.update',
        'visit.amend_finalized', 'visit.auto_promoted_from_waitlist', 'visit.cancel', 'visit.complete_and_sign',
        'visit.confirm', 'visit.create', 'visit.reopen_for_amendment', 'visit.status_update', 'vitals.record',
        'waitlist.add', 'waitlist.promote', 'webhook.create', 'webhook.delete',
        'dpdp.data_export', 'dpdp.patient_erasure'
    ]::TEXT[];
$$;

-- lib/audit/audit.ts AUDIT_METADATA_KEYS without actor_type and api_key_id (written only by the API-key path).
CREATE FUNCTION private.audit_metadata_keys()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'amendment_reason', 'consent_type', 'correlation_id', 'dose_form', 'erased_at', 'fields_changed',
        'follow_up_date', 'format', 'invoice_id', 'invoice_number', 'is_chronic', 'is_custom', 'is_initial_grant',
        'is_overbooked', 'items_count', 'letterhead_mode', 'new_status', 'old_status', 'origin_type',
        'patient_consents_history_sharing', 'payment_method', 'priority', 'promoted_from_waitlist_id',
        'promoted_visit_id', 'reason', 'referral_type', 'retention_policy', 'revision_number', 'specialty', 'status',
        'storage_path', 'target_date', 'target_tenant_id', 'template_name', 'token_number', 'total_amount', 'urgency',
        'version', 'view_context'
    ]::TEXT[];
$$;

REVOKE ALL ON FUNCTION private.audit_client_actions() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.audit_metadata_keys() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.log_audit(p_tenant UUID, p_action TEXT, p_entity_type TEXT, p_entity_id UUID, p_metadata JSONB)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_role TEXT;
    v_id BIGINT;
    v_metadata JSONB;
    v_key TEXT;
    v_value JSONB;
BEGIN
    IF v_uid IS NULL OR p_tenant IS NULL OR p_tenant IS DISTINCT FROM authz.active_tenant_id() THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;

    SELECT m.role INTO v_role
      FROM public.memberships m
     WHERE m.tenant_id = p_tenant
       AND m.user_id = v_uid;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;

    IF p_action IS NULL OR p_action !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$' OR char_length(p_action) > 100
       OR p_entity_type IS NULL OR p_entity_type !~ '^[a-z][a-z0-9_]{0,49}$'
       OR (p_metadata IS NOT NULL AND (jsonb_typeof(p_metadata) <> 'object' OR octet_length(p_metadata::text) > 4096)) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- Actions (INT L-5). Reserved prefixes first, so a planted dpdp./auth./billing./ops. event is a refusal, not a typo.
    IF p_action ~ '^(dpdp|auth|billing|ops)\.' THEN
        IF p_action = 'dpdp.data_export' AND authz.role_has_permission(v_role, 'exports:create') THEN
            NULL;
        ELSIF p_action = 'dpdp.patient_erasure'
              AND authz.role_has_permission(v_role, 'patients:edit')
              AND p_entity_type = 'patient'
              AND EXISTS (
                  SELECT 1
                    FROM public.patients pt
                   WHERE pt.tenant_id = p_tenant
                     AND pt.id = p_entity_id
                     AND pt.is_deleted
              ) THEN
            NULL;
        ELSE
            RAISE EXCEPTION 'AUDIT_ACTION_FORBIDDEN' USING ERRCODE = '42501';
        END IF;
    ELSIF NOT (p_action = ANY (private.audit_client_actions())) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_action = 'invoice.payment_recorded'
       AND coalesce(current_setting('clinicos.record_payment_id', true), '') = '' THEN
        RAISE EXCEPTION 'AUDIT_ACTION_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- Metadata: allow-listed keys, bounded scalar values.
    v_metadata := CASE WHEN p_metadata IS NULL THEN NULL ELSE p_metadata - 'system_actor' END;
    IF v_metadata IS NOT NULL THEN
        IF (SELECT count(*) FROM jsonb_object_keys(v_metadata)) > 20 THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        FOR v_key, v_value IN SELECT e.key, e.value FROM jsonb_each(v_metadata) e LOOP
            IF NOT (v_key = ANY (private.audit_metadata_keys())) THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
            IF jsonb_typeof(v_value) = 'array' THEN
                IF jsonb_array_length(v_value) > 50
                   OR EXISTS (
                       SELECT 1
                         FROM jsonb_array_elements(v_value) a(el)
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
    VALUES (p_tenant, v_uid, v_role, 'user', NULL, p_action, p_entity_type, p_entity_id, v_metadata)
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit(UUID, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.log_audit(UUID, TEXT, TEXT, UUID, JSONB) TO authenticated;

-- 4. Template request roles ---------------------------------------------------------------------------------------------
UPDATE ops.message_templates SET request_roles = ARRAY['owner', 'doctor']::TEXT[]
 WHERE template_id IN ('prescription_ready', 'consultation_documents');
UPDATE ops.message_templates SET request_roles = ARRAY['owner', 'doctor', 'nurse']::TEXT[]
 WHERE template_id IN ('lab_report_uploaded', 'referral_letter_issued');
