---
phase: "13C"
roadmap_id: V2-13c
name: Platform admin & tenant data lifecycle
revision: "2026-11-28, first revision (CTO under the PO's delegation; deadline 6 Dec 2026)"
gate: "G4 (light) with an adversarial security review (security-sensitive: platform admin, MFA, irreversible purge, export of PHI, migrations, RLS, storage). One PR. One isolated reviewer (Sonnet), one adversarial reviewer (Opus), one fix round (13C-06a). The PO approves the gate, or Claude by delegation with the CI run recorded."
requirements: ["V2_MASTER_ROADMAP §12.2 V2-13c", "SUBSCRIPTIONS_AND_PLANS §6.3 (T9-T12), §6.4, §6.5, §6.6, §8.1, §9, §10.2, §14.3 management, §14.7 (SUB-06, SUB-07, SUB-09, SUB-COUPON-06)", "AUTH_REDESIGN §4.6 platform side (AUTH-08): mandatory TOTP with two factors, break-glass runbook", "PO-21 Plans & prices screen with billing model and availability switch", "Roadmap R10 (on-demand dump before archive and purge on Free), SUB-D3, SUB-D6, SUB-D7", "Deferred to V2-13c by earlier phases (see 'Inherited items')"]
plans: ["13C-01", "13C-02", "13C-03", "13C-04", "13C-05", "13C-06a", "close"]
order: "13C-01 -> 13C-02 -> 13C-03 -> 13C-04 -> 13C-05 -> reviews -> 13C-06a -> close (sequential, one local stack)"
preconditions: "V2-13b (both PRs) merged; V2-13 (retention/purge machinery, audit tamper evidence) merged; V2-11 (requireRecentAuth, owner TOTP) merged. If 13b-ii is not merged when 13C starts, 13C-05 runs last and the rest proceeds."
migrations: {"13C-01": "000190_platform_portal", "13C-02": "000191_platform_config_rpcs", "13C-03": "000192_tenant_export", "13C-04": "000193_tenant_archive_purge", "13C-05": "000194_platform_coupon_reads", "13C-06a": "000195_review_fixes_13c", "spare": "000196-000199"}
migrations_note: "Reserved 000190-000199; next free number inside the range if taken; registries bumped in each migration commit (09E shared rules)."
new_dependencies: "none. The export ZIP is written by an in-house streaming writer (lib/export/zip.ts: local file headers, data descriptors, deflate through node:zlib, CRC-32 through zlib.crc32 or a 256-entry table), verified in CI with `unzip -t`; no ZIP64 (parts capped at 2 GB, see D-6)."
branch: "v2/phase-13c-platform-admin-lifecycle -> PR into feature/v2"
---

# V2-13c Platform admin & tenant data lifecycle: plan

## Goal

The PO runs the business from `/platform` instead of the SQL editor: tenant list and detail, trial extension, comp,
entitlement overrides, reconcile now, the data-lifecycle queue with purge approval, Plans & prices (incl. billing model
and the availability switch), coupons and refunds. Every platform action requires a platform admin at aal2 (TOTP, two
factors enrolled), goes through a `platform.*` SECURITY DEFINER RPC with the actor rule, and writes `platform_audit_log`.
The portal never shows clinical data or export bundles. A clinic's data follows the agreed lifecycle: locked for 30 days,
then a logical archive (derived data deleted, export snapshot kept), then a purge at expiry + 180 days after dry-run
counts, an on-demand backup dump and the admin's approval, leaving only the statutory survivors and a deletion
certificate. The owner can download all clinic data in-app after re-authentication, through a 15-minute signed URL.

Tracer: 13C-01 first proves one row end to end: an aal2 platform admin opens `/platform`, sees one seeded tenant's
status from `platform.tenant_list()`, and the same call from an aal1 admin, a clinic owner and anon is refused with
`PLATFORM_ADMIN_REQUIRED`, asserted in pgTAP and e2e.

## Current state (feature/v2 at c609907a, plus V2-13b as planned)

