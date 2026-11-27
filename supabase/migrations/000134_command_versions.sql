-- Migration: 000134_command_versions.sql
-- V2-09e 09E PR 2 (PO ruling, option A, after CI run 45742707020): a command's answer carries the clinic versions its own transaction produced, so the
-- device that saved can tell its own live signal from another device's write and skip re-reading what its answer already wrote into the screen.
--
-- private.command_complete (the one step every claimed command ends with: it stores the result for replay and returns it) adds one key to the result:
--   versions: {domain: version} for each clinic_versions row of p_tenant_id that THIS transaction raised (last_xact = pg_current_xact_id(); written only by
--             private.clinic_bump, once per transaction and domain, +1 each time); {} when the command moved no domain.
-- The rows a transaction raised stay locked by it until commit, so the numbers are the ones the signals of this commit carry. Only the clinic the command was
-- authorised for is read (p_tenant_id; the claim of this transaction and actor is required first, as before). A version is a counter, no PHI. A replay answers
-- the stored result, versions included (an older number: the device then has newer data or reads again; it never skips a newer write).
-- Expand-safe: the result gains a key (every reader parses known keys and drops the rest); a result that already has `versions` keeps its own.
-- Per-migration checklist: one definer function replaced (same signature, SECURITY DEFINER, search_path '', lock_timeout 2s, no API grant: REVOKE restated,
-- comment restated). No table, column, policy, trigger, grant or data change.

CREATE OR REPLACE FUNCTION private.command_complete(
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
    v_result jsonb;
BEGIN
    IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' THEN
        RAISE EXCEPTION 'INPUT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    -- The clinic versions this transaction raised (the numbers its signals carry). A result that names its own `versions` keeps them.
    v_result := jsonb_build_object('versions', coalesce(
                    (SELECT jsonb_object_agg(cv.domain, cv.version)
                       FROM public.clinic_versions cv
                      WHERE cv.tenant_id = p_tenant_id
                        AND cv.last_xact = pg_current_xact_id()),
                    '{}'::jsonb))
                || p_result;
    -- Only the claim of THIS transaction can be completed, by the actor that made it: an open row of a concurrent
    -- command (result still NULL, not visible to us until it commits) is never written here.
    UPDATE private.command_results r
       SET result = v_result
     WHERE r.tenant_id = p_tenant_id
       AND r.client_request_id = p_client_request_id
       AND r.result IS NULL
       AND r.actor_id IS NOT DISTINCT FROM v_uid;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'COMMAND_NOT_CLAIMED' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION private.command_complete(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.command_complete(uuid, uuid, jsonb) IS
    'V2-07 R-2 (000099 F-4: no API grant; only the definer commands call it): stores the result of the command that claimed (tenant, client_request_id) in this transaction and returns it. 000134 (09E PR 2): the result gains versions, the clinic_versions of p_tenant_id this transaction raised ({domain: version}, {} for none), unless it names its own.';
