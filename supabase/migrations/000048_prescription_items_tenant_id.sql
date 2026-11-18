-- Migration: 000048_prescription_items_tenant_id.sql
-- V2-05 plan 05-03 step 3 (P1-02, BACKEND_MIGRATION_PLAN §6 C3).
--
-- `prescription_items` is the only tenant child without its own `tenant_id`: its RLS and any cross-tenant check had to
-- go through `prescriptions`. This adds the column (expand + backfill + enforce in one migration: the backfill is a
-- single idempotent UPDATE from the parent, and no production data exists, PO-15), so 000049 can bind the item to its
-- prescription with a composite FK and 05-02b can give the table a direct policy.
--
-- App inserts keep working unchanged: a BEFORE INSERT trigger fills `tenant_id` from the parent prescription when the
-- caller leaves it null, and refuses (23514) a supplied value that differs from the parent's. The trigger is SECURITY
-- INVOKER (the plan names no definer here): a caller whose RLS cannot see the parent leaves the column null and the
-- insert fails NOT NULL (23502); a caller who supplies a value for an invisible parent is still stopped by the
-- composite FK of 000049, which checks the real parent regardless of RLS.

ALTER TABLE public.prescription_items ADD COLUMN tenant_id uuid;

-- Backfill (idempotent: only rows still null).
UPDATE public.prescription_items i
   SET tenant_id = p.tenant_id
  FROM public.prescriptions p
 WHERE p.id = i.prescription_id
   AND i.tenant_id IS NULL;

CREATE FUNCTION public.prescription_items_fill_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT p.tenant_id INTO v_tenant FROM public.prescriptions p WHERE p.id = NEW.prescription_id;
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_tenant;
  ELSIF v_tenant IS NOT NULL AND NEW.tenant_id <> v_tenant THEN
    RAISE EXCEPTION 'prescription_items.tenant_id does not match its prescription' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prescription_items_fill_tenant() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.prescription_items_fill_tenant() IS
  'V2-05 05-03: BEFORE INSERT on prescription_items; fills tenant_id from the parent prescription, 23514 on a mismatch.';

CREATE TRIGGER prescription_items_fill_tenant
  BEFORE INSERT ON public.prescription_items
  FOR EACH ROW EXECUTE FUNCTION public.prescription_items_fill_tenant();

ALTER TABLE public.prescription_items ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE public.prescription_items
  ADD CONSTRAINT prescription_items_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE;

CREATE INDEX idx_prescription_items_tenant_prescription ON public.prescription_items (tenant_id, prescription_id);