| Area | Today | Gap | Plan |
|---|---|---|---|
| Admin identity | `platform_admins`, `platform_audit_log` (append-only), `public.is_platform_admin()` (row + `aal2`), `private.platform_actor` (R-38), 5 `platform.*` RPCs (000085); bootstrap by SQL (`docs/runbooks/subscriptions-sql.md`) | Portal, MFA enrolment, two-factor rule, break-glass runbook | 01 |
| Config | `platform.create_plan_price`, `set_product_availability`, `extend_trial`, `set_comp`, `grant_override`; `platform_settings` single row | Settings and plan-entitlement RPCs, override revoke, reconcile now | 02 |
| Export | Per-patient DPDP export (`features/dpdp/export.ts`, `export-dto.ts`, `/api/patients/[id]/export`) | Whole-tenant export job, private India bucket, re-auth, 15-min URL | 03 |
| Lifecycle | 13b: states through `expired`; notices T9/T11 texts; V2-13: retention/purge jobs with dry run and approval (P1-17) | Archive (T9/T10), purge (T11/T12), survivors sweep, deletion certificate | 04 |
| Coupons/refunds | 13b: SQL RPCs | Screens | 05 |
| FK behaviour | `tenant_subscriptions`, `subscription_events` reference `tenants ON DELETE CASCADE` | Survivors must outlive the purge | 04 (D-4) |

## Decisions (CTO, small)

| # | Decision | Rationale |
|---|---|---|
| D-1 | Portal in the same app, `app/(platform)/platform/**`; `features/platform/**` importable only from `app/(platform)` (ESLint zone with pass/fail fixtures); `noindex`, `private, no-store`, its own 30-min idle sign-out | SUB §9.1/§9.2 |
| D-2 | Platform pages read only through `platform.*` definer reads (`tenant_list`, `tenant_detail`, `lifecycle_queue`, `plans_catalogue`, `coupon_list`, `redemption_list`, `payments_for_tenant`) that return closed column lists: tenant metadata, owner name/email, subscription and payment data, row counts and storage bytes only; no clinical table is joined except `count(*)` | "No clinical data" proven by a pgTAP key allow-list |
| D-3 | Two TOTP factors are enforced in the portal layout: an admin with fewer than two verified factors sees only the enrolment page (aal2 needs one; the layout needs two); enrolment through Supabase MFA in the browser | AUTH §4.6 two factors at bootstrap |
| D-4 | A purged tenant's `tenants` row is **never deleted** (tombstone: name, `purged_at`, certificate counts); the purge deletes the clinic's rows table by table (V2-13 machinery, ordered by FK graph) and its storage prefixes, so the CASCADE FKs never fire and survivors (`saas_*`, money-related `subscription_events`, `platform_audit_log`, redemptions referenced by invoices) stay | SUB §6.6 without an FK migration on hot tables |
| D-5 | Archive and purge each take an **on-demand FT-02 dump first** while on Supabase Free: the job writes a `backup_requests` row and the archive/purge step for a batch waits until the backup task reports `ok` for a request created after the batch's dry run (the AWS task polls it); locally and in CI a fake backup reporter marks it | Roadmap R10; irreversible steps never run without a fresh copy |
| D-6 | Export format: one ZIP part with CSV + JSON per entity, `README.md`, `manifest.json` (counts, SHA-256 per file) plus file parts `files-NN.zip` of ≤ 2 GB each when the clinic's files exceed that; the download page lists the parts. The job runs in resumable steps (one entity or one 200-file batch per job run, cursor in `tenant_exports.progress`), each step under 50 s and 256 MB | Fits Vercel function limits without a new service; the 13C-03 spike confirms numbers |
| D-7 | Export bucket `tenant-exports` (private, India region): no policy for `authenticated`/`anon`; the job (service role, ADR-0005 `lib/jobs/**`) writes; the download route checks owner + `requireRecentAuth` (password, plus TOTP if enrolled), then mints a 15-min signed URL and redirects; URL never stored, logged or sent; bundles deleted 30 days after creation or at purge | SUB §6.5 |
| D-8 | Export bytes count against the Free 1 GB Storage quota; FT-04 includes the bucket. A fallback to the S3 `ap-south-1` bucket is **not** built: if the projected bundle would push Storage usage above 70 %, the job refuses with "Export too large, contact support" and alerts the PO (rare at UAT scale) | Lean; avoids a second storage vendor in request paths |
| D-9 | Purge approval is per batch with typed confirmation (`PURGE <n> CLINICS`) after the dry-run counts; a batch is refused unless every tenant's pre-purge notices were sent (or failed with retries) and an export exists or was offered; an override needs a recorded reason | SUB §6.5, SUB-D7 |
| D-10 | Re-purchase inside the archive window (T10) restores instantly: status flip by the 13b T8 path; derived data stays deleted; the archive export stays until its own expiry | SUB §6.4 logical archive |
| D-11 | Owner deletion request (T12) is an owner action on `/settings/billing` with `requireRecentAuth`, typed confirmation, immediate provider cancel, export offered, purge queued after a 7-day cooling-off (still needs admin approval per batch) | SUB §6.3 T12 |
| D-12 | Force-cancel / force-expire / un-archive stay SQL RPCs (runbook), not UI | SUB §9.3 |
| D-13 | Dead-letter replay (04 R-35) and the RUM report (09E hand-off) get read-only portal panels calling the existing `ops.replay_job` / `ops.rum_report` through new aal2-guarded `platform.*` wrappers; replay is one button per job with a reason | Inherited; cheap with the wrappers |
| D-14 | Assisted TOTP reset for clinic users (AUTH §4.6 recovery) is a platform action `platform.reset_member_mfa(user, reason)` calling the Auth admin API from `features/platform/system.ts` (ADR-0005 allow-list) after the RPC records the audit row | AUTH §4.6; one audited path |
| D-15 | `platform_audit_log` actor ids are not exposed to clinic owners (IND I-4): owner views show "CliniQ support" for platform actors | Inherited finding |

