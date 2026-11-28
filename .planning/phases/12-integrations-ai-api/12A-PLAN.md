---
phase: "12A"
roadmap_id: V2-12 (part a)
name: Integrations and API (messaging, reminders, zod 4, rate limiting, API v1)
revision: "2026-11-28, first revision (CTO delegate; PO deadline: all phases except go-live done by 6 Dec 2026)"
gate: "G4 (light, per PR). One isolated reviewer (Sonnet) over the whole diff. One adversarial security reviewer (Opus) over migrations 000160-000164, the API v1 routes and RPCs, the rate limiter, messaging governance and consent, the reminder producer, webhook secret handling and every file in 'Security-sensitive files'. One fix round (12A-06a). The PO approves the gate, or Claude approves it by delegation and records the CI run."
requirements: ["P1-13 messaging governance at enqueue and send", "P1-14 appointment reminders only (PO-8)", "P1-19 zod 4 + Dependabot + 0 high/critical audit (AI SDK part moves to 12B with the gateway, AI-04)", "P1-26 Postgres rate limiting", "P1-37 API v1 hardening (P1 again: PO-16 update of 2026-11-15, third-party voice bot)", "P2-09 webhook secret masking", "P1-12 consent v2 data model and enforcement (part; the rights UI is V2-13)", "P1-10 residue: inbound routing, template variable shape (04 L-B), phone in the DLR notification (04 hand-off)", "Hand-offs: AR-09C-01 v1 Rx writer, AR-09C-02 / 09B S-5 / 06 B L-2 / 05b IND L-1 route and invite rate limits, 09A S-6, 04 IND L1 webhook A-B-A suppression, 08 R-9 v1 slot rule"]
plans: ["12A-01", "12A-02", "12A-03", "12A-04", "12A-05", "12A-06a", "close"]
order: "12A-01 -> 12A-02 -> 12A-03 -> 12A-04 -> 12A-05 -> reviews -> 12A-06a -> close (sequential; one local stack; one executor at a time). 12B starts from the 12A merge."
preconditions: "feature/v2 at or after c609907a (V2-09e merged). V2-10 and V2-11 may run in parallel on their own branches and migration ranges: rebase onto feature/v2 before each plan and before the PR."
migrations: {"12A-02": "000160_rate_limits_idempotency", "12A-03": "000161_messaging_governance_consent", "12A-04": "000162_appointment_reminders", "12A-05": "000163_api_v1_principal", "12A-06a": "000164_review_fixes_12a (only if a fix needs SQL)"}
migrations_note: "Reserved range 000160-000169 is shared with 12B (12B takes 000165-000169). Run `ls supabase/migrations | tail -3` at the start of each plan; never take a number outside the range; record any shift in 12A-NOTES.md. Every migration commit also bumps app/api/ready/expected-migration.ts, the schema snapshot, types/database.ts (npm run db:types), scripts/ci/assert-pgtap-report.mjs (REQUIRED_FILES and FLOOR with the arithmetic) and scripts/ci/assert-vitest-report.mjs."
new_dependencies: {"zod": "major upgrade 3.25.x -> exact pin of the latest 4.x at install (P1-19; native z.toJSONSchema replaces the hand-written OpenAPI, so no OpenAPI generator dependency is added)"}
removed_dependencies: ["none in 12A (the unused AI SDK packages are replaced in 12B-01)"]
branch: "v2/phase-12a-integrations-api -> PR into feature/v2"
source: "docs/v2/V2_MASTER_ROADMAP.md §10 (P1-10, P1-12, P1-13, P1-14, P1-19, P1-26, P1-37, P2-09), §12 V2-12; docs/v2/VERIFICATION_LOG.md (PO-16 update 2026-11-15, lean process 2026-11-15, V2-07/V2-08 rulings); docs/v2/ARCHITECTURE_DECISIONS.md ADR-005, ADR-008, ADR-009, ADR-010, ADR-011, ADR-016; docs/adr/0005; docs/v2/TARGET_ARCHITECTURE.md §3.5, §3.6, §8; docs/v2/DATA_HANDLING.md §4, §5, §6; docs/v2/SUBSCRIPTIONS_AND_PLANS.md SUB-D2; 04/05b/08/09A/09B/09C summaries and triage hand-offs; 09E-PLAN.md shared rules"
must_haves:
  truths:
    - "One governance rule, in SQL, decides every patient message at enqueue and again at send: opt-out, purpose consent, quiet hours in the clinic's time zone, monthly fair-use quota, clinic access level and restriction; a blocked message is never handed to a provider, a deferred one is sent at the computed time."
    - "An automated appointment reminder is sent only to a patient with a granted `appointment_communications` consent, only for an appointment that is still booked at the same time, at most once per window per appointment time."
    - "Every limited route and action is limited by a Postgres counter that two app instances share; over the limit returns 429 with Retry-After and a fixed body."
    - "API v1 runs without the service-role client: each request is one anon-granted SECURITY DEFINER RPC that authenticates the key hash, checks scope and clinic access, rate-limits, replays idempotent requests and does the work; a key holds only the scopes it was given and an appointments key can never read or write clinical data."
    - "OpenAPI 3.1 is generated from the zod 4 contracts; CI fails when the committed spec differs from the generated one or when a change is breaking against the 12A baseline."
    - "A webhook signing secret is shown once at creation or rotation and never returned by a list."
  artifacts:
    - "supabase/migrations/000160..000163; supabase/tests/database/{rate_limits,idempotency,message_governance,consent_v2,appointment_reminders,api_v1}.test.sql"
    - "lib/rate-limit/{limit.ts,policies.ts}, lib/api/{with-api.ts,principal.ts,errors.ts}, lib/api/contracts/*.ts, scripts/api/{gen-openapi.mjs,openapi-breaking.mjs}, app/api/v1/openapi.json (generated), app/api/v1/{slots,appointments,patients/lookup}/**"
    - "lib/jobs/internal/handlers/reminder-scan.ts, features/patients/consent-*.ts (v2), components for the consent checkbox and the developer settings (keys with scopes, masked secrets, rotate)"
    - ".github/dependabot.yml"
  key_links:
    - "private.message_governance(tenant, patient, purpose, message_type, channel, at) is called by private.enqueue_message_internal and by the message.send handler's claim path (communication_queue_claim re-check); lib/messaging/governance.ts is deleted (no TypeScript twin)."
    - "public.rate_limit_hit(bucket, key, window_s, limit) is the only limiter; lib/api/rate-limiter.ts (in-memory Map) is deleted."
    - "public.api_v1_* RPCs call private.api_principal(p_key_hash, p_scope) first; route handlers call only these RPCs through the anon client; getSystemDb('api_v1') and its ADR-0005 register row are removed."
