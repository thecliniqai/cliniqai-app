-- 000107_clinical_seal.sql — V2-09a 09A-01 (R-2 to R-7; P1-03, BACKEND A6 full, DB-13, ADR-015; V2-05 hand-offs N-9, reason_for_visit).
--
-- After sign-off the record cannot change for ANY writer: a signed-in member, the body of a SECURITY DEFINER function, the service
-- role or the postgres role. The V2-05 guards (000068, 000075, 000077, 000078, 000099) checked the seal only when auth.uid() was
-- set, so a writer with no session (the v1 API's service-role client, a job, a script) could rewrite a signed visit, its notes,
-- diagnoses, Rx items, follow-ups and amendment revisions, and could sign, un-sign, re-sign or reopen a visit (N-9).
--
-- R-2  Sealed = visits.signed_at IS NOT NULL AND visits.status <> 'in_consultation'. Amending (reopened) = signed_at IS NOT NULL AND
--      status = 'in_consultation'. Draft = everything else. The predicate is inline in each guard (no new definer function, R-3). It
--      is mirrored by features/consultation/record-state.ts (recordState), and tests/consultation/record-state-parity.spec.ts compares
--      the two on real rows.
-- R-3  BEFORE ROW triggers fire for every writer. They do not fire under session_replication_role = replica or after
--      ALTER TABLE ... DISABLE TRIGGER (superuser / table-owner DDL, out of reach of every request path). A migration that has to
--      change a signed row must say so in its header and in review (this one changes no data).
-- R-4a A writer with no auth.uid() may DELETE a row of a sealed visit only when the row's tenant no longer exists (the FK cascade of a
--      tenant purge or a test teardown; the follow-ups precedent of 000077). Deleting an UNSIGNED visit is not sealed (a
--      cascade finds its visit already gone, so nothing counts as signed). Per-patient erasure and retention purge of signed records are V2-13 / V2-13c, with their
--      own reviewed scope. (b) follow_ups ON DELETE SET NULL (visit_id) keeps its carve-out. (c) A writer with no auth.uid() may still
--      INSERT a visit that is already signed (seeds, imports; ADR-0005 confines the client); it creates and never alters, and child rows
--      added to it are refused. (d) The amendment commands run under the caller's JWT, so every rule sees the caller.
-- R-5  visits_integrity_guard, writer with no auth.uid(): signed_at / signed_by never go from NULL to a value, once signed neither they
--      nor current_revision, created_by, created_at change and no status change is allowed. The user-path logic is unchanged.
-- R-6  Locked while sealed on every path: specialty, scheduled_at, location_id and (new) reason_for_visit.
-- R-7  visit_revisions are append-only on every path (UPDATE refused, DELETE refused except R-4a; the visit FK is RESTRICT, so no visit with
--      an amendment row can be deleted).
-- New refusals (SQLSTATE 42501, fixed names, no row data): VISIT_SIGNED_DELETE_FORBIDDEN, REVISION_IMMUTABLE; existing names are
-- reused for the same rules on the system path (CLINICAL_NOTES_VISIT_SIGNED, DIAGNOSIS_VISIT_SIGNED, PRESCRIPTION_ITEM_VISIT_SIGNED,
-- FOLLOW_UP_VISIT_SIGNED, VISIT_SIGNOFF_FORBIDDEN, VISIT_SIGNED_STATUS_FORBIDDEN, VISIT_SIGNED_FIELD_IMMUTABLE).
--
-- Per-migration checklist: no data change, no grant or policy change, expand-safe. Trigger functions are INVOKER with search_path ''
-- and qualified names, EXECUTE revoked from PUBLIC, anon, authenticated, service_role. Replaced bodies start from the latest
-- definitions: private.visits_integrity_guard 000099:340-469, public.clinical_notes_guard 000068:226-255,
-- private.prescription_items_integrity_guard / consultation_diagnoses_integrity_guard 000075:51-141, private.follow_ups_integrity_guard
-- 000077:300-356; each changes only what is named above.
-- Known gap closed by 000108: the prescription header (UPDATE, DELETE and the cascade to its items) is guarded by 000108.