## CTO decisions needed

None. Every item above stays within SUB §6-§9 and AUTH §4.6.

## Inherited items

| Item | Source | Plan |
|---|---|---|
| Admin UI calling `platform.*` as `authenticated` (aal2 inside); override-delete RPC; admin grants SQL-only | 05-09b | 01, 02 |
| Dead-letter replay UI | 04-PLAN R-35 | 02 (D-13) |
| RUM screen over `ops.rum_report` | 09E hand-off | 02 (D-13) |
| Platform actor ids visible to owners (IND I-4) | 05b triage | 01 (D-15) |
| `provider_webhook_events.payload` nulled after 90 days | SUB §6.6 | 04 (retention sweep) |
| Export/renewal pages | 05-PLAN | 03 (export slot on `/billing/locked` and `/settings/billing`) |
| `suspended` membership meaning | 05-PLAN, ACC review | Not here: V2-11 owns staff lifecycle; if still unassigned at 13C start, V2-14 triage records a risk acceptance (value unused, CHECK keeps it inert) |

## Shared rules

The 09E shared rules and the 13B shared rules apply. Additionally:

- **Platform RPCs:** SECURITY DEFINER, first line `private.platform_actor(p_actor)`, `search_path = ''`, EXECUTE for
  `authenticated` and `service_role` only, REVOKE from `public`/`anon`, a `platform_audit_log` row (actor, channel, action,
  target tenant, before/after, reason) in the same transaction for every write; reads also audit when they reveal owner
  contact data (`platform.tenant_detail`). Every new RPC is added to the actor-rule loop in
  `supabase/tests/database/platform_rpcs.test.sql` (non-admin, aal1 admin, revoked admin, forged `p_actor` → recorded as
  self, service role without `p_actor` → refused).
- **Irreversible steps:** dry run first (counts per table and bytes per prefix, stored), fresh backup (D-5), approval,
  then the step; each step idempotent and resumable by batch; a crash mid-purge resumes, never re-deletes survivors.
