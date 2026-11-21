-- Migration: 000106_front_desk_review_fixes.sql
-- V2-08 08-06a: the review fix round (08-REVIEW-TRIAGE.md: A-2, A-3, A-5, S-1..S-8).
--
-- A-2  private.step_promote_waitlist: the vacated slot is promoted into only when it is a working slot (no schedule block, a
--      shift the doctor works: private.slot_conflicts, the booking's rule); public.cancel_visit never promotes for the reasons
--      doctor_unavailable and clinic_closed.
-- A-3  private.step_check_in: a late no-show whose slot was rebooked is checked in as an overbooked visit (a patient who is
--      present is not refused by the slot rule); the audit row carries is_overbooked when the check-in set it. start_consultation
--      inherits it.
-- A-5  private.today_signal gains the invoices branch; triggers AFTER INSERT and AFTER UPDATE OF total_amount, status on
--      public.invoices send {kind:'invoice', visit_id} (no PHI).
-- S-1  REVOKE INSERT ON public.visits FROM authenticated (no request path inserts a visit; the definer commands and the service
--      role do). S-2 REVOKE INSERT, UPDATE ON public.waitlist_entries. S-8 REVOKE INSERT ON public.patients.
-- S-3  A writer of visits.metadata remains on a request path (the consultation draft's AI provenance), so the column stays
--      granted and is guarded: private.visits_metadata_guard (BEFORE UPDATE OF metadata, invoker) refuses a direct write by a
--      signed-in member unless the member holds consultations:edit, the visit is an open draft (the draft save's own filter),
--      only ai_assisted (boolean) and ai_sections_used (up to 20 short strings) change, and the object stays within 8 KB.
--      Definer commands and the service role are not restricted by it.
-- S-4  public.complete_visit: desk completion only from waiting; an in_consultation visit is completed by the sign-off commands.
-- S-5  private.audit_client_actions loses appointment.cancel, appointment.reschedule, queue.transition, visit.status_update and
--      visit.create (public.log_audit refuses them; the API-key path writes audit_logs directly and does not consult the list).
--      visit.create moves to private.log_command_audit (private.step_create_visit writes it there now).
-- S-6  public.get_reschedule_context no longer returns other appointments' times (the slots come from get_reschedule_slots).
-- S-7  The realtime.messages SELECT policy also checks the row's own topic.
-- Per-migration checklist: no new public function, one new private invoker trigger function (visits_metadata_guard), bodies
-- replaced with unchanged signatures and grants: step_create_visit, log_command_audit, audit_client_actions,
-- step_promote_waitlist, cancel_visit, step_check_in, complete_visit, get_reschedule_context, today_signal; four REVOKEs on
-- three tables; two invoices triggers; one trigger on visits; one policy replaced. No table, column or data change.

-- 1. S-5: visit.create is written through the command-only writer --------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.step_create_visit(
    p_tenant_id uuid,
    p_patient_id uuid,
    p_doctor_id uuid,
    p_origin text,
    p_scheduled_at timestamptz,
    p_duration_minutes integer,
    p_reason text,
    p_overbooked boolean
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_reason text := NULLIF(btrim(p_reason), '');
    v_id uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF p_origin IS NULL OR p_origin NOT IN ('scheduled', 'walk_in')
       OR (p_origin = 'scheduled' AND p_scheduled_at IS NULL)
       OR p_duration_minutes IS NULL OR p_duration_minutes NOT BETWEEN 5 AND 480
       OR char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- The patient and the doctor must belong to the clinic (the FKs and RLS do not check this: P0-13). A removed or
    -- suspended member cannot be given new work; a soft-deleted or erased patient gets no new visit (AR-L6).
    PERFORM 1 FROM public.patients p
     WHERE p.id = p_patient_id AND p.tenant_id = p_tenant_id AND NOT p.is_deleted AND p.erased_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- 000099 (G-9): the doctor is an active clinician (a role that holds consultations:edit: owner, doctor), not any member.
    PERFORM 1 FROM public.memberships m
     WHERE m.tenant_id = p_tenant_id AND m.user_id = p_doctor_id AND m.status = 'active'
       AND authz.role_has_permission(m.role, 'consultations:edit');
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DOCTOR_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.visits (tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at,
                               estimated_duration_minutes, reason_for_visit, is_overbooked, created_by)
    VALUES (
        p_tenant_id, p_patient_id, p_doctor_id, p_origin,
        CASE WHEN p_origin = 'walk_in' THEN 'waiting' ELSE 'booked' END,
        CASE WHEN p_origin = 'walk_in' THEN NULL ELSE p_scheduled_at END,
        p_duration_minutes, v_reason, coalesce(p_overbooked, false), v_uid
    )
    RETURNING id INTO v_id;

    PERFORM private.log_command_audit(p_tenant_id, 'visit.create', 'visit', v_id,
                             jsonb_build_object('origin_type', p_origin, 'fields_changed', jsonb_build_array('created')));
    RETURN v_id;
END;
$$;
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
                                            'visit.consultation_start', 'visit.complete_at_desk',
                                            'visit.reschedule', 'visit.no_show', 'visit.cancel', 'visit.confirm',
                                            'visit.auto_promoted_from_waitlist', 'waitlist.add', 'waitlist.promote',
                                            'visit.create')
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
COMMENT ON FUNCTION private.log_command_audit(uuid, text, text, uuid, jsonb) IS
    'V2-07 07-04a (F-1), V2-08 08-01b, 08-04a, 08-06a: writes an audit row as the session user for the actions only a command writes (visit.complete_and_sign, visit.reopen_for_amendment, visit.amend_finalized, invoice.create, queue.check_in, visit.consultation_start, visit.complete_at_desk, visit.reschedule, visit.no_show, visit.cancel, visit.confirm, visit.auto_promoted_from_waitlist, waitlist.add, waitlist.promote, visit.create), with log_audit''s metadata rules. The active clinic and a membership are required. No API grant: public.log_audit refuses these actions.';


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
        'prescription.share_whatsapp', 'prescription.template_save',
        'referral.acknowledge', 'referral.close_loop', 'referral.create', 'referral.share_whatsapp',
        'schedule_block.create', 'schedule_block.delete', 'staff.member.update', 'user.profile.update',
        'vitals.record',
        'webhook.create', 'webhook.delete',
        'dpdp.data_export', 'dpdp.patient_erasure'
    ]::TEXT[];
$$;
COMMENT ON FUNCTION private.audit_client_actions() IS
    'The actions public.log_audit accepts from a signed-in member (parity: lib/audit/audit.ts AUDIT_ACTIONS without the reserved prefixes, plus the two bound DPDP events; tests/audit/log-audit-allowlist.spec.ts). V2-08 08-06a (S-5): appointment.cancel, appointment.reschedule, queue.transition, visit.status_update and visit.create are no longer accepted; their writers are the commands (private.log_command_audit) and the API-key path (audit_logs insert by the service client).';

-- 2. A-2: the waitlist promotion respects blocks and shifts ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.step_promote_waitlist(
    p_tenant_id uuid,
    p_doctor_id uuid,
    p_scheduled_at timestamptz,
    p_duration_minutes integer,
    p_timezone text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_entry record;
    v_visit_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- 000106 (A-2): the vacated slot is a working slot or nothing is promoted into it: a schedule block over it, or a time the
    -- doctor does not work (the booking's rule, private.slot_conflicts). 'taken' is not asked here: the insert below meets the
    -- exclusion constraint and the entry is skipped.
    BEGIN
        IF private.slot_conflicts(p_tenant_id, p_doctor_id, p_scheduled_at, p_duration_minutes, p_timezone)
               && ARRAY['off_duty', 'blocked']::text[] THEN
            RETURN jsonb_build_object('promoted', false);
        END IF;
    EXCEPTION
        WHEN no_data_found THEN
            RETURN jsonb_build_object('promoted', false);
    END;
    -- D-08: a waiting entry for the slot's clinic-local date, for this doctor or for any; highest priority, then the oldest.
    -- SKIP LOCKED: a concurrent cancel that already holds an entry takes that one, so one entry is promoted once; an entry
    -- whose patient or doctor can no longer take a visit is skipped, not retried forever.
    FOR v_entry IN
        SELECT w.id, w.patient_id
          FROM public.waitlist_entries w
         WHERE w.tenant_id = p_tenant_id
           AND w.target_date = (p_scheduled_at AT TIME ZONE p_timezone)::date
           AND w.status = 'waiting'
           AND (w.doctor_id IS NULL OR w.doctor_id = p_doctor_id)
         ORDER BY w.priority DESC, w.created_at ASC
         LIMIT 10
           FOR UPDATE OF w SKIP LOCKED
    LOOP
        BEGIN
            v_visit_id := private.step_create_visit(p_tenant_id, v_entry.patient_id, p_doctor_id, 'scheduled', p_scheduled_at,
                                                    p_duration_minutes, 'Booked from waitlist', false);
        EXCEPTION
            WHEN exclusion_violation OR no_data_found THEN
                CONTINUE;
        END;
        UPDATE public.waitlist_entries SET status = 'promoted', promoted_visit_id = v_visit_id
         WHERE id = v_entry.id AND tenant_id = p_tenant_id;
        PERFORM private.log_command_audit(p_tenant_id, 'visit.auto_promoted_from_waitlist', 'visit', v_visit_id,
                                          jsonb_build_object('promoted_from_waitlist_id', v_entry.id, 'promoted_visit_id', v_visit_id));
        RETURN jsonb_build_object('promoted', true, 'entry_id', v_entry.id, 'visit_id', v_visit_id, 'patient_id', v_entry.patient_id);
    END LOOP;
    RETURN jsonb_build_object('promoted', false);
END;
$$;
COMMENT ON FUNCTION private.step_promote_waitlist(uuid, uuid, timestamptz, integer, text) IS
    'V2-08 08-04a (R-15, D-08), 08-06a (A-2): the waitlist promotion shared by cancel_visit: when the vacated slot is a working slot (no schedule block, a shift the doctor works: private.slot_conflicts) the best waiting entry of the slot''s clinic-local date (this doctor or any; priority, then age) becomes a booked visit in it ("Booked from waitlist"), the entry is marked promoted and visit.auto_promoted_from_waitlist is audited; a blocked or off-duty slot promotes nothing. FOR UPDATE SKIP LOCKED: two concurrent cancels never promote one entry twice; an entry that cannot take a visit is skipped. The caller has checked actor, clinic and appointments:edit; no API grant.';

-- 3. A-2: cancel never promotes for doctor_unavailable or clinic_closed ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_visit(
    p_tenant_id uuid,
    p_visit_id uuid,
    p_reason_code text,
    p_client_request_id uuid,
    p_reason_note text DEFAULT NULL,
    p_notify boolean DEFAULT false,
    p_promote_waitlist boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
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
    SELECT v.status, v.scheduled_at, v.doctor_id, v.estimated_duration_minutes, v.patient_id, v.metadata
      INTO v_visit
      FROM public.visits v
     WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'VISIT_NOT_FOUND' USING ERRCODE = 'P0002';
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

    v_result := jsonb_build_object(
        'visit_id', p_visit_id,
        'promoted', coalesce((v_promotion ->> 'promoted')::boolean, false),
        'replacement_visit_id', v_promotion -> 'visit_id',
        'promoted_patient_id', v_promotion -> 'patient_id',
        'message_enqueued', coalesce((v_message ->> 'enqueued')::boolean, false),
        'replayed', false
    );
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
COMMENT ON FUNCTION public.cancel_visit(uuid, uuid, text, uuid, text, boolean, boolean) IS
    'V2-08 08-04a (R-15), 08-06a (A-2): cancels a booked, confirmed or waiting visit in one transaction: status, metadata.cancellation_reason (one of patient_request, doctor_unavailable, clinic_closed, duplicate, other; the webhook payload reads it) and the optional note (metadata.cancellation_note, never in a result), visit.cancel audit row, the waitlist promotion into the vacated slot when p_promote_waitlist, the slot lies ahead and the reason is not doctor_unavailable or clinic_closed (D-08: private.step_promote_waitlist, which also skips a blocked or off-duty slot; one entry once), the appointment_cancelled message when p_notify and the appointment.cancelled webhook event. appointments:edit. VISIT_NOT_CANCELLABLE (P0001) for any other status. Idempotent by p_client_request_id. Result: visit_id, promoted, replacement_visit_id, promoted_patient_id, message_enqueued, replayed.';

-- 4. A-3: a late arrival whose slot was rebooked is checked in overbooked ------------------------------------------------------------
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
    v_over boolean := false;
BEGIN
    SELECT v.status, v.scheduled_at, v.is_overbooked INTO v_visit
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
        -- 000106 (A-3): a no-show's slot was freed (visits_no_double_booking skips no_show rows) and may have been rebooked; the
        -- patient is here, so the visit joins the queue as an overbooked one instead of being refused by the slot rule.
        UPDATE public.visits v
           SET status = 'waiting', updated_at = now(),
               is_overbooked = v.is_overbooked OR (
                   v_visit.status = 'no_show' AND v.origin_type = 'scheduled' AND v.scheduled_at IS NOT NULL
                   AND EXISTS (SELECT 1 FROM public.visits o
                                WHERE o.tenant_id = v.tenant_id AND o.doctor_id = v.doctor_id AND o.id <> v.id
                                  AND o.origin_type = 'scheduled' AND o.scheduled_at IS NOT NULL AND NOT o.is_overbooked
                                  AND o.status NOT IN ('cancelled', 'no_show')
                                  AND public.visit_slot(o.scheduled_at, o.estimated_duration_minutes)
                                      && public.visit_slot(v.scheduled_at, v.estimated_duration_minutes)))
         WHERE v.id = p_visit_id AND v.tenant_id = p_tenant_id
        RETURNING v.is_overbooked INTO v_over;
        v_repaired := true;
    END IF;

    SELECT q.priority INTO v_token_priority FROM public.queue_tokens q WHERE q.id = v_tok.queue_token_id;

    -- A repeat check-in of a visit that is already queued changes nothing and writes no second audit row.
    IF NOT v_tok.reused OR v_repaired THEN
        PERFORM private.log_command_audit(p_tenant_id, 'queue.check_in', 'queue_token', v_tok.queue_token_id,
                                 jsonb_build_object('token_number', v_tok.token_number, 'priority', v_token_priority)
                                 || CASE WHEN v_late THEN jsonb_build_object('late_arrival', true) ELSE '{}'::jsonb END
                                 || CASE WHEN v_late AND v_over AND NOT v_visit.is_overbooked THEN jsonb_build_object('is_overbooked', true) ELSE '{}'::jsonb END);
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
COMMENT ON FUNCTION private.step_check_in(uuid, uuid, text) IS
    'V2-08 08-01b (R-8), 08-06a (A-3): checks a visit in (token, waiting, queue.check_in audit row). A booking is checked in on its own day (VISIT_NOT_TODAY); a no-show that arrives late is checked in (no_show -> waiting, audit late_arrival) and, when another visit now holds its slot, as an overbooked visit (audit is_overbooked) so the slot rule never refuses a patient who is present. The caller has checked actor, clinic and the permission; no API grant.';

-- 5. S-4: desk completion only from waiting ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_visit(p_tenant_id uuid, p_visit_id uuid, p_client_request_id uuid)
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

    v_result := jsonb_build_object('visit_id', p_visit_id, 'already_completed', v_already, 'replayed', false);
    RETURN private.command_complete(p_tenant_id, p_client_request_id, v_result);
END;
$$;
COMMENT ON FUNCTION public.complete_visit(uuid, uuid, uuid) IS
    'V2-08 08-01b, 08-06a (S-4): desk completion in one transaction: an unsigned waiting visit becomes completed, its queue token gets completed_at, visit.complete_at_desk audit row. appointments:edit. A visit that is already completed answers already_completed and only stamps a missing completed_at. VISIT_NOT_COMPLETABLE (P0001) for booked, confirmed, no-show, cancelled, an in_consultation visit (completed only by sign-off) and a reopened signed visit. Idempotent by p_client_request_id. Result: visit_id, already_completed, replayed.';

-- 6. S-6: the patient link's context carries no other appointment's time -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reschedule_context(p_token text, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    t public.document_share_tokens;
    v public.visits;
    v_clinic JSONB;
    v_doctor JSONB;
BEGIN
    IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128 THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    SELECT * INTO t FROM public.document_share_tokens s
    WHERE s.token_hash = public.share_token_hash(p_token) AND s.resource_type = 'appointment';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    -- 05-10a (SUB-02): a clinic whose access level is not `full` offers no online service.
    IF billing_internal.tenant_access_level(t.tenant_id, now()) IS DISTINCT FROM 'full' THEN
        RETURN jsonb_build_object('status', 'clinic_unavailable');
    END IF;
    IF t.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('status', 'revoked');
    END IF;
    IF t.expires_at <= now() THEN
        RETURN jsonb_build_object('status', 'expired');
    END IF;

    SELECT * INTO v FROM public.visits x WHERE x.id = t.resource_id AND x.tenant_id = t.tenant_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('status', 'not_found');
    END IF;

    IF v.status IS NULL OR v.status NOT IN ('booked', 'confirmed') THEN
        RETURN jsonb_build_object('status', 'closed', 'visit_status', v.status);
    END IF;
    IF v.doctor_id IS NULL THEN
        RETURN jsonb_build_object('status', 'unavailable');
    END IF;

    -- V2-08 08-04a (R-16): the clinic's zone travels with the context, so the page and the slot list name the same day.
    SELECT jsonb_build_object('name', c.name, 'phone', c.phone, 'address', c.address, 'timezone', c.timezone)
    INTO v_clinic
    FROM public.tenants c
    WHERE c.id = t.tenant_id;

    SELECT jsonb_build_object(
        'full_name', m.full_name,
        'default_specialty', m.default_specialty,
        'default_slot_duration_minutes', m.default_slot_duration_minutes,
        'availability_schedule', private.effective_schedule(m.availability_schedule)
    ) INTO v_doctor
    FROM public.memberships m
    WHERE m.tenant_id = t.tenant_id AND m.user_id = v.doctor_id;

    RETURN jsonb_build_object(
        'status', 'ok',
        'clinic', v_clinic,
        'doctor', COALESCE(v_doctor, '{}'::JSONB),
        'current_scheduled_at', v.scheduled_at
    );
END;
$function$;
COMMENT ON FUNCTION public.get_reschedule_context(text, timestamptz, timestamptz) IS
    'V2-08 08-04a (R-16), 08-06a (S-6): the anon, token-scoped reschedule context: status, the clinic (with its time zone), the doctor and the visit''s current time. It never returns another appointment''s time (the free slots come from get_reschedule_slots). p_from and p_to are accepted for compatibility and ignored.';

-- 7. A-5: invoice and payment changes signal the Today board ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.today_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- A Realtime fault must never roll back the clinical write: every error below is swallowed.
    BEGIN
        IF TG_TABLE_NAME = 'visits' THEN
            PERFORM private.today_signal_send(NEW.tenant_id, 'visit', NEW.id);
        ELSIF TG_TABLE_NAME = 'queue_tokens' THEN
            PERFORM private.today_signal_send(NEW.tenant_id, 'queue', NEW.visit_id);
        ELSIF TG_TABLE_NAME = 'clinical_notes' THEN
            PERFORM private.today_signal_send(NEW.tenant_id, 'vitals', NEW.visit_id);
        ELSIF TG_TABLE_NAME = 'invoices' THEN
            PERFORM private.today_signal_send(NEW.tenant_id, 'invoice', NEW.visit_id);
        ELSIF TG_TABLE_NAME = 'payments' THEN
            PERFORM private.today_signal_send(
                NEW.tenant_id, 'payment',
                (SELECT i.visit_id FROM public.invoices i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.invoice_id));
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
    RETURN NULL;
END;
$$;
COMMENT ON FUNCTION private.today_signal() IS
    'V2-08 08-03a (R-10), 08-06a (A-5): AFTER row trigger function behind the Today signals (visits, queue_tokens, invoices, payments, the vitals of clinical_notes). Sends {kind, visit_id} only and swallows every Realtime error so a clinical write is never rolled back by it.';

CREATE TRIGGER invoices_today_signal_insert
    AFTER INSERT ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION private.today_signal();
CREATE TRIGGER invoices_today_signal_update
    AFTER UPDATE OF total_amount, status ON public.invoices
    FOR EACH ROW
    WHEN (OLD.total_amount IS DISTINCT FROM NEW.total_amount OR OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION private.today_signal();

-- 8. S-7: the Realtime read policy also checks the row's own topic ----------------------------------------------------------------------
DROP POLICY today_signals_select ON realtime.messages;
CREATE POLICY today_signals_select ON realtime.messages
    FOR SELECT TO authenticated
    USING (extension = 'broadcast' AND topic = realtime.topic() AND authz.today_topic_allowed(topic));

-- 9. S-3: the metadata of a visit, written directly, is an AI-provenance draft field only -----------------------------------------------
CREATE FUNCTION private.visits_metadata_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_key text;
    v_el jsonb;
BEGIN
    -- Only a direct write by a signed-in member through the API role is restricted here. The definer commands run as the
    -- function owner and the service role is not a member; both keep their own rules.
    IF current_user <> 'authenticated' THEN
        RETURN NEW;
    END IF;
    -- The draft save writes the AI provenance of an open consultation, as a clinician: nothing else on this column.
    IF NOT public.has_permission(OLD.tenant_id, 'consultations:edit') THEN
        RAISE EXCEPTION 'VISIT_METADATA_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    -- A closed, cancelled or signed visit (the draft save's own filter) keeps its metadata.
    IF OLD.status IN ('completed', 'cancelled') OR (OLD.signed_at IS NOT NULL AND OLD.status <> 'in_consultation') THEN
        RAISE EXCEPTION 'VISIT_METADATA_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(NEW.metadata) <> 'object' OR octet_length(NEW.metadata::text) > 8192 THEN
        RAISE EXCEPTION 'VISIT_METADATA_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    -- Only the two provenance keys may change (the confirmation and cancellation keys belong to the commands).
    FOR v_key IN
        SELECT k.key FROM (SELECT jsonb_object_keys(coalesce(OLD.metadata, '{}'::jsonb)) AS key
                           UNION
                           SELECT jsonb_object_keys(NEW.metadata)) k
         WHERE (OLD.metadata -> k.key) IS DISTINCT FROM (NEW.metadata -> k.key)
    LOOP
        IF v_key NOT IN ('ai_assisted', 'ai_sections_used') THEN
            RAISE EXCEPTION 'VISIT_METADATA_FORBIDDEN' USING ERRCODE = '42501';
        END IF;
    END LOOP;
    IF NEW.metadata ? 'ai_assisted' AND jsonb_typeof(NEW.metadata -> 'ai_assisted') <> 'boolean' THEN
        RAISE EXCEPTION 'VISIT_METADATA_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF NEW.metadata ? 'ai_sections_used' THEN
        IF jsonb_typeof(NEW.metadata -> 'ai_sections_used') <> 'array' OR jsonb_array_length(NEW.metadata -> 'ai_sections_used') > 20 THEN
            RAISE EXCEPTION 'VISIT_METADATA_FORBIDDEN' USING ERRCODE = '42501';
        END IF;
        FOR v_el IN SELECT e.value FROM jsonb_array_elements(NEW.metadata -> 'ai_sections_used') e LOOP
            IF jsonb_typeof(v_el) <> 'string' OR char_length(v_el #>> '{}') > 40 THEN
                RAISE EXCEPTION 'VISIT_METADATA_FORBIDDEN' USING ERRCODE = '42501';
            END IF;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.visits_metadata_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.visits_metadata_guard() IS
    'V2-08 08-06a (S-3): BEFORE UPDATE OF metadata trigger function (invoker). A direct write by a signed-in member (current_user authenticated) needs consultations:edit, an open draft (not completed, cancelled, or signed outside an amendment), only ai_assisted (boolean) and ai_sections_used (up to 20 strings of 40 characters) changed, and at most 8 KB. VISIT_METADATA_FORBIDDEN (42501). The definer commands and the service role are not restricted by it.';

CREATE TRIGGER visits_metadata_guard
    BEFORE UPDATE OF metadata ON public.visits
    FOR EACH ROW
    WHEN (OLD.metadata IS DISTINCT FROM NEW.metadata)
    EXECUTE FUNCTION private.visits_metadata_guard();

-- 10. S-1, S-2, S-8: the commands are the writers --------------------------------------------------------------------------------------
-- Request-path writers of these tables (08-NOTES, 08-06a inventory): none inserts a visit, a patient or a waitlist entry, and none
-- updates a waitlist entry; the definer commands (enqueue_walk_in, register_and_book, register_patient, add_to_waitlist,
-- promote_waitlist_entry, cancel_visit) and the service role (/api/v1, webhooks, seeds) are unaffected.
REVOKE INSERT ON public.visits FROM authenticated;
REVOKE INSERT, UPDATE ON public.waitlist_entries FROM authenticated;
REVOKE INSERT ON public.patients FROM authenticated;
