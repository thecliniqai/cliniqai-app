# V2-01 review round 3: adversarial verification of the round-2 fixes

Scope: `git diff 27e6a92..9eb7b59` (plan 01-09). Read-only review. Evidence comes from source reading, Next 15.5.28 routing
code in `node_modules/next`, `node --experimental-strip-types` runs of `lib/api/enabled.ts`, and read-only queries on the
local stack (migrations 000020–000023 applied). No tests were run.

## Verdict: PASS-WITH-FIXES

No Critical or High findings. Both round-2 Highs are closed, and each is enforced in two layers. L1 is only partly
closed: raw share tokens no longer sit in `document_share_tokens`, but they are still stored in `communication_queue`,
which every member can read. The fix also adds one new Low regression (a Sign & Bill retry race can create duplicate
invoices).

| Original | Status | Evidence (short) |
|---|---|---|
| AR2-H1 storage path escape | CLOSED | Rules in the DB, the CHECKs and the app agree. All 3 CHECKs are `convalidated = t`. Every signing path goes through `validateStoragePath`. |
| AR2-H2 `/api/v1` switch bypass | CLOSED | The middleware normalises paths, and every v1 handler checks the flag first (15/15 route files). |
| AR2-L1 raw tokens readable by members | **NOT CLOSED (partial)** | The `token` column is gone, but raw tokens are still in `communication_queue` (N1). |
| AR2-L2 queue reopens signed visits | CLOSED (app level) | The precondition sits in the UPDATE filter. Direct PostgREST UPDATE on `visits` is still open; that was already deferred to P1-03. |
| AR2-L3 webhook sender match | CLOSED | Residual Info N3. |
| AR2-L4 late WhatsApp cancel/reschedule | CLOSED | Status filter in the UPDATE, plus 000023 guards on create, context and consume. |
| AR2-L5 deleteLabDocument path / audit | CLOSED | `isPatientStoragePath` gate added; `storage_path` removed from the audit row. |
| AR2-Info NULL doctor / v1 error text | CLOSED | 000023 returns `unavailable`; the v1 route returns a fixed message. |

---

## H1: storage path escape (CLOSED)

What I tried:
- **DB rule** `is_safe_storage_key` (local, real function). Refused: `a/./b`, `a/../b`, `a/b/`, `/a`, `a//b`, a trailing
  `\n`, `%2e%2e`, `é`, `ǅ`, full-width `Ａ`, `İ`, `ſ`, `chr(1)`, empty, `.`, `..`, NULL. Accepted: `a/.../b` and `a/b.`.
  Neither of those is a dot segment for WHATWG URL parsing, storage-js or S3, so there is no escape. Postgres ARE ranges
  are code-point based (no collation folding); the `~` match is case-sensitive; `$` matches only at end of string; newline
  is outside the class anyway.
- **CHECKs**: `patient_documents_storage_path_shape`, `prescriptions_pdf_storage_path_shape` and
  `referrals_pdf_storage_path_shape` are all `convalidated = t` locally. No NOT VALID constraint is left. NULL
  `storage_path` or `tenant_id` fails the patient_documents CHECK. The prescription regex is built from `uuid::text`
  (hex and `-` only, so no regex metacharacters) and anchored at both ends. CHECKs also apply to service-role writes.
- **Write paths**: lab upload (`formatAmendedFilename` now reduces name and extension to `[A-Za-z0-9_-]`), the v1 lab-orders
  POST (`isPatientStoragePath`), the prescription generator (derived `<tenant>/<visit>/rx_vN.pdf`) and the referral
  generator (derived). The CHECK backs up all of them.
- **Signing call sites** (`features/labs/service.ts:250`, `sharing/system.ts:84`, `referrals/service.ts:504`,
  `referrals/pdf/generator.ts:87`, `prescriptions/pdf/generator.ts:122`, `billing/pdf/generator.ts:112`) all go
  through `getSignedUrl`, which calls `validateStoragePath`, which now applies `isWellFormedStorageKey`. The same holds
  for `deleteFile`, `downloadFile` and `uploadFile`.
- **Bucket tricks**: the bucket comes from the resolver (a fixed literal per type) and is checked against `BUCKETS`. R2
  uses the bucket name directly as the S3 bucket, so it cannot be confused with a key prefix.
- **Re-pointing a row**: a member can UPDATE `patient_documents` and `prescriptions`, but the CHECK binds the path to the
  row's own `tenant_id` and `patient_id`/`visit_id`. A link can only be re-pointed inside the member's own tenant
  (Info I1).

## H2: `/api/v1` switch (CLOSED)

