-- Migration: 000081_subscription_catalogue.sql
-- V2-05 plan 05-09a step 2 (SUB-01, AI-18; SUBSCRIPTIONS_AND_PLANS.md §4, §7.1, §7.3; AI_STRATEGY.md §4.6 "write
-- protection of gating tables", §6.2; rulings R-10, R-13).
--
-- The product catalogue, all in `public` (SUB §7.1), configurable by SQL now and by the V2-13c admin screens later:
--   plans                       one row per product (`standard`, `standard_trial`; `ai_assist`, `ai_voice_receptionist`
--                               not purchasable, AI-18). `purchasable` is the backend switch (PO-21), `visibility` what a
--                               client may list.
--   plan_prices                 versioned prices, never updated in place (a new price is a new row and a new provider
--                               plan). Integer paise; `charge_amount_paise` is GENERATED: base + GST rounded half-up to
--                               the paisa (149900 @ 1800 bp = 176882, acceptance 12). Prices are GST-exclusive (PO-20):
--                               `tax_inclusive` is CHECKed false, because the generated charge assumes an exclusive
--                               base (an inclusive price needs its own expression when a product ever uses one).
--   entitlement_keys            the feature/limit keys (AI §6.2; `core.*`, `messaging.monthly_quota`).
--   plan_entitlements           which plan enables which key, with a limit for limit keys.
--   tenant_entitlement_overrides  per-clinic comp / pilot / AI-evaluation grants (platform RPCs only, 05-09b).
-- RLS on every table, closed by default (R-13: REVOKE ALL from PUBLIC/anon/authenticated). `authenticated` may only
-- SELECT the catalogue of plans that are not `hidden` (prices and entitlements through their plan); entitlement keys
-- are readable; overrides have no tenant access at all. No INSERT/UPDATE/DELETE for any API role (AI §4.6): writes
-- come from migrations, the service role and the 05-09b `platform.*` RPCs. FKs carry their own index (fk_indexes).

-- plans --------------------------------------------------------------------------------------------------------------
CREATE TABLE public.plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
    kind text NOT NULL CHECK (kind IN ('base', 'addon', 'trial')),
    category text NOT NULL CHECK (category IN ('core', 'ai')),
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    description text CHECK (description IS NULL OR length(description) <= 1000),
    purchasable boolean NOT NULL DEFAULT false,
    visibility text NOT NULL DEFAULT 'hidden' CHECK (visibility IN ('public', 'coming_soon', 'hidden')),
    trial_days integer CHECK (trial_days IS NULL OR trial_days BETWEEN 0 AND 365),
    trial_plan_id uuid REFERENCES public.plans (id) ON DELETE RESTRICT,
    first_charge_grace_days integer NOT NULL DEFAULT 4 CHECK (first_charge_grace_days BETWEEN 0 AND 60),
    renewal_grace_days integer NOT NULL DEFAULT 7 CHECK (renewal_grace_days BETWEEN 0 AND 60),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT plans_trial_plan_not_self CHECK (trial_plan_id IS NULL OR trial_plan_id <> id),
    CONSTRAINT plans_trial_not_purchasable CHECK (NOT (kind = 'trial' AND purchasable))
);
CREATE INDEX idx_plans_trial_plan_id ON public.plans (trial_plan_id);
COMMENT ON TABLE public.plans IS
    'SUB-01 product catalogue (SUB §7.1). purchasable = backend switch (PO-21; set only through platform.set_product_availability, 05-09b); visibility = what clients may list.';

