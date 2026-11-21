-- 000108_prescription_seal.sql — V2-09a 09A-02 (R-8, R-9, R-10; P1-03, BACKEND A6 / E2; V2-05 hand-offs "Rx header lock" R-21, I-1; V2-07 hand-off:
-- the amendment webhook).
--
-- A signed prescription header cannot be rewritten by anyone, a request path creates at most one header per visit, sign-off still seals, and
-- finalizing an amendment re-issues the prescription event. No data change.
--
-- 1. private.prescriptions_actor_guard (latest body 000077:259-297) replaced: INSERT is refused on a sealed visit for EVERY writer
--    (PRESCRIPTION_VISIT_SIGNED; the signed-in rule is unchanged, a writer with no auth.uid() meets the same seal, R-3), and on the request path
--    the header's `version` must be 1 (PRESCRIPTION_VERSION_FORBIDDEN): a request path creates at most one header per visit (I-1). Later
--    versions are written by finalize_visit_amendment and by the v1 API (a system path). The UPDATE key check is unchanged.
-- 2. private.prescriptions_seal_guard, new, BEFORE UPDATE OR DELETE on every path (R-8): once the visit is sealed (signed and not reopened, R-2)
--    only updated_at, letterhead_mode and pdf_storage_path may change (000109 narrows it to the PDF pair); anything else raises RX_SEALED, and a
--    DELETE is refused (R-4a: a writer with no session may delete when the row's clinic is gone, the tenant purge cascade). The commands change
--    a header while the visit is a draft or amending: sign-off seals it BEFORE it signs the visit (3), finalize bumps it while the visit is open.
-- 3. private.step_sign_consultation (latest 000099:795-893): the seal UPDATE of the active prescriptions runs before the visit UPDATE (the guard
--    above would refuse the seal on a signed visit). Every other statement, check, audit and outbox row is unchanged.
-- 4. public.finalize_visit_amendment (latest 000099:1083-1171): after the visit UPDATE it enqueues prescription.issued for the re-signed header
--    in the same transaction (R-10), skipped when the visit has no header. Result jsonb, signature and grants unchanged.
-- 5. private.webhook_event_subject (latest 000041:489): prescription.issued data gains `version`; the event key gains `:v<n>` for n > 1.
-- 6. Privilege: REVOKE UPDATE ON public.prescriptions FROM authenticated; GRANT UPDATE (letterhead_mode, pdf_storage_path, updated_at) (the
--    000103 pattern for visits). version, status, signed_at and amendment_reason change only inside the commands (and on the service role's
--    system path, which the seal guard still binds). 000109 narrows it again to (pdf_storage_path, pdf_sha256, updated_at).
--
-- Refusals are SQLSTATE 42501 with fixed names and no row data: RX_SEALED, PRESCRIPTION_VERSION_FORBIDDEN (new), PRESCRIPTION_VISIT_SIGNED.
-- Per-migration checklist: no data change; the two trigger functions are INVOKER with search_path '' and qualified names, EXECUTE revoked from
-- PUBLIC, anon, authenticated, service_role; the replaced commands keep the V2-07 pattern (guard block, claim, lock, in-transaction audit and
-- outbox, lock_timeout 2s, search_path '', EXECUTE for authenticated only on the public one) and their signatures and grants.

-- 1. INSERT: sealed visit for every writer; one header per visit on the request path ------------------------------------------------------
CREATE OR REPLACE FUNCTION private.prescriptions_actor_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
BEGIN
    IF TG_OP = 'INSERT' THEN
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
    'V2-05 05-11a/05-11e, V2-09a 000108 (M-ACTOR, NF-2, I-1, R-8): a header is never added to a sealed visit by any writer; a signed-in caller '
    'prescribes only as itself, for the visit''s own patient, only while the visit is unsigned or reopened, and only as version 1; '
    'doctor, visit and patient of a prescription never change (signed-in callers). 42501.';

-- 2. UPDATE and DELETE: a sealed header does not change -------------------------------------------------------------------------------------
CREATE FUNCTION private.prescriptions_seal_guard()
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
    IF NOT v_sealed THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        -- R-4a: the cascade of a tenant purge.
        IF v_uid IS NULL AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'RX_SEALED' USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) - 'updated_at' - 'letterhead_mode' - 'pdf_storage_path')
       IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'letterhead_mode' - 'pdf_storage_path') THEN
        RAISE EXCEPTION 'RX_SEALED' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.prescriptions_seal_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.prescriptions_seal_guard() IS
    'V2-09a 09A-02 (R-8): BEFORE UPDATE OR DELETE on prescriptions, every writer. While the visit is sealed (signed, not reopened) a header '
    'changes only in updated_at, letterhead_mode and pdf_storage_path (000109 narrows this to the PDF pair), and is deleted by nobody except '
    'the cascade of a tenant purge. 42501 RX_SEALED. A draft or amending visit is not bound (the commands write the header there).';
