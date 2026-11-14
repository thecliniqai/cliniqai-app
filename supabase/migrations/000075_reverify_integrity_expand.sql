-- Migration: 000075_reverify_integrity_expand.sql
-- V2-05 fix plan 05-11d step 1 (05a re-verification, reviews/v205a-review-reverify.md: N-1, N-2, N-3, N-5, N-7, N-8).
-- EXPAND: guard triggers and NOT VALID constraints. The current app already writes only what these guards admit (its
-- amendment row's snapshot and number are now ignored and filled here), so this migration is safe ahead of the app.
--
-- Same root cause as the 05a findings: the row policies are right, but the child rows of an encounter and of an invoice
-- accepted any column value from any holder of the table's write permission.
--
-- 1. N-1 `private.prescription_items_integrity_guard` (BEFORE INSERT/UPDATE/DELETE on prescription_items, INVOKER):
--    every path: `id`, `prescription_id` and a set `tenant_id` never change (a NULL tenant_id may still be backfilled,
--    000048); a signed-in caller writes an item only while the prescription's visit is unsigned or reopened for
--    amendment (`status = 'in_consultation'`), the M-SIGNED rule of clinical_notes. A visit the caller cannot see
--    counts as locked (fail closed). 42501 PRESCRIPTION_ITEM_KEY_IMMUTABLE / PRESCRIPTION_ITEM_VISIT_SIGNED.
-- 2. N-1 `private.consultation_diagnoses_integrity_guard` (BEFORE INSERT/UPDATE/DELETE, INVOKER): every path: `id`,
--    `tenant_id`, `visit_id`, `patient_id` never change; a signed-in caller inserts a diagnosis only for its visit's own
--    patient and writes diagnoses only while the visit is unsigned or reopened. 42501 DIAGNOSIS_KEY_IMMUTABLE /
--    DIAGNOSIS_PATIENT_MISMATCH / DIAGNOSIS_VISIT_SIGNED. (The prescription header is not locked here: the app seals it
--    after the visit is signed; full immutability is V2-09a's amendment RPC, R-21.)
-- 3. N-2 + N-8 `private.visit_revisions_actor_guard` (replaced; now SECURITY DEFINER so the snapshot is complete
--    whatever the caller may read): on every path the amendment row's `snapshot` is the visit's current content
--    (visit status and signature, clinical_notes, diagnoses, the latest prescription with its items), read under the
--    visit row lock, and `revision_number` is the visit's previous highest + 1 (at least `current_revision`); client
--    values for both are ignored. A signed-in caller needs consultations:edit in the row's clinic (42501
--    AMENDMENT_FORBIDDEN, checked before anything is read or locked) and writes only as itself (unchanged).
-- 4. N-3 invoice items:
--    a. `private.invoice_items_integrity_guard` (BEFORE INSERT/UPDATE/DELETE, SECURITY DEFINER: it reads payments,
--       which the visit's doctor cannot): every path: `total_price` is computed as round(unit_price * quantity, 2);
--       `id`, `tenant_id`, `invoice_id` never change. A signed-in caller whom the item policies admit (billing:collect,
--       or consultations:edit on the doctor's own visit) cannot write the items of a `paid` or `cancelled` invoice
--       (no refund or adjustment path exists yet: V2-10), and cannot lower the total of an invoice that has payments to
--       the amount collected or below. 42501 INVOICE_ITEM_KEY_IMMUTABLE / INVOICE_ITEMS_LOCKED /
--       INVOICE_BELOW_COLLECTED. Anyone else falls through to the item policies (no oracle).
--    b. CHECKs `invoice_items_unit_price_nonnegative` (unit_price >= 0) and `invoice_items_total_matches`
--       (total_price = round(unit_price * quantity, 2)), NOT VALID; 000076 runs diagnostic D7i and VALIDATEs.
--    c. `private.invoice_items_sync_invoice` (replaced): totals still follow the items on every path, but the status
--       is never promoted to `paid` here; only `record_payment` sets `paid`. A paid invoice whose payments no longer
--       cover its total (only a system path can still change its items) goes back to `issued`.
--    Rule (documented in the 05-11d record): once money is collected a bill can grow, or shrink while a balance is
--    still due; it never reaches "settled" except through a payment, so "paid without a payment covering it" and a
--    zero-balance `issued` invoice cannot be produced through items.
-- 5. N-5 `private.patients_actor_guard` (BEFORE INSERT OR UPDATE on patients, INVOKER), signed-in callers only:
--    INSERT `created_by` = the caller; UPDATE never changes `created_by`. 42501 ACTOR_INVALID (as consents, 05-11b).
-- 6. N-7 `in_app_notifications_link_url_relative` is replaced (still NOT VALID; VALIDATE stays with 05-b0): a link is
--    "/" or "/" followed by a character that is not "/", "\", a control or a space character, and contains no control
--    or space character anywhere (browsers strip tab/newline, so "/<TAB>/host" resolved to "//host").
-- All refusals are 42501 (or 23514 for a CHECK) with a fixed message and no row data.
-- Per-migration checklist: no new table, no grant or policy change; functions pin search_path '' with qualified names;
-- trigger functions get no EXECUTE grant (two definer triggers are catalogued in definer_functions.test.sql).

-- 1. prescription_items ---------------------------------------------------------------------------------------------------
CREATE FUNCTION private.prescription_items_integrity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_rx uuid;
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.prescription_id IS DISTINCT FROM OLD.prescription_id
            OR (OLD.tenant_id IS NOT NULL AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id)) THEN
        RAISE EXCEPTION 'PRESCRIPTION_ITEM_KEY_IMMUTABLE' USING ERRCODE = '42501';
    END IF;

    IF v_uid IS NOT NULL THEN
        v_rx := CASE WHEN TG_OP = 'DELETE' THEN OLD.prescription_id ELSE NEW.prescription_id END;
        IF NOT EXISTS (SELECT 1
                         FROM public.prescriptions p
                         JOIN public.visits v ON v.tenant_id = p.tenant_id AND v.id = p.visit_id
                        WHERE p.id = v_rx
                          AND (v.signed_at IS NULL OR v.status = 'in_consultation')) THEN
            RAISE EXCEPTION 'PRESCRIPTION_ITEM_VISIT_SIGNED' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.prescription_items_integrity_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.prescription_items_integrity_guard() IS
    'V2-05 05-11d (N-1): prescription item keys never change; a signed-in caller writes items only while the visit is '
    'unsigned or reopened for amendment. 42501.';
-- Named after prescription_items_fill_tenant, so the tenant is filled before this guard runs (alphabetical order).
CREATE TRIGGER prescription_items_integrity_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.prescription_items
    FOR EACH ROW EXECUTE FUNCTION private.prescription_items_integrity_guard();

-- 2. consultation_diagnoses -----------------------------------------------------------------------------------------------
CREATE FUNCTION private.consultation_diagnoses_integrity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_tenant uuid;
    v_visit uuid;
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
            OR NEW.visit_id IS DISTINCT FROM OLD.visit_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id) THEN
        RAISE EXCEPTION 'DIAGNOSIS_KEY_IMMUTABLE' USING ERRCODE = '42501';
    END IF;

    IF v_uid IS NOT NULL THEN
        IF TG_OP = 'INSERT'
           AND NOT EXISTS (SELECT 1 FROM public.visits v
                            WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id AND v.patient_id = NEW.patient_id) THEN
            RAISE EXCEPTION 'DIAGNOSIS_PATIENT_MISMATCH' USING ERRCODE = '42501';
        END IF;
        IF TG_OP = 'DELETE' THEN
            v_tenant := OLD.tenant_id;
            v_visit := OLD.visit_id;
        ELSE
            v_tenant := NEW.tenant_id;
            v_visit := NEW.visit_id;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.visits v
                        WHERE v.tenant_id = v_tenant AND v.id = v_visit
                          AND (v.signed_at IS NULL OR v.status = 'in_consultation')) THEN
            RAISE EXCEPTION 'DIAGNOSIS_VISIT_SIGNED' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.consultation_diagnoses_integrity_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.consultation_diagnoses_integrity_guard() IS
    'V2-05 05-11d (N-1): diagnosis keys never change; a signed-in caller records a diagnosis only for its visit''s '
    'patient and writes diagnoses only while the visit is unsigned or reopened for amendment. 42501.';
