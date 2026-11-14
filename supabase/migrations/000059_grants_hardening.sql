-- Migration: 000059_grants_hardening.sql
-- V2-05 plan 05-02c (P1-01; rulings R-13, R-47; threat T-05-13).
--
-- Table privileges of the API roles in `public` are cut to what each table's matrix row needs
-- (tests/authz/table-matrix.ts; the generated authz_completeness.test.sql compares every table's privileges with the
-- matrix, grants.test.sql loops the catalogue). Supabase's default ACL gives `anon` and `authenticated` every
-- privilege on every new table; before this migration that included TRUNCATE (not subject to RLS: any signed-in user,
-- and `anon`, could empty a tenant table of every clinic), TRIGGER, REFERENCES and MAINTAIN, plus DML that no policy
-- admits.
--
--   1. TRUNCATE, REFERENCES, TRIGGER and MAINTAIN are revoked from anon and authenticated on every public table.
--   2. `anon` holds no table or sequence privilege in public: no policy is `TO anon`, and every anonymous path is a
--      definer RPC (resolve_share_token, reschedule, readiness_probe, ops_ingest_error).
--   3. `authenticated` loses every DML privilege no policy admits (the matrix's former `none` cells, now `rpc_only`):
--      an attempt is refused with 42501 instead of silently affecting 0 rows. Column-level grants (memberships UPDATE,
--      payments INSERT, communication_queue SELECT) are left alone: a table-level REVOKE of the same privilege would
--      also remove them.
--   4. Future objects start closed (R-13): for role postgres, new tables and sequences in public grant nothing to
--      anon/authenticated, new functions in public grant nothing to anon/authenticated, and (globally, because a
--      per-schema rule cannot remove it) new functions no longer get PUBLIC EXECUTE. Every later migration grants
--      explicitly (the per-migration checklist already requires it). service_role keeps its defaults.
--
-- Statement timeouts (R-47, V2-03 03-07 finding 3): no value changes. grants.test.sql pins the role-level
-- `statement_timeout` of anon (3s) and authenticated (8s) as found at branch time: function-level timeouts are not
-- enforced for the calling statement, so the role setting is the only bound.
-- The audit_logs INSERT revoke is 000060's (with `log_audit`, which replaces the direct insert).

-- 1. ----------------------------------------------------------------------------------------------------------------
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
-- MAINTAIN exists from PostgreSQL 17 (the local stack); guarded so the file also applies to an older server.
DO $$
BEGIN
    IF current_setting('server_version_num')::int >= 170000 THEN
        EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    END IF;
END;
$$;

-- 2. ----------------------------------------------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- 3. ----------------------------------------------------------------------------------------------------------------
-- (table, privileges no policy admits for authenticated). Tables not listed already hold exactly their matrix set.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('tenants',                 'INSERT, DELETE'),
            ('patients',                'DELETE'),
            ('visits',                  'DELETE'),
            ('visit_revisions',         'UPDATE, DELETE'),
            ('consultations',           'DELETE'),
            ('prescriptions',           'DELETE'),
            ('invoices',                'DELETE'),
            ('payments',                'UPDATE, DELETE'),
            ('queue_tokens',            'DELETE'),
            ('waitlist_entries',        'DELETE'),
            ('consent_records',         'UPDATE, DELETE'),
            ('referrals',               'DELETE'),
            ('in_app_notifications',    'INSERT'),
            ('tenant_messaging_config', 'DELETE'),
            ('audit_logs',              'UPDATE, DELETE'),
            ('subscriptions',           'INSERT, UPDATE, DELETE'),
            ('payment_records',         'INSERT, UPDATE, DELETE'),
            ('cdci_brands',             'INSERT, UPDATE, DELETE'),
            ('cdci_drug_forms',         'INSERT, UPDATE, DELETE'),
            ('cdci_generics',           'INSERT, UPDATE, DELETE'),
            ('cdci_medicines_search',   'INSERT, UPDATE, DELETE'),
            ('cdci_products',           'INSERT, UPDATE, DELETE'),
            ('cdci_routes',             'INSERT, UPDATE, DELETE'),
            ('cdci_substances',         'INSERT, UPDATE, DELETE'),
            ('cdci_suppliers',          'INSERT, UPDATE, DELETE'),
            ('opd_diagnoses',           'INSERT, UPDATE, DELETE')
        ) AS v(tbl, privs)
    LOOP
        EXECUTE format('REVOKE %s ON TABLE public.%I FROM authenticated', r.privs, r.tbl);
    END LOOP;
END;
$$;

-- 4. ----------------------------------------------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
