-- Migration: 000019_membership_guard.sql
-- V2-01 plan 01-02 (P0-02; SEC-03, SEC-08 part, ARC-02, SEC-09 ride-along).
--
-- 1. memberships: no direct INSERT/DELETE, UPDATE limited to profile columns. role, tenant_id and user_id change only
--    through SECURITY DEFINER functions (change_member_role, consume_invitation, create_clinic_with_owner).
--    A column-level REVOKE alone has no effect while a table-level grant exists, so the table grant goes first.
-- 2. current_user_has_role(tenant, roles) helper.
-- 3. change_member_role(membership_id, role): owner/admin only; owner/admin grants and changes to an owner/admin
--    row are owner-only; last-owner guard under a row lock; audited in the same transaction.
-- 4. invitations: owner/admin invites are owner-only; created_by must be the caller; no pre-consumed rows.
-- 5. SEC-09: membership checks inside generate_daily_queue_token, generate_tenant_invoice_number, search_medicines;
--    search_path = '' on every SECURITY DEFINER function touched here; EXECUTE revoked from anon per function.
-- Signatures are unchanged (expand-safe).

-- 1. memberships privileges --------------------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.memberships FROM anon, authenticated;
GRANT UPDATE (
    full_name,
    phone,
    qualifications,
    medical_council_reg_no,
    default_specialty,
    availability_schedule,
    default_slot_duration_minutes
) ON public.memberships TO authenticated;
-- signature_url is never written by the app; it stays ungranted.
-- Policy "memberships_update_tenant" (self, or owner/admin of the tenant) is unchanged and now applies to the
-- columns above only.

-- invitations: writes only through the INSERT policy below (no UPDATE/DELETE policy exists; remove the grants too).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.invitations FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.invitations FROM authenticated;

