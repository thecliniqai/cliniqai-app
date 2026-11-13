-- Migration: 000029_actor_guards_probe_scrub.sql
-- V2-03 plan 03-13c: review fixes in the database (03-13-REVIEW-TRIAGE.md H-PAY, M-AUDITSYS, M-PROBE, M-SCRUB DB half,
-- Low "record_payment outbox inside a savepoint", Low "DB ingest truncates after scrubbing").
--
-- Expand only: two triggers, two partial indexes, one replaced probe function, one new scrub helper and new bodies for
-- record_payment, private.outbox_payment_recorded and ops_ingest_error. No column, table or row is dropped.
--
-- Which writers are "user" writers. The two triggers below act only when `current_user` is an API role (`authenticated`
-- or `anon`): a direct PostgREST write, or a SECURITY INVOKER function such as record_payment called by a user. The
-- service role (system path) and SECURITY DEFINER functions owned by `postgres` (reviewed code) are left alone.
--
-- 1. H-PAY (review B H-1). A staff member could INSERT into payments through PostgREST with another user's id in
--    recorded_by and any command_id; record_payment then replayed that forged row as its own. Now:
--      * `payments_actor_guard` (BEFORE INSERT) forces recorded_by := auth.uid() and recorded_by_system := NULL for a
--        user writer (no session = refused), and refuses a command_id that record_payment did not write itself (the
--        command marks the payment id it is inserting in the transaction-local setting `clinicos.record_payment_id`).
--      * record_payment replays a command only when the stored row has the same actor (user id or system actor);
--        another actor's row with that command id is IDEMPOTENCY_MISMATCH.
--    Overpayment and status changes through direct table writes stay with the V2-07 contract step (accepted, triage).
-- 2. M-AUDITSYS (review B M-2). `audit_logs_actor_guard` (BEFORE INSERT) forces actor_type := 'user',
--    actor_id := auth.uid(), api_key_id := NULL, actor_role := the caller's role in that tenant and strips a
--    `system_actor` metadata key for a user writer, so a direct insert cannot imitate the system or another user.
-- 3. Low (review B L-1, IND L-9). private.outbox_payment_recorded accepted only a row whose xmin was the top-level
--    transaction id, so record_payment always failed inside a savepoint or a plpgsql exception block. It now accepts
--    exactly the payment id record_payment marked in `clinicos.record_payment_id` for this call.
-- 4. M-PROBE (review A M-2, B M-1, B L-4). readiness_probe() returned platform-wide queue counts and the live migration
--    version to anyone holding the publishable key, and one of its counts was a sequential scan of the whole message
--    table. It is replaced by readiness_probe(p_expected_migration) returning booleans only, each an EXISTS served by an
--    index (two new partial indexes on updated_at for failed rows). EXECUTE is granted to anon only: /api/ready calls it
--    through the cookie-less public client. `schema_current` answers "is this exact migration applied?" for the version
--    the deployed app was built with; it never returns a version.
-- 5. M-SCRUB DB half (review C M-2, C L-3/L-5, B L-2/L-3). ops_ingest_error's second scrub now runs the same pattern list
--    as the app scrubber (lib/observability/scrub.ts) through `ops.scrub_text`, proven by the shared vectors in
--    tests/fixtures/scrub-vectors.json: Unicode digits normalised; Postgres `Key (…)=(…)` (expression indexes, values
--    with parentheses or newlines) and multi-line `Failing row contains (…)`; quoted values; `sb_secret_` /
--    `sb_publishable_`; bearer and JWT tokens; emails without a TLD or with Unicode (`…@abdm`, `…@localhost`); query
--    strings and fragments; share and reschedule path tokens; storage keys; UUIDs; spaced, dashed, dotted and bracketed
--    phone, Aadhaar and ABHA numbers; digit runs of 6+; long tokens (16+ with a digit, 24+ without); PAN. error_name and
--    error_code are no longer stored as sent: a name that is not a plain class name becomes `Error`, a code that is not
--    a SQLSTATE / PGRST / upper-case constant becomes NULL. A concrete route (a segment that is not a pattern or a
--    lowercase slug) is stored as NULL. The message is cut to 500 characters AFTER the scrub (a scrub that lengthened
--    text used to break the table CHECK and drop the event); input up to 2000 characters is accepted for that reason.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. payments: actor guard (H-PAY)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.payments_actor_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF current_user IN ('authenticated', 'anon') THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
        END IF;
        NEW.recorded_by := auth.uid();
        NEW.recorded_by_system := NULL;
        -- A command id is written only by record_payment, which marks the id of the payment it is inserting.
        IF NEW.command_id IS NOT NULL
           AND current_setting('clinicos.record_payment_id', true) IS DISTINCT FROM NEW.id::text THEN
            RAISE EXCEPTION 'COMMAND_ID_RPC_ONLY' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.payments_actor_guard() IS
    'V2-03 03-13c (H-PAY): for API-role writers forces recorded_by = auth.uid(), clears recorded_by_system and refuses a command_id not written by record_payment.';

