-- Migration: 000068_visit_integrity_expand.sql
-- V2-05 fix plan 05-11a step 1 (05a review triage: H-VISIT, M-ACTOR for visits/prescriptions/amendments, M-SIGNED,
-- M-DURATION, M-TOKEN, M-INVOICE doctor_id part). EXPAND: guards, NOT VALID constraints and the new token RPC. The
-- current app already writes only what these guards admit, so this migration is safe ahead of the app deploy.
--
-- Root cause (triage): the row policies are right, but the table-wide UPDATE grant on `visits` let any
-- `appointments:edit` holder (receptionist, nurse, doctor) write columns that belong to the clinician or to an RPC:
-- re-key a signed encounter to another patient, forge `signed_by`, un-sign and reopen it, or take a colleague's visit
-- (and with it the doctor's own-visit invoice access). Actor columns on prescriptions and amendments named any user.
--
-- 1. `private.visits_integrity_guard` (BEFORE INSERT OR UPDATE on visits, SECURITY INVOKER):
--    every path (service role and migrations included):
--      - `id`, `tenant_id`, `patient_id` never change (the encounter's notes, Rx and invoice follow the visit, so
--        re-keying it moves a patient's record to another patient: H-VISIT);
--      - a signed visit's `doctor_id` never changes (M-INVOICE);
--    a signed-in caller (auth.uid() set) additionally:
--      - INSERT: `created_by` = the caller; the visit is not inserted signed; `current_revision` stays 1;
--      - UPDATE: `created_by`, `created_at` never change; `current_revision` is written only by this guard;
--      - `doctor_id` of an unsigned visit changes only for a caller who already reads every invoice (`billing:view`:
--        owner, admin, receptionist) or holds no own-visit invoice access (no `consultations:edit`: nurse). A doctor
--        cannot take a colleague's visit (M-INVOICE, RLS L-1);
--      - `signed_at` / `signed_by` change only with `consultations:edit`, only to "signed now by the caller"
--        (`signed_by` = auth.uid(), `signed_at` set, status `completed`); a signature is never cleared, and an
--        existing one is replaced only when a reopened visit is finalized (H-VISIT);
--      - a signed visit's `status` changes only with `consultations:edit` and only along the amendment path:
--        `completed` -> `in_consultation` (reopen) needs a `visit_revisions` row written by the caller whose number is
--        at least `current_revision` (the guard then sets `current_revision` past it, so each reopen needs a new
--        amendment row); `in_consultation` -> `completed` (finalize) must re-sign as the caller. Nothing else.
-- 2. `visits_tenant_signed_by_fkey` (signed_by, tenant_id) -> memberships(user_id, tenant_id), NOT VALID: a signer is
--    a member of the visit's clinic (05-03 pattern, RESTRICT); validated by 000069 after diagnostic D5s.
-- 3. `visits_duration_range` CHECK (estimated_duration_minutes BETWEEN 5 AND 480) NOT VALID: a zero-length slot
--    overlaps nothing (it slipped past visits_no_double_booking), a negative one raised 22000 in visit_slot, and a
--    huge one blocked a doctor's calendar for years (M-DURATION). New writes are checked from here; 000069 clamps the
--    legacy rows and validates.
-- 4. `private.prescriptions_actor_guard` (BEFORE INSERT OR UPDATE on prescriptions, INVOKER), signed-in callers only:
--    INSERT `doctor_id` = the caller and `patient_id` = the visit's patient; UPDATE never changes `doctor_id`,
--    `visit_id`, `patient_id` (M-ACTOR, IND L2: the Rx PDF prints the prescriber's name and registration).
-- 5. `private.visit_revisions_actor_guard` (BEFORE INSERT on visit_revisions, INVOKER), signed-in callers only:
--    `amended_by` = the caller (refused otherwise); `amended_at` is stamped `now()` (M-ACTOR, RLS M-3).
-- 6. `public.clinical_notes_guard` (replaced body): a signed-in caller cannot write the notes (vitals included) of a
--    signed visit unless it is reopened for amendment (`status = 'in_consultation'`), the same rule as the app's
--    `isDraftLocked` (M-SIGNED). Full immutability stays V2-09a (R-21).
-- 7. `queue_tokens_token_range` CHECK (token_number BETWEEN 1 AND 9999) NOT VALID (M-TOKEN); 000069 validates.
-- 8. `public.issue_queue_token(p_visit_id, p_priority)`: SECURITY DEFINER; issues the visit's token AND inserts the
--    `queue_tokens` row in one statement sequence, so a member never writes `token_number` (000070 revokes the
--    INSERT privilege and the token_number/date UPDATE). A repeat check-in of the same visit returns its existing
--    token (`reused = true`) without advancing the counter (INT Info I-4). Same authorisation as next_queue_token
--    (visit's clinic = active clinic with appointments:edit, else 42501; no existence oracle). The counter refuses to
--    pass 9999 (54000), so one forged row can no longer push the day into integer overflow.
-- All refusals are SQLSTATE 42501 with a fixed message (lib/db/errors maps 42501 to FORBIDDEN).
-- Per-migration checklist: no new table; functions pin search_path '' with qualified names; trigger functions get no
-- EXECUTE grant; the definer RPC grants `authenticated` only; the new FK has a leading index (fk_indexes).

-- 1. visits guard -------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.visits_integrity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_sign_changed boolean;
    v_rev integer;
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
            SELECT max(r.revision_number) INTO v_rev
              FROM public.visit_revisions r
             WHERE r.tenant_id = OLD.tenant_id AND r.visit_id = OLD.id AND r.amended_by = v_uid;
            IF v_rev IS NULL OR v_rev < OLD.current_revision THEN
                RAISE EXCEPTION 'VISIT_REOPEN_NEEDS_AMENDMENT' USING ERRCODE = '42501';
            END IF;
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
    'V2-05 05-11a (H-VISIT, M-ACTOR, M-INVOICE): visits keys immutable; signed visit keeps its doctor; a signed-in '
    'caller signs only as itself with consultations:edit, never clears a signature, reopens only after writing an '
    'amendment row, and (as a doctor without billing:view) never reassigns doctor_id. 42501.';
CREATE TRIGGER visits_integrity_guard
    BEFORE INSERT OR UPDATE ON public.visits
    FOR EACH ROW EXECUTE FUNCTION private.visits_integrity_guard();

-- 2. Signer is a member of the visit's clinic -----------------------------------------------------------------------------
CREATE INDEX idx_visits_signed_by_tenant ON public.visits (signed_by, tenant_id);
ALTER TABLE public.visits
    ADD CONSTRAINT visits_tenant_signed_by_fkey FOREIGN KEY (signed_by, tenant_id)
    REFERENCES public.memberships (user_id, tenant_id) ON DELETE RESTRICT NOT VALID;

-- 3. Duration bounds ------------------------------------------------------------------------------------------------------
ALTER TABLE public.visits
    ADD CONSTRAINT visits_duration_range CHECK (estimated_duration_minutes BETWEEN 5 AND 480) NOT VALID;
COMMENT ON CONSTRAINT visits_duration_range ON public.visits IS
    'V2-05 05-11a (M-DURATION): a slot is 5 to 480 minutes; NOT VALID until 000069 clamps legacy rows.';

-- 4. Prescriber is the caller ---------------------------------------------------------------------------------------------
CREATE FUNCTION private.prescriptions_actor_guard()
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
    'V2-05 05-11a (M-ACTOR): a signed-in caller prescribes only as itself, for the visit''s own patient; doctor, visit '
    'and patient of a prescription never change. 42501.';
CREATE TRIGGER prescriptions_actor_guard
    BEFORE INSERT OR UPDATE ON public.prescriptions
    FOR EACH ROW EXECUTE FUNCTION private.prescriptions_actor_guard();

-- 5. Amendment author is the caller ---------------------------------------------------------------------------------------
CREATE FUNCTION private.visit_revisions_actor_guard()
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
    IF NEW.amended_by IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'AMENDMENT_AUTHOR_NOT_CALLER' USING ERRCODE = '42501';
    END IF;
    NEW.amended_at := now();
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.visit_revisions_actor_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.visit_revisions_actor_guard() IS
    'V2-05 05-11a (M-ACTOR): a signed-in caller writes amendment rows only as itself; amended_at is the database clock.';
CREATE TRIGGER visit_revisions_actor_guard
    BEFORE INSERT ON public.visit_revisions
    FOR EACH ROW EXECUTE FUNCTION private.visit_revisions_actor_guard();

-- 6. Notes of a signed visit are locked unless reopened ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clinical_notes_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.visit_id IS DISTINCT FROM OLD.visit_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
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
    IF NOT public.has_permission(NEW.tenant_id, 'consultations:edit')
       AND (to_jsonb(NEW) - 'vitals' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'vitals' - 'updated_at') THEN
      RAISE EXCEPTION 'CLINICAL_NOTES_VITALS_ONLY' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.clinical_notes_guard() IS
  'V2-05 05-02a/05-11a: BEFORE UPDATE on clinical_notes. visit_id/tenant_id never change; a signed-in caller cannot '
  'write the notes of a signed visit unless it is reopened (status in_consultation); without consultations:edit only '
  'vitals may change (42501); maintains updated_at.';

-- 7. Token range ----------------------------------------------------------------------------------------------------------
ALTER TABLE public.queue_tokens
    ADD CONSTRAINT queue_tokens_token_range CHECK (token_number BETWEEN 1 AND 9999) NOT VALID;
COMMENT ON CONSTRAINT queue_tokens_token_range ON public.queue_tokens IS
    'V2-05 05-11a (M-TOKEN): a token is 1 to 9999; NOT VALID until 000069 renumbers out-of-range legacy rows.';

-- 8. Token RPC that also writes the token row --------------------------------------------------------------------------
CREATE FUNCTION public.issue_queue_token(p_visit_id uuid, p_priority text DEFAULT 'normal')
RETURNS TABLE (queue_token_id uuid, token_number integer, token_date date, reused boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
    v_tenant uuid;
    v_date date;
    v_token integer;
    v_id uuid;
    v_existing record;
BEGIN
    SELECT v.tenant_id INTO v_tenant FROM public.visits v WHERE v.id = p_visit_id;

    IF v_tenant IS NULL OR NOT public.has_permission(v_tenant, 'appointments:edit') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- Serialise check-ins of the same visit: the second of two concurrent calls sees the first one's token.
    PERFORM 1 FROM public.visits v WHERE v.id = p_visit_id FOR NO KEY UPDATE;

    SELECT q.id, q.token_number, q.date INTO v_existing
      FROM public.queue_tokens q WHERE q.tenant_id = v_tenant AND q.visit_id = p_visit_id;
    IF FOUND THEN
        RETURN QUERY SELECT v_existing.id, v_existing.token_number, v_existing.date, true;
        RETURN;
    END IF;

    v_date := public.tenant_local_date(v_tenant, now());

    INSERT INTO public.queue_token_counters AS c (tenant_id, date, last_token)
    VALUES (
        v_tenant,
        v_date,
        coalesce((SELECT max(q.token_number) FROM public.queue_tokens q
                   WHERE q.tenant_id = v_tenant AND q.date = v_date), 0) + 1
    )
    ON CONFLICT (tenant_id, date) DO UPDATE
        SET last_token = greatest(
                c.last_token,
                coalesce((SELECT max(q.token_number) FROM public.queue_tokens q
                           WHERE q.tenant_id = v_tenant AND q.date = v_date), 0)
            ) + 1,
            updated_at = now()
    RETURNING c.last_token INTO v_token;

    IF v_token > 9999 THEN
        RAISE EXCEPTION 'QUEUE_TOKENS_EXHAUSTED' USING ERRCODE = '54000';
    END IF;

    INSERT INTO public.queue_tokens AS q (tenant_id, visit_id, date, token_number, priority)
    VALUES (v_tenant, p_visit_id, v_date, v_token, coalesce(p_priority, 'normal'))
    RETURNING q.id INTO v_id;

    RETURN QUERY SELECT v_id, v_token, v_date, false;
END;
$$;

COMMENT ON FUNCTION public.issue_queue_token(uuid, text) IS
    'Check-in token of a visit: the existing one (reused) or the next of the clinic-local day, with its queue_tokens row; '
    'appointments:edit in the active clinic, else 42501 (V2-05 05-11a, M-TOKEN; R-18).';

REVOKE ALL ON FUNCTION public.issue_queue_token(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.issue_queue_token(uuid, text) TO authenticated;
