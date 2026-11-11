# Phase 03: Consultation & Prescribing — Codebase Pattern Mapping

> **Phase:** 03 — Consultation & Prescribing  
> **Status:** Completed  
> **Authority:** `AGENTS.md`, `DESIGN.md`, `03-CONTEXT.md`, `03-RESEARCH.md`, `03-UI-SPEC.md`  
> **Output:** `03-PATTERNS.md`  

---

## 1. Executive Summary & Purpose

This document maps all files to be created or modified for **Phase 03: Consultation & Prescribing** to their closest existing analogs in the clinicOS codebase. 

The goal is to maintain absolute architectural, structural, and visual continuity across:
- **Database & RLS:** Multi-tenant PostgreSQL migrations using `current_user_tenant_ids()`.
- **Server Actions:** Strict authorization via `requirePermission()`, auditable mutations via `recordAudit()`, and testability via optional `clientOverride` and `sessionOverride` parameters.
- **Validation:** Runtime Zod schemas adhering to input sanitization and domain constraints.
- **High-Performance Ingestion:** Stream-parsed Indian drug master (CDCI) and curated outpatient terminology (ICD-11 / SNOMED CT) with sub-100ms fuzzy search.
- **UI Design System:** TailAdmin Free + Tailwind v4 light-only clinical layout, 4px grid, 44px mobile touch targets, and Inter typography adhering strictly to `DESIGN.md` and `03-UI-SPEC.md`.
- **Server-Side PDF Generation:** `@react-pdf/renderer` isolated in server-only execution paths with Supabase Storage signed URLs.
- **Testing Architecture:** Dual-tier strategy dividing fast in-memory Vitest unit tests from Supabase RLS integration suites.

---

## 2. File Inventory & Analog Mapping Table

