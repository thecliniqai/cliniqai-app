-- Migration: 000076_reverify_integrity_migrate.sql
-- V2-05 fix plan 05-11d step 2 (N-3; diagnostics for N-1, N-7, N-8). MIGRATE + VALIDATE.
-- Run the diagnostics first (`npm run db:diagnostics -- --label <label>`; markers D7i, D1p, D11n and D11r in
-- scripts/db/diagnostics.sql). The same counts are raised as NOTICEs here (numbers only, no row data).
--
-- 1. D7i: invoice items with a negative unit price or a line total that is not round(unit_price * quantity, 2). There
--    is no automatic remedy (rewriting a charge changes what a patient was billed and may flip a paid invoice), so the
--    VALIDATE below fails with 23514 and the migration stops until each row is corrected with the clinic (pinned in
--    reverify_integrity.test.sql). The app has always written price * quantity with a non-negative price, so D7i is
--    expected to be 0.
-- 2. D1p (report only): diagnoses whose patient is not their visit's patient. New rows are refused by 000075; an
--    existing one is corrected per row with the clinic (the visit is the encounter of record).
-- 3. D11n (report only): notice links the 000075 CHECK would refuse. Its VALIDATE stays with 05-b0 (triage
--    assignment), after this diagnostic.
-- 4. D11r (report only): amendment numbers above 10000 (only a squatted row, N-8, can be one; the next number would be
--    previous + 1 and could overflow). Remedy per visit, with the clinic.
-- 5. VALIDATE invoice_items_unit_price_nonnegative and invoice_items_total_matches.

DO $$
DECLARE
    v_items integer;
    v_diag integer;
    v_links integer;
    v_rev integer;
BEGIN
    SELECT count(*) INTO v_items FROM public.invoice_items
     WHERE unit_price < 0 OR total_price IS DISTINCT FROM round(unit_price * quantity, 2);
    SELECT count(*) INTO v_diag FROM public.consultation_diagnoses d
      JOIN public.visits v ON v.tenant_id = d.tenant_id AND v.id = d.visit_id
     WHERE v.patient_id IS DISTINCT FROM d.patient_id;
    SELECT count(*) INTO v_links FROM public.in_app_notifications
     WHERE link_url IS NOT NULL AND link_url !~ '^/([^/\\[:cntrl:][:space:]][^[:cntrl:][:space:]]*)?$';
    SELECT count(*) INTO v_rev FROM public.visit_revisions WHERE revision_number > 10000;
    RAISE NOTICE '05-11d diagnostics: D7i invoice items off the price x quantity rule = %, D1p diagnoses on another patient = %, D11n notice links refused by the new check = %, D11r amendment numbers above 10000 = %',
        v_items, v_diag, v_links, v_rev;
END;
$$;

ALTER TABLE public.invoice_items VALIDATE CONSTRAINT invoice_items_unit_price_nonnegative;
ALTER TABLE public.invoice_items VALIDATE CONSTRAINT invoice_items_total_matches;
