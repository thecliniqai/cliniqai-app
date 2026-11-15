# V2-05b re-verification (05-12 review fixes)

Isolated adversarial re-verifier. Commit `3b869a9` (branch `v2/phase-05b-membership-entitlements`). Local stack at
**000093** (`supabase_migrations.schema_migrations` top = 000093, 000092, 000091); no reset was run.

Method: the rolled-back probes run as `postgres` in one `BEGIN … ROLLBACK` file. Each probe runs in a subtransaction as
`authenticated`, with `request.jwt.claims` (`sub`, `role`) and `request.headers` (`x-clinicos-tenant`) set the way
PostgREST sets them, or as `service_role` / `postgres` for system steps. The fixture prefix is `ad5e0000-…`: three
synthetic clinics (A trialing since 02:00 IST yesterday, M active with a 50-draft override, C trialing for messages and
invitations). The concurrency probes used one committed synthetic clinic (`ad5f0000-…`) across two psql sessions, then
deleted it. A residual scan of every `tenant_id` table, plus `auth.users` and `ai_quota_reservations`, found 0 rows.
`platform_settings` was not changed (`ai.scribe` was already on). I made no source edits or commits, read no `.env*`
file and touched no hosted project. I read `05-12-REVIEW-FIXES.md` only after the probes.

## Summary

| Finding | Status | Note |
|---|---|---|
| H-AITZ | **CLOSED** | The period no longer reads `tenants.timezone`. Offsets are refused (CHECK validated). No API role can write `trial_start` or the subscription status. Zone changes are audited. |
| M-AIEXP | **CLOSED** (with a Low residual, N-1) | Every single-call route is refused. A commit whose transaction started before expiry still lands (1,501 shown with two sessions). Through PostgREST the window is only the length of one call. |
| M-CANCEL | **CLOSED** | Every cancel path closes the row: pending, failed-retry, lease-expired running/processing, dead→replay→cancel, webhook processing and outcome_unknown. Backfill, reaper and replay never re-open it. |
| M-REINVITE | **CLOSED** for the sequential path. The concurrent path is a Low residual (N-2). | Two simultaneous invites, or replace against replace, still return `deduped: true` for the other role. The UI then names the wrong role. |

No new High or Medium. Two new Lows (N-1, N-2) and two Info items (N-3, N-4).

## H-AITZ: CLOSED

| Probe | Result |
|---|---|
| A1 original: owner sets `-23` | `23514 tenants_timezone_iana` (refused) |
| A2: 1,500 used in the trial key, owner sets `Etc/GMT+12`, doctor preflight | `over_quota` |
| A3: same, owner sets `Pacific/Kiritimati` (+14), doctor `ai_reserve` | `AI_OVER_QUOTA` |
| A4: admin flips zone twice; audit | `2 rows; admin:Asia/Kolkata>Etc/GMT+12, admin:Etc/GMT+12>Etc/GMT-14` |
| A4b: no-op write of the same zone | 0 audit rows (trigger `WHEN` distinct): correct |
| A5: `is_iana_timezone` | `posix/Etc/GMT+12` false, `IST` false, `asia/kolkata` true, `UTC` true, `EST5EDT` true, `Etc/GMT+12` true |
| A6: owner `UPDATE tenant_subscriptions SET trial_start` | `42501 permission denied` |
| A7: owner `DELETE ai_usage_monthly` | `42501 permission denied` |
| A8: owner `platform.extend_trial` | `42501 PLATFORM_ADMIN_REQUIRED` (and it never touches `trial_start`) |
| A9: owner `billing_internal.start_trial` | `42501 permission denied for schema` (and `trial_consumed` makes it one-shot) |
| A10: `ai_period` for active clinic M at `2026-11-30 18:29:59.999Z` / `18:30:00Z` | `2026-11` / `2026-12` (IST midnight). Trial clinic A at `2027-03-01` → its trial key (ignores `p_at`) |
| A11: override clinic M at 50/50, owner sets `Pacific/Kiritimati`, preflight | `over_quota` |
| A12: reserve in trial (1,499 used), platform flips to `active`, then commit | the unit lands in the reservation's own period (`trial:…=1500`). No mismatch between `ai_reserve` and `ai_commit`. |

Other routes I tried, all closed:
- **Editing the trial start:** no API role holds a grant on `tenant_subscriptions`. `start_trial` is postgres/service_role only and one-shot. `extend_trial` changes only `trial_end`.
- **Comp or override clinics:** these use the IST month (A10, A11).
- **Month boundary:** this is exactly IST midnight.
- **`tenant_local_date` callers:** the remaining ones are `issue_queue_token`, `queue_tokens_fill_date`, `patient_documents_fill_report_date` and `resolve_share_token`. None meters a quota. No app code computes an AI or usage period from the zone.

