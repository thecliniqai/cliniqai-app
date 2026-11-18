-- Migration: 000065_tenant_local_dates.sql
-- V2-05 plan 05-08 step 4 (V2-03 R-33 carry-over; ruling R-19; V2-03 03-05 clinic-date parity).
--
-- `queue_tokens.date` and `patient_documents.report_date` defaulted to `CURRENT_DATE`, which is the date in the
-- database server's `TimeZone` (UTC): a row written between 00:00 and 05:30 IST without an explicit value got the
-- previous day. The app passes the clinic date since V2-03 03-05 and `next_queue_token` returns it, so these triggers
-- cover every remaining writer (SQL, system and service-role paths) without breaking a caller that omits the value:
--   - both columns lose their default (they stay NOT NULL);
--   - a BEFORE INSERT trigger fills a NULL value with `tenant_local_date(NEW.tenant_id, now())` (the clinic's zone,
--     Asia/Kolkata fallback, previous migration); an explicit value is kept as given.
-- The trigger functions are SECURITY INVOKER in `private` (`authenticated` and `service_role` hold USAGE there) and
-- grant EXECUTE to nobody: a trigger function needs no EXECUTE privilege when it fires; `tenant_local_date` is
-- executable by the inserting roles. No other trigger on these tables reads the two columns, so the firing order
-- among BEFORE INSERT triggers does not matter.
-- Per-migration checklist: no new table; search_path '' and fully qualified names; no data is changed.

-- 1. Defaults ---------------------------------------------------------------------------------------------------------
ALTER TABLE public.queue_tokens ALTER COLUMN date DROP DEFAULT;
ALTER TABLE public.patient_documents ALTER COLUMN report_date DROP DEFAULT;

-- 2. Fill triggers ----------------------------------------------------------------------------------------------------
CREATE FUNCTION private.queue_tokens_fill_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.date IS NULL THEN
        NEW.date := public.tenant_local_date(NEW.tenant_id, now());
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION private.patient_documents_fill_report_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.report_date IS NULL THEN
        NEW.report_date := public.tenant_local_date(NEW.tenant_id, now());
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.queue_tokens_fill_date() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.patient_documents_fill_report_date() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER queue_tokens_fill_date
    BEFORE INSERT ON public.queue_tokens
    FOR EACH ROW EXECUTE FUNCTION private.queue_tokens_fill_date();

CREATE TRIGGER patient_documents_fill_report_date
    BEFORE INSERT ON public.patient_documents
    FOR EACH ROW EXECUTE FUNCTION private.patient_documents_fill_report_date();
