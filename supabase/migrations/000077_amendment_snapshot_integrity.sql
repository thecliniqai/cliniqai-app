-- Migration: 000077_amendment_snapshot_integrity.sql
-- V2-05 fix plan 05-11e (05a re-check of the 05-11d fixes, reviews/v205a-review-recheck-05-11d.md: NF-1, NF-2, NF-3).
-- Goal: a signed visit's content can only be replaced after a faithful snapshot of exactly what was signed.
-- Guards only (no data change, no constraint to validate): the current app already writes only what they admit.
--
-- 1. NF-1 (Medium) an amendment row written BEFORE a signature (on an unsigned visit, or while another amendment was
--    open) later reopened the newly signed version, which was then replaced without ever being snapshotted.
--    a. `private.visit_revisions_actor_guard` (replaced, still SECURITY DEFINER): a signed-in caller writes an
--       amendment row only on a visit that is signed and `completed`, checked under the visit row lock
--       (42501 AMENDMENT_VISIT_NOT_SIGNED). Permission and author checks still come first.
--    b. `private.visits_integrity_guard` (replaced): `completed -> in_consultation` needs an amendment row by the
--       caller that was taken of THIS signed state: numbered at or after the visit's `current_revision` (so written
--       after the last reopen), with a database snapshot (`captured_by = database`) whose visit status is `completed`
--       and whose `signed_at` and `signed_by` equal the visit's current signature. `current_revision` then moves past
--       every amendment row of the visit, so no existing row can reopen a later signature. A malformed legacy
--       snapshot never matches (it cannot raise either). Everything else in the guard is unchanged (000068).
--       "At or after" rather than "equal to" `current_revision`: two rows taken of the same signature are both
--       faithful, and an exact-number rule would let one doctor's unused row block every other doctor's amendment.
-- 2. NF-2 (Medium) the snapshot recorded only the latest prescription, so a decoy header steered it away from the
--    signed medicines.
--    a. The snapshot now holds `prescriptions`: every prescription of the visit with its items (ordered by version,
--       created_at, id), and `follow_ups` (printed on the Rx PDF). `prescription` (the latest one) is kept for
--       readers of the 05-11d shape.
--    b. `private.prescriptions_actor_guard` (replaced): a signed-in caller inserts a prescription header only while
--       the visit is unsigned or reopened for amendment (42501 PRESCRIPTION_VISIT_SIGNED), the rule the Rx items and
--       diagnoses already follow (000075). Header UPDATEs on a signed visit stay with V2-09a (R-21; the app seals the
--       header after signing).
-- 3. NF-3 (Low) `private.follow_ups_integrity_guard` (new, BEFORE INSERT/UPDATE/DELETE, INVOKER), the
--    consultation_diagnoses pattern:
--    - every path: `id`, `tenant_id`, `patient_id`, `visit_id` never change, except that the system path may clear
--      `visit_id` once its visit is gone (the `ON DELETE SET NULL (visit_id)` action of follow_ups_tenant_visit_fkey);
--    - signed-in caller: a follow-up tied to a visit names that visit's patient (INSERT), and a follow-up of a signed
--      visit is written (insert, update, delete) only while the visit is reopened for amendment. A visit the caller
--      cannot see counts as locked (fail closed). 42501 FOLLOW_UP_KEY_IMMUTABLE / FOLLOW_UP_PATIENT_MISMATCH /
--      FOLLOW_UP_VISIT_SIGNED. A follow-up with no visit is unaffected.
-- All refusals are 42501 with a fixed message and no row data.
-- Per-migration checklist: no new table, no grant or policy change; functions pin search_path '' with qualified names;
-- trigger functions get no EXECUTE grant (the definer trigger stays catalogued in definer_functions.test.sql).

-- 1a + 2a. Amendment rows: only on a signed, completed visit; the snapshot holds every prescription --------------------
CREATE OR REPLACE FUNCTION private.visit_revisions_actor_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_visit record;
    v_notes record;
    v_prev integer;