-- 1. visits: the system-path block (R-5) and the R-6 column lock ---------------------------------------------------------------
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
        -- 000107 (R-5, N-9): a writer with no auth.uid() (the service role, a definer called without a session) has no actor to
        -- stamp a signature, so it can neither sign, un-sign, re-sign nor reopen a visit, and a signed record keeps what the
        -- commands wrote. Everything else it may still change (scheduling data, `metadata`, `updated_at`).
        IF OLD.signed_at IS NULL THEN
            IF NEW.signed_at IS NOT NULL OR NEW.signed_by IS NOT NULL THEN
                RAISE EXCEPTION 'VISIT_SIGNOFF_FORBIDDEN' USING ERRCODE = '42501';
            END IF;
        ELSE
            IF NEW.signed_at IS DISTINCT FROM OLD.signed_at OR NEW.signed_by IS DISTINCT FROM OLD.signed_by THEN
                RAISE EXCEPTION 'VISIT_SIGNOFF_FORBIDDEN' USING ERRCODE = '42501';
            END IF;
            IF NEW.status IS DISTINCT FROM OLD.status THEN
                RAISE EXCEPTION 'VISIT_SIGNED_STATUS_FORBIDDEN' USING ERRCODE = '42501';
            END IF;
            IF NEW.current_revision IS DISTINCT FROM OLD.current_revision
               OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                RAISE EXCEPTION 'VISIT_SIGNED_FIELD_IMMUTABLE' USING ERRCODE = '42501';
            END IF;
            -- R-6: while sealed, the columns a signed record prints are locked on this path too.
            IF OLD.status IS DISTINCT FROM 'in_consultation'
               AND (NEW.specialty IS DISTINCT FROM OLD.specialty OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
                    OR NEW.location_id IS DISTINCT FROM OLD.location_id
                    OR NEW.reason_for_visit IS DISTINCT FROM OLD.reason_for_visit) THEN
                RAISE EXCEPTION 'VISIT_SIGNED_FIELD_IMMUTABLE' USING ERRCODE = '42501';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE, signed-in caller.
    IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'VISIT_ACTOR_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    IF NEW.current_revision IS DISTINCT FROM OLD.current_revision THEN
        RAISE EXCEPTION 'VISIT_REVISION_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- 000078 (NF-4), 000099 (F-3), 000107 (R-6): the specialty, the visit date, the clinic location and the reason for the visit are part of
    -- the signed record; they change only while the visit is reopened for amendment.
    IF OLD.signed_at IS NOT NULL AND OLD.status IS DISTINCT FROM 'in_consultation'
       AND (NEW.specialty IS DISTINCT FROM OLD.specialty OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
            OR NEW.location_id IS DISTINCT FROM OLD.location_id
            OR NEW.reason_for_visit IS DISTINCT FROM OLD.reason_for_visit) THEN
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
    'V2-05 05-11a/05-11e/000078/000099/000107 (H-VISIT, M-ACTOR, NF-1, NF-4, NF-5, F-3, N-9, R-5, R-6): visits keys immutable; a signed '
    'visit keeps its doctor; a signed-in caller signs only as itself with consultations:edit (signed_at = database clock), never clears '
    'a signature, never changes a sealed visit''s specialty, date, clinic location or reason for visit, reopens only with its own '
    'amendment row whose database snapshot is of the current signature, and (as a doctor without billing:view) never reassigns '
    'doctor_id. A writer with no session can neither sign, un-sign, re-sign nor reopen, and leaves a signed visit''s signature, '
    'revision, creator and status untouched. 42501.';

-- 2. visits: no DELETE of a signed visit (R-4a) -----------------------------------------------------------------------------------
CREATE FUNCTION private.visits_sealed_delete_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF OLD.signed_at IS NOT NULL
       AND NOT ((SELECT auth.uid()) IS NULL AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id)) THEN
        RAISE EXCEPTION 'VISIT_SIGNED_DELETE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.visits_sealed_delete_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.visits_sealed_delete_guard() IS
    'V2-09a 09A-01 (R-4a): a signed visit is never deleted by any writer, except by the cascade of a tenant purge (a writer with no '
    'session and no tenants row). 42501 VISIT_SIGNED_DELETE_FORBIDDEN.';
CREATE TRIGGER visits_sealed_delete_guard
    BEFORE DELETE ON public.visits
    FOR EACH ROW EXECUTE FUNCTION private.visits_sealed_delete_guard();