-- plan_prices --------------------------------------------------------------------------------------------------------
CREATE TABLE public.plan_prices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id uuid NOT NULL REFERENCES public.plans (id) ON DELETE RESTRICT,
    billing_model text NOT NULL
        CHECK (billing_model IN ('flat_recurring', 'per_unit_recurring', 'metered', 'included_plus_overage', 'prepaid_pack')),
    base_amount_paise bigint NOT NULL CHECK (base_amount_paise >= 0),
    tax_rate_bp integer NOT NULL CHECK (tax_rate_bp BETWEEN 0 AND 10000),
    tax_inclusive boolean NOT NULL DEFAULT false CONSTRAINT plan_prices_tax_exclusive CHECK (NOT tax_inclusive),
    charge_amount_paise bigint GENERATED ALWAYS AS
        (base_amount_paise + round(base_amount_paise * tax_rate_bp / 10000.0)::bigint) STORED,
    currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
    "interval" text CHECK ("interval" IS NULL OR "interval" IN ('day', 'week', 'month', 'year')),
    interval_count integer CHECK (interval_count IS NULL OR interval_count BETWEEN 1 AND 36),
    unit text CHECK (unit IS NULL OR unit ~ '^[a-z][a-z_]{0,30}$'),
    included_units bigint CHECK (included_units IS NULL OR included_units >= 0),
    unit_amount_paise bigint CHECK (unit_amount_paise IS NULL OR unit_amount_paise >= 0),
    overage_unit_amount_paise bigint CHECK (overage_unit_amount_paise IS NULL OR overage_unit_amount_paise >= 0),
    tiers jsonb CHECK (tiers IS NULL OR jsonb_typeof(tiers) = 'array'),
    provider text NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay')),
    provider_plan_id text CHECK (provider_plan_id IS NULL OR provider_plan_id ~ '^[A-Za-z0-9_]{1,64}$'),
    active_from timestamptz NOT NULL DEFAULT now(),
    active_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT plan_prices_active_window CHECK (active_until IS NULL OR active_until > active_from),
    CONSTRAINT plan_prices_flat_recurring_shape CHECK (
        billing_model <> 'flat_recurring' OR ("interval" IS NOT NULL AND interval_count IS NOT NULL)
    ),
    CONSTRAINT plan_prices_provider_plan_key UNIQUE (provider, provider_plan_id)
);
CREATE INDEX idx_plan_prices_plan_id ON public.plan_prices (plan_id, active_from);
COMMENT ON TABLE public.plan_prices IS
    'SUB-01 versioned prices (SUB §7.1, §8.2): never updated in place; integer paise, GST-exclusive (PO-20); charge_amount_paise = base + round(base * tax_rate_bp / 10000).';

-- entitlement_keys ---------------------------------------------------------------------------------------------------
CREATE TABLE public.entitlement_keys (
    key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*(\.([a-z][a-z0-9_]*|\*))+$'),
    kind text NOT NULL CHECK (kind IN ('boolean', 'limit')),
    description text NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
    owner_doc text NOT NULL CHECK (length(owner_doc) BETWEEN 1 AND 200),
    created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.entitlement_keys IS
    'SUB-01 feature and limit keys (AI_STRATEGY.md §6.2, SUB §7.3). Named entitlement_keys, not features (SUB §7.1).';

-- plan_entitlements --------------------------------------------------------------------------------------------------
CREATE TABLE public.plan_entitlements (
    plan_id uuid NOT NULL REFERENCES public.plans (id) ON DELETE CASCADE,
    key text NOT NULL REFERENCES public.entitlement_keys (key) ON DELETE RESTRICT,
    enabled boolean NOT NULL DEFAULT false,
    limit_value bigint CHECK (limit_value IS NULL OR limit_value >= 0),
    PRIMARY KEY (plan_id, key)
);
CREATE INDEX idx_plan_entitlements_key ON public.plan_entitlements (key);
COMMENT ON TABLE public.plan_entitlements IS
    'SUB-01: which plan enables which key; limit keys carry limit_value (usage lives in the AI track''s ai_usage_monthly).';

-- tenant_entitlement_overrides ---------------------------------------------------------------------------------------
CREATE TABLE public.tenant_entitlement_overrides (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
    key text NOT NULL REFERENCES public.entitlement_keys (key) ON DELETE RESTRICT,
    enabled boolean NOT NULL,
    limit_value bigint CHECK (limit_value IS NULL OR limit_value >= 0),
    expires_at timestamptz,
    reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    granted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenant_entitlement_overrides_tenant_key UNIQUE (tenant_id, key)
);
CREATE INDEX idx_tenant_entitlement_overrides_key ON public.tenant_entitlement_overrides (key);
CREATE INDEX idx_tenant_entitlement_overrides_granted_by ON public.tenant_entitlement_overrides (granted_by);
COMMENT ON TABLE public.tenant_entitlement_overrides IS
    'SUB-01 per-clinic grants (comp, pilot, AI evaluation). No tenant access; written only by platform.grant_override (05-09b) or the service role.';

-- RLS and grants (closed by default, R-13) ---------------------------------------------------------------------------
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_entitlement_overrides ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.plans, public.plan_prices, public.entitlement_keys, public.plan_entitlements,
    public.tenant_entitlement_overrides FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.plans, public.plan_prices, public.entitlement_keys, public.plan_entitlements TO authenticated;

CREATE POLICY plans_select ON public.plans
  FOR SELECT TO authenticated
  USING (visibility <> 'hidden');
CREATE POLICY plan_prices_select ON public.plan_prices
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.plans p WHERE p.id = plan_prices.plan_id AND p.visibility <> 'hidden'));
CREATE POLICY plan_entitlements_select ON public.plan_entitlements
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.plans p WHERE p.id = plan_entitlements.plan_id AND p.visibility <> 'hidden'));
CREATE POLICY entitlement_keys_select ON public.entitlement_keys
  FOR SELECT TO authenticated
  USING (true);
-- tenant_entitlement_overrides: no policy and no grant (no tenant access, SUB §7.1).