---

# V2-12a Integrations and API: plan

## Goal

Patient messages are lawful and predictable, appointment reminders go out (PO-8), every public surface is rate-limited by a
shared counter, and a third-party voice bot can book, reschedule and cancel appointments through a least-privilege API
without ever seeing clinical data (PO-16 update). The validation library moves to zod 4 so the API contract can be generated.

## Current state (inventory 2026-11-28, tree at c609907a)

- Messaging: `communication_queue`, `ops.message_templates` allow-list (no `appointment_reminder` row), `private.enqueue_message_internal`
  (000041, redefined 000061/000090), `message.send` job (000035 trigger, dedupe `msg:<id>`), MSG91 provider, delivery webhook with
  `x-webhook-secret` and exactly-once claim (000037). `lib/messaging/governance.ts` exists (IST quiet hours, opt-out) but is wired nowhere;
  `tenant_messaging_config` has quiet hours, `monthly_quota` 200, `auto_reminder_hours` 24. Only `features/prescriptions/service.ts:516`
  checks `whatsapp_opt_out`. `consent_records` (000003) is append-only, status granted/withdrawn, purposes global/treatment/data_sharing.
- Reminders: no producer exists.
- Rate limiting: `lib/api/rate-limiter.ts` is an in-memory Map (120/60 s); search, medicine and terminology routes say "rate limit is V2-12".
- API v1: `lib/api/auth.ts` authenticates with `getSystemDb("api_v1")` (service role in a request path), non-atomic usage counter; no
  scopes in use beyond `exports:create`; `lib/api/openapi-spec.ts` is hand-written (902 lines); `apiV1Enabled()` is never on in production.
  Clinical writers (prescriptions, lab orders, referrals, visits, patient DELETE as erasure) exist; AR-09C-01 (Rx without allergy check)
  and 09A S-6 (several active Rx headers) are accepted risks owned by V2-12.
- Webhooks: `listWebhookSubscriptions` returns `signingSecret` on every list (`features/webhooks/service.ts:53-72`).
- Dependencies: zod 3.25.76; `next` 16.4.6 and `@supabase/ssr` 0.12.7 are already current (the P1-19 row's "from 0.5.2" is stale: doc
  erratum); no `.github/dependabot.yml`; `.github/audit-allowlist.json` exists.

## Decisions (CTO delegate; one line each)

- D-1 **Split.** V2-12 runs as 12A (this file) and 12B (AI, `12B-PLAN.md`), as roadmap §12 allows. The AI SDK major moves to 12B-01
  with the gateway (AI-04 says "done together with P1-19"); zod 4 stays here because the OpenAPI generation needs it.
