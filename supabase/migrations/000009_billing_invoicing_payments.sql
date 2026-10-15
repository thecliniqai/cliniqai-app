-- Migration: 000009_billing_invoicing_payments.sql
-- Practitioner settings on tenants, and per-visit billing: invoices, invoice_items, payments with strict RLS

-- 1. Extend tenants table with practitioner and OPD fee defaults
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS owner_is_practicing_doctor BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS default_consultation_fee NUMERIC(10, 2) DEFAULT 500.00,
ADD COLUMN IF NOT EXISTS default_followup_fee NUMERIC(10, 2) DEFAULT 300.00,
ADD COLUMN IF NOT EXISTS accepted_payment_methods TEXT[] DEFAULT '{"cash", "upi", "card"}';

-- 2. Create invoices table
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL,
    subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    discount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    tax NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_tenant_invoice_number UNIQUE (tenant_id, invoice_number)
);

-- 3. Create invoice_items table
CREATE TABLE IF NOT EXISTS public.invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('consultation', 'procedure', 'medicine', 'other')),
    description TEXT NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    total_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Create payments table
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'upi', 'card')),
    reference_number TEXT,
    notes TEXT,
    recorded_by UUID NOT NULL REFERENCES auth.users(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Indexes for fast tenant scoping and query performance
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_visit ON public.invoices(tenant_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_patient ON public.invoices(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_created ON public.invoices(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tenant_invoice ON public.invoice_items(tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_invoice ON public.payments(tenant_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_recorded ON public.payments(tenant_id, recorded_at);

-- 6. Helper function for atomic invoice number generation (INV-YYYY-XXXX)
CREATE OR REPLACE FUNCTION public.generate_tenant_invoice_number(
    p_tenant_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_year TEXT := to_char(now(), 'YYYY');
    v_count INTEGER;
    v_invoice_num TEXT;
BEGIN
    SELECT count(*) + 1 INTO v_count
    FROM public.invoices
    WHERE tenant_id = p_tenant_id
      AND invoice_number LIKE 'INV-' || v_year || '-%';

    v_invoice_num := 'INV-' || v_year || '-' || lpad(v_count::text, 5, '0');
    RETURN v_invoice_num;
END;
$$;

-- 7. Enable Row Level Security (MANDATORY per AGENTS.md §5, §7)
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies: Tenant Scoped Access via current_user_tenant_ids()

-- Invoices policies
CREATE POLICY "invoices_select_tenant"
ON public.invoices FOR SELECT TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "invoices_insert_tenant"
ON public.invoices FOR INSERT TO authenticated
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "invoices_update_tenant"
ON public.invoices FOR UPDATE TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- Invoice items policies
CREATE POLICY "invoice_items_select_tenant"
ON public.invoice_items FOR SELECT TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "invoice_items_insert_tenant"
ON public.invoice_items FOR INSERT TO authenticated
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "invoice_items_update_tenant"
ON public.invoice_items FOR UPDATE TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- Payments policies
CREATE POLICY "payments_select_tenant"
ON public.payments FOR SELECT TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "payments_insert_tenant"
ON public.payments FOR INSERT TO authenticated
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));
