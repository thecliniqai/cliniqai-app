# 04-07 Review triage (V2-04)

Reviewed commit `0dc606b`. Four fresh reviewers; reports in `reviews/`: `v204-review-independent.md` (IND),
`v204-review-adversarial-queue-runner.md` (A), `v204-review-adversarial-messaging-webhooks.md` (B),
`v204-review-adversarial-ops.md` (C). Triage by the orchestrator acting as CTO (PO delegated rulings 2026-11-13).

Rules: every fix has a regression test that fails without it; the High gets a fresh re-verification; accepted items
carry a reason and an owner. Migrations: 04-07a = 000041, 04-07c = 000042 (committed after 000041), 04-07b = 000043.

## High (fix + re-verify)

| ID | Source | Finding | Fix | Plan |
|---|---|---|---|---|
| H-SMS | B H-1 | MSG91 SMS Flow body spreads caller `template_params` last → a member calling `enqueue_message` via PostgREST sends SMS to arbitrary numbers with an arbitrary template/sender | Provider builds the body from fixed fields last (params can never override recipient/template/sender); per-template parameter allow-list enforced in SQL at enqueue; recipient always the patient/guardian row | 04-07a |

## Medium (fix)

| ID | Source | Decision | Plan |
|---|---|---|---|
| M-ROLE | B M-1 | `enqueue_message` checks `has_permission`-equivalent role/permission per template kind; bot/free-text templates not member-callable; bound `metadata` size and `run_at` window | 04-07a |
| M-DEDUPE | B M-2 | Member-supplied dedupe keys are namespaced (`member:<uid>:…`) and can never collide with system keys | 04-07a |
| M-INBOUND | B M-3 | Inbound route: an enqueue failure returns 5xx and is not recorded as handled (MSG91 retries); `in_flight` returns a retryable status | 04-07a |
| M-REPLAY | IND M3 | `ops.replay_job` refuses (or rebuilds from source rows) messages whose payload was scrubbed — no broken links to patients | 04-07a |
| M-RXEVENT | IND M5 | `prescription.issued` is emitted at signing (dedupe key per prescription + status), not by the empty draft | 04-07a |
| M-FAIR | A M-1, IND M1 | Runner claims a fair batch (per-tenant fairness delivered in production), budget computed so batch > 1 with per-job deadlines; fairness spec drives the real runner | 04-07b |
| M-ATTEMPT | IND M2, A L-1 | A reclaim of a job that never ran does not consume an attempt (attempt counted at start of handling, or refunded on lease-expiry reclaim) | 04-07b |
| M-POLICY | C M-1 | workflow-policy: case-insensitive environment names, refuse expression-valued `environment`, dynamic `secrets[...]`, `workflow_run`/fork-capable triggers on staging workflows; fixtures for each bypass | 04-07c |
| M-BACKUPAUTH | C M-2 | Backups authenticated: per-archive SHA-256 recorded in `ops.backup_runs` and a signed manifest; restore verifies before use; restore refuses psql meta-commands (`\`) in the dump | 04-07c |
| M-RESTORE | IND M4 | Runbook + restore tooling re-create pg_cron schedules (idempotent `ops.ensure_schedules()`), checked by the drill | 04-07c |

## Lows fixed in 04-07

04-07a: P0-12 lint also bans dynamic `import()` of providers; early delivery report kept (not lost); `lab_result.ready` validates the document belongs to the visit/tenant; DLR note stores a code, not the raw provider reason; inbound dedupe prefers provider message id and documents the body-hash fallback.
04-07b: handler timeout keeps the lease until the handler settles or is aborted (AbortSignal); hard per-call DB timeouts so the route stays under 60 s; invalid `retryAt` treated as a retryable error for that job only; `runner_stale` counts only scheduler-triggered runs.
04-07c: alert cooldown per rule (not per episode); `backup-alert.yml` matches by workflow path + branch + event, never by name; `feature/v2` guard uses exact ref comparison; R-51 retry ends with a terminal state for `alert_channel_unconfigured`; plan/roadmap drift (R-49 row, R2 instead of CodeBuild/ap-south-1) corrected.

## Accepted (reason, owner)

| Item | Reason | Owner |
|---|---|---|
| R2 token can overwrite/delete; no bucket lock | Staging synthetic data; M-BACKUPAUTH detects tampering; object lock evaluated with the production backup target | V2-15 (go-live backups) |
| Email hook 409 may not be retried by GoTrue (B Low, unverified) | Added to the AUTH-00 hosted re-check kit | staging re-check |
| Runner token not bound to an environment | Ruled: staging and production must use different runner secrets (runbook + env check that refuses equal values is not possible across deployments) | runbook (04-07c) |
| `service_role` can read `vault.decrypted_secrets` (Supabase default) | Not reachable through the API; platform default | V2-14 review |
| Jobs of an unknown kind never claimed | Deploy order covers it; a stale-kind alert is added to 04-07b if cheap, else V2-14 | 04-07b / V2-14 |

## Re-verification follow-ups (04-07d)

Source: `reviews/v204-review-high-reverify.md` (fresh adversarial re-verifier at `635cd5d`): H-SMS and 9 of 11 Mediums
CLOSED; M-FAIR and M-BACKUPAUTH partially closed (N-1, N-2). Record: `04-07d-REVERIFY-FIXES.md`.

| ID | Source | Decision | Plan |
|---|---|---|---|
| N-1 (Medium) | re-verify, M-FAIR | Fixed: `claim_jobs` picks tenants least recently served first (000044, `ops.jobs.last_claimed_at`), so every tenant with due work is served within ceil(tenants / batch) claims; per-tenant cap, round-robin, SKIP LOCKED unchanged | 04-07d |
| N-2 (Medium) | re-verify, M-BACKUPAUTH | Fixed: guard independent of `standard_conforming_strings` (+ refuses changing it or `client_encoding`, line-start backslashes, non-UTF-8); restore runs psql restricted under a fresh key (`ops/bin/psql-restricted.sh`); restore digest only from the green GitHub `backup.yml` run (runbook §7/§8, PO-ACTIONS 04-P13) | 04-07d |
| L-A (Low) | re-verify, H-SMS residual | Fixed: SMS Flow variables are an allow-list; an undeclared SMS template sends none | 04-07d |
| L-C (Low) | re-verify, M-INBOUND | Fixed: only `create_reschedule_token`'s business refusal means "no link"; a transient failure answers 500 and is retried | 04-07d |
| Info | re-verify, M-RXEVENT | Fixed: stale header comment in `features/prescriptions/service.ts` | 04-07d |

Accepted (reason, owner):

| Item | Reason | Owner |
|---|---|---|
| L-B: member-supplied free text inside a permitted template's values / buttons (each value ≤ 256 chars, up to three buttons; Twilio/Gupshup append them to the body) | The M-ROLE design: recipient, template and sender are fixed; only pre-approved templates a role may send are callable, each value is length-capped, and the text goes only to the clinic's own patient. Per-variable shape rules (e.g. names without digits or URLs) belong with the template catalogue rework | V2-12 |

## Adversarial re-check follow-ups (04-07e)

Source: `reviews/v204-review-n1-n2-recheck.md` (isolated adversarial re-checker at `3947174`): N-1 and N-2 OPEN again
through new routes (N-1b, N-2b, both Medium) plus three guard Lows. Record: `04-07e-FAIRNESS-RESTORE-FIXES.md`.

| ID | Source | Decision | Plan |
|---|---|---|---|
| N-1b (Medium) | re-check, N-1 / M-FAIR | Fixed (000045): a hand-back restores the claim stamp (`prev_last_claimed_at`), so it costs no rotation turn; `claim_jobs` returns its fair order (`claim_order`) and the runner starts each batch in it (least recently served tenant first). Real-runner probe #8 (12 s bound, 1.5 s jobs): victim within 2 passes | 04-07e |
| N-2b (Medium) | re-check, N-2 / M-BACKUPAUTH | Fixed: every ops/** psql session through `psql-restricted.sh` (now also forcing `standard_conforming_strings` on and UTF8); `manifest-guard.ts` validates every manifest field before use; counts and checks are fixed SQL using quoted psql variables (`:'name'`) | 04-07e |
| L-D, L-E, L-F (Low) | re-check, sql-guard | Fixed in `sql-guard.ts` (dollar quote after a digit; `U&` quotes, `set_config` outside pg_dump's own line, `SET NAMES`; COPY spellings with comments/parentheses). Residual accepted: settings changed by server-side code are invisible to a text scan; restricted psql with forced settings and the restore role's missing `pg_execute_server_program` (asserted) are the controls | 04-07e |

## Second re-check outcome (04-07e close)

Source: `reviews/v204-review-n1b-n2b-recheck.md` (isolated adversarial re-checker at `b5c9e11`): N-1b and N-2b
**CLOSED**; one Info, no other new finding.

| ID | Source | Decision | Plan |
|---|---|---|---|
| I-1 (Info) | re-check, N-2b record | Fixed: the 04-07e record no longer says a login event trigger needs superuser (the local non-superuser `postgres` created one); `sql-guard.ts` refuses `CREATE EVENT TRIGGER … ON login` (`evidence/04-07e/i1-negative-proof.txt`) | 04-07e close |

## Assigned after close (CTO, 2026-11-14)

| Item | Owner |
|---|---|
| IND L1 reschedule webhook key A→B→A suppresses the return event | V2-12 |
| IND L5 `dead_letter` counts transient `outcome_unknown` webhook rows; backlog rules count unregistered `drill.*` kinds | V2-14 |
| IND L6 test teardown re-activates every inactive cron job (04-02 D7) | V2-05 test harness |