| New / Modified File | Role & Data Flow | Closest Codebase Analog | Analogy Rationale |
|---|---|---|---|
| `supabase/migrations/000007_consultation_prescriptions_cdci.sql` | Database schema, RLS policies, indexes, RPCs | `supabase/migrations/000006_appointments_queue_waitlist.sql` | Defines tables, composite foreign keys, tenant isolation RLS policies, and database functions (RPCs) |
| `scripts/seed-cdci.ts` | High-performance TSV ingestion script | `tests/helpers/supabase-admin.ts` (Admin DB execution pattern) | Batch-inserts 94,000+ CDCI rows and builds materialized search view using Node streaming and admin client |
| `scripts/seed-cdci-test-fixture.ts` | Fast test fixture loader (~200 drugs) | `tests/helpers/tenants.ts` | Ingests a minimal test dataset for fast CI and Vitest execution in <100ms |
| `supabase/seed-data/terminology/diagnoses.json` | Static dataset (~1,500 curated OPD conditions) | `supabase/seed-data/cdci/` | Pre-curated terminology mapping conditions to ICD-11 & SNOMED CT |
| `scripts/seed-opd-diagnoses.ts` | Terminology table seeder | `scripts/seed-cdci.ts` | Ingests JSON master into `opd_diagnoses` table with pg_trgm index |
| `lib/db/types.ts` | Global database type contracts (Modified) | `lib/db/types.ts` | Extends `Visit` and adds `ConsultationDiagnosis`, `Prescription`, `PrescriptionItem`, etc. to `Database['public']['Tables']` |
| `features/consultation/schema.ts` | Zod validation schemas for SOAP consultation | `features/patients/schema.ts` | Runtime validation for vitals, complaints, and discriminated union specialty data |
| `features/prescriptions/schema.ts` | Zod validation for Rx, dosage chips, templates | `features/patients/schema.ts` | Validates dosage patterns (`1-0-1`), duration, timing, custom drugs, and amendment reasons |
| `features/terminology/schema.ts` | Zod validation for search queries and chronic tags | `features/patients/schema.ts` | Validates terminology search parameters and chronic disease flags |
| `lib/audit/audit.ts` (Modified) | Compliance audit trail logger | `lib/audit/audit.ts` | Adds clinical audit actions (`visit.complete_sign`, `visit.amend`, `prescription.create`) with strict metadata sanitization |
| `features/consultation/actions.ts` | Server Actions for SOAP notes, vitals, sign-off | `features/visits/actions.ts`, `features/queue/actions.ts` | Handles draft autosave, complete & sign, post-sign-off amendment snapshots, and queue sync |
| `features/prescriptions/actions.ts` | Server Actions for CDCI search, templates, repeats | `features/visits/actions.ts` | Executes sub-100ms drug searches, custom medicine favorites, and 1-click repeat logic |
| `features/terminology/actions.ts` | Server Actions for diagnosis search & chronic sync | `features/patients/actions.ts` | Executes fuzzy terminology lookup and updates patient ongoing chronic condition lists |
| `features/consultation/specialties/gp.ts` | General Physician specialty model & review of systems | `features/clinics/constants.ts` | Systemic exam schemas (CVS, RS, PA, CNS) and PICCLE signs configuration |
| `features/consultation/specialties/dental.ts` | Dental specialty odontogram domain model | `features/clinics/constants.ts` | FDI two-digit numbering ranges (11-48, 51-85) and tooth condition definitions |
| `features/consultation/specialties/pediatrics.ts` | Pediatrics growth curves & IAP vaccine model | `features/patients/schema.ts` (date/age helpers) | WHO LMS Z-score formulas, percentile thresholds, and IAP immunization schedule |
| `lib/pediatrics/who-data.ts` | WHO Child Growth Standards reference tables | Pure data module (new) | LMS coefficients (L, M, S) for weight, height, and head circumference (0-60 months) |
| `features/prescriptions/pdf/prescription-document.tsx` | Declarative React-PDF template | Component cards (`components/ui/card.tsx`) adapted to `@react-pdf/renderer` | Server-rendered PDF document with blank paper and pre-printed letterhead modes |
| `features/prescriptions/pdf/generator.ts` | Server-side PDF compilation & Supabase Storage pipeline | `features/patients/consent.ts` (secure record persistence) | Compiles PDF buffer, uploads to `prescriptions` bucket, generates signed URL (3600s), logs audit |
| `app/api/visits/[id]/prescription-pdf/route.ts` | Authenticated Next.js Route Handler for PDF streaming | `app/auth/callback/route.ts` | Next.js App Router Route Handler verifying session/permission before serving PDF buffer or redirecting to signed URL |
| `next.config.ts` (Modified) | Next.js configuration guard | `next.config.ts` | Adds `serverExternalPackages: ["@react-pdf/renderer"]` to prevent client bundling errors |
| `app/(dashboard)/consultation/[id]/page.tsx` | Server Component: Consultation workspace page | `app/(dashboard)/patients/[id]/page.tsx` | Resolves active visit, patient profile, allergies, doctor profile, letterhead settings, past visits |
| `components/consultation/consultation-workspace.tsx` | Client Component: SOAP workspace orchestrator | `components/queue/queue-view.tsx`, `components/calendar/calendar-view.tsx` | Coordinates fast-scrolling sections, sticky jump bar, debounced autosave, and drawer triggers |
| `components/consultation/vitals-block.tsx` | Shared vitals card with abnormal badges | `components/patients/age-dob-input.tsx`, `components/ui/card.tsx` | Grid of vital inputs with unit badges, abnormal badging (high BP, low SpO2, fever), nurse attribution |
| `components/consultation/chief-complaints-section.tsx` | Chief complaints chips + clinical notes | `components/queue/walk-in-drawer.tsx` (quick selectors) | Quick complaint chips (`Fever`, `Cough`), duration picker, and auto-expanding notes textarea |
| `components/consultation/specialties/gp-exam.tsx` | GP physical examination & PICCLE toggles | `components/ui/field.tsx`, `components/ui/input.tsx` | PICCLE toggle buttons and systemic exam textareas |
| `components/consultation/specialties/dental-odontogram.tsx` | Interactive SVG FDI Odontogram tooth chart | `components/calendar/doctor-timeline.tsx` (custom graphical UI) | Declarative SVG odontogram, 44px clickable tooth targets, condition popover, summary table |
| `components/consultation/specialties/pediatrics-growth.tsx` | Pediatrics growth percentiles & IAP checklist | `components/patients/age-dob-input.tsx` | Real-time WHO percentile badges and IAP immunization status pills |
| `components/consultation/diagnosis-section.tsx` | ICD-11 & SNOMED CT terminology search and row list | `components/patients/patient-directory-table.tsx` | Specialty chips, sub-100ms terminology dropdown, custom condition row, chronic checkbox |
| `components/consultation/prescription-builder.tsx` | Electronic Rx builder with India dosage chips | `components/queue/queue-card.tsx`, `components/ui/input.tsx` | Informational allergy banner, CDCI search dropdown, 1-tap dosage chips (`1-0-1`, food, duration) |
| `components/consultation/investigations-advice-section.tsx` | Investigations advised & lifestyle advice chips | `components/queue/walk-in-drawer.tsx` | Test chips (CBC, Blood Sugar) and diet/lifestyle advice chips + textarea |
| `components/consultation/follow-up-section.tsx` | Follow-up interval chips & file dropzone | `components/ui/field.tsx` | Quick interval chips (3d, 5d, 1w, 2w), date picker, and JPEG/PNG/PDF file dropzone |
| `components/consultation/patient-history-drawer.tsx` | Longitudinal patient history side drawer | `components/calendar/booking-drawer.tsx`, `components/calendar/waitlist-drawer.tsx` | Slide-over drawer showing previous visits, 1-click "Repeat this Rx", 1-click "Copy notes" |
| `components/consultation/pdf-preview-modal.tsx` | In-app PDF preview & letterhead mode switcher | `components/ui/modal.tsx`, `components/calendar/overbook-dialog.tsx` | Modal with embedded iframe, blank vs pre-printed toggle, print button, download button |
| `components/consultation/amendment-modal.tsx` | Post-sign-off amendment warning & reason modal | `components/ui/modal.tsx`, `components/ui/alert.tsx` | Modal enforcing mandatory amendment reason before unlocking completed visit for editing |
| `tests/prescriptions/dosage.spec.ts` | Vitest unit test: Dosage chip parsing | `tests/patients/schema.spec.ts` | Tests frequency patterns (`1-0-1`, `SOS`), duration parsing, and food relation tags |
| `tests/pediatrics/who-growth.spec.ts` | Vitest unit test: WHO LMS calculations | `tests/patients/schema.spec.ts` | Validates LMS Z-score formula and percentile classifications against reference tables |
| `tests/dental/odontogram.spec.ts` | Vitest unit test: FDI tooth model & conditions | `tests/patients/schema.spec.ts` | Validates FDI numbering ranges (11-48, 51-85) and condition tag mutations |
| `tests/consultation/schemas.spec.ts` | Vitest unit test: Consultation Zod schemas | `tests/patients/schema.spec.ts` | Validates consultation payloads, specialty data discriminated union, amendment inputs |
| `tests/integration/cdci-search.spec.ts` | Integration test: Sub-100ms drug search RPC | `tests/integration/visits.spec.ts` | Tests trigram brand/generic search, doctor favorite prioritization, <100ms execution |
| `tests/integration/consultation-flow.spec.ts` | Integration test: Consultation lifecycle | `tests/integration/visits.spec.ts`, `tests/integration/queue-flow.spec.ts` | Tests visit progression `waiting` → `in_consultation` → `completed`, diagnoses, Rx, follow-up |
| `tests/integration/prescription-versioning.spec.ts` | Integration test: Revision snapshots & PDF | `tests/integration/visits.spec.ts`, `tests/audit/audit-logging.spec.ts` | Tests `visit_revisions` immutable snapshots, v2 increments, dual letterhead modes, audit logs |

