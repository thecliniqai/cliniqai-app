---
phase: 05
plan: 05-09c
part: 05b (wave 4)
subsystem: every clinic gets a subscription row before enforcement; v1 subscription tables dropped; flip dry run
status: complete (local)
migrations: [000086_drop_v1_subscription_tables]
plan_head_before: 663b5d1
commits: [ed96f8d, docs commit]
code_head_after: ed96f8d
requirements: [SUB-01 (seeds / comp_until for dev and staging; drop v1 subscriptions/payment_records), SUB §11 test seeds]
acceptance: [11 (preparation: every test clinic trialing or comped; the whole suite green under the access-aware helper)]
---

# 05-09c record: subscription rows before enforcement, v1 tables dropped, flip dry run

**Outcome:** done locally.
- **Test clinics:** `seedTenantWithOwner` now seeds every clinic `trialing` on the Standard price through
  `seedTenantSubscription` (`tests/helpers/tenants.ts`), so the 100 spec files that use it, the e2e global setup and the
  guard world keep full access once 05-10a makes the RLS helpers read the access level.
- **Demo clinic:** the seed core (`seed:local`, `seed-staging.ts`) makes it `active` on the Standard price with a
  one-year comp; both seeds print one line of counts, `access summary: full=<n> locked=<n> onboarding=<n>`.
