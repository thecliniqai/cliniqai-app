---
phase: 6
reviewers: [opencode]
reviewed_at: 2026-11-09T14:10:02.091Z
plans_reviewed: [06-01-PLAN.md, 06-02-PLAN.md, 06-03-PLAN.md, 06-04-PLAN.md, 06-05-PLAN.md]
models:
  opencode: "opencode/deepseek-v4.1-flash-free"
model_sources:
  opencode: "pinned"
---

# Cross-AI Plan Review — Phase 6

<!-- gsd-plan-revision-conflicts:begin -->
## Plan-Revision Conflicts

<!-- gsd-plan-revision-conflicts:end -->

## OpenCode Review

I'll verify these plans against the actual repository before reviewing. Let me explore the codebase.


# Cross-AI Plan Review — Phase 06: API & Launch Readiness

I reviewed all five plans against the live repository. The plans are generally well-structured and security-conscious at the cryptographic level, but they are built on several incorrect assumptions about the existing schema and audit model. Those assumptions will cause runtime failures and, in a few places, security gaps.

Key verification points: there is **no `public.appointments` table** (the app uses a unified `visits` table), `audit_logs` has **no `actor_type`/`api_key_id` columns**, `patients` has **no `is_deleted`/`status` columns**, and several referenced column names in prescriptions/labs/referrals do not exist.

---

## 06-01

### Summary
This plan establishes the right foundation — prefixed Bearer keys, SHA-256 hashing, timing-safe comparison, envelopes, and pagination. The crypto design is sound. However, it targets a nonexistent `appointments` table, writes invalid `created_by` values, assumes an audit schema that does not exist, and leaves the API-key RLS model dangerously permissive. As written, its own tests would fail against the current database.

### Strengths
- Correct token design: `clq_live_` prefix, CSPRNG generation, SHA-256 at rest, `crypto.timingSafeEqual` (`06-01` Task 1). This matches industry practice and avoids bcrypt/Argon2 misuse for high-entropy tokens.
- Uniform envelopes and pagination (`{ data, meta }` / `{ error }`) align with AGENTS.md §11 and the stated API contract.
- Migration placement (`000018` after existing `000017`) is correct, and the plan recognizes the need for indexes on `key_prefix`.
- Tests are planned at the right level (auth, rate limit, CRUD) and use the existing Vitest setup.

