-- Migration: 000053_clinical_notes_expand.sql
-- V2-05 plan 05-02a step 1 (P1-01, PO-3, SECURITY_VERIFICATION_PLAN §6.1 row "visits.clinical_notes"; rulings R-2,
-- R-3, R-4, R-5, R-37; threats T-05-01, T-05-02, T-05-03, T-05-23). Next free number after 05-04's 000052.
--
-- EXPAND + MIGRATE of the clinical split. The clinical content of an encounter (vitals, chief complaints, notes,
-- specialty data, investigations advised, advice) moves from columns on `visits` into a new 1:1 table
-- `public.clinical_notes`, so row-level security can hide it from roles without `consultations:view` (receptionists,
-- admins) while they keep reading the visit row the front desk needs. Every user is the `authenticated` Postgres role,
-- so column privileges cannot tell roles apart (research A1, Supabase guidance): a table is required.
--
--   * `clinical_notes` (PK `visit_id`) has the visit's column names unchanged (R-4) and a composite FK to
--     `visits (tenant_id, id)` ON DELETE RESTRICT (05-03 pattern: clinical history is never deleted under a visit;
--     deleting the TENANT still cascades).
--   * Starts closed (R-13): every privilege revoked from PUBLIC/anon/authenticated, then SELECT and UPDATE only.
--     No INSERT/DELETE privilege or policy: rows are created by a trigger, never by a tenant role (R-5), and DELETE
--     stays "—" in the 05-04 DELETE column.
--   * SELECT: `consultations:view` in the active clinic. UPDATE: `consultations:edit`, or `vitals:edit` limited to the
--     `vitals` column by the guard trigger (nurses record vitals only, R-3).
--   * `visits_create_clinical_notes` (AFTER INSERT on visits, SECURITY DEFINER) inserts the empty row with fixed
--     content: a receptionist booking a visit cannot inject notes (T-05-03).
--   * Backfill one row per existing visit (idempotent), then clear the six columns on `visits` and add the VALID CHECK
--     `visits_clinical_content_moved`: from here no path can put clinical content back into `visits` (R-2). The columns
--     themselves are dropped by 05-b0 (contract) after the switched app is deployed (R-37, T-05-23).

-- 1. The table ----------------------------------------------------------------------------------------------------
CREATE TABLE public.clinical_notes (
  visit_id               uuid        PRIMARY KEY,
  tenant_id              uuid        NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  vitals                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
  chief_complaints       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  clinical_notes         text,
  specialty_data         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  investigations_advised text[]      NOT NULL DEFAULT '{}',
  advice                 text[]      NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinical_notes_tenant_id_visit_id_key UNIQUE (tenant_id, visit_id),
  CONSTRAINT clinical_notes_tenant_visit_fkey FOREIGN KEY (tenant_id, visit_id)
    REFERENCES public.visits (tenant_id, id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.clinical_notes IS
  'V2-05 05-02a: the clinical content of a visit (1:1, PK visit_id). RLS: SELECT consultations:view; UPDATE '
  'consultations:edit, or vitals:edit for vitals only (clinical_notes_guard). Rows are created by the '
  'visits_create_clinical_notes trigger; no tenant role inserts or deletes.';

ALTER TABLE public.clinical_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.clinical_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.clinical_notes TO authenticated;

-- 2. Policies (each helper wrapped in (select ...): evaluated once per statement) -----------------------------------
CREATE POLICY clinical_notes_select ON public.clinical_notes
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT authz.tenant_ids_with('consultations:view')));

CREATE POLICY clinical_notes_update ON public.clinical_notes
  FOR UPDATE TO authenticated
  USING (
    tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
    OR tenant_id IN (SELECT authz.tenant_ids_with('vitals:edit'))
  )
  WITH CHECK (
    tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
    OR tenant_id IN (SELECT authz.tenant_ids_with('vitals:edit'))
  );