CREATE TRIGGER consultation_diagnoses_integrity_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.consultation_diagnoses
    FOR EACH ROW EXECUTE FUNCTION private.consultation_diagnoses_integrity_guard();

-- 3. Amendment rows: database snapshot and number -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.visit_revisions_actor_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_visit record;
    v_notes record;
    v_prev integer;
BEGIN
    IF v_uid IS NOT NULL THEN
        -- The insert policy's own predicate, checked first: nothing is read or locked for a caller it would refuse.
        IF NOT public.has_permission(NEW.tenant_id, 'consultations:edit') THEN
            RAISE EXCEPTION 'AMENDMENT_FORBIDDEN' USING ERRCODE = '42501';
        END IF;
        IF NEW.amended_by IS DISTINCT FROM v_uid THEN
            RAISE EXCEPTION 'AMENDMENT_AUTHOR_NOT_CALLER' USING ERRCODE = '42501';
        END IF;
        NEW.amended_at := now();
    END IF;

    -- Serialise amendments of one visit: the number and the snapshot are read under the visit row lock.
    SELECT v.id, v.tenant_id, v.status, v.signed_at, v.signed_by, v.specialty, v.current_revision
      INTO v_visit
      FROM public.visits v
     WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.visit_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RETURN NEW; -- the composite FK refuses the row
    END IF;

    SELECT coalesce(max(r.revision_number), 0) INTO v_prev
      FROM public.visit_revisions r
     WHERE r.tenant_id = NEW.tenant_id AND r.visit_id = NEW.visit_id;
    NEW.revision_number := greatest(v_prev + 1, v_visit.current_revision);

    SELECT n.vitals, n.chief_complaints, n.clinical_notes, n.specialty_data, n.advice, n.investigations_advised
      INTO v_notes
      FROM public.clinical_notes n
     WHERE n.tenant_id = NEW.tenant_id AND n.visit_id = NEW.visit_id;

    NEW.snapshot := jsonb_build_object(
        'captured_by', 'database',
        'visit', jsonb_build_object(
            'status', v_visit.status,
            'signed_at', v_visit.signed_at,
            'signed_by', v_visit.signed_by,
            'specialty', v_visit.specialty,
            'vitals', v_notes.vitals,
            'chief_complaints', v_notes.chief_complaints,
            'clinical_notes', v_notes.clinical_notes,
            'specialty_data', v_notes.specialty_data,
            'advice', to_jsonb(v_notes.advice),
            'investigations_advised', to_jsonb(v_notes.investigations_advised)),
        'diagnoses', coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at, d.id)
                                 FROM public.consultation_diagnoses d
                                WHERE d.tenant_id = NEW.tenant_id AND d.visit_id = NEW.visit_id), '[]'::jsonb),
        'prescription', (SELECT to_jsonb(p) || jsonb_build_object('items',
                                    coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.sort_order, i.created_at, i.id)
                                                FROM public.prescription_items i
                                               WHERE i.tenant_id = p.tenant_id AND i.prescription_id = p.id), '[]'::jsonb))
                           FROM public.prescriptions p
                          WHERE p.tenant_id = NEW.tenant_id AND p.visit_id = NEW.visit_id
                          ORDER BY p.version DESC, p.created_at DESC, p.id
                          LIMIT 1));
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.visit_revisions_actor_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.visit_revisions_actor_guard() IS
    'V2-05 05-11a/05-11d (M-ACTOR, N-2, N-8): an amendment row is written by a consultations:edit holder as itself '
    '(amended_at = database clock); on every path its snapshot is the visit''s current content and its number the '
    'previous + 1, filled here under the visit row lock (client values ignored). SECURITY DEFINER: the snapshot does not '
    'depend on what the caller may read. 42501.';

