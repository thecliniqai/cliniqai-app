-- Migration: 000132_doctor_directory_versions.sql
-- V2-09e 09E PR 2 review fix I-1: the versions follow every column the session bootstrap and the Schedule read. session_bootstrap (000131) lists the owner
-- among the doctors only while tenants.owner_is_practicing_doctor holds, and schedule_range (000130) lists the owner among the clinicians on the same rule;
-- both also answer memberships.default_specialty. Neither column moved a version, so another device kept a doctor list that the database no longer had (a
-- booking picker offering an owner who stopped practising, or missing one who started) for the rest of the session.
--   - private.cv_tenants_update: owner_is_practicing_doctor now moves `settings` (the bootstrap's doctors) AND `schedule` (the range's clinicians); every
--     column it already watched still moves `settings` only.
--   - private.cv_memberships_update: default_specialty joins the watched columns (-> schedule, settings, as the others).
-- Per-migration checklist: two definer trigger functions replaced (same signatures, triggers unchanged, no API grant, comments restated). No table, column,
-- policy, grant or data change. Expand-safe: the running app reads the same shapes; only more writes move a version.

-- 1. The versions of the doctor directory ------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.cv_memberships_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ids uuid[];
BEGIN
    SELECT array_agg(DISTINCT n.tenant_id ORDER BY n.tenant_id) INTO v_ids
      FROM new_rows n JOIN old_rows o ON o.id = n.id
     WHERE o.availability_schedule IS DISTINCT FROM n.availability_schedule
        OR o.default_slot_duration_minutes IS DISTINCT FROM n.default_slot_duration_minutes
        OR o.role IS DISTINCT FROM n.role
        OR o.status IS DISTINCT FROM n.status
        OR o.full_name IS DISTINCT FROM n.full_name
        OR o.default_specialty IS DISTINCT FROM n.default_specialty;
    PERFORM private.clinic_bump(v_ids, 'schedule');
    PERFORM private.clinic_bump(v_ids, 'settings');
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.cv_tenants_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    -- The owner's place among the Schedule's clinicians (schedule_range) follows owner_is_practicing_doctor. Raised BEFORE settings: the version rows are
    -- always raised in VERSION_LOCK_ORDER (queue, schedule, billing, settings; 09E-14a E, tests/live/version-lock-order.spec.ts), so two transactions never
    -- wait on each other's rows.
    PERFORM private.clinic_bump(
        (SELECT array_agg(DISTINCT n.id ORDER BY n.id)
           FROM new_rows n JOIN old_rows o ON o.id = n.id
          WHERE o.owner_is_practicing_doctor IS DISTINCT FROM n.owner_is_practicing_doctor),
        'schedule');
    PERFORM private.clinic_bump(
        (SELECT array_agg(DISTINCT n.id ORDER BY n.id)
           FROM new_rows n JOIN old_rows o ON o.id = n.id
          WHERE o.name IS DISTINCT FROM n.name
             OR o.timezone IS DISTINCT FROM n.timezone
             OR o.owner_is_practicing_doctor IS DISTINCT FROM n.owner_is_practicing_doctor
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

REVOKE ALL ON FUNCTION private.cv_memberships_update() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.cv_tenants_update() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION private.cv_memberships_update() IS 'V2-09e 09E-04 (R-18), 000132 (I-1): statement trigger: memberships update of availability_schedule, default_slot_duration_minutes, role, status, full_name, default_specialty -> schedule, settings.';
COMMENT ON FUNCTION private.cv_tenants_update() IS 'V2-09e 09E-04 (R-18), 000132 (I-1): statement trigger: tenants update of name, timezone, owner_is_practicing_doctor and the letterhead and registration columns -> settings; of owner_is_practicing_doctor -> schedule too.';