One limit remains: IANA names still span UTC−12…+14 (26 h). That is harmless for AI now, but it still shifts queue-token dates (not a quota).

## M-AIEXP: CLOSED (residual N-1)

| Probe | Result |
|---|---|
| E1 original: 1,499 used + expired `e001`; reserve new; commit `e001` | `AI_RESERVATION_EXPIRED` |
| E2: then commit the new one; release `e001` | `1500 units`, 0 reservations left |
| E3: `expires_at = now()` exactly | `AI_RESERVATION_EXPIRED` (`<=`). This matches the gate, which counts `> now()`, so a reservation is counted exactly while it can still be committed. |
| E4: expired, system path (`service_role`) | `AI_RESERVATION_EXPIRED` (no bypass) |
| E5: live reservation of doctor 1; doctor 2 releases or commits | `AI_RESERVATION_NOT_FOUND` |
| E6: admin (no `consultations:edit`) commits | `AI_FORBIDDEN` |
| E7: 1,499 + a live reservation | `over_quota` |
| E8: `p_timeout_s = 100000` | lifetime `00:05:30` (clamped 300 s + 30 s) |

**N-1 (Low, new): a commit whose transaction began before expiry still lands.** I ran this with committed synthetic data and two sessions:

```
reservation e001 expires at T+3 s (1,499 used)
S1: BEGIN (now() = 02:58:53.776) … pg_sleep(6) … ai_commit(e001) at wall 02:58:59.784 → 1501
S2 (autocommit) at 02:58:58.325: ai_reserve → new id (e001 expired, not counted); ai_commit(new) → 1500
final: trial:2026-11-15 = 1501
```

`ai_commit` compares `expires_at` with `now()`, which is the transaction start. `ai_reserve` counts live reservations with its own `now()`. The two do not share a lock before the expiry decision: `ai_commit` takes the usage-row lock only in its final upsert.

Through PostgREST every RPC is its own transaction, so a client cannot hold `now()` open. The real window is the length of one `ai_commit` call, including lock waits up to `lock_timeout` 5 s. The overshoot is at most one unit per such race. A V2-12 gateway on a direct pooled connection running multi-statement transactions would widen it.

Fix (cheap):
1. In `ai_commit`, lock the usage row first, the same lock `ai_reserve` takes: `INSERT … ON CONFLICT DO NOTHING; SELECT … FOR UPDATE`.
2. Then test `expires_at <= clock_timestamp()`.

`ai_reserve` and `ai_commit` then serialise on that row, and either order ends at 1,500. Add a two-session test (`tests/ai/ai-reserve-concurrency.spec.ts` already runs this style).

## M-CANCEL: CLOSED

| Probe | Result (job \| row \| params) |
|---|---|
| C1 original: `enqueue_message` → lock → `claim_jobs` | `cancelled\|tenant_not_full\|cancelled\|job_cancelled:tenant_not_full\|{"document_url":"[redacted]","patient_name":…}` |
| C2: job aged 8 days, `ops.cleanup()`, renew, `backfill_delivery_jobs()` + `reap_delivery_rows()` | `0 jobs \| cancelled` (not recreated) |
| C3: job claimed (running), row `processing`, lease expired, clinic locks, claim | `cancelled\|cancelled\|link redacted` |
| C4: row `failed` (retry pending), clinic locks, claim | `cancelled\|cancelled\|link redacted` |
| C5: `ops.replay_job` of a cancelled job | `JOB_NOT_REPLAYABLE` |
| C6: dead job (row `dead_letter`, empty params) replayed while locked, then claim | `cancelled\|cancelled` |
| C7: webhook row `processing`, lease-expired running job, lock, claim; job deleted; renew; backfill | `failed\|job_cancelled:tenant_not_full\|0 jobs` |
| C8: webhook row `failed/outcome_unknown` with a pending job, lock, claim | `failed\|job_cancelled:tenant_not_full` |
| C9: a member enqueues while the clinic is locked | `SUBJECT_MISMATCH` (refused at the door; nothing to cancel) |

Other routes I checked:
- `claim_jobs` is the only function that sets `cancelled`, and the trigger catches any future one.
- `replay_job` requires `dead`.
- `enqueue_job` never revives a terminal job: it uses `ON CONFLICT DO NOTHING`.
- `authenticated` has no write grant on `communication_queue` or `webhook_delivery_queue`.
- `message.reply_unmatched` is redacted by its own BEFORE trigger on every non-open status.
- The other job kinds (`webhook.create` / `webhook.delete`, `email.invite`) carry no PHI.
- A cancelled `email.invite` stays resendable (pgTAP 26; I2 below shows `resend_invitation` minting v2).