Layer 1, middleware (`apiRequestBlocked`, run on harness inputs):
- Blocked: `/api/v%31/…`, `/api%2Fv1/…`, `/api/v1%2fpatients`, `/API/V1/…`, `/api/v1`, `/api/v1/`, `/api//v1/…`,
  `/api/./v1/…`, `/x/../api/v1/…`, double, triple and quadruple encoding (`%2531` …), `/api%5Cv1/…`, undecodable
  `%ZZ`, and any path still changing after 5 rounds.
- Not blocked, but none of them routes to a v1 handler: `/api/v1.`, `/api/v1;x/patients`, `/api/v1%00/patients`,
  `/api/vı/…`. Next 15.5.28 strips none of `.`, `;`, NUL or case. `filesystem.getItem` matches the raw path or a
  single-decoded path exactly, and the dynamic route regexes are case-sensitive and anchored.
- `_next/data/<id>/api/v1/x.json`: `NextURL` (parseData) hands the middleware `/api/v1/x`, which is blocked. Routing only
  rewrites it for the real buildId and only to page data routes.
- `.rsc`/RSC: the RSC normaliser runs only in minimalMode, and `/api/v1/x.rsc` is still under `/api/v1/` for the
  middleware.
- Dot segments: the deepest dynamic v1 route has one `[id]` segment, so a `..` cannot climb out of `/api/v1` and still
  match a v1 route. The middleware resolves dots too.
- Matcher coverage: resolve-routes tests the matcher against both the raw and the once-decoded pathname, and
  `/api/:path*` plus the catch-all cover every path that routing can decode to `/api/v1/*`.
- No `basePath`, `i18n` or `rewrites` in `next.config.ts`. `x-middleware-subrequest` (CVE-2025-29927) is fixed in 15.5.x.

Layer 2, handlers: I enumerated all 15 `route.ts` files under `app/api/v1`. Every exported handler either calls
`authenticateApiKey` as its first statement (it now returns `apiV1NotFound()` when the flag is off, before any key
lookup) or checks `apiV1Enabled()` first (`docs`, `openapi.json`, `patients/[id]/export`). The only work done before
that check is `getAdminClient()` construction, which reads no data. There are no non-route files and no re-exports of
v1 handlers. HEAD maps to GET. The auto-OPTIONS response would reveal only the `Allow` header, and only if the
middleware were bypassed, which I could not achieve.

## L1: share-token hashing (NOT CLOSED, partial)

Closed parts: the `token` column is dropped (local `pg_attribute`). The `token_hash` CHECK is `^[0-9a-f]{64}$` and
UNIQUE. Every resolver hashes the presented token (`share_token_hash`, not executable by members). A hash cannot be used
as a token because SHA-256 of the hash does not equal the hash. Members still have SELECT only on the row, with no
INSERT or UPDATE grant. Audit rows hold `token_id` only. RPC arguments are bound, so they are not in
`pg_stat_statements` text. The lookup goes through a unique index, so there is no useful timing signal. The reschedule
token is sent directly (`sendDirectWhatsApp`) and is not queued.

### N1 (Low, keeps L1 open): raw share tokens are still persisted where every member can read them

- `communication_queue` policy `communication_queue_tenant_isolation`: `ALL` for `authenticated`, condition
  `tenant_id IN current_user_tenant_ids()`. It applies to every role and allows SELECT, UPDATE and DELETE.
- Raw links and tokens are written to it:
  - `features/labs/service.ts:462-469`: `template_params.document_url`, `metadata.share_token`, `metadata.share_url`
  - `features/referrals/service.ts:610-616`: same fields
  - `features/prescriptions/service.ts:744-761`: same fields
  - `features/billing/service.ts:1118-1129`: same fields plus `buttons[].url`
  - `features/billing/service.ts:1294-1340`: Sign & Bill, `prescription_url`, `receipt_url` and button URLs
- Steps: as a receptionist, run
  `select template_params, metadata from communication_queue where message_type in ('consultation_documents', …)`
  (PostgREST with the user JWT).
- Gain: the round-2 L1 scenario is unchanged. The receptionist gets the prescription links that `share_type_roles`
  forbids them to mint, can use them without login and without attribution for 7 days, and keeps them after their
  membership is removed.
- Related (pre-existing): a member can also UPDATE a pending row's `recipient_phone` and redirect a link.
- Fix:
  1. Stop writing `share_token` and `share_url` into `metadata`.
  2. Redact the URLs in `template_params` and `buttons` once the message is dispatched (or keep them in a
     service-role-only column).
  3. Restrict member SELECT and UPDATE on `communication_queue`, at least to the columns that never carry links.