CREATE TRIGGER prescriptions_seal_guard
    BEFORE UPDATE OR DELETE ON public.prescriptions
    FOR EACH ROW EXECUTE FUNCTION private.prescriptions_seal_guard();

-- 3. privilege: a request path changes the PDF columns only ---------------------------------------------------------------------------------
REVOKE UPDATE ON public.prescriptions FROM authenticated;
GRANT UPDATE (letterhead_mode, pdf_storage_path, updated_at) ON public.prescriptions TO authenticated;

-- 4. sign-off seals the header before it signs the visit -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.step_sign_consultation(p_tenant_id uuid, p_visit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_visit record;
    v_has_content boolean;
    v_signed_at timestamptz;
    v_rx_ids uuid[];
    v_rx_id uuid;
    v_subject record;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 000099 (F-2): this step writes prescriptions (seal) and the visit's status, so the caller must hold those families'
    -- permissions itself; the command's consultations:edit is not assumed to imply them (a matrix change cannot widen it).
    IF NOT (public.has_permission(p_tenant_id, 'consultations:edit')
            AND public.has_permission(p_tenant_id, 'prescriptions:edit')
            AND public.has_permission(p_tenant_id, 'appointments:edit')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- The aggregate root: commands on one visit run one after the other, so the second of two concurrent sign-offs sees
    -- the first one's signature and is refused instead of re-stamping the record (P1-23).
    SELECT v.id, v.status, v.signed_at INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_visit.status = 'completed' OR v_visit.signed_at IS NOT NULL THEN
        RAISE EXCEPTION 'ALREADY_SIGNED' USING ERRCODE = 'P0001';
    END IF;
    -- 000099 (F-6): only a visit that is in the queue or in the consultation is signed; a booked, confirmed, cancelled or
    -- no-show visit is not (the sign-off emits guaranteed webhooks).
    IF v_visit.status NOT IN ('waiting', 'in_consultation') THEN
        RAISE EXCEPTION 'VISIT_NOT_SIGNABLE' USING ERRCODE = 'P0001';
    END IF;

    -- Clinical safety: at least one diagnosis or a non-empty clinical note.
    SELECT EXISTS (SELECT 1 FROM public.consultation_diagnoses d
                    WHERE d.tenant_id = p_tenant_id AND d.visit_id = p_visit_id)
        OR EXISTS (SELECT 1 FROM public.clinical_notes n
                    WHERE n.tenant_id = p_tenant_id AND n.visit_id = p_visit_id
                      AND btrim(coalesce(n.clinical_notes, '')) <> '')
      INTO v_has_content;
    IF NOT v_has_content THEN
        RAISE EXCEPTION 'SIGN_CONTENT_REQUIRED' USING ERRCODE = 'P0001';
    END IF;

    -- 000108 (R-8): seal every active prescription of the visit BEFORE the visit is signed. Once the visit is signed a prescription header
    -- no longer changes (prescriptions_seal_guard), so the seal has to be written while the visit is still a draft.
    WITH sealed AS (
        UPDATE public.prescriptions
           SET signed_at = now(), updated_at = now()
         WHERE visit_id = p_visit_id AND tenant_id = p_tenant_id AND status = 'active'
        RETURNING id
    )
    SELECT coalesce(array_agg(s.id ORDER BY s.id), ARRAY[]::uuid[]) INTO v_rx_ids FROM sealed s;

    -- The signer is the session's user; visits_integrity_guard sets signed_at to the database clock (NF-5).
    UPDATE public.visits
       SET status = 'completed', signed_at = now(), signed_by = v_uid, updated_at = now()
     WHERE id = p_visit_id AND tenant_id = p_tenant_id
    RETURNING signed_at INTO v_signed_at;

    PERFORM private.log_command_audit(p_tenant_id, 'visit.complete_and_sign', 'visit', p_visit_id,
                             jsonb_build_object('version', 1));

    -- Outbox, same transaction: one visit.completed and one prescription.issued per sealed prescription (event key
    -- prescription.issued:<id>:signed), only for clinics with a matching subscription. The subject builder is the one
    -- public.enqueue_webhook_event uses; a subject that is not in this clinic or not in the event's state is a fault.
    SELECT * INTO v_subject FROM private.webhook_event_subject('visit.completed', p_visit_id);
    IF v_subject.o_tenant IS DISTINCT FROM p_tenant_id OR NOT coalesce(v_subject.o_state_ok, false) THEN
        RAISE EXCEPTION 'OUTBOX_SUBJECT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    PERFORM private.enqueue_webhook_internal(p_tenant_id, 'visit.completed', v_subject.o_data, v_subject.o_event_key, NULL);

    FOREACH v_rx_id IN ARRAY v_rx_ids LOOP
        SELECT * INTO v_subject FROM private.webhook_event_subject('prescription.issued', v_rx_id);
        IF v_subject.o_tenant IS DISTINCT FROM p_tenant_id OR NOT coalesce(v_subject.o_state_ok, false) THEN
            RAISE EXCEPTION 'OUTBOX_SUBJECT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        PERFORM private.enqueue_webhook_internal(p_tenant_id, 'prescription.issued', v_subject.o_data, v_subject.o_event_key, NULL);
    END LOOP;

    RETURN jsonb_build_object(
        'visit_id', p_visit_id,
        'signed_at', v_signed_at,
        'sealed_prescriptions', cardinality(v_rx_ids)
    );
END;
$$;
REVOKE ALL ON FUNCTION private.step_sign_consultation(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.step_sign_consultation(uuid, uuid) IS
    'V2-07 07-01 (R-7), V2-09a 000108 (R-8): the sign-off body shared by sign_consultation and (07-03) complete_and_bill: lock the visit, refuse a signed visit (ALREADY_SIGNED), one that is not waiting or in consultation (VISIT_NOT_SIGNABLE) or one without a diagnosis or clinical note (SIGN_CONTENT_REQUIRED), require consultations:edit, prescriptions:edit and appointments:edit (F-2), seal the active prescriptions, then sign the visit as the session user (the seal runs first: a signed visit''s header no longer changes), write the visit.complete_and_sign audit row and the visit.completed / prescription.issued outbox rows. The caller has checked actor, clinic and consultations:edit and holds the command claim; no API grant.';

-- 5. finalize re-issues the prescription event ---------------------------------------------------------------------------------------------------
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
        UPDATE public.prescriptions
           SET version = v_version, amendment_reason = v_reason, signed_at = now(), updated_at = now()
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
    'V2-07 07-01 (R-1), V2-09a 000108 (R-10): finalizes a reopened amendment in one transaction: the latest prescription gets the next version, the amendment reason and a new signature, the visit is re-signed as completed, the visit.amend_finalized audit row, and one prescription.issued outbox row for the re-signed header (event key prescription.issued:<id>:signed:v<n>). consultations:edit, prescriptions:edit and appointments:edit (000099 F-2). AMENDMENT_NOT_OPEN (P0001) unless the visit is signed and reopened. Idempotent by p_client_request_id. Result: visit_id, version, replayed (no free text, 000099 F-5).';

-- 6. the event subject: version in the data and in the key ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.webhook_event_subject(
    p_event_type TEXT,
    p_subject_id UUID,
    OUT o_tenant UUID,
    OUT o_data JSONB,
    OUT o_event_key TEXT,
    OUT o_state_ok BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET "TimeZone" = 'UTC'
AS $$
BEGIN
    IF p_subject_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    CASE p_event_type
    WHEN 'appointment.rescheduled' THEN
        SELECT v.tenant_id,
               jsonb_build_object('appointment_id', v.id, 'scheduled_at', v.scheduled_at),
               'appointment.rescheduled:' || v.id::text || ':' || coalesce(to_jsonb(v.scheduled_at) #>> '{}', ''),
               v.scheduled_at IS NOT NULL
          INTO o_tenant, o_data, o_event_key, o_state_ok
          FROM public.visits v WHERE v.id = p_subject_id;
    WHEN 'appointment.cancelled' THEN
        SELECT v.tenant_id,
               jsonb_build_object(
                   'appointment_id', v.id,
                   'reason', coalesce(NULLIF(v.metadata ->> 'cancellation_reason', ''), 'clinic_cancelled')
               ),
               'appointment.cancelled:' || v.id::text,
               v.status = 'cancelled'
          INTO o_tenant, o_data, o_event_key, o_state_ok
          FROM public.visits v WHERE v.id = p_subject_id;
    WHEN 'visit.completed' THEN
        SELECT v.tenant_id,
               jsonb_build_object(
                   'visit_id', v.id,
                   'patient_id', v.patient_id,
                   'doctor_id', v.doctor_id,
                   'completed_at', private.webhook_iso(coalesce(v.signed_at, v.updated_at))
               ),
               'visit.completed:' || v.id::text,
               v.status = 'completed'
          INTO o_tenant, o_data, o_event_key, o_state_ok
          FROM public.visits v WHERE v.id = p_subject_id;
    WHEN 'prescription.issued' THEN
        -- 04-07a M-RXEVENT: an active prescription that is signed (the consultation was signed) or, on the API path, was
        -- created with its items. The empty draft is not issued. The key carries the state, so the sign-time event is
        -- never suppressed by an earlier unsigned one.
        -- 000108 (R-10): `version` joins the data, and the key gains `:v<n>` from version 2, so an amended prescription (the same header
        -- row with version + 1) is issued once per version; the key of version 1 is unchanged.
        SELECT p.tenant_id,
               jsonb_build_object('prescription_id', p.id, 'patient_id', p.patient_id, 'visit_id', p.visit_id, 'version', p.version),
               'prescription.issued:' || p.id::text || ':'
                   || CASE WHEN p.signed_at IS NOT NULL THEN 'signed' ELSE 'created' END
                   || CASE WHEN p.version > 1 THEN ':v' || p.version::text ELSE '' END,
               p.status = 'active'
                   AND (p.signed_at IS NOT NULL
                        OR EXISTS (SELECT 1 FROM public.prescription_items i WHERE i.prescription_id = p.id))
          INTO o_tenant, o_data, o_event_key, o_state_ok
          FROM public.prescriptions p WHERE p.id = p_subject_id;
    WHEN 'lab_result.ready' THEN
        -- 04-07a (review B L-3): the document's patient is of the document's clinic, and its visit (when set) is that
        -- patient's visit in that clinic.
        SELECT d.tenant_id,
               jsonb_build_object('document_id', d.id, 'patient_id', d.patient_id, 'title', d.title),
               'lab_result.ready:' || d.id::text,
               EXISTS (SELECT 1 FROM public.patients pt WHERE pt.id = d.patient_id AND pt.tenant_id = d.tenant_id)
                   AND (d.visit_id IS NULL OR EXISTS (
                        SELECT 1 FROM public.visits v
                         WHERE v.id = d.visit_id AND v.tenant_id = d.tenant_id AND v.patient_id = d.patient_id
                   ))
          INTO o_tenant, o_data, o_event_key, o_state_ok
          FROM public.patient_documents d WHERE d.id = p_subject_id;
    WHEN 'ping' THEN
        SELECT s.tenant_id,
               jsonb_build_object(
                   'type', 'test_ping',
                   'message', 'Webhook verification ping from ClinicQ Developer Settings',
                   'timestamp', private.webhook_iso(now())
               ),
               'ping:' || gen_random_uuid()::text,
               true
          INTO o_tenant, o_data, o_event_key, o_state_ok
          FROM public.webhook_subscriptions s WHERE s.id = p_subject_id;
    ELSE
        RAISE EXCEPTION 'EVENT_NOT_ALLOWED' USING ERRCODE = 'P0001';
    END CASE;
END;
$$;
