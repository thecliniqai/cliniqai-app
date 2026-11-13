-- Migration: 000026_referral_source_clinics.sql
-- V2-03 plan 03-02 (P1-34, ADR-0005 D2 / register item R15, threat T-03-18).
--
-- The inbound-referral list shows the name and phone of the clinic that sent each referral. The receiving clinic
-- cannot read the sender's `tenants` row under RLS, so `getInboundReferrals` used a dynamic import of the
-- service-role client to read it. This function replaces that read: it runs as its owner, but returns a tenant only
-- when the caller can already see (under the "referrals_target_tenant_select" policy, 000013) a referral sent by that
-- tenant to one of the caller's own tenants. Ids of any other tenant, including ones the caller guesses, return no
-- row, so the function cannot be used to enumerate clinics.
--
--   p_ids   candidate originating tenant ids (the tenant_id of referral rows RLS already returned to the caller)
--   returns id, name, phone of each tenant in p_ids that referred a patient to a tenant the caller belongs to
--
-- `search_path` is empty, so every name is schema-qualified. Supabase's default privileges grant EXECUTE on new
-- public functions to anon, authenticated and service_role; all are revoked and only authenticated is granted
-- (anon has no tenant, the service role has no `auth.uid()`).

CREATE OR REPLACE FUNCTION public.referral_source_clinics(p_ids UUID[])
RETURNS TABLE (id UUID, name TEXT, phone TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT t.id, t.name, t.phone
    FROM public.tenants t
    WHERE t.id = ANY (p_ids)
      AND EXISTS (
          SELECT 1
          FROM public.referrals r
          WHERE r.tenant_id = t.id
            AND r.target_tenant_id IS NOT NULL
            AND r.target_tenant_id IN (SELECT public.current_user_tenant_ids())
      );
$$;

COMMENT ON FUNCTION public.referral_source_clinics(UUID[]) IS
    'V2-03 03-02: id, name, phone of clinics that sent an RLS-visible referral to the caller''s tenant (replaces the service-role read, ADR-0005 R15).';

REVOKE ALL ON FUNCTION public.referral_source_clinics(UUID[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.referral_source_clinics(UUID[]) TO authenticated;
