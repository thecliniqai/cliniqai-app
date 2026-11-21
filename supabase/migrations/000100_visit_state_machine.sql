-- Migration: 000100_visit_state_machine.sql
-- V2-08 08-01b (R-1, R-7, R-8): the visit state machine in the database, and the two desk commands that need it.
--
-- Before: any writer with UPDATE on `visits` could set `status` to anything (the queue's transition service, the calendar's
-- status setter, a script): a cancelled visit could be completed, a booked visit could skip the queue, "Start Consultation"
-- on a booked visit left it unsignable (07-04a F-6). A check-in accepted a booking of any day, and a no-show that arrived
-- late could not be checked in at all.
--
-- 1. private.visit_transition_allowed(from, to, signed): the R-7 table, IMMUTABLE. private.visits_status_transition_guard():
--    BEFORE UPDATE OF status ON visits (only when the status changes) refuses every pair the table does not list with
--    VISIT_TRANSITION_INVALID (P0001), for every writer including the service role. The signed reopen
--    (completed -> in_consultation) is allowed only for a signed visit; visits_integrity_guard (000077) still demands the
--    amendment snapshot for it. A no-op write of the same status is not a transition (the guard's WHEN clause).
-- 2. private.step_check_in (replaced): R-8. A booked, confirmed or no-show visit with an appointment time must have it on the
--    clinic-local today (VISIT_NOT_TODAY, P0001; walk-ins have no appointment time); a no-show that arrives late is checked
--    in (no_show -> waiting, audit metadata late_arrival). Signature, grants and the rest of the body are unchanged.
-- 3. public.start_consultation(tenant, visit, client_request_id): R-1. Runs private.step_check_in when the visit is booked,
--    confirmed, no-show or waiting (a waiting visit reuses its token), then moves it to in_consultation, stamps the token's
--    called_at and writes the visit.consultation_start audit row, in one transaction. An already started visit answers
--    already_started with no second audit row. consultations:edit and appointments:edit.
-- 4. public.complete_visit(tenant, visit, client_request_id): desk completion of an unsigned waiting or in_consultation visit
--    (appointments:edit); stamps the token's completed_at; visit.complete_at_desk audit row. A visit that is already
--    completed answers already_completed (the checkout after sign-off) and only stamps a missing completed_at.
-- 5. private.log_command_audit (replaced) admits the two new command-only actions; private.audit_metadata_keys (replaced)
--    gains late_arrival (parity with lib/audit/audit.ts AUDIT_METADATA_KEYS, tests/audit/log-audit-allowlist.spec.ts).
--    public.log_audit refuses the two actions: they are not in private.audit_client_actions().
-- Per-migration checklist: two new public definer commands (EXECUTE: authenticated only; no system path), one new private
-- invoker function (visit_transition_allowed), one new private definer trigger function (visits_status_transition_guard: it
-- calls the private function, which the writer's role cannot execute), one new trigger on public.visits; function bodies replaced with unchanged signatures and grants: step_check_in,
-- log_command_audit, audit_metadata_keys. No table, column, policy or data change; contract-side for writers: the previous
-- app build's transitionQueueState keeps working for the pairs the table allows and gets VISIT_TRANSITION_INVALID otherwise.

-- 1. The state machine ---------------------------------------------------------------------------------------------------
CREATE FUNCTION private.visit_transition_allowed(p_from text, p_to text, p_signed boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT coalesce(
        CASE p_from
            WHEN 'booked' THEN p_to IN ('confirmed', 'waiting', 'booked', 'no_show', 'cancelled')
            WHEN 'confirmed' THEN p_to IN ('waiting', 'booked', 'no_show', 'cancelled')
            WHEN 'no_show' THEN p_to IN ('waiting', 'booked')
            WHEN 'waiting' THEN p_to IN ('in_consultation', 'completed', 'cancelled')
            WHEN 'in_consultation' THEN p_to = 'completed'
            WHEN 'completed' THEN p_to = 'in_consultation' AND coalesce(p_signed, false)
            ELSE false
        END,
        false)
$$;
REVOKE ALL ON FUNCTION private.visit_transition_allowed(text, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.visit_transition_allowed(text, text, boolean) IS
    'V2-08 08-01b (R-7): the visit state machine. booked -> confirmed, waiting, booked (reschedule), no_show, cancelled; confirmed -> waiting, booked, no_show, cancelled; no_show -> waiting (late arrival), booked (rebook); waiting -> in_consultation, completed, cancelled; in_consultation -> completed; completed -> in_consultation only when signed (the amendment reopen). Everything else is false. Mirrored by features/visits/state-machine.ts (parity: tests/visits/state-machine.spec.ts).';

CREATE FUNCTION private.visits_status_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT private.visit_transition_allowed(OLD.status, NEW.status, OLD.signed_at IS NOT NULL) THEN
        RAISE EXCEPTION 'VISIT_TRANSITION_INVALID' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.visits_status_transition_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.visits_status_transition_guard() IS
    'V2-08 08-01b (R-7): refuses a visits.status change the state machine does not list (VISIT_TRANSITION_INVALID, P0001) for every writer; a write that leaves the status unchanged is not checked.';

CREATE TRIGGER visits_status_transition_guard
    BEFORE UPDATE OF status ON public.visits
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION private.visits_status_transition_guard();

-- 2. step: check a visit in (R-8) -----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.step_check_in(p_tenant_id uuid, p_visit_id uuid, p_priority text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_visit record;
    v_tok record;
    v_token_priority text;
    v_repaired boolean := false;
    v_late boolean;
BEGIN
    SELECT v.status, v.scheduled_at INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- A finished or cancelled visit is never queued again; a no-show that arrives late is (R-8).
    IF v_visit.status NOT IN ('booked', 'confirmed', 'no_show', 'waiting', 'in_consultation') THEN
        RAISE EXCEPTION 'VISIT_NOT_CHECKABLE' USING ERRCODE = 'P0001';
    END IF;
    -- R-8: a booking is checked in on its own day (the clinic's zone, as issue_queue_token). A walk-in has no appointment
    -- time; a visit that is already queued or in consultation is not asked again.
    v_late := v_visit.status = 'no_show';
    IF v_visit.status IN ('booked', 'confirmed', 'no_show') AND v_visit.scheduled_at IS NOT NULL
       AND public.tenant_local_date(p_tenant_id, v_visit.scheduled_at) IS DISTINCT FROM public.tenant_local_date(p_tenant_id, now()) THEN
        RAISE EXCEPTION 'VISIT_NOT_TODAY' USING ERRCODE = 'P0001';
    END IF;

    -- The token: the visit's existing one (reused) or the next of the clinic-local day (V2-05 05-11a, M-TOKEN).
    SELECT t.queue_token_id, t.token_number, t.reused INTO v_tok
      FROM public.issue_queue_token(p_visit_id, p_priority) t;

    -- A visit that holds a token but never became `waiting` (the old chain's partial write) is repaired here.
    IF v_visit.status IN ('booked', 'confirmed', 'no_show') THEN
        UPDATE public.visits SET status = 'waiting', updated_at = now()
         WHERE id = p_visit_id AND tenant_id = p_tenant_id;
        v_repaired := true;
    END IF;

    SELECT q.priority INTO v_token_priority FROM public.queue_tokens q WHERE q.id = v_tok.queue_token_id;

    -- A repeat check-in of a visit that is already queued changes nothing and writes no second audit row.
    IF NOT v_tok.reused OR v_repaired THEN
        PERFORM private.log_command_audit(p_tenant_id, 'queue.check_in', 'queue_token', v_tok.queue_token_id,
                                 jsonb_build_object('token_number', v_tok.token_number, 'priority', v_token_priority)
                                 || CASE WHEN v_late THEN jsonb_build_object('late_arrival', true) ELSE '{}'::jsonb END);
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
    'V2-07 07-01 (R-7), V2-08 08-01b (R-8): the check-in body shared by check_in_visit, enqueue_walk_in and start_consultation: lock the visit, refuse a completed or cancelled one (VISIT_NOT_CHECKABLE), refuse a booked, confirmed or no-show visit whose appointment is not on the clinic-local today (VISIT_NOT_TODAY), issue or reuse its token (public.issue_queue_token), move a booked, confirmed or no-show visit to waiting (also when it already holds a token; a no-show is a late arrival), queue.check_in audit row (late_arrival for a no-show). The caller has checked actor, clinic and appointments:edit and holds the command claim; no API grant.';

COMMENT ON FUNCTION public.check_in_visit(uuid, uuid, text, uuid) IS
    'V2-07 07-01 (R-1), V2-08 08-01b (R-8): checks a visit in in one transaction: its queue token (the existing one, or the next of the clinic-local day), the visit moved to waiting (a visit that holds a token but is still booked/confirmed is repaired; a no-show that arrives late is checked in), the queue.check_in audit row. appointments:edit. VISIT_NOT_CHECKABLE (P0001) for a completed or cancelled visit; VISIT_NOT_TODAY (P0001) for a booking of another clinic-local day. Idempotent by p_client_request_id. Result: visit_id, queue_token_id, token_number, priority, reused, status_repaired, replayed.';

-- 5. audit allow-lists --------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.audit_metadata_keys()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT ARRAY[
        'amendment_reason', 'consent_type', 'correlation_id', 'dose_form', 'erased_at', 'fields_changed',
        'follow_up_date', 'format', 'invoice_id', 'invoice_number', 'is_chronic', 'is_custom', 'is_initial_grant',
        'is_overbooked', 'items_count', 'late_arrival', 'letterhead_mode', 'new_status', 'old_status', 'origin_type',
        'patient_consents_history_sharing', 'payment_method', 'priority', 'promoted_from_waitlist_id',
        'promoted_visit_id', 'reason', 'referral_type', 'retention_policy', 'revision_number', 'specialty', 'status',
        'storage_path', 'target_date', 'target_tenant_id', 'template_name', 'token_number', 'total_amount', 'urgency',
        'version', 'view_context'
    ]::TEXT[];
$$;
REVOKE ALL ON FUNCTION private.audit_metadata_keys() FROM PUBLIC, anon, authenticated, service_role;

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
                                            'visit.consultation_start', 'visit.complete_at_desk')
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
    'V2-07 07-04a (F-1), V2-08 08-01b: writes an audit row as the session user for the seven actions only a command writes (visit.complete_and_sign, visit.reopen_for_amendment, visit.amend_finalized, invoice.create, queue.check_in, visit.consultation_start, visit.complete_at_desk), with log_audit''s metadata rules. The active clinic and a membership are required. No API grant: public.log_audit refuses these actions.';

-- 3. start_consultation (R-1) ---------------------------------------------------------------------------------------------------
CREATE FUNCTION public.start_consultation(p_tenant_id uuid, p_visit_id uuid, p_client_request_id uuid)
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
    v_check jsonb;
    v_token integer;
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

    -- 4. Lock the visit (commands on one visit run one after the other: the second of two starts sees the first).
    SELECT v.status INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF v_visit.status = 'in_consultation' THEN
        SELECT q.token_number INTO v_token FROM public.queue_tokens q WHERE q.tenant_id = p_tenant_id AND q.visit_id = p_visit_id;
        v_result := jsonb_build_object('visit_id', p_visit_id, 'token_number', v_token, 'already_started', true, 'replayed', false);
        RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
    END IF;

    -- 5. Check in first (booked, confirmed, no-show, or waiting without a token; refuses completed, cancelled and another
    --    day's booking), then open the consult: the visit never stays checked in without having started.
    v_check := private.step_check_in(p_tenant_id, p_visit_id, 'normal');
    UPDATE public.visits SET status = 'in_consultation', updated_at = now()
     WHERE id = p_visit_id AND tenant_id = p_tenant_id;
    UPDATE public.queue_tokens SET called_at = now()
     WHERE tenant_id = p_tenant_id AND visit_id = p_visit_id AND called_at IS NULL;
    v_token := (v_check ->> 'token_number')::integer;

    PERFORM private.log_command_audit(p_tenant_id, 'visit.consultation_start', 'visit', p_visit_id,
                             jsonb_build_object('token_number', v_token));

    v_result := jsonb_build_object('visit_id', p_visit_id, 'token_number', v_token, 'already_started', false, 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.start_consultation(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.start_consultation(uuid, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.start_consultation(uuid, uuid, uuid) IS
    'V2-08 08-01b (R-1): "Start Consultation" in one transaction: a booked, confirmed, no-show or token-less waiting visit is checked in first (private.step_check_in: token, waiting, queue.check_in audit row), then moved to in_consultation with the token''s called_at and the visit.consultation_start audit row. consultations:edit and appointments:edit. VISIT_NOT_CHECKABLE (completed, cancelled) and VISIT_NOT_TODAY (another day) are P0001. A visit already in consultation answers already_started with no second audit row. Idempotent by p_client_request_id. Result: visit_id, token_number, already_started, replayed.';

-- 4. complete_visit -------------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.complete_visit(p_tenant_id uuid, p_visit_id uuid, p_client_request_id uuid)
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
    v_already boolean := false;
    v_result jsonb;
BEGIN
    -- 1. Actor.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then appointments:edit there.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'appointments:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim.
    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.complete_visit',
                                      private.command_request_hash(jsonb_build_object('visit', p_visit_id)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the visit and decide.
    SELECT v.status, v.signed_at INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF v_visit.status = 'completed' THEN
        -- The checkout after a sign-off: nothing to move, only the queue token's completion time.
        v_already := true;
    ELSIF v_visit.status IN ('waiting', 'in_consultation') AND v_visit.signed_at IS NULL THEN
        UPDATE public.visits SET status = 'completed', updated_at = now()
         WHERE id = p_visit_id AND tenant_id = p_tenant_id;
        PERFORM private.log_command_audit(p_tenant_id, 'visit.complete_at_desk', 'visit', p_visit_id,
                                 jsonb_build_object('old_status', v_visit.status, 'new_status', 'completed'));
    ELSE
        -- booked, confirmed, no-show and cancelled never complete at the desk; a reopened amendment finishes through
        -- finalize_visit_amendment.
        RAISE EXCEPTION 'VISIT_NOT_COMPLETABLE' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.queue_tokens SET completed_at = now()
     WHERE tenant_id = p_tenant_id AND visit_id = p_visit_id AND completed_at IS NULL;

    v_result := jsonb_build_object('visit_id', p_visit_id, 'already_completed', v_already, 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_visit(uuid, uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_visit(uuid, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.complete_visit(uuid, uuid, uuid) IS
    'V2-08 08-01b: desk completion in one transaction: an unsigned waiting or in_consultation visit becomes completed, its queue token gets completed_at, visit.complete_at_desk audit row. appointments:edit. A visit that is already completed answers already_completed and only stamps a missing completed_at. VISIT_NOT_COMPLETABLE (P0001) for booked, confirmed, no-show, cancelled and a reopened signed visit. Idempotent by p_client_request_id. Result: visit_id, already_completed, replayed.';
