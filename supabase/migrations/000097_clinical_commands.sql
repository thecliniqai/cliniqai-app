-- Migration: 000097_clinical_commands.sql
-- V2-07 07-01 (R-1, R-2, R-3, R-4): the clinical write path as atomic server commands.
--
-- Before: sign-off ran seven round trips (claim the visit, seal the prescriptions, audit, two webhook enqueues whose errors
-- were swallowed), the amendment pair wrote the revision, the visit and the prescription as separate statements (the
-- finalize prescription update had its error unchecked) and check-in issued the token, then moved the visit to `waiting`
-- with its error unchecked. A failure in the middle left a signed visit with an unsealed prescription, a lost webhook, a
-- revision without a reopen, a prescription version bumped without a re-sign, or a token on a visit that never became
-- `waiting` (and the retry returned the token and skipped the fix).
--
-- 1. private.step_sign_consultation(tenant, visit): the one sign-off body. Locks the visit, refuses a signed one
--    (ALREADY_SIGNED) and one with neither a diagnosis nor a clinical note (SIGN_CONTENT_REQUIRED), signs the visit,
--    seals every active prescription, writes the visit.complete_and_sign audit row and the `visit.completed` and
--    `prescription.issued` outbox rows (the subject builder and event keys are the ones public.enqueue_webhook_event
--    uses: private.webhook_event_subject + private.enqueue_webhook_internal). 07-03 complete_and_bill reuses it.
-- 2. private.step_check_in(tenant, visit, priority): the token (public.issue_queue_token, the existing counter logic) and
--    the visit's `waiting` status in one body, plus the queue.check_in audit row. A visit that already holds a token but
--    is still booked/confirmed is repaired (status set), which the old chain never did. 07-03 enqueue_walk_in reuses it.
-- 3. public.sign_consultation, public.reopen_visit_for_amendment, public.finalize_visit_amendment, public.check_in_visit:
--    the commands. R-1: SECURITY DEFINER with the record_payment guard block (actor, active clinic, has_permission),
--    because sign-off writes the webhook outbox (private.enqueue_webhook_internal is not executable by `authenticated`),
--    and amendment/check-in write guarded, actor-bound tables (visits, visit_revisions, queue_tokens through the token
--    function) whose guard triggers read auth.uid() and keep working because the session is unchanged. Each takes a
--    command claim (R-2), locks the visit, checks the invariants as P0001 machine reasons, writes, audits in the same
--    transaction and completes the claim. No system path: service_role is revoked.
-- PDF rendering and the storage archive stay after commit in the app (R-4).
-- Per-migration checklist: four new public definer commands (EXECUTE: authenticated only), two private step functions
-- with no API grant. No table, column, policy or data change; expand-safe (nothing is dropped; the previous app build
-- keeps working because the tables, triggers and issue_queue_token are untouched).