- **Security-sensitive files:** `supabase/migrations/0001[9]*`, `app/(platform)/**`, `features/platform/**`,
  `lib/export/**`, `app/api/billing/export/**`, `lib/jobs/internal/handlers/tenant-*.ts`, the ESLint zone, storage
  policies of `tenant-exports`.

## Plans

### 13C-01 Portal shell, platform MFA, tenant list (tracer) · M · migration 000190_platform_portal

Files: `supabase/migrations/000190_platform_portal.sql`; `supabase/tests/database/platform_portal.test.sql`;
`app/(platform)/platform/{layout.tsx,page.tsx,mfa/page.tsx,tenants/page.tsx}`; `features/platform/{queries.ts,mfa.ts,guard.ts}`;
`eslint.config.mjs` (zone) + `lint-fixtures/platform-boundary/*`; `docs/runbooks/platform-admin-break-glass.md`;
`tests/e2e/platform/{access,mfa-enrol}.spec.ts`.

1. Tracer (above).
2. `platform.tenant_list(p_filter jsonb)`: status, plan, trial/period/grace/archive/purge dates, comp, owner name and
   email, created, counts; key allow-list; `platform.whoami()` (factor count, aal) for the layout.
3. Layout guard: session, `is_platform_admin()` through `whoami`, aal2, two verified factors (D-3), idle 30 min; anything
   else → `/platform/mfa` (enrol/verify) or 404 for non-admins (no hint that the portal exists).
4. MFA enrolment page (Supabase `mfa.enroll`/`challenge`/`verify`, two factors with names "Phone", "Backup").
5. Break-glass runbook (AUTH §4.6 text, the dashboard path first, the audit row by hand, enrol two new factors) and a
   15-minute local drill script `scripts/platform/break-glass-drill.ts --local` (delete a factor as postgres on the local
   stack, re-enrol, check the audit row); the PO repeats it once on production (15-02).

Tests: pgTAP (actor-rule loop incl. the new reads; key allow-list: no clinical column names in any `platform.*` result;
aal1 refused). E2E (desktop-chrome; local MFA with a TOTP secret generated in-test): non-admin → 404; admin aal1 → MFA;
one factor → enrol second; two factors aal2 → tenant list; idle 30 min (page clock) → signed out. Fails-without (High:
aal1 admin access): with the aal2 check removed from `is_platform_admin`, the aal1 admin reads the list; recorded,
restored.
Done: tracer green; the lint zone refuses an import of `features/platform` from `app/(dashboard)` (fixture).

### 13C-02 Tenant detail, actions, Plans & prices, ops panels · M · migration 000191_platform_config_rpcs

Files: `supabase/migrations/000191_platform_config_rpcs.sql`; `supabase/tests/database/platform_config_rpcs.test.sql`;
`app/(platform)/platform/{tenants/[id]/page.tsx,plans/page.tsx,ops/page.tsx}`; `features/platform/{actions.ts,system.ts}`;
`tests/e2e/platform/{tenant-actions,plans-prices}.spec.ts`.

1. RPCs: `platform.tenant_detail` (events timeline, payments, invoices, masked mandate, webhook events by type/time),
   `platform.revoke_override`, `platform.update_settings(p_patch jsonb)` (closed key list: lock window, purge horizon,
   buffer, grace defaults per plan, `public_signup_open`, `offer_coupons_enabled`, `billing_whatsapp_enabled`, supplier
   GSTIN/state/legal name/SAC; GSTIN format + checksum), `platform.set_plan_entitlement(plan, key, enabled, limit)`,
   `platform.set_plan_terms(plan, trial_days, grace...)`, `platform.request_reconcile(tenant)` (enqueues
   `billing.sync_subscription`), `platform.replay_dead_letter(job, reason)`, `platform.rum_report(days)`,
   `platform.reset_member_mfa_record(user, reason)` (D-14). `set_product_availability` already refuses a product without
   an active price with a provider plan id (kept; e2e proves it on the screen).
