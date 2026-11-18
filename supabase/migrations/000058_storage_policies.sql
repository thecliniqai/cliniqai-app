-- Migration: 000058_storage_policies.sql
-- V2-05 plan 05-02c (P1-01, SECURITY_VERIFICATION_PLAN §6.1, BACKEND C9; rulings R-23, R-42, R-45; threats T-05-15,
-- T-05-16, T-05-39).
--
-- Every `storage.objects` policy of the two app buckets is replaced by per-artefact-class policies. A class is the
-- exact key shape one builder writes; an object whose key matches no class is denied to every tenant role (before: any
-- key whose first segment was one of the caller's clinics, and any member read every artefact of every clinic they
-- belonged to, whatever their role).
--
--   bucket          class            key (builder)                                                    S / I / U / D
--   prescriptions   rx               <tenant>/<visit>/rx_v<n>.pdf (features/prescriptions/pdf/       prescriptions:view /
--                                    generator.ts)                                                    prescriptions:edit (I, U) / -
--   prescriptions   receipt          <tenant>/receipts/inv_<invoice>.pdf (features/billing/pdf/       billing:view or own visit /
--                                    generator.ts)                                                    billing:collect or own visit (I, U) / -
--   clinic-records  lab              tenants/<tenant>/patients/<patient>/labs/<name>                  labs:view / labs:edit (I, U, D)
--                                    (features/labs/service.ts; <name> = <document id>.<ext> from
--                                    05-02c, R-45, or a legacy synthetic name)
--   clinic-records  referral_letter  tenants/<tenant>/referrals/<referral>/referral_letter.pdf        consultations:view /
--                                    (lib/storage/tenant-path.ts referralLetterPath)                  consultations:edit (I, U) / -
--
-- No branding class: no builder writes a branding object (no upload path exists); it is added with its first writer.
-- UPDATE stays for the writers because every archive uploads with `upsert: true` (R-23; SVP §6.1 "UPDATE no" is
-- deferred to the V2-09 rebuild with versioned keys). Lab uploads use `upsert: false` from 05-02c (R-45), so the lab
-- UPDATE policy is only used by metadata updates.
--
-- Receipt own-visit rule (05-02b handover b): the doctor's Sign & Bill archives the receipt on the doctor's own client
-- (`compileAndArchiveReceiptPdf(ctx)`). The doctor holds neither billing:view nor billing:collect, so the class admits,
-- like the invoices table (R-7), a caller with consultations:edit in the active clinic when the key's invoice belongs
-- to a visit they are the doctor of. The invoice id is compared as text (no cast of the key).
--
-- Tenant match (BACKEND C9, T-05-15): the tenant segment of the key is compared as TEXT with the bound helper's ids
-- cast to text; the key itself is never cast to uuid, so a malformed key (`not-a-uuid/x.pdf`) is simply denied (before:
-- 22P02 for a caller whose `tenants/<uuid>` branch did not match). Every class regex pins the full key, lower-case
-- UUIDs only (the builders write `uuid::text` / `crypto.randomUUID()`).

DROP POLICY prescriptions_storage_select_policy ON storage.objects;
DROP POLICY prescriptions_storage_insert_policy ON storage.objects;
DROP POLICY prescriptions_storage_update_policy ON storage.objects;
DROP POLICY clinic_records_storage_select_policy ON storage.objects;
DROP POLICY clinic_records_storage_insert_policy ON storage.objects;
DROP POLICY clinic_records_storage_update_policy ON storage.objects;
DROP POLICY clinic_records_storage_delete_policy ON storage.objects;

-- prescriptions / rx ------------------------------------------------------------------------------------------------
CREATE POLICY prescriptions_rx_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'prescriptions'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/rx_v[0-9]{1,9}\.pdf$'
    AND split_part(name, '/', 1) IN (SELECT t::text FROM authz.tenant_ids_with('prescriptions:view') t)
  );
CREATE POLICY prescriptions_rx_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'prescriptions'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/rx_v[0-9]{1,9}\.pdf$'
    AND split_part(name, '/', 1) IN (SELECT t::text FROM authz.tenant_ids_with('prescriptions:edit') t)
  );
CREATE POLICY prescriptions_rx_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'prescriptions'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/rx_v[0-9]{1,9}\.pdf$'
    AND split_part(name, '/', 1) IN (SELECT t::text FROM authz.tenant_ids_with('prescriptions:edit') t)
  )
  WITH CHECK (
    bucket_id = 'prescriptions'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/rx_v[0-9]{1,9}\.pdf$'
    AND split_part(name, '/', 1) IN (SELECT t::text FROM authz.tenant_ids_with('prescriptions:edit') t)
  );

-- prescriptions / receipt -------------------------------------------------------------------------------------------
CREATE POLICY prescriptions_receipt_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'prescriptions'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/receipts/inv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
    AND (
      split_part(name, '/', 1) IN (SELECT t::text FROM authz.tenant_ids_with('billing:view') t)
      OR EXISTS (
        SELECT 1
          FROM public.invoices i
          JOIN public.visits v ON v.tenant_id = i.tenant_id AND v.id = i.visit_id
         WHERE i.tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
           AND i.tenant_id::text = split_part(objects.name, '/', 1)
           AND 'inv_' || i.id::text || '.pdf' = split_part(objects.name, '/', 3)
           AND v.doctor_id = (SELECT auth.uid())
      )
    )
  );
