# Phase 2: Patient Records & Scheduling - Research & Technical Architecture

**Date:** 2026-10-07  
**Status:** Complete  
**Requirements:** `REQ-patient-records`, `REQ-appointment-booking`  
**Downstream Consumed By:** `gsd-planner` (`02-01-PLAN.md` through `02-04-PLAN.md`)

---

## 1. Schema & Migration Architecture

### 1.1 New Tables & Schema Alterations (`000006_appointments_queue_waitlist.sql`)

#### 1. Alter `patients` Table
Add demographic depth and dual Age/DOB support:
```sql
ALTER TABLE public.patients
ADD COLUMN IF NOT EXISTS age INTEGER,
ADD COLUMN IF NOT EXISTS allergies TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS chronic_conditions TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS emergency_contact JSONB;
```
- **Bidirectional Age/DOB Derivation Logic:**
  - When exact DOB is entered: `age = EXTRACT(YEAR FROM age(CURRENT_DATE, date_of_birth))`
  - When only Age is entered: `date_of_birth = make_date(EXTRACT(YEAR FROM CURRENT_DATE)::integer - age, 1, 1)`
  - Both columns are populated and persisted for every patient.

#### 2. Create `visits` (Unified Appointment & Walk-in Table)
Scheduled bookings and walk-ins share the same clinical visit entity:
```sql
CREATE TABLE IF NOT EXISTS public.visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id),
    origin_type TEXT NOT NULL CHECK (origin_type IN ('scheduled', 'walk_in')),
    status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN (
        'booked',
        'confirmed',
        'waiting',
        'in_consultation',
        'completed',
        'cancelled',
        'no_show'
    )),
    scheduled_at TIMESTAMPTZ,
    estimated_duration_minutes INTEGER NOT NULL DEFAULT 15,
    reason_for_visit TEXT,
    is_overbooked BOOLEAN NOT NULL DEFAULT false,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visits_tenant_doctor_sched ON public.visits(tenant_id, doctor_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_visits_tenant_patient ON public.visits(tenant_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_tenant_status ON public.visits(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_visits_tenant_created ON public.visits(tenant_id, created_at DESC);
```

#### 3. Create `queue_tokens` (Operational Layer)
Tracks daily arrival sequence, physical queue numbers, and live consulting room transitions:
```sql
CREATE TABLE IF NOT EXISTS public.queue_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    visit_id UUID NOT NULL UNIQUE REFERENCES public.visits(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    token_number INTEGER NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'vip')),
    called_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_date_token UNIQUE (tenant_id, date, token_number)
);

CREATE INDEX IF NOT EXISTS idx_queue_tokens_tenant_date ON public.queue_tokens(tenant_id, date, token_number);
```

Atomic token generator function to prevent race conditions during peak morning check-ins:
```sql
CREATE OR REPLACE FUNCTION public.generate_daily_queue_token(p_tenant_id UUID, p_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_next_token INTEGER;
BEGIN
    SELECT COALESCE(MAX(token_number), 0) + 1
    INTO v_next_token
    FROM public.queue_tokens
    WHERE tenant_id = p_tenant_id AND date = p_date;

    RETURN v_next_token;
END;
$$;
```

#### 4. Create `waitlist_entries`
Captures demand for full or preferred slots:
```sql
CREATE TABLE IF NOT EXISTS public.waitlist_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES auth.users(id), -- NULL means any doctor
    target_date DATE NOT NULL,
    time_window TEXT, -- e.g. 'morning', '10am-12pm'
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'promoted', 'expired', 'cancelled')),
    promoted_visit_id UUID REFERENCES public.visits(id),
    priority INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_tenant_date_status ON public.waitlist_entries(tenant_id, target_date, status);
```

### 1.2 Row Level Security (RLS) Policies
Every table enforces database-level tenant isolation:
- `visits`:
  - `SELECT`: `WHERE tenant_id IN (SELECT current_user_tenant_ids())`
  - `INSERT`: `WITH CHECK (tenant_id IN (SELECT current_user_tenant_ids()))`
  - `UPDATE`: `USING (tenant_id IN (SELECT current_user_tenant_ids()))`
  - `DELETE`: `USING (tenant_id IN (SELECT current_user_tenant_ids()) AND auth.uid() IN (SELECT user_id FROM memberships WHERE tenant_id = visits.tenant_id AND role IN ('owner', 'admin')))`
- `queue_tokens`:
  - `SELECT`: `WHERE tenant_id IN (SELECT current_user_tenant_ids())`
  - `INSERT/UPDATE`: `USING (tenant_id IN (SELECT current_user_tenant_ids()))`
- `waitlist_entries`:
  - `SELECT/INSERT/UPDATE`: `USING (tenant_id IN (SELECT current_user_tenant_ids()))`

---

## 2. Duplicate Detection Engine

### 2.1 Algorithm & Matching Strategy
When front desk types patient phone or name:
1. **Primary Match (High Confidence):**
   - Exact normalized 10-digit phone number: `phone = :normalizedPhone`
2. **Secondary Match (Medium Confidence):**
   - Case-insensitive name match (`LOWER(TRIM(full_name)) = LOWER(TRIM(:name))`) AND either:
     - Exact `date_of_birth = :dob`, OR
     - `abs(age - :inputAge) <= 1`