---

## 3. Detailed Pattern Blueprints & Code Excerpts

### Pattern 1: Database Migrations, Multi-Tenant RLS & Performance Indexes

**Closest Codebase Analog:** `supabase/migrations/000006_appointments_queue_waitlist.sql`

#### Architectural Principles
1. **Tenant-Isolation by Default:** Every table contains `tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE` and enables Row Level Security.
2. **Current Tenant Function:** Policies strictly use `(tenant_id IN (SELECT public.current_user_tenant_ids()))` to guarantee database-enforced isolation.
3. **Delete Restrictions:** Deletion restricted to `'owner'` and `'admin'` roles via `auth.uid() IN (SELECT user_id FROM public.memberships WHERE tenant_id = ... AND role IN ('owner', 'admin'))`.
4. **Denormalized Search with Trigram GIN Indexes:** Materialized search tables (`cdci_medicines_search`, `opd_diagnoses`) utilize `pg_trgm` GIN indexes (`gin_trgm_ops`) and `tsvector` indexes for sub-100ms response times across 94,000+ records.
5. **Security Definer RPCs:** Stored procedures specify `SECURITY DEFINER` and `SET search_path = public`, explicitly granting execute permissions only to `authenticated` and `service_role`.

#### Concrete Code Excerpt (Analog vs New Pattern)

```sql
-- ANALOG FROM 000006_appointments_queue_waitlist.sql:
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visits_select_member"
ON public.visits
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "visits_insert_member"
ON public.visits
FOR INSERT
TO authenticated
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- NEW IMPLEMENTATION IN 000007_consultation_prescriptions_cdci.sql:
CREATE TABLE IF NOT EXISTS public.prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id),
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'amended', 'cancelled')),
    letterhead_mode TEXT NOT NULL DEFAULT 'blank_paper' CHECK (letterhead_mode IN ('blank_paper', 'preprinted_letterhead')),
    pdf_storage_path TEXT,
    signed_at TIMESTAMPTZ,
    amendment_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_prescriptions_visit_version UNIQUE (tenant_id, visit_id, version)
);

ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prescriptions_select_member" ON public.prescriptions
    FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "prescriptions_insert_member" ON public.prescriptions
    FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

CREATE POLICY "prescriptions_update_member" ON public.prescriptions
    FOR UPDATE TO authenticated
    USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
    WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));

-- Child Item Policy with Nested Tenant Verification:
CREATE TABLE IF NOT EXISTS public.prescription_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id UUID NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
    medicine_name TEXT NOT NULL,
    generic_name TEXT,
    dose_form TEXT,
    dosage TEXT NOT NULL,          -- '1-0-1', '1-0-0', 'SOS'
    timing TEXT,                   -- 'After food', 'Before food'
    duration TEXT NOT NULL,        -- '5 days', '1 month'
    special_instructions TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prescription_items_select_member" ON public.prescription_items
    FOR SELECT TO authenticated
    USING (prescription_id IN (
        SELECT id FROM public.prescriptions WHERE tenant_id IN (SELECT public.current_user_tenant_ids())
    ));
```

---

### Pattern 2: Server Actions with Test Overrides, RBAC Guards & Audit Trail

**Closest Codebase Analog:** `features/visits/actions.ts` & `features/patients/actions.ts`