**N-4 (Info):** the "scrub" redacts only link and token values (`communication_payload_redact`). `patient_name` and `recipient_phone` stay on the cancelled row (C1), exactly as on `sent` and `dead_letter` rows. This matches the dead path the triage asked for, but IND M-1's wording ("PHI template params unredacted") is only partly addressed. Retention of communication rows governs the rest. Worth one line in the record so nobody believes cancelled rows are PHI-free.

## M-REINVITE: CLOSED for the sequential path (residual N-2)

| Probe | Result |
|---|---|
| I1 original: owner invites `admin`, then the same address (case and space varied) as `receptionist` | `{"deduped":false,"replaced_role":"admin"}`, admin row revoked, receptionist pending, 2 email jobs |
| I2: same role twice, then `resend_invitation` | `{"deduped":true}` (same id, 1 job); resend → `token_version 2`, jobs `…:v1`, `…:v2` |
| I3: admin replaces an owner-made pending `admin` invite with `nurse` | `42501 OWNER_REQUIRED` |
| I4: admin replaces a `doctor` invite with `admin` | `42501 OWNER_REQUIRED` |
| I5: admin replaces a `doctor` invite with `nurse` | `{"deduped":false,"replaced_role":"doctor"}` (allowed, correct) |
| I6: token minted for the admin invite, then replaced; the invitee presents the old token | `Invalid invitation token` (`token_hash` nulled on revoke) |
| I7: `resend_invitation` of the replaced invite | `INVITATION_NOT_PENDING` |
| I8: expired owner-made `admin` invite; admin re-invites as `nurse` | `{"deduped":false}` (the expired row is revoked silently, as before 05-12) |

**N-2 (Low, new; the record's decision 7 accepts the branch but not the misleading message):** the concurrent branch still returns the other role as `deduped`, and the app then states the requested role. I ran this with two sessions and committed synthetic data:

```
Race 1  S1 owner1 invite admin (open txn) ‖ S2 owner2 invite receptionist
        S1 {"deduped":false}  S2 {"deduped":true, same id}   stored: admin
Race 2  pending admin; S1 owner1 → nurse (open txn) ‖ S2 owner2 → receptionist
        S1 {"deduped":false,"replaced_role":"admin"}  S2 {"deduped":true}   stored: nurse
```

In both races S2's owner sees `inviteNotice(…, "already_pending")`: "An invitation for x as **receptionist** is already pending". The stored role is admin or nurse. The bad direction is a downgrade lost to a concurrent upgrade: the screen confirms the lower role while the higher one is emailed. It needs two owners (or an owner and an admin, for non-admin roles) acting within milliseconds of each other, so Low.

Fix:
1. Return `role` in every `deduped` answer and print the stored role in the notice, never the requested one.
2. Better: when the conflict winner's role differs from `p_role`, loop once back into the replace branch, or raise `INVITATION_ROLE_CONFLICT`.

**Race 3 (accept during replace): safe.** S1, the invitee, consumed the pending receptionist invite in an open transaction. S2, the owner, re-invited the same address as `admin` and got `{"deduped":false}` (no `replaced_role`). The `ALREADY_MEMBER` check runs before the row lock, so a new admin invitation was created and emailed to someone who is now a member. The membership stayed `receptionist`. Accepting the new admin link gives `ALREADY_MEMBER`, so there is no escalation.

**N-3 (Info):** a stale pending invitation is left behind. It would become acceptable, and reactivate the person as admin (R-32), only if the member is later removed within 72 h. The owner made that invitation and it is visible in the list, so this is Info. Optional fix: re-check membership after taking the lock.

## Other Info

- **A13:** `private.ai_period` falls back to the IST month when `status = 'trialing'` and `trial_start IS NULL`. `tenant_subscriptions_trial_window` allows that state. Only `postgres` / platform code could produce it, since `start_trial` always sets `trial_start`. It would open a fresh monthly pool during a trial. Optional hardening: `CHECK (status <> 'trialing' OR trial_start IS NOT NULL)`.
- **Clinic leaves `trialing` mid-trial** (to `active` on purchase): the month key is a fresh pool. This is by design (paid), not a bypass, because a clinic cannot change its own status.

## Legitimate paths

| Path | Result |
|---|---|
| Trialing clinic at 1,498: reserve+commit ×2, then preflight | `1499, 1500, over_quota` |
| Trialing clinic from 0: 1,500 reserve+commit in a loop, then the 1,501st reserve | all 1,500 succeed; the 1,501st → `AI_OVER_QUOTA` |
| Trialing clinic at 1,500: reserve | `AI_OVER_QUOTA` |
| Normal message in a full clinic | `claim_jobs` returns the `message.send` job (running); row `pending` with params intact (not cancelled or redacted). The handler's provider send is app code and was not run here. |
| Re-invite with the same role | `deduped: true`, no new email. The UI says "already pending … resend it from the list"; `resend_invitation` mints v2 and a new job. |
| Acceptance with the new role after a replace | the membership is `receptionist`, `active` |
