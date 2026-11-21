-- Migration: 000115_doctor_text_macros.sql
-- V2-09b 09B-04b (R-14, AI-09, T-09B-07): a doctor's own text macros for the consult's shorthand bar (".ur" expands to the doctor's own words).
--
-- 1. public.doctor_text_macros (tenant_id, doctor_id, shortcut, expansion): one row per macro. The shortcut is a dot, then 1 to 24 of a-z, 0-9, "_" and
--    "-" (CHECK); the expansion is 1 to 2,000 characters (CHECK). Unique per (tenant, doctor, shortcut). The doctor is a member of the clinic (composite FK
--    to memberships, as the doctor's other own-row tables since 000049). The macro is NOT clinical data and is not shared: RLS gives every operation
--    (SELECT, INSERT, UPDATE, DELETE) to the owning doctor only: `tenant_id IN (authz.tenant_ids_with('consultations:edit')) AND doctor_id = auth.uid()`.
--    Another doctor of the clinic, the owner, a nurse, a receptionist and another clinic see nothing. The expansion text is never logged (no audit
--    action is added; the table is written by the doctor's own actions under RLS, like doctor_custom_diagnoses).
-- 2. Two triggers (INVOKER):
--    - BEFORE INSERT `doctor_text_macros_before_insert`: when a signed-in user writes the row, doctor_id is set to auth.uid() (a caller-supplied value is
--      ignored; the WITH CHECK then holds by construction); then the 201st macro of one doctor in one clinic is refused (SQLSTATE 23514, a transaction
--      advisory lock on the doctor serialises two parallel inserts).
--    - BEFORE UPDATE `doctor_text_macros_before_update`: tenant_id, doctor_id and id never change (a macro cannot be moved to another clinic or doctor);
--      updated_at is maintained.
-- Per-migration checklist: one new tenant table with tenant_id and RLS, grants to authenticated only (no anon), two trigger functions, no existing
-- table, function or policy changed; expand-safe (nothing in the previous build reads it). `npm run authz:gen` regenerates the matrix.

CREATE TABLE public.doctor_text_macros (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    doctor_id uuid NOT NULL,
    shortcut text NOT NULL CHECK (shortcut ~ '^\.[a-z0-9_-]{1,24}$'),
    expansion text NOT NULL CHECK (char_length(expansion) <= 2000 AND char_length(btrim(expansion)) >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT doctor_text_macros_tenant_doctor_shortcut_key UNIQUE (tenant_id, doctor_id, shortcut),
    CONSTRAINT doctor_text_macros_tenant_doctor_fkey
        FOREIGN KEY (doctor_id, tenant_id) REFERENCES public.memberships (user_id, tenant_id) ON DELETE RESTRICT
);
COMMENT ON TABLE public.doctor_text_macros IS
    'V2-09b 09B-04b (R-14): a doctor''s own text macros for the consult shorthand bar. Owner-only RLS (consultations:edit and doctor_id = auth.uid()), at most 200 per doctor and clinic. The expansion text is never logged.';

ALTER TABLE public.doctor_text_macros ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.doctor_text_macros FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.doctor_text_macros TO authenticated;

CREATE POLICY doctor_text_macros_select ON public.doctor_text_macros
    FOR SELECT TO authenticated
    USING (
        tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
        AND doctor_id = (SELECT auth.uid())
    );
CREATE POLICY doctor_text_macros_insert ON public.doctor_text_macros
    FOR INSERT TO authenticated
    WITH CHECK (
        tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
        AND doctor_id = (SELECT auth.uid())
    );
CREATE POLICY doctor_text_macros_update ON public.doctor_text_macros
    FOR UPDATE TO authenticated
    USING (
        tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
        AND doctor_id = (SELECT auth.uid())
    )
    WITH CHECK (
        tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
        AND doctor_id = (SELECT auth.uid())
    );
CREATE POLICY doctor_text_macros_delete ON public.doctor_text_macros
    FOR DELETE TO authenticated
    USING (
        tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
        AND doctor_id = (SELECT auth.uid())
    );

-- BEFORE INSERT: the doctor is the caller; at most 200 macros per doctor and clinic.
CREATE FUNCTION private.doctor_text_macros_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
    v_uid uuid := auth.uid();
    v_count integer;
BEGIN
    IF v_uid IS NOT NULL THEN
        NEW.doctor_id := v_uid;
    END IF;
    -- One doctor's inserts in one clinic run one at a time, so two parallel inserts cannot both pass the count.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('doctor_text_macros:' || NEW.tenant_id::text || ':' || NEW.doctor_id::text, 0));
    SELECT count(*) INTO v_count
      FROM public.doctor_text_macros m
     WHERE m.tenant_id = NEW.tenant_id AND m.doctor_id = NEW.doctor_id;
    IF v_count >= 200 THEN
        RAISE EXCEPTION 'MACRO_LIMIT: at most 200 macros per doctor' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION private.doctor_text_macros_before_insert() IS
    'V2-09b 09B-04b (R-14): BEFORE INSERT trigger function (invoker) of doctor_text_macros: doctor_id = auth.uid() for a signed-in caller; the 201st macro of a doctor is refused.';
CREATE TRIGGER doctor_text_macros_before_insert
    BEFORE INSERT ON public.doctor_text_macros
    FOR EACH ROW EXECUTE FUNCTION private.doctor_text_macros_before_insert();

-- BEFORE UPDATE: identity columns never change; updated_at is maintained.
CREATE FUNCTION private.doctor_text_macros_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id THEN
        RAISE EXCEPTION 'MACRO_IMMUTABLE: a macro cannot change its clinic or doctor' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION private.doctor_text_macros_before_update() IS
    'V2-09b 09B-04b (R-14): BEFORE UPDATE trigger function (invoker) of doctor_text_macros: id, tenant_id and doctor_id never change; updated_at is maintained.';
CREATE TRIGGER doctor_text_macros_before_update
    BEFORE UPDATE ON public.doctor_text_macros
    FOR EACH ROW EXECUTE FUNCTION private.doctor_text_macros_before_update();
