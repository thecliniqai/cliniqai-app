# Phase 06: API & Launch Readiness - Pattern Map

**Mapped:** 2026-11-09  
**Files analyzed:** 50  
**Analogs found:** 50 / 50 (100% codebase coverage)  

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/000018_api_keys_webhooks_dpdp.sql` | migration | batch | `supabase/migrations/000014_communications_and_ai.sql` | exact |
| `lib/db/types.ts` | model | transform | `lib/db/types.ts` | exact |
| `lib/api/auth.ts` | middleware | request-response | `lib/auth/tenant.ts` | exact |
| `lib/api/rate-limiter.ts` | utility | request-response | `lib/messaging/governance.ts` | role-match |
| `lib/api/envelope.ts` | utility | transform | `lib/utils.ts` | role-match |
| `lib/api/doctor-guard.ts` | middleware | request-response | `lib/permissions/guards.ts` | exact |
| `lib/api/openapi-spec.ts` | utility | transform | `lib/messaging/templates/mapping.ts` | role-match |
| `lib/webhooks/signer.ts` | utility | transform | `lib/messaging/webhook-helpers.ts` | exact |
| `lib/webhooks/outbox.ts` | service | event-driven | `lib/messaging/dispatcher.ts` | exact |
| `lib/webhooks/dispatcher.ts` | service | event-driven | `lib/messaging/dispatcher.ts` | exact |
| `app/api/health/route.ts` | route | request-response | `app/api/cron/dispatch-communications/route.ts` | role-match |
| `app/api/ready/route.ts` | route | request-response | `app/api/cron/dispatch-communications/route.ts` | role-match |
| `app/api/cron/webhooks/route.ts` | route | batch | `app/api/cron/dispatch-communications/route.ts` | exact |
| `app/api/v1/openapi.json/route.ts` | route | request-response | `app/api/cron/dispatch-communications/route.ts` | role-match |
| `app/api/v1/docs/route.ts` | route | request-response | `app/api/reschedule/[token]/route.ts` | role-match |
| `app/api/v1/patients/route.ts` | route | CRUD | `features/patients/actions.ts` | exact |
| `app/api/v1/patients/[id]/route.ts` | route | CRUD | `app/api/reschedule/[token]/route.ts` | exact |
| `app/api/v1/appointments/route.ts` | route | CRUD | `features/appointments/actions.ts` | exact |
| `app/api/v1/appointments/[id]/route.ts` | route | CRUD | `app/api/webhooks/messaging/[provider]/route.ts` | exact |
| `app/api/v1/visits/route.ts` | route | CRUD | `features/visits/actions.ts` | exact |
| `app/api/v1/visits/[id]/route.ts` | route | CRUD | `features/consultation/actions.ts` | exact |
| `app/api/v1/prescriptions/route.ts` | route | CRUD | `features/prescriptions/actions.ts` | exact |
| `app/api/v1/prescriptions/[id]/route.ts` | route | CRUD | `app/api/visits/[id]/prescription-pdf/route.ts` | exact |
| `app/api/v1/lab-orders/route.ts` | route | CRUD | `features/labs/actions.ts` | exact |
| `app/api/v1/lab-orders/[id]/route.ts` | route | CRUD | `features/labs/actions.ts` | exact |
| `app/api/v1/referrals/route.ts` | route | CRUD | `features/referrals/actions.ts` | exact |
| `app/api/v1/referrals/[id]/route.ts` | route | CRUD | `features/referrals/actions.ts` | exact |
| `features/dpdp/export.ts` | service | CRUD | `features/patients/consent.ts` | exact |
| `features/dpdp/erasure.ts` | service | CRUD | `features/patients/actions.ts` | exact |
| `features/dpdp/pdf/medical-summary-doc.tsx` | component | file-I/O | `features/prescriptions/pdf/prescription-document.tsx` | exact |
| `features/dpdp/pdf/generator.ts` | service | file-I/O | `features/prescriptions/pdf/generator.ts` | exact |
| `app/(dashboard)/patients/[id]/consent-section.tsx` | component | request-response | `app/(dashboard)/patients/[id]/consent-section.tsx` | exact |
| `components/patients/dpdp-export-actions.tsx` | component | request-response | `components/patients/patient-detail-view.tsx` | exact |
| `features/api-keys/actions.ts` | service | CRUD | `features/staff/actions.ts` | exact |
| `features/webhooks/actions.ts` | service | CRUD | `features/settings/actions.ts` | exact |
| `components/settings/api-keys-manager.tsx` | component | CRUD | `components/staff/staff-list.tsx` | exact |
| `components/settings/webhook-manager.tsx` | component | CRUD | `components/staff/staff-list.tsx` | exact |
| `components/settings/statutory-fields-card.tsx` | component | CRUD | `components/settings/clinic-profile-form.tsx` | exact |
| `app/(dashboard)/settings/clinic/page.tsx` | component | request-response | `app/(dashboard)/settings/clinic/page.tsx` | exact |
| `lib/auth/dev-logger.ts` | utility | file-I/O | `lib/auth/dev-logger.ts` | exact |
| `features/auth/dev-actions.ts` | service | request-response | `features/auth/dev-actions.ts` | exact |
| `lib/audit/audit.ts` | service | CRUD | `lib/audit/audit.ts` | exact |
| `tests/api/v1-auth.spec.ts` | test | request-response | `tests/messaging/msg91-webhook.spec.ts` | exact |
| `tests/api/v1-crud.spec.ts` | test | CRUD | `tests/integration/visits.spec.ts` | exact |
| `tests/api/v1-doctor-guard.spec.ts` | test | request-response | `tests/auth/rbac.spec.ts` | exact |
| `tests/api/webhooks-outbox.spec.ts` | test | event-driven | `tests/messaging/outbox-queue.spec.ts` | exact |
| `tests/api/rate-limiting.spec.ts` | test | request-response | `tests/messaging/outbox-queue.spec.ts` | exact |
| `tests/api/health-probes.spec.ts` | test | request-response | `tests/messaging/msg91-webhook.spec.ts` | exact |
| `tests/compliance/dpdp-rights.spec.ts` | test | CRUD | `tests/compliance/consent.spec.ts` | exact |
| `tests/security/dev-logger-lockout.spec.ts` | test | transform | `tests/auth/rbac.spec.ts` | exact |

---

## Pattern Assignments

### 1. Database Migration: `supabase/migrations/000018_api_keys_webhooks_dpdp.sql` (migration, batch)

**Analog:** `supabase/migrations/000014_communications_and_ai.sql` (lines 11-55, 57-90)

**Core Schema Pattern** (copy from lines 11-42):
```sql
-- Pattern from 000014_communications_and_ai.sql:11-42
CREATE TABLE IF NOT EXISTS public.api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,           -- e.g. 'clq_live_a1b2c3d4'
    key_hash TEXT NOT NULL,             -- SHA-256 digest
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON public.api_keys (key_prefix) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON public.api_keys (tenant_id);
```

**RLS Isolation Pattern** (copy from lines 42-55):
```sql
-- Pattern from 000014_communications_and_ai.sql:42-55
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_keys_tenant_isolation" ON public.api_keys;
CREATE POLICY "api_keys_tenant_isolation"
ON public.api_keys
FOR ALL
TO authenticated
USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
)
WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
);
```

---

### 2. API Key Authentication Middleware: `lib/api/auth.ts` (middleware, request-response)

**Analog:** `lib/auth/tenant.ts` (lines 30-60) & `lib/messaging/webhook-helpers.ts` (lines 20-40)

**Imports Pattern**:
```typescript
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
```

**Auth & Constant-Time Validation Pattern** (verified against `lib/messaging/webhook-helpers.ts`):
```typescript
export interface AuthenticatedApiKeySession {
  apiKeyId: string;
  tenantId: string;
  name: string;
  role: "admin"; // D-02: All-or-nothing clinic admin scope
}