### Concerns
- **HIGH — `public.appointments` does not exist.** The actual model is `public.visits` with `origin_type ('scheduled'|'walk_in')`, `scheduled_at`, `estimated_duration_minutes` (`supabase/migrations/000006_appointments_queue_waitlist.sql:11-31`; `features/appointments/actions.ts:55-70` inserts into `visits`). Task 2 queries `public.appointments` with `scheduled_start`, `scheduled_end`, and `appointment_type`, none of which exist. Every appointment route/test will fail.
- **HIGH — `created_by` FK violation.** `patients.created_by` is `NOT NULL REFERENCES auth.users(id)` (`supabase/migrations/000003_patients_audit_consent.sql:16`). The pattern in `06-PATTERNS.md` inserts `created_by: session.apiKeyId` — an API-key UUID, not a user UUID. This will violate the FK. The same issue applies to `visits.created_by` (`000006...:29`) and `patient_documents.uploaded_by` (`000013...:97`).
- **HIGH — audit model mismatch.** `audit_logs` has no `actor_type` or `api_key_id` (`supabase/migrations/000003...:25-35`). `recordAudit` hardcodes `actor_id`/`actor_role` from a cookie membership (`lib/audit/audit.ts:143-165`) and `getActiveMembership()` requires a Supabase cookie session (`lib/auth/tenant.ts:30-45`). API-key requests have no cookie session, so `recordAudit` throws “Unauthenticated” unless a membership override is passed — and the override still writes `actor_id = apiKeyId`, which is not an `auth.users` row.
- **HIGH — audit metadata is silently stripped.** `filterMetadata` only permits a fixed whitelist (`lib/audit/audit.ts:80-141`). `actor_type`, `api_key_id`, `retention_policy`, `erased_at`, `status`, and `format` are not allowed, so the D-08 audit payload will be lost. The `AuditAction` union (`lib/audit/audit.ts:4-55`) also lacks `appointment.*`, `lab.*`, `prescription.issue`, and `dpdp.*`, so plan audit calls will fail typecheck unless `lib/audit/audit.ts` is modified — it is not in `files_modified`.
- **HIGH — erasure schema is incomplete.** Task 1 only adds `erased_at` and `erasure_reason`, but the same plan’s GET filters `.eq("is_deleted", false)` and Plan 06-04 sets `status = 'erased'` and `is_deleted = true`. Neither `is_deleted` nor `status` exists (`000003...:8-22`; `000014...:129-134` only adds communication fields). The patient list query will fail.
- **HIGH — API-key RLS is privilege escalation.** `06-PATTERNS.md:96-110` creates `FOR ALL TO authenticated` policies gated only by tenant membership. Any receptionist/nurse could insert an `api_keys` row (with full admin scope per D-02) or select existing `key_hash` values via the anon client, bypassing the server action’s `clinic:manage` check. Webhook signing secrets have the same exposure risk in Plan 06-03.
- **HIGH — service-role client bypasses RLS.** `getAdminClient()` uses the service role (`lib/supabase/admin.ts:12-28`), so RLS is not actually enforcing tenant isolation. Isolation depends entirely on every `.eq("tenant_id", ...)` being present. One missed filter leaks cross-tenant data. The plan’s claim that “RLS enforces isolation” is inaccurate for these routes.
- **HIGH — internal DB errors are returned to clients.** The pattern returns `apiError("DATABASE_ERROR", error.message, 500)` (`06-PATTERNS.md` route example). AGENTS.md §12 forbids exposing internal exception messages. Use a generic message + server-side correlation ID.
- **MEDIUM — rate limiter is ineffective on Vercel.** The in-memory `Map` (`06-01` Task 2) is per-lambda-instance. Under Vercel’s serverless model, 120 req/min per key is not globally enforced, and the map has no eviction (memory growth). D-19’s title mentions Postgres fallback, but no Postgres implementation is planned.
- **MEDIUM — collection GET is not rate-limited.** Task 1’s `/api/v1/patients` GET does not call `checkRateLimit`; only Task 2’s `[id]` and appointments routes do. This contradicts “all `/api/v1/*` responses” in the must-haves.
- **MEDIUM — `key_prefix` collision risk.** Slicing the first 16 chars of `clq_live_...` leaves only ~7 random hex chars (~28 bits), and `key_prefix` is not `UNIQUE` (`06-PATTERNS.md:88`). The auth query uses `.maybeSingle()` on the prefix (`06-PATTERNS.md:164`), so two colliding keys make both fail. Store a longer prefix or look up by full SHA-256 hash with a unique index.
- **MEDIUM — search filter injection.** The pattern interpolates `search` into `.or(\`full_name.ilike.%${search}%...\`)` without sanitization (`06-PATTERNS.md:528`). The existing `buildPatientSearchFilter` sanitizes commas/parens (`features/patients/actions.ts:199-230`); reuse it.
- **MEDIUM — appointment logic is reimplemented.** The plan writes directly to the table instead of using `createAppointment`/`rescheduleAppointment`/`cancelAppointment` (`features/appointments/actions.ts:51,134,210`), losing slot-conflict checks (`features/visits/scheduling.ts:380-444`), waitlist release, and notification enqueueing. This risks double booking (AGENTS.md §17).
- **MEDIUM — no usage counters.** D-08 and phase success criterion 2 require per-key usage logs/counters. No table or task exists.
- **MEDIUM — `last_used_at` write per request.** Updating on every request doubles DB operations and creates write amplification under load; D-08’s aggregated counters would be cheaper.
- **MEDIUM — middleware runs on API routes.** `middleware.ts:52-63` matches almost everything, so every `/api/v1/*` request performs a Supabase `auth.getUser()` cookie refresh. This adds latency and is unnecessary for Bearer-authenticated API traffic.
- **MEDIUM — `Database` type registry not updated.** `lib/db/types.ts:468` defines `Database.public.Tables` manually. Adding interfaces alone is not enough; new tables must be added to `Database` or typechecking will fail outside `as any` casts.
- **LOW — pagination NaN handling.** `parseInt` can yield `NaN`, and `Math.max(1, NaN)` is `NaN`. Validate explicitly.
- **LOW — no CORS/request IDs.** Browser clients and observability would benefit; AGENTS.md §12/§33.

### Suggestions
- Replace `appointments` with `visits` or add an explicit compatibility view/alias. If both resources are required, document that `/appointments` is a filtered view over `visits` (`origin_type='scheduled'`) and share one implementation.
- Introduce a real actor model: either add `actor_type`/`api_key_id` to `audit_logs`, or create a dedicated `api_audit_logs` table. Do not reuse `auth.users` FKs for API keys.
- Add `is_deleted BOOLEAN NOT NULL DEFAULT false`, `status TEXT`, `erased_at`, `erasure_reason` in migration `000018`, plus an index on `(tenant_id, is_deleted)`.
- Restrict `api_keys`/`webhook_subscriptions` RLS to `owner`/`admin` and hide `key_hash`/`signing_secret` via a safe view or column privileges.
- Reuse existing domain services for appointments/patients; centralize tenant-scoped queries in a helper that always injects `tenant_id`.
- Add Postgres-backed or Upstash-backed rate limiting if the 120/min guarantee matters; at minimum document the serverless limitation.
- Sanitize search input and return generic 5xx messages.