#### Architectural Principles
1. **`"use server"` Directive:** Every action file begins with `"use server"`.
2. **Deterministic Signatures with Inversion of Control:** Each action accepts optional `clientOverride?: SupabaseClient<Database>` and `sessionOverride?: { userId: string; tenantId: string; role?: UserRole }`. This allows Vitest integration tests to run without active HTTP cookies or mocking `next/headers`.
3. **Server-Side RBAC Verification:** Permissions are verified via `await requirePermission("consultations:edit")` (or `sessionOverride`). The tenant boundary is resolved server-side from membership; never trust client-supplied tenant IDs.
4. **Zod Parsing & Clean Error Mapping:** Input is parsed using `.safeParse(input)`. If invalid, returns `{ success: false, error: "Please correct the highlighted errors.", fieldErrors }`.
5. **Strict Compliance Audit Logging:** Clinical actions must call `await recordAudit(...)`. All metadata passes through `filterMetadata()`; clinical notes, diagnoses, and PII are strictly excluded to preserve privacy (AGENTS.md §9, §10).
6. **Next.js Revalidation Guard:** `revalidatePath(...)` calls are wrapped in `try/catch` so actions do not throw when executed in testing runtimes.

#### Concrete Code Excerpt (Analog vs New Pattern)

```typescript
// ANALOG FROM features/visits/actions.ts:
export async function createVisit(
  input: CreateVisitInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<CreateVisitResult> {
  const parseResult = createVisitSchema.safeParse(input);
  if (!parseResult.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parseResult.error.issues) {
      const field = issue.path[0]?.toString() || "form";
      fieldErrors[field] = fieldErrors[field] || [];
      fieldErrors[field].push(issue.message);
    }
    return { success: false, error: "Please correct the highlighted errors.", fieldErrors };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("appointments:edit"));
    // ... mutation ...
    await recordAudit({
      action: "visit.create",
      entityType: "visit",
      entityId: newVisit.id,
      metadata: { fields_changed: ["created"] },
    }, clientOverride, session);

    try {
      revalidatePath("/calendar");
      revalidatePath("/queue");
    } catch { /* testing runtime */ }

    return { success: true, visitId: newVisit.id };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create visit." };
  }
}

// NEW IMPLEMENTATION IN features/consultation/actions.ts:
export async function completeAndSignConsultation(
  visitId: string,
  input: CompleteConsultationInput,
  clientOverride?: SupabaseClient<Database>,
  sessionOverride?: { userId: string; tenantId: string }
): Promise<CompleteConsultationResult> {
  const parseResult = completeConsultationSchema.safeParse(input);
  if (!parseResult.success) {
    return { success: false, error: "Validation failed.", fieldErrors: formatZodErrors(parseResult.error) };
  }

  const supabase = clientOverride || (await createClient());

  try {
    const session = sessionOverride || (await requirePermission("consultations:edit"));
    const data = parseResult.data;

    // 1. Update visit details and mark completed
    const { error: visitErr } = await supabase
      .from("visits")
      .update({
        vitals: data.vitals,
        chief_complaints: data.chief_complaints,
        clinical_notes: data.clinical_notes,
        specialty: data.specialty,
        specialty_data: data.specialty_data,
        investigations_advised: data.investigations_advised,
        advice: data.advice,
        status: "completed",
        signed_at: new Date().toISOString(),
        signed_by: session.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", visitId)
      .eq("tenant_id", session.tenantId);

    if (visitErr) throw new Error(`Failed to finalize visit: ${visitErr.message}`);

    // 2. Persist Diagnoses & Synchronize Chronic Conditions
    // ... insert into consultation_diagnoses ...

    // 3. Create Prescription v1 Record
    // ... insert into prescriptions and prescription_items ...

    // 4. Audit Log
    await recordAudit(
      {
        action: "visit.complete_sign",
        entityType: "visit",
        entityId: visitId,
        metadata: {
          specialty: data.specialty,
          items_count: data.prescription_items.length,
          fields_changed: ["status", "signed_at", "vitals", "rx"],
        },
      },
      clientOverride,
      session
    );

    try {
      revalidatePath(`/consultation/${visitId}`);
      revalidatePath("/queue");
    } catch { /* testing runtime */ }

    return { success: true, visitId };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to complete consultation." };
  }
}
```

---

### Pattern 3: Zod Validation Schemas & Data Transformations

**Closest Codebase Analog:** `features/patients/schema.ts`

#### Architectural Principles
1. **Input Normalization:** Sanitizes string inputs (`.trim()`), normalizes empty values to `null` or defaults.
2. **Discriminated Unions for Extensible Domain Models:** Specialty template structures use discriminated unions based on `specialty: z.enum(['general_physician', 'dental', 'pediatrics'])`.
3. **Medical Bounds Validation:** Physiological ranges are validated (e.g. Temperature 90-110°F, BP systolic > diastolic).
4. **Reusable Sub-Schemas:** Reusable components like dosage chips, complaints, and vitals have discrete sub-schemas exported for both frontend React Hook Form / state bindings and server actions.

