-- Migration: 000078_signed_visit_fields.sql
-- V2-05 05a gate close: the two Lows of the final re-check (reviews/v205a-review-recheck-05-11e.md, NF-4 and NF-5),
-- fixed under the PO delivery-speed ruling (2026-11-14: a Low is fixed now when it is cheap and local).
-- Guards only (no data change, no constraint to validate, no grant or policy change).
--
-- 1. NF-4 (Low) the front desk could move a signed visit's date or relabel its specialty with no amendment row.
--    a. `private.visits_integrity_guard` (replaced): on the user path, while a visit is signed and `completed`,
--       `specialty` and `scheduled_at` never change (42501 VISIT_SIGNED_FIELD_IMMUTABLE). They change only while the
--       visit is reopened for amendment (`in_consultation`), i.e. after an amendment row snapshotted the signed version.
--       The reopen statement itself cannot change them (its OLD row is still `completed`). Rescheduling applies only to
--       unsigned visits (`booked`/`confirmed`), and the system path (v1 PATCH appointments, service role) is unchanged
--       (N-9, V2-09a).
--    b. `private.visit_revisions_actor_guard` (replaced): the snapshot's `visit` object also holds `scheduled_at` (the
--       date printed on the Rx PDF). Everything else is unchanged from 000077.
-- 2. NF-5 (Low) the signature time was the caller's value, so a signature could be back- or forward-dated.
--    `private.visits_integrity_guard`: when a signed-in caller's UPDATE changes the signature (first sign-off, or the
--    re-sign that finalizes an amendment) and passes the existing checks, `signed_at` is set to the database clock
--    (`now()`, the transaction time, as `visit_revisions.amended_at`); the client value only signals "sign". The
--    prescription header's `signed_at` stays with V2-09a (R-21, header lock).
-- Everything else in both functions is unchanged (000077). All refusals are 42501 with a fixed message and no row data.
-- Per-migration checklist: no new table, no grant or policy change; functions pin search_path '' with qualified names;
-- trigger functions get no EXECUTE grant (the definer trigger stays catalogued in definer_functions.test.sql).

-- 1b. Amendment rows: the snapshot also records the visit date ------------------------------------------------------------
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
    SELECT v.id, v.tenant_id, v.status, v.signed_at, v.signed_by, v.specialty, v.scheduled_at, v.current_revision
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
            -- 000078 (NF-4): the visit date printed on the signed record.
            'scheduled_at', v_visit.scheduled_at,
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
    'V2-05 05-11a/05-11d/05-11e/000078 (M-ACTOR, N-2, N-8, NF-1, NF-2, NF-4): an amendment row is written by a '
    'consultations:edit holder as itself, only on a signed, completed visit; on every path its snapshot is the visit''s '
    'current content (signature, specialty, visit date, notes, diagnoses, every prescription with its items, follow-ups) '
    'and its number the previous + 1, filled here under the visit row lock (client values ignored). SECURITY DEFINER: '
    'the snapshot does not depend on what the caller may read. 42501.';

-- 1a + 2. Signed visit fields locked; the signature time is the database clock ---------------------------------------------
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

    -- 000078 (NF-4): the specialty and the visit date are part of the signed record; they change only while the visit
    -- is reopened for amendment.
    IF OLD.signed_at IS NOT NULL AND OLD.status = 'completed'
       AND (NEW.specialty IS DISTINCT FROM OLD.specialty OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at) THEN
        RAISE EXCEPTION 'VISIT_SIGNED_FIELD_IMMUTABLE' USING ERRCODE = '42501';
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
    IF v_sign_changed THEN
        -- 000078 (NF-5): the signature time is the database clock, never the caller's value.
        NEW.signed_at := now();
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
    'V2-05 05-11a/05-11e/000078 (H-VISIT, M-ACTOR, M-INVOICE, NF-1, NF-4, NF-5): visits keys immutable; signed visit '
    'keeps its doctor; a signed-in caller signs only as itself with consultations:edit (signed_at = database clock), '
    'never clears a signature, never changes a signed, completed visit''s specialty or date, reopens only with its own '
    'amendment row whose database snapshot is of the current signature (written after the last reopen), and (as a '
    'doctor without billing:view) never reassigns doctor_id. 42501.';