### Risk Assessment
**HIGH.** The crypto/auth core is good, but the plan will not run against the current schema (appointments, `is_deleted`, `created_by`, audit columns) and its RLS design creates a privilege-escalation path.

---

## 06-02

### Summary
The Doctor Guard concept is exactly right for clinical governance, and the resource coverage is ambitious. However, the plan’s column-level assumptions for visits, prescriptions, labs, and referrals are substantially wrong, and it bypasses existing clinical safety logic (notably the diagnosis/notes requirement before completing a visit). Most clinical API tests would fail as written.

### Strengths
- D-05 doctor validation is correctly designed: verify `doctor_id` belongs to the tenant and holds `doctor` or `owner` (`06-PATTERNS.md` Pattern 5).
- Tenant-scoped filters and rate-limit headers are consistently intended.
- Prescription creation is correctly identified as a header + itemized transaction.
- Test intent covers cross-tenant doctor assignment, which is the right isolation check.

### Concerns
- **HIGH — visits column mismatch.** The plan uses `visit_type` and `chief_complaint`. The actual `visits` table has `origin_type`, `reason_for_visit`, `chief_complaints` (JSONB), `clinical_notes`, `scheduled_at`, and `created_by NOT NULL` (`supabase/migrations/000006...:11-31`; `000007...:8-18`). The insert will fail.
- **HIGH — `created_by` missing on visit insert.** `visits.created_by` is `NOT NULL REFERENCES auth.users(id)` (`000006...:29`). The plan does not set it, and an API key is not a user.
- **HIGH — prescription item columns are wrong.** `prescription_items` has `timing` and `special_instructions`, not `frequency`/`instructions`, and has **no `tenant_id`** column (`supabase/migrations/000007...:80-96`). The plan inserts `frequency`, `instructions`, and `tenant_id`; all fail.
- **HIGH — lab orders are modeled as documents with nonexistent columns.** `patient_documents` requires `title`, `original_filename`, `storage_path`, `file_size_bytes`, `mime_type`, and `uploaded_by NOT NULL` (`000013...:84-103`). The plan uses `test_name` and `file_url or summary`; neither exists. There is also no `lab_orders` table — the app stores lab *results/documents*, not orders.
- **HIGH — referral column names are wrong.** The plan uses `referred_to_doctor_name`, `specialty`, and `reason`. Actual columns are `referred_to_name`, `referred_to_specialty`, and `reason_for_referral` (`000013...:157-172`). The insert will fail.
- **HIGH — no patient/visit tenant validation.** The plan validates `doctor_id` belongs to the tenant but does not verify `patient_id` or `visit_id` belongs to the same tenant. A caller with a valid patient UUID from another tenant could create cross-tenant references; FK constraints alone do not enforce tenant consistency.
- **HIGH — visit completion bypasses clinical safety.** `completeAndSignConsultation` refuses to complete without at least one diagnosis or clinical note (`features/consultation/actions.ts:620-640`). The plan’s `PATCH /visits/[id]` simply sets `status='completed'`, allowing an API caller to finalize an empty encounter. This is a clinical/regulatory safety issue.
- **HIGH — in-network referral consent is not enforced.** `referrals.patient_consents_history_sharing` and `consented_history_snapshot` exist (`000013...:169-171`), but the plan does not check consent before creating an in-network referral or sharing history. DPDP purpose limitation requires this.
- **MEDIUM — prescription version conflict.** `prescriptions` has `UNIQUE (tenant_id, visit_id, version)` with default `version=1` (`000007...:59-74`). A second POST for the same visit will violate the constraint; the plan does not handle amendment/versioning.
- **MEDIUM — prescription issuance is incomplete.** The plan inserts `status='active'` but does not set `signed_at`, generate the PDF, or enforce that the prescribing doctor owns the visit. Existing `completeAndSignConsultation` sets `signed_at` and archives the PDF (`features/consultation/actions.ts:640-680`).
- **MEDIUM — referrals are not doctor-guarded.** D-05 applies to clinical mutations; referrals are clinical. The plan only applies Doctor Guard to visits/prescriptions, so a receptionist-scoped caller could create a referral.
- **MEDIUM — no slot-conflict check on visits.** `features/visits/scheduling.ts:380-444` already implements conflict detection; the API POST should reuse it rather than insert directly.
- **MEDIUM — audit issues inherited from 06-01.** Same `actor_type`/`api_key_id`/cookie-session problems.
- **MEDIUM — no webhook triggers.** See 06-03; clinical API mutations should also enqueue events.
- **MEDIUM — reimplements domain services.** The routes should call `features/visits/actions.ts`, `features/prescriptions/actions.ts`, `features/labs/actions.ts`, and `features/referrals/actions.ts` to preserve validation, audit, notifications, and PDF generation.