#### Concrete Code Excerpt (Analog vs New Pattern)

```typescript
// ANALOG FROM features/patients/schema.ts:
export const patientSchema = z.object({
  full_name: z.string().trim().min(1, "Patient full name is required.").max(120),
  phone: z.string().trim().min(8).max(15).transform(normalizePhone),
  date_of_birth: z.string().optional().nullable().transform((val) => (val && val.trim() !== "" ? val : null)),
  age: z.number().int().min(0).max(130).optional().nullable(),
  allergies: z.array(z.string().trim()).default([]),
  chronic_conditions: z.array(z.string().trim()).default([]),
});

// NEW IMPLEMENTATION IN features/consultation/schema.ts & features/prescriptions/schema.ts:
export const vitalsSchema = z.object({
  systolic_bp: z.number().int().min(50).max(300).nullable().optional(),
  diastolic_bp: z.number().int().min(30).max(200).nullable().optional(),
  pulse: z.number().int().min(30).max(250).nullable().optional(),
  spo2: z.number().min(50).max(100).nullable().optional(),
  temperature_f: z.number().min(90.0).max(110.0).nullable().optional(),
  weight_kg: z.number().min(0.5).max(400.0).nullable().optional(),
  height_cm: z.number().min(20.0).max(300.0).nullable().optional(),
  bmi: z.number().nullable().optional(),
  recorded_by_name: z.string().optional(),
  recorded_at: z.string().datetime().optional(),
}).refine((data) => {
  if (data.systolic_bp && data.diastolic_bp) {
    return data.systolic_bp > data.diastolic_bp;
  }
  return true;
}, {
  message: "Systolic BP must be greater than Diastolic BP.",
  path: ["systolic_bp"],
});

export const prescriptionItemSchema = z.object({
  medicine_name: z.string().trim().min(1, "Medicine name cannot be empty."),
  generic_name: z.string().trim().nullable().optional(),
  dose_form: z.string().trim().nullable().optional(),
  dosage: z.string().trim().min(1, "Frequency is required (e.g. 1-0-1, SOS)."),
  timing: z.string().trim().default("After food"),
  duration: z.string().trim().min(1, "Duration is required (e.g. 5 days)."),
  special_instructions: z.string().trim().nullable().optional(),
  cdci_brand_id: z.string().nullable().optional(),
  cdci_generic_id: z.string().nullable().optional(),
  sort_order: z.number().int().default(0),
});
```

---

### Pattern 4: High-Performance TSV Ingestion & Benchmark Seeding

**Closest Codebase Analog:** `tests/helpers/supabase-admin.ts` & Seed Architecture

#### Architectural Principles
1. **Streaming Node.js Pipeline:** Processes large files (`BrandMaster.txt` > 11MB, 93,912 rows) using `readline` streaming rather than `fs.readFileSync` into memory to avoid Node heap exhaustion.
2. **Chunked Transactional Inserts:** Batches rows in chunks of 1,000 using the Supabase admin client / PostgreSQL client (`ON CONFLICT (id) DO NOTHING`).
3. **Automated Search Materialization:** Compiles `cdci_medicines_search` directly upon loading raw base tables.
4. **Dual-Mode Fixture (D-34):** Provides `seed-cdci-test-fixture.ts` loading a curated list of ~200 essential Indian OPD medicines in <100ms for continuous integration and unit testing.

#### Concrete Code Excerpt (New Ingestion Pipeline)

```typescript
// scripts/seed-cdci.ts:
import fs from "fs";
import readline from "readline";
import path from "path";
import { getAdminClient } from "../tests/helpers/supabase-admin";

const admin = getAdminClient();
const BATCH_SIZE = 1000;

export async function ingestTsvFile(
  filePath: string,
  tableName: string,
  transformRow: (headers: string[], fields: string[]) => Record<string, unknown>
) {
  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers: string[] = [];
  let batch: Record<string, unknown>[] = [];
  let isFirstLine = true;
  let count = 0;

  for await (const line of rl) {
    if (isFirstLine) {
      headers = line.split("\t").map((h) => h.trim());
      isFirstLine = false;
      continue;
    }

    const fields = line.split("\t").map((f) => f.trim());
    if (fields.length === 0 || !fields[0]) continue;

    batch.push(transformRow(headers, fields));
    count++;

    if (batch.length >= BATCH_SIZE) {
      const { error } = await admin.from(tableName).upsert(batch, { onConflict: "id" });
      if (error) throw new Error(`Batch insert failed for ${tableName}: ${error.message}`);
      batch = [];
    }
  }

  if (batch.length > 0) {
    const { error } = await admin.from(tableName).upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`Final batch insert failed for ${tableName}: ${error.message}`);
  }

  console.log(`✓ Ingested ${count} rows into ${tableName}`);
}
```

---

### Pattern 5: UI Shells, Fast-Scrolling SOAP Layout & TailAdmin Tokens

**Closest Codebase Analog:** `components/queue/queue-view.tsx` & `components/ui/card.tsx`

