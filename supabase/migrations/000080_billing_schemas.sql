-- Migration: 000080_billing_schemas.sql
-- V2-05 plan 05-09a step 1 (SUB-01; SUBSCRIPTIONS_AND_PLANS.md §6.2 "Exposure rules", §7.1; research Pitfall 6).
--
-- Two schemas that are NOT in `[api] schemas` (supabase/config.toml), so PostgREST can never call into them:
--   billing_internal  the access and entitlement functions that take a caller-supplied tenant and `p_now` (time
--                     travel for tests). USAGE for service_role only: anon and authenticated cannot even resolve a name
--                     in it (acceptance 9: `authenticated` cannot execute any billing_internal function).
--   platform          the platform-admin RPCs (05-09b). USAGE for authenticated (the future admin UI calls them; each
--                     checks `is_platform_admin()`) and service_role; never anon.
-- Functions created later in either schema grant nothing by default: PUBLIC's EXECUTE is revoked for every new
-- function of `postgres` (000059) and per schema here; each function still REVOKEs and GRANTs explicitly
-- (05-PLAN per-migration checklist item 2). Both schemas join SNAPSHOT_SCHEMAS (scripts/drift/schema-snapshot.mjs) in
-- the same commit, so their grants are in the committed snapshot and the nightly hosted drift check.

CREATE SCHEMA IF NOT EXISTS billing_internal;
CREATE SCHEMA IF NOT EXISTS platform;

REVOKE ALL ON SCHEMA billing_internal FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA platform FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA billing_internal TO service_role;
GRANT USAGE ON SCHEMA platform TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA billing_internal REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON SCHEMA billing_internal IS
    'SUB-01 (V2-05 05-09a): subscription access and entitlement functions with caller-supplied tenant and time; service_role only, never exposed through the Data API.';
COMMENT ON SCHEMA platform IS
    'SUB-01 (V2-05 05-09b): platform-admin RPCs (is_platform_admin + aal2, or service role with an explicit actor); not exposed through the Data API.';