CREATE POLICY prescriptions_receipt_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'prescriptions'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/receipts/inv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
    AND (
      split_part(name, '/', 1) IN (SELECT t::text FROM authz.tenant_ids_with('billing:collect') t)
      OR EXISTS (
        SELECT 1
          FROM public.invoices i
          JOIN public.visits v ON v.tenant_id = i.tenant_id AND v.id = i.visit_id
         WHERE i.tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
           AND i.tenant_id::text = split_part(objects.name, '/', 1)
           AND 'inv_' || i.id::text || '.pdf' = split_part(objects.name, '/', 3)
           AND v.doctor_id = (SELECT auth.uid())
      )
    )
  );
CREATE POLICY prescriptions_receipt_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'prescriptions'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/receipts/inv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
    AND (
      split_part(name, '/', 1) IN (SELECT t::text FROM authz.tenant_ids_with('billing:collect') t)
      OR EXISTS (
        SELECT 1
          FROM public.invoices i
          JOIN public.visits v ON v.tenant_id = i.tenant_id AND v.id = i.visit_id
         WHERE i.tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
           AND i.tenant_id::text = split_part(objects.name, '/', 1)
           AND 'inv_' || i.id::text || '.pdf' = split_part(objects.name, '/', 3)
           AND v.doctor_id = (SELECT auth.uid())
      )
    )
  )
  WITH CHECK (
    bucket_id = 'prescriptions'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/receipts/inv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
    AND (
      split_part(name, '/', 1) IN (SELECT t::text FROM authz.tenant_ids_with('billing:collect') t)
      OR EXISTS (
        SELECT 1
          FROM public.invoices i
          JOIN public.visits v ON v.tenant_id = i.tenant_id AND v.id = i.visit_id
         WHERE i.tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit'))
           AND i.tenant_id::text = split_part(objects.name, '/', 1)
           AND 'inv_' || i.id::text || '.pdf' = split_part(objects.name, '/', 3)
           AND v.doctor_id = (SELECT auth.uid())
      )
    )
  );

-- clinic-records / lab ----------------------------------------------------------------------------------------------
CREATE POLICY clinic_records_lab_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'clinic-records'
    AND name ~ '^tenants/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/patients/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/labs/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,254}$'
    AND split_part(name, '/', 2) IN (SELECT t::text FROM authz.tenant_ids_with('labs:view') t)
  );
CREATE POLICY clinic_records_lab_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'clinic-records'
    AND name ~ '^tenants/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/patients/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/labs/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,254}$'
    AND split_part(name, '/', 2) IN (SELECT t::text FROM authz.tenant_ids_with('labs:edit') t)
  );
CREATE POLICY clinic_records_lab_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'clinic-records'
    AND name ~ '^tenants/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/patients/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/labs/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,254}$'
    AND split_part(name, '/', 2) IN (SELECT t::text FROM authz.tenant_ids_with('labs:edit') t)
  )
  WITH CHECK (
    bucket_id = 'clinic-records'
    AND name ~ '^tenants/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/patients/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/labs/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,254}$'
    AND split_part(name, '/', 2) IN (SELECT t::text FROM authz.tenant_ids_with('labs:edit') t)
  );
CREATE POLICY clinic_records_lab_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'clinic-records'
    AND name ~ '^tenants/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/patients/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/labs/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,254}$'
    AND split_part(name, '/', 2) IN (SELECT t::text FROM authz.tenant_ids_with('labs:edit') t)
  );

-- clinic-records / referral_letter -------------------------------------------------------------------------------------
CREATE POLICY clinic_records_referral_letter_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'clinic-records'
    AND name ~ '^tenants/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/referrals/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/referral_letter\.pdf$'
    AND split_part(name, '/', 2) IN (SELECT t::text FROM authz.tenant_ids_with('consultations:view') t)
  );
CREATE POLICY clinic_records_referral_letter_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'clinic-records'
    AND name ~ '^tenants/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/referrals/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/referral_letter\.pdf$'
    AND split_part(name, '/', 2) IN (SELECT t::text FROM authz.tenant_ids_with('consultations:edit') t)
  );
CREATE POLICY clinic_records_referral_letter_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'clinic-records'
    AND name ~ '^tenants/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/referrals/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/referral_letter\.pdf$'
    AND split_part(name, '/', 2) IN (SELECT t::text FROM authz.tenant_ids_with('consultations:edit') t)
  )
  WITH CHECK (
    bucket_id = 'clinic-records'
    AND name ~ '^tenants/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/referrals/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/referral_letter\.pdf$'
    AND split_part(name, '/', 2) IN (SELECT t::text FROM authz.tenant_ids_with('consultations:edit') t)
  );