- **v1 tables:** migration `000086` drops `public.subscriptions` and `public.payment_records`; their two readers (the
  owner's Subscription & Billing page and its service) read `tenant_subscriptions` + `my_tenant_access` in the same
  commit; the specs that read the v1 tables are rewritten.
- **Flip dry run (acceptance 11 de-risk):** with an uncommitted, local-only body of `authz.full_tenant_ids()` that
  requires access level `full` (the 05-10a body), the full pgTAP lane, the full Vitest lane and the e2e PR lane are all
  green; the first probe found 20 pgTAP files whose fixture clinics were still `incomplete`, fixed in their seeding
  (never by weakening the check). The experiment was reverted and the schema snapshot check passed afterwards.

Nothing hosted was contacted; every Supabase CLI call used `--local`.

## What changed

| Area | Change | Plan step |
|---|---|---|
| `tests/helpers/tenants.ts` | `seedTenantSubscription(tenantId, { status?: 'trialing' \| 'active' \| 'expired' \| 'incomplete', comp?, accessEndsAt? })` shapes the clinic's row (created `incomplete` by the tenants trigger) with the service role: `trialing` = Standard price, trial now → +14 d, access until trial end + 24 h; `active` = a 30-day period + 24 h; `expired` = a period that ended 30 days ago; `incomplete` = no price (with `comp`: the Standard price, Pitfall 8); `comp` = `comp_until` a year out. Every lifecycle column is written, so re-seeding leaves nothing behind; a clinic without a row is an error, not a silent no-op. `standardPlanPriceId()` looks the price up by plan code. **`seedTenantWithOwner` seeds `trialing` by default** (`{ subscription: false }` leaves it `incomplete`). `trialingSubscriptionSql(id)` is the same row as one SQL statement for psql-made clinics. `seedDualTenantEcosystem` no longer seeds the v1 tables | 1 |
| Tenant-creation sites (re-grep) | `seedTenantWithOwner` (100 spec files incl. the e2e global setup and the guard world) and the ecosystem builder inherit the default; `tests/jobs/helpers.ts` `insertTenant` seeds `trialing` (R-27: 05-10a's claim skips non-full clinics); **20 pgTAP files** whose fixture clinics act as users seed them `trialing` right after their tenant insert (found by the first flip probe, below); the generated matrix already did (05-09a `fixtureSql`). Left `incomplete` on purpose: `tests/integration/multi-tenancy.spec.ts` (reads `tenants`/`memberships`, the member helper), the onboarding case of the helper spec, the billing/subscription/platform pgTAP files (they shape their own rows), and psql-only specs with no RLS or job claim (`tests/ops/*`, `tests/jobs/alerts-db.spec.ts`, `tests/ci/diagnostics-script.spec.ts`, the teardown leak probe). The product's onboarding (`create_clinic_with_owner`) stays `incomplete` by design (05-10b) | 1 |
| `scripts/seed/demo-clinic.ts` | The demo clinic is `active` on the Standard price with `comp_until` = now + 1 year, refreshed by every run (R-25, Pitfall 8). `accessSummary(admin)` counts clinics by level through `tenant_access_for_system` (R-28); `formatAccessSummary` prints `access summary: full=<n> locked=<n> onboarding=<n>` (+ `other=<n>` only if a clinic is `none` or has no row). Counts only | 1 |
| `scripts/seed-local-dev.ts`, `scripts/seed-staging.ts` | Print the summary line after seeding (staging: for 05-P3). After the 000086 reset `seed:local` printed `full=1 locked=0 onboarding=0` | 1 |
| Migration `000086_drop_v1_subscription_tables` | `DROP TABLE public.payment_records`, `DROP TABLE public.subscriptions` (both empty; no FK, view or function depended on them except the test-only RLS catalogue helper). `public.get_tenant_table_rls_policies()` is replaced with `tenant_subscriptions` in its table list (same signature, definer, search_path; the ACL is kept) | 2 |
| `features/billing/subscription.ts`, `app/(dashboard)/settings/billing/page.tsx` | `getSubscriptionOverview` (still `clinic:manage`) reads the active clinic's `tenant_subscriptions` row (status, trial end, current period end, access end, comp, cancel flag) and `my_tenant_access`; the page shows status, access, the dates (IST), an active comp, and "Plan management arrives with billing (V2-13b)." The v1 plan tier, amount and payment history are gone; `lib/db/types.ts` loses `Subscription` and `PaymentRecord` | 2 |
| Specs rewritten off the v1 tables | `tests/integration/subscription.spec.ts` (owner and admin read the row and events; doctor, nurse and receptionist 0 rows; another clinic's owner 0 rows; no member writes either; the v1 tables are gone); `tests/security/cross-tenant.spec.ts` (`tenant_subscriptions` and `subscription_events`, each with a non-vacuous own-row read first); `tests/security/p0-01-action-sweep.spec.ts` and `tests/security/guard/engine.ts` (the counted tables swap the two v1 names for `tenant_subscriptions`, `subscription_events` and, in the engine, `tenant_entitlement_overrides`); `tests/helpers/rls.ts` `TENANT_OWNED_TABLES`; the matrix loses the two v1 targets; `admin_policies.test.sql` loses their two policies | 2 |
| Flip dry run | Uncommitted, local only: `authz.full_tenant_ids()` with `AND billing_internal.tenant_access_level(m.tenant_id, now()) = 'full'` (the 05-10a body for that helper; every tenant-bound policy, `has_permission` and the storage classes go through it). pgTAP, Vitest and the e2e PR lane ran against it on the committed tree; then it was reverted | 3 |

## Tests that fail without the change

| File / spec | Cases | Without | With |
|---|---|---|---|
| `tests/helpers/subscription.spec.ts` (new) | 10 | with `seedTenantWithOwner`'s seeding call disabled: the 3 default-path cases fail (status `incomplete`, access `onboarding`, no trial keys); without the helper the file does not compile | 10/10 |
| `drop_v1_subscriptions.test.sql` (new) | 4 | at 000085: 3 of 4 fail (both tables exist; the catalogue helper lists them) | 4/4 |
| `tests/integration/subscription.spec.ts`, `tests/security/cross-tenant.spec.ts` (rewritten) | 5 (was 3); 2 (replaced the 2 v1 cases) | the old versions read `subscriptions`/`payment_records`, which 000086 drops (PGRST205); the new ones fail if a clinic is not seeded (`trialing` expected) or if a member other than owner/admin reads the row | pass |
| `tests/integration/demo-clinic-seed.spec.ts` | +2 (and +1 assertion) | without `compDemoClinic` the clinic is `incomplete` / `onboarding`; without `accessSummary` the file does not compile | pass |
| `tests/e2e/a11y/settings-billing-screens.spec.ts` (new, desktop-chrome) | 2 | the old page shows "No active subscription record found" and the v1 cards; its first run found a real serious axe finding (the header subtitle's contrast, `text-gray-500` on the page background; also on the v1 page), fixed to `text-gray-600` | 2/2 |
| The flip dry run | — | first pgTAP probe: 20 files red (their fixture clinics were `incomplete`) | all three lanes green |

## Flip dry run (acceptance 11 de-risk; `evidence/05b/05-09c-flip-dry-run/`)

| Lane (tree `ed96f8d`, helper flipped) | Result |
|---|---|
| pgTAP | 39 files, **3934/3934**; gate PASS |
| Vitest | **249 files, 4901/4901**; gate PASS |
| e2e PR lane (desktop, Pixel 7, iPhone 15) | **222 passed, 9 skipped, 0 failed, 0 flaky, 0 retried** |

How it ran, and what the probes found:
- **pgTAP probe 1 (before the fixture fix):** 20 files red, all for one reason: their fixture clinics were
  `incomplete`, so every user-acting case saw nothing.
- **The fix:** seeding only. Each of the 20 files makes the clinics created in its own transaction `trialing` on the
  Standard price, right after its tenant insert. The access check was never weakened.
- **pgTAP probe 2:** green.
- **Vitest probe:** no access failure at all. The suite runs under a nested lock with a private `TMPDIR`. The first
  `TMPDIR` (inside the scratchpad: a long path with a UUID in it) broke 8 temp-path-sensitive specs: the tsx IPC socket
  path got too long, and the restore-drill guard and a UUID check reacted to the path. With `<os tmpdir>/clinicos-flip`
  those 8 files are green; so is the full lane above.
- **Lock discipline:** the experiment was applied and reverted inside one hold of the shared test-run lock (and the e2e
  lane lock for the e2e run), so no other worktree's run saw it. `schema-snapshot --check` passed after the revert.

## Decisions and deviations

1. **pgTAP fixtures are seeded too (beyond the plan's file list).** The plan names the TS helpers and seeds; the dry run
   showed that 20 pgTAP files would go red at 05-10a. Their seeding is the fix the plan prescribes ("fix every failure
   in the seeding"), so they are in this commit, each with the same 8-line statement (no `\ir`, research A7).
2. **`trialing` by default, `comp` for the demo clinic** (R-25). The helper's `comp` variant keeps the Standard price
   so a comped clinic has the Standard keys (Pitfall 8; proven in the helper spec).
3. **The RLS catalogue helper is replaced in 000086** (`CREATE OR REPLACE`, same signature and ACL): it named the two
   dropped tables. This is not an edit of an applied migration.
4. **The guard engine and the action sweep count `tenant_subscriptions` and `subscription_events`** (and, in the
   engine, `tenant_entitlement_overrides`) in place of the dropped tables. Other tenant tables missing from those lists
   since 05a (`clinical_notes`, `queue_token_counters`) are left as they were (out of scope; noted for the 05b gate).
5. **Page copy** is the plan's text verbatim ("Plan management arrives with billing (V2-13b)."); the status labels are
   plain words ("Free trial", "Full access", "Setup required", …). No new component.
6. **No subscription event is written by the seeds.** The seed rows are test/demo data like the patients they seed;
   `subscription_events` stays the lifecycle log of RPC transitions.

## Local evidence (tool output)

| Check | Result | File (`evidence/05b/05-09c/` unless noted) |
|---|---|---|
| New pgTAP file at 000085 / at 000086 | 3 of 4 fail / 4/4 | `pgtap-drop_v1_subscriptions-without-000086.tap`, `without-000086-db-version.txt`, `pgtap-new-files.txt` |
| Helper spec without the default seeding | 3 default-path cases fail, 7 pass | `vitest-helper-subscription-without-default-seed.txt` |
| pgTAP lane + gate (db 000086, tree `ed96f8d`) | 39 files, **3934/3934**; gate PASS (floor 3934, 39 required) | `pgtap-lane.tap`, `pgtap-report-gate.txt` |
| Full Vitest (tree `ed96f8d`) | **249 files, 4901/4901**, 0 failed, 0 skipped; gate PASS; teardown removed 211 run tenants and verified none remain | `vitest-summary.json`, `vitest-report-gate.txt` |
| e2e PR lane, fresh `e2e:build` at `ed96f8d` | **222 passed, 9 skipped, 0 failed, 0 flaky, 0 retried** | `playwright-summary.json`, `e2e-pr-tail.txt`, `e2e-build-tail.txt` |
| Billing page at 360 / 820 / 1280, axe | 0 serious/critical in the page content after the contrast fix (the run before it is kept) | `settings-billing-{360,820,1280}.png`, `e2e-billing-page-targeted.txt`, `e2e-billing-axe-before-contrast-fix.txt` |
| Flip dry run | as tabled above | `evidence/05b/05-09c-flip-dry-run/*` |
| typecheck, `eslint . --quiet`, inventory, `db:drift:local`, `schema-snapshot --check`, migration immutability | all exit 0 / PASS | `static-checks.txt` |

**Shared stack.** `supabase db reset --local` ran once for 05-09c (2026-11-14T21:12:41Z, under the test-run lock),
followed by `npm run seed:local` (no `--reset`). Every lane took the shared locks; the e2e runs took the e2e lane lock
with an owner file.

## Threats

- **T-05-34 (a clinic without a usable subscription is silently locked):** every test, job and demo clinic now has a
  `trialing` or comped row, and the dry run proves no suite depends on an `incomplete` clinic. 05-P3 re-seeds staging
  and reads the summary line.
- **Information disclosure:** the new page reads only through RLS (owner/admin of the active clinic) and the
  caller-bound wrapper; a doctor gets the fixed refusal (e2e). The seeds print counts only.
- **No new grant, function or table.** 000086 only drops two tables and keeps the helper's ACL (pinned by
  `drop_v1_subscriptions` 4).

## Open items

- **05-10a:** take the dry-run body of `authz.full_tenant_ids()` (`full_tenant_ids.flipped.sql`); the claim-side
  cancellation (R-27) is not covered by this dry run; psql-made clinics in `tests/ops/*` and
  `tests/jobs/alerts-db.spec.ts` stay `incomplete` (they never claim jobs).
- **05-P3 (PO, after the 05b merge):** re-seed staging; the summary line should read `locked=0 onboarding=0`.
- **R-36 accepted race:** on a live staging the owner's billing page breaks between 000086 and the new app; synthetic.
- **05b gate:** the guard engine's `TENANT_TABLES` / the action sweep still omit `clinical_notes` and
  `queue_token_counters` (pre-existing since 05a).