#### Architectural Principles
1. **TailAdmin Clean Clinical Preset:** Daylight-oriented canvas (`#F7F6F3`), white cards (`#FFFFFF`), borders (`#E4E5E7`), and canonical healthcare blue (`#1769E0`) for primary actions.
2. **Typography Hierarchy:** Strictly Inter font with 4 sizes (24px Display, 18px Heading, 14px Body, 12px Caption) and 2 weights (400 Regular, 600 Semibold). Weight 500 is eliminated per `DESIGN.md`.
3. **4px Spacing Grid:** Margins and padding use multiples of 4 (4px, 8px, 12px, 16px, 20px, 24px, 32px, 48px, 64px). Odd values like 6px are forbidden.
4. **44px Mobile Touch Target Floor:** Interactive chips, tooth cells, and buttons enforce `min-h-[44px]` or `p-2.5` touch areas.
5. **Single-Page Fast SOAP Layout (D-01):** Zero tab-switching. Header features sticky section jump pills (`[Vitals]`, `[Complaints]`, `[Exam]`, `[Diagnosis]`, `[Rx]`, `[Advice]`) that smoothly scroll to sections.
6. **Accessible Screen-Reader Labels:** All icon-only buttons provide explicit `aria-label` tags (`aria-label="Remove medication"`, `aria-label="Remove diagnosis"`, etc.).

#### Concrete Code Excerpt (Analog vs New Pattern)

```tsx
// ANALOG FROM components/ui/card.tsx:
export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-gray-200 bg-white shadow-theme-xs transition-all",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// NEW IMPLEMENTATION IN components/consultation/vitals-block.tsx:
export function VitalsBlock({ vitals, onUpdate }: VitalsBlockProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-theme-xs space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">1. Vitals</h3>
        {vitals.recorded_by_name && (
          <span className="text-xs text-gray-500">
            Recorded by {vitals.recorded_by_name} at {vitals.recorded_at}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {/* Blood Pressure with Abnormal Badge */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-600">BP (mmHg)</label>
          <div className="relative">
            <input
              type="text"
              placeholder="120/80"
              className={cn(
                "w-full h-11 px-3 text-sm rounded-lg border bg-white focus:outline-none focus:ring-2",
                isBpAbnormal(vitals.systolic_bp, vitals.diastolic_bp)
                  ? "border-red-400 focus:ring-red-500/20"
                  : "border-gray-300 focus:border-[#1769E0] focus:ring-[#1769E0]/20"
              )}
            />
          </div>
          {isBpAbnormal(vitals.systolic_bp, vitals.diastolic_bp) && (
            <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200 rounded">
              High BP
            </span>
          )}
        </div>
        {/* Remaining vital fields with min-h-[44px] */}
      </div>
    </div>
  );
}
```

---

### Pattern 6: Slide-Over Drawers & Accessible Modals

**Closest Codebase Analog:** `components/calendar/booking-drawer.tsx` & `components/ui/modal.tsx`

#### Architectural Principles
1. **Backdrop & Focus Trap:** Backdrop with `bg-gray-900/50 backdrop-blur-xs` and Escape key listener.
2. **Slide-Over Drawer Container:** `fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-white border-l border-gray-200 shadow-2xl flex flex-col`.
3. **Accessible Header:** Contains title, subtitle, and close button with `aria-label="Close drawer"`.
4. **Scrollable Body with Sticky Footer:** `flex-1 overflow-y-auto p-6 space-y-6` paired with action footer `px-6 py-4 border-t border-gray-100 bg-gray-50`.

#### Concrete Code Excerpt (Analog vs New Pattern)

```tsx
// ANALOG FROM components/calendar/booking-drawer.tsx:
<div
  className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-xs transition-opacity"
  onClick={onClose}
/>
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="drawer-title"
  className="fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-white border-l border-gray-200 shadow-2xl flex flex-col"
>
  <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 bg-white">
    <h2 id="drawer-title" className="text-base font-bold text-gray-900">Patient History</h2>
    <button type="button" onClick={onClose} aria-label="Close drawer" className="p-1.5 hover:bg-gray-100 rounded-lg">
      <X className="w-5 h-5 text-gray-400" />
    </button>
  </div>
  <div className="flex-1 overflow-y-auto p-6 space-y-4">
    {/* Timeline Cards */}
  </div>
</div>

// NEW IMPLEMENTATION IN components/consultation/patient-history-drawer.tsx:
export function PatientHistoryDrawer({ isOpen, onClose, pastVisits, onRepeatRx, onCopyNotes }: HistoryDrawerProps) {
  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-drawer-title"
        className="fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-white border-l border-gray-200 shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#EAF2FF] text-[#1769E0] flex items-center justify-center">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 id="history-drawer-title" className="text-base font-semibold text-gray-900">
                Patient Medical History
              </h2>
              <p className="text-xs text-gray-500">Longitudinal past visits & prescriptions</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close patient history drawer"
            className="p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {pastVisits.map((visit) => (
            <div key={visit.id} className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-900">{formatDate(visit.date)}</span>
                <span className="text-xs text-gray-500">{visit.doctor_name}</span>
              </div>
              <p className="text-xs text-gray-700">{visit.diagnosis_summary}</p>
              <div className="flex gap-2 pt-2 border-t border-gray-200">
                <Button size="sm" variant="secondary" onClick={() => onRepeatRx(visit.prescriptions)}>
                  <Sparkles className="w-3.5 h-3.5 mr-1 text-[#1769E0]" />
                  Repeat this Rx
                </Button>
                <Button size="sm" variant="outline" onClick={() => onCopyNotes(visit.clinical_notes)}>
                  Copy Notes
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
```

