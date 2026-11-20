-- Migration: 000095_clinic_locations.sql
-- V2-07 plan 07-00 (foundations for the atomic server commands; 07-PLAN rulings R-5 and R-2; PO branch decision
-- 2026-11-15, placed in V2-07 by PO ruling 2026-11-18; PWA-06a).
--
-- A. R-5 branch hook. `public.clinic_locations(id, tenant_id, name, is_default, created_at)`: one default location per
--    clinic (partial unique index), created for every existing clinic (backfill "Main") and for every new clinic by an
--    AFTER INSERT trigger on `tenants` (whoever inserts it: `create_clinic_with_owner`, the service role, a seed). A
--    visit, queue token and invoice carries `location_id`, bound to the SAME clinic by the composite FK
--    `(tenant_id, location_id) -> clinic_locations (tenant_id, id)` (RESTRICT: clinical and financial history, R-12).
--    A BEFORE INSERT trigger fills the clinic's default location when the writer gave none, so no existing writer
--    changes (the column default is the nil uuid, which the trigger replaces, so the generated Insert types keep
--    `location_id` optional); the column is NOT NULL in this migration (no live data, PO-15). Owners manage locations in v2.1, so
--    members get SELECT only (the active, full clinic, `authz.full_tenant_ids()`); no INSERT/UPDATE/DELETE is granted.
--    Invoice and token numbering stay per clinic in v2.0.
-- B. R-2 idempotent commands. `private.command_results(tenant_id, client_request_id, command, actor_id, system_actor,
--    request_hash, result, created_at)`, PK `(tenant_id, client_request_id)`; RLS on, no policy, no API grant. Used only
--    through two definer helpers in `private`:
--    - `private.command_claim(tenant, id, command, request_hash, system_actor)`: INSERT ... ON CONFLICT DO NOTHING. A
--      fresh claim returns NULL and holds the PK until the command's transaction ends (a concurrent duplicate waits on
--      the PK, then reads the committed row). An existing row of the same command, actor and hash with a stored result
--      returns that result plus {"replayed": true}; any other existing row is IDEMPOTENCY_MISMATCH.
--    - `private.command_complete(tenant, id, result)`: stores the command's result and returns it.
--    A command that fails rolls its claim back with everything else, so a retry with the same id runs fresh.
--    Grants follow `private.outbox_payment_recorded` (000027): the schema is not served by PostgREST; EXECUTE goes to
--    `authenticated` and `service_role` because the INVOKER command functions of 07-01..07-03 call these helpers.
--    On the user path the helper also requires the tenant to be the caller's ACTIVE, full clinic (defence in depth: the
--    command function has already checked it), so a stored result of another clinic can never be read.
-- Per-migration checklist: new table x2 (RLS on both; the matrix row for clinic_locations is in
-- tests/authz/table-matrix.ts); new functions: 2 command helpers + 2 trigger functions in `private`, all definer with
-- `search_path = ''`, EXECUTE revoked from PUBLIC/anon (the trigger functions from every API role too); RPC_REASON_CODES
-- gains CLIENT_REQUEST_ID_REQUIRED and COMMAND_NOT_CLAIMED (IDEMPOTENCY_MISMATCH, ACTOR_INVALID, INPUT_INVALID exist); every FK is indexed; types/database.ts regenerated.
-- Synthetic data only in tests.

-- A. clinic_locations ----------------------------------------------------------------------------------------------------
CREATE TABLE public.clinic_locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- The target of the composite FKs below (a child row can name only a location of its own clinic).
    CONSTRAINT clinic_locations_tenant_id_id_key UNIQUE (tenant_id, id)
);
COMMENT ON TABLE public.clinic_locations IS
    'V2-07 R-5: the clinic''s branches. v2.0 has exactly one (the default, "Main"); owners manage more in v2.1. Read-only for members.';

-- One default location per clinic.
CREATE UNIQUE INDEX clinic_locations_one_default ON public.clinic_locations (tenant_id) WHERE is_default;

ALTER TABLE public.clinic_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.clinic_locations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.clinic_locations TO authenticated;
CREATE POLICY clinic_locations_select ON public.clinic_locations
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.full_tenant_ids()));

-- Every new clinic gets its default location, whoever inserts the clinic.
CREATE FUNCTION private.tenants_create_default_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.clinic_locations (tenant_id, name, is_default)
    VALUES (NEW.id, 'Main', true)
    ON CONFLICT (tenant_id) WHERE is_default DO NOTHING;
    RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.tenants_create_default_location() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.tenants_create_default_location() IS
    'V2-07 R-5: every new clinic starts with exactly one default location, whoever inserts the clinic.';

