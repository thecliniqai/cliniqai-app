-- Migration: 000102_today_realtime.sql
-- V2-08 08-03a (R-10, T-08-01): live updates for the Today board as signal-only private broadcasts.
--
-- Design A of the plan (the spike passed on the pinned local stack: realtime.send and a SELECT policy on
-- realtime.messages work from a migration; tests/realtime/today-signals.spec.ts proves delivery and isolation).
--
-- 1. authz.today_topic_allowed(topic): the policy's test. A Realtime socket carries no x-clinicos-tenant header, so the
--    active-clinic helpers (authz.tenant_ids_with) cannot be used: this one reads the clinic from the topic
--    `today:<tenant_id>` and admits the caller only when they hold an ACTIVE membership of exactly that clinic, their
--    role holds appointments:view, and the clinic's access level is `full` (a locked or onboarding clinic receives
--    nothing). A topic of any other shape is refused.
-- 2. realtime.messages: one SELECT policy for `authenticated` (extension = 'broadcast', the helper above). No INSERT
--    policy: a browser cannot send on the channel; only the triggers below write to it.
-- 3. private.today_signal_send(tenant, kind, visit): the one place that calls realtime.send. Payload keys `kind` and
--    `visit_id` only (no name, no number, no clinical value): the board always re-reads through its normal RLS reads.
-- 4. private.today_signal(): the AFTER row trigger function (definer, search_path ''). The send sits in a nested
--    block that swallows every error, so a Realtime fault can never roll back a clinical write. Triggers:
--      visits         AFTER INSERT; AFTER UPDATE when status, scheduled_at or doctor_id changed   -> kind 'visit'
--      queue_tokens   AFTER INSERT or UPDATE                                                      -> kind 'queue'
--      payments       AFTER INSERT (visit through the invoice)                                    -> kind 'payment'
--      clinical_notes AFTER UPDATE when vitals changed                                            -> kind 'vitals'
-- Per-migration checklist: one new authz helper (EXECUTE: authenticated only), two new private definer functions (no API
-- grant), four triggers, one policy on realtime.messages. No table, column or data change; additive (an app build that
-- does not subscribe is unaffected).

-- 1. The policy's test -----------------------------------------------------------------------------------------------
CREATE FUNCTION authz.today_topic_allowed(p_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tenant uuid;
BEGIN
    IF p_topic IS NULL OR auth.uid() IS NULL
       OR p_topic !~ '^today:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN false;
    END IF;
    v_tenant := substr(p_topic, 7)::uuid;
    RETURN EXISTS (
        SELECT 1
          FROM public.memberships m
         WHERE m.user_id = auth.uid()
           AND m.tenant_id = v_tenant
           AND m.status = 'active'
           AND authz.role_has_permission(m.role, 'appointments:view')
           AND billing_internal.tenant_access_level(v_tenant, now()) = 'full'
    );
END;
$$;
REVOKE ALL ON FUNCTION authz.today_topic_allowed(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION authz.today_topic_allowed(text) TO authenticated;
COMMENT ON FUNCTION authz.today_topic_allowed(text) IS
    'V2-08 08-03a (R-10, T-08-01): true when the caller is an active member of the clinic named by a topic of the exact shape today:<tenant uuid>, holds appointments:view there, and the clinic access level is full. Used by the realtime.messages SELECT policy (a Realtime socket has no active-clinic header, so authz.tenant_ids_with cannot be used).';

-- 2. The policy ------------------------------------------------------------------------------------------------------
CREATE POLICY today_signals_select ON realtime.messages
    FOR SELECT TO authenticated
    USING (extension = 'broadcast' AND authz.today_topic_allowed(realtime.topic()));

-- 3. The one sender --------------------------------------------------------------------------------------------------
CREATE FUNCTION private.today_signal_send(p_tenant_id uuid, p_kind text, p_visit_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT realtime.send(jsonb_build_object('kind', p_kind, 'visit_id', p_visit_id), 'today', 'today:' || p_tenant_id::text, true)
$$;
REVOKE ALL ON FUNCTION private.today_signal_send(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.today_signal_send(uuid, text, uuid) IS
    'V2-08 08-03a (R-10): sends the PHI-free Today signal {kind, visit_id} as a private broadcast on today:<tenant>. Only private.today_signal calls it.';

-- 4. The trigger function and its triggers ------------------------------------------------------------------------------
CREATE FUNCTION private.today_signal()
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
REVOKE ALL ON FUNCTION private.today_signal() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.today_signal() IS
    'V2-08 08-03a (R-10): AFTER row trigger function behind the Today signals (visits, queue_tokens, payments, the vitals of clinical_notes). Sends {kind, visit_id} only and swallows every Realtime error so a clinical write is never rolled back by it.';

CREATE TRIGGER visits_today_signal_insert
    AFTER INSERT ON public.visits
    FOR EACH ROW EXECUTE FUNCTION private.today_signal();
CREATE TRIGGER visits_today_signal_update
    AFTER UPDATE OF status, scheduled_at, doctor_id ON public.visits
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status
          OR OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at
          OR OLD.doctor_id IS DISTINCT FROM NEW.doctor_id)
    EXECUTE FUNCTION private.today_signal();
CREATE TRIGGER queue_tokens_today_signal
    AFTER INSERT OR UPDATE ON public.queue_tokens
    FOR EACH ROW EXECUTE FUNCTION private.today_signal();
CREATE TRIGGER payments_today_signal
    AFTER INSERT ON public.payments
    FOR EACH ROW EXECUTE FUNCTION private.today_signal();
CREATE TRIGGER clinical_notes_today_signal
    AFTER UPDATE OF vitals ON public.clinical_notes
    FOR EACH ROW
    WHEN (OLD.vitals IS DISTINCT FROM NEW.vitals)
    EXECUTE FUNCTION private.today_signal();
