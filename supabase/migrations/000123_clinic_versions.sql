-- Migration: 000123_clinic_versions.sql
-- V2-09e 09E-04 (R-18, R-19; threats T-09E-05..): live convergence. One version per clinic and domain, raised once per transaction by
-- statement-level triggers; one PHI-free signal {domain, version} per clinic, domain and transaction; the row versions the stale-write
-- refusal (09E-07) compares.
--
-- 1. public.clinic_versions(tenant_id, domain, version, changed_at, last_xact): RLS on, SELECT for the members of the clinic, no write
--    grant. Four rows per clinic (schedule, queue, billing, settings): created for every existing clinic here and for every new one by
--    a trigger on tenants.
-- 2. private.clinic_bump(tenant ids, domain) (definer, no API grant): the once-per-transaction upsert (the first statement of a
--    transaction raises the version and sends; later statements find their own transaction id and do neither). The send sits in a
--    block that swallows every error: a Realtime fault never rolls back a write. Clinics are bumped in id order and the triggers bump
--    domains in alphabetical order (billing, queue, schedule, settings), so two statements never wait on each other's rows in opposite order.
-- 3. private.today_signal_send(tenant, domain, version): replaced; payload {domain, version} and nothing else; topic and policy unchanged.
--    The row-level *_today_signal* triggers and private.today_signal() are dropped (the old {kind, visit_id} payload goes).
-- 4. Statement-level AFTER triggers with transition tables, one per table and event (PostgreSQL allows a transition table only on a
--    trigger with one event and, for UPDATE, no column list: the UPDATE functions compare the listed columns of the old and new rows
--    themselves). What moves what is listed in the comment of each function; the columns of each table that are listed or not are in
--    09E-NOTES.md. An empty transition table bumps nothing.
-- 5. visits.row_version and invoices.row_version (bigint NOT NULL DEFAULT 0): a BEFORE trigger sets them (a written value is overridden)
--    and raises them by 1 only when a listed column changes (used by 09E-07).
-- 6. public.clinic_live_state(tenant): the four versions and the clinic's access level from one statement; NULL for a non-member.
-- Per-migration checklist: one new tenant table (RLS on, SELECT policy on authz.member_tenant_ids, no write grant), one new public
-- function (clinic_live_state, INVOKER, EXECUTE authenticated only), 15 new private definer functions (clinic_bump, clinic_versions_seed,
-- 13 cv_* statement-trigger functions; no API grant) and one replaced (today_signal_send, new signature), two private invoker row-version
-- trigger functions, two new columns, 22 statement triggers + 2 row-version triggers + 1 tenants seed trigger; 7 row triggers and
-- private.today_signal() dropped. Additive for the app (a build that does not read the versions is unaffected).

-- 1. The table ---------------------------------------------------------------------------------------------------------
CREATE TABLE public.clinic_versions (
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    domain text NOT NULL CHECK (domain IN ('schedule', 'queue', 'billing', 'settings')),
    version bigint NOT NULL DEFAULT 0,
    changed_at timestamptz NOT NULL DEFAULT now(),
    last_xact xid8,
    PRIMARY KEY (tenant_id, domain)
);
COMMENT ON TABLE public.clinic_versions IS
    'V2-09e 09E-04 (R-18): one version per clinic and domain, raised at most once per transaction by private.clinic_bump (statement-level triggers). No PHI. Written only by that function.';
ALTER TABLE public.clinic_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinic_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.clinic_versions TO authenticated;
CREATE POLICY clinic_versions_select ON public.clinic_versions
    FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT authz.member_tenant_ids()));

INSERT INTO public.clinic_versions (tenant_id, domain)
SELECT t.id, d.domain
  FROM public.tenants t
 CROSS JOIN (VALUES ('schedule'), ('queue'), ('billing'), ('settings')) AS d (domain)
ON CONFLICT DO NOTHING;