### 2.2 UX Presentation per DESIGN.md
- **Non-blocking inline warning:** As staff types, if matching records exist, an inline alert card renders directly below the phone/name inputs with:
  - Match details: *"Existing patient found: Ramesh Kumar (Age 42, +91 98765 43210)"*
  - Action 1: `[Use Existing Patient]` (selects patient and pivots form to "Schedule Visit" or "Add to Queue")
  - Action 2: `[Continue Creating New]` (dismisses warning for shared family phones)

---

## 3. Reception Desk & Unified Queue

### 3.1 Live Operational Feed
- Single unified view at `/queue`:
  - Displays all visits for the selected date.
  - Ordered by queue priority and check-in time (`queue_tokens.token_number ASC`, or `scheduled_at ASC` for un-arrived appointments).
- Status Pills (using `DESIGN.md` semantic color tokens):
  - `Booked / Confirmed`: Neutral/Blue badge
  - `Waiting (Checked In)`: Amber badge + Token number (`#04`)
  - `In Consultation`: Emerald badge with doctor name
  - `Completed`: Subtle gray badge
- 1-Tap Action Flow:
  - For Scheduled: `[Check In]` $\rightarrow$ atomically issues next daily `queue_token` and flips status to `waiting`.
  - For Waiting: `[Send to Doctor]` $\rightarrow$ updates status to `in_consultation`.
  - For In Consultation: `[Complete]` $\rightarrow$ marks `completed`.

---

## 4. Per-Doctor Day Timeline Scheduler

### 4.1 Compact Multi-Column Layout
- Top bar: Date picker (defaults to today) + Doctor selector (All doctors vs individual doctor).
- Multi-column timeline:
  - Columns represent doctors on duty.
  - Rows represent 15-minute intervals (e.g., 9:00, 9:15, 9:30 AM).
  - Empty slots render clean, clickable hit areas with hover states.
  - Occupied slots render patient chips with status badges and visit origin indicator.

### 4.2 Concurrency & Double-Booking Safeguards
1. **Server Validation:**
   ```ts
   const conflictingVisits = await supabase
     .from("visits")
     .select("id, patient:patients(full_name)")
     .eq("tenant_id", tenantId)
     .eq("doctor_id", doctorId)
     .eq("scheduled_at", targetTimestamp)
     .neq("status", "cancelled");
   ```
2. **Client Warning & Overbooking Override:**
   - If `conflictingVisits.length > 0` and `is_overbooked !== true`:
     - Returns `{ warning: "DOUBLE_BOOKING", existingPatient: conflictingVisits[0].patient.full_name }`
     - UI presents: *"Slot already booked by [Patient]. Overbook this slot?"* with `[Confirm Overbook]` and `[Pick Different Time]`.
   - Passing `is_overbooked: true` permits the insert with the overbooked flag set.

---

## 5. Waitlist Auto-Promotion Engine

### 5.1 Cancellation Promotion Flow
When `cancelVisit(visitId)` is executed:
1. Flip target visit `status = 'cancelled'`.
2. Query `waitlist_entries` for the same clinic, target date, and doctor:
   ```sql
   SELECT id, patient_id
   FROM waitlist_entries
   WHERE tenant_id = :tenantId
     AND target_date = :targetDate
     AND (doctor_id = :doctorId OR doctor_id IS NULL)
     AND status = 'waiting'
   ORDER BY priority DESC, created_at ASC
   LIMIT 1;
   ```
3. If an entry is found:
   - Create a new visit at the vacated `scheduled_at` timestamp with `origin_type = 'scheduled'`.
   - Mark the waitlist entry as `status = 'promoted'`, `promoted_visit_id = newVisit.id`.
   - Record an audit log entry (`visit.auto_promoted_from_waitlist`).
   - Return `{ promotedPatientId, newVisitId }` to display a toast notification on the Reception Desk.

---

## 6. Implementation Waves & Plan Breakdown

Phase 2 will be executed across 4 plans:
1. **Plan 02-01: Schema & Data Layer Tracer**
   - Migration `000006_appointments_queue_waitlist.sql` (`patients` age extension, `visits`, `queue_tokens`, `waitlist_entries`, RLS policies, token generator RPC).
   - TypeScript database types, Server Actions (`features/visits/`, `features/queue/`), and Vitest integration suite proving tenant isolation.
2. **Plan 02-02: Patient Intake, Dual Age/DOB & Duplicate Detection**
   - Dual Age / DOB sync input components.
   - Server-side duplicate search algorithm (`features/patients/dedup.ts`).
   - Non-blocking duplicate warning card banner in patient creation and quick-intake drawers.
   - Comprehensive unit tests.
3. **Plan 02-03: Reception Desk & Live Unified Queue**
   - High-density Reception Desk screen (`app/(dashboard)/queue/page.tsx`).
   - Unified listing for scheduled visits and walk-in tokens.
   - 1-tap quick actions: Check In, Send to Doctor, Complete.
   - Walk-in token generator and physical receipt/token badge.
4. **Plan 02-04: Doctor Day Timeline Calendar & Waitlist Auto-Promotion**
   - Per-doctor multi-column day timeline schedule (`app/(dashboard)/calendar/page.tsx`).
   - Quick-book slide-over drawer / bottom sheet per `DESIGN.md`.
   - Double-booking block with 1-tap overbooking confirmation.
   - Waitlist auto-promotion logic on appointment cancellation.
   - Full end-to-end UAT and test suite pass.
