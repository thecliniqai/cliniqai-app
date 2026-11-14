-- Migration: 000079_contract_05a.sql
-- V2-05 plan 05-b0: the CONTRACT steps of 05a (expand → migrate → contract; rulings R-2, R-37; P1-40), plus the two
-- contract items 05a assigned here (05a-REVIEW-TRIAGE.md "link_url CHECK VALIDATE → 05-b0"; 05-02c wave note "the
-- legacy helpers are drop candidates for 05-b0").
--
-- Deploy order (05a-SUMMARY.md "Deploy notes", R-37): this file runs only on a database whose app no longer reads or
-- writes the moved `visits` columns or calls the dropped functions, i.e. after the 05a app is serving (05-P2), or on a
-- database that has no app yet (the first staging bring-up applies every migration before the app deploys). The 05a
-- app reads clinical content through `clinical_notes` only (05-02a) and checks in through `issue_queue_token` (05-11a);
-- nothing in it calls `generate_daily_queue_token`, `current_user_has_role` or `current_user_is_admin_or_owner`.
-- Run `npm run db:diagnostics` (local) / the 05-P8 staging diagnostics first: D11n must be 0 (step 1 stops otherwise).
--
-- 1. Diagnostics (counts only, as NOTICEs; no row data): D11n (notice links the 000075 check refuses) and D53c (visits
--    still holding moved content; 0 by construction while `visits_clinical_content_moved` is VALID). Then
--    `VALIDATE CONSTRAINT in_app_notifications_link_url_relative` (added NOT VALID by 000073, tightened by 000075). On
--    D11n > 0 the VALIDATE fails with 23514 and the migration stops (no automatic remedy: a stored notice link is
--    corrected or cleared with the clinic, then the migration is re-run).
-- 2. Drop the 000053 "moved" CHECK, then the six clinical columns of `visits` (`vitals`, `chief_complaints`,
--    `clinical_notes`, `specialty_data`, `investigations_advised`, `advice`). Their content lives in
--    `public.clinical_notes` since 000053 (backfilled there, cleared here by 000053 and kept empty by the CHECK).
--    No view, policy, index, trigger column list or function depends on them (dry-run without CASCADE).
-- 3. Revoke EXECUTE, then drop `public.generate_daily_queue_token(uuid, date)` (MAX()+1 without a lock; replaced by the
--    counter, 000064, and `issue_queue_token`, 000068) and the two legacy "any membership" helpers
--    `public.current_user_has_role(uuid, text[])` and `public.current_user_is_admin_or_owner(uuid)` (bodies bound to the
--    active clinic by 000061; no policy, function or app caller since). `public.current_user_tenant_ids()` stays (the
--    member helper, R-42).
-- Per-migration checklist: no new table, function, grant or policy; destructive statements are exactly the named
-- contract drops; idempotent on re-run (IF EXISTS).

-- 1. ----------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
    v_links integer;
    v_moved integer := 0;
BEGIN
    SELECT count(*) INTO v_links FROM public.in_app_notifications
     WHERE link_url IS NOT NULL AND link_url !~ '^/([^/\\[:cntrl:][:space:]][^[:cntrl:][:space:]]*)?$';
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'visits' AND column_name = 'vitals') THEN
        EXECUTE $q$
            SELECT count(*) FROM public.visits
             WHERE (vitals IS NOT NULL AND vitals <> '{}'::jsonb)
                OR (chief_complaints IS NOT NULL AND chief_complaints <> '[]'::jsonb)
                OR clinical_notes IS NOT NULL
                OR (specialty_data IS NOT NULL AND specialty_data <> '{}'::jsonb)
                OR (investigations_advised IS NOT NULL AND investigations_advised <> '{}'::text[])
                OR (advice IS NOT NULL AND advice <> '{}'::text[])
        $q$ INTO v_moved;
    END IF;
    RAISE NOTICE '05-b0 diagnostics: D11n notice links refused by the check = %, D53c visits still holding moved content = %',
        v_links, v_moved;
END;
$$;

ALTER TABLE public.in_app_notifications VALIDATE CONSTRAINT in_app_notifications_link_url_relative;

-- 2. ----------------------------------------------------------------------------------------------------------------
ALTER TABLE public.visits DROP CONSTRAINT IF EXISTS visits_clinical_content_moved;
ALTER TABLE public.visits
    DROP COLUMN IF EXISTS vitals,
    DROP COLUMN IF EXISTS chief_complaints,
    DROP COLUMN IF EXISTS clinical_notes,
    DROP COLUMN IF EXISTS specialty_data,
    DROP COLUMN IF EXISTS investigations_advised,
    DROP COLUMN IF EXISTS advice;

-- 3. ----------------------------------------------------------------------------------------------------------------
DO $$
BEGIN
    IF to_regprocedure('public.generate_daily_queue_token(uuid, date)') IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION public.generate_daily_queue_token(uuid, date) FROM PUBLIC, anon, authenticated, service_role;
    END IF;
    IF to_regprocedure('public.current_user_has_role(uuid, text[])') IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION public.current_user_has_role(uuid, text[]) FROM PUBLIC, anon, authenticated, service_role;
    END IF;
    IF to_regprocedure('public.current_user_is_admin_or_owner(uuid)') IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION public.current_user_is_admin_or_owner(uuid) FROM PUBLIC, anon, authenticated, service_role;
    END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.generate_daily_queue_token(uuid, date);
DROP FUNCTION IF EXISTS public.current_user_has_role(uuid, text[]);
DROP FUNCTION IF EXISTS public.current_user_is_admin_or_owner(uuid);
