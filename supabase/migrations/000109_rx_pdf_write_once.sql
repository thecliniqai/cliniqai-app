-- 000109_rx_pdf_write_once.sql — V2-09a 09A-03 (R-12, R-13 Rx part; P1-03 write-once PDFs, SHA-256; SEC-18; SVP 6.1 "storage prescriptions object
-- UPDATE/DELETE: no for every role"; INT L-7).
--
-- A finalised prescription PDF cannot be overwritten or deleted, its SHA-256 is stored, and a draft never claims the final key. No data change:
-- the new column is NULL for every existing row (legacy rows with a path and no hash stay valid, R-19; the app records the hash on the first read).
--
-- 1. public.prescriptions.pdf_sha256 (hex SHA-256 of the exact bytes uploaded) with two CHECKs, both valid for every existing row:
--    prescriptions_pdf_sha256_shape (64 lower-case hex characters) and prescriptions_pdf_hash_needs_path (a hash only with a path).
-- 2. private.prescriptions_seal_guard (000108) replaced. The seal rule is unchanged (a sealed header changes only in updated_at and the PDF pair;
--    letterhead_mode is frozen now), and the PDF pair gets its own rules on EVERY path and in EVERY state (the 000108 guard returned early for a
--    draft or amending visit):
--      - NULL to a value once: only while the visit is sealed and the header is signed (RX_PDF_NOT_SEALED otherwise: an archive of a draft or of
--        an open amendment is refused) and only with the path of this header's own tenant, visit and version (RX_PDF_PATH_INVALID);
--      - a value that exists is never changed (RX_PDF_WRITE_ONCE), and cleared only by a statement that raises `version` and clears both columns
--        (finalize_visit_amendment: the signed version's pair survives in visit_revisions.snapshot, which stores the whole header row);
--      - a statement that changes `version` carries no pair (RX_PDF_PATH_INVALID), so the pair is always the canonical key of the row's own version.
--    A hash without a path is the CHECK's.
-- 3. private.prescriptions_actor_guard (000108) replaced: INSERT carries no PDF pair (RX_PDF_NOT_SEALED, every writer). Everything else is the 000108 text.
-- 4. Privilege: REVOKE UPDATE ... FROM authenticated; GRANT UPDATE (pdf_storage_path, pdf_sha256, updated_at). letterhead_mode is set at INSERT only.
-- 5. public.finalize_visit_amendment (000108) replaced: the header UPDATE also sets pdf_storage_path = NULL and pdf_sha256 = NULL in the same statement
--    that raises version. Nothing else changes.
-- 6. Storage policies (000058 is the latest text): `prescriptions_rx_update` dropped (no UPDATE: an upsert of an existing object fails); `prescriptions_rx_insert`
--    replaced: prescriptions:edit AND a header named by the key's (tenant, visit, version) that is signed and has no hash, on a sealed visit, so no PDF
--    can be planted ahead of the seal or at a wrong version. The header and visit subqueries run under the caller's RLS. No DELETE policy exists. The
--    receipt, lab and referral_letter classes are untouched here.
-- 7. private.audit_client_actions (000106) gains prescription.pdf_integrity_failed; private.audit_metadata_keys (000103) gains sha256
--    (lib/audit/audit.ts and tests/audit/log-audit-allowlist.spec.ts follow).
--
-- Refusals are SQLSTATE 42501 with fixed names and no row data: RX_PDF_NOT_SEALED, RX_PDF_WRITE_ONCE, RX_PDF_PATH_INVALID (new), RX_SEALED.
-- Per-migration checklist: the two trigger functions are INVOKER with search_path '' and qualified names, EXECUTE revoked from PUBLIC, anon,
-- authenticated, service_role; the replaced command keeps the V2-07 pattern, its signature and its grants.

-- 1. column and checks -------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.prescriptions ADD COLUMN pdf_sha256 text;
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_pdf_sha256_shape
    CHECK (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE public.prescriptions ADD CONSTRAINT prescriptions_pdf_hash_needs_path
    CHECK (pdf_sha256 IS NULL OR pdf_storage_path IS NOT NULL);
COMMENT ON COLUMN public.prescriptions.pdf_sha256 IS
    'V2-09a 000109 (R-12): hex SHA-256 of the exact bytes of the archived PDF at pdf_storage_path. Written once with the path (or, for a legacy row, once on its own), '
    'cleared only by finalize_visit_amendment when it raises version. Integrity after archive, not authenticity of origin (no digital signature).';

-- 2. the seal guard: the PDF pair is write-once on every path ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.prescriptions_seal_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_sealed boolean;
BEGIN
    IF v_uid IS NOT NULL THEN
        -- A visit the caller cannot see counts as sealed (fail closed).
        v_sealed := NOT EXISTS (SELECT 1 FROM public.visits v
                                 WHERE v.tenant_id = OLD.tenant_id AND v.id = OLD.visit_id
                                   AND (v.signed_at IS NULL OR v.status = 'in_consultation'));
    ELSE
        v_sealed := EXISTS (SELECT 1 FROM public.visits v
                             WHERE v.tenant_id = OLD.tenant_id AND v.id = OLD.visit_id
                               AND v.signed_at IS NOT NULL AND v.status <> 'in_consultation');
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF NOT v_sealed THEN
            RETURN OLD;
        END IF;
        -- R-4a: the cascade of a tenant purge.
        IF v_uid IS NULL AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'RX_SEALED' USING ERRCODE = '42501';
    END IF;

    -- UPDATE. R-8, narrowed by R-12: while the visit is sealed only updated_at and the PDF pair may change; letterhead_mode is frozen.
    IF v_sealed
       AND (to_jsonb(NEW) - 'updated_at' - 'pdf_storage_path' - 'pdf_sha256')
           IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'pdf_storage_path' - 'pdf_sha256') THEN
        RAISE EXCEPTION 'RX_SEALED' USING ERRCODE = '42501';
    END IF;

    -- R-12: the PDF pair, in every state. A version change never carries a pair (finalize clears it): the pair is always the canonical key of the row's own version.
    IF NEW.version IS DISTINCT FROM OLD.version AND (NEW.pdf_storage_path IS NOT NULL OR NEW.pdf_sha256 IS NOT NULL) THEN
        RAISE EXCEPTION 'RX_PDF_PATH_INVALID' USING ERRCODE = '42501';
    END IF;
    IF NEW.pdf_storage_path IS DISTINCT FROM OLD.pdf_storage_path OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256 THEN
        IF (OLD.pdf_storage_path IS NOT NULL AND NEW.pdf_storage_path IS DISTINCT FROM OLD.pdf_storage_path)
           OR (OLD.pdf_sha256 IS NOT NULL AND NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256) THEN
            -- A value that exists never changes; the pair is cleared only by the statement that raises the version (the amendment's finalize).
            IF NEW.version > OLD.version AND NEW.pdf_storage_path IS NULL AND NEW.pdf_sha256 IS NULL THEN
                RETURN NEW;
            END IF;
            RAISE EXCEPTION 'RX_PDF_WRITE_ONCE' USING ERRCODE = '42501';
        END IF;
        -- NULL to a value: once, for a signed header of a sealed visit, at its own canonical key.
        IF NOT v_sealed OR NEW.signed_at IS NULL THEN
            RAISE EXCEPTION 'RX_PDF_NOT_SEALED' USING ERRCODE = '42501';
        END IF;
        IF NEW.pdf_storage_path IS DISTINCT FROM (NEW.tenant_id::text || '/' || NEW.visit_id::text || '/rx_v' || NEW.version::text || '.pdf') THEN
            RAISE EXCEPTION 'RX_PDF_PATH_INVALID' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.prescriptions_seal_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.prescriptions_seal_guard() IS
    'V2-09a 09A-02 (R-8), 09A-03 000109 (R-12): BEFORE UPDATE OR DELETE on prescriptions, every writer. While the visit is sealed (signed, not reopened) a header '
    'changes only in updated_at and the PDF pair (letterhead_mode is frozen), and is deleted by nobody except the cascade of a tenant purge (RX_SEALED). The PDF '
    'pair (pdf_storage_path, pdf_sha256) in every state: set once from NULL, only for a signed header of a sealed visit and only at <tenant>/<visit>/rx_v<version>.pdf '
    '(RX_PDF_NOT_SEALED, RX_PDF_PATH_INVALID); an existing value never changes (RX_PDF_WRITE_ONCE) and is cleared only by a statement that raises version and clears both; a version change never carries a pair (RX_PDF_PATH_INVALID). 42501.';

-- 3. INSERT carries no PDF pair ----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.prescriptions_actor_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- 000109 (R-12): a new header has not been signed, so it has nothing archived.
        IF NEW.pdf_storage_path IS NOT NULL OR NEW.pdf_sha256 IS NOT NULL THEN
            RAISE EXCEPTION 'RX_PDF_NOT_SEALED' USING ERRCODE = '42501';
        END IF;
        IF v_uid IS NULL THEN
            -- 000108 (R-8, R-3): the system path meets the same seal; a visit that does not exist is not sealed (the FK refuses it).
            IF EXISTS (SELECT 1 FROM public.visits v
                        WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id
                          AND v.signed_at IS NOT NULL AND v.status <> 'in_consultation') THEN
                RAISE EXCEPTION 'PRESCRIPTION_VISIT_SIGNED' USING ERRCODE = '42501';
            END IF;
            RETURN NEW;
        END IF;
        IF NEW.doctor_id IS DISTINCT FROM v_uid THEN
            RAISE EXCEPTION 'PRESCRIPTION_DOCTOR_NOT_CALLER' USING ERRCODE = '42501';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.visits v
                        WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id AND v.patient_id = NEW.patient_id) THEN
            RAISE EXCEPTION 'PRESCRIPTION_PATIENT_MISMATCH' USING ERRCODE = '42501';
        END IF;
        -- 05-11e (NF-2): a header is added only while the visit is unsigned or reopened for amendment.
        IF NOT EXISTS (SELECT 1 FROM public.visits v
                        WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id
                          AND (v.signed_at IS NULL OR v.status = 'in_consultation')) THEN
            RAISE EXCEPTION 'PRESCRIPTION_VISIT_SIGNED' USING ERRCODE = '42501';
        END IF;
        -- 000108 (I-1, R-8): a request path writes the first version only; later versions come from the amendment command.
        IF NEW.version IS DISTINCT FROM 1 THEN
            RAISE EXCEPTION 'PRESCRIPTION_VERSION_FORBIDDEN' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;
    IF v_uid IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.visit_id IS DISTINCT FROM OLD.visit_id
       OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
        RAISE EXCEPTION 'PRESCRIPTION_KEY_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.prescriptions_actor_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.prescriptions_actor_guard() IS
    'V2-05 05-11a/05-11e, V2-09a 000108/000109 (M-ACTOR, NF-2, I-1, R-8, R-12): a header is never added to a sealed visit by any writer and is added with no PDF pair; a '
    'signed-in caller prescribes only as itself, for the visit''s own patient, only while the visit is unsigned or reopened, and only as version 1; '
    'doctor, visit and patient of a prescription never change (signed-in callers). 42501.';

-- 4. privilege ---------------------------------------------------------------------------------------------------------------------------
REVOKE UPDATE ON public.prescriptions FROM authenticated;
GRANT UPDATE (pdf_storage_path, pdf_sha256, updated_at) ON public.prescriptions TO authenticated;

-- 5. finalize clears the pair in the statement that raises the version -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_visit_amendment(p_tenant_id uuid, p_visit_id uuid, p_client_request_id uuid)
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
    v_reason text;
    v_rx record;
    v_version integer;
    v_result jsonb;
    v_subject record;
BEGIN
    -- 1. Actor.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then consultations:edit there.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- 000099 (F-2): the finalize writes the prescription (prescriptions) and the visit's status (appointments).
    IF NOT (public.has_permission(p_tenant_id, 'consultations:edit')
            AND public.has_permission(p_tenant_id, 'prescriptions:edit')
            AND public.has_permission(p_tenant_id, 'appointments:edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim.
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.finalize_visit_amendment',
                                      private.command_request_hash(jsonb_build_object('visit', p_visit_id)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the visit; it must be a signed visit that is currently reopened (in_consultation), with its revision.
    SELECT v.status, v.signed_at INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_visit.status IS DISTINCT FROM 'in_consultation' OR v_visit.signed_at IS NULL THEN
        RAISE EXCEPTION 'AMENDMENT_NOT_OPEN' USING ERRCODE = 'P0001';
    END IF;
    SELECT r.amendment_reason INTO v_reason
      FROM public.visit_revisions r
     WHERE r.tenant_id = p_tenant_id AND r.visit_id = p_visit_id
     ORDER BY r.revision_number DESC
     LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AMENDMENT_NOT_OPEN' USING ERRCODE = 'P0001';
    END IF;

    -- 5. Writes: the latest prescription gets the next version and the amendment reason and is re-signed; the visit is
    --    re-signed by the caller (visits_integrity_guard admits a new signature only on a reopened visit).
    SELECT p.id, p.version INTO v_rx
      FROM public.prescriptions p
     WHERE p.tenant_id = p_tenant_id AND p.visit_id = p_visit_id
     ORDER BY p.version DESC
     LIMIT 1
       FOR UPDATE;
    v_version := coalesce(v_rx.version, 1) + 1;
    IF v_rx.id IS NOT NULL THEN
        -- 000109 (R-12): the new version has no archived PDF yet; the signed version's path and hash survive in the snapshot taken at reopen.
        -- prescriptions_seal_guard admits clearing the pair only in the statement that raises version, as here.
        UPDATE public.prescriptions
           SET version = v_version, amendment_reason = v_reason, signed_at = now(), updated_at = now(),
               pdf_storage_path = NULL, pdf_sha256 = NULL
         WHERE id = v_rx.id AND tenant_id = p_tenant_id;
    END IF;

    UPDATE public.visits
       SET status = 'completed', signed_at = now(), signed_by = v_uid, updated_at = now()
     WHERE id = p_visit_id AND tenant_id = p_tenant_id;

    PERFORM private.log_command_audit(p_tenant_id, 'visit.amend_finalized', 'visit', p_visit_id,
                             jsonb_build_object('version', v_version, 'amendment_reason', left(v_reason, 500)));

    -- 000108 (R-10): the amended prescription is issued again, in this transaction: one prescription.issued per version (the event key
    -- carries :v<n> from version 2, private.webhook_event_subject), only for clinics with a matching subscription. No header, no event.
    -- visit.completed is not re-emitted (its key is per visit).
    IF v_rx.id IS NOT NULL THEN
        SELECT * INTO v_subject FROM private.webhook_event_subject('prescription.issued', v_rx.id);
        IF v_subject.o_tenant IS DISTINCT FROM p_tenant_id THEN
            RAISE EXCEPTION 'OUTBOX_SUBJECT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        IF coalesce(v_subject.o_state_ok, false) THEN
            PERFORM private.enqueue_webhook_internal(p_tenant_id, 'prescription.issued', v_subject.o_data, v_subject.o_event_key, NULL);
        END IF;
    END IF;

    -- 000099 (F-5): the stored result holds ids, numbers and flags only (the reason stays in visit_revisions).
    v_result := jsonb_build_object('visit_id', p_visit_id, 'version', v_version, 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_visit_amendment(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_visit_amendment(uuid, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.finalize_visit_amendment(uuid, uuid, uuid) IS
    'V2-07 07-01 (R-1), V2-09a 000108/000109 (R-10, R-12): finalizes a reopened amendment in one transaction: the latest prescription gets the next version, the amendment reason, a new signature and no PDF pair (the signed version''s path and hash survive in the revision snapshot), the visit is re-signed as completed, the visit.amend_finalized audit row, and one prescription.issued outbox row for the re-signed header (event key prescription.issued:<id>:signed:v<n>). consultations:edit, prescriptions:edit and appointments:edit (000099 F-2). AMENDMENT_NOT_OPEN (P0001) unless the visit is signed and reopened. Idempotent by p_client_request_id. Result: visit_id, version, replayed (no free text, 000099 F-5).';

-- 6. storage policies: rx has no UPDATE, and an INSERT only for the sealed header's own key ------------------------------------------------
DROP POLICY prescriptions_rx_update ON storage.objects;
DROP POLICY prescriptions_rx_insert ON storage.objects;
CREATE POLICY prescriptions_rx_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'prescriptions'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/rx_v[0-9]{1,9}\.pdf$'
    AND split_part(name, '/', 1) IN (SELECT t::text FROM authz.tenant_ids_with('prescriptions:edit') t)
    -- 000109 (R-13): the object is the PDF of a header that exists, is signed, has no archived PDF yet and belongs to a sealed visit, at exactly its version.
    AND EXISTS (
      SELECT 1
        FROM public.prescriptions p
        JOIN public.visits v ON v.tenant_id = p.tenant_id AND v.id = p.visit_id
       WHERE p.tenant_id::text = split_part(name, '/', 1)
         AND p.visit_id::text = split_part(name, '/', 2)
         AND 'rx_v' || p.version::text || '.pdf' = split_part(name, '/', 3)
         AND p.signed_at IS NOT NULL
         AND p.pdf_sha256 IS NULL
         AND v.signed_at IS NOT NULL
         AND v.status <> 'in_consultation'
    )
  );

-- 7. audit allow-lists --------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.audit_client_actions()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'api_key.create', 'api_key.revoke', 'appointment.create',
        'clinic.profile.update', 'clinic.settings.update', 'consultation.amend', 'consultation.complete_sign',
        'consultation.draft_save', 'consultation.share_consolidated_whatsapp', 'diagnosis.add', 'diagnosis.remove',
        'diagnosis.update_note', 'follow_up.record', 'invoice.generate_receipt_pdf',
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
    'The actions public.log_audit accepts from a signed-in member (parity: lib/audit/audit.ts AUDIT_ACTIONS without the reserved prefixes, plus the two bound DPDP events; tests/audit/log-audit-allowlist.spec.ts). V2-08 08-06a (S-5): appointment.cancel, appointment.reschedule, queue.transition, visit.status_update and visit.create are no longer accepted; their writers are the commands (private.log_command_audit) and the API-key path (audit_logs insert by the service client). V2-09a 000109: prescription.pdf_integrity_failed (a served sealed Rx PDF whose bytes did not match the stored SHA-256).';

CREATE OR REPLACE FUNCTION private.audit_metadata_keys()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'amendment_reason', 'consent_type', 'correlation_id', 'dose_form', 'erased_at', 'fields_changed',
        'follow_up_date', 'format', 'invoice_id', 'invoice_number', 'is_chronic', 'is_custom', 'is_initial_grant',
        'is_overbooked', 'items_count', 'late_arrival', 'letterhead_mode', 'new_scheduled_at', 'new_status',
        'old_scheduled_at', 'old_status', 'origin_type',
        'patient_consents_history_sharing', 'payment_method', 'priority', 'promoted_from_waitlist_id',
        'promoted_visit_id', 'reason', 'referral_type', 'retention_policy', 'revision_number', 'sha256', 'specialty', 'status',
        'storage_path', 'target_date', 'target_tenant_id', 'template_name', 'token_number', 'total_amount', 'urgency',
        'version', 'view_context'
    ]::TEXT[];
$$;