CREATE TRIGGER tenants_create_default_location
    AFTER INSERT ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION private.tenants_create_default_location();

-- Backfill: clinics that existed before this migration (idempotent).
INSERT INTO public.clinic_locations (tenant_id, name, is_default)
SELECT t.id, 'Main', true FROM public.tenants t
ON CONFLICT (tenant_id) WHERE is_default DO NOTHING;

-- location_id on the three tables that belong to a place: add nullable, backfill, bind, NOT NULL. ------------------------
-- Fills the clinic's default location when the writer named none (definer: the writer's RLS must not decide it).
CREATE FUNCTION private.fill_default_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.location_id IS NULL OR NEW.location_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
        SELECT l.id INTO NEW.location_id
          FROM public.clinic_locations l
         WHERE l.tenant_id = NEW.tenant_id AND l.is_default;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.fill_default_location() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.fill_default_location() IS
    'V2-07 R-5: BEFORE INSERT on visits, queue_tokens and invoices: a row without a location (NULL or the nil-uuid column default) gets its clinic''s default.';

ALTER TABLE public.visits ADD COLUMN location_id uuid;
ALTER TABLE public.queue_tokens ADD COLUMN location_id uuid;
ALTER TABLE public.invoices ADD COLUMN location_id uuid;

-- Backfill as the migration owner (auth.uid() is NULL, so the visit integrity guard lets a system update through; only
-- location_id changes, so a signed visit stays as signed).
UPDATE public.visits x SET location_id = l.id FROM public.clinic_locations l WHERE l.tenant_id = x.tenant_id AND l.is_default AND x.location_id IS NULL;
UPDATE public.queue_tokens x SET location_id = l.id FROM public.clinic_locations l WHERE l.tenant_id = x.tenant_id AND l.is_default AND x.location_id IS NULL;
UPDATE public.invoices x SET location_id = l.id FROM public.clinic_locations l WHERE l.tenant_id = x.tenant_id AND l.is_default AND x.location_id IS NULL;

