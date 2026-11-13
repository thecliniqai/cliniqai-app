# V2-04 re-verification of the 04-07 review fixes (H-SMS and the Mediums)

- Reviewer: isolated adversarial re-verifier with fresh context. I did not read the fixers' records
  (`04-07a/b/c-*.md`) before reaching the verdicts below. Afterwards I grepped them only to see whether the new
  findings were already acknowledged. They were not.
- Commit: `635cd5d` (branch `v2/phase-04-jobs-reliability`). Local stack with migrations up to 000043 applied.
- Method:
  - Code reading.
  - One scratch Vitest probe, kept outside the repo. It uses the real `message.send` handler, the real `Msg91Provider`
    and `TwilioProvider`, and MSW for `control.msg91.com` and `api.twilio.com`. There was no network. Only MSW saw the
    fake numbers.
  - SQL probes inside rolled-back transactions.
  - Workflow-policy fixtures and a sql-guard input, both kept in the scratchpad.
  - The test-lane teardown removed the probe's tenant and users (1 tenant, 5 users). Afterwards the local DB held 0
    tenants and 0 queue rows, and the 9 cron jobs were active, as before.
- Targeted repo specs: 17 files, 260/260 passed. They were: sms-recipient-exploit, msg91-contract, enqueue-message-rpc,
  inbound-retry, replay-job, enqueue-webhook-rpc, runner-review-fixes, runner, parallel-dispatch, reaper,
  delivery-reap, workflow-policy, restore-guards, ensure-schedules, restore-drill-checks, backup-runs and
  alert-review-fixes.

## Verdict summary

| ID | Verdict | New finding |
|---|---|---|
| **H-SMS** | **CLOSED** | Low residuals only (see L-A, L-B) |
| M-ROLE | CLOSED | — |
| M-DEDUPE | CLOSED | — |
| M-INBOUND | CLOSED | L-C (reschedule-token failure still swallowed) |
| M-REPLAY | CLOSED | — |
| M-RXEVENT | CLOSED | Info: stale header comment |
| M-FAIR | **PARTIALLY CLOSED** | **N-1 Medium**: fairness holds only across the 10 tenants with the oldest work |
| M-ATTEMPT | CLOSED | — |
| M-POLICY | CLOSED | — |
| M-BACKUPAUTH | **PARTIALLY CLOSED** | **N-2 Medium**: the sql-guard can be bypassed with `standard_conforming_strings = off` (psql ran a shell command) |
| M-RESTORE | CLOSED | — |

## H-SMS: CLOSED

Fix under test:
- `lib/messaging/providers/msg91.ts:88-94` writes the template's variables first and the fixed `template_id`, `sender`,
  `short_url` and `mobiles` last.
- `lib/messaging/templates/sms.ts` drops the control keys in any letter case and keeps only the declared variables.
- 000041 adds `ops.message_templates.params` / `request_roles`, `private.message_params_ok` in both enqueue paths, and
  SMS templates that only the system may queue.

Attempts. All were run on the live stack with crafted PostgREST/RPC calls from member sessions.