export async function authenticateApiKey(req: NextRequest): Promise<
  | { success: true; session: AuthenticatedApiKeySession }
  | { success: false; response: NextResponse }
> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      success: false,
      response: NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Missing or malformed Authorization header. Expected Bearer clq_live_..." } },
        { status: 401 }
      ),
    };
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey.startsWith("clq_live_")) {
    return {
      success: false,
      response: NextResponse.json(
        { error: { code: "INVALID_KEY_FORMAT", message: "API key must begin with 'clq_live_'." } },
        { status: 401 }
      ),
    };
  }

  const computedHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const prefixSlice = rawKey.slice(0, 16);

  const admin = getAdminClient();
  const { data: keyRecord, error } = await (admin.from("api_keys") as any)
    .select("id, tenant_id, name, key_hash, revoked_at")
    .eq("key_prefix", prefixSlice)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !keyRecord) {
    return {
      success: false,
      response: NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid or revoked API key." } },
        { status: 401 }
      ),
    };
  }

  // Constant-time comparison to prevent timing attacks
  const hashMatches = crypto.timingSafeEqual(
    Buffer.from(computedHash, "hex"),
    Buffer.from(keyRecord.key_hash, "hex")
  );

  if (!hashMatches) {
    return {
      success: false,
      response: NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid or revoked API key." } },
        { status: 401 }
      ),
    };
  }

  // Non-blocking update of last_used_at
  admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRecord.id).then();

  return {
    success: true,
    session: {
      apiKeyId: keyRecord.id,
      tenantId: keyRecord.tenant_id,
      name: keyRecord.name,
      role: "admin",
    },
  };
}
```

---

### 3. Rate Limiter Utility: `lib/api/rate-limiter.ts` (utility, request-response)

**Analog:** `lib/messaging/governance.ts` (lines 50-80)

**Sliding Window In-Memory Pattern** (zero external latency):
```typescript
interface RateLimitRecord {
  timestamps: number[];
}