### Suggestions
- Align every field with the migrations: `origin_type`, `reason_for_visit`, `chief_complaints`, `timing`, `special_instructions`, `referred_to_name`, `referred_to_specialty`, `reason_for_referral`.
- Introduce a `resolveActor()` helper that returns a valid `created_by`/`uploaded_by` user (e.g., the API key’s `created_by`) or add a system actor.
- Add explicit tenant checks for `patient_id`, `visit_id`, and `target_tenant_id`.
- Reuse `completeAndSignConsultation` for completion, or replicate its diagnosis/notes guard.
- Require `patient_consents_history_sharing` for in-network referrals and snapshot the consented history.
- Reuse existing scheduling conflict checks and prescription versioning.

### Risk Assessment
**HIGH.** The Doctor Guard is a good control, but the resource implementations do not match the schema and bypass important clinical safety and consent rules.

---

## 06-03

### Summary
The webhook design is the strongest part of the phase: Stripe-style HMAC, transactional outbox, exponential backoff, and cron recovery all mirror the existing messaging outbox. The fatal gap is that no domain action calls `enqueueWebhookEvent`, so webhooks will never fire for real clinic events. The plan also lacks SSRF protection and exposes signing secrets through permissive RLS.

### Strengths
- HMAC-SHA256 over `${timestamp}.${payload}` with `X-ClinicQ-Signature: t=...,v1=...` is correct and matches Stripe.
- The outbox/backoff design closely follows the existing `lib/messaging/dispatcher.ts` pattern (`calculateBackoffDelay` at `lib/messaging/dispatcher.ts:47-55`, enqueue at `:88-110`, cron auth at `app/api/cron/dispatch-communications/route.ts:4-20`).
- Cron route reuses the existing `CRON_SECRET` Bearer pattern.
- Single-reveal key UI and test-ping concept are good developer UX.
- Zero new npm packages; Node `crypto` is the right choice.

### Concerns
- **HIGH — webhooks have no trigger call sites.** `06-03` `files_modified` excludes `features/appointments/actions.ts`, `features/consultation/actions.ts`, `features/prescriptions/actions.ts`, and `features/labs/actions.ts`. `06-PATTERNS.md:786` explicitly says triggers apply in those files. Without modifying them, `appointment.booked`, `visit.completed`, `prescription.issued`, and `lab_result.ready` will never enqueue. Phase success criterion 2 is unmet.
- **HIGH — queue schema is under-specified.** Task 1 says “create `webhook_delivery_queue`” but does not enumerate `subscription_id`, `endpoint_url`, `signing_secret`, `event_types`, `payload`, `status`, `retry_count`, `max_retries`, `next_retry_at`, `response_status`, `duration_ms`, `delivered_at`. The dispatcher cannot work without these.
- **HIGH — payload type breaks signatures.** If `payload` is `JSONB`, Postgres normalizes key order/whitespace and retries will sign a different string than the original. Store `payload TEXT` and sign the exact transmitted string; the plan does not specify this.
- **HIGH — SSRF via webhook URLs.** Owners supply `endpoint_url`, and the dispatcher performs `fetch()` against it (`06-03` Task 2). There is no URL validation, private-IP blocking, `https` enforcement, or allowlist. An owner could make the server hit `169.254.169.254`, internal services, or localhost. AGENTS.md §31 explicitly calls out SSRF.
- **HIGH — signing secrets exposed via RLS.** The `webhook_subscriptions` RLS is not defined; if it mirrors the `api_keys` `FOR ALL` tenant policy (`06-PATTERNS.md:96-110`), every staff member can read `signing_secret` and forge webhooks. Secrets should be owner/admin-only and ideally encrypted at rest.
- **HIGH — fire-and-forget dispatch is unreliable serverless.** `enqueueWebhookEvent` calls `dispatchWebhookQueueItem(...)` without `await` (`06-PATTERNS.md` Pattern 6). On Vercel, work after the response can be terminated. The existing messaging outbox awaits `dispatchPendingQueue` in a `try/catch` (`lib/messaging/dispatcher.ts:108-115`) or relies on cron. Use `after()`/`waitUntil` or rely solely on cron.
- **HIGH — API key/webhook lifecycle is not audited.** Creating/revoking API keys and creating/deleting webhook subscriptions are security-sensitive actions (AGENTS.md §10). The plan does not audit them, and `recordAudit` has no matching actions.
- **MEDIUM — settings page has no tabs.** `app/(dashboard)/settings/clinic/page.tsx:1-36` renders a single `ClinicProfileForm`; there are no “General, Staff, and Availability” tabs. The plan’s instruction to add a tab “alongside” them is based on a false premise. A tab shell must be built or a separate route used.
- **MEDIUM — no usage logs UI.** Success criterion 2 requires per-key usage logs visible per tenant; the UI only shows keys and webhook delivery logs.
- **MEDIUM — `listApiKeys(tenantId)` trusts a parameter.** Derive `tenantId` from the session, never accept it from the caller (AGENTS.md §7).
- **MEDIUM — “transactional” outbox is not truly transactional.** The mutation and queue insert are separate statements, and existing domain clients are service-role clients without a wrapping transaction. A failed enqueue leaves the mutation without an event. This matches the existing messaging pattern but does not meet the plan’s stronger claim.
- **MEDIUM — replay protection is receiver-side only.** The sender includes a timestamp, but nothing in ClinicQ enforces a 300s window. The threat table overstates the mitigation.
- **MEDIUM — test ping event may be filtered out.** `testPingWebhook` enqueues a ping, but subscriptions filter by `event_types`; ensure ping bypasses the filter or is explicitly supported.
- **MEDIUM — no secret rotation or delivery-log retention.**
- **LOW — payload PII minimization.** Webhook payloads may include patient name/phone; define a minimal payload and document purpose limitation.