-- 3. clinical_notes: the seal on every path, plus DELETE (R-3, R-4a) ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clinical_notes_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.visit_id IS DISTINCT FROM OLD.visit_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
    RAISE EXCEPTION 'CLINICAL_NOTES_KEY_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  IF (SELECT auth.uid()) IS NOT NULL THEN
    -- 05-11a (M-SIGNED): the parent visit must be unsigned, or reopened for amendment. A visit the caller cannot see
    -- counts as locked (fail closed).
    IF NOT EXISTS (SELECT 1 FROM public.visits v
                    WHERE v.tenant_id = OLD.tenant_id AND v.id = OLD.visit_id
                      AND (v.signed_at IS NULL OR v.status = 'in_consultation')) THEN
      RAISE EXCEPTION 'CLINICAL_NOTES_VISIT_SIGNED' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND NOT public.has_permission(NEW.tenant_id, 'consultations:edit')
       AND (to_jsonb(NEW) - 'vitals' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'vitals' - 'updated_at') THEN
      RAISE EXCEPTION 'CLINICAL_NOTES_VITALS_ONLY' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- 000107 (R-3): the same seal for a writer with no session (the service role, a definer called without one). R-4a: a
    -- DELETE passes when the row's clinic no longer exists (tenant purge cascade).
    IF EXISTS (SELECT 1 FROM public.visits v
                WHERE v.tenant_id = OLD.tenant_id AND v.id = OLD.visit_id
                  AND v.signed_at IS NOT NULL AND v.status <> 'in_consultation')
       AND NOT (TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id)) THEN
      RAISE EXCEPTION 'CLINICAL_NOTES_VISIT_SIGNED' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.clinical_notes_guard() IS
  'V2-05 05-02a/05-11a, V2-09a 000107 (R-3, R-4a): BEFORE UPDATE OR DELETE on clinical_notes. visit_id/tenant_id never change; no '
  'writer (signed-in or not) changes or deletes the notes of a sealed visit (signed and not reopened); a delete passes only when the '
  'clinic itself is gone (tenant purge); without consultations:edit only vitals may change (42501); maintains updated_at.';
CREATE TRIGGER clinical_notes_delete_guard
    BEFORE DELETE ON public.clinical_notes
    FOR EACH ROW EXECUTE FUNCTION public.clinical_notes_guard();

-- 4. Rx items, diagnoses, follow-ups: the seal for every writer (R-3, R-4a) --------------------------------------------------------
CREATE OR REPLACE FUNCTION private.prescription_items_integrity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_rx uuid;
    v_tenant uuid;
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.prescription_id IS DISTINCT FROM OLD.prescription_id
            OR (OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id)) THEN
        RAISE EXCEPTION 'PRESCRIPTION_ITEM_KEY_IMMUTABLE' USING ERRCODE = '42501';
    END IF;

    v_rx := CASE WHEN TG_OP = 'DELETE' THEN OLD.prescription_id ELSE NEW.prescription_id END;
    v_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
    IF v_uid IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1
                         FROM public.prescriptions p
                         JOIN public.visits v ON v.tenant_id = p.tenant_id AND v.id = p.visit_id
                        WHERE p.id = v_rx
                          AND (v.signed_at IS NULL OR v.status = 'in_consultation')) THEN
            RAISE EXCEPTION 'PRESCRIPTION_ITEM_VISIT_SIGNED' USING ERRCODE = '42501';
        END IF;
    ELSE
        -- 000107 (R-3): a writer with no session meets the same seal. R-4a: a DELETE passes when the clinic is gone.
        IF EXISTS (SELECT 1
                     FROM public.prescriptions p
                     JOIN public.visits v ON v.tenant_id = p.tenant_id AND v.id = p.visit_id
                    WHERE p.id = v_rx
                      AND v.signed_at IS NOT NULL AND v.status <> 'in_consultation')
           AND NOT (TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = v_tenant)) THEN
            RAISE EXCEPTION 'PRESCRIPTION_ITEM_VISIT_SIGNED' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION private.prescription_items_integrity_guard() IS
    'V2-05 05-11d (N-1), V2-09a 000107 (R-3, R-4a): prescription item keys never change; no writer, signed-in or not, inserts, '
    'changes or deletes an item of a sealed visit (a delete passes only when the clinic is gone); a signed-in caller writes items '
    'only while the visit is unsigned or reopened for amendment. 42501.';