REVOKE ALL ON FUNCTION private.payments_actor_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER payments_actor_guard
    BEFORE INSERT ON public.payments
    FOR EACH ROW EXECUTE FUNCTION private.payments_actor_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. audit_logs: actor guard (M-AUDITSYS)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.audit_logs_actor_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
BEGIN
    IF current_user IN ('authenticated', 'anon') THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
        END IF;
        NEW.actor_id := auth.uid();
        NEW.actor_type := 'user';
        NEW.api_key_id := NULL;
        IF NEW.metadata IS NOT NULL AND jsonb_typeof(NEW.metadata) = 'object' THEN
            NEW.metadata := NEW.metadata - 'system_actor';
        END IF;
        SELECT m.role INTO v_role
        FROM public.memberships m
        WHERE m.tenant_id = NEW.tenant_id
          AND m.user_id = auth.uid();
        IF v_role IS NOT NULL THEN
            NEW.actor_role := v_role;
        ELSIF NEW.actor_role = 'system' THEN
            RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.audit_logs_actor_guard() IS
    'V2-03 03-13c (M-AUDITSYS): for API-role writers forces actor_type = user, actor_id = auth.uid(), the caller''s membership role, no api_key_id and no system_actor metadata.';

REVOKE ALL ON FUNCTION private.audit_logs_actor_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_logs_actor_guard
    BEFORE INSERT ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION private.audit_logs_actor_guard();

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Outbox subject check without xmin (Low: savepoints)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.outbox_payment_recorded(p_payment_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payment RECORD;
    v_invoice RECORD;
    v_paid NUMERIC;
    v_body TEXT;
    v_count INTEGER;
BEGIN
    -- Only the payment record_payment is inserting in this call (it sets the marker just before its INSERT, inside
    -- the same function call, savepoint or not). A replayed or older payment id is refused.
    IF p_payment_id IS NULL
       OR current_setting('clinicos.record_payment_id', true) IS DISTINCT FROM p_payment_id::text THEN
        RAISE EXCEPTION 'OUTBOX_SUBJECT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT p.id, p.tenant_id, p.invoice_id, p.amount, p.payment_method, p.recorded_at
    INTO v_payment
    FROM public.payments p
    WHERE p.id = p_payment_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'OUTBOX_SUBJECT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.memberships m
        WHERE m.tenant_id = v_payment.tenant_id
          AND m.user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'OUTBOX_SUBJECT_INVALID' USING ERRCODE = 'P0001';
    END IF;

    SELECT i.status, i.total_amount INTO v_invoice
    FROM public.invoices i
    WHERE i.id = v_payment.invoice_id;

    SELECT COALESCE(sum(p.amount), 0) INTO v_paid
    FROM public.payments p
    WHERE p.invoice_id = v_payment.invoice_id
      AND p.tenant_id = v_payment.tenant_id;

    -- The standard envelope ({ id, event, created_at, data }) stored as raw text once, so the HMAC is stable across
    -- retries. Ids, amounts and statuses only: no patient field.
    v_body := jsonb_build_object(
        'id', gen_random_uuid(),
        'event', 'payment.recorded',
        'created_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'data', jsonb_build_object(
            'payment_id', v_payment.id,
            'invoice_id', v_payment.invoice_id,
            'amount', v_payment.amount,
            'payment_method', v_payment.payment_method,
            'recorded_at', to_char(v_payment.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'invoice_status', v_invoice.status,
            'paid_total', v_paid
        )
    )::text;

    INSERT INTO public.webhook_delivery_queue
        (tenant_id, subscription_id, event_type, payload, status, retry_count, max_retries, next_retry_at)
    SELECT v_payment.tenant_id, s.id, 'payment.recorded', v_body, 'pending', 0, 5, now()
    FROM public.webhook_subscriptions s
    WHERE s.tenant_id = v_payment.tenant_id
      AND s.is_active
      AND s.event_types @> ARRAY['payment.recorded'];

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION private.outbox_payment_recorded(UUID) IS
    'V2-03 03-07/03-13c: payment.recorded outbox fan-out for the payment record_payment is inserting in this call (marker clinicos.record_payment_id; works inside savepoints).';

REVOKE ALL ON FUNCTION private.outbox_payment_recorded(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.outbox_payment_recorded(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. record_payment: marker, same-actor replay (H-PAY) — body otherwise as 000027
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_payment(
    p_tenant_id UUID,
    p_invoice_id UUID,
    p_amount NUMERIC,
    p_method TEXT,
    p_reference TEXT,
    p_command_id UUID,
    p_notes TEXT DEFAULT NULL,
    p_system_actor TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_is_system BOOLEAN;
    v_actor_role TEXT;
    v_invoice RECORD;
    v_existing RECORD;
    v_paid NUMERIC;
    v_payment_id UUID;
    v_new_status TEXT;
    v_reference TEXT := NULLIF(btrim(p_reference), '');
    v_notes TEXT := NULLIF(btrim(p_notes), '');
BEGIN
    -- 1. Actor. User path: a session (auth.uid()) and no system actor. System path (TARGET §7.1): the service role,
    --    no session, and a system actor from the closed set.
    IF v_uid IS NOT NULL AND p_system_actor IS NULL THEN
        v_is_system := false;
    ELSIF v_uid IS NULL
        AND current_user = 'service_role'
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

    -- 3. Lock the aggregate root, in the active tenant only.
    SELECT i.id, i.tenant_id, i.total_amount, i.status
    INTO v_invoice
    FROM public.invoices i
    WHERE i.id = p_invoice_id
      AND i.tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- 4. Role. Mirrors ROLE_PERMISSIONS "appointments:edit" until V2-05 has_permission().
    IF NOT v_is_system THEN
        IF NOT public.current_user_has_role(
            v_invoice.tenant_id,
            ARRAY['owner', 'admin', 'doctor', 'receptionist', 'nurse']
        ) THEN
            RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
        END IF;

        SELECT m.role INTO v_actor_role
        FROM public.memberships m
        WHERE m.tenant_id = v_invoice.tenant_id
          AND m.user_id = v_uid;
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
                'replayed', true
            );
        END IF;
    END IF;

    -- 6. Invariants.
    IF v_invoice.status NOT IN ('draft', 'issued') THEN
        RAISE EXCEPTION 'INVOICE_NOT_PAYABLE' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(sum(p.amount), 0) INTO v_paid
    FROM public.payments p
    WHERE p.invoice_id = v_invoice.id
      AND p.tenant_id = v_invoice.tenant_id;

    IF p_amount > v_invoice.total_amount - v_paid THEN
        RAISE EXCEPTION 'OVERPAYMENT' USING ERRCODE = 'P0001';
    END IF;

    -- 7. Payment. The id is chosen here and marked transaction-locally for the actor guard and the outbox writer; the
    --    function's own SET clauses restore the setting when the call ends. The user path never names
    --    recorded_by_system (no column privilege).
    v_payment_id := gen_random_uuid();
    PERFORM set_config('clinicos.record_payment_id', v_payment_id::text, true);

    IF v_is_system THEN
        INSERT INTO public.payments
            (id, tenant_id, invoice_id, amount, payment_method, reference_number, notes, recorded_by_system, command_id)
        VALUES
            (v_payment_id, v_invoice.tenant_id, v_invoice.id, p_amount, p_method, v_reference, v_notes, p_system_actor,
             p_command_id);
    ELSE
        INSERT INTO public.payments
            (id, tenant_id, invoice_id, amount, payment_method, reference_number, notes, recorded_by, command_id)
        VALUES
            (v_payment_id, v_invoice.tenant_id, v_invoice.id, p_amount, p_method, v_reference, v_notes, v_uid,
             p_command_id);
    END IF;

    -- 8. Status transition.
    v_paid := v_paid + p_amount;
    v_new_status := CASE WHEN v_paid >= v_invoice.total_amount THEN 'paid' ELSE v_invoice.status END;

    IF v_new_status <> v_invoice.status THEN
        UPDATE public.invoices
        SET status = v_new_status, updated_at = now()
        WHERE id = v_invoice.id;
    END IF;

    -- 9. Audit (same transaction; actor = auth.uid(), or the system actor).
    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, actor_type, action, entity_type, entity_id, metadata)
    VALUES (
        v_invoice.tenant_id,
        v_uid,
        CASE WHEN v_is_system THEN 'system' ELSE v_actor_role END,
        CASE WHEN v_is_system THEN 'system' ELSE 'user' END,
        'invoice.payment_recorded',
        'payment',
        v_payment_id,
        jsonb_build_object(
            'invoice_id', v_invoice.id,
            'payment_method', p_method,
            'old_status', v_invoice.status,
            'new_status', v_new_status
        ) || CASE WHEN v_is_system THEN jsonb_build_object('system_actor', p_system_actor) ELSE '{}'::jsonb END
    );

    -- 10. Outbox (same transaction), then clear the marker.
    PERFORM private.outbox_payment_recorded(v_payment_id);
    PERFORM set_config('clinicos.record_payment_id', '', true);

    RETURN jsonb_build_object(
        'payment_id', v_payment_id,
        'invoice_status', v_new_status,
        'paid_total', v_paid,
        'total_amount', v_invoice.total_amount,
        'balance_due', GREATEST(v_invoice.total_amount - v_paid, 0),
        'replayed', false
    );
END;
$$;

COMMENT ON FUNCTION public.record_payment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, TEXT) IS
    'V2-03 03-07/03-13c (D1 spike): records a payment atomically under the caller''s RLS: lock, invariants, payment, status, audit and outbox in one transaction; replays only the same actor''s command.';

REVOKE ALL ON FUNCTION public.record_payment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Readiness: booleans only, indexed, anon only (M-PROBE)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_comm_queue_failed_updated
    ON public.communication_queue (updated_at)
    WHERE status IN ('failed', 'dead_letter');

CREATE INDEX IF NOT EXISTS idx_webhook_queue_failed_updated
    ON public.webhook_delivery_queue (updated_at)
    WHERE status = 'failed';

DROP FUNCTION IF EXISTS public.readiness_probe();

CREATE OR REPLACE FUNCTION public.readiness_probe(p_expected_migration TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_since TIMESTAMPTZ := now() - INTERVAL '24 hours';
    v_due TIMESTAMPTZ := now() - INTERVAL '15 minutes';
BEGIN
    RETURN jsonb_build_object(
        'db', true,
        -- Only an exact six-digit version is looked up (primary key); anything else answers null.
        'schema_current', CASE
            WHEN p_expected_migration IS NULL OR p_expected_migration !~ '^[0-9]{6}$' THEN NULL
            ELSE EXISTS (
                SELECT 1 FROM supabase_migrations.schema_migrations m WHERE m.version = p_expected_migration
            )
        END,
        -- Each flag is one EXISTS over an index: idx_comm_queue_dispatch / idx_webhook_queue_status_retry for the
        -- backlog, idx_comm_queue_failed_updated / idx_webhook_queue_failed_updated for recent failures.
        'messages_backlog', EXISTS (
            SELECT 1 FROM public.communication_queue q
            WHERE q.status IN ('pending', 'processing') AND q.next_retry_at < v_due
        ),
        'messages_failed_24h', EXISTS (
            SELECT 1 FROM public.communication_queue q
            WHERE q.status IN ('failed', 'dead_letter') AND q.updated_at >= v_since
        ),
        'webhooks_backlog', EXISTS (
            SELECT 1 FROM public.webhook_delivery_queue w
            WHERE w.status = 'pending' AND w.next_retry_at < v_due
        ),
        'webhooks_failed_24h', EXISTS (
            SELECT 1 FROM public.webhook_delivery_queue w
            WHERE w.status = 'failed' AND w.updated_at >= v_since
        )
    );
END;
$$;

COMMENT ON FUNCTION public.readiness_probe(TEXT) IS
    'V2-03 03-01/03-13c: readiness booleans for /api/ready (no counts, no version; each flag an indexed EXISTS). anon only.';

REVOKE ALL ON FUNCTION public.readiness_probe(TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.readiness_probe(TEXT) TO anon;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Error sink: the shared scrub (M-SCRUB DB half)
-- ---------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ops.scrub_text(p_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v TEXT := coalesce(p_text, '');
    v_run TEXT;
BEGIN
    -- Work bound (the app's MAX_SCAN): text beyond 4000 characters is never scanned.
    v := left(v, 4000);
    -- Digits: NFKC (full-width → ASCII), then any other decimal digit (Indic, Arabic-Indic) → 0, as the app does.
    v := translate(normalize(v, NFKC),
        '०१२३४५६७८९০১২৩৪৫৬৭৮৯੦੧੨੩੪੫੬੭੮੯૦૧૨૩૪૫૬૭૮૯୦୧୨୩୪୫୬୭୮୯௦௧௨௩௪௫௬௭௮௯౦౧౨౩౪౫౬౭౮౯೦೧೨೩೪೫೬೭೮೯൦൧൨൩൪൫൬൭൮൯٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
        repeat('0', 110));

    -- The rules of SCRUB_RULES (lib/observability/scrub.ts), in its order, under its ids. `.` crosses newlines here.
    -- pg_key_detail: keep the column list (expression indexes included), redact the value to the end of the text.
    v := regexp_replace(v, 'Key \(([^=\n]{0,200})\)=\(.*$', 'Key (\1)=([REDACTED])');
    -- pg_failing_row
    v := regexp_replace(v, 'Failing row contains \(.*$', 'Failing row contains ([REDACTED])');
    -- quoted_value, quoted_value_single
    v := regexp_replace(v, ':[[:space:]]*"[^"]*"', ': "[VALUE]"', 'g');
    v := regexp_replace(v, ':[[:space:]]*''[^'']*''', ': ''[VALUE]''', 'g');
    -- credential, jwt, supabase_key
    v := regexp_replace(v, '\m(Bearer|Basic)[[:space:]]+[A-Za-z0-9._~+/=-]+', '\1 [TOKEN]', 'gi');
    v := regexp_replace(v, '\meyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(\.[A-Za-z0-9_-]*)?', '[TOKEN]', 'g');
    v := regexp_replace(v, '\msb_(secret|publishable)_[A-Za-z0-9_-]*', '[KEY]', 'g');
    -- email (IDN, localhost, ABHA `name@abdm`: no TLD needed)
    v := regexp_replace(v, '[^][:space:]@<>"''(),;:[]+@[^][:space:]@<>"''(),;:[]+', '[EMAIL]', 'g');
    -- query, fragment
    v := regexp_replace(v, '\?[^[:space:]"''<>]+', '?[QUERY]', 'g');
    v := regexp_replace(v, '#[^[:space:]"''<>]*=[^[:space:]"''<>]*', '#[FRAGMENT]', 'g');
    -- path_token
    v := regexp_replace(v, '/(r|reschedule|api/r|reports/view)/[^[:space:]/?#"''<>]+', '/\1/[TOKEN]', 'g');
    -- uuid
    v := regexp_replace(v, '\m[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\M', '[UUID]', 'g');
    -- token (16+ token characters with a digit and a letter), token_letters (24+ with both letter cases)
    FOR v_run IN SELECT DISTINCT m[1] FROM regexp_matches(v, '([A-Za-z0-9_-]{16,})', 'g') AS r(m) LOOP
        IF (v_run ~ '[0-9]' AND v_run ~ '[A-Za-z]')
           OR (char_length(v_run) >= 24 AND v_run ~ '[a-z]' AND v_run ~ '[A-Z]') THEN
            v := replace(v, v_run, '[TOKEN]');
        END IF;
    END LOOP;
    -- pan
    v := regexp_replace(v, '\m[A-Za-z]{5}[0-9]{4}[A-Za-z]\M', '[PAN]', 'g');
    -- abha_number (2-4-4-4)
    v := regexp_replace(v, '\m[0-9]{2}-[0-9]{4}-[0-9]{4}-[0-9]{4}\M', '[ABHA REDACTED]', 'g');
    -- mobile, mobile_3_3_4 (+91 / 0 prefixed, bare, spaced or dashed; never the tail of a longer number)
    v := regexp_replace(v, '(?<![0-9])(\+?91[[:space:]-]?|0)?[6-9][0-9]{4}[[:space:]-]?[0-9]{5}(?![0-9])', '[PHONE REDACTED]', 'g');
    v := regexp_replace(v, '(?<![0-9])(\+?91[[:space:]-]?|0)?[6-9][0-9]{2}[[:space:]-][0-9]{3}[[:space:]-][0-9]{4}(?![0-9])', '[PHONE REDACTED]', 'g');
    -- aadhaar (4-4-4, any separator)
    v := regexp_replace(v, '(?<![0-9])[0-9]{4}[[:space:].-]?[0-9]{4}[[:space:].-]?[0-9]{4}(?![0-9])', '[AADHAAR REDACTED]', 'g');
    -- separated_number: 8+ digits, each followed by up to three of space . - _ ( )
    v := regexp_replace(v, '\+?\(?[0-9]([[:space:]._()-]{0,3}[0-9]){7,}\)?', '[NUMBER]', 'g');
    -- digit_run
    v := regexp_replace(v, '[0-9]{6,}', '[NUMBER]', 'g');
    -- One line.
    v := btrim(regexp_replace(v, '[[:space:]]+', ' ', 'g'));
    RETURN v;
END;
$$;

COMMENT ON FUNCTION ops.scrub_text(TEXT) IS
    'V2-03 03-13c (M-SCRUB): the database second-line scrub; same pattern list as lib/observability/scrub.ts, proven by tests/fixtures/scrub-vectors.json. Does not cut: callers truncate after it.';

REVOKE ALL ON FUNCTION ops.scrub_text(TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ops_ingest_error(p_ingest_key TEXT, p_event JSONB)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '1s'
AS $$
DECLARE
    v_expected TEXT;
    v_today DATE := (now() AT TIME ZONE 'UTC')::date;
    v_key TEXT;
    v_environment TEXT;
    v_release TEXT;
    v_route_path TEXT;
    v_route_type TEXT;
    v_method TEXT;
    v_error_name TEXT;
    v_error_code TEXT;
    v_digest TEXT;
    v_message TEXT;
    v_frames TEXT[] := '{}';
    v_frame TEXT;
    v_frame_json JSONB;
    v_segment TEXT;
    v_request_id UUID;
    v_tenant_id UUID;
    v_user_id UUID;
    v_fingerprint TEXT;
    v_new_today INTEGER;
BEGIN
    -- Authentication: the key's SHA-256 against the vault secret. The key itself is never stored or echoed.
    SELECT lower(btrim(s.decrypted_secret)) INTO v_expected
    FROM vault.decrypted_secrets s
    WHERE s.name = 'ops_error_ingest_key_sha256'
    ORDER BY s.created_at DESC
    LIMIT 1;

    IF v_expected IS NULL OR v_expected !~ '^[0-9a-f]{64}$'
       OR p_ingest_key IS NULL OR char_length(p_ingest_key) < 32 OR char_length(p_ingest_key) > 256
       OR encode(extensions.digest(p_ingest_key, 'sha256'), 'hex') <> v_expected THEN
        RAISE EXCEPTION 'ingest_refused' USING ERRCODE = '42501';
    END IF;

    -- Shape: a JSON object of at most 16 KiB with known keys only.
    IF p_event IS NULL OR jsonb_typeof(p_event) <> 'object' OR pg_column_size(p_event) > 16384 THEN
        RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_event) LOOP
        IF v_key NOT IN ('environment', 'release', 'route_path', 'route_type', 'method', 'error_name', 'error_code',
                         'digest', 'message', 'frames', 'request_id', 'tenant_id', 'user_id') THEN
            RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
        END IF;
        IF v_key <> 'frames' AND jsonb_typeof(p_event -> v_key) NOT IN ('string', 'null') THEN
            RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
        END IF;
    END LOOP;

    v_environment := p_event ->> 'environment';
    v_release := p_event ->> 'release';
    v_route_path := p_event ->> 'route_path';
    v_route_type := p_event ->> 'route_type';
    v_method := p_event ->> 'method';
    v_error_name := p_event ->> 'error_name';
    v_error_code := p_event ->> 'error_code';
    v_digest := p_event ->> 'digest';
    v_message := coalesce(p_event ->> 'message', '');

    -- error_name and error_code are checked for type and size only here; their content is decided below.
    IF v_environment IS NULL OR v_environment NOT IN ('development', 'test', 'e2e', 'ci', 'staging', 'production')
       OR (v_release IS NOT NULL AND v_release !~ '^[0-9a-f]{7,40}$')
       OR (v_route_path IS NOT NULL AND v_route_path !~ '^/[A-Za-z0-9_./()\[\]@~+-]{0,199}$')
       OR (v_route_type IS NOT NULL AND v_route_type NOT IN ('render', 'route', 'action', 'proxy'))
       OR (v_method IS NOT NULL AND v_method !~ '^[A-Z]{1,10}$')
       OR v_error_name IS NULL OR char_length(v_error_name) NOT BETWEEN 1 AND 200
       OR (v_error_code IS NOT NULL AND char_length(v_error_code) > 200)
       OR (v_digest IS NOT NULL AND v_digest !~ '^[A-Za-z0-9_-]{1,64}$')
       OR char_length(v_message) > 2000 THEN
        RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
    END IF;

    IF p_event ? 'frames' AND jsonb_typeof(p_event -> 'frames') <> 'null' THEN
        IF jsonb_typeof(p_event -> 'frames') <> 'array' OR jsonb_array_length(p_event -> 'frames') > 20 THEN
            RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
        END IF;
        FOR v_frame_json IN SELECT f FROM jsonb_array_elements(p_event -> 'frames') AS a(f) LOOP
            IF jsonb_typeof(v_frame_json) <> 'string' THEN
                RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
            END IF;
            v_frame := v_frame_json #>> '{}';
            IF v_frame !~ '^[A-Za-z0-9_./()\[\]@~+:-]{1,200}:[0-9]{1,7}$' THEN
                RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
            END IF;
            v_frames := v_frames || v_frame;
        END LOOP;
    END IF;

    BEGIN
        v_request_id := (p_event ->> 'request_id')::uuid;
        v_tenant_id := (p_event ->> 'tenant_id')::uuid;
        v_user_id := (p_event ->> 'user_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'invalid_event' USING ERRCODE = '22023';
    END;

    -- Second scrub behind the app's (lib/observability/scrub.ts), then the cut (never cut first: a cut can split a
    -- value the scrub would have caught, and the scrub can lengthen text past the column CHECK).
    v_message := left(ops.scrub_text(v_message), 500);

    -- error_name / error_code as lib/observability/error-event.ts keeps them (NAME_PATTERN, CODE_PATTERN,
    -- IDENTIFIER_SHAPED): a name that is not name-shaped or could carry an identifier becomes the class default
    -- `Error`; a code that is not a SQLSTATE, a PostgREST code or an upper-snake constant is not stored.
    IF v_error_name !~ '^[A-Za-z0-9_.$-]{1,80}$' OR v_error_name ~ '[0-9]{6,}|@' THEN
        v_error_name := 'Error';
    END IF;
    IF v_error_code IS NOT NULL AND (
        v_error_code !~ '^([0-9A-Z]{5}|PGRST[0-9]{1,4}|[A-Z][A-Z0-9_]{2,39})$' OR v_error_code ~ '[0-9]{6,}|@'
    ) THEN
        v_error_code := NULL;
    END IF;
    -- route_path as routePattern (lib/observability/scrub.ts) keeps it: every segment a dynamic segment, a route group,
    -- a slot or a lower-case static slug whose only digits are a short version suffix (`v1`). A concrete path (an id,
    -- phone or token segment) is not stored.
    IF v_route_path IS NOT NULL AND v_route_path <> '/' THEN
        FOREACH v_segment IN ARRAY string_to_array(substr(v_route_path, 2), '/') LOOP
            IF v_segment !~ '^(\[{1,2}(\.\.\.)?[A-Za-z0-9_]{1,40}\]{1,2}|\([a-z0-9_.-]{1,40}\)|@[a-z][a-z0-9_-]{0,39}|[a-z0-9_.-]{1,40})$'
               OR (left(v_segment, 1) <> '[' AND v_segment ~ '[0-9]' AND v_segment !~ '^[a-z]{1,6}[0-9]{1,2}$') THEN
                v_route_path := NULL;
                EXIT;
            END IF;
        END LOOP;
    END IF;

    v_fingerprint := encode(extensions.digest(concat_ws(chr(31),
        v_environment, coalesce(v_route_path, ''), coalesce(v_route_type, ''), coalesce(v_method, ''),
        v_error_name, coalesce(v_error_code, ''), v_message, array_to_string(v_frames[1:5], chr(30))
    ), 'sha256'), 'hex');

    -- A repeat of today's fingerprint: count it.
    UPDATE ops.error_events e
       SET count = e.count + 1,
           last_seen = now(),
           release = coalesce(v_release, e.release),
           digest = coalesce(v_digest, e.digest),
           request_id = coalesce(v_request_id, e.request_id),
           tenant_id = coalesce(v_tenant_id, e.tenant_id),
           user_id = coalesce(v_user_id, e.user_id)
     WHERE e.fingerprint = v_fingerprint AND e.occurred_on = v_today;
    IF FOUND THEN
        RETURN;
    END IF;

    -- A new fingerprint: serialise the cap check per day so concurrent callers cannot overshoot it.
    PERFORM pg_advisory_xact_lock(hashtext('ops.error_events.new'), (v_today - DATE '2000-01-01'));
    SELECT count(*) INTO v_new_today FROM ops.error_events e WHERE e.occurred_on = v_today;
    IF v_new_today >= ops.error_sink_daily_cap() THEN
        INSERT INTO ops.error_event_overflow AS o (day, dropped) VALUES (v_today, 1)
        ON CONFLICT (day) DO UPDATE SET dropped = o.dropped + 1;
        RETURN;
    END IF;

    INSERT INTO ops.error_events AS e (
        fingerprint, occurred_on, environment, release, route_path, route_type, method, error_name, error_code,
        digest, message, frames, request_id, tenant_id, user_id
    ) VALUES (
        v_fingerprint, v_today, v_environment, v_release, v_route_path, v_route_type, v_method, v_error_name,
        v_error_code, v_digest, v_message, v_frames, v_request_id, v_tenant_id, v_user_id
    )
    ON CONFLICT (fingerprint, occurred_on) DO UPDATE
       SET count = e.count + 1,
           last_seen = now(),
           release = coalesce(excluded.release, e.release),
           digest = coalesce(excluded.digest, e.digest),
           request_id = coalesce(excluded.request_id, e.request_id),
           tenant_id = coalesce(excluded.tenant_id, e.tenant_id),
           user_id = coalesce(excluded.user_id, e.user_id);
END;
$$;

COMMENT ON FUNCTION public.ops_ingest_error(TEXT, JSONB) IS
    'V2-03 03-09b/03-13c: error-sink ingest (anon-executable by design; refused without the ingest key whose SHA-256 is '
    'the vault secret ops_error_ingest_key_sha256). Closed event shape, shared scrub then cut, per-day fingerprint upsert, '
    'daily cap.';

REVOKE ALL ON FUNCTION public.ops_ingest_error(TEXT, JSONB) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ops_ingest_error(TEXT, JSONB) TO anon, authenticated;
