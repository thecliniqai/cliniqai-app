-- Migration: 000024_queue_payload_and_live_invoice.sql
-- V2-01 plan 01-10 (review round 3; reviews/review3-adversarial.md = AR3).
--
-- 1. AR3-N1 (closes AR2-L1): share links and tokens in communication_queue.
--    a. Members (role `authenticated`) keep SELECT only on the columns that carry no message payload, and INSERT only
--       on the columns an enqueue writes. They lose UPDATE and DELETE (and SELECT on template_params, metadata,
--       recipient_phone, error_message, external_message_id). anon loses everything. Dispatch state changes go through
--       communication_queue_claim / communication_queue_finish (SECURITY DEFINER) or the service role.
--    b. created_by (default auth.uid(), not insertable by members) records who enqueued a row. A member can claim for
--       sending only a row it enqueued itself (the payload it just built); the service role can claim any due row.
--    c. A trigger strips *_token keys from metadata on insert and redacts link-bearing values (URLs, *_url / *_token
--       keys, 64-hex tokens) in template_params and metadata once a row reaches a final status
--       (sent, delivered, read, dead_letter, cancelled). Existing rows are backfilled the same way.
-- 2. AR3-N2: one live invoice per visit. A partial unique index on invoices(tenant_id, visit_id) for every status but
--    'cancelled' (the void state). Pre-existing duplicates (none on the local stack at authoring time) are resolved
--    before the index is built: the invoice that carries payments (else the oldest) is kept and the others are set to
--    'cancelled' with a system audit row; a group in which more than one invoice carries payments aborts the migration
--    for manual reconciliation.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. communication_queue
-- ---------------------------------------------------------------------------------------------------------------------

ALTER TABLE public.communication_queue
    ADD COLUMN IF NOT EXISTS created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL;