### Suggestions
- Add webhook trigger calls inside the existing domain service functions, not only in API routes, so in-app and API actions both fire events.
- Enumerate the full queue/subscription schema in migration `000018`, with `payload TEXT`.
- Add URL validation: require `https`, resolve DNS and block private/link-local ranges, or use an allowlist.
- Restrict webhook secret access to owner/admin and consider encrypting `signing_secret`.
- Use `after()` or cron-only dispatch; do not rely on unawaited promises.
- Audit key/webhook create/revoke events.
- Build a proper settings tab shell or use a separate `/settings/developer` route.

### Risk Assessment
**HIGH.** The delivery engine is well-designed, but it is not wired to any events, and the SSRF/secret-exposure gaps are serious.

---

## 06-04

### Summary
The DPDP direction is thoughtful: dual-format export, NMC retention reconciliation, append-only consent, and optional statutory fields are the right shape. The implementation, however, depends on `is_deleted`/`status` columns that are not added, does not update existing search/booking queries, and will lose its compliance audit metadata because of the audit whitelist. The global consent toggle also creates a purpose-limitation concern.

### Strengths
- Correctly reconciles DPDP erasure with NMC 3-year retention by choosing soft-delete over hard delete.
- Dual-format export (JSON + PDF) is a strong interpretation of Right to Access.
- Reuses the existing `@react-pdf/renderer` pipeline (`features/prescriptions/pdf/generator.ts`) and append-only `consent_records`.
- Statutory fields are optional, which supports easy onboarding.
- Prescription PDF already has a clinic header where statutory numbers can be added (`features/prescriptions/pdf/prescription-document.tsx:391-410`).

### Concerns
- **HIGH — erasure columns are missing.** Plan 06-01 adds only `erased_at`/`erasure_reason`; this plan sets `status='erased'` and `is_deleted=true`. Neither `status` nor `is_deleted` exists (`000003...:8-22`; `000014...:129-134`). The erasure and search queries fail.
- **HIGH — existing queries are not updated to hide erased patients.** `searchPatients` (`features/patients/actions.ts:232-260`) and `getPatient` (`:169-175`) do not filter `is_deleted`. Appointment booking drawers, queue, and waitlist queries also do not. `06-04` `files_modified` does not include those files, so the acceptance test “erased patient does not appear in standard patient search” will fail.
- **HIGH — compliance audit metadata is stripped.** `recordAudit` filters metadata through `ALLOWED_METADATA_KEYS` (`lib/audit/audit.ts:80-141`). `retention_policy`, `erased_at`, and `status` are not allowed, so the NMC justification is dropped. The `AuditAction` union also lacks `dpdp.*`, so `action: "dpdp.patient_erasure"` and `"dpdp.data_export"` will not typecheck.
- **HIGH — `erasePatientRecord` auth conflicts with the API route.** The plan says `erasePatientRecord` requires `patients:edit` via `requirePermission` (cookie session), but `DELETE /api/v1/patients/[id]` is Bearer-authenticated with no cookie session. The route cannot call it successfully unless the function accepts the API-key session and skips `requirePermission`.
- **HIGH — export route auth is ambiguous.** Task 1 says “Validate session (via Bearer token or cookie session).” This creates two auth paths with different permission semantics. Define one per route and enforce tenant isolation/permission consistently.
- **MEDIUM — global consent toggle weakens purpose limitation.** The existing model records `treatment` and `data_sharing` separately (`features/patients/consent.ts:8`; `app/(dashboard)/patients/[id]/consent-section.tsx:26-70`), and the patient page reads both (`app/(dashboard)/patients/[id]/page.tsx:20-21`). Replacing them with a single `global` consent loses purpose-specific consent, which DPDP purpose limitation expects. A global summary toggle can coexist with purpose-specific records.
- **MEDIUM — statutory fields are not wired into persistence.** `files_modified` includes `components/settings/statutory-fields-card.tsx` but not `features/settings/schema.ts`, `features/settings/actions.ts`, `components/settings/clinic-profile-form.tsx`, or the settings page. The card cannot save or mount without those changes. The prescription PDF payload type also lacks the new fields, and the payload builder (`features/prescriptions/pdf/generator.ts`) is not listed.
- **MEDIUM — erasure only hides, does not anonymize.** DPDP erasure implies removing personal data; retaining full name/phone/address in a hidden row may not satisfy the right. Consider anonymizing contact/demographic fields while retaining clinical content.
- **MEDIUM — uploaded documents are not addressed.** `patient_documents` and storage files may contain PII; the erasure workflow should define retention/redaction for them.
- **MEDIUM — export omits billing data.** DPDP access should include invoices/payments (`supabase/migrations/000009_billing_invoicing_payments.sql`) because they contain personal data. The plan lists demographics, visits, prescriptions, vitals, labs, and consent only.
- **MEDIUM — statutory field changes are not audited.** AGENTS.md §10 requires audit for administrative configuration changes.
- **LOW — `vitals` source.** Vitals are JSONB on `visits` (`000007...:8`); the export should read them from there rather than assuming a separate table.
- **LOW — PDF memory.** `toBuffer()` for large histories can be memory-heavy; stream where possible.