2. Screens: tenant detail with actions (extend trial, comp until, override grant/revoke, reconcile now, reset a member's
   MFA), each in a dialog with a required reason and the before/after preview; Plans & prices (products, price versions
   with billing model and GST-exclusive amounts, add price version via `create_plan_price`, trial/grace/buffer/quota edits,
   availability switch); Ops (dead letters with replay, RUM p50/p75/p95 table, open alerts).
3. Actions are server actions in `features/platform/actions.ts` calling the RPCs under the admin's JWT (no service role),
   except D-14's Auth admin call in `features/platform/system.ts` after the RPC.

Tests: pgTAP (each RPC: actor loop, audit row with before/after, closed key list for settings, invalid GSTIN refused,
availability refused without price). E2E: extend a trial (event + audit visible, owner banner date moves after the
re-confirm task when a provider subscription exists, 13B-06 path), comp a clinic, add a price version, toggle availability
refused for `ai_assist`, change grace without a deploy (time-travel DB test confirms the new grace applies).
Done: roadmap acceptance lines for Plans & prices met.

### 13C-03 Tenant data export (SUB-06) with a function-limits spike · M · migration 000192_tenant_export · split point after step 1

Files: `supabase/migrations/000192_tenant_export.sql`; `supabase/tests/database/tenant_export.test.sql`; `lib/export/{zip.ts,csv.ts,tenant-manifest.ts}`;
`lib/jobs/internal/handlers/tenant-export.ts`; `features/subscriptions/export.ts`; `app/api/billing/export/[id]/route.ts`;
export section on `/settings/billing` and `/billing/locked`; `scripts/perf/export-spike.ts`; `tests/export/{zip-writer,tenant-export}.spec.ts`;
`tests/e2e/billing/export.spec.ts`.

1. Spike (S, local): synthetic clinic of 15,000 visits and 2 GB of files on the local stack; measure per-step time and
   peak RSS for an entity step and a 200-file step; write `evidence/export-spike.json`; confirm D-6 step sizes (reduce the
   batch if a step exceeds 50 s or 256 MB).
2. Migration: `tenant_exports(id, tenant_id, requested_by, status, progress jsonb, parts jsonb, bytes, created_at,
   completed_at, expires_at)` owner/admin SELECT via billing helper; `public.request_tenant_export(p_tenant)` (owner only;
   one live export at a time; allowed in `trialing`/`active`/`past_due`/`expired`/`archived`); bucket `tenant-exports`
   with no client policies; `billing_internal.export_next_step` / `export_complete`; audit `tenant.export_requested`,
   `tenant.export_downloaded`.
3. Job: resumable steps (D-6), every tenant table listed from `information_schema` with `tenant_id` (a new table without
   an exporter fails a test), DTOs reuse `features/dpdp/export-dto.ts` where they exist, files streamed from Storage into
   the ZIP writer, manifest with SHA-256; T9 − 7 days enqueues one automatically.
4. Download route: owner, `requireRecentAuth`, mints a 15-min signed URL, 302; `Referrer-Policy: no-referrer`; never
   logged. Notice "Your export is ready" links to the in-app page only.

Tests: Vitest: ZIP writer output passes `unzip -t` and round-trips (CI has `unzip`); CSV escaping; manifest hashes
recomputed. pgTAP: request rules, RLS, bucket has no client policy, another clinic cannot read the row. E2E (Fake, local
storage): owner requests, job completes (runner kicked), re-auth prompt, download link expires at 15 min (signed URL
`expiresIn` asserted and a request after `TEST_NOW` + 16 min fails at Storage); admin portal has no path to exports
(server test over every `platform.*` and route). Fails-without (High: export without re-auth): with the re-auth check
removed, a stale session downloads; recorded, restored.
Done: SUB §6.5 bullets met; spike numbers recorded.