-- 4a. invoice items: computed line total, keys, paid/cancelled lock, never below what was collected --------------------
CREATE FUNCTION private.invoice_items_integrity_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
    v_tenant uuid;
    v_invoice uuid;
    v_inv record;
    v_paid numeric;
    v_others numeric;
    v_new_total numeric;
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
            OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id) THEN
        RAISE EXCEPTION 'INVOICE_ITEM_KEY_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    IF TG_OP <> 'DELETE' THEN
        NEW.total_price := round(NEW.unit_price * NEW.quantity, 2);
    END IF;

    IF v_uid IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_tenant := OLD.tenant_id;
        v_invoice := OLD.invoice_id;
    ELSE
        v_tenant := NEW.tenant_id;
        v_invoice := NEW.invoice_id;
    END IF;

    -- Only callers the item policies admit get here; anyone else is refused by RLS as before (no status oracle).
    IF NOT (public.has_permission(v_tenant, 'billing:collect')
            OR (public.has_permission(v_tenant, 'consultations:edit')
                AND EXISTS (SELECT 1 FROM public.invoices i
                              JOIN public.visits v ON v.tenant_id = i.tenant_id AND v.id = i.visit_id
                             WHERE i.tenant_id = v_tenant AND i.id = v_invoice AND v.doctor_id = v_uid))) THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    -- The invoice row lock serialises this check with record_payment (which locks the same row first).
    SELECT inv.status, inv.discount, inv.tax INTO v_inv
      FROM public.invoices inv
     WHERE inv.tenant_id = v_tenant AND inv.id = v_invoice
       FOR UPDATE;
    IF NOT FOUND THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW; -- the composite FK refuses the row
    END IF;

    IF v_inv.status IN ('paid', 'cancelled') THEN
        RAISE EXCEPTION 'INVOICE_ITEMS_LOCKED' USING ERRCODE = '42501';
    END IF;

    IF (TG_OP = 'DELETE' AND OLD.total_price > 0) OR (TG_OP = 'UPDATE' AND NEW.total_price < OLD.total_price) THEN
        SELECT coalesce(sum(p.amount), 0) INTO v_paid
          FROM public.payments p
         WHERE p.tenant_id = v_tenant AND p.invoice_id = v_invoice;
        IF v_paid > 0 THEN
            SELECT coalesce(sum(it.total_price), 0) INTO v_others
              FROM public.invoice_items it
             WHERE it.tenant_id = v_tenant AND it.invoice_id = v_invoice AND it.id <> OLD.id;
            v_new_total := greatest(v_others + (CASE WHEN TG_OP = 'UPDATE' THEN NEW.total_price ELSE 0 END)
                                    - v_inv.discount + v_inv.tax, 0);
            IF v_new_total <= v_paid THEN
                RAISE EXCEPTION 'INVOICE_BELOW_COLLECTED' USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.invoice_items_integrity_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.invoice_items_integrity_guard() IS
    'V2-05 05-11d (N-3): line total = round(unit_price * quantity, 2) on every path; item keys never change; a caller '
    'the item policies admit cannot change the items of a paid or cancelled invoice, or lower an invoice with payments '
    'to the amount collected or below. SECURITY DEFINER (reads payments). 42501.';