BEGIN
    IF v_uid IS NOT NULL THEN
        -- The insert policy's own predicate, checked first: nothing is read or locked for a caller it would refuse.
        IF NOT public.has_permission(NEW.tenant_id, 'consultations:edit') THEN
            RAISE EXCEPTION 'AMENDMENT_FORBIDDEN' USING ERRCODE = '42501';
        END IF;
        IF NEW.amended_by IS DISTINCT FROM v_uid THEN
            RAISE EXCEPTION 'AMENDMENT_AUTHOR_NOT_CALLER' USING ERRCODE = '42501';
        END IF;
        NEW.amended_at := now();
    END IF;

    -- Serialise amendments of one visit: the state check, the number and the snapshot are read under the visit row lock.
    SELECT v.id, v.tenant_id, v.status, v.signed_at, v.signed_by, v.specialty, v.current_revision
      INTO v_visit
      FROM public.visits v
     WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RETURN NEW; -- the composite FK refuses the row
    END IF;

    -- 05-11e (NF-1): an amendment row records a signed version; it cannot be written ahead of a signature.
    IF v_uid IS NOT NULL AND (v_visit.signed_at IS NULL OR v_visit.status IS DISTINCT FROM 'completed') THEN
        RAISE EXCEPTION 'AMENDMENT_VISIT_NOT_SIGNED' USING ERRCODE = '42501';
    END IF;

    SELECT coalesce(max(r.revision_number), 0) INTO v_prev
      FROM public.visit_revisions r
     WHERE r.tenant_id = NEW.tenant_id AND r.visit_id = NEW.visit_id;
    NEW.revision_number := greatest(v_prev + 1, v_visit.current_revision);

    SELECT n.vitals, n.chief_complaints, n.clinical_notes, n.specialty_data, n.advice, n.investigations_advised
      INTO v_notes
      FROM public.clinical_notes n
     WHERE n.tenant_id = NEW.tenant_id AND n.visit_id = NEW.visit_id;

    NEW.snapshot := jsonb_build_object(
        'captured_by', 'database',
        'visit', jsonb_build_object(
            'status', v_visit.status,
            'signed_at', v_visit.signed_at,
            'signed_by', v_visit.signed_by,
            'specialty', v_visit.specialty,
            'vitals', v_notes.vitals,
            'chief_complaints', v_notes.chief_complaints,
            'clinical_notes', v_notes.clinical_notes,
            'specialty_data', v_notes.specialty_data,
            'advice', to_jsonb(v_notes.advice),
            'investigations_advised', to_jsonb(v_notes.investigations_advised)),
        'diagnoses', coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at, d.id)
                                 FROM public.consultation_diagnoses d
                                WHERE d.tenant_id = NEW.tenant_id AND d.visit_id = NEW.visit_id), '[]'::jsonb),
        -- 05-11e (NF-2): every prescription of the visit with its items, so no header can steer the record away from
        -- the signed medicines.
        'prescriptions', coalesce((SELECT jsonb_agg(
                                              to_jsonb(p) || jsonb_build_object('items',
                                                  coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.sort_order, i.created_at, i.id)
                                                              FROM public.prescription_items i
                                                             WHERE i.tenant_id = p.tenant_id AND i.prescription_id = p.id),
                                                           '[]'::jsonb))
                                              ORDER BY p.version, p.created_at, p.id)
                                     FROM public.prescriptions p
                                    WHERE p.tenant_id = NEW.tenant_id AND p.visit_id = NEW.visit_id), '[]'::jsonb),
        -- The 05-11d key (the latest prescription), kept for its readers; `prescriptions` is the complete record.
        'prescription', (SELECT to_jsonb(p) || jsonb_build_object('items',
                                    coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.sort_order, i.created_at, i.id)
                                                FROM public.prescription_items i
                                               WHERE i.tenant_id = p.tenant_id AND i.prescription_id = p.id), '[]'::jsonb))
                           FROM public.prescriptions p
                          WHERE p.tenant_id = NEW.tenant_id AND p.visit_id = NEW.visit_id
                          ORDER BY p.version DESC, p.created_at DESC, p.id
                          LIMIT 1),
        'follow_ups', coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.created_at, f.id)
                                  FROM public.follow_ups f
                                 WHERE f.tenant_id = NEW.tenant_id AND f.visit_id = NEW.visit_id), '[]'::jsonb));
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.visit_revisions_actor_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.visit_revisions_actor_guard() IS
    'V2-05 05-11a/05-11d/05-11e (M-ACTOR, N-2, N-8, NF-1, NF-2): an amendment row is written by a consultations:edit '
    'holder as itself, only on a signed, completed visit; on every path its snapshot is the visit''s current content '
    '(notes, diagnoses, every prescription with its items, follow-ups) and its number the previous + 1, filled here '
    'under the visit row lock (client values ignored). SECURITY DEFINER: the snapshot does not depend on what the '
    'caller may read. 42501.';