const rateLimitMap = new Map<string, RateLimitRecord>();

export function checkRateLimit(
  apiKeyId: string,
  limit = 120,
  windowMs = 60000
): {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
} {
  const now = Date.now();
  const windowStart = now - windowMs;

  let record = rateLimitMap.get(apiKeyId);
  if (!record) {
    record = { timestamps: [] };
    rateLimitMap.set(apiKeyId, record);
  }

  record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

  if (record.timestamps.length >= limit) {
    const oldest = record.timestamps[0] || now;
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetTime: Math.ceil((oldest + windowMs) / 1000),
    };
  }

  record.timestamps.push(now);
  const remaining = limit - record.timestamps.length;
  const oldest = record.timestamps[0] || now;

  return {
    allowed: true,
    limit,
    remaining,
    resetTime: Math.ceil((oldest + windowMs) / 1000),
  };
}
```

---

### 4. Uniform Envelope Formatting: `lib/api/envelope.ts` (utility, transform)

**Analog:** `lib/utils.ts`

**Standard Response Envelope Pattern (D-03)**:
```typescript
import { NextResponse } from "next/server";

export interface ApiSuccessEnvelope<T> {
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    total_pages?: number;
  };
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function apiSuccess<T>(data: T, meta?: ApiSuccessEnvelope<T>["meta"], status = 200, headers?: HeadersInit) {
  const body: ApiSuccessEnvelope<T> = { data };
  if (meta) body.meta = meta;
  return NextResponse.json(body, { status, headers });
}

export function apiError(code: string, message: string, status = 400, details?: unknown, headers?: HeadersInit) {
  const body: ApiErrorEnvelope = {
    error: { code, message, details },
  };
  return NextResponse.json(body, { status, headers });
}
```

---

### 5. Doctor Role Guard for Clinical Mutations: `lib/api/doctor-guard.ts` (middleware, request-response)

**Analog:** `lib/permissions/guards.ts` (lines 1-30)

**Doctor Membership Verification Pattern (D-05)**:
```typescript
import { getAdminClient } from "@/lib/supabase/admin";