CREATE TRIGGER invoice_items_integrity_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items
    FOR EACH ROW EXECUTE FUNCTION private.invoice_items_integrity_guard();

-- 4b. invoice item CHECKs (new rows from here; 000076 validates) -----------------------------------------------------------
ALTER TABLE public.invoice_items
    ADD CONSTRAINT invoice_items_unit_price_nonnegative CHECK (unit_price >= 0) NOT VALID;
ALTER TABLE public.invoice_items
    ADD CONSTRAINT invoice_items_total_matches CHECK (total_price = round(unit_price * quantity, 2)) NOT VALID;
COMMENT ON CONSTRAINT invoice_items_unit_price_nonnegative ON public.invoice_items IS
    'V2-05 05-11d (N-3): no negative charge; NOT VALID until 000076 (diagnostic D7i).';
COMMENT ON CONSTRAINT invoice_items_total_matches ON public.invoice_items IS
    'V2-05 05-11d (N-3): a line total is its price times its quantity; NOT VALID until 000076 (diagnostic D7i).';

-- 4c. the totals trigger never promotes an invoice to paid ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.invoice_items_sync_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_keys UUID[][];
    v_tenant UUID;
    v_invoice UUID;
    v_inv RECORD;
    v_subtotal NUMERIC;
    v_total NUMERIC;
    v_paid NUMERIC;
    i INT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_keys := ARRAY[ARRAY[OLD.tenant_id, OLD.invoice_id]];
    ELSIF TG_OP = 'UPDATE' AND (OLD.tenant_id, OLD.invoice_id) IS DISTINCT FROM (NEW.tenant_id, NEW.invoice_id) THEN
        v_keys := ARRAY[ARRAY[OLD.tenant_id, OLD.invoice_id], ARRAY[NEW.tenant_id, NEW.invoice_id]];
    ELSE
        v_keys := ARRAY[ARRAY[NEW.tenant_id, NEW.invoice_id]];
    END IF;

    FOR i IN 1 .. array_length(v_keys, 1) LOOP
        v_tenant := v_keys[i][1];
        v_invoice := v_keys[i][2];

        SELECT inv.discount, inv.tax, inv.status
          INTO v_inv
          FROM public.invoices inv
         WHERE inv.tenant_id = v_tenant AND inv.id = v_invoice
           FOR UPDATE;
        CONTINUE WHEN NOT FOUND; -- the invoice itself is being deleted (cascade)

        SELECT COALESCE(sum(it.total_price), 0) INTO v_subtotal
          FROM public.invoice_items it
         WHERE it.tenant_id = v_tenant AND it.invoice_id = v_invoice;
        v_total := GREATEST(v_subtotal - v_inv.discount + v_inv.tax, 0);

        SELECT COALESCE(sum(p.amount), 0) INTO v_paid
          FROM public.payments p
         WHERE p.tenant_id = v_tenant AND p.invoice_id = v_invoice;

        -- 05-11d (N-3): `paid` comes only from record_payment. A paid invoice whose payments no longer cover its total
        -- goes back to `issued`; nothing here moves an invoice to `paid`.
        UPDATE public.invoices inv
           SET subtotal = v_subtotal,
               total_amount = v_total,
               status = CASE
                            WHEN inv.status = 'paid' AND NOT (v_total > 0 AND v_paid >= v_total) THEN 'issued'
                            ELSE inv.status
                        END,
               updated_at = now()
         WHERE inv.tenant_id = v_tenant AND inv.id = v_invoice;
    END LOOP;

    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.invoice_items_sync_invoice() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.invoice_items_sync_invoice() IS
    'V2-05 05-11b/05-11d (M-INVOICE, N-3): an invoice''s subtotal and total follow its items on every path; the status '
    'only falls back from paid to issued when payments no longer cover the total; paid is set by record_payment alone.';