-- 3. Guard: keys never change; without consultations:edit only `vitals` may change (R-3, T-05-02) ------------------
-- SECURITY INVOKER. A signed-in caller (auth.uid() set) who lacks consultations:edit in the row's clinic (the active
-- clinic, has_permission is bound to it) may change `vitals` only; `updated_at` is maintained here for everyone.
-- System paths (service role, migrations: no auth.uid()) are not restricted beyond the key rule.
CREATE FUNCTION public.clinical_notes_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.visit_id IS DISTINCT FROM OLD.visit_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'CLINICAL_NOTES_KEY_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  IF (SELECT auth.uid()) IS NOT NULL
     AND NOT public.has_permission(NEW.tenant_id, 'consultations:edit')
     AND (to_jsonb(NEW) - 'vitals' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'vitals' - 'updated_at') THEN
    RAISE EXCEPTION 'CLINICAL_NOTES_VITALS_ONLY' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.clinical_notes_guard() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.clinical_notes_guard() IS
  'V2-05 05-02a: BEFORE UPDATE on clinical_notes. visit_id/tenant_id never change; without consultations:edit only '
  'vitals may change (42501); maintains updated_at.';
CREATE TRIGGER clinical_notes_guard
  BEFORE UPDATE ON public.clinical_notes
  FOR EACH ROW EXECUTE FUNCTION public.clinical_notes_guard();

-- 4. Every visit gets its (empty) clinical_notes row at insert (R-5, T-05-03) ---------------------------------------
-- SECURITY DEFINER so a role without any clinical_notes privilege (a receptionist booking) still creates the row; the
-- content is fixed (the column defaults), never taken from the caller.
CREATE FUNCTION private.visits_create_clinical_notes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.clinical_notes (visit_id, tenant_id)
  VALUES (NEW.id, NEW.tenant_id)
  ON CONFLICT (visit_id) DO NOTHING;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.visits_create_clinical_notes() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.visits_create_clinical_notes() IS
  'V2-05 05-02a: AFTER INSERT on visits; creates the visit''s empty clinical_notes row (fixed content).';
CREATE TRIGGER visits_create_clinical_notes
  AFTER INSERT ON public.visits
  FOR EACH ROW EXECUTE FUNCTION private.visits_create_clinical_notes();

-- 5. Backfill: one row per existing visit, from the current columns (idempotent) ------------------------------------
INSERT INTO public.clinical_notes
  (visit_id, tenant_id, vitals, chief_complaints, clinical_notes, specialty_data, investigations_advised, advice,
   created_at, updated_at)
SELECT v.id, v.tenant_id,
       COALESCE(v.vitals, '{}'::jsonb),
       COALESCE(v.chief_complaints, '[]'::jsonb),
       v.clinical_notes,
       COALESCE(v.specialty_data, '{}'::jsonb),
       COALESCE(v.investigations_advised, '{}'::text[]),
       COALESCE(v.advice, '{}'::text[]),
       v.created_at,
       COALESCE(v.updated_at, v.created_at)
  FROM public.visits v
ON CONFLICT (visit_id) DO NOTHING;

-- 6. Clear the moved columns on visits and block them (VALID CHECK, R-2) --------------------------------------------
UPDATE public.visits
   SET vitals = NULL, chief_complaints = NULL, clinical_notes = NULL, specialty_data = NULL,
       investigations_advised = NULL, advice = NULL
 WHERE vitals IS NOT NULL OR chief_complaints IS NOT NULL OR clinical_notes IS NOT NULL
    OR specialty_data IS NOT NULL OR investigations_advised IS NOT NULL OR advice IS NOT NULL;

ALTER TABLE public.visits ADD CONSTRAINT visits_clinical_content_moved CHECK (
      (vitals IS NULL OR vitals = '{}'::jsonb)
  AND (chief_complaints IS NULL OR chief_complaints = '[]'::jsonb)
  AND clinical_notes IS NULL
  AND (specialty_data IS NULL OR specialty_data = '{}'::jsonb)
  AND (investigations_advised IS NULL OR investigations_advised = '{}'::text[])
  AND (advice IS NULL OR advice = '{}'::text[])
);
COMMENT ON CONSTRAINT visits_clinical_content_moved ON public.visits IS
  'V2-05 05-02a: clinical content lives in public.clinical_notes; these columns stay empty until 05-b0 drops them.';