export async function validateDoctorAssignment(
  tenantId: string,
  doctorId: string
): Promise<{ valid: boolean; doctorName?: string; error?: string }> {
  if (!doctorId) {
    return { valid: false, error: "Missing required doctor_id parameter for clinical mutation." };
  }

  const admin = getAdminClient();
  const { data: member, error } = await (admin.from("memberships") as any)
    .select("user_id, role, full_name")
    .eq("tenant_id", tenantId)
    .eq("user_id", doctorId)
    .maybeSingle();

  if (error || !member) {
    return { valid: false, error: `Doctor ID ${doctorId} not found in active clinic staff.` };
  }

  if (member.role !== "doctor" && member.role !== "owner") {
    return { valid: false, error: `User ${member.full_name} holds role '${member.role}', not 'doctor' or 'owner'.` };
  }

  return { valid: true, doctorName: member.full_name };
}
```

---

### 6. Webhook Outbox & Dispatcher: `lib/webhooks/outbox.ts` & `lib/webhooks/dispatcher.ts` (service, event-driven)

**Analog:** `lib/messaging/dispatcher.ts` (lines 48-100, 130-220)

**Transactional Enqueue Pattern** (copy from lines 63-100 of `lib/messaging/dispatcher.ts`):
```typescript
// Source: lib/messaging/dispatcher.ts:63-100 adapted for webhooks
export async function enqueueWebhookEvent(
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>,
  clientOverride?: unknown
) {
  const admin = clientOverride || getAdminClient();
  const rawPayloadString = JSON.stringify(payload);

  const { data, error } = await (admin.from("webhook_delivery_queue") as any)
    .insert({
      tenant_id: tenantId,
      event_type: eventType,
      payload: rawPayloadString,
      status: "pending",
      retry_count: 0,
      max_retries: 5,
      next_retry_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[webhooks/outbox] Enqueue error:", error);
    throw new Error(`Failed to enqueue webhook: ${error.message}`);
  }

  // Non-blocking immediate dispatch attempt (D-10)
  dispatchWebhookQueueItem(data.id).catch((err) =>
    console.warn(`[webhooks/outbox] Immediate dispatch failed for ${data.id}, cron will retry:`, err)
  );

  return data.id;
}
```

**Exponential Backoff Delay Pattern** (copy from lines 49-58 of `lib/messaging/dispatcher.ts`):
```typescript
// 5 attempts: 1m, 5m, 15m, 1h, 6h
export function calculateWebhookBackoffDelay(retryCount: number): number {
  switch (retryCount) {
    case 1: return 1 * 60 * 1000;      // 1 min
    case 2: return 5 * 60 * 1000;      // 5 min
    case 3: return 15 * 60 * 1000;     // 15 min
    case 4: return 60 * 60 * 1000;     // 1 hour
    default: return 6 * 60 * 60 * 1000; // 6 hours
  }
}
```

---

### 7. HMAC-SHA256 Signer: `lib/webhooks/signer.ts` (utility, transform)

**Analog:** `lib/messaging/webhook-helpers.ts` (lines 1-35)

**Stripe Standard Signature Pattern (D-11)**:
```typescript
import crypto from "crypto";

export function generateWebhookSignature(payloadString: string, secret: string, timestamp?: number): {
  header: string;
  timestamp: number;
} {
  const t = timestamp || Math.floor(Date.now() / 1000);
  const signedPayload = `${t}.${payloadString}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  return {
    header: `t=${t},v1=${signature}`,
    timestamp: t,
  };
}
```

---

### 8. Webhook Cron Route Handler: `app/api/cron/webhooks/route.ts` (route, batch)

**Analog:** `app/api/cron/dispatch-communications/route.ts` (lines 1-41)

**Imports & Auth Pattern** (lines 1-14):
```typescript
import { NextRequest, NextResponse } from "next/server";
import { dispatchPendingWebhookQueue } from "@/lib/webhooks/dispatcher";

async function handleCronDispatch(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing CRON_SECRET" },
      { status: 401 }
    );
  }

  try {
    const summary = await dispatchPendingWebhookQueue({ limit: 50 });
    return NextResponse.json(
      {
        success: true,
        timestamp: new Date().toISOString(),
        ...summary,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal Cron Error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handleCronDispatch(req);
}

export async function POST(req: NextRequest) {
  return handleCronDispatch(req);
}
```

---

### 9. REST Resource Route Handlers: `app/api/v1/patients/route.ts` & `app/api/v1/patients/[id]/route.ts` (route, CRUD)

**Analog:** `app/api/reschedule/[token]/route.ts` (Next.js 15 async params lines 7-14) & `features/patients/actions.ts` (lines 15-70)

**Route Handler Pattern with Auth, Rate Limiter, and Envelopes**:
```typescript
import { NextRequest } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/api/rate-limiter";
import { apiSuccess, apiError } from "@/lib/api/envelope";
import { getAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit/audit";
import { patientSchema } from "@/features/patients/schema";

export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth.success) return auth.response;
  const { session } = auth;

  // Rate Limiting (D-19)
  const rl = checkRateLimit(session.apiKeyId);
  const rateLimitHeaders = {
    "X-RateLimit-Limit": String(rl.limit),
    "X-RateLimit-Remaining": String(rl.remaining),
    "X-RateLimit-Reset": String(rl.resetTime),
  };
  if (!rl.allowed) {
    return apiError("RATE_LIMIT_EXCEEDED", "Too many requests. Limit is 120 req/min.", 429, null, rateLimitHeaders);
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
  const search = searchParams.get("search")?.trim();
  const offset = (page - 1) * limit;

  const admin = getAdminClient();
  let query = (admin.from("patients") as any)
    .select("*", { count: "exact" })
    .eq("tenant_id", session.tenantId)
    .eq("is_deleted", false);

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`);
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return apiError("DATABASE_ERROR", error.message, 500, null, rateLimitHeaders);
  }

  return apiSuccess(
    data || [],
    { page, limit, total: count || 0, total_pages: Math.ceil((count || 0) / limit) },
    200,
    rateLimitHeaders
  );
}