| # | Attempt | Result |
|---|---|---|
| V0 | The reviewer's exact call (`sms`, `appointment_booked_sms_fallback` / `appointment_rescheduled_sms_fallback`, params `mobiles`/`template_id`/`sender`/`short_url`) as **nurse, receptionist, doctor, admin and owner** | All 10 calls refused with `P0001 TEMPLATE_NOT_ALLOWED`. 0 rows written. |
| V1 | 5 roles × the 6 request-callable templates × 25 key variants: control keys in upper/mixed case, leading/trailing space, Cyrillic `о`, zero-width space, full-width letters, `"0"`, `"1"`, `""`, `__proto__`, `constructor`, a declared key with a space, case change or combining mark, `message`, `text`. Value shapes: nested object, array, boolean, 257 chars. Whole params as an array, a string or a number | **0 of about 870 calls accepted** (all `INPUT_INVALID`, or `FORBIDDEN` / `TEMPLATE_NOT_ALLOWED` where the role or template is not allowed). 0 rows. |
| V2 | Bot / free-text templates (`appointment_confirmed_ack`, `conversational_triage`, `appointment_reschedule_link`, `bot_not_found`), lifecycle templates, channel swap (`appointment_booked` on `sms`), `message_type` ≠ template, recipient = a foreign number, a comma list, or a foreign number glued to the patient's | `TEMPLATE_NOT_ALLOWED` / `INPUT_INVALID` / `RECIPIENT_NOT_ALLOWED`. 0 rows. |
| V2 | Metadata keys `is_sms_fallback`, `system_actor`, `appointment_id`, and a foreign `visit_id` | `INPUT_INVALID` |
| V3 | Nurse: direct INSERT and UPDATE on `communication_queue`; UPDATE on `ops.message_templates`; `replay_job`, `communication_queue_claim` and `enqueue_message_system` through RPC | 42501 / 42501 / PGRST106 (schema not exposed) / PGRST202 (not exposed) / 42501 / 42501 |
| V4 | End to end, using a template the nurse is allowed. The nurse queues `appointment_booked` (WhatsApp) with injection-shaped values: `patient_name = x","mobiles":"<n1>,<n2>","template_id":"ATTACKER_FLOW`, `doctor_name = <n1>,<n2>`, and a phishing button. MSW answers the WhatsApp send with 503, so the handler queues its SMS fallback. Both rows are run through the real runner and provider | **HTTP bodies captured.** Bulk: `to: [<patient>]`, positional components only. Flow: `template_id: appointment_booked_sms_fallback`, `sender: synthetic-sender`, `short_url: "0"`, `mobiles: <patient>`. The injected text stays inside JSON string values. |
| V5 | Hostile rows written by the service role, standing in for rows queued before 000041:<br>(a) an SMS row with an undeclared template `rogue_flow` and the keys `mobiles`, `MOBILES`, `Mobiles`, `MOBİLES`, `mobiles␠`, `Recipients`, `flow_id`, `unicode`, `schtime`;<br>(b) the fallback template plus the dotless `mobıles`;<br>(c) a non-catalogue WhatsApp row (free-text path);<br>(d) a catalogue WhatsApp row with `to` and `integrated_number`;<br>(e) a fallback row whose `recipient_phone` is `<patient>,+91<n1>` | (a)–(d): every Flow body had `mobiles = <patient>`, the row's own `template_id`, the fixed sender and `short_url "0"`. The text endpoint got `recipient_number = <patient>`. The bulk body got `to: [<patient>]`. (e): the service-role insert was accepted, which needs service_role (members get 42501, V3). The test harness sent this row to its silent recorder, because its recipient is not exactly the patient's, so MSW never saw it. By the code (`msg91.ts:78`), the provider strips every non-digit, so the list becomes one 24-digit invalid `mobiles` value, not two recipients. SQL refuses this shape on both enqueue paths (V2, `RECIPIENT_NOT_ALLOWED`). |
| V6 | `TwilioProvider` with hostile `To`, `From` and control keys in params, plus a button | Exactly one `To` (the patient) and the fixed `From`. The params appear only inside `Body` (form-encoded, so they cannot inject fields). |
| — | Webhook path (`enqueue_webhook_event`) | Sends no SMS. The payload is built in SQL. |
| — | Inbound bot replies | Parameters built on the server, sent to the stored number, through the system path. |
| — | `replay_job` | postgres only. A replayed hostile row would still go through the fixed provider body (V5). |

Regression tests assert real outcomes and would fail without the fix:
- `tests/messaging/sms-recipient-exploit-db.spec.ts` asserts:
  - `TEMPLATE_NOT_ALLOWED` and an unchanged row count. 000040 accepted the call.
  - The exact Flow body from a hostile existing row. With the old `...params`-last spread, `mobiles`, `template_id` and
    `sender` would be the attacker's.
  - No `msg-fallback` row for a hostile WhatsApp row.
- The `tests/messaging/msg91-contract.spec.ts` H-SMS cases use `toEqual` on the whole body, so the old spread order
  fails them.

Residuals. None of them restores the High.

- **L-A (Low) The provider's key filter is a deny-list for SMS templates that are not declared.**
  - Where: `lib/messaging/templates/sms.ts:46-49`.
  - V5 shows `MOBİLES`, `mobiles␠` and `schtime` passing into a Flow body as variables. The real `mobiles` is still
    written last, so this matters only if MSG91 reads keys case-folded or trimmed, or honours `schtime` on Flow.
    Neither is verified.
  - It is not reachable from a member: only a template declared in SQL can be queued, and only the system path can
    queue SMS. Suggestion: for an undeclared SMS template, send no variables at all (fail closed).
- **L-B (Low, accepted design) Content inside a permitted template is caller-chosen.**
  - Each value can be up to 256 characters. Up to three button texts can be up to 512 each.
  - The Twilio and Gupshup senders append the button text and the params to the body.
  - Example: a nurse can put a URL or phone numbers in `doctor_name` of a booking message to the clinic's own patient.
  - Recipient, template and sender cannot be changed. This is the M-ROLE design (the role holds the call site's
    permission). Record it as an accepted residual, or tighten each variable (for example, names without digits or URLs).

## Mediums

**M-ROLE: CLOSED.**
- Re-ran the reviewer's free-text probe: a nurse calling `appointment_confirmed_ack` with `message: "…http://phish.invalid"`
  gets `TEMPLATE_NOT_ALLOWED`. So do all the bot and lifecycle templates (V2).
