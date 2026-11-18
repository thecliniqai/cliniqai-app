-- Migration: 000084_subscription_seeds.sql
-- V2-05 plan 05-09a step 5 (SUB-01 seeds, AI-18; SUBSCRIPTIONS_AND_PLANS.md §4, §7.3, §8.1; AI_STRATEGY.md §6.2;
-- PO-20, PO-21, PO-25 defaults; research §D). Idempotent: every insert is ON CONFLICT DO NOTHING / NOT EXISTS, so a
-- re-run (or a database that already has the rows) changes nothing. Configuration values only, no tenant data.
--
-- 1. entitlement_keys: the AI §6.2 / SUB §7.3 key list (assist.*, ai.*, the two limit keys, core.*,
--    messaging.monthly_quota).
-- 2. plans: `standard` (base, core, purchasable, public, trial 14 days, grace 4/7, trial_plan_id → standard_trial);
--    `standard_trial` (trial, hidden, not purchasable); `ai_assist` and `ai_voice_receptionist` (addon, ai, NOT
--    purchasable, `coming_soon`, no price: AI-18).
-- 3. plan_prices: Standard `flat_recurring` 149900 paise base, 1800 bp, GST-exclusive (PO-20), INR, monthly ×1,
--    provider razorpay, provider_plan_id NULL (set later through platform.create_plan_price, V2-13b); generated charge
--    176882 (acceptance 12). Active from 2026-01-01 IST.
-- 4. plan_entitlements:
--      standard        every assist.* and core.* on; ai.scribe off and ai.scribe.monthly_drafts 0 (PO-25 default);
--                      messaging.monthly_quota on with its number left NULL ("set by SQL before go-live", SUB-D2; no
--                      reader before then, and entitlement_limit reads NULL as 0);
--      standard_trial  = standard + ai.scribe on with ai.scribe.monthly_drafts 1500 for the whole trial (PO-21);
--      ai_assist / ai_voice_receptionist (future, unused while not purchasable): their own AI keys on, limits unset;
--      ai.operations_copilot, ai.clinical_copilot, ai.patient_advice, ai.scribe.voice: off everywhere (rows present).
-- 5. platform_settings: the single row with SUB §4 defaults and every ai_features flag present (kill switch "enabled
--    per key", AI §4.6; entitlements still decide who may use a feature).

-- 1. -----------------------------------------------------------------------------------------------------------------
INSERT INTO public.entitlement_keys (key, kind, description, owner_doc) VALUES
    ('core.*', 'boolean', 'Core clinic features of the base plan', 'SUBSCRIPTIONS_AND_PLANS.md §7.3'),
    ('messaging.monthly_quota', 'limit', 'Fair-use WhatsApp/SMS reminder quota per clinic per month (SUB-D2)', 'SUBSCRIPTIONS_AND_PLANS.md §7.3'),
    ('assist.terminology', 'boolean', 'Smart Assist: terminology lookup', 'AI_STRATEGY.md §6.2'),
    ('assist.frequent_rx', 'boolean', 'Smart Assist: frequent prescriptions', 'AI_STRATEGY.md §6.2'),
    ('assist.shorthand', 'boolean', 'Smart Assist: shorthand expansion', 'AI_STRATEGY.md §6.2'),
    ('assist.snapshot', 'boolean', 'Smart Assist: deterministic patient snapshot', 'AI_STRATEGY.md §6.2'),
    ('assist.slots', 'boolean', 'Smart Assist: slot suggestions', 'AI_STRATEGY.md §6.2'),
    ('assist.duplicates', 'boolean', 'Smart Assist: duplicate patient detection', 'AI_STRATEGY.md §6.2'),
    ('assist.followup', 'boolean', 'Smart Assist: follow-up suggestions', 'AI_STRATEGY.md §6.2'),
    ('assist.allergy_check', 'boolean', 'Smart Assist: allergy check', 'AI_STRATEGY.md §6.2'),
    ('assist.dup_therapy', 'boolean', 'Smart Assist: duplicate therapy check', 'AI_STRATEGY.md §6.2'),
    ('assist.help', 'boolean', 'Smart Assist: in-app help', 'AI_STRATEGY.md §6.2'),
    ('assist.vitals', 'boolean', 'Smart Assist: vitals hints', 'AI_STRATEGY.md §6.2'),
    ('ai.scribe', 'boolean', 'AI scribe: structured SOAP draft (trial Preview only in v2.0, PO-21)', 'AI_STRATEGY.md §6.2'),
    ('ai.scribe.monthly_drafts', 'limit', 'AI scribe drafts per clinic (pooled; whole trial while trialing)', 'AI_STRATEGY.md §6.2'),
    ('ai.scribe.voice', 'boolean', 'AI scribe speech-to-text (v2.1)', 'AI_STRATEGY.md §6.2'),
    ('ai.operations_copilot', 'boolean', 'Front-desk assistant (v2.1)', 'AI_STRATEGY.md §6.2'),
    ('ai.clinical_copilot', 'boolean', 'Clinical Q&A (deferred indefinitely)', 'AI_STRATEGY.md §6.2'),
    ('ai.patient_advice', 'boolean', 'Patient advice rewrite (candidate v2.1)', 'AI_STRATEGY.md §6.2'),
    ('ai.voice_receptionist', 'boolean', 'AI voice receptionist (separate release)', 'AI_STRATEGY.md §6.2'),
    ('ai.voice_receptionist.monthly_minutes', 'limit', 'AI voice receptionist minutes per clinic per month', 'AI_STRATEGY.md §6.2')
ON CONFLICT (key) DO NOTHING;

-- 2. -----------------------------------------------------------------------------------------------------------------
INSERT INTO public.plans (code, kind, category, name, description, purchasable, visibility, trial_days,
                          first_charge_grace_days, renewal_grace_days) VALUES
    ('standard_trial', 'trial', 'core', 'Standard (trial)',
     'Standard during the 14-day trial, with the AI scribe Preview (1,500 drafts).', false, 'hidden', NULL, 4, 7),
    ('standard', 'base', 'core', 'Standard', 'Everything a clinic needs, with Smart Assist.', true, 'public', 14, 4, 7),
    ('ai_assist', 'addon', 'ai', 'AI Assist', 'AI features. Coming soon.', false, 'coming_soon', NULL, 4, 7),
    ('ai_voice_receptionist', 'addon', 'ai', 'AI Voice Receptionist', 'Answers and places clinic calls. Coming soon.',
     false, 'coming_soon', NULL, 4, 7)
ON CONFLICT (code) DO NOTHING;

UPDATE public.plans p
   SET trial_plan_id = t.id
  FROM public.plans t
 WHERE p.code = 'standard' AND t.code = 'standard_trial' AND p.trial_plan_id IS NULL;

-- 3. -----------------------------------------------------------------------------------------------------------------
INSERT INTO public.plan_prices (plan_id, billing_model, base_amount_paise, tax_rate_bp, tax_inclusive, currency,
                                "interval", interval_count, unit, provider, provider_plan_id, active_from)
SELECT p.id, 'flat_recurring', 149900, 1800, false, 'INR', 'month', 1, 'month', 'razorpay', NULL,
       '2026-01-01 00:00:00+05:30'::timestamptz
  FROM public.plans p
 WHERE p.code = 'standard'
   AND NOT EXISTS (SELECT 1 FROM public.plan_prices pp WHERE pp.plan_id = p.id);

-- 4. -----------------------------------------------------------------------------------------------------------------
WITH grid (plan_code, key, enabled, limit_value) AS (
    VALUES
    -- standard (base): assist.* and core.* on; AI off (PO-25 default)
    ('standard', 'core.*', true, NULL::bigint),
    ('standard', 'messaging.monthly_quota', true, NULL),
    ('standard', 'assist.terminology', true, NULL), ('standard', 'assist.frequent_rx', true, NULL),
    ('standard', 'assist.shorthand', true, NULL), ('standard', 'assist.snapshot', true, NULL),
    ('standard', 'assist.slots', true, NULL), ('standard', 'assist.duplicates', true, NULL),
    ('standard', 'assist.followup', true, NULL), ('standard', 'assist.allergy_check', true, NULL),
    ('standard', 'assist.dup_therapy', true, NULL), ('standard', 'assist.help', true, NULL),
    ('standard', 'assist.vitals', true, NULL),
    ('standard', 'ai.scribe', false, NULL), ('standard', 'ai.scribe.monthly_drafts', false, 0),
    ('standard', 'ai.scribe.voice', false, NULL), ('standard', 'ai.operations_copilot', false, NULL),
    ('standard', 'ai.clinical_copilot', false, NULL), ('standard', 'ai.patient_advice', false, NULL),
    ('standard', 'ai.voice_receptionist', false, NULL), ('standard', 'ai.voice_receptionist.monthly_minutes', false, 0),
    -- standard_trial = standard + the AI scribe Preview with 1,500 drafts (PO-21)
    ('standard_trial', 'core.*', true, NULL),
    ('standard_trial', 'messaging.monthly_quota', true, NULL),
    ('standard_trial', 'assist.terminology', true, NULL), ('standard_trial', 'assist.frequent_rx', true, NULL),
    ('standard_trial', 'assist.shorthand', true, NULL), ('standard_trial', 'assist.snapshot', true, NULL),
    ('standard_trial', 'assist.slots', true, NULL), ('standard_trial', 'assist.duplicates', true, NULL),
    ('standard_trial', 'assist.followup', true, NULL), ('standard_trial', 'assist.allergy_check', true, NULL),
    ('standard_trial', 'assist.dup_therapy', true, NULL), ('standard_trial', 'assist.help', true, NULL),
    ('standard_trial', 'assist.vitals', true, NULL),
    ('standard_trial', 'ai.scribe', true, NULL), ('standard_trial', 'ai.scribe.monthly_drafts', true, 1500),
    ('standard_trial', 'ai.scribe.voice', false, NULL), ('standard_trial', 'ai.operations_copilot', false, NULL),
    ('standard_trial', 'ai.clinical_copilot', false, NULL), ('standard_trial', 'ai.patient_advice', false, NULL),
    ('standard_trial', 'ai.voice_receptionist', false, NULL),
    ('standard_trial', 'ai.voice_receptionist.monthly_minutes', false, 0),
    -- future products (not purchasable, AI-18): rows seeded, unused
    ('ai_assist', 'ai.scribe', true, NULL), ('ai_assist', 'ai.scribe.monthly_drafts', true, NULL),
    ('ai_assist', 'ai.scribe.voice', false, NULL), ('ai_assist', 'ai.operations_copilot', false, NULL),
    ('ai_assist', 'ai.clinical_copilot', false, NULL), ('ai_assist', 'ai.patient_advice', false, NULL),
    ('ai_voice_receptionist', 'ai.voice_receptionist', true, NULL),
    ('ai_voice_receptionist', 'ai.voice_receptionist.monthly_minutes', true, NULL)
)
INSERT INTO public.plan_entitlements (plan_id, key, enabled, limit_value)
SELECT p.id, g.key, g.enabled, g.limit_value
  FROM grid g
  JOIN public.plans p ON p.code = g.plan_code
ON CONFLICT (plan_id, key) DO NOTHING;

-- 5. -----------------------------------------------------------------------------------------------------------------
INSERT INTO public.platform_settings (id, lock_window_days, purge_after_days, pending_charge_buffer_hours,
                                      gst_retention_months, log_retention_days, sac, ai_features)
VALUES (true, 30, 180, 24, 72, 365, '998314',
        jsonb_build_object(
            'ai.scribe', true,
            'ai.scribe.voice', true,
            'ai.operations_copilot', true,
            'ai.clinical_copilot', true,
            'ai.patient_advice', true,
            'ai.voice_receptionist', true))
ON CONFLICT (id) DO NOTHING;
