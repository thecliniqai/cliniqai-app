# V2-04 adversarial review: group B (messaging, webhooks, inbound, email hook, tenant binding)

- Reviewer: isolated hostile reviewer (fresh context; implementer records not read before the findings)
- Scope: `git diff origin/feature/v2...0dc606b` for migrations 000035–000038, `lib/messaging/**`, `lib/webhooks/**`,
  `lib/email/**`, `app/api/webhooks/messaging/[provider]/route.ts`, `app/api/auth/send-email/route.ts`,
  `features/auth/system.ts`, `lib/jobs/enqueue.ts`, the `message.send` / `message.reply_unmatched` / `webhook.deliver`
  handlers, the feature call sites and the ESLint P0-12 / A3 zones.
- Method: code reading against 04-PLAN (04-00b, 04-03a/b/c, R-6, R-24, R-25, R-26, R-43, R-44, threat model), a
  catalogue query on the local stack, ESLint run on stdin for bypass spellings, and one DB probe on the local stack
  (scratch spec outside the repo, fetch stubbed for `msg91.com` only, no network). The probe's tenants and users were
  removed by the test-lane teardown. Leftovers from one aborted probe run (130 tenants, synthetic) were also removed
  with the lane's own `teardownRun`. The local DB has 0 tenants from the last 3 hours.

## Verdict

**Do not pass the gate as is: 1 High, 3 Medium.** Tenant binding is sound. Every cross-tenant and dual-member attack
I tried failed: the enqueue RPCs, the webhook claim tenant check, the inbound correlation and DLR application all held.
The main defect is a different one. R-24's recipient and template allow-list is enforced in SQL, then thrown away in
the MSG91 SMS provider: any clinic member, nurse included, can make the job runner send SMS to arbitrary numbers with an
arbitrary MSG91 Flow template. The probe proved it end to end.

## High

### H-1 `template_params` override the MSG91 Flow request: SMS to any number, any template, any sender (R-24 bypass)

- `lib/messaging/providers/msg91.ts:85-91`: the Flow body is `{ template_id, sender, short_url, mobiles, ...params }`.
  `params` is spread last, so the keys `mobiles`, `template_id`, `sender` and `short_url` in the row's
  `template_params` replace the checked values.
- `supabase/migrations/000035_message_enqueue.sql:135-142` (`private.enqueue_message_internal`) checks only that
  `template_params` is an object of 4 KB or less. It sets no rule on key names. `public.enqueue_message` (`:243-304`)
  is granted to `authenticated` and does no role or permission check (see M-1).
- `lib/jobs/internal/handlers/message-send.ts:62-73` passes every param through as a string. `smsFallback`
  (`:129-156`) copies a WhatsApp row's `template_params` into the SMS fallback row, so a WhatsApp enqueue carrying the
  same keys also works once the WhatsApp send fails.
- The synthetic-number guard (`syntheticRecipientRefusal`) checks only `to`. It stops the attack when the patient's
  stored number is synthetic, and does nothing for a real patient number.
- **Exploit (proved on the local stack):** a **nurse** session calls
  `rpc('enqueue_message', { p_tenant_id: <own clinic>, p_patient_id: <any patient of the clinic>, p_channel: 'sms',
  p_template_id: 'appointment_booked_sms_fallback', p_template_params: { mobiles: '<n1>,<n2>,…', template_id:
  '<any Flow id in the account>', sender: '<any sender id>' }, … })` directly through PostgREST. Result: `pending`, then
  `message.send` → `done`. The request sent to `https://control.msg91.com/api/v5/flow/` was
  `{"template_id":"ATTACKER_FLOW","sender":"EVILID","short_url":"0","mobiles":"917000000001,917000000002",…}`. The
  patient's own number was gone from it. Impact: bulk SMS from the clinic's DLT sender to arbitrary Indian numbers
  through any approved Flow template on the platform's MSG91 account. That account is shared by every clinic, so a
  template another clinic or the platform uses is also reachable. Results: billing abuse, DLT/TRAI sender-reputation
  damage, and phishing under the clinic's name. Rate limit: none. The comma list is limited only by the 4 KB cap.
- **Fix:**
  1. In `Msg91Provider.sendSms`, build the body from the template's declared variables only and spread the params
     first (`{ ...vars, template_id, sender, short_url, mobiles }`). Better still, nest them under the Flow
     `recipients[].{mobiles, VAR…}` shape so they cannot collide with control keys.
  2. In SQL, give each template its declared parameter names (`ops.message_templates.params text[]`) and refuse any
     other key (`INPUT_INVALID`). Do the same for the WhatsApp catalogue.
  3. Add an MSW contract test: a param named `mobiles` / `template_id` never changes the request.
  4. Strip the same keys in `smsFallback`.

## Medium

### M-1 The request-path enqueue RPC has no permission check, so any role can message any patient of the clinic with chosen content

- `000035_message_enqueue.sql:264-295`: membership plus tenant constraint only. The server actions check permissions,
  but `enqueue_message` is reachable directly by every role, nurse included. CLAUDE.md requires "Every server action /
  route … checks permission", and this RPC is an action surface.
