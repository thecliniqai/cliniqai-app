-- 000110_lab_documents_append_only.sql — V2-09a 09A-04 (R-14, R-13 lab part; P1-03 "no member DELETE on lab documents"; SEC-18 verification note; SVP 6.1
-- "storage clinic-records object UPDATE/DELETE: no for every role" for the lab class).
--
-- Lab documents are append-only: nobody deletes a lab document row or its stored file, and nobody overwrites the file. A wrong-patient upload can therefore not be
-- removed by anyone until V2-11's documents UI adds a "void" (plan Q-5, T-09A-11, recorded for the PO). No data change.
--
-- 1. The DELETE policy `patient_documents_delete` (000052) is dropped and DELETE is revoked from `authenticated`: no request path deletes a lab document.
-- 2. `private.patient_documents_no_delete`, new, BEFORE DELETE FOR EACH ROW on public.patient_documents, every writer (the service role and the postgres role too):
--    LAB_DOCUMENT_DELETE_FORBIDDEN (42501). The one exception is R-4a, the cascade of a tenant purge: a writer with no `auth.uid()` may delete when no `tenants` row
--    exists for the row's clinic (the clinical_seal precedent, 000107; the run teardown and `delete from tenants` keep working). Per-patient erasure and
--    retention purge of lab documents are V2-13 / V2-13c's, with their own reviewed scope in a new migration. The `ON DELETE SET NULL (visit_id)` of the visit FK
--    is an UPDATE, not a DELETE, and is unaffected.
-- 3. Storage (`clinic-records`, class `lab`, 000058 is the latest text): the UPDATE policy `clinic_records_lab_update` and the DELETE policy `clinic_records_lab_delete`
--    are dropped. Uploads use `upsert: false` and a document-id key since 05-02c (R-45), so nothing in the app updates or removes a lab object. SELECT and INSERT stay
--    as they were; the receipt, referral letter and Rx classes are untouched here (000109 handled the Rx class).
--
-- Refusal: SQLSTATE 42501, fixed name, no row data. Per-migration checklist: the trigger function is INVOKER with search_path '' and qualified names, EXECUTE revoked
-- from PUBLIC, anon, authenticated, service_role; nothing here grants anything.

-- 1. no DELETE policy, no DELETE privilege -------------------------------------------------------------------------------------------------
DROP POLICY patient_documents_delete ON public.patient_documents;
REVOKE DELETE ON public.patient_documents FROM authenticated;

-- 2. every writer is refused, except the cascade of a tenant purge ------------------------------------------------------------------------------
CREATE FUNCTION private.patient_documents_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    -- R-4a: the purge of a whole clinic (no session, and the clinic's own row is already gone).
    IF (SELECT auth.uid()) IS NULL AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'LAB_DOCUMENT_DELETE_FORBIDDEN' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION private.patient_documents_no_delete() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.patient_documents_no_delete() IS
    'V2-09a 09A-04 (R-14): BEFORE DELETE on patient_documents, every writer. Lab documents are append-only: refused with LAB_DOCUMENT_DELETE_FORBIDDEN (42501), except '
    'the cascade of a tenant purge (a writer with no session when the clinic''s tenants row is gone, R-4a). A void is V2-11''s.';
CREATE TRIGGER patient_documents_no_delete
    BEFORE DELETE ON public.patient_documents
    FOR EACH ROW EXECUTE FUNCTION private.patient_documents_no_delete();

-- 3. storage: the lab class has no UPDATE and no DELETE policy ----------------------------------------------------------------------------------
DROP POLICY clinic_records_lab_update ON storage.objects;
DROP POLICY clinic_records_lab_delete ON storage.objects;
