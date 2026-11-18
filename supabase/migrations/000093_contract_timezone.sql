-- Migration: 000093_contract_timezone.sql
-- V2-05 fix plan 05-12, contract step of H-AITZ part 4 (000092 added CHECK `tenants_timezone_iana` NOT VALID).
--
-- Diagnostic D12z (scripts/db/diagnostics.sql) counts clinics whose `timezone` is not an IANA zone name. Run it before
-- this file; any such clinic stops the migration here (no automatic remedy: the clinic's real zone is confirmed with
-- the clinic and the row corrected, then this file runs again). Then the CHECK is validated, so every existing row
-- holds a valid zone, as every new or changed row already must since 000092.

DO $$
DECLARE
    v_bad integer;
BEGIN
    SELECT count(*) INTO v_bad FROM public.tenants t WHERE NOT private.is_iana_timezone(t.timezone);
    IF v_bad > 0 THEN
        RAISE EXCEPTION 'D12z: % clinic(s) hold a time zone that is not an IANA zone name; correct them before 000093', v_bad;
    END IF;
END;
$$;

ALTER TABLE public.tenants VALIDATE CONSTRAINT tenants_timezone_iana;