- Content control is weak. The five bot templates (`appointment_confirmed_ack`, `appointment_cancelled_ack`,
  `appointment_reschedule_link`, `conversational_triage`; seeded `:70-74`) are not in the WhatsApp catalogue, so
  `msg91.ts:183-203` sends `params.message` as **free text**. The probe proved it: the nurse's
  `p_template_params: { message: "PROBE free text http://phish.invalid" }` reached MSG91's text endpoint verbatim, to the
  patient's number. Twilio does the same (`twilio.ts:50,125`). Catalogue templates also accept up to 1 024 chars of
  free text per body variable.
- Other caller-chosen fields with no limit: `p_run_at` (any future time), `p_message_type`, and `p_metadata`, of which
  only `system_actor` is stripped (`:294`). `metadata.is_sms_fallback` suppresses the fallback. `metadata.appointment_id`
  / `visit_id` feeds the inbound correlation (L-2).
- **Fix:**
  - Gate `enqueue_message` on the role/permission set of the call sites, e.g. `current_user_has_role(p_tenant_id,
    '{owner,admin,doctor,receptionist}')`, or a permission helper.
  - Refuse request-path use of the bot templates. Add `ops.message_templates.request_ok` so they are system-only.
  - Allow-list metadata keys (`buttons` only, with a fixed shape).
  - Bound `p_run_at`, e.g. to 90 days or less.

### M-2 Caller-chosen dedupe keys share the system's namespace: a member can pre-empt and suppress lifecycle messages

- `000035_message_enqueue.sql:185-195`: the unique key is `(tenant_id, dedupe_key)` for both the request path and the
  system path. Real keys are predictable: `appointment_booked:<visit_id>`, `appointment_cancelled:<visit_id>`,
  `appointment_rescheduled:<visit_id>:<iso>`, `msg-fallback:<queue_id>` (`features/appointments/system.ts`, the
  scheduling service, `message-send.ts:149`).
- **Exploit:** a member enqueues with the real key first, using channel `in_app` (sends nothing), or `p_run_at` far in
  the future, or their own params. The real booking, cancellation or reschedule message, or the SMS fallback, then
  returns `deduped: true` and is never sent. The patient misses a cancellation notice, or gets the attacker's version.
- **Fix:** namespace request-path keys in SQL (e.g. `'u:' || p_dedupe_key`), or reject request-path keys that use a
  reserved system prefix. Better, derive lifecycle keys in SQL from the subject, as 000036 does for webhook event
  keys.

### M-3 Inbound webhook: transient failures are recorded as `ignored`/`processed`, so the patient's action is lost for good

- `app/api/webhooks/messaging/[provider]/route.ts:334-344`: when `cancelAppointment` fails, the handler returns
  `"ignored"`, and `finish(ignored)` sets `processed_at`. MSG91's retry then reads `duplicate` and the cancellation never
  happens. The slot is not released and the patient believes they cancelled. The same pattern swallows errors in
  `queueReply` (`:219-236`) and `enqueueUnmatchedReplyAsSystem` (`:261-269`): a DB error loses the reply permanently,
  although the header (`:27-29`) says a retry is safe and intended.
- `:68-71`: `in_flight` answers 200. If the first instance dies without a response (the 500 path does not run), MSG91's
  retry inside 5 minutes gets 200 and stops retrying.
- **Fix:**
  - Throw on enqueue or cancel errors, so the outer handler records `failed` and returns 500. The status guards and
    `bot:<key>:<template>` keys make the retry idempotent.
  - Return `ignored` only for a business no-op (visit not actionable).
  - Answer `in_flight` with 409 or 503 so the provider retries.

## Low

- **L-1 ESLint P0-12 is bypassable with dynamic `import()`.** `eslint.config.mjs:327-346` uses
  `no-restricted-imports` only. Linting `features/billing/x.ts` from stdin:
  `await import("@/lib/messaging")` and `await import("@/lib/webhooks/dispatcher")` produce **no error**. The P1-34
  `ImportExpression` selectors (`:195-204`) cover system/internal modules only. **Fix:** add `ImportExpression` selectors
  for `MESSAGING_BARREL`, `MESSAGING_PROVIDER_MODULE` and `WEBHOOK_DELIVER_MODULE` outside the allowed zones, plus a
  failing fixture.
- **L-2 Reply correlation trusts row metadata.** `route.ts:166-168` falls back to `metadata.appointment_id` /
  `metadata.visit_id` when `appointment_id` is null. With M-1, a member can send patient P a message whose metadata
  names patient Q's visit, in the same clinic only, because the visit read is tenant-filtered. P's "confirm" or
  "cancel" button then changes Q's visit, and "reschedule" sends a reschedule link for Q's visit to P's phone. That
  exposes Q's appointment to P (DPDP). **Fix:** use only the `appointment_id` column, and drop the metadata fallback,
  or strip those keys in `enqueue_message`.
