-- Migration: 000104_search_patients_name_queries.sql
-- V2-08 08-04b (found by the full e2e lane; defect of 000101, R-11, P1-30): the patient typeahead read every digit of a typed
-- NAME as a mobile-number fragment. A query such as "Ramesh 2 Kumar 7 1" (or the synthetic "E2E Synthetic Walk-in dcc7a1", digits
-- 2, 7, 1) was also searched as the mobile fragment "271": any patient whose number contains it matched with rank 2 and
-- outranked the exact name (rank 3), and once it matched, "Register as new patient" (offered only when nothing matches) was not
-- offered. Digits are now a mobile number only when the query holds no letters at all ("98765 43210", "+91 98765 4"); a query with
-- letters is a name (or an ABHA id) query. Same signature, columns, grants and security as 000101; only the body changes.
-- Per-migration checklist: one replaced public invoker read function (EXECUTE: authenticated only, unchanged). No table, column,
-- policy or data change; expand-safe (the previous build calls the same signature).

DO $migration$
DECLARE
    v_schema text;
    v_sql text;
BEGIN
    SELECT n.nspname INTO v_schema
      FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'pg_trgm';
    IF v_schema IS NULL THEN
        RAISE EXCEPTION 'patient search requires the pg_trgm extension';
    END IF;

    v_sql := $fn$
CREATE OR REPLACE FUNCTION public.search_patients(p_query text, p_limit integer DEFAULT 8)
RETURNS TABLE (
    id uuid,
    full_name text,
    sex text,
    age integer,
    date_of_birth date,
    phone_last4 text,
    last_visit_at timestamptz,
    rank integer
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $body$
DECLARE
    v_tenant uuid := (SELECT authz.full_tenant_ids() LIMIT 1);
    v_q text;
    v_digits text;
    v_letters integer;
    v_alpha integer;
    v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 25);
BEGIN
    IF v_tenant IS NULL OR p_query IS NULL THEN
        RETURN;
    END IF;
    IF NOT public.has_permission(v_tenant, 'patients:view') THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- The LIKE wildcards, PostgREST's `*`, the escape character and filter punctuation match nothing special: they become
    -- spaces ("%%" is no query, "_" is no per-digit oracle, "M_ena" does not find "Meena").
    v_q := btrim(regexp_replace(regexp_replace(left(p_query, 100), '[,()%_*\\]', ' ', 'g'), '\s+', ' ', 'g'));
    v_letters := char_length(regexp_replace(v_q, '[[:digit:][:space:][:punct:]]', '', 'g'));
    -- Digits are a mobile number only when the query is one (digits, spaces and separators such as + and -): the digits scattered through a name
    -- ("E2E Synthetic Walk-in dcc7a1" holds 2, 7, 1) are not "271", so no mobile that contains 271 outranks the exact name.
    v_alpha := char_length(regexp_replace(v_q, '[^[:alpha:]]', '', 'g'));
    v_digits := CASE WHEN v_alpha = 0 THEN regexp_replace(v_q, '\D', '', 'g') ELSE '' END;
    IF v_letters < 2 AND char_length(v_digits) < 3 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT m.id, m.full_name, m.sex, m.age, m.date_of_birth, m.phone_last4, m.last_visit_at, m.rank
      FROM (
            SELECT p.id, p.full_name, p.sex, p.age, p.date_of_birth,
                   CASE WHEN char_length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 4
                        THEN right(regexp_replace(p.phone, '\D', '', 'g'), 4) END AS phone_last4,
                   (SELECT max(coalesce(v.scheduled_at, v.created_at))
                      FROM public.visits v
                     WHERE v.tenant_id = v_tenant AND v.patient_id = p.id
                       AND v.status IN ('waiting', 'in_consultation', 'completed')) AS last_visit_at,
                   CASE
                       WHEN char_length(v_digits) >= 10
                            AND right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = right(v_digits, 10) THEN 1
                       WHEN char_length(v_digits) >= 3 AND p.phone LIKE '%' || v_digits || '%' THEN 2
                       WHEN p.full_name ILIKE v_q || '%' OR p.full_name ILIKE '% ' || v_q || '%' THEN 3
                       WHEN __TRGM__.similarity(p.full_name, v_q) >= 0.4 THEN 4
                       ELSE 5
                   END AS rank
              FROM public.patients p
             WHERE p.tenant_id = v_tenant AND NOT p.is_deleted AND p.erased_at IS NULL
               AND (p.full_name ILIKE '%' || v_q || '%'
                    OR (char_length(v_digits) >= 3 AND p.phone LIKE '%' || v_digits || '%')
                    OR p.abha_id ILIKE '%' || v_q || '%')
           ) m
     ORDER BY m.rank, m.last_visit_at DESC NULLS LAST, m.full_name, m.id
     LIMIT v_limit;
END;
$body$;
$fn$;
    EXECUTE replace(v_sql, '__TRGM__', quote_ident(v_schema));
END;
$migration$;
COMMENT ON FUNCTION public.search_patients(text, integer) IS
    'V2-08 08-02 (R-11, P1-30), 000104: typeahead over the session''s active clinic (a locked clinic has none): id, full_name, sex, age, date_of_birth, phone_last4, last_visit_at, rank, at most p_limit (1-25, default 8) rows. Needs two letters or three digits; % _ * \ , ( ) become spaces. Digits are a mobile number only when the query has no letters. Rank 1 exact mobile, 2 mobile digits contained, 3 name prefix, 4 trigram similarity, 5 substring or ABHA; then last visit (waiting, in consultation or completed), name. SECURITY INVOKER: RLS and patients:view apply. Deleted and erased patients are not listed.';