- Bypasses tried:
  - channel swap, `message_type` mismatch, metadata `is_sms_fallback` / `system_actor` / `appointment_id`: refused;
  - roles: `request_roles` equal the matrix (`lib/permissions/matrix.ts`), and there is no per-tenant permission table
    that could diverge;
  - `run_at` > 90 days: refused (covered by `enqueue-message-rpc-db.spec.ts:483`).

**M-DEDUPE: CLOSED.**
- Nurse queues with key `appointment_booked:<visit>`. The key is stored as `member:<uid>:appointment_booked:<visit>`,
  so the real system key is still free.
- Bypass reasoning: two member namespaces cannot collide (fixed-length uuid prefix). `enqueue_message_system` refuses
  `member:%`. The spec at `:536` proves that the real cancellation still sends.

**M-INBOUND: CLOSED.**
- `route.ts:75-78` answers `in_flight` with 503 and `Retry-After`.
- A failed cancel, reply enqueue or note throws, so the key is marked `failed` and the route returns 500.
  `inbound_webhook_begin` reprocesses a `failed` key at once.
- Only `AppointmentNotCancellableError` and permanent enqueue refusals count as handled.
- `inbound-retry-db.spec.ts` passed (11 tests).
- **L-C (Low, new):** `route.ts:465-469` still swallows any `generateRescheduleToken` error, including a transient DB
  error, and records the callback as `processed`. The front desk gets its note, but the patient never gets the
  reschedule link, and the provider's retry reads `duplicate`. Fix: treat only the "not actionable" refusal as
  `null`, and rethrow anything else.

**M-REPLAY: CLOSED.**
- `ops.replay_job` refuses a `message.send` whose params or metadata hold `"[redacted]"` anywhere (`jsonb_path_exists
  $.**`).
- The scrub (`communication_payload_redact`) is the only producer of that marker. It also redacts any `http(s)://` or
  64-hex string, so refusals err on the safe side.
- The spec asserts that the original params of a plain message reach the provider after replay.
- The function is postgres-only (checked in the catalogue).

**M-RXEVENT: CLOSED.**
- The request path requires `signed_at` (000041). Draft creation no longer queues the event
  (`features/prescriptions/service.ts:140`). The only app emitter is the signing step (`features/consultation/service.ts:744`).
- The API path keys its event as `:created` and leaves `:signed` free.
- Info: the header comment at `features/prescriptions/service.ts:26` still says that `getOrCreateDraftPrescription`
  queues the event (stale).

**M-FAIR: PARTIALLY CLOSED.**
- The reviewer's repro passes now, in a rolled-back transaction. Tenant A had 30 old jobs and tenant B had 1 newer job.
  With the production `RUN_PASS_CONFIG` (`claim_jobs` batch 10, per_tenant 5), B is in the first batch (6 rows: A×5, B×1).
- The spec drives the real runner with the route's config.
- Bypass found: **N-1** below.

**M-ATTEMPT: CLOSED.**
- Rolled-back probe on a job with `max_attempts 1`:
  - claim, then crash (lease expired), then `reap_jobs`, done twice: the job stays `running` with `attempts 0`
    (000031 dead-lettered it);
  - after a claim and `start_job`, the attempt is 1;
  - a second `start_job` on the same lease returns NULL, so the attempt cannot be counted twice and the handler cannot
    run twice;
  - a crash after the start ends `dead` with `lease_expired`, so poison-pill protection is kept.
- `defer_job` is bounded at 20 deferrals (spec).

**M-POLICY: CLOSED.**
- The reviewer's bypasses are committed as `lint-fixtures/workflows/bypass-*.yml` and fail the policy (spec passed).
- My extra fixtures:
  - an Environment `"staging-backup "` with a trailing space: refused (`environment-known` + scope);
  - the flow mapping `environment: {name: staging-backup}`: refused (`parseable-yaml`, fail closed);
  - the trigger `on: [push, workflow_run]` with an Environment: refused;
  - a quoted `"environment":` key in a PR workflow: refused;
  - a PR workflow without an Environment that reads `secrets.BACKUP_S3_SECRET_ACCESS_KEY` passes. It is harmless:
    those are secrets of the `staging-backup` Environment (runbook §2 step 5), so they are empty outside it.