- **L-3 `lab_result.ready` accepts any patient document.** `000036_webhook_enqueue.sql:372-378` sets `o_state_ok = true`
  for every `patient_documents` row. Any member can push any document's `title` to the clinic's webhook endpoints, and
  titles can carry diagnoses. The receiver is the clinic's own subscriber, so the impact is minor. **Fix:** require the
  document's lab/report category, the same way `appointment.cancelled` checks status.
- **L-4 Send Email hook `in_flight` → 409.** `app/api/auth/send-email/route.ts:307-310`. Check that GoTrue's HTTP hook
  retries a 409. If it retries only on 429/503 (my recollection, not verified here), the user sees an error while the
  first instance is still sending, and that send may itself fail with no retry. **Fix:** answer 503 with
  `Retry-After`, or wait briefly for the record to finish. Add a test against local GoTrue's retry behaviour.
- **L-5 Inbound dedupe fallback key is body-hash only.** `lib/messaging/webhook-helpers.ts:77,289-290`: the message-id
  field names are unverified against a live MSG91 payload (the code says so). Suppose the payload has no id and no
  timestamp. Then a patient who sends the same free text twice within the 30-day retention ("hi", "1") gets the second
  message silently dropped as `duplicate`, with no triage note. **Fix:** confirm the payload's id field before go-live,
  or add the provider timestamp to the hashed material. The 04-05b/V2-12 staging check is the place.
- **L-6 DLR note uses the raw provider reason.** `route.ts:138` interpolates `event.reason` unvalidated into
  `in_app_notifications.message`. It is behind the secret and React escapes it. Use the same `REASON_CODE` filter as
  `:118`. The phone in the same copy is already flagged for V2-12.

## Checked and holding (no finding)

- **Tenant binding (R-6 revised):** `enqueue_message` / `enqueue_webhook_event` derive the tenant from the subject and
  require it to equal `p_tenant_id` and to be a membership. Visit/patient mismatch is P0001 after the tenant check. A
  forged visit or patient of clinic B, a dual member acting in A, and a nonexistent id all read P0002. The system
  RPCs refuse when `auth.uid()` is set. The closed actor set is enforced.
- **Catalogue (local stack):** `authenticated` can execute only `enqueue_message` and `enqueue_webhook_event` among the
  queue, inbound, DLR and replay functions. `communication_queue` member SELECT covers status columns only (no
  `template_params`, `recipient_phone`, `metadata`, `external_message_id` or `dedupe_key`). The 000038 contract
  assertions cover both queue tables. `ops.*` and `private.*` writers are revoked from every API role.
  `ops.replay_job` is postgres-only.
- **Recipient restriction in SQL (R-24):** patient or guardian only, compared on national digits. In-app recipient
  must be a member of the subject's clinic. Undone only by H-1 at the provider layer.
- **Webhooks:**
  - The claim joins the subscription, and the handler refuses a tenant mismatch before any POST.
  - The production registry passes no seams, so SSRF pinning, https only and no redirects hold on the job path.
  - Payload data is built in SQL from the subject (no caller payload). Event keys dedupe per subscription.
  - The ping is owner/admin, 5/min under an advisory lock.
  - `webhook_delivery_finish` caps retries at 5.
- **Inbound secret:** SHA-256 then `timingSafeEqual`, fails closed, 401 before any DB access.
- **Inbound correlation:** by `external_message_id` plus same-mobile E.164 check. The visit is read inside the queue
  row's tenant.
- **DLR:** monotonic, one transaction, no phone in the audit row, ambiguous ids ignored.
- **Unmatched replies:** E.164 Indian mobile only, `unmatched_ok` template only, actor fixed, tenant-less job. The
  phone is redacted by trigger once the job leaves `pending`/`running`, and replay refuses that kind.
- **Send Email hook:**
  - Signature is checked before parsing and before any store access.
  - The webhook-id shape is checked before the store.
  - The store fails open, and the table holds no address, code or token.
  - Concurrent `begin` serialises on the unique insert plus `FOR UPDATE`.
  - Unfinished or failed keys reprocess after 5 minutes.
  - The Resend idempotency key is `sha256(webhook-id)/index`, stable per message.
  - The Resend request is JSON (no header injection). `to` is zod-validated. The key never appears in errors or logs.
  - Resend uses `redirect: "error"`, a 3 s bound under the 3.5 s hook budget, and error bodies are never read.
- **ESLint A3:** only `app/api/auth/send-email/route.ts` may import `@/features/auth/system`. A feature file importing
  it fails, as do static P0-12 imports, named or namespace.

## Suggested gate actions

1. Fix H-1 (provider plus SQL param allow-list) with an MSW regression test. This blocks the merge.
2. Fix M-1, M-2 and M-3 in this phase. They are small SQL and route changes, and each comes with a DB test (nurse
   refused; reserved key refused; failed cancel answers 500 and the retry cancels).
3. L-1 through L-6 can be triaged into V2-04 close or V2-12 with an owner each.