-- 2. Helpers ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_has_role(p_tenant_id UUID, p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.tenant_id = p_tenant_id
          AND m.user_id = auth.uid()
          AND m.role = ANY (p_roles)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_has_role(UUID, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(UUID, TEXT[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_tenant_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT m.tenant_id
    FROM public.memberships m
    WHERE m.user_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_tenant_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_ids() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_is_admin_or_owner(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.tenant_id = p_tenant_id
          AND m.user_id = auth.uid()
          AND m.role IN ('owner', 'admin')
    );
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_is_admin_or_owner(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin_or_owner(UUID) TO authenticated, service_role;

-- 3. change_member_role -----------------------------------------------------------------------------------------
-- Errors (SQLSTATE, message): 28000 not_authenticated; 22023 invalid_role; P0002 not_found (also when the caller is
-- not a member of the target's tenant, so no tenant is revealed); 42501 forbidden (caller not owner/admin);
-- 42501 owner_required (owner/admin involved, caller is an admin); P0001 last_owner.
CREATE OR REPLACE FUNCTION public.change_member_role(p_membership_id UUID, p_role TEXT)
RETURNS public.memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_target public.memberships;
    v_caller_role TEXT;
    v_old_role TEXT;
    v_owners INTEGER;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
    END IF;

    IF p_role IS NULL OR p_role NOT IN ('owner', 'admin', 'doctor', 'receptionist', 'nurse') THEN
        RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_target FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    -- The tenant comes from the target row; the caller must be a member of that same tenant.
    SELECT m.role INTO v_caller_role
    FROM public.memberships m
    WHERE m.tenant_id = v_target.tenant_id AND m.user_id = v_uid;

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_caller_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF (p_role IN ('owner', 'admin') OR v_target.role IN ('owner', 'admin')) AND v_caller_role <> 'owner' THEN
        RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501';
    END IF;

    IF v_target.role = p_role THEN
        RETURN v_target;
    END IF;

    IF v_target.role = 'owner' THEN
        -- Serialise concurrent demotions of the tenant's owners, then count.
        PERFORM 1 FROM public.memberships
        WHERE tenant_id = v_target.tenant_id AND role = 'owner'
        FOR UPDATE;

        SELECT count(*) INTO v_owners
        FROM public.memberships
        WHERE tenant_id = v_target.tenant_id AND role = 'owner';

        IF v_owners <= 1 THEN
            RAISE EXCEPTION 'last_owner' USING ERRCODE = 'P0001';
        END IF;
    END IF;

    v_old_role := v_target.role;

    UPDATE public.memberships
    SET role = p_role
    WHERE id = p_membership_id
    RETURNING * INTO v_target;

    INSERT INTO public.audit_logs (tenant_id, actor_id, actor_role, action, entity_type, entity_id, metadata)
    VALUES (
        v_target.tenant_id,
        v_uid,
        v_caller_role,
        'staff.member.role_change',
        'membership',
        v_target.id,
        jsonb_build_object('target_user_id', v_target.user_id, 'from_role', v_old_role, 'to_role', p_role)
    );

    RETURN v_target;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.change_member_role(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_member_role(UUID, TEXT) TO authenticated;

-- 4. invitations insert policy ----------------------------------------------------------------------------------
DROP POLICY IF EXISTS "invitations_insert_owner_admin" ON public.invitations;

CREATE POLICY "invitations_insert_owner_admin"
ON public.invitations
FOR INSERT
TO authenticated
WITH CHECK (
    created_by = auth.uid()
    AND consumed_at IS NULL
    AND consumed_by IS NULL
    AND public.current_user_is_admin_or_owner(tenant_id)
    AND (
        role NOT IN ('owner', 'admin')
        OR public.current_user_has_role(tenant_id, ARRAY['owner'])
    )
);

-- 5. SEC-09: tenant checks in SECURITY DEFINER functions ----------------------------------------------------------
-- The service role (system jobs, webhook booking) passes; any other caller must belong to p_tenant_id.

CREATE OR REPLACE FUNCTION public.generate_daily_queue_token(p_tenant_id UUID, p_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_next_token INTEGER;
BEGIN
    IF NOT (
        (SELECT auth.role()) = 'service_role'
        OR p_tenant_id IN (SELECT public.current_user_tenant_ids())
    ) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(MAX(q.token_number), 0) + 1
    INTO v_next_token
    FROM public.queue_tokens q
    WHERE q.tenant_id = p_tenant_id AND q.date = p_date;

    RETURN v_next_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_daily_queue_token(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_daily_queue_token(UUID, DATE) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.generate_tenant_invoice_number(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_year TEXT := to_char(now(), 'YYYY');
    v_count INTEGER;
BEGIN
    IF NOT (
        (SELECT auth.role()) = 'service_role'
        OR p_tenant_id IN (SELECT public.current_user_tenant_ids())
    ) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    SELECT count(*) + 1 INTO v_count
    FROM public.invoices i
    WHERE i.tenant_id = p_tenant_id
      AND i.invoice_number LIKE 'INV-' || v_year || '-%';

    RETURN 'INV-' || v_year || '-' || lpad(v_count::TEXT, 5, '0');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_tenant_invoice_number(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_tenant_invoice_number(UUID) TO authenticated, service_role;

-- search_medicines: the only caller passes the session user as p_doctor_id; a signed-in caller may not read another
-- doctor's custom formulary.
CREATE OR REPLACE FUNCTION public.search_medicines(
    p_query TEXT,
    p_doctor_id UUID,
    p_tenant_id UUID,
    p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
    id TEXT,
    medicine_name TEXT,
    generic_name TEXT,
    dose_form TEXT,
    default_dosage TEXT,
    default_timing TEXT,
    default_duration TEXT,
    is_custom BOOLEAN,
    is_favorite BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_clean_query TEXT := trim(COALESCE(p_query, ''));
BEGIN
    IF NOT (
        (SELECT auth.role()) = 'service_role'
        OR (
            p_tenant_id IN (SELECT public.current_user_tenant_ids())
            AND p_doctor_id = auth.uid()
        )
    ) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH custom_matches AS (
        SELECT
            cm.id::TEXT AS id,
            cm.medicine_name,
            cm.generic_name,
            cm.dose_form,
            cm.default_dosage,
            cm.default_timing,
            cm.default_duration,
            true AS is_custom,
            true AS is_favorite,
            cm.use_count
        FROM public.doctor_custom_medicines cm
        WHERE cm.tenant_id = p_tenant_id
          AND cm.doctor_id = p_doctor_id
          AND (
              v_clean_query = ''
              OR cm.medicine_name ILIKE '%' || v_clean_query || '%'
              OR COALESCE(cm.generic_name, '') ILIKE '%' || v_clean_query || '%'
          )
    ),
    cdci_matches AS (
        SELECT
            c.id,
            c.brand_name AS medicine_name,
            c.generic_name,
            c.dose_form,
            NULL::TEXT AS default_dosage,
            'After food'::TEXT AS default_timing,
            '5 days'::TEXT AS default_duration,
            false AS is_custom,
            false AS is_favorite,
            0 AS use_count
        FROM public.cdci_medicines_search c
        WHERE (
            v_clean_query = ''
            OR c.brand_name ILIKE '%' || v_clean_query || '%'
            OR COALESCE(c.generic_name, '') ILIKE '%' || v_clean_query || '%'
            OR c.search_vector @@ to_tsquery('simple', replace(v_clean_query, ' ', ' & ') || ':*')
            OR public.similarity(c.brand_name, v_clean_query) > 0.2
            OR (c.generic_name IS NOT NULL AND public.similarity(c.generic_name, v_clean_query) > 0.2)
        )
        AND NOT EXISTS (
            SELECT 1 FROM custom_matches cm2 WHERE lower(cm2.medicine_name) = lower(c.brand_name)
        )
    )
    SELECT
        q.id,
        q.medicine_name,
        q.generic_name,
        q.dose_form,
        q.default_dosage,
        q.default_timing,
        q.default_duration,
        q.is_custom,
        q.is_favorite
    FROM (
        SELECT * FROM custom_matches
        UNION ALL
        SELECT * FROM cdci_matches
    ) q
    ORDER BY q.is_favorite DESC, q.use_count DESC, q.medicine_name ASC
    LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_medicines(TEXT, UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_medicines(TEXT, UUID, UUID, INTEGER) TO authenticated, service_role;

-- Existing SECURITY DEFINER entry points: pin search_path and confirm anon has no EXECUTE.
ALTER FUNCTION public.consume_invitation(TEXT) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.consume_invitation(TEXT) FROM PUBLIC, anon;
ALTER FUNCTION public.create_clinic_with_owner(TEXT) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.create_clinic_with_owner(TEXT) FROM PUBLIC, anon;
