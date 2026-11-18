---
phase: 04
plan: 04-07a
subsystem: messaging / webhooks / inbound (review fixes: H-SMS, M-ROLE, M-DEDUPE, M-INBOUND, M-REPLAY, M-RXEVENT, 04-07a Lows)
status: complete
plan_head_before: 624f47a
---

# 04-07a record: messaging and webhook review fixes

**Outcome:** every 04-07a item of `04-07-REVIEW-TRIAGE.md` is fixed, each with a test that fails without the fix
(`evidence/04-07a/negative-proof-sql.txt`, `negative-proof-ts.txt`). The High (H-SMS) is closed at three layers: the
MSG91 Flow body can no longer be steered by params, SQL refuses undeclared params on both enqueue paths, and the SMS
fallback templates are system-only. Nothing contacted MSG91 or any hosted service (MSW and recording providers only;
local stack only; no `--linked`, no `db push`, no `.env*` read). Base `624f47a`; commits `fcc5999` (000041),
`6f2fe79`, `24e9762`, `6ab1c3f`, `96a0b8e`, `90a8ea2` (specs moved to the new contract), then the docs commit.

## Triage ID → commit → test

| ID | Fix | Commit | Test (fails without the fix) |
|---|---|---|---|
| **H-SMS** (B H-1) | `Msg91Provider.sendSms` body = `{ ...templateVariables, template_id, sender, short_url, mobiles }`; variables are the template's declared set (`lib/messaging/templates/sms.ts` `SMS_FLOW_VARIABLES`) or, for an undeclared template, every param except Flow control keys (any case). SQL: `ops.message_templates.params` + `private.message_params_ok` in `private.enqueue_message_internal` (both paths): only declared keys, scalar values ≤ 1 024 chars. SMS fallbacks system-only (M-ROLE). Recipient stays the patient/guardian row (R-24, unchanged). | `fcc5999` (SQL), `6f2fe79` (provider) | `tests/messaging/sms-recipient-exploit-db.spec.ts`: the reviewer's exact nurse PostgREST call → `TEMPLATE_NOT_ALLOWED`, 0 rows; control keys on a nurse-allowed template and on the system path → `INPUT_INVALID`; direct INSERT → 42501; a hostile row already in the queue → one Flow request, `mobiles` = the patient, template/sender/short_url unchanged, no attacker number in any request; a hostile WhatsApp row gets no SMS fallback; SQL sets = `SMS_FLOW_VARIABLES`. `tests/messaging/msg91-contract.spec.ts`: three MSW cases (control keys in any case never change the request; declared variables only). |
| **M-ROLE** (B M-1, IND I3) | `public.enqueue_message`: template must have `request_roles` (empty = system only: bot replies, `appointment_cancelled`/`_rescheduled`, SMS fallbacks, `bot_not_found`) and the caller must hold one (`current_user_has_role`, else 42501 `FORBIDDEN`); `message_type = template_id`; values ≤ 256 chars; metadata allow-list (`document_id`, `referral_id`, `prescription_id`, `invoice_id`, `visit_id` as UUIDs, `visit_id` = the visit; `buttons` ≤ 3 of `{id,text,url}` strings ≤ 512; ≤ 2 KB); `run_at` ≤ now + 90 days. | `fcc5999` | `tests/jobs/enqueue-message-rpc-db.spec.ts` "04-07a … (M-ROLE)": SQL `request_roles` equal the roles `hasPerm` gives each call site's permission; receptionist/nurse/admin refused where the matrix refuses; system-only templates refused for the owner; control keys, nested values, 257 chars, wrong `message_type`, foreign metadata keys, mismatched `visit_id`, 4 buttons, run_at + 91 d refused. |
| **M-DEDUPE** (B M-2) | Request-path key stored as `member:<uid>:<key>` (≤ 150 chars given); `enqueue_message_system` refuses `member:%`. | `fcc5999` | same spec "(M-DEDUPE)": a member's `appointment_cancelled:<visit>` no longer suppresses the system's message; `msg-fallback:<id>` likewise; two members' equal keys are two rows; forged namespace and 151-char key refused. |
| **M-INBOUND** (B M-3, IND L3, IND L4) | Route: a failed cancel (not `AppointmentNotCancellableError`), reply enqueue (not a permanent `NOT_FOUND`/`VALIDATION_FAILED`/`FORBIDDEN` refusal) or front-desk note throws → key `failed`, 500, MSG91 retries. `in_flight` → 503 `Retry-After: 60`. Retry safety: the cancel stores `metadata.cancel_source_key` (a retry of the same callback skips the cancel and audit and queues the ack; replies keep `bot:<key>:<template>`); notes are written once per callback (`metadata.inbound_key`, `noteOnce`). | `24e9762` | `tests/messaging/inbound-retry-db.spec.ts` (faults injected into the route's own client): visit UPDATE fails → 500, retry cancels + one ack + one audit; ack enqueue fails after the cancel → 500, retry queues the ack once (no "not found" reply); confirm, triage (one note), reschedule (note insert fails), unmatched reply: 500 then exactly one effect; a moved-on visit stays a 200 no-op; a permanent refusal is handled. `inbound-dedupe-db.spec.ts`: recent unfinished claim → 503. |
| **M-REPLAY** (IND M3) | `ops.replay_job` raises `JOB_NOT_REPLAYABLE` for a `message.send` whose row holds `"[redacted]"` in `template_params` or `metadata` (chosen over moving the scrub: the link must not stay at rest). | `fcc5999` | `tests/jobs/replay-job-db.spec.ts` "04-07a": a dead share message → refused, job stays dead; a message without a link replays with its params intact. |
| **M-RXEVENT** (IND M5) | Draft-time enqueue removed (`features/prescriptions/service.ts`). `private.webhook_event_subject`: `prescription.issued` only for an active prescription that is signed or (API path) has items; key `prescription.issued:<id>:signed` / `:created`. `public.enqueue_webhook_event` (request path) requires `signed_at`. | `fcc5999`, `6ab1c3f` | `tests/jobs/enqueue-webhook-rpc-db.spec.ts` "04-07a": app flow (draft → no event; `completeAndSignConsultation` → exactly `…:signed` with the same data); unsigned draft refused on both paths; with items: request refused, API path queues `:created`, signing later still queues `:signed`; amended prescription refused. |
| Low B L-1 | ESLint `messagingDynamic` / `webhookDynamic` (`no-restricted-syntax`, case-insensitive `import()`/`require()` of the barrel, provider modules, deliverer, transport) allowed only in `lib/messaging/**`, `lib/webhooks/**`, `lib/jobs/internal/**`. | `96a0b8e` | `tests/security/p0-12-lint-gates.spec.ts` + `lint-fixtures/p0-12/dynamic-imports.ts` (fails at a feature service, the inbound route, `lib/jobs/enqueue.ts`; cross-zone lines fail in `lib/messaging`/`lib/webhooks`; passes in `lib/jobs/internal`, `tests/**`). |
| Low IND L2 (early DLR) | `communication_queue_apply_dlr`: no row with the id → kept in `ops.early_delivery_reports` (id, status, time, reason code; no phone; purged after 1 day); trigger `communication_queue_apply_early_dlr` applies them in order when a row gets that id. | `fcc5999` | `inbound-retry-db.spec.ts`: Delivered + Read before the finish write → after `communication_queue_finish` the row is `read` with both timestamps and one audit row each. |
| Low B L-3 (`lab_result.ready`) | The document's patient must be of the document's clinic and its visit (when set) that patient's visit in that clinic. Category unchanged (product behaviour kept). | `fcc5999` | `enqueue-webhook-rpc-db.spec.ts` "lab_result.ready: … refused" (both paths). |
| Low B L-6 (DLR note) | Note prints `Reason: <code>` (the `REASON_CODE` filter) or `unreachable`, never provider text. | `24e9762` | `inbound-retry-db.spec.ts` "the urgent-failure note prints a reason code". |
| Low B L-5 (inbound dedupe) | Provider id preferred (non-negative integer ids now count); the body-hash fallback documented in `inboundDedupeKey` (hash covers every field, so a timestamp separates two texts; id field to confirm at the V2-12 staging check). | `24e9762` | `tests/messaging/two-way-bot.spec.ts` "04-07a: the provider id is preferred …". |
| Low B L-2 (metadata correlation) | Covered by M-ROLE (metadata allow-list) and the route: correlation reads only `appointment_id`. | `fcc5999`, `24e9762` | `inbound-retry-db.spec.ts` "review B L-2": a row whose metadata names another patient's visit changes nothing there. |

## Decisions and deviations

- **Role sets live in SQL** (`ops.message_templates.request_roles`), mirroring `lib/permissions` per call site; the
  spec fails if they drift. Receptionists can no longer queue `prescription_ready`/`consultation_documents` via
  PostgREST (the app never let them: `consultations:view`); admins likewise for prescriptions.
- **Metadata is allow-listed rather than stripped** on the request path: an unknown key is `INPUT_INVALID`.
  `review3-fixes-db.spec.ts` now proves token keys are refused on the request path and stripped on the system path.
- **Null param values stay allowed** (the sender printed them before); the handler's `clinic_name` default is unchanged.
- **Early `failed` report**: the transition and audit row are applied; the receptionist's urgent note (route-side) is
  not written for a report that arrived before the finish write. Recorded for V2-12 with the note's phone (P1-13).
- **Reschedule token on a retry**: a reprocessed reschedule callback mints a new token; only the first queued reply is
  sent (`bot:<key>:appointment_reschedule_link`), the unused token expires as before.
- `docs/runbooks/jobs.md` §11 belongs to 04-07c: wave note asks for "a redacted share message is not replayable;
  share again from the app".

## Verification

- `npm run typecheck`, `npx eslint .` (0 errors; warnings at the pre-existing count), `npm run inventory` (exit 0).
- Negative proofs (tool output): `evidence/04-07a/negative-proof-sql.txt` (pre-000041 SQL bodies: 22 tests fail, all
  04-07a cases plus the specs moved to signed prescriptions/declared params), `negative-proof-ts.txt` (pre-fix TS
  files: 19 fail; the early-DLR case passes there because its fix is SQL).
- Full Vitest at `90a8ea2`: 206 files, 4 294 tests passed, 0 failed (`evidence/04-07a/vitest-full.txt`; the first
  full run found five older specs on the old contract, fixed in `90a8ea2`). e2e PR lane (`e2e:build` + `e2e:pr`):
  196 passed, 9 skipped (pre-existing), 0 failed, 0 flaky/retried (`evidence/04-07a/e2e-pr.txt`).
- gitleaks 8.30.1 (docker, `--network none`) over `624f47a..HEAD` after the code commits: no leaks found.

## Self-Check: PASSED

Commits `fcc5999`, `6f2fe79`, `24e9762`, `6ab1c3f`, `96a0b8e`, `90a8ea2` are ancestors of HEAD; the migration, `sms.ts`,
both new specs and the lint fixture exist. Not touched (orchestrator): `STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md`.