-- 1. step: sign a consultation ----------------------------------------------------------------------------------------------
CREATE FUNCTION private.step_sign_consultation(p_tenant_id uuid, p_visit_id uuid)
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

    -- The signer is the session's user; visits_integrity_guard sets signed_at to the database clock (NF-5).
    UPDATE public.visits
       SET status = 'completed', signed_at = now(), signed_by = v_uid, updated_at = now()
     WHERE id = p_visit_id AND tenant_id = p_tenant_id
    RETURNING signed_at INTO v_signed_at;

    -- Seal every active prescription of the visit.
    WITH sealed AS (
        UPDATE public.prescriptions
           SET signed_at = now(), updated_at = now()
         WHERE visit_id = p_visit_id AND tenant_id = p_tenant_id AND status = 'active'
        RETURNING id
    )
    SELECT coalesce(array_agg(s.id ORDER BY s.id), ARRAY[]::uuid[]) INTO v_rx_ids FROM sealed s;

    PERFORM public.log_audit(p_tenant_id, 'visit.complete_and_sign', 'visit', p_visit_id,
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
    'V2-07 07-01 (R-7): the sign-off body shared by sign_consultation and (07-03) complete_and_bill: lock the visit, refuse a signed visit (ALREADY_SIGNED) or one without a diagnosis or clinical note (SIGN_CONTENT_REQUIRED), sign it as the session user, seal the active prescriptions, write the visit.complete_and_sign audit row and the visit.completed / prescription.issued outbox rows. The caller has checked actor, clinic and consultations:edit and holds the command claim; no API grant.';

-- 2. step: check a visit in -------------------------------------------------------------------------------------------------
CREATE FUNCTION private.step_check_in(p_tenant_id uuid, p_visit_id uuid, p_priority text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_status text;
    v_tok record;
    v_token_priority text;
    v_repaired boolean := false;
BEGIN
    SELECT v.status INTO v_status
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- A finished or cancelled visit is never queued again.
    IF v_status NOT IN ('booked', 'confirmed', 'waiting', 'in_consultation') THEN
        RAISE EXCEPTION 'VISIT_NOT_CHECKABLE' USING ERRCODE = 'P0001';
    END IF;

    -- The token: the visit's existing one (reused) or the next of the clinic-local day (V2-05 05-11a, M-TOKEN).
    SELECT t.queue_token_id, t.token_number, t.reused INTO v_tok
      FROM public.issue_queue_token(p_visit_id, p_priority) t;

    -- A visit that holds a token but never became `waiting` (the old chain's partial write) is repaired here.
    IF v_status IN ('booked', 'confirmed') THEN
        UPDATE public.visits SET status = 'waiting', updated_at = now()
         WHERE id = p_visit_id AND tenant_id = p_tenant_id;
        v_repaired := true;
    END IF;

    SELECT q.priority INTO v_token_priority FROM public.queue_tokens q WHERE q.id = v_tok.queue_token_id;

    -- A repeat check-in of a visit that is already queued changes nothing and writes no second audit row.
    IF NOT v_tok.reused OR v_repaired THEN
        PERFORM public.log_audit(p_tenant_id, 'queue.check_in', 'queue_token', v_tok.queue_token_id,
                                 jsonb_build_object('token_number', v_tok.token_number, 'priority', v_token_priority));
    END IF;

    RETURN jsonb_build_object(
        'visit_id', p_visit_id,
        'queue_token_id', v_tok.queue_token_id,
        'token_number', v_tok.token_number,
        'priority', v_token_priority,
        'reused', v_tok.reused,
        'status_repaired', v_repaired AND v_tok.reused
    );
END;
$$;
REVOKE ALL ON FUNCTION private.step_check_in(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.step_check_in(uuid, uuid, text) IS
    'V2-07 07-01 (R-7): the check-in body shared by check_in_visit and (07-03) enqueue_walk_in: lock the visit, refuse a completed/cancelled/no-show one (VISIT_NOT_CHECKABLE), issue or reuse its token (public.issue_queue_token), move a booked/confirmed visit to waiting (also when it already holds a token), queue.check_in audit row. The caller has checked actor, clinic and appointments:edit and holds the command claim; no API grant.';

-- 3a. sign_consultation ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.sign_consultation(p_tenant_id uuid, p_visit_id uuid, p_client_request_id uuid)
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
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim; a replay returns the first result and writes nothing.
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.sign_consultation',
                                      md5(jsonb_build_object('visit', p_visit_id)::text));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock, invariants, writes, audit, outbox (the shared step), result.
    v_result := private.step_sign_consultation(p_tenant_id, p_visit_id) || jsonb_build_object('replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.sign_consultation(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.sign_consultation(uuid, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.sign_consultation(uuid, uuid, uuid) IS
    'V2-07 07-01 (R-1): signs a consultation in one transaction: visit completed and signed by the caller, active prescriptions sealed, visit.complete_and_sign audit row, visit.completed and prescription.issued outbox rows. consultations:edit. ALREADY_SIGNED, SIGN_CONTENT_REQUIRED (P0001). Idempotent by p_client_request_id. Result: visit_id, signed_at, sealed_prescriptions, replayed.';

-- 3b. reopen_visit_for_amendment ------------------------------------------------------------------------------------------------
CREATE FUNCTION public.reopen_visit_for_amendment(p_tenant_id uuid, p_visit_id uuid, p_reason text, p_client_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_reason text := btrim(p_reason);
    v_replay jsonb;
    v_visit record;
    v_revision integer;
    v_result jsonb;
BEGIN
    -- 1. Actor.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then consultations:edit there.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'consultations:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    -- Input: the reason is recorded for the medical audit (at least 10 characters) and is part of the audit row, whose
    -- values are bounded at 500 characters.
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 10 AND 500 THEN
        RAISE EXCEPTION 'AMENDMENT_REASON_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim.
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.reopen_visit_for_amendment',
                                      md5(jsonb_build_object('visit', p_visit_id, 'reason', v_reason)::text));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the visit; it must be signed and completed (an amendment records a signed version, NF-1).
    SELECT v.status, v.signed_at INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_visit.status IS DISTINCT FROM 'completed' OR v_visit.signed_at IS NULL THEN
        RAISE EXCEPTION 'VISIT_NOT_SIGNED' USING ERRCODE = 'P0001';
    END IF;

    -- 5. Writes. The revision's number and snapshot are filled by the database under the visit lock
    --    (visit_revisions_actor_guard); the reopen is admitted only after this caller's snapshot row (visits_integrity_guard).
    INSERT INTO public.visit_revisions (tenant_id, visit_id, amended_by, amendment_reason)
    VALUES (p_tenant_id, p_visit_id, v_uid, v_reason)
    RETURNING revision_number INTO v_revision;

    UPDATE public.visits SET status = 'in_consultation', updated_at = now()
     WHERE id = p_visit_id AND tenant_id = p_tenant_id;

    PERFORM public.log_audit(p_tenant_id, 'visit.reopen_for_amendment', 'visit', p_visit_id,
                             jsonb_build_object('revision_number', v_revision, 'amendment_reason', v_reason));

    v_result := jsonb_build_object('visit_id', p_visit_id, 'revision_number', v_revision, 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.reopen_visit_for_amendment(uuid, uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reopen_visit_for_amendment(uuid, uuid, text, uuid) TO authenticated;
COMMENT ON FUNCTION public.reopen_visit_for_amendment(uuid, uuid, text, uuid) IS
    'V2-07 07-01 (R-1): reopens a signed, completed visit for amendment in one transaction: the revision row (database number and snapshot), the visit back to in_consultation, the visit.reopen_for_amendment audit row. consultations:edit. AMENDMENT_REASON_INVALID (10-500 characters), VISIT_NOT_SIGNED (P0001). Idempotent by p_client_request_id. Result: visit_id, revision_number, replayed.';

-- 3c. finalize_visit_amendment ----------------------------------------------------------------------------------------------------
CREATE FUNCTION public.finalize_visit_amendment(p_tenant_id uuid, p_visit_id uuid, p_client_request_id uuid)
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
BEGIN
    -- 1. Actor.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then consultations:edit there.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'consultations:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim.
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.finalize_visit_amendment',
                                      md5(jsonb_build_object('visit', p_visit_id)::text));
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

    PERFORM public.log_audit(p_tenant_id, 'visit.amend_finalized', 'visit', p_visit_id,
                             jsonb_build_object('version', v_version, 'amendment_reason', left(v_reason, 500)));

    v_result := jsonb_build_object('visit_id', p_visit_id, 'version', v_version, 'amendment_reason', v_reason,
                                   'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_visit_amendment(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_visit_amendment(uuid, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.finalize_visit_amendment(uuid, uuid, uuid) IS
    'V2-07 07-01 (R-1): finalizes a reopened amendment in one transaction: the latest prescription gets the next version, the amendment reason and a new signature, the visit is re-signed as completed, the visit.amend_finalized audit row. consultations:edit. AMENDMENT_NOT_OPEN (P0001) unless the visit is signed and reopened. Idempotent by p_client_request_id. Result: visit_id, version, amendment_reason, replayed.';

-- 3d. check_in_visit -------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.check_in_visit(p_tenant_id uuid, p_visit_id uuid, p_priority text, p_client_request_id uuid)
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
    -- 2. Active clinic, then appointments:edit there (the front desk, doctors and nurses).
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'appointments:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_visit_id IS NULL OR p_priority IS NULL OR p_priority NOT IN ('normal', 'urgent', 'vip') THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim.
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.check_in_visit',
                                      md5(jsonb_build_object('visit', p_visit_id, 'priority', p_priority)::text));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock, invariants, token, status, audit (the shared step), result.
    v_result := private.step_check_in(p_tenant_id, p_visit_id, p_priority) || jsonb_build_object('replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.check_in_visit(uuid, uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.check_in_visit(uuid, uuid, text, uuid) TO authenticated;
COMMENT ON FUNCTION public.check_in_visit(uuid, uuid, text, uuid) IS
    'V2-07 07-01 (R-1): checks a visit in in one transaction: its queue token (the existing one, or the next of the clinic-local day), the visit moved to waiting (a visit that holds a token but is still booked/confirmed is repaired), the queue.check_in audit row. appointments:edit. VISIT_NOT_CHECKABLE (P0001) for a completed, cancelled or no-show visit. Idempotent by p_client_request_id. Result: visit_id, queue_token_id, token_number, priority, reused, status_repaired, replayed.';