-- 1b. Reopen only with an amendment row taken of the current signature -------------------------------------------------
CREATE OR REPLACE FUNCTION private.visits_integrity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_sign_changed boolean;
    v_rev integer;
    v_snap jsonb;
    v_ok boolean := false;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF v_uid IS NULL THEN
            RETURN NEW;
        END IF;
        IF NEW.created_by IS DISTINCT FROM v_uid THEN
            RAISE EXCEPTION 'VISIT_ACTOR_NOT_CALLER' USING ERRCODE = '42501';
        END IF;
        IF NEW.signed_at IS NOT NULL OR NEW.signed_by IS NOT NULL THEN
            RAISE EXCEPTION 'VISIT_SIGNOFF_FORBIDDEN' USING ERRCODE = '42501';
        END IF;
        IF NEW.current_revision IS DISTINCT FROM 1 THEN
            RAISE EXCEPTION 'VISIT_REVISION_FORBIDDEN' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE, every path.
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
        RAISE EXCEPTION 'VISIT_KEY_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    IF OLD.signed_at IS NOT NULL AND NEW.doctor_id IS DISTINCT FROM OLD.doctor_id THEN
        RAISE EXCEPTION 'VISIT_SIGNED_DOCTOR_IMMUTABLE' USING ERRCODE = '42501';
    END IF;

    IF v_uid IS NULL THEN
        RETURN NEW;
    END IF;

    -- UPDATE, signed-in caller.
    IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'VISIT_ACTOR_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    IF NEW.current_revision IS DISTINCT FROM OLD.current_revision THEN
        RAISE EXCEPTION 'VISIT_REVISION_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
       AND public.has_permission(OLD.tenant_id, 'consultations:edit')
       AND NOT public.has_permission(OLD.tenant_id, 'billing:view') THEN
        RAISE EXCEPTION 'VISIT_DOCTOR_REASSIGN_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    v_sign_changed := NEW.signed_at IS DISTINCT FROM OLD.signed_at OR NEW.signed_by IS DISTINCT FROM OLD.signed_by;
    IF v_sign_changed AND (
           NOT public.has_permission(OLD.tenant_id, 'consultations:edit')
           OR NEW.signed_at IS NULL
           OR NEW.signed_by IS DISTINCT FROM v_uid
           OR NEW.status IS DISTINCT FROM 'completed'
           -- an existing signature is replaced only when an amendment is finalized (reopened -> completed)
           OR (OLD.signed_at IS NOT NULL AND OLD.status IS DISTINCT FROM 'in_consultation')) THEN
        RAISE EXCEPTION 'VISIT_SIGNOFF_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    IF OLD.signed_at IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT public.has_permission(OLD.tenant_id, 'consultations:edit') THEN
            RAISE EXCEPTION 'VISIT_SIGNED_STATUS_FORBIDDEN' USING ERRCODE = '42501';
        END IF;
        IF OLD.status = 'completed' AND NEW.status = 'in_consultation' AND NOT v_sign_changed THEN
            -- 05-11e (NF-1): the caller's amendment row must be a database snapshot of THIS signed state, written after
            -- the last reopen. A row taken while the visit was unsigned or open, or of an earlier signature, opens
            -- nothing.
            FOR v_snap IN
                SELECT r.snapshot -> 'visit'
                  FROM public.visit_revisions r
                 WHERE r.tenant_id = OLD.tenant_id AND r.visit_id = OLD.id AND r.amended_by = v_uid
                   AND r.revision_number >= OLD.current_revision
                   AND r.snapshot ->> 'captured_by' = 'database'
                   AND r.snapshot -> 'visit' ->> 'status' = 'completed'
                   AND (r.snapshot -> 'visit' ->> 'signed_by') IS NOT DISTINCT FROM OLD.signed_by::text
                 ORDER BY r.revision_number DESC
            LOOP
                BEGIN
                    IF (v_snap ->> 'signed_at')::timestamptz = OLD.signed_at THEN
                        v_ok := true;
                        EXIT;
                    END IF;
                EXCEPTION WHEN data_exception THEN
                    NULL; -- a malformed (legacy) snapshot never matches
                END;
            END LOOP;
            IF NOT v_ok THEN
                RAISE EXCEPTION 'VISIT_REOPEN_NEEDS_AMENDMENT' USING ERRCODE = '42501';
            END IF;
            -- Past every amendment row of the visit: none of them can reopen a later signature.
            SELECT max(r.revision_number) INTO v_rev
              FROM public.visit_revisions r
             WHERE r.tenant_id = OLD.tenant_id AND r.visit_id = OLD.id;
            NEW.current_revision := v_rev + 1;
        ELSIF OLD.status = 'in_consultation' AND NEW.status = 'completed' AND v_sign_changed THEN
            NULL; -- finalize: re-signed by the caller (checked above)
        ELSE
            RAISE EXCEPTION 'VISIT_SIGNED_STATUS_FORBIDDEN' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.visits_integrity_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.visits_integrity_guard() IS
    'V2-05 05-11a/05-11e (H-VISIT, M-ACTOR, M-INVOICE, NF-1): visits keys immutable; signed visit keeps its doctor; a '
    'signed-in caller signs only as itself with consultations:edit, never clears a signature, reopens only with its own '
    'amendment row whose database snapshot is of the current signature (written after the last reopen), and (as a '
    'doctor without billing:view) never reassigns doctor_id. 42501.';

