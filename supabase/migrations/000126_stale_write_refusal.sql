-- Migration: 000126_stale_write_refusal.sql
-- V2-09e 09E-07 (R-19, R-17; decision 6): a queue or billing edit made from a screen that is behind the database is refused with ROW_CHANGED (P0001), writing nothing.
--
-- Ten commands are dropped and created again from their latest bodies (000099, 000100/000106, 000103, 000112, 000096/000099, 000072/000096; the live definitions were read from the
-- local stack after 000125) with ONE new parameter last, DEFAULT NULL (R-17: no overload is left, a named call without it still resolves while the running app deploys; the
-- database migrates first). NULL means "no version known": nothing is compared and the behaviour is exactly the previous one (API callers, system paths, the consult screen).
--   on visits.row_version (000123), p_expected_version:  check_in_visit, start_consultation, complete_visit, mark_no_show, cancel_visit, reschedule_visit, confirm_appointment,
--                                                        complete_and_bill (the sign-off screen reads no version yet; see 09E-NOTES);
--   on invoices.row_version, p_expected_invoice_version: collect_payment (compared against the visit's live invoice; a version given when there is none is refused too),
--                                                        record_payment.
-- Order inside every command, unchanged except for the one new step: actor, then the active clinic, then the permission, then input; the request-id claim (a replay answers its
-- STORED result whatever the version); the existing row lock (visit, or invoice for record_payment; the shared steps lock again, a no-op); then ROW_CHANGED when the version
-- differs, before any write, audit row or outbox row; then the unchanged body. (record_payment has no claim: its replay by command id sits after the lock and before the compare.)
-- A refusal rolls the whole transaction back, so the claim row goes with it and the same request id may be sent again with the version the screen then shows.
-- Each result gains the new version: row_version (visit commands, and complete_and_bill with invoice_version), invoice_version (collect_payment, record_payment).
-- Not changed: create_invoice and enqueue_walk_in (they create), promote_waitlist_entry (its slot check decides), the invoice-item table writes (V2-10), the request hash (the version is
-- not part of it: a retry of the same request with another version is a replay, not a mismatch).
-- Deadlock order (09E-04 note): every command still takes visit, then queue/invoice rows, in one direction; the new compare takes no lock the body did not already take.
-- Per-migration checklist: grants unchanged (EXECUTE authenticated; record_payment also service_role, as before); no table, column, policy or trigger change.

-- check_in_visit
DROP FUNCTION public.check_in_visit(uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.check_in_visit(p_tenant_id uuid, p_visit_id uuid, p_priority text, p_client_request_id uuid, p_expected_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
DECLARE
    v_row_version bigint;
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
                                      private.command_request_hash(jsonb_build_object('visit', p_visit_id, 'priority', p_priority)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4a. Stale-write refusal (09E-07, R-19): the visit is locked here (the shared step locks it again, a no-op) and its version compared before
    --     any write; a replay was answered above, whatever the version.
    IF p_expected_version IS NOT NULL THEN
        SELECT v.row_version INTO v_row_version
          FROM public.visits v
         WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
           FOR NO KEY UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
        END IF;
        IF v_row_version IS DISTINCT FROM p_expected_version THEN
            RAISE EXCEPTION 'ROW_CHANGED' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 4. Lock, invariants, token, status, audit (the shared step), result.
    v_result := private.step_check_in(p_tenant_id, p_visit_id, p_priority);
    SELECT v.row_version INTO v_row_version FROM public.visits v WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id;
    v_result := v_result || jsonb_build_object('replayed', false, 'row_version', v_row_version);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$function$
;

REVOKE ALL ON FUNCTION public.check_in_visit(uuid, uuid, text, uuid, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.check_in_visit(uuid, uuid, text, uuid, bigint) TO authenticated;
COMMENT ON FUNCTION public.check_in_visit(uuid, uuid, text, uuid, bigint) IS
    $c$V2-07 07-01 (R-1), V2-08 08-01b (R-8): checks a visit in in one transaction: its queue token (the existing one, or the next of the clinic-local day), the visit moved to waiting (a visit that holds a token but is still booked/confirmed is repaired; a no-show that arrives late is checked in), the queue.check_in audit row. appointments:edit. VISIT_NOT_CHECKABLE (P0001) for a completed or cancelled visit; VISIT_NOT_TODAY (P0001) for a booking of another clinic-local day. Idempotent by p_client_request_id. Result: visit_id, queue_token_id, token_number, priority, reused, status_repaired, replayed. 09E-07 (R-19): p_expected_version (DEFAULT NULL) is compared with the locked visit's row_version after the request-id replay and before any write (ROW_CHANGED, P0001); the result gains row_version.$c$;

-- start_consultation
DROP FUNCTION public.start_consultation(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.start_consultation(p_tenant_id uuid, p_visit_id uuid, p_client_request_id uuid, p_expected_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
DECLARE
    v_row_version bigint;
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

    -- 4a. Stale-write refusal (09E-07, R-19): the visit is locked here (the shared step locks it again, a no-op) and its version compared before
    --     any write; a replay was answered above, whatever the version.
    IF p_expected_version IS NOT NULL THEN
        SELECT v.row_version INTO v_row_version
          FROM public.visits v
         WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
           FOR NO KEY UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
        END IF;
        IF v_row_version IS DISTINCT FROM p_expected_version THEN
            RAISE EXCEPTION 'ROW_CHANGED' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 4. Lock, check in, open the consult, audit (the shared step), result.
    v_result := private.step_start_consultation(p_tenant_id, p_visit_id);
    SELECT v.row_version INTO v_row_version FROM public.visits v WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id;
    v_result := v_result || jsonb_build_object('replayed', false, 'row_version', v_row_version);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$function$
;

REVOKE ALL ON FUNCTION public.start_consultation(uuid, uuid, uuid, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.start_consultation(uuid, uuid, uuid, bigint) TO authenticated;
COMMENT ON FUNCTION public.start_consultation(uuid, uuid, uuid, bigint) IS
    $c$V2-08 08-01b (R-1), V2-09b 09B-01: "Start Consultation" in one transaction: a booked, confirmed, no-show or token-less waiting visit is checked in first (private.step_check_in: token, waiting, queue.check_in audit row), then moved to in_consultation with the token's called_at and the visit.consultation_start audit row (the shared private.step_start_consultation). consultations:edit and appointments:edit. VISIT_NOT_CHECKABLE (completed, cancelled) and VISIT_NOT_TODAY (another day) are P0001. A visit already in consultation answers already_started with no second audit row. Idempotent by p_client_request_id. Result: visit_id, token_number, already_started, replayed. 09E-07 (R-19): p_expected_version (DEFAULT NULL) is compared with the locked visit's row_version after the request-id replay and before any write (ROW_CHANGED, P0001); the result gains row_version.$c$;

-- complete_visit
DROP FUNCTION public.complete_visit(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.complete_visit(p_tenant_id uuid, p_visit_id uuid, p_client_request_id uuid, p_expected_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
DECLARE
    v_row_version bigint;
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
    SELECT v.status, v.signed_at, v.row_version INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF p_expected_version IS NOT NULL AND v_visit.row_version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'ROW_CHANGED' USING ERRCODE = 'P0001';
    END IF;

    IF v_visit.status = 'completed' THEN
        -- The checkout after a sign-off: nothing to move, only the queue token's completion time.
        v_already := true;
    ELSIF v_visit.status = 'waiting' AND v_visit.signed_at IS NULL THEN
        UPDATE public.visits SET status = 'completed', updated_at = now()
         WHERE id = p_visit_id AND tenant_id = p_tenant_id;
        PERFORM private.log_command_audit(p_tenant_id, 'visit.complete_at_desk', 'visit', p_visit_id,
                                 jsonb_build_object('old_status', v_visit.status, 'new_status', 'completed'));
    ELSE
        -- booked, confirmed, no-show and cancelled never complete at the desk; an open consultation (000106, S-4) is completed
        -- by the sign-off commands only (a desk completion would leave it unsigned for good); a reopened amendment finishes
        -- through finalize_visit_amendment.
        RAISE EXCEPTION 'VISIT_NOT_COMPLETABLE' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.queue_tokens SET completed_at = now()
     WHERE tenant_id = p_tenant_id AND visit_id = p_visit_id AND completed_at IS NULL;

    SELECT v.row_version INTO v_row_version FROM public.visits v WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id;
    v_result := jsonb_build_object('visit_id', p_visit_id, 'already_completed', v_already, 'replayed', false, 'row_version', v_row_version);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$function$
;

REVOKE ALL ON FUNCTION public.complete_visit(uuid, uuid, uuid, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_visit(uuid, uuid, uuid, bigint) TO authenticated;
COMMENT ON FUNCTION public.complete_visit(uuid, uuid, uuid, bigint) IS
    $c$V2-08 08-01b, 08-06a (S-4): desk completion in one transaction: an unsigned waiting visit becomes completed, its queue token gets completed_at, visit.complete_at_desk audit row. appointments:edit. A visit that is already completed answers already_completed and only stamps a missing completed_at. VISIT_NOT_COMPLETABLE (P0001) for booked, confirmed, no-show, cancelled, an in_consultation visit (completed only by sign-off) and a reopened signed visit. Idempotent by p_client_request_id. Result: visit_id, already_completed, replayed. 09E-07 (R-19): p_expected_version (DEFAULT NULL) is compared with the locked visit's row_version after the request-id replay and before any write (ROW_CHANGED, P0001); the result gains row_version.$c$;

-- mark_no_show
DROP FUNCTION public.mark_no_show(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.mark_no_show(p_tenant_id uuid, p_visit_id uuid, p_client_request_id uuid, p_expected_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
DECLARE
    v_row_version bigint;
    v_uid uuid := auth.uid();
    v_replay jsonb;
    v_visit record;
    v_result jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'appointments:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.mark_no_show',
                                      private.command_request_hash(jsonb_build_object('visit', p_visit_id)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    SELECT v.status, v.scheduled_at, v.row_version INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF p_expected_version IS NOT NULL AND v_visit.row_version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'ROW_CHANGED' USING ERRCODE = 'P0001';
    END IF;
    IF v_visit.status NOT IN ('booked', 'confirmed') THEN
        RAISE EXCEPTION 'VISIT_NOT_MARKABLE' USING ERRCODE = 'P0001';
    END IF;
    -- Only once the appointment time has passed (R-7).
    IF v_visit.scheduled_at IS NULL OR v_visit.scheduled_at > now() THEN
        RAISE EXCEPTION 'NO_SHOW_TOO_EARLY' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.visits SET status = 'no_show', updated_at = now()
     WHERE id = p_visit_id AND tenant_id = p_tenant_id;
    PERFORM private.log_command_audit(p_tenant_id, 'visit.no_show', 'visit', p_visit_id,
                                      jsonb_build_object('old_status', v_visit.status, 'new_status', 'no_show'));

    SELECT v.row_version INTO v_row_version FROM public.visits v WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id;
    v_result := jsonb_build_object('visit_id', p_visit_id, 'replayed', false, 'row_version', v_row_version);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$function$
;

REVOKE ALL ON FUNCTION public.mark_no_show(uuid, uuid, uuid, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mark_no_show(uuid, uuid, uuid, bigint) TO authenticated;
COMMENT ON FUNCTION public.mark_no_show(uuid, uuid, uuid, bigint) IS
    $c$V2-08 08-04a (R-15): marks a booked or confirmed visit whose appointment time has passed as no_show, with the visit.no_show audit row. appointments:edit. NO_SHOW_TOO_EARLY (P0001) before the appointment time; VISIT_NOT_MARKABLE (P0001) for any other status. Idempotent by p_client_request_id. Result: visit_id, replayed. 09E-07 (R-19): p_expected_version (DEFAULT NULL) is compared with the locked visit's row_version after the request-id replay and before any write (ROW_CHANGED, P0001); the result gains row_version.$c$;

-- cancel_visit
DROP FUNCTION public.cancel_visit(uuid, uuid, text, uuid, text, boolean, boolean);

CREATE OR REPLACE FUNCTION public.cancel_visit(p_tenant_id uuid, p_visit_id uuid, p_reason_code text, p_client_request_id uuid, p_reason_note text DEFAULT NULL::text, p_notify boolean DEFAULT false, p_promote_waitlist boolean DEFAULT true, p_expected_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
DECLARE
    v_row_version bigint;
    v_uid uuid := auth.uid();
    v_note text := NULLIF(btrim(p_reason_note), '');
    v_notify boolean := coalesce(p_notify, false);
    v_promote boolean := coalesce(p_promote_waitlist, true);
    v_replay jsonb;
    v_visit record;
    v_tz text;
    v_promotion jsonb := jsonb_build_object('promoted', false);
    v_message jsonb := jsonb_build_object('enqueued', false);
    v_patient record;
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
    IF p_visit_id IS NULL OR p_reason_code IS NULL
       OR p_reason_code NOT IN ('patient_request', 'doctor_unavailable', 'clinic_closed', 'duplicate', 'other')
       OR char_length(v_note) > 500 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim.
    v_replay := private.command_claim(
        p_tenant_id, p_client_request_id, 'public.cancel_visit',
        private.command_request_hash(jsonb_build_object('visit', p_visit_id, 'reason', p_reason_code, 'note', v_note,
                                                        'notify', v_notify, 'promote', v_promote))
    );
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the visit and decide: booked, confirmed, or a waiting visit that leaves (R-7).
    SELECT v.status, v.scheduled_at, v.doctor_id, v.estimated_duration_minutes, v.patient_id, v.metadata, v.row_version
      INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF p_expected_version IS NOT NULL AND v_visit.row_version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'ROW_CHANGED' USING ERRCODE = 'P0001';
    END IF;
    IF v_visit.status NOT IN ('booked', 'confirmed', 'waiting') THEN
        RAISE EXCEPTION 'VISIT_NOT_CANCELLABLE' USING ERRCODE = 'P0001';
    END IF;
    SELECT t.timezone INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;

    -- 5. Cancel. The reason code is the one the webhook payload reads (metadata.cancellation_reason); the note stays on the
    --    visit and is never copied into a result or a message.
    UPDATE public.visits
       SET status = 'cancelled',
           metadata = coalesce(metadata, '{}'::jsonb)
                      || jsonb_build_object('cancellation_reason', p_reason_code, 'cancelled_by', v_uid::text,
                                            'cancelled_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
                      || CASE WHEN v_note IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('cancellation_note', v_note) END,
           updated_at = now()
     WHERE id = p_visit_id AND tenant_id = p_tenant_id;

    PERFORM private.log_command_audit(p_tenant_id, 'visit.cancel', 'visit', p_visit_id,
        jsonb_build_object('old_status', v_visit.status, 'new_status', 'cancelled', 'reason', p_reason_code));

    -- 6. The vacated slot goes to the waitlist (D-08): only a booking that still lies ahead has a slot to fill, and never when
    --    the doctor is away or the clinic is closed (000106, A-2).
    IF v_promote AND p_reason_code NOT IN ('doctor_unavailable', 'clinic_closed') AND v_visit.status IN ('booked', 'confirmed') AND v_visit.scheduled_at IS NOT NULL
       AND v_visit.scheduled_at > now() AND v_visit.doctor_id IS NOT NULL THEN
        v_promotion := private.step_promote_waitlist(p_tenant_id, v_visit.doctor_id, v_visit.scheduled_at,
                                                     coalesce(v_visit.estimated_duration_minutes, 15), v_tz);
    END IF;

    -- 7. The patient's message and the webhook event, in the same transaction.
    IF v_notify THEN
        SELECT p.full_name INTO v_patient FROM public.patients p WHERE p.id = v_visit.patient_id AND p.tenant_id = p_tenant_id;
        v_message := private.step_enqueue_visit_message(
            p_tenant_id, p_visit_id, v_visit.patient_id, 'appointment_cancelled',
            jsonb_build_object(
                'patient_name', left(coalesce(NULLIF(btrim(v_patient.full_name), ''), 'Patient'), 200),
                'reason', CASE p_reason_code
                    WHEN 'patient_request' THEN 'At your request'
                    WHEN 'doctor_unavailable' THEN 'The doctor is unavailable'
                    WHEN 'clinic_closed' THEN 'The clinic is closed'
                    WHEN 'duplicate' THEN 'Duplicate booking'
                    ELSE 'Schedule change' END),
            'appointment_cancelled:' || p_visit_id::text);
    END IF;
    PERFORM public.enqueue_webhook_event(p_tenant_id, 'appointment.cancelled', p_visit_id);

    SELECT v.row_version INTO v_row_version FROM public.visits v WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id;
    v_result := jsonb_build_object(
        'visit_id', p_visit_id,
        'row_version', v_row_version,
        'promoted', coalesce((v_promotion ->> 'promoted')::boolean, false),
        'replacement_visit_id', v_promotion -> 'visit_id',
        'promoted_patient_id', v_promotion -> 'patient_id',
        'message_enqueued', coalesce((v_message ->> 'enqueued')::boolean, false),
        'replayed', false
    );
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$function$
;

REVOKE ALL ON FUNCTION public.cancel_visit(uuid, uuid, text, uuid, text, boolean, boolean, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_visit(uuid, uuid, text, uuid, text, boolean, boolean, bigint) TO authenticated;
COMMENT ON FUNCTION public.cancel_visit(uuid, uuid, text, uuid, text, boolean, boolean, bigint) IS
    $c$V2-08 08-04a (R-15), 08-06a (A-2): cancels a booked, confirmed or waiting visit in one transaction: status, metadata.cancellation_reason (one of patient_request, doctor_unavailable, clinic_closed, duplicate, other; the webhook payload reads it) and the optional note (metadata.cancellation_note, never in a result), visit.cancel audit row, the waitlist promotion into the vacated slot when p_promote_waitlist, the slot lies ahead and the reason is not doctor_unavailable or clinic_closed (D-08: private.step_promote_waitlist, which also skips a blocked or off-duty slot; one entry once), the appointment_cancelled message when p_notify and the appointment.cancelled webhook event. appointments:edit. VISIT_NOT_CANCELLABLE (P0001) for any other status. Idempotent by p_client_request_id. Result: visit_id, promoted, replacement_visit_id, promoted_patient_id, message_enqueued, replayed. 09E-07 (R-19): p_expected_version (DEFAULT NULL) is compared with the locked visit's row_version after the request-id replay and before any write (ROW_CHANGED, P0001); the result gains row_version.$c$;

-- reschedule_visit
DROP FUNCTION public.reschedule_visit(uuid, uuid, timestamp with time zone, uuid, uuid, integer, boolean, boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION public.reschedule_visit(p_tenant_id uuid, p_visit_id uuid, p_new_scheduled_at timestamp with time zone, p_client_request_id uuid, p_doctor_id uuid DEFAULT NULL::uuid, p_duration_minutes integer DEFAULT NULL::integer, p_overbook boolean DEFAULT false, p_override_off_duty boolean DEFAULT false, p_override_block boolean DEFAULT false, p_notify boolean DEFAULT false, p_expected_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
DECLARE
    v_row_version bigint;
    v_uid uuid := auth.uid();
    v_overbook boolean := coalesce(p_overbook, false);
    v_off_duty_ok boolean := coalesce(p_override_off_duty, false);
    v_block_ok boolean := coalesce(p_override_block, false);
    v_notify boolean := coalesce(p_notify, false);
    v_replay jsonb;
    v_visit record;
    v_tz text;
    v_doctor uuid;
    v_duration integer;
    v_conflicts text[] := ARRAY[]::text[];
    v_off_duty boolean := false;
    v_overbooked boolean;
    v_attempt integer := 0;
    v_message jsonb := jsonb_build_object('enqueued', false);
    v_patient record;
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
    IF p_visit_id IS NULL OR p_new_scheduled_at IS NULL
       OR (p_duration_minutes IS NOT NULL AND p_duration_minutes NOT BETWEEN 5 AND 480) THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim.
    v_replay := private.command_claim(
        p_tenant_id, p_client_request_id, 'public.reschedule_visit',
        private.command_request_hash(jsonb_build_object('visit', p_visit_id, 'at', extract(epoch FROM p_new_scheduled_at)::text,
                                                        'doctor', p_doctor_id, 'duration', p_duration_minutes,
                                                        'overbook', v_overbook, 'off_duty_ok', v_off_duty_ok,
                                                        'block_ok', v_block_ok, 'notify', v_notify))
    );
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the visit (commands on one visit run one after the other) and decide.
    SELECT v.status, v.scheduled_at, v.doctor_id, v.estimated_duration_minutes, v.patient_id, v.metadata, v.row_version
      INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF p_expected_version IS NOT NULL AND v_visit.row_version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'ROW_CHANGED' USING ERRCODE = 'P0001';
    END IF;
    -- Booked, confirmed, or a no-show that is rebooked (R-7). A waiting, in-consultation, completed or cancelled visit is not moved.
    IF v_visit.status NOT IN ('booked', 'confirmed', 'no_show') THEN
        RAISE EXCEPTION 'VISIT_NOT_RESCHEDULABLE' USING ERRCODE = 'P0001';
    END IF;
    IF p_new_scheduled_at <= now() THEN
        RAISE EXCEPTION 'SLOT_IN_PAST' USING ERRCODE = 'P0001';
    END IF;
    v_doctor := coalesce(p_doctor_id, v_visit.doctor_id);
    v_duration := coalesce(p_duration_minutes, v_visit.estimated_duration_minutes, 15);
    SELECT t.timezone INTO v_tz FROM public.tenants t WHERE t.id = p_tenant_id;

    -- 5. The slot (unless overbooked): off duty, blocked and taken are evaluated independently, the visit never conflicts
    --    with itself, and each override clears only its own conflict (as register_and_book, 000099 G-1). A doctor who is not an
    --    active clinician is DOCTOR_NOT_FOUND (inside slot_conflicts; checked here too for an overbooked move).
    PERFORM 1 FROM public.memberships m
     WHERE m.tenant_id = p_tenant_id AND m.user_id = v_doctor AND m.status = 'active'
       AND authz.role_has_permission(m.role, 'consultations:edit');
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DOCTOR_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT v_overbook THEN
        v_conflicts := private.slot_conflicts(p_tenant_id, v_doctor, p_new_scheduled_at, v_duration, v_tz, p_visit_id);
        v_off_duty := 'off_duty' = ANY (v_conflicts);
        IF v_off_duty AND NOT v_off_duty_ok THEN
            RAISE EXCEPTION 'SLOT_OFF_DUTY' USING ERRCODE = 'P0001';
        ELSIF 'blocked' = ANY (v_conflicts) AND NOT v_block_ok THEN
            RAISE EXCEPTION 'SLOT_BLOCKED' USING ERRCODE = 'P0001';
        ELSIF 'taken' = ANY (v_conflicts) THEN
            RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
        END IF;
    END IF;
    v_overbooked := v_overbook OR (v_off_duty_ok AND v_off_duty);

    -- 6. Write: the new time, doctor and duration, status back to booked (the confirmation is cleared; a no-show is rebooked).
    --    Two moves into one slot: the loser's UPDATE waits on the exclusion constraint, then fails with 23P01 (or a deadlock that
    --    survives one retry): SLOT_TAKEN.
    LOOP
        v_attempt := v_attempt + 1;
        BEGIN
            UPDATE public.visits
               SET scheduled_at = p_new_scheduled_at,
                   doctor_id = v_doctor,
                   estimated_duration_minutes = v_duration,
                   is_overbooked = v_overbooked,
                   status = 'booked',
                   metadata = coalesce(metadata, '{}'::jsonb) - 'clinic_confirmed' - 'confirmed_at' - 'confirmed_by'
                              - 'confirmed_via' - 'patient_confirmed',
                   updated_at = now()
             WHERE id = p_visit_id AND tenant_id = p_tenant_id;
            EXIT;
        EXCEPTION
            WHEN exclusion_violation THEN
                RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
            WHEN deadlock_detected THEN
                IF v_attempt >= 2 THEN
                    RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = 'P0001';
                END IF;
        END;
    END LOOP;

    PERFORM private.log_command_audit(p_tenant_id, 'visit.reschedule', 'visit', p_visit_id,
        jsonb_build_object(
            'old_status', v_visit.status, 'new_status', 'booked', 'is_overbooked', v_overbooked,
            'old_scheduled_at', to_char(v_visit.scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'new_scheduled_at', to_char(p_new_scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));

    -- 7. The patient's message and the webhook event, in the same transaction.
    IF v_notify THEN
        SELECT p.full_name INTO v_patient FROM public.patients p WHERE p.id = v_visit.patient_id AND p.tenant_id = p_tenant_id;
        v_message := private.step_enqueue_visit_message(
            p_tenant_id, p_visit_id, v_visit.patient_id, 'appointment_rescheduled',
            jsonb_build_object(
                'patient_name', left(coalesce(NULLIF(btrim(v_patient.full_name), ''), 'Patient'), 200),
                'doctor_name', left(private.doctor_display_name(p_tenant_id, v_doctor), 200),
                'new_date_time', to_char(p_new_scheduled_at AT TIME ZONE v_tz, 'FMDD Mon YYYY, FMHH12:MI am')),
            'appointment_rescheduled:' || p_visit_id::text || ':' || extract(epoch FROM p_new_scheduled_at)::bigint::text);
    END IF;
    PERFORM public.enqueue_webhook_event(p_tenant_id, 'appointment.rescheduled', p_visit_id);

    SELECT v.row_version INTO v_row_version FROM public.visits v WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id;
    v_result := jsonb_build_object(
        'visit_id', p_visit_id,
        'row_version', v_row_version,
        'is_overbooked', v_overbooked,
        'message_enqueued', coalesce((v_message ->> 'enqueued')::boolean, false),
        'replayed', false
    );
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$function$
;

REVOKE ALL ON FUNCTION public.reschedule_visit(uuid, uuid, timestamp with time zone, uuid, uuid, integer, boolean, boolean, boolean, boolean, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_visit(uuid, uuid, timestamp with time zone, uuid, uuid, integer, boolean, boolean, boolean, boolean, bigint) TO authenticated;
COMMENT ON FUNCTION public.reschedule_visit(uuid, uuid, timestamp with time zone, uuid, uuid, integer, boolean, boolean, boolean, boolean, bigint) IS
    $c$V2-08 08-04a (R-15): moves a booked, confirmed or no-show visit to a new time (and optionally doctor and duration) in one transaction: the slot is checked as register_and_book does (SLOT_OFF_DUTY, SLOT_BLOCKED, SLOT_TAKEN; the visit never conflicts with itself; overbook and the two overrides as in the booking), a past time is SLOT_IN_PAST, the status goes back to booked (a no-show is rebooked, the confirmation is cleared), visit.reschedule audit row, the appointment_rescheduled message when p_notify (the patient has a mobile number) and the appointment.rescheduled webhook event. appointments:edit. VISIT_NOT_RESCHEDULABLE (P0001) for any other status. Idempotent by p_client_request_id. Result: visit_id, is_overbooked, message_enqueued, replayed. 09E-07 (R-19): p_expected_version (DEFAULT NULL) is compared with the locked visit's row_version after the request-id replay and before any write (ROW_CHANGED, P0001); the result gains row_version.$c$;

-- confirm_appointment
DROP FUNCTION public.confirm_appointment(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.confirm_appointment(p_tenant_id uuid, p_visit_id uuid, p_client_request_id uuid, p_expected_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
DECLARE
    v_row_version bigint;
    v_uid uuid := auth.uid();
    v_replay jsonb;
    v_visit record;
    v_already boolean := false;
    v_result jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'appointments:edit') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    v_replay := private.command_claim(p_tenant_id, p_client_request_id, 'public.confirm_appointment',
                                      private.command_request_hash(jsonb_build_object('visit', p_visit_id)));
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    SELECT v.status, v.row_version INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF p_expected_version IS NOT NULL AND v_visit.row_version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'ROW_CHANGED' USING ERRCODE = 'P0001';
    END IF;
    IF v_visit.status = 'confirmed' THEN
        v_already := true;
    ELSIF v_visit.status = 'booked' THEN
        UPDATE public.visits
           SET status = 'confirmed',
               metadata = coalesce(metadata, '{}'::jsonb)
                          || jsonb_build_object('clinic_confirmed', true,
                                                'confirmed_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                                                'confirmed_by', v_uid::text, 'confirmed_via', 'staff_calendar'),
               updated_at = now()
         WHERE id = p_visit_id AND tenant_id = p_tenant_id;
        PERFORM private.log_command_audit(p_tenant_id, 'visit.confirm', 'visit', p_visit_id,
                                          jsonb_build_object('old_status', 'booked', 'new_status', 'confirmed'));
    ELSE
        RAISE EXCEPTION 'VISIT_NOT_CONFIRMABLE' USING ERRCODE = 'P0001';
    END IF;

    SELECT v.row_version INTO v_row_version FROM public.visits v WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id;
    v_result := jsonb_build_object('visit_id', p_visit_id, 'already_confirmed', v_already, 'replayed', false, 'row_version', v_row_version);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$function$
;

REVOKE ALL ON FUNCTION public.confirm_appointment(uuid, uuid, uuid, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_appointment(uuid, uuid, uuid, bigint) TO authenticated;
COMMENT ON FUNCTION public.confirm_appointment(uuid, uuid, uuid, bigint) IS
    $c$V2-08 08-04a (R-15): a booked visit becomes confirmed (metadata clinic_confirmed, confirmed_at, confirmed_by, confirmed_via staff_calendar) with the visit.confirm audit row; an already confirmed visit answers already_confirmed with no second audit row. appointments:edit. VISIT_NOT_CONFIRMABLE (P0001) for any other status. Idempotent by p_client_request_id. Result: visit_id, already_confirmed, replayed. 09E-07 (R-19): p_expected_version (DEFAULT NULL) is compared with the locked visit's row_version after the request-id replay and before any write (ROW_CHANGED, P0001); the result gains row_version.$c$;

-- complete_and_bill
DROP FUNCTION public.complete_and_bill(uuid, uuid, jsonb, numeric, numeric, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.complete_and_bill(p_tenant_id uuid, p_visit_id uuid, p_items jsonb, p_discount numeric, p_tax numeric, p_payment jsonb, p_client_request_id uuid, p_expected_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
DECLARE
    v_row_version bigint;
    v_invoice_version bigint;
    v_uid uuid := auth.uid();
    v_pay jsonb := CASE WHEN p_payment IS NULL OR jsonb_typeof(p_payment) = 'null' THEN NULL ELSE p_payment END;
    v_method text;
    v_reference text;
    v_amount numeric;
    v_replay jsonb;
    v_visit record;
    v_resumed boolean := false;
    v_sign jsonb;
    v_inv jsonb;
    v_payment jsonb;
    v_key text;
    v_result jsonb;
BEGIN
    -- 1. Actor: a session; this command has no system path.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then consultations:edit there; collecting needs billing:collect too (PO-3), refused before anything
    --    is signed.
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'consultations:edit')
       OR (v_pay IS NOT NULL AND NOT public.has_permission(p_tenant_id, 'billing:collect')) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- Payment input: {method, reference?, amount?}; the amount defaults to the invoice total.
    IF v_pay IS NOT NULL THEN
        IF jsonb_typeof(v_pay) <> 'object' THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        FOR v_key IN SELECT k FROM jsonb_object_keys(v_pay) k LOOP
            IF v_key NOT IN ('method', 'reference', 'amount') THEN
                RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
            END IF;
        END LOOP;
        IF jsonb_typeof(v_pay -> 'method') IS DISTINCT FROM 'string' OR (v_pay ->> 'method') NOT IN ('cash', 'upi', 'card') THEN
            RAISE EXCEPTION 'METHOD_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_method := v_pay ->> 'method';
        IF v_pay ? 'reference' AND jsonb_typeof(v_pay -> 'reference') NOT IN ('string', 'null') THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_reference := NULLIF(btrim(v_pay ->> 'reference'), '');
        IF char_length(v_reference) > 100 THEN
            RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        IF v_pay ? 'amount' AND jsonb_typeof(v_pay -> 'amount') NOT IN ('number', 'null') THEN
            RAISE EXCEPTION 'AMOUNT_INVALID' USING ERRCODE = 'P0001';
        END IF;
        v_amount := (v_pay ->> 'amount')::numeric;
        IF v_amount IS NOT NULL AND (v_amount <= 0 OR v_amount <> round(v_amount, 2) OR v_amount >= 100000000) THEN
            RAISE EXCEPTION 'AMOUNT_INVALID' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 3. Claim; a replay returns the first result and writes nothing.
    v_replay := private.command_claim(
        p_tenant_id, p_client_request_id, 'public.complete_and_bill',
        private.command_request_hash(jsonb_build_object('visit', p_visit_id, 'items', p_items, 'discount', COALESCE(p_discount, 0),
                               'tax', COALESCE(p_tax, 0), 'method', v_method, 'reference', v_reference,
                               'amount', v_amount, 'collect', v_pay IS NOT NULL))
    );
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Lock the visit (the aggregate root); the invoice needs a collector or the visit's own doctor, as create_invoice.
    SELECT v.status, v.signed_at, v.signed_by, v.doctor_id, v.row_version INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT (public.has_permission(p_tenant_id, 'billing:collect') OR v_visit.doctor_id IS NOT DISTINCT FROM v_uid) THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_expected_version IS NOT NULL AND v_visit.row_version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'ROW_CHANGED' USING ERRCODE = 'P0001';
    END IF;

    -- 5. Sign off. A visit this user already signed whose billing never happened resumes at billing (IR2-L1: it is not
    --    re-signed, P1-23); one that is already billed is refused; anything else signed is ALREADY_SIGNED (in the step).
    IF v_visit.status = 'completed' AND v_visit.signed_at IS NOT NULL AND v_visit.signed_by IS NOT DISTINCT FROM v_uid THEN
        IF EXISTS (SELECT 1 FROM public.invoices i
                    WHERE i.tenant_id = p_tenant_id AND i.visit_id = p_visit_id AND i.status <> 'cancelled') THEN
            RAISE EXCEPTION 'ALREADY_BILLED' USING ERRCODE = 'P0001';
        END IF;
        v_resumed := true;
        v_sign := jsonb_build_object('visit_id', p_visit_id, 'signed_at', v_visit.signed_at, 'sealed_prescriptions', 0);
    ELSE
        v_sign := private.step_sign_consultation(p_tenant_id, p_visit_id);
    END IF;

    -- 6. Invoice, then the payment: an invoice that already existed (an invoice made at the desk before the sign-off)
    --    is returned and nothing is paid (AR3-N2: "already billed", never "payment pending").
    v_inv := private.step_create_invoice(p_tenant_id, p_visit_id, p_items, p_discount, p_tax);
    IF v_pay IS NOT NULL AND NOT (v_inv ->> 'existing')::boolean AND (v_inv ->> 'total_amount')::numeric > 0 THEN
        v_payment := private.step_record_payment(p_tenant_id, (v_inv ->> 'invoice_id')::uuid,
                                                 coalesce(v_amount, (v_inv ->> 'total_amount')::numeric),
                                                 v_method, v_reference, NULL, p_client_request_id, NULL);
    END IF;

    SELECT v.row_version INTO v_row_version FROM public.visits v WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id;
    SELECT i.row_version INTO v_invoice_version FROM public.invoices i WHERE i.id = (v_inv ->> 'invoice_id')::uuid AND i.tenant_id = p_tenant_id;
    v_result := jsonb_build_object(
        'visit_id', p_visit_id,
        'row_version', v_row_version,
        'invoice_version', v_invoice_version,
        'signed_at', v_sign -> 'signed_at',
        'sealed_prescriptions', v_sign -> 'sealed_prescriptions',
        'resumed', v_resumed,
        'invoice_id', v_inv -> 'invoice_id',
        'invoice_number', v_inv -> 'invoice_number',
        'total_amount', v_inv -> 'total_amount',
        'already_billed', (v_inv ->> 'existing')::boolean,
        'payment_recorded', v_payment IS NOT NULL,
        'payment_id', v_payment -> 'payment_id',
        'invoice_status', coalesce(v_payment ->> 'invoice_status', v_inv ->> 'status'),
        'paid_total', coalesce((v_payment ->> 'paid_total')::numeric, 0),
        'replayed', false
    );
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$function$
;

REVOKE ALL ON FUNCTION public.complete_and_bill(uuid, uuid, jsonb, numeric, numeric, jsonb, uuid, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_and_bill(uuid, uuid, jsonb, numeric, numeric, jsonb, uuid, bigint) TO authenticated;
COMMENT ON FUNCTION public.complete_and_bill(uuid, uuid, jsonb, numeric, numeric, jsonb, uuid, bigint) IS
    $c$V2-07 07-03 (R-1, R-7): Sign & Bill in one transaction: the sign-off (or the resume of a visit this user signed that has no invoice), the visit's invoice, and the payment when p_payment {method, reference?, amount?} is given (the invoice total by default). consultations:edit, plus billing:collect when a payment is given; the invoice needs billing:collect or the visit's own doctor. ALREADY_BILLED (P0001) for a visit this user signed and billed; ALREADY_SIGNED / SIGN_CONTENT_REQUIRED from the sign-off. Nothing persists unless every step succeeds. Idempotent by p_client_request_id. Result: visit_id, signed_at, sealed_prescriptions, resumed, invoice_id, invoice_number, total_amount, already_billed, payment_recorded, payment_id, invoice_status, paid_total, replayed. 09E-07 (R-19): p_expected_version (DEFAULT NULL) is compared with the locked visit's row_version after the permission checks and the request-id replay and before the sign-off (ROW_CHANGED, P0001); the result gains row_version and invoice_version.$c$;

-- collect_payment
DROP FUNCTION public.collect_payment(uuid, uuid, jsonb, numeric, text, text, text, uuid, numeric, numeric);

CREATE OR REPLACE FUNCTION public.collect_payment(p_tenant_id uuid, p_visit_id uuid, p_items jsonb, p_amount numeric, p_method text, p_reference text, p_notes text, p_client_request_id uuid, p_discount numeric DEFAULT 0, p_tax numeric DEFAULT 0, p_expected_invoice_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
DECLARE
    v_invoice_version bigint;
    v_uid uuid := auth.uid();
    v_reference text := NULLIF(btrim(p_reference), '');
    v_notes text := NULLIF(btrim(p_notes), '');
    v_replay jsonb;
    v_visit_ok boolean;
    v_inv jsonb;
    v_pay jsonb;
    v_result jsonb;
BEGIN
    -- 1. Actor: a session; this command has no system path.
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 2. Active clinic, then billing:collect there (PO-3: owner, admin, receptionist).
    IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.has_permission(p_tenant_id, 'billing:collect') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    -- Input (the payment rules of record_payment; the item list is validated when an invoice is created).
    IF p_visit_id IS NULL THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) OR p_amount >= 100000000 THEN
        RAISE EXCEPTION 'AMOUNT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('cash', 'upi', 'card') THEN
        RAISE EXCEPTION 'METHOD_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF char_length(v_reference) > 100 OR char_length(v_notes) > 500 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. Claim; a replay returns the first result and writes nothing.
    v_replay := private.command_claim(
        p_tenant_id, p_client_request_id, 'public.collect_payment',
        private.command_request_hash(jsonb_build_object('visit', p_visit_id, 'items', p_items, 'amount', p_amount, 'method', p_method,
                               'reference', v_reference, 'notes', v_notes,
                               'discount', COALESCE(p_discount, 0), 'tax', COALESCE(p_tax, 0)))
    );
    IF v_replay IS NOT NULL THEN
        RETURN v_replay;
    END IF;

    -- 4. Get or create the visit's invoice (locks the visit), then pay it in the same transaction.
    SELECT true INTO v_visit_ok
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- 4a. Stale-write refusal (09E-07, R-19): the visit's live invoice (locked here, as the step locks it) is compared before anything is
    --     written; a version given when the visit has no live invoice is refused too (the screen saw one that is gone). A replay was answered above.
    IF p_expected_invoice_version IS NOT NULL THEN
        SELECT i.row_version INTO v_invoice_version
          FROM public.invoices i
         WHERE i.tenant_id = p_tenant_id AND i.visit_id = p_visit_id AND i.status <> 'cancelled'
           FOR UPDATE;
        IF NOT FOUND OR v_invoice_version IS DISTINCT FROM p_expected_invoice_version THEN
            RAISE EXCEPTION 'ROW_CHANGED' USING ERRCODE = 'P0001';
        END IF;
    END IF;
    v_inv := private.step_create_invoice(p_tenant_id, p_visit_id, p_items, p_discount, p_tax);
    v_pay := private.step_record_payment(p_tenant_id, (v_inv ->> 'invoice_id')::uuid, p_amount, p_method, v_reference,
                                         v_notes, p_client_request_id, NULL);

    SELECT i.row_version INTO v_invoice_version FROM public.invoices i WHERE i.id = (v_inv ->> 'invoice_id')::uuid AND i.tenant_id = p_tenant_id;
    v_result := (v_pay - 'replayed') || jsonb_build_object(
        'invoice_version', v_invoice_version,
        'invoice_id', v_inv -> 'invoice_id',
        'invoice_number', v_inv -> 'invoice_number',
        'invoice_created', NOT (v_inv ->> 'existing')::boolean,
        'replayed', false
    );
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$function$
;

REVOKE ALL ON FUNCTION public.collect_payment(uuid, uuid, jsonb, numeric, text, text, text, uuid, numeric, numeric, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.collect_payment(uuid, uuid, jsonb, numeric, text, text, text, uuid, numeric, numeric, bigint) TO authenticated;
COMMENT ON FUNCTION public.collect_payment(uuid, uuid, jsonb, numeric, text, text, text, uuid, numeric, numeric, bigint) IS
    $c$V2-07 07-02 (R-7): desk checkout in one transaction: the visit's live invoice (created from p_items when there is none) and the payment (balance cap, status, audit, payment.recorded outbox). billing:collect. Idempotent by p_client_request_id. Result: invoice_id, invoice_number, invoice_created, payment_id, invoice_status, paid_total, total_amount, balance_due, replayed (ids, numbers, amounts and statuses only, 000099 F-5). 09E-07 (R-19): p_expected_invoice_version (DEFAULT NULL) is compared with the visit's live invoice row_version after the request-id replay and the row locks and before any write; a version given when there is no live invoice is ROW_CHANGED too; the result gains invoice_version.$c$;

-- record_payment
DROP FUNCTION public.record_payment(uuid, uuid, numeric, text, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.record_payment(p_tenant_id uuid, p_invoice_id uuid, p_amount numeric, p_method text, p_reference text, p_command_id uuid, p_notes text DEFAULT NULL::text, p_system_actor text DEFAULT NULL::text, p_expected_invoice_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
AS $function$
DECLARE
    v_result jsonb;
    v_invoice_version bigint;
    v_uid UUID := auth.uid();
    v_is_system BOOLEAN;
    v_invoice RECORD;
    v_existing RECORD;
    v_paid NUMERIC;
    v_reference TEXT := NULLIF(btrim(p_reference), '');
    v_notes TEXT := NULLIF(btrim(p_notes), '');
BEGIN
    -- 1. Actor. User path: a session (auth.uid()) and no system actor. System path (TARGET §7.1): the service role,
    --    no session, and a system actor from the closed set.
    IF v_uid IS NOT NULL AND p_system_actor IS NULL THEN
        v_is_system := false;
    ELSIF v_uid IS NULL
        AND current_setting('role', true) = 'service_role'
        AND p_system_actor IN ('system:payment_webhook') THEN
        v_is_system := true;
    ELSE
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Input.
    IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) OR p_amount >= 100000000 THEN
        RAISE EXCEPTION 'AMOUNT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_method IS NULL OR p_method NOT IN ('cash', 'upi', 'card') THEN
        RAISE EXCEPTION 'METHOD_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF char_length(v_reference) > 100 OR char_length(v_notes) > 500 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 3. User path: the tenant is the session's ACTIVE clinic, and the caller collects there (billing:collect, PO-3).
    --    Another clinic reads as not found.
    IF NOT v_is_system THEN
        IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
            RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0002';
        END IF;
        IF NOT public.has_permission(p_tenant_id, 'billing:collect') THEN
            RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 4. Lock the aggregate root, in the given tenant only.
    SELECT i.id, i.tenant_id, i.total_amount, i.status, i.row_version
    INTO v_invoice
    FROM public.invoices i
    WHERE i.id = p_invoice_id
      AND i.tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- 5. Idempotent replay of this actor's own command only (H-PAY). Command ids are written by this function alone
    --    (payments_actor_guard), and a row of another actor with the same command id is a mismatch, never a replay.
    IF p_command_id IS NOT NULL THEN
        SELECT p.id, p.invoice_id, p.amount, p.payment_method, p.recorded_by, p.recorded_by_system
        INTO v_existing
        FROM public.payments p
        WHERE p.tenant_id = v_invoice.tenant_id
          AND p.command_id = p_command_id;

        IF FOUND THEN
            IF v_existing.invoice_id <> v_invoice.id
                OR v_existing.amount <> p_amount
                OR v_existing.payment_method <> p_method
                OR v_existing.recorded_by IS DISTINCT FROM (CASE WHEN v_is_system THEN NULL ELSE v_uid END)
                OR v_existing.recorded_by_system IS DISTINCT FROM (CASE WHEN v_is_system THEN p_system_actor ELSE NULL END) THEN
                RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH' USING ERRCODE = 'P0001';
            END IF;

            SELECT COALESCE(sum(p.amount), 0) INTO v_paid
            FROM public.payments p
            WHERE p.invoice_id = v_invoice.id
              AND p.tenant_id = v_invoice.tenant_id;

            RETURN jsonb_build_object(
                'payment_id', v_existing.id,
                'invoice_status', v_invoice.status,
                'paid_total', v_paid,
                'total_amount', v_invoice.total_amount,
                'balance_due', GREATEST(v_invoice.total_amount - v_paid, 0),
                'invoice_version', v_invoice.row_version,
                'replayed', true
            );
        END IF;
    END IF;

    -- 6.-10. Invariants, payment, status transition, audit, outbox: the shared step (V2-07 07-02, R-7).
    -- 5a. Stale-write refusal (09E-07, R-19): the invoice is locked (4) and a replay was answered (5); a version that differs now means the invoice
    --     (status, total, subtotal, discount or tax) moved since the screen read it. Nothing is written.
    IF p_expected_invoice_version IS NOT NULL AND v_invoice.row_version IS DISTINCT FROM p_expected_invoice_version THEN
        RAISE EXCEPTION 'ROW_CHANGED' USING ERRCODE = 'P0001';
    END IF;

    v_result := private.step_record_payment(v_invoice.tenant_id, v_invoice.id, p_amount, p_method, v_reference, v_notes,
                                       p_command_id, CASE WHEN v_is_system THEN p_system_actor ELSE NULL END);
    SELECT i.row_version INTO v_invoice_version FROM public.invoices i WHERE i.id = v_invoice.id AND i.tenant_id = v_invoice.tenant_id;
    RETURN v_result || jsonb_build_object('invoice_version', v_invoice_version);
END;
$function$
;

REVOKE ALL ON FUNCTION public.record_payment(uuid, uuid, numeric, text, text, uuid, text, text, bigint) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid, uuid, numeric, text, text, uuid, text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid, uuid, numeric, text, text, uuid, text, text, bigint) TO service_role;
COMMENT ON FUNCTION public.record_payment(uuid, uuid, numeric, text, text, uuid, text, text, bigint) IS
    $c$V2-03 03-07/03-13c (D1 spike): records a payment atomically under the caller's RLS: lock, invariants, payment, status, audit and outbox in one transaction; replays only the same actor's command. 09E-07 (R-19): p_expected_invoice_version (DEFAULT NULL) is compared with the locked invoice's row_version after the replay by command id and before any write (ROW_CHANGED, P0001); the result gains invoice_version.$c$;

