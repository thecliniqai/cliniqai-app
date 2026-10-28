-- Migration: 000017_normalize_indian_phone_numbers.sql
-- Description: Idempotently cleans and standardizes phone records in patients, staff_members, clinics,
-- memberships, tenants, and communication_queue to ITU-T E.164 (+91XXXXXXXXXX) format conforming to Phase 05.2.
-- Decisions: D-01 (E.164 persistence), D-02 (Strict 10-digit Indian mobile validation), D-07 (Data migration).

-- 1. Helper function to normalize Indian mobile numbers to E.164
CREATE OR REPLACE FUNCTION normalize_indian_phone_e164(raw_phone TEXT)
RETURNS TEXT AS $$
DECLARE
    digits TEXT;
BEGIN
    IF raw_phone IS NULL OR trim(raw_phone) = '' THEN
        RETURN raw_phone;
    END IF;

    -- Strip non-digits
    digits := regexp_replace(raw_phone, '\D', '', 'g');

    -- If 12 digits starting with 91, trim leading 91
    IF length(digits) = 12 AND digits LIKE '91%' THEN
        digits := substring(digits FROM 3);
    -- If 11 digits starting with 0, trim leading 0
    ELSIF length(digits) = 11 AND digits LIKE '0%' THEN
        digits := substring(digits FROM 2);
    END IF;

    -- If exactly 10 digits starting with [6-9], format as E.164 (+91XXXXXXXXXX)
    IF length(digits) = 10 AND digits ~ '^[6-9]' THEN
        RETURN '+91' || digits;
    END IF;

    -- Fallback to trimmed raw phone if non-standard or landline
    RETURN trim(raw_phone);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Idempotent conditional updates across all application tables storing telephone numbers
DO $$
BEGIN
    -- Update patients.phone
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'patients' AND column_name = 'phone'
    ) THEN
        UPDATE public.patients
        SET phone = normalize_indian_phone_e164(phone)
        WHERE phone IS NOT NULL AND phone NOT LIKE '+91%';
    END IF;

    -- Update patients.guardian_phone if present
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'patients' AND column_name = 'guardian_phone'
    ) THEN
        UPDATE public.patients
        SET guardian_phone = normalize_indian_phone_e164(guardian_phone)
        WHERE guardian_phone IS NOT NULL AND guardian_phone NOT LIKE '+91%';
    END IF;

    -- Update staff_members.phone if table exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'staff_members' AND column_name = 'phone'
    ) THEN
        EXECUTE 'UPDATE public.staff_members SET phone = normalize_indian_phone_e164(phone) WHERE phone IS NOT NULL AND phone NOT LIKE ''+91%''';
    END IF;

    -- Update memberships.phone (staff member profiles)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'memberships' AND column_name = 'phone'
    ) THEN
        UPDATE public.memberships
        SET phone = normalize_indian_phone_e164(phone)
        WHERE phone IS NOT NULL AND phone NOT LIKE '+91%';
    END IF;

    -- Update clinics.phone if table exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'clinics' AND column_name = 'phone'
    ) THEN
        EXECUTE 'UPDATE public.clinics SET phone = normalize_indian_phone_e164(phone) WHERE phone IS NOT NULL AND phone NOT LIKE ''+91%''';
    END IF;

    -- Update tenants.phone (clinic tenant profiles)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'phone'
    ) THEN
        UPDATE public.tenants
        SET phone = normalize_indian_phone_e164(phone)
        WHERE phone IS NOT NULL AND phone NOT LIKE '+91%';
    END IF;

    -- Update communication_queue.recipient_phone
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'communication_queue' AND column_name = 'recipient_phone'
    ) THEN
        UPDATE public.communication_queue
        SET recipient_phone = normalize_indian_phone_e164(recipient_phone)
        WHERE recipient_phone IS NOT NULL AND recipient_phone NOT LIKE '+91%';
    END IF;
END $$;

-- Down / Rollback:
-- DROP FUNCTION IF EXISTS normalize_indian_phone_e164(TEXT);
-- Note: Data normalization is forward-only (E.164 standardization). Reverting requires restoring
-- pre-migration database snapshot if raw legacy formatting preservation is strictly demanded.