---

### Pattern 7: Server-Side PDF Compilation & Signed Storage URLs

**Closest Codebase Analog:** `app/auth/callback/route.ts` & `lib/supabase/server.ts`

#### Architectural Principles
1. **Bundling Guard:** `@react-pdf/renderer` is never imported into client components. Configured in `next.config.ts` under `serverExternalPackages: ["@react-pdf/renderer"]`.
2. **Buffer Generation:** Compiled via `pdf(<PrescriptionDocument payload={payload} />).toBuffer()` on Node.js runtime.
3. **Supabase Storage Integration:** Uploads to private bucket `prescriptions` using path `${tenantId}/${visitId}/rx_v${version}.pdf`.
4. **Time-Limited Signed URLs:** Issues signed URLs expiring in 1 hour (3600 seconds) via `createSignedUrl()`.
5. **Route Handler Streaming:** `app/api/visits/[id]/prescription-pdf/route.ts` validates tenant membership and streams the PDF buffer directly with headers `Content-Type: application/pdf` and `Content-Disposition: inline`.

#### Concrete Code Excerpt (New Server-Side PDF Engine)

```typescript
// next.config.ts:
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;

// features/prescriptions/pdf/generator.ts:
import { pdf } from "@react-pdf/renderer";
import { PrescriptionDocument } from "./prescription-document";
import { createClient } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit/audit";

export async function generateAndArchivePrescriptionPdf(payload: PrescriptionPdfPayload): Promise<string> {
  // 1. Render to buffer server-side
  const doc = <PrescriptionDocument payload={payload} />;
  const buffer = await pdf(doc).toBuffer();

  const supabase = await createClient();
  const filePath = `${payload.tenant_id}/${payload.visit_id}/rx_v${payload.version}.pdf`;

  // 2. Upload to private Supabase Storage bucket
  const { error: uploadErr } = await supabase.storage
    .from("prescriptions")
    .upload(filePath, buffer, { contentType: "application/pdf", upsert: true });

  if (uploadErr) throw new Error(`PDF upload failed: ${uploadErr.message}`);

  // 3. Generate secure signed URL valid for 1 hour
  const { data: signedData, error: signErr } = await supabase.storage
    .from("prescriptions")
    .createSignedUrl(filePath, 3600);

  if (signErr || !signedData?.signedUrl) throw new Error("Failed to create signed PDF URL.");

  // 4. Record audit event
  await recordAudit({
    action: "prescription.generate_pdf",
    entityType: "prescription",
    entityId: payload.prescription_id,
    metadata: {
      version: payload.version,
      letterhead_mode: payload.letterhead_mode,
    },
  });

  return signedData.signedUrl;
}
```

---

### Pattern 8: Dual-Tier Testing Strategy (Vitest Unit & Integration)

**Closest Codebase Analog:** `tests/patients/schema.spec.ts` (Unit) & `tests/integration/visits.spec.ts` (Integration)

#### Architectural Principles
1. **Tier 1: In-Memory Unit Tests (Zero Network):**
   - High speed (<20ms per test).
   - Validates Indian OPD dosage chips (`tests/prescriptions/dosage.spec.ts`).
   - Validates WHO LMS Z-score mathematical formula and percentile boundaries (`tests/pediatrics/who-growth.spec.ts`).
   - Validates FDI tooth numbering conditions and serialization (`tests/dental/odontogram.spec.ts`).
   - Validates Zod schema boundaries and error reporting (`tests/consultation/schemas.spec.ts`).
2. **Tier 2: Supabase Integration Tests (Real DB & RLS):**
   - Seeds test tenants with `seedTenantWithOwner()` helper (`tests/helpers/tenants.ts`).
   - Tests `search_medicines` RPC benchmarks (<100ms) against seeded drugs (`tests/integration/cdci-search.spec.ts`).
   - Tests end-to-end status progression (`waiting` → `in_consultation` → `completed`), diagnoses, and chronic condition synchronization (`tests/integration/consultation-flow.spec.ts`).
   - Tests post-sign-off amendment snapshot immutability in `visit_revisions` and dual letterhead margin configurations (`tests/integration/prescription-versioning.spec.ts`).

#### Concrete Code Excerpt (Analog vs New Pattern)