### Suggestions
- Add `is_deleted`, `status`, `erased_at`, `erasure_reason` in `000018`, and update every patient search/booking/queue query to filter `is_deleted=false`.
- Extend `recordAudit` with API-key actor support and allow the DPDP metadata keys, or create a dedicated compliance audit path.
- Make `erasePatientRecord` accept an explicit actor/session and avoid `requirePermission` for the API-key path.
- Keep purpose-specific consent rows and add a global summary toggle on top.
- Add the settings schema/action/form and prescription payload builder to `files_modified`.
- Include billing records in the DPDP export.
- Define document/attachment handling for erasure.

### Risk Assessment
**HIGH.** The compliance intent is right, but the schema and query changes are incomplete, and the audit trail will not record the justification the plan claims.

---

## 06-05

### Summary
The security hardening and health/OpenAPI deliverables are sensible, and permanently disabling the dev logger is a genuine launch blocker. However, this plan does not address two phase success criteria at all — performance and backup/restore — and the dev-logger scope is narrower than the stated “invite link exposure” requirement. The health/readiness probes also have some operational sharp edges.

### Strengths
- Permanently blocking `logDevAuthEvent` in production is correct; the current gate still permits logging when `ENABLE_DEV_AUTH_LOGS=true` (`lib/auth/dev-logger.ts:20-25`), so hardening is warranted.
- `/api/health` and `/api/ready` are the right split for liveness vs readiness.
- OpenAPI + interactive docs are valuable for the external API.
- Avoiding the `[SUS]` Scalar npm package and using a CDN/HTML route is a reasonable supply-chain decision.
- Full-suite `npm test` gate is appropriate.

### Concerns
- **HIGH — phase success criterion 3 (performance) is unaddressed.** No task measures or improves the 1–2s core-action target. The research validation map listed `tests/api/v1-performance.spec.ts`, but no plan creates it. The plan claims REQ-nfr-performance in 06-01/02 without any performance work or test.
- **HIGH — phase success criterion 4 (backups/restore) is unaddressed.** “Backups/restore tested” appears in the roadmap criterion, but no task covers it.
- **HIGH — phase success criterion 2 (usage logs visible per tenant) is unaddressed.** Cross-plan gap: no usage-counter table and no UI.
- **MEDIUM — dev-logger scope is incomplete.** `features/staff/actions.ts:18,66-81` returns `rawToken`/`inviteLink` and calls `logDevAuthEvent`; the plan does not modify this file. `features/auth/dev-actions.ts:81-82` still honors `ENABLE_DEV_AUTH_LOGS`, so production can expose OTPs if that env var is set. Remove the escape hatch entirely and audit the staff invite path.
- **MEDIUM — readiness probe leaks internal errors.** Returning `error: err.message` on 503 (`06-05` Task 2) violates AGENTS.md §34 (“do not expose sensitive dependency details publicly”). Log details server-side and return a generic status.
- **MEDIUM — readiness treats queue backlog as failure.** A pending webhook backlog does not mean the app cannot serve traffic; returning 503 could cause unnecessary restarts/alerts. Check connectivity/health, not backlog volume.
- **MEDIUM — storage check ignores the active provider.** The app supports R2 via `STORAGE_PROVIDER`/R2 env (`lib/storage/index.ts:60-80`), but `/api/ready` only checks Supabase `clinic-records`. It can report ready when the active storage backend is down.
- **MEDIUM — middleware overhead on health/API routes.** `middleware.ts:52-63` matches `/api/health`, `/api/ready`, and `/api/v1/*`, causing a Supabase cookie refresh on every probe/API call. Exclude these paths from the matcher or skip auth refresh for Bearer/health routes.
- **MEDIUM — OpenAPI spec will drift.** A hand-written spec in `lib/api/openapi-spec.ts` is not derived from the Zod schemas or route handlers. It will diverge quickly. Reuse schemas or generate from a typed source.
- **MEDIUM — Scalar CDN is unpinned and lacks SRI.** `https://cdn.jsdelivr.net/npm/@scalar/api-reference` without a version or integrity hash is a supply-chain/breakage risk.
- **MEDIUM — dev-logger test practicality.** Setting `process.env.NODE_ENV='production'` at runtime works for the current logger (reads at call time), but `requestOtpAction` calls live Supabase admin/`signInWithOtp` (`features/auth/dev-actions.ts:40-60`). The test needs mocks for `createClient`/`createAdminClient` and `fs`, or it will make network calls and be flaky.
- **LOW — OpenAPI type import.** `OpenAPIObject` is not from an existing dependency; use a local type or `Record<string, unknown>` to avoid typecheck failure.
- **LOW — no external uptime monitor configuration.** Endpoints alone do not satisfy “monitoring supports 99.5%+”; document the monitor/cron setup.
- **LOW — docs offline.** CDN-based docs fail without internet; acceptable but worth noting.

