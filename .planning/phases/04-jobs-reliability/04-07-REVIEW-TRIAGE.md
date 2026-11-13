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