export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth.success) return auth.response;
  const { session } = auth;

  const rl = checkRateLimit(session.apiKeyId);
  if (!rl.allowed) return apiError("RATE_LIMIT_EXCEEDED", "Rate limit exceeded.", 429);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_JSON", "Malformed JSON request body.", 400);
  }

  const parseResult = patientSchema.safeParse(body);
  if (!parseResult.success) {
    return apiError("VALIDATION_ERROR", "Validation failed", 422, parseResult.error.flatten());
  }

  const admin = getAdminClient();
  const { data: newPatient, error } = await (admin.from("patients") as any)
    .insert({
      ...parseResult.data,
      tenant_id: session.tenantId,
      created_by: session.apiKeyId,
    })
    .select("*")
    .single();

  if (error) return apiError("DATABASE_ERROR", error.message, 500);

  // Audit write action (D-08)
  await recordAudit({
    action: "patient.create",
    entityType: "patient",
    entityId: newPatient.id,
    metadata: { actor_type: "api_key", api_key_id: session.apiKeyId },
  }, admin, { userId: session.apiKeyId, tenantId: session.tenantId, role: "admin" });

  return apiSuccess(newPatient, undefined, 201);
}
```

**Dynamic Parameter Handler (`[id]/route.ts`)**:
```typescript
// Next.js 15: context params are Promise-based (app/api/reschedule/[token]/route.ts:9-12)
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  // Authenticate, verify tenant_id = session.tenantId, return apiSuccess or apiError 404
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  // D-14: Soft delete (status = 'erased', is_deleted = true) to satisfy NMC 3-year mandatory retention
}
```

---

### 10. DPDP Right to Access PDF Generator & Document: `features/dpdp/pdf/` (service/component, file-I/O)

**Analog:** `features/prescriptions/pdf/generator.ts` (lines 40-140) & `features/prescriptions/pdf/prescription-document.tsx` (lines 1-170)

**Document Structure (`features/dpdp/pdf/medical-summary-doc.tsx`)**:
```typescript
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 30, fontSize: 9, fontFamily: "Helvetica", color: "#1E293B" },
  header: { borderBottomWidth: 1.5, borderColor: "#1769E0", paddingBottom: 8, marginBottom: 12 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#0F172A" },
  subTitle: { fontSize: 9, color: "#64748B", marginTop: 2 },
  sectionTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", color: "#1769E0", marginTop: 12, marginBottom: 6, borderBottomWidth: 0.5, borderColor: "#E2E8F0", paddingBottom: 2 },
  badge: { backgroundColor: "#EAF2FF", padding: "3 6", borderRadius: 4, alignSelf: "flex-start", marginTop: 4 },
  badgeText: { color: "#1769E0", fontSize: 8, fontFamily: "Helvetica-Bold" },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#F1F5F9", paddingVertical: 4 },
  colLabel: { width: "30%", fontFamily: "Helvetica-Bold", color: "#475569" },
  colValue: { width: "70%", color: "#0F172A" },
});
```

**Generator Service (`features/dpdp/pdf/generator.ts`)**:
```typescript
// Pattern from features/prescriptions/pdf/generator.ts:47-60
import React from "react";
import { pdf } from "@react-pdf/renderer";
import { DpdpMedicalSummaryDocument } from "./medical-summary-doc";