-- 5. patients.created_by is the caller ---------------------------------------------------------------------------------------
CREATE FUNCTION private.patients_actor_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := (SELECT auth.uid());
BEGIN
    IF v_uid IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.created_by IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'ACTOR_INVALID' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.patients_actor_guard() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.patients_actor_guard() IS
    'V2-05 05-11d (N-5): a signed-in caller registers a patient only as itself and never changes created_by. 42501.';
CREATE TRIGGER patients_actor_guard
    BEFORE INSERT OR UPDATE ON public.patients
    FOR EACH ROW EXECUTE FUNCTION private.patients_actor_guard();

-- 6. notice links: one leading slash, no control or space character -------------------------------------------------------
ALTER TABLE public.in_app_notifications DROP CONSTRAINT in_app_notifications_link_url_relative;
ALTER TABLE public.in_app_notifications
    ADD CONSTRAINT in_app_notifications_link_url_relative
    CHECK (link_url IS NULL OR link_url ~ '^/([^/\\[:cntrl:][:space:]][^[:cntrl:][:space:]]*)?$') NOT VALID;
COMMENT ON CONSTRAINT in_app_notifications_link_url_relative ON public.in_app_notifications IS
    'V2-05 05-11b/05-11d (M-NOTICE, N-7): an in-app path: "/" or "/" + a character other than "/", "\", control or '
    'space, and no control or space character anywhere. NOT VALID: VALIDATE after diagnostic D11n (05-b0).';