### Suggestions
- Add a performance task: seed realistic data, measure the three core actions, add missing indexes, and create `tests/api/v1-performance.spec.ts` (or an in-app timing test).
- Add a backup/restore verification task (document the procedure and test a restore in a staging project).
- Add the usage-counter table and per-tenant usage UI, or explicitly descope criterion 2 with user sign-off.
- Remove `ENABLE_DEV_AUTH_LOGS` from production paths and audit `features/staff/actions.ts`.
- Return generic readiness errors and check the active storage provider.
- Exclude health/API routes from middleware.
- Pin the Scalar CDN version and add SRI, or vendor the viewer.

### Risk Assessment
**MEDIUM-HIGH.** The security/ops deliverables are useful, but the plan does not satisfy two explicit phase success criteria and leaves the dev-logger and readiness surfaces partially hardened.

---

## Cross-Plan Comparison & Overall Risk

### Dominant cross-plan risks

1. **Schema fiction is the biggest risk.** Across 06-01, 06-02, and 06-04, the plans reference tables/columns that do not exist:
   - `public.appointments`, `scheduled_start`, `scheduled_end`, `appointment_type` → actual unified `visits` (`000006...:11-31`).
   - `visit_type`, `chief_complaint` → actual `origin_type`, `reason_for_visit`, `chief_complaints` (`000006...:14-18`; `000007...:8-18`).
   - `frequency`, `instructions`, `prescription_items.tenant_id` → actual `timing`, `special_instructions`, no `tenant_id` (`000007...:80-96`).
   - `test_name`, `file_url` on `patient_documents` → actual `title`, `storage_path`, `original_filename`, etc. (`000013...:84-103`).
   - `referred_to_doctor_name`, `specialty`, `reason` → actual `referred_to_name`, `referred_to_specialty`, `reason_for_referral` (`000013...:157-172`).
   - `patients.is_deleted`, `patients.status` → do not exist (`000003...:8-22`; `000014...:129-134`).
   
   Any plan that does not reconcile these before execution will fail its own tests.

2. **The audit/actor model needs a dedicated design.** D-08’s `actor_type: 'api_key'` + `api_key_id` cannot be represented in `audit_logs` (`000003...:25-35`), and `recordAudit` is cookie-session-bound (`lib/audit/audit.ts:143-165`; `lib/auth/tenant.ts:30-45`). This affects 06-01, 06-02, 06-03, and 06-04. It should be resolved once, in 06-01, with schema + helper changes.

3. **Webhook triggers are missing.** 06-03 builds the engine but never wires it to `features/appointments`, `features/consultation`, `features/prescriptions`, or `features/labs` (`06-PATTERNS.md:786`). Phase success criterion 2 cannot pass.

4. **RLS is claimed but bypassed.** Every API route uses `getAdminClient()` (`lib/supabase/admin.ts:12-28`), which bypasses RLS. Tenant isolation is manual `.eq("tenant_id", ...)`. The plans should either use a tenant-scoped RLS client or centralize tenant filtering and test every endpoint for cross-tenant leakage. The `api_keys`/`webhook_subscriptions` RLS also needs role restriction, not just tenant membership (`06-PATTERNS.md:96-110`).

5. **API routes reimplement domain logic.** 06-01/02 write directly to tables instead of reusing `features/appointments/actions.ts`, `features/visits/actions.ts`, `features/prescriptions/actions.ts`, `features/labs/actions.ts`, and `features/referrals/actions.ts`. This loses slot-conflict checks, clinical safety checks, notifications, PDF generation, and consent enforcement. It also makes webhook integration harder.