export async function generateDpdpMedicalSummaryPdf(payload: any): Promise<Buffer> {
  const doc = React.createElement(DpdpMedicalSummaryDocument, { payload });
  const instance = pdf(doc);
  const stream = await instance.toBuffer();
  
  if (Buffer.isBuffer(stream)) return stream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
```

---

### 11. Patient Detail DPDP Consent & Export UI: `app/(dashboard)/patients/[id]/consent-section.tsx` & `components/patients/dpdp-export-actions.tsx` (component, request-response)

**Analog:** `app/(dashboard)/patients/[id]/consent-section.tsx` (lines 1-110) & `components/patients/patient-detail-view.tsx` (lines 253-280)

**Single Global Consent Toggle (D-15)**:
```typescript
// Replace multi-row with single active consent toggle
export function ConsentSection({ patientId, globalConsent }: { patientId: string; globalConsent: CurrentConsentState }) {
  const [loading, setLoading] = useState(false);
  const isGranted = globalConsent.status === "granted";

  const handleToggle = async () => {
    setLoading(true);
    if (isGranted) {
      await withdrawConsent(patientId, "global", "Patient withdrew consent");
    } else {
      await grantConsent(patientId, "global", "Informed consent active");
    }
    setLoading(false);
  };
  // Render toggle with Shield icon and audit notice
}
```

**DPDP Dual-Format Export Trigger (`components/patients/dpdp-export-actions.tsx`)**:
```typescript
// Pattern from components/patients/patient-detail-view.tsx:253-280
import { Button } from "@/components/ui/button";
import { Download, FileText, Trash2 } from "lucide-react";

export function DpdpExportActions({ patientId }: { patientId: string }) {
  const handleJsonExport = () => window.open(`/api/v1/patients/${patientId}/export?format=json`, "_blank");
  const handlePdfExport = () => window.open(`/api/v1/patients/${patientId}/export?format=pdf`, "_blank");

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" startIcon={<Download className="w-4 h-4" />} onClick={handleJsonExport}>
        Export JSON Archive
      </Button>
      <Button variant="primary" size="sm" startIcon={<FileText className="w-4 h-4" />} onClick={handlePdfExport}>
        Download Medical Summary (PDF)
      </Button>
    </div>
  );
}
```

---

### 12. Settings Tab & Management UI: `components/settings/api-keys-manager.tsx` & `webhook-manager.tsx` (component, CRUD)

**Analog:** `components/staff/staff-list.tsx` (lines 43-120) & `components/ui/modal.tsx` (lines 16-52)

**Key Reveal Modal & Action Pattern (D-01, D-04, D-12)**:
```typescript
// Pattern from components/staff/staff-list.tsx and components/ui/modal.tsx
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, Key, Plus, AlertTriangle } from "lucide-react";

