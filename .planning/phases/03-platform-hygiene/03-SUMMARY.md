---
phase: 03
roadmap_id: V2-03
name: Platform hygiene
status: awaiting PO gate approval (G3-partial)
base_commit: e66edf9 (feature/v2 after PR #4)
head_commit: 2e6f3c2 (verified; later commits are docs and evidence only)
---

# Phase 03 (V2-03) — summary

V2-03 hardens the platform before feature work. It delivers P1-15, I-07, P1-21, P1-34, P1-35a (as code), P1-25,
P1-43, P2-01, P2-03, the C18 D1 spike, AUTH-02, AUTH-03 (local half), AUTH-04b, FT-01, FT-05, FT-07, the AUTH-00
re-check kit, OA-5 and the AI-06 L1 additions. The PO delegated decisions to the agent acting as CTO. Rulings A00-1…5,
R-1…R-34 and R-K are in `03-PLAN.md`; review rulings R-35 and R-36 are in `03-13-REVIEW-TRIAGE.md`. The PO confirms
all of them at the gate (PO-ACTIONS 03-E13). Every number below is copied from a tool output under `evidence/` or from
a plan record that cites one.

## What changed, by plan
| Plan | Outcome (record) |
|---|---|
| 03-06 Next 16 | Next 16.4.6, `eslint-config-next` 16.4.6, `@supabase/ssr` 0.12.7. `middleware.ts` became `proxy.ts`, and session refresh uses `getClaims()`. Turbopack builds the app, so the `--webpack` fallback was not needed. The build scan now covers the Turbopack layout. P2-01 is decided as "upgrade" (R-1). Rollback range `fc13682^..f299439` (`03-06-NEXT16.md`). |
| 03-09a Logger | `lib/log` writes typed JSON lines with a closed field set and no `console` (R-6). `proxy.ts` sets an `x-request-id` on every path and overwrites any inbound one. The v1 `correlation_id` is the request id. Commits `272c088`, `64e7495`, `452d45f` (no separate record; specs `logger.spec.ts`, `request-id.spec.ts`). |
| 03-03 Types and drift | Generated `types/database.ts` replaces the hand-written `Database` type. CI has a migration-immutability gate, a types-freshness diff and a local drift gate (the only allowlisted statement is pg_net). The hosted-dump drift tool is built and runs only on a PO-supplied dump (E1a) (`03-03-TYPES-DRIFT.md`). |
| 03-01 Env | `lib/env.ts` / `lib/env-server.ts` hold a zod schema, the `APP_ENV` tier (R-11) and the R-K key renames. Production boot fails without real providers. `.env.example` is generated. `/api/ready` uses a readiness RPC (000025), and `/api/health` reports region and release (`03-01-ENV.md`). |
| 03-10 Storage | The R2/S3 provider is removed: Supabase Storage only (P1-43). The SSRF check always resolves DNS through an injectable resolver, and the test-env branches are removed (P2-03, E-6). Webhook delivery uses `redirect: "manual"` (`03-10-STORAGE.md`). |
| 03-02 System DB | One service-role factory, `getSystemDb(reason)` with a closed reason set. `lib/supabase/admin.ts` and the storage fallback are deleted. Migration 000026 adds `referral_source_clinics` (`03-02-SYSTEM-DB.md`). |
| 03-11a Auth config | `supabase/auth-policy.json` governs `config.toml` (local and hosted columns). The `static` job runs a policy check, and a read-only hosted drift checker exists (`03-11a-AUTH-CONFIG.md`). |
| 03-09c Sweep | Every `console.*` in app code now goes through the typed logger. The census fell from 216 lines to the one dev-only site in `lib/log/client.ts`. The cron 500 bodies are fixed (`03-09c-SWEEP.md`). |
| 03-05 Datetime | `lib/datetime` (clinic time zone) replaces every UTC "today" site. Census A/B/C went from 27/10/24 lines to 0/0/0. A `TZ=America/New_York` re-run is in CI (`03-05-DATETIME.md`). |
| 03-07 D1 spike | `record_payment` is a SECURITY INVOKER RPC (000027). RLS, the `auth.uid()` actor, the lock, the invariants, the payment, the status, the audit row and the outbox all run in one transaction, with rollback proven. C18 is confirmed, and the spike found four pattern additions (`03-07-D1-SPIKE.md`). |
| 03-09b Error sink | `ops.error_events` is written through `ops_ingest_error` (000028, ingest-key hash, fingerprint and day upsert, cap). The scrubber, `onRequestError` and the diag route are in place. Acceptance 8 is proven locally by e2e (`03-09b-ERROR-SINK.md`). |
| 03-04 Lint | ESLint boundary gates (P1-34 / P1-21 / P1-25 / P1-15) with bypass fixtures, plus ESLint-computed counters in `static-checks.json` (`03-04-LINT.md`). |
| 03-11b Email hook | Send Email hook (Standard Webhooks signature; `magiclink` dropped) and an `EmailSender` (SES `ap-south-1`, Mailpit locally). No real email was sent (`03-11b-EMAIL-HOOK.md`). |
| 03-08 Staging | `staging.yml` / `drift.yml` (Environment-gated, never on `pull_request`) and a workflow-policy check. Staging scripts: target guard, release wait, region check, read-only schema drift. Guarded demo seed. `vercel.json` pins `bom1` (`03-08-STAGING.md`). |
| 03-12a Password | FT-05 Pwned Passwords check (k-anonymity, injectable fetcher), change password and reset completion as server actions with the 10-minute `amr` bound, and the auth error catalogue (`03-12a-PASSWORD.md`). |
| 03-12b Sign-out / OA-5 | `POST /auth/signout` (same-origin, `Clear-Site-Data: "cache"`). The proxy denies pages by default, with listed public prefixes (R-28) (`03-12b-SIGNOUT-OA5.md`). |
| 03-12c Turnstile | Turnstile on sign-in and reset (e2e with a local stub, R-22), safe `next`, J-A3, and the AUTH-00 staging re-check kit (`03-12c-TURNSTILE.md`). |
| 03-13a…e Review fixes | Every review fix ships with a regression test that fails without it: 03-13a auth/session (H-AUTH proxy bound, R-35, R-36), 03-13b env/staging/CI (H-ENV and six Mediums), 03-13c DB and lint (H-PAY actor guards 000029, M-PROBE, M-AUDITSYS, M-LINT, M-ALLOWLIST), 03-13d logging/PII/SSRF (H-LOG console scrubber, M-SCRUB, M-ERRMSG, M-SSRF-*), 03-13e session-age Custom Access Token hook (000030). Records `03-13a…e-*.md`; triage `03-13-REVIEW-TRIAGE.md`. |
| Phase close | The High re-verify Low is fixed in `e4eb4c1`: `console.dir`/`dirxml`/`table` are scrubbed, and a P1-25 lint gate confines `process.stdout/stderr` to `lib/log/**` and `lib/observability/**`. The report gate requires all 69 security/acceptance specs, and the floor is 3292 (`2e6f3c2`). |

Migrations added: 000025–000030 (six files, immutability-gated).

## Deviations (detail in each record's "Deviations" section)
- **03-06:** three React Compiler lint rules set to `warn` (+35 warnings, owner V2-06). F20 audit waivers removed (stale). A flaky guard input was root-caused and fixed (`a36ef48`). Next telemetry may have been sent once during an exploratory build (no app data).
- **03-01:** with `NODE_ENV=production`, `APP_ENV` must be a deploy-like tier. `disabled` providers retry until dead letter (V2-04 owns non-retryable). Developers' `.env.local` must rename the two Supabase keys; dev boot names the rename.
- **03-02:** log event `db.system_acquired` (the logger pattern rejects `system_db.*`). Concrete reasons replace the plan's examples. `service_role` EXECUTE is revoked on `referral_source_clinics`.
- **03-03:** grants are kept in the hosted load. The local `auth` schema is the scratch base. `db:types` formats with prettier. A Linux-valid lockfile and `lock-linux-check.sh` were added.
- **03-04:** the console allow-list is exactly `lib/log/client.ts`. The jobs internals follow ADR-0005 D2. The P1-21 patterns are wider than planned. Type-only imports of system modules are also banned. The counters live in `scripts/ci/p1-34-counters.mjs`.
- **03-05:** the client zone comes from context, not a prop. The public reschedule link uses `DEFAULT_CLINIC_TZ` (P1-20 owns the RPC change).
- **03-07:** `p_tenant_id` is the first argument, from the session (found by guard leg 3b). The RPC uses `lock_timeout`, not a function-level `statement_timeout` (measured: not enforced). Outbox writes go through a `private` definer writer. `recorded_by_system` is a closed set. `55P03` maps to `CONFLICT`.
- **03-08:** the target guard is stricter than "host contains ref". Extra scripts `check-region` and `schema-drift`. A `seed-reset` task. Policy rules beyond the plan.
- **03-09b:** the fingerprint is computed in SQL, and the DB re-scrubs. The cap is 500 new fingerprints per day. `ERROR_INGEST_KEY` is optional in staging. The e2e spec runs on desktop-chrome only.
- **03-09c:** `errorTag` moved to `lib/errors/error-tag.ts`. The third argument of `clientErrorMessage` is typed as an event.
- **03-10:** `redirect: "manual"` on webhook delivery (Rule 2). Dispatcher tests insert queue rows directly.
- **03-11a:** A00-1 is encoded as `[auth] enable_signup = false`. The secret-field rule follows the CLI list. Any `[auth]` key without a policy row fails.
- **03-11b:** Vercel reserves `AWS_*`, so the env names are `SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY` and the region is a constant (03-E4 amended). The SES pin was re-checked (no S3 SDK left).
- **03-12a:** the DB lane uses a loopback fake range API. The A00-5 bound reads every emailed-code `amr` method. A wrong current password has unit-level proof only (R-34). Local GoTrue already ends other sessions on a password change.
- **03-12b:** only GET/HEAD are redirected. A path is public only if both the raw and the normalised path are. Cookies are deleted when GoTrue cannot revoke. User-menu a11y fixes.
- **03-12c:** the always-fail key is emulated by the stub. Safe `next` is stricter than the plan. The kit uses `admin.generateLink` under one scoped lint exception, signs in with the secret key on staging, and adds the Environment variable `STAGING_PUBLISHABLE_KEY`.
- **03-13d:** SSRF address pinning uses `node:https` (no undici dependency). The console scrubber wraps six methods (the triage named two). The phase close adds `dir`/`dirxml`/`table`.
- **Branch rebuilt by cherry-pick.** Before the first push of the review commits, the branch was rebuilt from `3f81bfb` by cherry-pick, to redact a quoted key from a review report (never pushed). 51 of the 52 rebuilt commits have the same patch-id. The one that differs is the redacted review commit (`98b7605 -> 4bdd926`). Because of the rebuild, the 03-13a…e records cite pre-rebuild SHAs. The tool-generated map is `evidence/close/sha-map.txt` (old → new, patch-id compared). The local branch `backup/v2-03-pre-redact` holds the pre-rebuild history and was never pushed. **The PO may delete it after merge.**

## Rulings added during execution (PO confirms, 03-E13)
- **R-35** Password reset ends **signed out**. The recovery session is revoked, and the user signs in with the new password. This deviates from AUTH_REDESIGN, where reset ends signed in (H-AUTH).
- **R-36** Email OTP length is 8 (was 6) (review D M-1).
- Execution-time interpretations that the PO confirms with the rulings: the `db.system_acquired` event name (03-02), the 03-07 pattern additions (definer outbox writer, session `p_tenant_id`, `lock_timeout`, system-actor column), the SES env names (03-11b), the `STAGING_PUBLISHABLE_KEY` variable (03-12c), and the session-age Custom Access Token hook on hosted (03-13e, 03-E3).

## Review outcome (CLAUDE.md DoD 6)
Six isolated reviews of `origin/feature/v2..3f81bfb` and a fresh High re-verification at `14e0811` (reports in
`reviews/`). Severity counts are copied from each report's header:

| Review | Critical | High | Medium | Low | Info |
|---|---|---|---|---|---|
| Independent (`v203-review-independent.md`) | 0 | 1 | 2 | 9 | 8 |
| A env/staging (`…-adversarial-env-staging.md`) | 0 | 1 | 6 | 9 | 6 |
| B service role/DB (`…-adversarial-service-role-db.md`) | 0 | 1 | 4 | 6 | 4 |
| C logging/PII (`…-adversarial-logging-pii.md`) | 0 | 1 | 3 | 5 | 5 |
| D auth/session (`…-adversarial-auth-session.md`) | 0 | 1 | 2 | 5 | 5 |
| E SSRF (`…-adversarial-ssrf.md`) | 0 | 0 | 3 | 5 | 4 |
| High re-verify (`v203-review-high-reverify.md`) | 0 | 0 | 0 | 1 (new) | — |

Triage (`03-13-REVIEW-TRIAGE.md`):
- **Highs (4 distinct; IND H-1 = D H-1): all fixed and re-verified CLOSED.** H-AUTH: proxy bound + R-35 + token hook (03-13a/e); on hosted it is closed only after 03-E3 enables the hook. H-ENV (03-13b). H-LOG (03-13d). H-PAY (03-13c).
- **Mediums: 18 triage rows, all fixed** (M-TOKEN is a doc fix), each with a regression test.
- **Lows:** the cheap ones were fixed in 03-13a…d. The re-verify Low was fixed at phase close (`e4eb4c1`).
- **Accepted, with reason and owner:**
  - stolen-session current-password guessing → V2-13b
  - hook-failure existence side channel → V2-13b
  - staging new-code/old-schema window → V2-04 runbook
  - lab storage keys with patient names → V2-05
  - overpayment and status change via direct table writes → V2-07
  - H-AUTH residual (a token minted just before 600 s lives to ~1,500 s) → V2-13b
- **Open, no owner recorded (for the PO to assign):** the review A Lows L-1, L-2, L-3, L-5, L-6, L-7 and L-8, the optional build-scan `postbuild` step and adding zizmor to `static`. `03-13b-ENV-FIXES.md` lists them as not done ("Deviations" 5).

## Deferred, with owner
- Live AI eval lane (P2-03 / AI-06 L3) → V2-12 (R-8).
- SES bounce/complaint webhook → **V2-12**. V2-03 R-10 said V2-04, and the V2-04 plan re-homes it (`04-PLAN.md` R-40, PO confirms at 04-P14).
- Error-event purge scheduling and overflow/size alerts → V2-04 (R-27).
- Send Email hook `webhook-id` shared store → V2-04 (outbox).
- Outbox atomic claim for `enqueueWebhookEvent` → V2-04.
- Revoke direct queue writes → V2-04 (enqueue RPC).
- `disabled`-provider non-retryable path → V2-04.
- `record_payment` `event_key` → V2-04 04-03b.
- Register zones `app/api/cron/**`, `lib/messaging/dispatcher.ts`, `lib/webhooks/**` → V2-04 04-03c.
- `app/api/v1/**`, `lib/api/**` → P1-37.
- Client error capture → V2-06 (R-29).
- React Compiler lint rules back to error → V2-06.
- User-menu dropdown focus management → V2-06.
- `hardSignOut()` → V2-06 (PWA-02).
- SQL `DEFAULT CURRENT_DATE` defaults → V2-05 05-08 (R-33).
- Invoice FY numbering → V2-10 P1-06 (R-33).
- **Cross-clinic active-tenant binding** (03-07 spike finding 2: RLS admits every membership, so commands must bind the session's active tenant) → V2-05, with a multi-membership pgTAP leg.
- `has_permission` in `record_payment` → V2-05.
- Composite tenant FK on webhook queue rows → V2-05 P1-02.
- Payments contract step (revoke direct `INSERT`/`UPDATE invoices.status`, and the UPDATE/DELETE grants noted by the re-verify) → V2-07.
- Patient search concatenating digits from a name query → V2-08 search rework (backlog candidate; codified v1 behaviour D-06/D-07).
- Reschedule link tenant zone (P1-20) → V2-08.
- Per-account verify and current-password limiters → V2-13b.
- Session time-box / inactivity timeout → V2-13b (Pro) / FT-06.
- MFA-factor added/removed notifications → with the MFA UI (V2-11). The "email changed" notification has no owner recorded yet (`03-11a-AUTH-CONFIG.md` deviation 5).
- SES IAM keys → OIDC role → V2-15 (R-31).
- SSRF redirect/DNS hardening P2-06 → V2-14 (03-13d pinned the checked address; anything further stays with P2-06).

## Event names (logger)
`evidence/close/event-names.txt` is generated by `evidence/close/event-names.sh` (TypeScript AST over `app/`,
`components/`, `features/`, `lib/`, `proxy.ts` and `instrumentation.ts`; `event:` literals and same-file constants,
`reportClientError`, and the third argument of `clientErrorMessage`, each checked against `EVENT_PATTERN`). It finds
288 distinct names, 0 invalid. The file is the list.

## Numbers
- Vitest: 102 files / 1899 tests at the end of V2-02 → 162 files / 3465 tests (`evidence/summary.json`, two runs, 0 skipped, 0 failed).
- Report gate: floor 3292, 69 required spec files, PASS for both runs (`evidence/close/vitest-report-gate.txt`).
- Playwright PR lane: 188 expected (including the 10 KNOWN-BUG expected failures), 7 skipped by design (pixel-7 skips of desktop-only specs), 0 unexpected, 0 flaky (retried); by project: desktop-chrome 107, pixel-7 67, iphone-15 9, setup 5 (`evidence/close/e2e-pr.txt`, `evidence/playwright-results.json`).
- ESLint: 0 errors, 422 warnings (`evidence/close/eslint.txt`).
- Counters: 1 service-role factory (`lib/supabase/system.ts`), 0 boundary messages and 0 UTC-today messages over 313 app files (`evidence/static-checks.json`).
- Package legitimacy for the phase: 87 lockfile entries added or re-versioned since `e66edf9`. 0 integrity mismatches, 0 install scripts, 0 deprecated; `npm audit signatures` verified 510 packages. The two flagged pins wait on 03-E14 (`evidence/package-legitimacy.json` `plans.phase-close`).

## Proposed doc errata (R-24; applied only after PO approval)
1. ADR-0005 D4 owner list: `middleware.ts` → `proxy.ts` (03-06).
2. AUTH_REDESIGN §4.1: remove mitigation 2 (Before-User-Created filter), per A00-2. §4.4: GoTrue's raw signup reveals existence, and the V2-13b app signup returns one uniform response, per A00-3. §7: the rate-limit copy mapping, per A00-4.
3. AUTH_REDESIGN reset flow: ends **signed out** (R-35). Email OTP length 8 (R-36).
4. Roadmap V2-03 "29 UTC sites" → measured census at `45e1c40`: 27 + 10 + 24 lines (research counted 25 + 9 + 9 sites; two sites were added after the research) (03-05).
5. TARGET_ARCHITECTURE §7.5 "statement_timeout set per function": not enforced for the calling statement. Use the role-level `statement_timeout` plus a function-level `lock_timeout` (03-07 finding 3, `evidence/03-07/timeout-probe.txt`). §6 error table: add `55P03` → `CONFLICT`/`LOCK_TIMEOUT` (03-07 D7). §3.2/§7: the four atomic-command pattern additions (03-07 "The pattern later phases copy").

## Pending PO (ids in `.planning/PO-ACTIONS.md` § "V2-03 Platform hygiene"; not copied here)
- **Before merge:** 03-E13 (rulings incl. R-9, R-35, R-36, the accepted risks and the CLAUDE.md change below), 03-E14 (two flagged packages), 03-E15 (Next 16 outcome).
- **After merge (R-19), in the PO-ACTIONS order:** 03-E0, 03-E1a, 03-E1b, 03-E1c, 03-E2, 03-E3 (incl. OTP length 8 and the access-token hook after 000030), 03-E4 (incl. the SES env names and Production-only scoping), 03-E5, 03-E6, 03-E7, 03-E8, 03-E9, 03-E10 (incl. `STAGING_PUBLISHABLE_KEY`), 03-E11.
- The open review Lows above need an owner.

## Proposed CLAUDE.md change — PO approves (03-E13)
Not applied. Proposed text for the `## Commands` section:
- Add to the commands:
  - `npm run db:types`: regenerates `types/database.ts` from the local stack. CI fails if the generated file differs.
  - `npm run db:drift:local`: local drift gate. The only allowlisted statement is pg_net.
  - `node scripts/drift/schema-snapshot.mjs --local --check` (`--write` after a migration). This one is added beyond plan step 6, from the 03-13b wave note.
  - `node scripts/ci/env-example.mjs`: regenerates `.env.example` from the schema without opening any `.env*` file.
- Add to the NEVER-run list:
  - `scripts/seed-staging.ts`
  - `scripts/staging/*` (target guard, release wait, region check, schema drift, AUTH-00 re-check kit)
  - `scripts/drift/auth-config-hosted.mjs` with a real token
  - dispatching `staging.yml` or `drift.yml`: these run only in the PO-approved GitHub Environments (R-9, R-21)
- Add one line: every new migration ships, in the same commit, the regenerated schema snapshot and the
  `app/api/ready/expected-migration.ts` bump.