```typescript
// ANALOG FROM tests/patients/schema.spec.ts:
describe("Patient Schema & Boundary Validation", () => {
  it("accepts a patient with only name and phone, leaving ABHA null", () => {
    const input = { full_name: "Anita Sharma", phone: "9876543210" };
    const parsed = patientSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.full_name).toBe("Anita Sharma");
      expect(parsed.data.phone).toBe("+919876543210");
    }
  });
});

// NEW IMPLEMENTATION IN tests/prescriptions/dosage.spec.ts:
describe("Dosage Chip Parser & Prescription Validation", () => {
  it("correctly parses standard Indian OPD dosage frequencies", () => {
    const validFrequencies = ["1-0-1", "1-0-0", "0-0-1", "1-1-1", "1-0-1-0", "SOS"];
    for (const freq of validFrequencies) {
      const res = dosageFrequencySchema.safeParse(freq);
      expect(res.success).toBe(true);
    }
  });

  it("validates food relation chips", () => {
    const validTimings = ["After food", "Before food", "With food", "Empty stomach"];
    for (const timing of validTimings) {
      const res = foodTimingSchema.safeParse(timing);
      expect(res.success).toBe(true);
    }
  });
});

// NEW IMPLEMENTATION IN tests/pediatrics/who-growth.spec.ts:
describe("WHO LMS Child Growth Percentile Engine", () => {
  it("calculates exact Z-score and normal 50th percentile for standard reference point", () => {
    // 24-month-old boy: Weight 12.2kg corresponds to 50th percentile
    const result = calculateWhoGrowthPercentile({
      ageMonths: 24,
      gender: "male",
      metric: "weight",
      value: 12.2,
    });

    expect(result.percentile).toBeCloseTo(50, 0);
    expect(result.badgeCategory).toBe("normal");
  });

  it("classifies values below 3rd percentile as stunted/underweight", () => {
    const result = calculateWhoGrowthPercentile({
      ageMonths: 24,
      gender: "male",
      metric: "weight",
      value: 9.0, // severely underweight
    });

    expect(result.percentile).toBeLessThan(3);
    expect(result.badgeCategory).toBe("underweight");
  });
});
```

---

## 4. Anti-Patterns & "Don't Hand-Roll" Rules

| Area | Strictly Forbidden Anti-Pattern | Required ClinicOS Pattern |
|---|---|---|
| **PDF Bundling** | Importing `@react-pdf/renderer` in client components or shared UI modules | Render exclusively on the server (Route Handlers / Server Actions). Guard with `serverExternalPackages` in `next.config.ts`. |
| **Drug Database Search** | Sequential `ILIKE` scans on 94,000 unindexed CDCI drug rows | Use `pg_trgm` GIN indexes and prefix matches (`brand_name ILIKE query || '%'`) inside `search_medicines` RPC for <100ms response. |
| **Medical-Legal Immutability** | Overwriting completed visits in-place without snapshotting | Capture an immutable snapshot in `visit_revisions` before saving amendments; increment version to `v2` and stamp audit trail. |
| **Dental Odontogram** | Canvas-based rendering or external non-standard canvas chart plugins | Render declarative inline SVGs with standard FDI tooth numbers, standard 44px clickable areas, and TailAdmin design tokens. |
| **Pediatric Growth** | Polynomial approximation curves for growth percentiles | Embed standard WHO LMS reference tables (0–60 months) and apply the exact closed-form LMS Z-score formula. |
| **Allergy Alerts** | Blocking modal dialogs interrupting doctor typing | Display a prominent, persistent informational banner above the Rx builder for clinician review without interrupting workflow (D-14). |
| **Audit Logs** | Passing consultation notes, patient diagnoses, or prescription items to `metadata` | Pass only operational metadata (`specialty`, `items_count`, `version`, `amendment_reason`). Audit trail must never leak sensitive clinical data. |
| **Database Engines** | Introducing SQLite for local testing or mocks | Maintain strict Supabase PostgreSQL compatibility. Run integration tests against real Supabase schemas under RLS. |
| **UI Aesthetics** | Introducing dark mode, arbitrary brand hex codes, or 6px spacing values | Strictly light theme, `#1769E0` healthcare blue accent, 4px grid (multiples of 4 only), and Inter font (400/600 weights). |

---

## 5. Summary & Verification Matrix

The architectural pattern mapping for Phase 03 is complete. Every new file and system component has an established, tested predecessor in the repository:

- **Database:** `000007_consultation_prescriptions_cdci.sql` follows `000006_appointments_queue_waitlist.sql`.
- **Server Actions:** `features/consultation/actions.ts` and `features/prescriptions/actions.ts` follow `features/visits/actions.ts` and `features/patients/actions.ts`.
- **Validation:** `features/consultation/schema.ts` follows `features/patients/schema.ts`.
- **UI:** SOAP workspace and drawers follow `components/queue/queue-view.tsx` and `components/calendar/booking-drawer.tsx`.
- **Testing:** Unit and integration suites follow `tests/patients/schema.spec.ts` and `tests/integration/visits.spec.ts`.

With all pattern boundaries codified, Phase 03 is ready for executable task planning (`PLAN.md`).