-- Redacts link-bearing values in a message payload: any string containing an http(s) URL or a 64-hex token, and any
-- string under a key named url / *_url / token / *_token. Structure, ids and other values are kept.
CREATE OR REPLACE FUNCTION public.communication_payload_redact(p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_result JSONB;
    v_key TEXT;
    v_value JSONB;
BEGIN
    IF p IS NULL THEN
        RETURN NULL;
    END IF;

    IF jsonb_typeof(p) = 'object' THEN
        v_result := '{}'::jsonb;
        FOR v_key, v_value IN SELECT e.key, e.value FROM jsonb_each(p) AS e LOOP
            IF v_key ~* '(^|_)(url|token)$' AND jsonb_typeof(v_value) = 'string' THEN
                v_result := v_result || jsonb_build_object(v_key, '[redacted]');
            ELSE
                v_result := v_result || jsonb_build_object(v_key, public.communication_payload_redact(v_value));
            END IF;
        END LOOP;
        RETURN v_result;
    ELSIF jsonb_typeof(p) = 'array' THEN
        SELECT COALESCE(jsonb_agg(public.communication_payload_redact(a.elem) ORDER BY a.ord), '[]'::jsonb)
        INTO v_result
        FROM jsonb_array_elements(p) WITH ORDINALITY AS a(elem, ord);
        RETURN v_result;
    ELSIF jsonb_typeof(p) = 'string' THEN
        IF (p #>> '{}') ~* 'https?://' OR (p #>> '{}') ~ '[0-9a-fA-F]{64}' THEN
            RETURN to_jsonb('[redacted]'::TEXT);
        END IF;
        RETURN p;
    END IF;

    RETURN p;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.communication_payload_redact(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.communication_payload_redact(JSONB) TO service_role;

-- Removes top-level token keys (token, *_token) from a metadata object. Tokens are never needed to send a message.
CREATE OR REPLACE FUNCTION public.communication_metadata_strip_tokens(p JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN p
        ELSE COALESCE(
            (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(p) AS e WHERE e.key !~* '(^|_)token$'),
            '{}'::jsonb
        )
    END;
$$;

REVOKE EXECUTE ON FUNCTION public.communication_metadata_strip_tokens(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.communication_metadata_strip_tokens(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.communication_queue_scrub_payload()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.metadata := public.communication_metadata_strip_tokens(NEW.metadata);
    IF NEW.status IN ('sent', 'delivered', 'read', 'dead_letter', 'cancelled') THEN
        NEW.template_params := public.communication_payload_redact(NEW.template_params);
        NEW.metadata := public.communication_payload_redact(NEW.metadata);
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.communication_queue_scrub_payload() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS communication_queue_scrub_payload ON public.communication_queue;
CREATE TRIGGER communication_queue_scrub_payload
    BEFORE INSERT OR UPDATE ON public.communication_queue
    FOR EACH ROW EXECUTE FUNCTION public.communication_queue_scrub_payload();

-- Backfill (the trigger applies the same rules to every existing row).
UPDATE public.communication_queue SET updated_at = updated_at;

-- Grants: table-level privileges off, then column-level SELECT / INSERT for members.
REVOKE ALL ON TABLE public.communication_queue FROM PUBLIC, anon, authenticated;

GRANT SELECT (
    id, tenant_id, patient_id, appointment_id, channel, message_type, template_id, status,
    retry_count, max_retries, next_retry_at, sent_at, created_at, updated_at
) ON public.communication_queue TO authenticated;

GRANT INSERT (
    tenant_id, patient_id, appointment_id, channel, message_type, template_id, template_params,
    recipient_phone, recipient_user_id, max_retries, next_retry_at, metadata
) ON public.communication_queue TO authenticated;

GRANT ALL ON TABLE public.communication_queue TO service_role;

DROP POLICY IF EXISTS "communication_queue_tenant_isolation" ON public.communication_queue;
DROP POLICY IF EXISTS "communication_queue_select_member" ON public.communication_queue;
DROP POLICY IF EXISTS "communication_queue_insert_member" ON public.communication_queue;

CREATE POLICY "communication_queue_select_member"
ON public.communication_queue
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "communication_queue_insert_member"
ON public.communication_queue
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    AND created_by = auth.uid()
);

-- Claims one due row for sending (pending, or failed and due for retry) and returns it with its payload. A member may
-- claim only a row it enqueued itself in one of its tenants; a caller with no user (the service role: anon has no
-- EXECUTE) may claim any due row. The UPDATE is the claim, so two dispatchers never send the same row.
CREATE OR REPLACE FUNCTION public.communication_queue_claim(p_id UUID)
RETURNS SETOF public.communication_queue
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    RETURN QUERY
    UPDATE public.communication_queue q
    SET status = 'processing', updated_at = now()
    WHERE q.id = p_id
      AND q.status IN ('pending', 'failed')
      AND q.next_retry_at <= now()
      AND (
          v_uid IS NULL
          OR (q.created_by = v_uid AND q.tenant_id IN (SELECT public.current_user_tenant_ids()))
      )
    RETURNING q.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.communication_queue_claim(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.communication_queue_claim(UUID) TO authenticated, service_role;

-- Records the outcome of a claimed send. Success -> sent; failure -> failed with backoff (1, 5, 15 minutes) or
-- dead_letter once max_retries is reached. Same caller rule as the claim. Returns the new status and retry count.
CREATE OR REPLACE FUNCTION public.communication_queue_finish(
    p_id UUID,
    p_success BOOLEAN,
    p_external_message_id TEXT,
    p_error TEXT
)
RETURNS TABLE (new_status TEXT, new_retry_count INTEGER)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    RETURN QUERY
    UPDATE public.communication_queue q
    SET status = CASE
            WHEN p_success THEN 'sent'
            WHEN q.retry_count + 1 >= q.max_retries THEN 'dead_letter'
            ELSE 'failed'
        END,
        sent_at = CASE WHEN p_success THEN now() ELSE q.sent_at END,
        external_message_id = CASE WHEN p_success THEN left(p_external_message_id, 200) ELSE q.external_message_id END,
        retry_count = CASE WHEN p_success THEN q.retry_count ELSE q.retry_count + 1 END,
        next_retry_at = CASE
            WHEN p_success THEN q.next_retry_at
            WHEN q.retry_count + 1 <= 1 THEN now() + INTERVAL '1 minute'
            WHEN q.retry_count + 1 = 2 THEN now() + INTERVAL '5 minutes'
            ELSE now() + INTERVAL '15 minutes'
        END,
        error_message = CASE
            WHEN p_success THEN NULL
            ELSE left(COALESCE(NULLIF(p_error, ''), 'Delivery failed'), 500)
        END,
        updated_at = now()
    WHERE q.id = p_id
      AND q.status = 'processing'
      AND (
          v_uid IS NULL
          OR (q.created_by = v_uid AND q.tenant_id IN (SELECT public.current_user_tenant_ids()))
      )
    RETURNING q.status, q.retry_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.communication_queue_finish(UUID, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.communication_queue_finish(UUID, BOOLEAN, TEXT, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. invoices: one live invoice per visit
-- ---------------------------------------------------------------------------------------------------------------------

DO $$
DECLARE
    v_group RECORD;
    v_keep UUID;
    v_paid_count INTEGER;
    v_cancelled INTEGER := 0;
BEGIN
    FOR v_group IN
        SELECT i.tenant_id, i.visit_id
        FROM public.invoices i
        WHERE i.status <> 'cancelled'
        GROUP BY i.tenant_id, i.visit_id
        HAVING count(*) > 1
    LOOP
        SELECT count(*) INTO v_paid_count
        FROM public.invoices i
        WHERE i.tenant_id = v_group.tenant_id
          AND i.visit_id = v_group.visit_id
          AND i.status <> 'cancelled'
          AND EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = i.id);

        IF v_paid_count > 1 THEN
            RAISE EXCEPTION 'invoices: visit % has % live invoices with payments; reconcile manually before 000024',
                v_group.visit_id, v_paid_count;
        END IF;

        SELECT i.id INTO v_keep
        FROM public.invoices i
        WHERE i.tenant_id = v_group.tenant_id
          AND i.visit_id = v_group.visit_id
          AND i.status <> 'cancelled'
        ORDER BY EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = i.id) DESC, i.created_at, i.id
        LIMIT 1;

        INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, actor_type, action, entity_type, entity_id, metadata)
        SELECT i.tenant_id, NULL, 'system', 'system', 'invoice.duplicate_cancelled', 'invoice', i.id,
               jsonb_build_object('kept_invoice_id', v_keep, 'migration', '000024')
        FROM public.invoices i
        WHERE i.tenant_id = v_group.tenant_id
          AND i.visit_id = v_group.visit_id
          AND i.status <> 'cancelled'
          AND i.id <> v_keep;

        UPDATE public.invoices i
        SET status = 'cancelled', updated_at = now()
        WHERE i.tenant_id = v_group.tenant_id
          AND i.visit_id = v_group.visit_id
          AND i.status <> 'cancelled'
          AND i.id <> v_keep;

        v_cancelled := v_cancelled + 1;
    END LOOP;

    IF v_cancelled > 0 THEN
        RAISE NOTICE '000024: resolved duplicate live invoices on % visit(s)', v_cancelled;
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_live_per_visit
    ON public.invoices (tenant_id, visit_id)
    WHERE status <> 'cancelled';