### 13C-04 Archive, purge, survivors, deletion certificate, lifecycle queue (SUB-07) · L · migration 000193_tenant_archive_purge · split point after step 3

Files: `supabase/migrations/000193_tenant_archive_purge.sql`; `supabase/tests/database/tenant_archive_purge.test.sql`;
`lib/jobs/internal/handlers/tenant-{archive,purge,retention-sweep}.ts`; `app/(platform)/platform/lifecycle/page.tsx`;
`features/platform/lifecycle.ts`; owner deletion request on `/settings/billing` (D-11); `docs/runbooks/tenant-lifecycle.md`;
`tests/e2e/platform/lifecycle.spec.ts`.

1. Archive (T9, automatic daily): at `expired_at + lock_window_days` and after the D-5 backup: status `archived`,
   derived data deleted (communication queue history, AI logs, webhook delivery logs, job rows, API keys revoked, outbound
   webhook subscriptions disabled), final export generated if none in the last 7 days, events and notices; jobs skip the
   tenant. T10 re-purchase restore by D-10.
2. Purge (T11/T12): `platform.purge_dry_run(p_batch)` (counts per table, bytes per prefix, stored on
   `purge_batches`), `platform.approve_purge(p_batch, p_confirm, p_reason)` (D-9 checks), the purge job deletes per V2-13
   ordering (reusing its table map and its storage deletion), deletes export bundles, keeps survivors (D-4), writes the
   tombstone and `deletion_certificates(tenant_id, batch, counts, backup_retention_note: "copies may persist in encrypted
   backups for up to 30 days")`, notices "Data permanently deleted" to the owner email on file.
3. `platform.retention_sweep` nightly: survivors at their horizons (GST money records 72 months from the annual-return
   due date; logs 1 year), `provider_webhook_events.payload` nulled after 90 days.
4. Lifecycle queue screen: upcoming archives and purges (dates, notice status, export status), dry-run view, approval
   dialog with typed confirmation, certificates list.