## L2–L5, Info, and the new code

- **L2** (`features/queue/service.ts`): a single UPDATE with `.in(status, open)` and `.is(signed_at, null)`, so there is
  no window between read and write. Only `in_consultation` and `completed` are accepted. A no-op on a completed visit
  updates `queue_tokens` only. A reopened-for-amendment visit has `signed_at` set and is refused. The residual direct
  `visits` UPDATE through PostgREST was already deferred (P1-03).
- **L3**: `toIndianMobileE164Strict` refuses `+1 917 123 4567`. See N3 for the remaining edge case.
- **L4**: confirm uses `.eq(status, 'booked')`. Cancel uses `onlyFromStatuses` in both the pre-check and the UPDATE
  filter. Reschedule is gated in the app, and 000023 refuses anything other than `booked`/`confirmed` on create,
  context and consume. In consume, the visit is locked `FOR UPDATE`, then the per-doctor advisory lock is taken; the
  overlap EXISTS runs after the lock in READ COMMITTED, so it sees a concurrent commit. NULL `doctor_id` returns
  `unavailable` before the lock. The deployed `prosrc` contains the new guard (checked locally).
- **L5**: confirmed (see the table).
- **DPDP export route** (`app/api/patients/[id]/export/route.ts`):
  - Uses the session only (`resolveServiceContext('exports:create')`, owner only, `*`) and runs no service-role client.
  - The tenant comes from the session. The id must be a UUID before it reaches the filename.
  - Error bodies are fixed strings. Responses carry `no-store`.
  - A cross-site GET can only trigger a download in the victim's own browser (SameSite cookies), so there is no read.
  - The v1 variant is flag-gated, and its cookie branch now requires `exports:create`.
  - There is no other caller of `exportPatientDpdpArchive`.
  - Info I2: `exports:create` is an app-level boundary only. RLS still lets every member SELECT the underlying PHI tables
    directly, so this ruling limits the one-click bulk path, not the data (already known; V2-05/P1).

### N2 (Low, new regression): a Sign & Bill retry race creates duplicate invoices and payments

- The IR2-L1 change (`features/billing/service.ts`, `signedVisitAwaitingInvoice`) does read-then-act with no lock.
- `invoices` has no unique constraint on `(tenant_id, visit_id)` (local `pg_indexes`: only `idx_invoices_tenant_visit`,
  non-unique). `createVisitInvoice` does not deduplicate.
- Steps: the same doctor sends two Sign & Bill requests close together (double click, or a retry while the first is
  still running). Request A signs, then starts billing. Request B arrives after A's sign commits but before A's invoice
  insert, sees "completed, signed by me, no invoice", returns `resume`, and creates a second invoice. If
  `payment_collected` is set, it also records a second payment.
- Before this change, B failed at `completeAndSignConsultation` because the visit was already signed.
- Impact: billing integrity (double revenue, two receipt links). No cross-tenant effect.
- Fix: a unique partial index on `invoices(tenant_id, visit_id)` for non-void invoices, so the second insert fails and
  is mapped to `SIGN_AND_BILL_ALREADY_DONE_MESSAGE`; or take a row lock or advisory lock on the visit for the duration
  of the flow.

### N3 (Info): strict E.164 still accepts a bare 10-digit inbound `from`

- `toIndianMobileE164Strict` maps any 10-digit string that starts with 6–9 to `+91…`.
- A foreign number whose full international digits are exactly 10 and start with 6–9 therefore equals an Indian mobile.
  Example: Singapore `+65 9123 4567` → `6591234567` → `+916591234567`. Some `+60`/`+66` numbers behave the same way.
- Exploiting this also needs the `replyMsgId` of a message sent to the victim, so the practical gain is negligible.
- Fix (optional): for the inbound `from`, require a country-code form (12 digits starting `91`, or `+91`).

### Info I1: intra-tenant re-pointing

- Any member can UPDATE `patient_documents.patient_id`/`storage_path` (RLS `ALL`) or `prescriptions.visit_id`. A share
  link can then serve a different patient's object of the same tenant.
- This stays inside the tenant, and members already have that access. Recorded for P1-03 (clinical record immutability).

## Recommended before the gate

1. Fix N1 so L1 actually closes: no raw tokens in `communication_queue.metadata`; redact or segregate the URLs in
   `template_params` and `buttons`; tighten member access to the queue.
2. Fix N2: a unique per-visit invoice constraint (expand migration) or a lock in the resume path.
3. N3, I1, I2: record them; no action needed in V2-01.