- D-2 **zod first.** 12A-01 upgrades zod before any new contract is written, so new code is born on zod 4 and no second migration pass is
  needed.
- D-3 **One governance rule in SQL.** Enqueue and send share `private.message_governance`; the TypeScript `governance.ts` is deleted
  rather than kept as a twin, because two copies of a legal rule drift.
- D-4 **Consent v2 data model lands here, the rights UI in V2-13.** Governance cannot enforce "consent" without purposes; roadmap V2-13's
  "consent v2" keeps withdrawal history UI, guardian capture and rights requests.
- D-5 **WhatsApp reminders need a positive opt-in.** Purpose `appointment_communications`, captured as a staff-attested checkbox at
  registration, booking and on the patient record (default unticked); WhatsApp Business policy and DATA_HANDLING §6 both require opt-in.
- D-6 **Quiet hours apply to automated messages only.** Staff-initiated sends while the patient is present (booking confirmation,
  Rx/receipt link the doctor ticks) are immediate; opt-out, consent where required, quota and access still apply.
- D-7 **Reminder windows.** Default `{24 h, 2 h}` before the appointment (PO-8), clinic-configurable as up to two windows between 1 and
  48 h; a window due inside quiet hours is moved to the end of quiet hours, and dropped if that is later than the next window or less
  than 30 min before the appointment.
- D-8 **Fair-use quota** stays `tenant_messaging_config.monthly_quota` (SUB-D2); at the quota, automated reminders stop and staff sends
  still go (the patient is in front of the staff); the owner sees a banner. Quota numbers are set by SQL until V2-13c.
- D-9 **API v1 is narrowed to the voice-bot surface.** Kept and hardened: slots, appointments (list own, book, reschedule, cancel),
  patient lookup by mobile, and the appointment change webhooks. Removed from `/api/v1`: prescriptions, lab orders, referrals, visits
  writers, patient export and patient DELETE (erasure moves to the V2-13 staff workflow). See CTO decision C-2.
- D-10 **No service role in API v1.** Each endpoint is one anon-granted SECURITY DEFINER RPC taking the SHA-256 of the key (ADR-011's
  "explicit per-endpoint RPC" option); auth, scope, access level, rate limit, idempotency and work run in one round trip.
- D-11 **Scopes:** `slots:read`, `appointments:read`, `appointments:write`, `patients:lookup`, `webhooks:manage`. A key with any of the
  first four is an "appointments key" and is refused every other resource. Keys expire (default 365 days, max 730) and die with the
  creator's membership unless ownership was transferred.
- D-12 **Lookup DTO** returns patient id, first name and last initial, and year of birth only; never full name, address or clinical data.
- D-13 **Idempotency-Key** is required on every API POST/PATCH; kept 24 h; same key + different body returns 422 `IDEMPOTENCY_MISMATCH`.
- D-14 **Rate-limit policies** (per minute unless stated): API key 120 and tenant 600; AI per user 10 and per tenant 60 (consumed by
  12B); patient/medicine/terminology search per user 120; public token routes (`/r`, `/reschedule`, `/reports`) per IP 30; invite send per
  tenant 20/hour; session-status and palette actions per user 60. Windows are fixed buckets (atomic upsert), purged after 1 day.
- D-15 **SES/email bounce webhook** (04 hand-off) moves to V2-13b, which owns billing email notices; it depends on CTO decision C-1.
- D-16 **Webhook secret**: shown once at create and at rotate; list and detail show `whsec_…last4`; rotation keeps the old secret valid
  for 24 h (dual signature header) so a receiver can switch.

## CTO decisions needed (conflicts with approved docs; recommendation first)

- **C-1 Email provider vs sub-processor register.** Code and PO-ACTIONS 2.2 send auth email through **Resend**; DATA_HANDLING §4, the
  roadmap and SUB list **Amazon SES `ap-south-1`**. Resend processes outside India and is not in PO-23(h). **Recommend:** production uses
  SES `ap-south-1` behind the existing email provider interface (add an SES adapter in V2-13b with the bounce webhook); Resend stays for
  staging only. Alternative: accept Resend in PO-23(h) and update the register.
- **C-2 Removing clinical `/api/v1` endpoints.** Roadmap acceptance says "API v1 contract tests are backward compatible". There are no
  consumers (PO-16) and `/api/v1` has never been on in production, while the clinical writers carry accepted risks AR-09C-01 and S-6.
  **Recommend:** remove them now; "backward compatible" is enforced from the 12A baseline onward by the breaking-change check.