6. **Requirement coverage gaps.** The roadmap success criteria are not fully covered:
   - Performance (<1–2s) — no task or test.
   - Backups/restore tested — no task.
   - Per-key usage logs visible per tenant — no table/UI.
   - “Role scope matching in-app roles” — D-02 deliberately chooses all-or-nothing admin keys; this conflicts with criterion 1 and should be explicitly acknowledged with the user.

7. **Security hardening gaps.** SSRF via webhook URLs, signing-secret exposure via RLS, DB error message leakage, and API-key privilege escalation via permissive RLS are the highest-impact issues. The crypto primitives are fine; the orchestration around them needs work.

8. **Test infrastructure assumptions.** The new tests are integration-style against a live Supabase project (existing helpers `tests/helpers/tenants.ts`, `.env` loading in `vitest.config.ts`). The plans’ verify commands only run Vitest; they do not mention applying migration `000018` to the test database. Without that, every API test fails before it starts.

### Overall risk assessment
**HIGH.** The plans have strong architectural intent and good cryptographic choices, but they are not grounded in the current schema, they miss the webhook integration and several phase success criteria, and they contain avoidable security gaps. I would not execute them as-is. The minimum viable fix is a schema-reconciliation pass across 06-01/02/04, an explicit audit-actor design, webhook trigger call sites, SSRF/secret-exposure hardening, and adding tasks for performance, usage logs, and backup/restore.

---

## Consensus Summary

Cross-AI review conducted with OpenCode running deepseek-v4.1-flash-free with full source-grounded repository access.

### Agreed Strengths
- **Cryptographic Foundations**: Correct `clq_live_` prefix design, CSPRNG randomness, SHA-256 storage, and constant-time `crypto.timingSafeEqual` comparison.
- **Webhook Delivery Architecture**: Stripe-compatible HMAC-SHA256 signature scheme (`t=...,v1=...`), transactional outbox table, exponential backoff, and bearer-authenticated cron recovery matching existing messaging patterns.
- **DPDP Act Rights Strategy**: Thoughtful reconciliation between DPDP erasure and NMC 3-year statutory medical records retention via soft deletion; dual-format export (JSON + PDF); append-only consent trail.
- **Production Hardening**: Permanent removal/lockdown of dev auth logger in production environments; separation of liveness (`/api/health`) and readiness (`/api/ready`) probes; zero external dependencies for OpenAPI documentation.

### Agreed Concerns
- **Schema Grounding & Table Mismatches (HIGH)**:
  1. No `public.appointments` table exists; scheduling is unified under `public.visits` with `origin_type IN ('scheduled', 'walk_in')`, `reason_for_visit`, and JSONB `chief_complaints`.
  2. `patients` lacks `is_deleted` and `status` columns; migration `000018` must define them alongside `erased_at` and `erasure_reason`.
  3. `prescription_items` uses `timing` and `special_instructions` (not `frequency` / `instructions`) and has no `tenant_id` column.
  4. `referrals` uses `referred_to_name`, `referred_to_specialty`, and `reason_for_referral`.
  5. `patient_documents` requires standard document metadata (`title`, `storage_path`, `file_size_bytes`, `mime_type`, `uploaded_by`).
- **Actor Model & Audit Integrity (HIGH)**:
  1. `audit_logs` has no `actor_type` or `api_key_id` columns, and `recordAudit` requires a Supabase cookie session which external API callers lack.
  2. `patients.created_by` and `visits.created_by` enforce foreign keys to `auth.users(id)`; inserting API key UUIDs directly violates database constraints.
  3. `filterMetadata` in `lib/audit/audit.ts` strips non-whitelisted keys (`retention_policy`, `erased_at`, `status`, `format`), discarding required DPDP audit evidence.
- **Webhook Trigger Integration (HIGH)**:
  The webhook delivery engine is built in Plan 06-03, but domain actions in `features/appointments/actions.ts`, `features/consultation/actions.ts`, `features/prescriptions/actions.ts`, and `features/labs/actions.ts` must be modified to call `enqueueWebhookEvent` so that events fire on real clinic activity.
- **Security & Authorization Boundaries (HIGH)**:
  1. API key and webhook tables require role-restricted RLS (`clinic:manage` / `owner` or `admin`) to prevent staff privilege escalation.
  2. Webhook delivery requires SSRF protections (blocking localhost, private subnets, and AWS/GCP/Azure link-local metadata `169.254.169.254`).
  3. Route handlers must catch database errors and return sanitized client error messages rather than raw database exceptions.
- **Roadmap Success Criteria Coverage (MEDIUM-HIGH)**:
  1. Success Criterion 3 (performance <1–2s core actions) requires dedicated index optimization and a benchmark test.
  2. Success Criterion 4 (backup/restore tested) requires operational documentation and recovery testing.
  3. Success Criterion 2 (per-key usage logs visible per tenant) requires a tracking mechanism and UI representation.

### Divergent Views
- None (single external reviewer lane invoked).