CREATE FUNCTION private.clinic_versions_seed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.clinic_versions (tenant_id, domain)
    SELECT NEW.id, d.domain
      FROM (VALUES ('schedule'), ('queue'), ('billing'), ('settings')) AS d (domain)
    ON CONFLICT DO NOTHING;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.clinic_versions_seed() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.clinic_versions_seed() IS
    'V2-09e 09E-04 (R-18): AFTER INSERT trigger on tenants: the four version rows of a new clinic.';
CREATE TRIGGER tenants_clinic_versions_seed
    AFTER INSERT ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION private.clinic_versions_seed();

-- 2. The sender and the bump --------------------------------------------------------------------------------------------
DROP FUNCTION private.today_signal_send(uuid, text, uuid);
CREATE FUNCTION private.today_signal_send(p_tenant_id uuid, p_domain text, p_version bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT realtime.send(jsonb_build_object('domain', p_domain, 'version', p_version), 'today', 'today:' || p_tenant_id::text, true)
$$;
REVOKE ALL ON FUNCTION private.today_signal_send(uuid, text, bigint) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.today_signal_send(uuid, text, bigint) IS
    'V2-09e 09E-04 (R-18; replaces the 08-03a sender): sends the PHI-free signal {domain, version} as a private broadcast on today:<tenant>. Only private.clinic_bump calls it.';

CREATE FUNCTION private.clinic_bump(p_tenant_ids uuid[], p_domain text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r record;
BEGIN
    IF p_tenant_ids IS NULL OR cardinality(p_tenant_ids) = 0 THEN
        RETURN;
    END IF;
    -- The first statement of a transaction raises the version (and sends); a later one finds its own transaction id and does
    -- neither. A clinic that is being deleted has no tenants row any more: it gets no version row (and no foreign key error).
    FOR r IN
        INSERT INTO public.clinic_versions AS cv (tenant_id, domain, version, changed_at, last_xact)
        SELECT t.id, p_domain, 1, now(), pg_current_xact_id()
          FROM public.tenants t
         WHERE t.id = ANY (p_tenant_ids)
         ORDER BY t.id
        ON CONFLICT (tenant_id, domain) DO UPDATE
            SET version = cv.version + 1, changed_at = now(), last_xact = pg_current_xact_id()
          WHERE cv.last_xact IS DISTINCT FROM pg_current_xact_id()
        RETURNING cv.tenant_id AS tenant_id, cv.version AS version
    LOOP
        -- A Realtime fault must never roll back the write: every error of the send is swallowed.
        BEGIN
            PERFORM private.today_signal_send(r.tenant_id, p_domain, r.version);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.clinic_bump(uuid[], text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.clinic_bump(uuid[], text) IS
    'V2-09e 09E-04 (R-18): raises the version of one domain of each listed clinic once per transaction and sends {domain, version} for each clinic it raised. Called by the statement triggers only.';

-- 3. The old row-level triggers go ------------------------------------------------------------------------------------------
DROP TRIGGER visits_today_signal_insert ON public.visits;
DROP TRIGGER visits_today_signal_update ON public.visits;
DROP TRIGGER queue_tokens_today_signal ON public.queue_tokens;
DROP TRIGGER payments_today_signal ON public.payments;
DROP TRIGGER clinical_notes_today_signal ON public.clinical_notes;
DROP TRIGGER invoices_today_signal_insert ON public.invoices;
DROP TRIGGER invoices_today_signal_update ON public.invoices;
DROP FUNCTION private.today_signal();

-- 4. The statement triggers -------------------------------------------------------------------------------------------------
-- visits: insert -> queue, schedule; update of status -> queue, schedule; update of scheduled_at, doctor_id, estimated_duration_minutes,
-- is_overbooked, origin_type -> schedule.
CREATE FUNCTION private.cv_visits_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ids uuid[];
BEGIN
    SELECT array_agg(DISTINCT c.tenant_id ORDER BY c.tenant_id) INTO v_ids FROM changed_rows c;
    PERFORM private.clinic_bump(v_ids, 'queue');
    PERFORM private.clinic_bump(v_ids, 'schedule');
    RETURN NULL;
END;
$$;
CREATE FUNCTION private.cv_visits_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_queue uuid[]; v_schedule uuid[];
BEGIN
    SELECT array_agg(DISTINCT n.tenant_id ORDER BY n.tenant_id) FILTER (WHERE o.status IS DISTINCT FROM n.status),
           array_agg(DISTINCT n.tenant_id ORDER BY n.tenant_id) FILTER (WHERE o.status IS DISTINCT FROM n.status
               OR o.scheduled_at IS DISTINCT FROM n.scheduled_at
               OR o.doctor_id IS DISTINCT FROM n.doctor_id
               OR o.estimated_duration_minutes IS DISTINCT FROM n.estimated_duration_minutes
               OR o.is_overbooked IS DISTINCT FROM n.is_overbooked
               OR o.origin_type IS DISTINCT FROM n.origin_type)
      INTO v_queue, v_schedule
      FROM new_rows n JOIN old_rows o ON o.id = n.id;
    PERFORM private.clinic_bump(v_queue, 'queue');
    PERFORM private.clinic_bump(v_schedule, 'schedule');
    RETURN NULL;
END;
$$;
CREATE TRIGGER visits_clinic_version_insert AFTER INSERT ON public.visits
    REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_visits_insert();
CREATE TRIGGER visits_clinic_version_update AFTER UPDATE ON public.visits
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_visits_update();

-- queue_tokens: insert, update -> queue.
CREATE FUNCTION private.cv_queue_tokens()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM private.clinic_bump((SELECT array_agg(DISTINCT c.tenant_id ORDER BY c.tenant_id) FROM changed_rows c), 'queue');
    RETURN NULL;
END;
$$;
CREATE TRIGGER queue_tokens_clinic_version_insert AFTER INSERT ON public.queue_tokens
    REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_queue_tokens();
CREATE TRIGGER queue_tokens_clinic_version_update AFTER UPDATE ON public.queue_tokens
    REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_queue_tokens();

-- clinical_notes: update of vitals -> queue.
CREATE FUNCTION private.cv_clinical_notes_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM private.clinic_bump(
        (SELECT array_agg(DISTINCT n.tenant_id ORDER BY n.tenant_id)
           FROM new_rows n JOIN old_rows o ON o.visit_id = n.visit_id WHERE o.vitals IS DISTINCT FROM n.vitals),
        'queue');
    RETURN NULL;
END;
$$;
CREATE TRIGGER clinical_notes_clinic_version_update AFTER UPDATE ON public.clinical_notes
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_clinical_notes_update();

-- invoices: insert; update of total_amount, status -> billing.
CREATE FUNCTION private.cv_invoices_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM private.clinic_bump((SELECT array_agg(DISTINCT c.tenant_id ORDER BY c.tenant_id) FROM changed_rows c), 'billing');
    RETURN NULL;
END;
$$;
CREATE FUNCTION private.cv_invoices_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM private.clinic_bump(
        (SELECT array_agg(DISTINCT n.tenant_id ORDER BY n.tenant_id)
           FROM new_rows n JOIN old_rows o ON o.id = n.id
          WHERE o.total_amount IS DISTINCT FROM n.total_amount OR o.status IS DISTINCT FROM n.status),
        'billing');
    RETURN NULL;
END;
$$;
CREATE TRIGGER invoices_clinic_version_insert AFTER INSERT ON public.invoices
    REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_invoices_insert();
CREATE TRIGGER invoices_clinic_version_update AFTER UPDATE ON public.invoices
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_invoices_update();

-- invoice_items: insert, update, delete -> billing.
CREATE FUNCTION private.cv_invoice_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM private.clinic_bump((SELECT array_agg(DISTINCT c.tenant_id ORDER BY c.tenant_id) FROM changed_rows c), 'billing');
    RETURN NULL;
END;
$$;
CREATE TRIGGER invoice_items_clinic_version_insert AFTER INSERT ON public.invoice_items
    REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_invoice_items();
CREATE TRIGGER invoice_items_clinic_version_update AFTER UPDATE ON public.invoice_items
    REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_invoice_items();
CREATE TRIGGER invoice_items_clinic_version_delete AFTER DELETE ON public.invoice_items
    REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_invoice_items();

-- payments: insert, update -> billing.
CREATE FUNCTION private.cv_payments()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM private.clinic_bump((SELECT array_agg(DISTINCT c.tenant_id ORDER BY c.tenant_id) FROM changed_rows c), 'billing');
    RETURN NULL;
END;
$$;
CREATE TRIGGER payments_clinic_version_insert AFTER INSERT ON public.payments
    REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_payments();
CREATE TRIGGER payments_clinic_version_update AFTER UPDATE ON public.payments
    REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_payments();

-- schedule_blocks, waitlist_entries: insert, update, delete -> schedule.
CREATE FUNCTION private.cv_schedule_blocks()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM private.clinic_bump((SELECT array_agg(DISTINCT c.tenant_id ORDER BY c.tenant_id) FROM changed_rows c), 'schedule');
    RETURN NULL;
END;
$$;
CREATE TRIGGER schedule_blocks_clinic_version_insert AFTER INSERT ON public.schedule_blocks
    REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_schedule_blocks();
CREATE TRIGGER schedule_blocks_clinic_version_update AFTER UPDATE ON public.schedule_blocks
    REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_schedule_blocks();
CREATE TRIGGER schedule_blocks_clinic_version_delete AFTER DELETE ON public.schedule_blocks
    REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_schedule_blocks();

CREATE FUNCTION private.cv_waitlist_entries()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM private.clinic_bump((SELECT array_agg(DISTINCT c.tenant_id ORDER BY c.tenant_id) FROM changed_rows c), 'schedule');
    RETURN NULL;
END;
$$;
CREATE TRIGGER waitlist_entries_clinic_version_insert AFTER INSERT ON public.waitlist_entries
    REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_waitlist_entries();
CREATE TRIGGER waitlist_entries_clinic_version_update AFTER UPDATE ON public.waitlist_entries
    REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_waitlist_entries();
CREATE TRIGGER waitlist_entries_clinic_version_delete AFTER DELETE ON public.waitlist_entries
    REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_waitlist_entries();

-- memberships: insert, delete; update of availability_schedule, default_slot_duration_minutes, role, status, full_name -> schedule, settings.
CREATE FUNCTION private.cv_memberships_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ids uuid[];
BEGIN
    SELECT array_agg(DISTINCT c.tenant_id ORDER BY c.tenant_id) INTO v_ids FROM changed_rows c;
    PERFORM private.clinic_bump(v_ids, 'schedule');
    PERFORM private.clinic_bump(v_ids, 'settings');
    RETURN NULL;
END;
$$;
CREATE FUNCTION private.cv_memberships_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ids uuid[];
BEGIN
    SELECT array_agg(DISTINCT n.tenant_id ORDER BY n.tenant_id) INTO v_ids
      FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE o.availability_schedule IS DISTINCT FROM n.availability_schedule
        OR o.default_slot_duration_minutes IS DISTINCT FROM n.default_slot_duration_minutes
        OR o.role IS DISTINCT FROM n.role
        OR o.status IS DISTINCT FROM n.status
        OR o.full_name IS DISTINCT FROM n.full_name;
    PERFORM private.clinic_bump(v_ids, 'schedule');
    PERFORM private.clinic_bump(v_ids, 'settings');
    RETURN NULL;
END;
$$;
CREATE TRIGGER memberships_clinic_version_insert AFTER INSERT ON public.memberships
    REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_memberships_change();
CREATE TRIGGER memberships_clinic_version_delete AFTER DELETE ON public.memberships
    REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_memberships_change();
CREATE TRIGGER memberships_clinic_version_update AFTER UPDATE ON public.memberships
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_memberships_update();

-- tenants: update of name, timezone and the columns the session bootstrap and the Rx letterhead show -> settings.
-- (There is no profiles table in this schema: the display name lives in memberships.full_name, above.)
CREATE FUNCTION private.cv_tenants_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM private.clinic_bump(
        (SELECT array_agg(DISTINCT n.id ORDER BY n.id)
           FROM new_rows n JOIN old_rows o ON o.id = n.id
          WHERE o.name IS DISTINCT FROM n.name
             OR o.timezone IS DISTINCT FROM n.timezone
             OR o.rx_letterhead_mode IS DISTINCT FROM n.rx_letterhead_mode
             OR o.rx_paper_size IS DISTINCT FROM n.rx_paper_size
             OR o.letterhead_top_margin IS DISTINCT FROM n.letterhead_top_margin
             OR o.letterhead_bottom_margin IS DISTINCT FROM n.letterhead_bottom_margin
             OR o.logo_url IS DISTINCT FROM n.logo_url
             OR o.address IS DISTINCT FROM n.address
             OR o.phone IS DISTINCT FROM n.phone
             OR o.email IS DISTINCT FROM n.email
             OR o.registration_number IS DISTINCT FROM n.registration_number
             OR o.clinical_establishment_reg_no IS DISTINCT FROM n.clinical_establishment_reg_no
             OR o.state_medical_council_reg_no IS DISTINCT FROM n.state_medical_council_reg_no
             OR o.drug_license_no IS DISTINCT FROM n.drug_license_no
             OR o.gstin IS DISTINCT FROM n.gstin),
        'settings');
    RETURN NULL;
END;
$$;
CREATE TRIGGER tenants_clinic_version_update AFTER UPDATE ON public.tenants
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION private.cv_tenants_update();

DO $$
DECLARE
    f text;
BEGIN
    FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p
              WHERE p.pronamespace = 'private'::regnamespace AND p.proname LIKE 'cv\_%' LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
    END LOOP;
END;
$$;
COMMENT ON FUNCTION private.cv_visits_insert() IS 'V2-09e 09E-04 (R-18): statement trigger: new visits -> queue, schedule.';
COMMENT ON FUNCTION private.cv_visits_update() IS 'V2-09e 09E-04 (R-18): statement trigger: status -> queue, schedule; scheduled_at, doctor_id, estimated_duration_minutes, is_overbooked, origin_type -> schedule.';
COMMENT ON FUNCTION private.cv_queue_tokens() IS 'V2-09e 09E-04 (R-18): statement trigger: queue_tokens insert, update -> queue.';
COMMENT ON FUNCTION private.cv_clinical_notes_update() IS 'V2-09e 09E-04 (R-18): statement trigger: clinical_notes update of vitals -> queue.';
COMMENT ON FUNCTION private.cv_invoices_insert() IS 'V2-09e 09E-04 (R-18): statement trigger: new invoices -> billing.';
COMMENT ON FUNCTION private.cv_invoices_update() IS 'V2-09e 09E-04 (R-18): statement trigger: invoices update of total_amount, status -> billing.';
COMMENT ON FUNCTION private.cv_invoice_items() IS 'V2-09e 09E-04 (R-18): statement trigger: invoice_items insert, update, delete -> billing.';
COMMENT ON FUNCTION private.cv_payments() IS 'V2-09e 09E-04 (R-18): statement trigger: payments insert, update -> billing.';
COMMENT ON FUNCTION private.cv_schedule_blocks() IS 'V2-09e 09E-04 (R-18): statement trigger: schedule_blocks insert, update, delete -> schedule.';
COMMENT ON FUNCTION private.cv_waitlist_entries() IS 'V2-09e 09E-04 (R-18): statement trigger: waitlist_entries insert, update, delete -> schedule.';
COMMENT ON FUNCTION private.cv_memberships_change() IS 'V2-09e 09E-04 (R-18): statement trigger: memberships insert, delete -> schedule, settings.';
COMMENT ON FUNCTION private.cv_memberships_update() IS 'V2-09e 09E-04 (R-18): statement trigger: memberships update of availability_schedule, default_slot_duration_minutes, role, status, full_name -> schedule, settings.';
COMMENT ON FUNCTION private.cv_tenants_update() IS 'V2-09e 09E-04 (R-18): statement trigger: tenants update of name, timezone and the letterhead and registration columns -> settings.';

-- 5. Row versions (R-19) ----------------------------------------------------------------------------------------------------
ALTER TABLE public.visits ADD COLUMN row_version bigint NOT NULL DEFAULT 0;
ALTER TABLE public.invoices ADD COLUMN row_version bigint NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.visits.row_version IS
    'V2-09e 09E-04 (R-19): +1 on an update of status, scheduled_at, doctor_id, estimated_duration_minutes, is_overbooked, origin_type, patient_id or signed_at only (a background write to metadata or a reminder column moves nothing). Set by the BEFORE trigger; a written value is overridden.';
COMMENT ON COLUMN public.invoices.row_version IS
    'V2-09e 09E-04 (R-19): +1 on an update of status, total_amount, subtotal, discount or tax only. Set by the BEFORE trigger; a written value is overridden.';

CREATE FUNCTION private.visits_row_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.row_version := 0;
    ELSIF (OLD.status, OLD.scheduled_at, OLD.doctor_id, OLD.estimated_duration_minutes, OLD.is_overbooked, OLD.origin_type, OLD.patient_id, OLD.signed_at)
          IS DISTINCT FROM
          (NEW.status, NEW.scheduled_at, NEW.doctor_id, NEW.estimated_duration_minutes, NEW.is_overbooked, NEW.origin_type, NEW.patient_id, NEW.signed_at) THEN
        NEW.row_version := OLD.row_version + 1;
    ELSE
        NEW.row_version := OLD.row_version;
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION private.invoices_row_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.row_version := 0;
    ELSIF (OLD.status, OLD.total_amount, OLD.subtotal, OLD.discount, OLD.tax) IS DISTINCT FROM (NEW.status, NEW.total_amount, NEW.subtotal, NEW.discount, NEW.tax) THEN
        NEW.row_version := OLD.row_version + 1;
    ELSE
        NEW.row_version := OLD.row_version;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.visits_row_version() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.invoices_row_version() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.visits_row_version() IS 'V2-09e 09E-04 (R-19): BEFORE trigger: visits.row_version +1 on a listed column only.';
COMMENT ON FUNCTION private.invoices_row_version() IS 'V2-09e 09E-04 (R-19): BEFORE trigger: invoices.row_version +1 on a listed column only.';
CREATE TRIGGER visits_row_version BEFORE INSERT OR UPDATE ON public.visits
    FOR EACH ROW EXECUTE FUNCTION private.visits_row_version();
CREATE TRIGGER invoices_row_version BEFORE INSERT OR UPDATE ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION private.invoices_row_version();

-- 6. The live state ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.clinic_live_state(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    -- One statement: the versions and the access level share a snapshot. The versions come through RLS (members of the clinic only),
    -- so a non-member sees no row and gets NULL.
    SELECT CASE WHEN count(*) = 4 THEN jsonb_build_object(
               'versions', jsonb_object_agg(v.domain, v.version),
               'access', public.my_tenant_access(p_tenant_id))
           END
      FROM public.clinic_versions v
     WHERE v.tenant_id = p_tenant_id
$$;
REVOKE ALL ON FUNCTION public.clinic_live_state(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clinic_live_state(uuid) TO authenticated;
COMMENT ON FUNCTION public.clinic_live_state(uuid) IS
    'V2-09e 09E-04 (R-18): {versions: {schedule, queue, billing, settings}, access} of one of the caller''s own clinics from one statement; NULL for a clinic the caller is not an active member of. INVOKER: the versions pass the clinic_versions policy.';