- **C-3 API v1 in production.** `apiV1Enabled()` is hard-off in production and the proxy blocks the path. **Recommend:** env
  `API_V1_ENABLED` (default false) allowed in production, plus a per-clinic switch on the developer settings page (owner only, full-access
  clinics only).

## Shared rules for every plan

The 09E shared rules apply unchanged (`.planning/phases/09E-caching-speed/09E-PLAN.md` "Shared rules for every plan"): INVOKER STABLE
reads with `search_path=''` and tenant from the session; commands SECURITY DEFINER with the V2-07 guard block (actor rule, active
clinic, `has_permission`, every row filtered by tenant, `lock_timeout 2s`, EXECUTE for the narrowest role), request-id replay via
`private.command_claim/complete` and, for edits of visits/invoices, `p_expected_version` with `ROW_CHANGED`; every write bumps its
clinic domain through the existing `private.clinic_bump` triggers (no new bump path); routes with session auth, permission, tenant
from the session, fixed error bodies, `private, no-store`; registries updated in the migration's commit (guard manifest, `npm run
inventory`, `grants.test.sql`, schema snapshot, `db:types`, `expected-migration.ts`, pgTAP and Vitest REQUIRED_FILES/FLOOR); each new
read or command gets a `command-latency.ts` entry; the latency lane (`npm run perf:latency`) must not raise any row's calls or depth
(ceilings block, ms report only). Tests assert real outcomes; one fails-without proof per High; e2e on desktop-chrome, pixel-7 and
iphone-15 with 0 retries where the device matters; axe clean at 360/820/1280 for new UI. Notes go to `12A-NOTES.md`; evidence is
produced by tools only.

External services: **no test or script calls MSG91, WhatsApp, Resend, SES or any outside host**. MSG91 is exercised only through MSW
contracts with recorded synthetic payloads (`tests/messaging/msg91-contract.spec.ts` pattern, `onUnhandledFrame: "error"`); the e2e
server uses `MESSAGING_PROVIDER=sink`. Never run `msg91:*`, `seed:cdci*`, `seed:diagnoses` or anything with `--env-file=.env`; never read
`.env*`. Fixtures use reserved synthetic phone ranges.

## Security-sensitive files (adversarial review scope)

`supabase/migrations/000160..000164`; `lib/rate-limit/**`; `lib/api/**`; `app/api/v1/**`; `app/api/webhooks/messaging/**`;
`lib/messaging/**`; `lib/jobs/internal/handlers/{message-send,reminder-scan,webhook-deliver}.ts`; `features/webhooks/**`;
`features/api-keys/**`; `features/patients/consent-*`; `proxy.ts`/middleware path rules for `/api/v1`; `lib/env.ts`
(`API_V1_ENABLED`); `docs/adr/0005*` register.

## Plans

### 12A-01 zod 4, Dependabot and a clean audit · M · no migration

Goal: P1-19 (zod part). The codebase compiles and behaves the same on zod 4; `npm audit --omit=dev` reports 0 high or critical.

Files: `package.json`, lockfile; every `import ... from "zod"` site (grep is authoritative); `lib/env.ts`; `.github/dependabot.yml` (npm
weekly, grouped minor/patch, majors one PR each; GitHub Actions monthly); `.github/audit-allowlist.json`.

1. Tracer: upgrade one leaf schema module and its tests on zod 4 in a scratch commit to confirm the breaking edges in this codebase
   (`error.errors` -> `.issues`, `z.record` arity, `.default()` with transforms, `message` -> `error` params, `z.string().email()` ->
   `z.email()` where used, `ZodError.flatten`). Record the list in 12A-NOTES.
2. Exact-pin the latest zod 4.x; fix every site mechanically (`npm run typecheck` drives it); no behaviour change: the error mapping in
   `lib/errors/*` keeps the same codes and field paths (snapshot of the mapped output for 10 representative invalid inputs before and after).
3. `npm audit --omit=dev`: fix or upgrade anything high/critical within the current majors; any residual needs an allowlist row with
   reason and expiry (none expected; the AI SDK packages are replaced in 12B-01 and may stay allow-listed until then with expiry 6 Dec).
4. Dependabot config.

Tests: Vitest for `lib/env.ts` (production refusals unchanged), the error-mapping snapshot, the existing action/route contract tests.
Run: `npm run typecheck`, `npx eslint .`, full `npx vitest run` once (stack up), `npm run e2e:build` and the PR lane once.
Done: zod 4 pinned, 0 high/critical (or an expiring allowlist row for the AI SDK only), Dependabot committed, no product change.

### 12A-02 Postgres rate limiter and idempotency keys · M · migration 000160_rate_limits_idempotency

Goal: P1-26, ADR-010. One shared limiter for every public or abusable surface; an idempotency store for API writes.

Files: `000160_rate_limits_idempotency.sql` (`private.rate_limit_buckets(bucket, key_hash, window_start, count, primary key (bucket,
key_hash, window_start))`, `public.rate_limit_hit(p_bucket text, p_key text, p_window_s int, p_limit int) returns (allowed, remaining,
reset_at)` SECURITY DEFINER, atomic `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING`, key stored as sha256 so no IP or
user id is kept in clear; `private.idempotency_keys(principal, key, request_hash, response jsonb, status, created_at)` with
`private.idempotency_claim/complete`; both purged by `ops.cleanup()` (buckets > 1 day, idempotency > 24 h)); `lib/rate-limit/{limit.ts,
policies.ts}` (policy table D-14, `enforce(policy, subject)` returning a `RATE_LIMITED` AppError with Retry-After); wiring into the
routes and actions named in D-14; delete `lib/api/rate-limiter.ts`; guard manifest rows gain a `rateLimit` field and the guard test fails
a route in the D-14 list that lacks it.

1. Tracer: `GET /api/patients/search` limited per user; the 121st call in a minute returns 429 with Retry-After and the fixed body.
2. Migration, then `lib/rate-limit`, then wire the D-14 list (API v1 is wired in 12A-05 inside its RPCs, not here).
3. Grants: `rate_limit_hit` EXECUTE for `authenticated` and `anon` (public token routes are anonymous); the bucket name is checked against
   a closed list in SQL so a caller cannot create arbitrary buckets; `p_limit`/`p_window_s` come from the closed list too (callers pass the
   policy name only). Tables: no grants to tenant roles.

Tests: pgTAP `rate_limits.test.sql` (closed bucket list, counts, window rollover, no tenant-role grants, key never stored in clear) and
`idempotency.test.sql`. Vitest DB "two instances": two independent Supabase clients fire 2 x 70 parallel hits at a limit of 100; exactly
100 allowed. **Fails-without (High: limiter bypass):** with the `ON CONFLICT` update replaced by read-then-write, the two-instance test
admits more than 100; recorded, restored. e2e: a public token route returns the fixed 429 page after 30 hits (desktop-chrome).
Run: affected Vitest (`tests/rate-limit tests/api tests/security`), pgTAP files, e2e `tests/e2e/security`.
Done: every D-14 surface limited; in-memory limiter deleted; guard manifest enforces it.

### 12A-03 Messaging governance and consent v2 · M-L · migration 000161_messaging_governance_consent

Goal: P1-13, P1-12 (data model), P1-10 residue. Every patient message passes one rule at enqueue and at send.

Files: `000161_messaging_governance_consent.sql`:
- `consent_records`: expand the purpose CHECK to `treatment`, `appointment_communications`, `document_sharing_via_link`,
  `referral_history_sharing`, `ai_assistance` (keep the old values readable; new writes use the new ones), add `notice_version`,
  `language`, `channel`, `evidence` (`staff_attestation | patient_reply | patient_portal`), `recorded_by` defaulted from `auth.uid()` in a
  BEFORE trigger (caller value ignored; SEC-01/SEC-06 closed); `public.record_consent(p_patient, p_purpose, p_status, p_notice_version,
  p_evidence, p_request_id)` command; `private.consent_state(tenant, patient, purpose)` (latest record wins).
- `tenant_messaging_config`: add `timezone` read from the clinic (ADR-016, no new column if the clinic already holds it),
  `reminder_windows_h int[] default '{24,2}'` with a CHECK (D-7), `reminders_enabled boolean default true`.
- `private.message_governance(p_tenant, p_patient, p_purpose, p_message_type, p_channel, p_at)` returns `(decision allow|defer|block,
  reason, send_at)`: access level full, patient not restricted/erased (reads the V2-13 hook `private.patient_is_restricted`, created here
  as a function returning `patients.status in ('restricted','erased')` so V2-13 can replace its body), `whatsapp_opt_out`, consent for
  purposes that need it (automated reminders: `appointment_communications`), quiet hours in the clinic zone for automated types, quota
  (D-8). `private.enqueue_message_internal` calls it (block -> no row, returns the reason; defer -> `run_at = send_at`);
  `communication_queue_claim` re-checks it and cancels with the reason (`ops.delivery_job_cancelled`) or defers.
- `ops.message_templates`: per-type variable shape rules (04 L-B): each parameter has a source (structured field, never member free
  text) and a max length; `message_params_ok` enforces them.
- Inbound "STOP"/"stop reminders" reply -> `record_consent(..., 'withdrawn', evidence 'patient_reply')` and `whatsapp_opt_out` for
  WhatsApp; routing only via `replyMsgId` (unchanged).
- The urgent DLR notification copy drops the phone number (04 hand-off).

App: delete `lib/messaging/governance.ts` and `tests/messaging/outbox-queue.spec.ts` cases that test it (replaced by pgTAP);
`features/patients/consent-service.ts` -> `record_consent`; a "WhatsApp appointment reminders (patient agreed)" checkbox in QuickRegister,
the booking sheet (only when not yet recorded) and the patient record; fixed copy for each block reason where staff see it (send dialog,
message log). If V2-11 has replaced the patient record page by then, attach to its component; otherwise to the current one.

1. Tracer: an Rx-link send for an opted-out patient is refused at enqueue with `OPTED_OUT` and no queue row; the same patient's row
   enqueued before the opt-out is cancelled at claim.
2. Migration, service, UI, specs.

Tests: pgTAP `message_governance.test.sql` (matrix: each reason x enqueue/send; quiet hours across midnight in Asia/Kolkata and one
non-IST zone; quota boundary; locked clinic; restricted patient) and `consent_v2.test.sql` (recorded_by forced, append-only, latest wins,
grants, cross-tenant refusal). **Fails-without (High: message to an opted-out patient):** with the claim-time re-check removed, a row
queued before the opt-out is handed to the sink provider; recorded, restored. MSW contract: MSG91 receives no body for blocked rows.
e2e (desktop-chrome, pixel-7): receptionist registers with the box ticked -> consent row with `staff_attestation`; the box unticked ->
no reminder consent.
Run: Vitest `tests/messaging tests/jobs tests/patients`, the pgTAP files, e2e `tests/e2e/journeys` (registration) and `tests/e2e/today`.
Done: governance in one place, enforced twice; consent purposes recorded with evidence; the TS rule deleted.

### 12A-04 Appointment reminders · M · migration 000162_appointment_reminders

Goal: P1-14 (PO-8). Booked appointments get reminders at the clinic's windows, at most one per window per appointment time.

Files: `000162_appointment_reminders.sql`: `public.appointment_reminders(tenant_id, visit_id, window_h, scheduled_at, due_at, status
queued|sent|skipped|cancelled, reason, queue_id, created_at, unique (visit_id, window_h, scheduled_at))` with RLS (read for members with
`appointments:view`, no tenant writes); `private.produce_appointment_reminders(p_now, p_limit)` SECURITY DEFINER: selects due windows for
visits in a booked state (`booked`, `confirmed`) whose `scheduled_at > p_now + 30 min`, applies D-7, inserts the reminder row and calls
`enqueue_message_internal` (`appointment_reminder`, purpose `appointment_communications`) in the same statement batch; `ON CONFLICT DO
NOTHING` makes a re-run harmless; job kind `reminder.scan` enqueued by pg_cron every 5 min with dedupe key `reminder-scan:<5-min
slot>` (idempotent; claim is the V2-04 `claim_jobs` SKIP LOCKED); send-time re-check in the `message.send` claim: the visit is still
booked and `scheduled_at` equals the reminder's, else `cancelled` (reschedule or cancel); `ops.message_templates` row for
`appointment_reminder` (params: patient first name, clinic name, local date, local time, doctor display name); the template name and
copy drop "ClinicQ"/"ClinicOS" strings (VERIFICATION_LOG line 829). `lib/jobs/internal/handlers/reminder-scan.ts` (calls the function in
batches of 200 until none or the 25 s budget). Settings: the reminder windows and switch on the clinic messaging settings (owner/admin).

1. Tracer: one booked visit tomorrow 10:00 IST with consent: at `TEST_NOW` = today 10:00 the scan queues exactly one 24 h reminder; a
   second scan queues nothing.
2. Migration, handler, settings field, specs.

Tests: pgTAP `appointment_reminders.test.sql`: windows, quiet-hours shift and drop (D-7), no consent -> `skipped` with reason, opted-out ->
skipped, reschedule -> old cancelled and a new row for the new time, cancel/no-show -> cancelled at send, locked clinic -> none, two
concurrent `produce_appointment_reminders` calls -> one row per window (**Fails-without (High: duplicate reminder):** without the unique
constraint the concurrent test makes two; recorded, restored). Vitest DB: the handler through the job runner with the sink provider,
time-travel via `TEST_NOW`. MSW contract: the MSG91 template body for `appointment_reminder` matches the recorded synthetic shape and
contains only the five parameters.
Run: Vitest `tests/jobs tests/messaging`, pgTAP file, e2e `tests/e2e/settings` (windows field).
Done: reminders produced and governed; PO action: MSG91 template approval before `MESSAGING_PROVIDER=msg91` anywhere.

### 12A-05 API v1 for the voice bot, generated OpenAPI, masked webhook secrets · L · migration 000163_api_v1_principal · split point after step 3

Goal: P1-37 (P1), P2-09, ADR-011 amended. A least-privilege appointments API with no service role in the request path.

Files: `000163_api_v1_principal.sql`: `api_keys` gains `scopes text[] not null`, `expires_at`, `revoked_at`, `principal_membership_id`
(the creating membership), `last4`; existing keys (local/staging only) get no scopes (they stop working; there are no consumers, PO-16);
`private.api_principal(p_key_hash, p_scope)` (hash match, not expired/revoked, membership active, clinic access full, `API_V1_ENABLED`
clinic switch on, scope held; rate limit through `rate_limit_hit` key + tenant; atomic `api_key_usage_daily` upsert; returns tenant,
key id, scopes); RPCs `api_v1_slots(p_key_hash, p_doctor, p_from, p_to)` (uses `private.available_slots_core`, the 08 R-9 rule: a NULL
schedule is "no slots", not "no restriction"), `api_v1_appointments_list`, `api_v1_book(p_key_hash, p_idem_key, p_request_hash, ...)`,
`api_v1_reschedule(..., p_expected_version)`, `api_v1_cancel(..., p_expected_version)`, `api_v1_patient_lookup(p_key_hash, p_mobile)`
(D-12) — each SECURITY DEFINER, EXECUTE for `anon` only, calling the same `private.step_*` bodies the V2-07/V2-08 booking commands use with
the key's principal as actor (audit `actor_kind='api_key'`, key id, no PHI in metadata), idempotency via `private.idempotency_*`
(D-13); membership removal revokes the creator's keys (trigger on membership status); webhook: `webhook_subscriptions.signing_secret` no
longer selectable by `authenticated` (column grant revoked); `public.webhook_secret_rotate` returns the new secret once; `last4` column;
the 04 IND L1 fix (the reschedule dedupe key includes the new `scheduled_at`, so A->B->A emits three events).
App: `lib/api/with-api.ts` (hash the bearer, call the RPC through the anon client, map fixed errors: 401 `INVALID_KEY`, 403
`SCOPE_DENIED`, 403 `CLINIC_LOCKED`, 409 `ROW_CHANGED`, 409 `SLOT_TAKEN`, 422 `IDEMPOTENCY_MISMATCH`, 429 `RATE_LIMITED`); routes
`app/api/v1/{slots,appointments,appointments/[id],patients/lookup}`; delete the removed routes (D-9), `lib/api/auth.ts`,
`lib/api/openapi-spec.ts`, `lib/api/patient-dto.ts` parts no longer used, `features/dpdp/erasure.ts` (no caller left; V2-13 replaces it);
contracts in `lib/api/contracts/*.ts` (zod 4); `scripts/api/gen-openapi.mjs` (z.toJSONSchema -> OpenAPI 3.1 JSON, committed as
`app/api/v1/openapi.json`), `scripts/api/openapi-breaking.mjs` (fails on a removed path/operation, a newly required request field, a
removed or retyped response field, against `app/api/v1/openapi.baseline.json` frozen at the end of this plan); CI step in the static job;
`lib/env.ts` `API_V1_ENABLED`; developer settings: create key with a scope picker (presets "Voice bot (appointments)" and "Custom"), show
the key once, list with last4/scopes/expiry/last used, revoke; webhook list masked, rotate action; ADR-0005 register row for `api_v1`
removed.

1. Tracer: `GET /api/v1/slots` with an appointments key returns slots from the RPC; the same key on `/api/v1/patients/lookup` without
   `patients:lookup` returns 403 `SCOPE_DENIED`; `getSystemDb("api_v1")` has no caller.
2. Migration and RPCs; `withApi`; the four resources.
3. Removal of the clinical routes and the hand-written spec; generated spec and breaking check. (split point)
4. Webhook secret masking and rotation; developer settings UI.

Tests: pgTAP `api_v1.test.sql` (every RPC: bad/expired/revoked key, removed membership, locked clinic, clinic switch off, scope matrix,
another clinic's visit id refused, idempotent replay returns the stored response, mismatch refused, `ROW_CHANGED`, audit row with key id,
grants anon-only, no clinical table readable); Vitest contract tests per endpoint against the local stack through the route handlers
(request/response validated against the generated OpenAPI); rate limit per key across two instances (reuses 12A-02 harness); webhook
list never contains a secret (type and runtime assertion). **Fails-without (High: clinical access by an appointments key):** with the
scope check removed from `api_principal`, the lookup returns rows for a key without `patients:lookup`; recorded, restored. e2e
(desktop-chrome, pixel-7): owner creates a voice-bot key, sees it once, the list shows last4 only; creates a webhook, sees the secret once,
list masked, rotate shows a new one once.
Run: Vitest `tests/api tests/webhooks tests/security`, pgTAP files, `node scripts/api/openapi-breaking.mjs`, e2e `tests/e2e/settings`.
Done: voice-bot surface live behind flags; clinical API gone; spec generated and guarded; secrets masked.

### 12A-06a Review fixes · S-M · migration 000164 only if needed

One isolated review (Sonnet) and one adversarial review (Opus, security-sensitive files above), fresh context, given the diff and this
plan's decisions only. Highs and Mediums fixed, each with a test that fails without the fix; Lows cheap and local or to the backlog with
an owner; Highs re-checked once.

### Close

1. `npm run stack:recycle`; `node scripts/phase-evidence.mjs .planning/phases/12-integrations-ai-api/evidence-12A 1`; push once; CI green
   with 0 retried tests; `--ci-run <id>`; copy `npm audit --omit=dev --json` summary and the OpenAPI diff (baseline vs previous hand-written
   spec, generated by the script) into evidence.
2. Docs (Haiku): `12A-SUMMARY.md`, `12A-VERIFICATION.md` (tool numbers only), ROADMAP status, VERIFICATION_LOG entry (CI link, SHA,
   decisions D-1..D-16 and C-1..C-3 outcomes), doc errata below, PO-ACTIONS entries.
3. Gate: PO approves or delegated approval with the CI run recorded.

## Threat register (STRIDE, short)

| Threat | Control | Proof |
|---|---|---|
| Spoofed API key / key from another clinic | hash match + membership + clinic switch + scope in one definer function | api_v1.test.sql |
| Voice-bot key reads clinical data (I) | appointments keys refused everything else; clinical routes removed | fails-without 12A-05 |
| Limiter bypass with parallel instances (D) | atomic upsert | fails-without 12A-02 |
| Message to opted-out / non-consented patient (I, legal) | governance at enqueue and claim | fails-without 12A-03 |
| Duplicate reminder (repudiation, cost) | unique (visit, window, time) + dedupe job key | fails-without 12A-04 |
| Member free text inside templates (I) | per-parameter source and length rules | message_governance.test.sql |
| Webhook secret disclosure (I) | column grant revoked, shown once | Vitest + e2e |
| Forged consent `recorded_by` (T) | BEFORE trigger forces auth.uid() | consent_v2.test.sql |

## Risks

- zod 4 behaviour drift in error messages shown to users: the mapped-output snapshot (12A-01 step 2) catches it.
- Reminder volume vs MSG91 cost: quota (D-8) and the per-clinic switch; PO sets quota by SQL.
- MSG91 template approval lead time: code ships with the sink provider; reminders start when the PO switches the provider.

## Doc amendments (applied at the close)

Roadmap P1-19 row (`@supabase/ssr` and Next already upgraded; AI SDK part done in 12B), P1-37 (narrowed surface, D-9), TARGET §3.5 (one
RPC per endpoint), ADR-011 (option chosen: per-endpoint RPCs, anon-granted, key hash), DATA_HANDLING §6 (purposes implemented, opt-in
evidence), ADR-0005 register (`api_v1` row removed).

## PO actions (external)

1. MSG91: register and get Meta approval for the `appointment_reminder` WhatsApp template (text drafted in `12A-NOTES.md`, five
   parameters), then tell Claude the template id; until then `MESSAGING_PROVIDER=sink` on staging.
2. MSG91 webhook: send the secret as the `x-webhook-secret` header (PO-ACTIONS §5, already listed).
3. Voice-bot vendor: DPA and India data-residency confirmation before any production key is issued (VERIFICATION_LOG 2026-11-15).
4. Decide C-1 (email provider), C-2, C-3 (or accept the recommendations).

## Hand-offs

- 12B: rate-limit policies `ai.user`, `ai.tenant` (D-14); zod 4 contracts; the AI SDK allowlist row expires when 12B-01 lands.
- V2-13: `private.patient_is_restricted` body; consent withdrawal history UI, guardian consent, rights requests; retention rules for
  `appointment_reminders`, `communication_queue`, `rate_limit_buckets`, `idempotency_keys`, `api_key_usage_daily`.
- V2-13b: email bounce/complaint webhook and SES adapter (D-15, C-1); WhatsApp billing notices reuse `message_governance` (purpose
  `billing_notices`, PO-23(i)).
- V2-11: if its patient page lands after 12A-03, it must keep the consent checkbox component.

## Out of scope

Vaccine reminders (v2.1, PO-8), SMS fallback, own voice receptionist (v2.1), OAuth for the API, per-branch API keys (v2.1 branches).