export function ApiKeysManager({ initialKeys }: { initialKeys: ApiKey[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Render table with prefix, created date, last used, revoke action
  // Render single-reveal modal when a new key is created with 1-click copy
}
```

---

### 13. Dev Logger Lockdown: `lib/auth/dev-logger.ts` & `features/auth/dev-actions.ts` (security, utility)

**Analog:** `lib/auth/dev-logger.ts` (lines 19-30) & `features/auth/dev-actions.ts` (lines 30-40)

**Production Lockdown Gate (D-17)**:
```typescript
// In lib/auth/dev-logger.ts
export function logDevAuthEvent(event: DevAuthEvent): void {
  // STRICT SECURITY GATE: Permanent blackout in production builds
  if (process.env.NODE_ENV === "production") {
    return;
  }
  // Suppress unless dev or test
}

// In features/auth/dev-actions.ts
export async function requestOtpAction(email: string, context = "login") {
  const isDevOrTest = process.env.NODE_ENV !== "production";
  // Always return devOtp: null, magicLink: null in production
  return {
    success: true,
    devOtp: isDevOrTest ? devOtp : null,
    magicLink: isDevOrTest ? magicLink : null,
  };
}
```

---

## Shared Patterns

### Authentication & Tenant Boundary
**Source:** `lib/api/auth.ts` & `lib/supabase/admin.ts`  
**Apply to:** All external routes under `app/api/v1/*`
```typescript
const auth = await authenticateApiKey(req);
if (!auth.success) return auth.response;
const { session } = auth; // contains verified session.tenantId derived from DB
```

### Rate Limiting & Standards-Compliant Headers
**Source:** `lib/api/rate-limiter.ts`  
**Apply to:** All external routes under `app/api/v1/*`
```typescript
const rl = checkRateLimit(session.apiKeyId);
const headers = {
  "X-RateLimit-Limit": String(rl.limit),
  "X-RateLimit-Remaining": String(rl.remaining),
  "X-RateLimit-Reset": String(rl.resetTime),
};
if (!rl.allowed) {
  return apiError("RATE_LIMIT_EXCEEDED", "Rate limit exceeded (120 req/min).", 429, null, headers);
}
```

### Transactional Outbox Pattern
**Source:** `lib/messaging/dispatcher.ts` (lines 63-100)  
**Apply to:** Outgoing webhook dispatches in `features/appointments`, `features/consultation`, `features/prescriptions`, `features/labs`
```typescript
// Non-blocking transactional insert: mutations never freeze if webhook endpoint is slow or unreachable
await enqueueWebhookEvent(tenantId, "appointment.booked", appointmentPayload);
```

### Database Migration & RLS Tenant Isolation
**Source:** `supabase/migrations/000014_communications_and_ai.sql` (lines 42-55)  
**Apply to:** All new tables in migration `000018_api_keys_webhooks_dpdp.sql`
```sql
ALTER TABLE public.table_name ENABLE ROW LEVEL SECURITY;
CREATE POLICY "table_name_tenant_isolation" ON public.table_name FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()));
```

---

## No Analog Found

Every file to be created or modified in Phase 06 has an exact or role-matching analog in the current repository:
- All external REST endpoints copy route handler patterns from `app/api/reschedule/[token]/route.ts` and domain logic from `features/*/actions.ts`.
- Webhook outbox queue directly copies Phase 5's `lib/messaging/dispatcher.ts`.
- DPDP PDF export copies `features/prescriptions/pdf/generator.ts`.
- Settings UI copies `components/staff/staff-list.tsx` and `components/settings/clinic-profile-form.tsx`.

---

## Metadata

**Analog search scope:**
- `app/api/` (Next.js 15 App Router Route Handlers, Cron jobs, Webhook receivers, PDF streams)
- `lib/` (Supabase admin/server, Auth, Permissions, Messaging outbox, Audit)
- `features/` (Patients, Appointments, Consultation, Prescriptions, Labs, Referrals, Settings)
- `components/` (UI primitives, Staff management, Settings forms, Patient detail view)
- `supabase/migrations/` (Schema definitions, RLS policies, Indexes)
- `tests/` (Vitest unit and integration test specs)

**Files scanned:** 140+  
**Pattern extraction date:** 2026-11-09  
**Tracked source status:** Verified via `git ls-files` — zero mirror/gitignored references.