CREATE OR REPLACE FUNCTION private.consultation_diagnoses_integrity_guard()
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
            OR NEW.visit_id IS DISTINCT FROM OLD.visit_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id) THEN
        RAISE EXCEPTION 'DIAGNOSIS_KEY_IMMUTABLE' USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_tenant := OLD.tenant_id;
        v_visit := OLD.visit_id;
    ELSE
        v_tenant := NEW.tenant_id;
        v_visit := NEW.visit_id;
    END IF;
    IF v_uid IS NOT NULL THEN
        IF TG_OP = 'INSERT'
           AND NOT EXISTS (SELECT 1 FROM public.visits v
                            WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id AND v.patient_id = NEW.patient_id) THEN
            RAISE EXCEPTION 'DIAGNOSIS_PATIENT_MISMATCH' USING ERRCODE = '42501';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.visits v
                        WHERE v.tenant_id = v_tenant AND v.id = v_visit
                          AND (v.signed_at IS NULL OR v.status = 'in_consultation')) THEN
            RAISE EXCEPTION 'DIAGNOSIS_VISIT_SIGNED' USING ERRCODE = '42501';
        END IF;
    ELSE
        -- 000107 (R-3, R-4a), as above.
        IF EXISTS (SELECT 1 FROM public.visits v
                    WHERE v.tenant_id = v_tenant AND v.id = v_visit
                      AND v.signed_at IS NOT NULL AND v.status <> 'in_consultation')
           AND NOT (TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = v_tenant)) THEN
            RAISE EXCEPTION 'DIAGNOSIS_VISIT_SIGNED' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION private.consultation_diagnoses_integrity_guard() IS
    'V2-05 05-11d (N-1), V2-09a 000107 (R-3, R-4a): diagnosis keys never change; a signed-in caller records a diagnosis only for its '
    'visit''s patient; no writer, signed-in or not, writes a diagnosis of a sealed visit (a delete passes only when the clinic is '
    'gone); a signed-in caller writes diagnoses only while the visit is unsigned or reopened for amendment. 42501.';

CREATE OR REPLACE FUNCTION private.follow_ups_integrity_guard()
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

    IF TG_OP = 'DELETE' THEN
        v_tenant := OLD.tenant_id;
        v_visit := OLD.visit_id;
    ELSE
        v_tenant := NEW.tenant_id;
        v_visit := NEW.visit_id;
    END IF;
    IF v_visit IS NOT NULL THEN
        IF v_uid IS NOT NULL THEN
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
        ELSE
            -- 000107 (R-3, R-4a), as above.
            IF EXISTS (SELECT 1 FROM public.visits v
                        WHERE v.tenant_id = v_tenant AND v.id = v_visit
                          AND v.signed_at IS NOT NULL AND v.status <> 'in_consultation')
               AND NOT (TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = v_tenant)) THEN
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
COMMENT ON FUNCTION private.follow_ups_integrity_guard() IS
    'V2-05 05-11e (NF-3), V2-09a 000107 (R-3, R-4a): follow-up keys never change (the system path may clear visit_id once its visit is '
    'gone); a signed-in caller ties a follow-up only to a visit of the same patient; no writer, signed-in or not, writes the follow-up '
    'of a sealed visit (a delete passes only when the clinic is gone); a signed-in caller writes it only while the visit is reopened '
    'for amendment. 42501.';

-- 5. visit_revisions: append-only for every writer (R-7) -------------------------------------------------------------------------
CREATE FUNCTION private.visit_revisions_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'REVISION_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    -- DELETE: only a writer with no session, and only by the cascade of a tenant purge (R-4a). The visit FK is RESTRICT, so a visit
    -- with an amendment row cannot be deleted at all.
    IF (SELECT auth.uid()) IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN
        RAISE EXCEPTION 'REVISION_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.visit_revisions_append_only() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.visit_revisions_append_only() IS
    'V2-09a 09A-01 (R-7): an amendment revision is never updated, and deleted only by the cascade of a tenant purge (a writer with no '
    'session and no tenants row). 42501 REVISION_IMMUTABLE. The INSERT guard (visit_revisions_actor_guard) is unchanged.';
CREATE TRIGGER visit_revisions_append_only
    BEFORE UPDATE OR DELETE ON public.visit_revisions
    FOR EACH ROW EXECUTE FUNCTION private.visit_revisions_append_only();