-- 2b. No new prescription header on a signed visit ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.prescriptions_actor_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
BEGIN
    IF v_uid IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
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
    'V2-05 05-11a/05-11e (M-ACTOR, NF-2): a signed-in caller prescribes only as itself, for the visit''s own patient, '
    'and adds a header only while the visit is unsigned or reopened; doctor, visit and patient of a prescription never '
    'change. 42501.';

-- 3. follow_ups: the child-row guard of diagnoses and Rx items -----------------------------------------------------------
CREATE FUNCTION private.follow_ups_integrity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_tenant uuid;
    v_visit uuid;
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
            OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
            OR (NEW.visit_id IS DISTINCT FROM OLD.visit_id
                -- the FK's ON DELETE SET NULL (visit_id): the system path clears the link once the visit is gone
                AND NOT (v_uid IS NULL AND NEW.visit_id IS NULL
                         AND NOT EXISTS (SELECT 1 FROM public.visits v
                                          WHERE v.tenant_id = OLD.tenant_id AND v.id = OLD.visit_id)))) THEN
        RAISE EXCEPTION 'FOLLOW_UP_KEY_IMMUTABLE' USING ERRCODE = '42501';
    END IF;

    IF v_uid IS NOT NULL THEN
        IF TG_OP = 'DELETE' THEN
            v_tenant := OLD.tenant_id;
            v_visit := OLD.visit_id;
        ELSE
            v_tenant := NEW.tenant_id;
            v_visit := NEW.visit_id;
        END IF;
        IF v_visit IS NOT NULL THEN
            IF TG_OP = 'INSERT'
               AND NOT EXISTS (SELECT 1 FROM public.visits v
                                WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id AND v.patient_id = NEW.patient_id) THEN
                RAISE EXCEPTION 'FOLLOW_UP_PATIENT_MISMATCH' USING ERRCODE = '42501';
            END IF;
            IF NOT EXISTS (SELECT 1 FROM public.visits v
                            WHERE v.tenant_id = v_tenant AND v.id = v_visit
                              AND (v.signed_at IS NULL OR v.status = 'in_consultation')) THEN
                RAISE EXCEPTION 'FOLLOW_UP_VISIT_SIGNED' USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.follow_ups_integrity_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.follow_ups_integrity_guard() IS
    'V2-05 05-11e (NF-3): follow-up keys never change (the system path may clear visit_id once its visit is gone); a '
    'signed-in caller ties a follow-up only to a visit of the same patient and writes the follow-up of a signed visit '
    'only while it is reopened for amendment. 42501.';
CREATE TRIGGER follow_ups_integrity_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.follow_ups
    FOR EACH ROW EXECUTE FUNCTION private.follow_ups_integrity_guard();