ALTER TABLE public.visits ADD CONSTRAINT visits_tenant_location_fkey
  FOREIGN KEY (tenant_id, location_id) REFERENCES public.clinic_locations (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.queue_tokens ADD CONSTRAINT queue_tokens_tenant_location_fkey
  FOREIGN KEY (tenant_id, location_id) REFERENCES public.clinic_locations (tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_tenant_location_fkey
  FOREIGN KEY (tenant_id, location_id) REFERENCES public.clinic_locations (tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE public.visits ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE public.queue_tokens ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE public.invoices ALTER COLUMN location_id SET NOT NULL;

-- The nil uuid is the column default and means "the clinic's default location": the BEFORE INSERT trigger replaces it
-- before any constraint runs, so it is never stored (the composite FK would refuse it). It exists only so the generated
-- Insert types keep `location_id` optional: no existing writer (services, tests, seeds) has to name a location.
ALTER TABLE public.visits ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
ALTER TABLE public.queue_tokens ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;
ALTER TABLE public.invoices ALTER COLUMN location_id SET DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;

CREATE INDEX visits_tenant_location_idx ON public.visits (tenant_id, location_id);
CREATE INDEX queue_tokens_tenant_location_idx ON public.queue_tokens (tenant_id, location_id);
CREATE INDEX invoices_tenant_location_idx ON public.invoices (tenant_id, location_id);

-- Trigger name sorts before the existing BEFORE INSERT guards ("a_" prefix) so they see the filled row.
CREATE TRIGGER a_fill_default_location BEFORE INSERT ON public.visits
    FOR EACH ROW EXECUTE FUNCTION private.fill_default_location();
CREATE TRIGGER a_fill_default_location BEFORE INSERT ON public.queue_tokens
    FOR EACH ROW EXECUTE FUNCTION private.fill_default_location();
CREATE TRIGGER a_fill_default_location BEFORE INSERT ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION private.fill_default_location();

COMMENT ON COLUMN public.visits.location_id IS 'V2-07 R-5: the clinic location of the visit; the clinic''s default unless a command names another.';
COMMENT ON COLUMN public.queue_tokens.location_id IS 'V2-07 R-5: the clinic location the token was issued at.';
COMMENT ON COLUMN public.invoices.location_id IS 'V2-07 R-5: the clinic location the invoice was raised at.';

-- B. command_results and the claim/complete helpers ------------------------------------------------------------------
CREATE TABLE private.command_results (
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    client_request_id uuid NOT NULL,
    command text NOT NULL CHECK (char_length(command) BETWEEN 1 AND 100),
    actor_id uuid,
    system_actor text,
    request_hash text NOT NULL CHECK (char_length(request_hash) BETWEEN 1 AND 200),
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, client_request_id),
    -- One actor: a signed-in user or a closed system actor, never both.
    CONSTRAINT command_results_one_actor CHECK (actor_id IS NULL OR system_actor IS NULL)
);
COMMENT ON TABLE private.command_results IS
    'V2-07 R-2: one row per command attempt (idempotency). Written only by private.command_claim / command_complete; no API grant, no policy. Retention purge (30 days) is V2-13.';
CREATE INDEX command_results_created_at_idx ON private.command_results (created_at);

ALTER TABLE private.command_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.command_results FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.command_claim(
    p_tenant_id uuid,
    p_client_request_id uuid,
    p_command text,
    p_request_hash text,
    p_system_actor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_inserted integer;
    v_row private.command_results;
BEGIN
    IF p_client_request_id IS NULL THEN
        RAISE EXCEPTION 'CLIENT_REQUEST_ID_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    IF p_tenant_id IS NULL OR p_command IS NULL OR p_command = '' OR p_request_hash IS NULL OR p_request_hash = '' THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- A session is a user (no system actor); the system path has no session. The command function checks this first.
    IF (v_uid IS NULL) = (p_system_actor IS NULL) THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- Defence in depth: a user claims only in the active, full clinic (the stored result of another clinic is never read).
    IF v_uid IS NOT NULL AND p_tenant_id IS DISTINCT FROM (SELECT authz.full_tenant_ids() LIMIT 1) THEN
        RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- A concurrent duplicate waits here on the primary key until the first transaction ends (lock_timeout 2s), then
    -- reads the committed row below; if the first rolled back it claims fresh.
    INSERT INTO private.command_results (tenant_id, client_request_id, command, actor_id, system_actor, request_hash)
    VALUES (p_tenant_id, p_client_request_id, p_command, v_uid, p_system_actor, p_request_hash)
    ON CONFLICT (tenant_id, client_request_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
        RETURN NULL;
    END IF;

    SELECT r.* INTO v_row
      FROM private.command_results r
     WHERE r.tenant_id = p_tenant_id AND r.client_request_id = p_client_request_id;
    IF NOT FOUND
        OR v_row.command IS DISTINCT FROM p_command
        OR v_row.actor_id IS DISTINCT FROM v_uid
        OR v_row.system_actor IS DISTINCT FROM p_system_actor
        OR v_row.request_hash IS DISTINCT FROM p_request_hash
        -- Same request but no stored result: the claim belongs to a command still open in this very transaction.
        OR v_row.result IS NULL THEN
        RAISE EXCEPTION 'IDEMPOTENCY_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

    RETURN v_row.result || jsonb_build_object('replayed', true);
END;
$$;
REVOKE ALL ON FUNCTION private.command_claim(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.command_claim(uuid, uuid, text, text, text) TO authenticated, service_role;
COMMENT ON FUNCTION private.command_claim(uuid, uuid, text, text, text) IS
    'V2-07 R-2: claims (tenant, client_request_id) for a command. NULL = fresh claim; a stored result of the same command, actor and request hash = replay ({..., replayed: true}); anything else IDEMPOTENCY_MISMATCH. CLIENT_REQUEST_ID_REQUIRED without an id.';

CREATE FUNCTION private.command_complete(
    p_tenant_id uuid,
    p_client_request_id uuid,
    p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
BEGIN
    IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- Only the claim of THIS transaction can be completed, by the actor that made it: an open row of a concurrent
    -- command (result still NULL, not visible to us until it commits) is never written here.
    UPDATE private.command_results r
       SET result = p_result
     WHERE r.tenant_id = p_tenant_id
       AND r.client_request_id = p_client_request_id
       AND r.result IS NULL
       AND r.actor_id IS NOT DISTINCT FROM v_uid;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'COMMAND_NOT_CLAIMED' USING ERRCODE = 'P0001';
    END IF;
    RETURN p_result;
END;
$$;
REVOKE ALL ON FUNCTION private.command_complete(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.command_complete(uuid, uuid, jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION private.command_complete(uuid, uuid, jsonb) IS
    'V2-07 R-2: stores the result of the command that claimed (tenant, client_request_id) in this transaction and returns it.';