Tests: pgTAP with `p_now` (archive at day 30 exactly; derived data gone, clinical rows intact, access locked; re-purchase
restores `full`; purge refused without dry run, without fresh backup, without notices/export offered, without typed
confirmation; purge deletes every tenant table's rows (generated from `information_schema`) and leaves the survivors
and the tombstone; a second run is a no-op; sweep horizons; payload nulled at 90 days). Storage deletion test on the local
stack (objects under the tenant prefix gone, another tenant's untouched). E2E: lifecycle queue → dry run → approve →
certificate visible; owner deletion request with cooling-off. Fails-without (Critical: purge without approval): with the
approval check removed the job purges a dry-run-only batch; recorded, restored.
Done: roadmap acceptance lines for purge, survivors and re-purchase met.

### 13C-05 Coupons screen and Refund action (SUB-COUPON-06) · M · migration 000194_platform_coupon_reads

Files: `supabase/migrations/000194_platform_coupon_reads.sql`; `supabase/tests/database/platform_coupon_reads.test.sql`;
`app/(platform)/platform/{coupons/page.tsx,coupons/[id]/page.tsx}`; refund dialog on tenant payments;
`features/platform/coupons.ts`; `tests/e2e/platform/{coupons,refund}.spec.ts`.

1. Reads `platform.coupon_list`, `coupon_detail` (campaign, codes count by status, offers, redemptions; codes shown once
   at generation only, exported as CSV in the browser, never re-listable), `redemption_list`.
2. Screens: create campaign (kind fields, `uat` with `free_until` and grants), generate codes (count, prefix, single use,
   assigned emails), register provider offer per supply type, pause/archive, redemptions; Refund on a payment row
   (amount, speed, reason code, reason) with re-auth (`requireRecentAuth` at aal2), showing the resulting credit note.
3. "Apply code to tenant" creates the owner re-confirm task (13B-06 RPC).

Tests: pgTAP (actor loop for the reads; codes never returned after generation). E2E: create a `uat` campaign with 3
assigned codes, CSV downloaded, a code redeemed by a test owner, redemption visible; refund with re-auth → audit row +
credit note; second click with the same idempotency key refunds once.
Done: roadmap acceptance line for coupons and refunds met.

### 13C-06a Review fix round · S-M · migration 000195_review_fixes_13c (only if SQL is needed)

As 13B-08a. Highs re-checked once; any cross-tenant or PHI exposure is fixed in this round whatever its rating.

### Close

1. Reviews (fresh context, diff + this plan). Isolated (Sonnet): screens at 1280/820 (portal is desktop-first; 360 must
   not break), copy, flows. Adversarial (Opus): every `platform.*` RPC (actor rule, aal2, audit, key allow-lists, no
   clinical data), the portal guard (two factors, idle, 404 for non-admins), the lint boundary, export (bucket policies,
   re-auth, URL lifetime, logging, admin paths), archive/purge (ordering, survivors, resumability, backup gate, approval,
   storage deletion scope), the break-glass runbook, D-14's Auth admin call.
2. Evidence: `npm run stack:recycle`; `node scripts/phase-evidence.mjs .planning/phases/13C-platform-admin-lifecycle/evidence 1`;
   push; CI green, 0 retried; `--ci-run <id>`; dry-run and deletion-certificate samples (synthetic, tool output).
3. Docs (Haiku): `13C-SUMMARY.md`, `13C-VERIFICATION.md`, roadmap status, VERIFICATION_LOG entry, runbooks
   (`platform-admin-break-glass.md`, `tenant-lifecycle.md`, `subscriptions-sql.md` updated), DATA_HANDLING §5 rows for
   `tenant_exports`, `purge_batches`, `deletion_certificates` (amendment listed for the gate), PO-ACTIONS 13C-P1..P3.

## Threat register (condensed)

| ID | Cat. | Component | Sev. | Mitigation (test) |
|---|---|---|---|---|
| T-13C-01 | E | `platform.*` from tenant sessions or aal1 | critical | Actor rule + aal2 + pgTAP loop (fails-without 13C-01) |
| T-13C-02 | I | Clinical data in the portal | high | Closed key lists (pgTAP); no clinical joins except counts |
| T-13C-03 | I | Export bundle leak | high | No client policy, owner + re-auth, 15-min URL never stored (fails-without 13C-03) |
| T-13C-04 | T/D | Premature or partial purge | critical | Dry run, fresh backup, notices, typed approval, resumable idempotent steps (fails-without 13C-04) |
| T-13C-05 | T | Survivors deleted by cascade | high | Tombstone, never delete `tenants` (pgTAP) |
| T-13C-06 | R | Admin actions without trail | high | Audit row per write in the same transaction |
| T-13C-07 | S | Lost TOTP for the only admin | medium | Two factors at bootstrap; break-glass runbook and drill |
| T-13C-08 | E | Lint boundary bypass | medium | ESLint zone + fixtures; adversarial check |

## PO actions

- **13C-P1** Create the dedicated admin identity on staging (separate email), insert it as platform admin with the runbook
  snippet, enrol two TOTP factors, open `/platform` (5 minutes).
- **13C-P2** Confirm the AWS backup task honours `backup_requests` (Claude ships the task change in `ops/` and the
  runbook; the PO redeploys the scheduled task).
- **13C-P3** Staging migrate of 000190-000195 (not delegated).

## Out of scope

Support impersonation, admin subdomain, admin creation through the UI, force actions in UI, plan creation/bulk
re-pricing UI, automatic purge without approval, per-export encryption, physical cold archive, GSTR-1 export.

## Execution (lean process)

- Executors: Opus for 13C-01, 13C-03, 13C-04 and security fixes; Sonnet for 13C-02, 13C-05; Haiku for docs. Never set a
  mode on a subagent. Affected tests only; one full PR lane at the end of 13C-04; CI runs everything.
- Fails-without: 13C-01 aal1 access; 13C-03 export without re-auth; 13C-04 purge without approval.
- Target calendar: 3 Dec (1-1.5 days).