**M-BACKUPAUTH: PARTIALLY CLOSED.**
- What holds:
  - The archive digest (`--expect-sha256`, checked before `age -d`; `ops.backup_runs.archive_sha256`; job summary and
    `archive-digest.json`).
  - `psql -X`.
  - The guard catches `\` at line start, mid-line and after a COPY terminator, and refuses `COPY … PROGRAM`
    (restore-guards spec).
- What fails: **N-2** below. The guard's stated guarantee ("refuses the archive when psql would see a meta-command")
  is false.

**M-RESTORE: CLOSED.**
- Rolled-back probe: `cron.unschedule` all 9 jobs, then `ops.ensure_schedules()`. All 9 were re-created, with `jobs-kick`
  inactive as the runbook requires.
- A second call changed nothing.
- A tampered `jobs-reap` (schedule and command changed through `cron.alter_job`) was restored to `* * * * *` and its
  real command (`updated: [jobs-reap]`).
- `ensure-schedules-db.spec` and `restore-drill-checks-db.spec` passed.

## New findings

### N-1 (Medium) Tenant fairness covers only the `p_batch` (10) tenants with the oldest due work

- Where: `supabase/migrations/000043_runner_review_fixes.sql:94-104` (`due_tenants … ORDER BY min(run_at) LIMIT p_batch`).
  Also the claim in its comment, `:20-22`: "a tenant with an older backlog gets at most one row more than any other
  due tenant".
- Repro (rolled back, local; `claim_jobs(…, 10, 120, …, 5)` as `RUN_PASS_CONFIG`):
  - 10 tenants, each with 40 due jobs from 30 minutes ago.
  - A victim tenant queues 1 job 1 minute ago.
  - Each claimed batch is marked done, as a runner would.
  - **The victim is first claimed in batch 41 of 45, after all 400 of the other tenants' jobs.**
- With 10 or more tenants that hold older backlogs, the claim is global FIFO again for every other tenant. Two ways
  this happens:
  - morning reminder runs in 10 or more clinics, with no malice involved;
  - one actor with 10 trial clinics bulk-queueing permitted messages.
- This is the original M-FAIR failure ("one clinic's backlog delays every other clinic") at a threshold of 10 tenants
  instead of 1. It breaks TARGET §8 ("no tenant can starve others").
- Fix: choose `due_tenants` round-robin, not by oldest work. For example, order by each tenant's last claim time
  (`max(first_claimed_at)` or a small `ops.job_tenant_cursor`), nulls first. Add the 11-tenant repro above as a spec
  that drives the real runner.

### N-2 (Medium) The restore sql-guard can be bypassed with `SET standard_conforming_strings = off`; psql then runs a shell command

- Where: `ops/restore-drill/sql-guard.ts:73-82`. In `squote` mode the guard always treats `\` as a plain character.
  psql's lexer instead follows the server's `standard_conforming_strings` (psqlscan: a quote starts `xe` when it is off).
- Repro (local; the shell command ran inside the local DB container and was a harmless `echo`). The file is:

  ```sql
  SET standard_conforming_strings = off;
  select 'a\';  select ' \! echo GUARD_BYPASS_EXECUTED # ' ;
  ```

  - `npx tsx ops/restore-drill/sql-guard.ts <file>` printed `sql-guard: PASS`, exit 0.
  - `psql -X -v ON_ERROR_STOP=1 -f` (the drill's flags) printed **`GUARD_BYPASS_EXECUTED`**.
  - How it diverges: the guard closes the first string at `\'` and then sees `' \! … '` as a quoted string. psql reads
    `\'` as an escaped quote, so the string closes at the next `'`, and `\! …` is outside it.
- Impact:
  - A forged archive whose digest is accepted gets shell execution in the psql container, with `$WORK` (the decrypted
    plaintext) mounted. It also gets arbitrary SQL as `postgres` on the restore target, but the guard was never meant
    to stop that.
  - The digest stays the primary control, so this is a defense-in-depth failure. The runbook weakens that control,
    though. `docs/runbooks/backup-restore.md:131` (§8) allows the digest to come from `ops.backup_runs`, while `:99`
    says "from GitHub, not from the bucket". The `staging-backup` Environment holds a `postgres` URL that can write
    `ops.backup_runs`, so the same actor that can plant an archive (R2 token) can also plant its digest when that
    source is used.
  - A client-encoding switch (`SET client_encoding = 'SJIS'`, whose trail bytes include 0x5C) is a likely second
    divergence of the same kind. I did not test it.
- Fix:
  - In the guard, refuse any `standard_conforming_strings` or `client_encoding` setting other than the pg_dump values
    (`on` / `UTF8`), whether set with `SET`, `set_config(…)` or `SELECT pg_catalog.set_config`. Or treat `\` inside
    `'…'` as an escape (fail closed). Add the repro as a restore-guards case.
  - Make §8 take the digest from GitHub only, as §7 does.

### Lows / Info (new)

- L-A, L-B: see H-SMS residuals.
- L-C: see M-INBOUND.
- Info: stale comment at `features/prescriptions/service.ts:26`.
- Info: runbook §8 `:131` contradicts `:99` on where the digest comes from (part of N-2).

## Gate view

- H-SMS is closed. No route is left by which a member can change the SMS/WhatsApp recipient, the Flow template or the
  sender. The regression tests would fail without the fix.
- Two Mediums are only partly closed: M-FAIR (N-1) and M-BACKUPAUTH (N-2). Each is a small, local change with a
  ready-made repro.
