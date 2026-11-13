# V2-03 adversarial review, group C: logging, PII/PHI, error sink, diag route

Reviewer: isolated Claude reviewer (fresh context, hostile). Diff `origin/feature/v2..3f81bfb`. Date 2026-11-13.
Method: read the plan (03-09a/b/c, threat model, R-6/R-7/R-18, E9), `docs/v2/DATA_HANDLING.md`, then the code;
ran an attack corpus against `scrubMessage` / `scrubFrames` / `routePattern` / `sanitiseFields` / `buildErrorEvent`
(scratch `tsx` script, no repo changes); read Next 16.4.6's own error-logging paths in `node_modules`. No hosted
service was contacted, no `.env*` read, local stack untouched. Implementer records were read only after the findings
were written (two findings below were already listed by the implementer as residuals; that is noted, not used to
lower severity).

**Counts: Critical 0 · High 1 · Medium 3 · Low 5 · Info 5.**

---

## High

### H-1 Every uncaught server error is printed raw to stderr by Next.js (Vercel function logs), bypassing the logger and the scrubber

- **Where:** not in the diff, which is the problem. `instrumentation.ts:19-27` only adds the sink; Next still logs
  first: `node_modules/next/dist/server/route-modules/route-module.js:320-326` (`if (!silenceLog) console.error(err)`
  for route handlers, `silenceLog = false` at `build/templates/app-route.js:352`), `server/app-render/create-error-handler.js`
  (render errors → `onReactServerRenderError`), `server/base-server.js:451` (`logError` → `_log.error(err)`).
- **Input → output:** `POST /api/diag/error` (or any route/page/action that throws). Node's `console.error(err)` prints
  the message, the stack and every own enumerable property. Reproduced with the real classes:
  ```
  PostgrestError: duplicate key value violates unique constraint "patients_phone_key"
    details: 'Key (tenant_id, phone)=(7d1c0b9a-…, +919000000001) already exists.',
    code: '23505'
  Error: Diagnostic error (synthetic): Key (phone)=(+919000000000) contact diag.synthetic@example.com
  ```
  A thrown `PostgrestError` (e.g. `features/notifications/triggers.ts:114` `throw error;`, currently unused) prints
  `details` with row values; a thrown `Error` carrying a storage path prints the patient's name
  (`lib/storage/supabase-provider.ts:51` interpolates `tenants/<uuid>/patients/<uuid>/labs/Ramesh_Kumar_…pdf`, built by
  `features/labs/utils.ts:14`).
- **Why High:** T-03-03 ("PHI in logs") is the phase's top information-disclosure threat and acceptance P1-25 claims
  the structured logger replaced raw logging. The one channel that receives *every unexpected* error is still raw.
  DATA_HANDLING §2 row 51 and §4 row 96 already list Vercel logs as PHI-bearing and "global"; C39 requires error
  tracking to be India-resident. The e2e diag test (`tests/e2e/observability/error-sink.spec.ts`) checks the response
  body and the sink row but never the server's stderr, so the leak is invisible to the gate. (Implementer flagged this
  as a residual in `03-09b-ERROR-SINK.md` §Residuals; it was not resolved.)
- **Fix:** in `register()` (Node runtime), wrap `console.error`/`console.warn` once: any `Error`/object argument is
  replaced by `{ name, code: errorTag(err), digest, message: scrubMessage(err) }` (no stack, no own props), strings
  pass through `scrubMessage`. `instrumentation.ts` is already allowed `process.env`; give it the `no-console`
  exemption it needs. Add an e2e assertion: capture the Playwright `webServer` stderr during the diag call and assert
  none of `DIAG_SYNTHETIC` values appear (fails today). Until then, record in DATA_HANDLING that Vercel function logs
  receive unscrubbed error text, and set the India log drain + short retention as a gate condition for production.

---

## Medium

### M-1 The "closed" logger accepts arbitrary free text in `reason`, `action`, `module`, `route` (and phone-sized numbers)

- **Where:** `lib/log/fields.ts:33-45` (types are plain `string` / `number`), `:52`, `:77-85` (only truncation to 120).
- **Input → output** (demonstrated with `sanitiseFields`):
  `{ event:"a.b", reason:"Key (phone)=(+919876543210) ramesh@x.com", route:"/r/secrettoken123?phone=98", action:"9876543210", count:9876543210, status:919876543210 }`
  → written verbatim: `{"event":"a.b","route":"/r/secrettoken123?phone=98","action":"9876543210","reason":"Key (phone)=(+919876543210) ramesh@x.com","status":919876543210,"count":9876543210}`.
- **Why Medium:** R-6's premise is "PHI safety by type rather than a redaction deny-list", but `reason: err.message`
  type-checks today; only `message` is excluded. I sampled the 224 `log.*` calls in `app/ features/ lib/`: every
  current value of these keys is a literal or a fixed mapping (`send-email` `action` is `actionLabel(...)`,
  `signout` `reason` is the scope enum), so no live leak — but nothing stops the next one, and `logger.spec.ts` only
  tests a `message` key.
- **Fix:** `action`/`module`/`reason` must match `^[a-z0-9_.:-]{1,64}$` (drop otherwise); `route` must pass
  `routePattern()` (no `?`/`#`, no token-shaped segment, see L-4); `status` integer 100–599; `count`/`durationMs`
  non-negative integers ≤ 1e7. Narrow the TS types (template-literal or branded) so `reason: err.message` does not
  compile. Add spec cases for each key carrying the phone/email corpus.

### M-2 Scrubber misses common Indian phone/ID formats and two Postgres-detail shapes

- **Where:** `lib/observability/scrub.ts:33,35,43,50,56-59`; DB second line `000028:200-202` only covers ASCII email,
  `?query`, `\d{6,}`.
- **Survives `scrubMessage` (input → output unchanged unless shown):**
  | Input | Output |
  |---|---|
  | `9876 543 210`, `987 65 43 210`, `98-76-54-32-10`, `98765.43210`, `98765_43210` | unchanged |
  | `+91 (987) 654-3210` | unchanged |
  | Aadhaar `2345-6789-0123`, `2345.6789.0123` | unchanged |
  | ABHA address `ramesh.kumar@abdm` | unchanged (no TLD) |
  | `rämesh@exämple.in`, `ramesh@localhost` | unchanged |
  | `Key (lower(name::text))=(ramesh kumar) already exists.` (expression index) | unchanged — `[^)\n]*` stops at the inner `)` |
  | `Failing row contains (abc, Ramesh Kumar\nnext line diabetic).` | `Failing row contains (abc, Ramesh Kumar next line diabetic).` — `.*` does not cross the newline, the whole row leaks |
  | fullwidth digits `９８７６５４３２１０` | unchanged |
- **Why Medium, not High:** the sink stores only `err.message`; PostgREST puts `Key (…)` / `Failing row` in `details`,
  not `message`, and no migration `RAISE`s with PHI (`grep RAISE EXCEPTION '…%'` → one admin-only message). So these
  need a code path that copies `details` into a message. But the plan's own corpus requirement (03-09b step 2) is
  "none survive", and the H-1 fix will route *all* stderr text through this scrubber, which raises the stakes.
- **Fix:** add a separator-tolerant number rule before `DIGIT_RUN`: any run of ≥ 8 digits interleaved with
  `[\s.\-_()]` (`/(?:\+?\d[\s.\-_()]{0,2}){8,}\d?/g` with a digit-count check) → `[NUMBER]`; normalise Unicode digits
  (`\p{Nd}` with `u` flag) first. Email: `/[^\s@<>"'()]+@[^\s@<>"'()]+/gu` (covers `@abdm`, IDN, `localhost`).
  `Key \(.*?\)=\([\s\S]*` → `Key ([REDACTED])` to end of text; `Failing row contains \([\s\S]*`. Add each row above
  to `scrub.spec.ts`.

### M-3 ~80 server-side paths still return raw `err.message` to the client (response leak)

- **Where (count):** `git grep -nE "error: err instanceof Error \? err\.message" -- features lib app` → 69 single-line
  sites, plus multi-line ones (`features/billing/service.ts:228,610,730,912,933,1456`). Highest risk, because the
  message is a database or storage error rather than an app-authored one:
  - `features/consultation/service.ts:271,288,374,390,401,414` `throw new Error(<pgErr>.message)` → returned at
    `:305`, `:468`; `:888` returns `"Failed to create audit revision record: " + revErr.message` directly.
  - `features/billing/service.ts:144` `throw new Error(rpcErr?.message)` → `:228`.
  - `features/clinics/actions.ts:58-60` returns `dbError.message` from `create_clinic_with_owner`.
  - `lib/storage/supabase-provider.ts:51,83,95` → `features/labs/service.ts:183,413`: the response contains the
    storage key `clinic-records/tenants/<tenant uuid>/patients/<patient uuid>/labs/<Patient_Name>_<file>_<date>.pdf`
    plus the Storage API error text.
  - `features/dpdp/erasure.ts:45,65`, `features/dpdp/export.ts:76`, `lib/messaging/dispatcher.ts:102` interpolate DB
    messages into thrown errors.
  - Not leaking: the ~30 `app/api/v1/**` sites, because `lib/api/envelope.ts:55-60` replaces every 5xx /
    `DATABASE_ERROR` message (verified).
- **Input → output (by construction, not executed):** any PostgREST error on those queries is returned verbatim,
  e.g. `{ success:false, error:'invalid input syntax for type uuid: "<caller input>"' }` (22P02) or
  `new row for relation "<table>" violates check constraint "<name>"` (23514): the caller's input echoed back plus
  table and constraint names. Callers are same-tenant staff, so impact is schema disclosure and echo, not cross-tenant PHI.
- **Why Medium:** pre-existing (base had 102 matches) and listed as a residual in `03-09c-SWEEP.md`, but the helper to
  fix it (`clientErrorMessage`, 24 users) already exists and P1-25/IR-L1 intent is "no raw error text out".
- **Fix:** mechanical sweep to `clientErrorMessage(err, "<fallback>", "<event>")`; add a 03-04 counter
  (`raw_error_message_returns`, expected 0) so it cannot regress.

---

## Low

### L-1 Sink fingerprint includes short numbers and free text → one bug can burn the daily cap and blind the sink
`000028:204-207` hashes the scrubbed message; digit runs < 6 survive both scrubbers. An error whose text varies per
request (`Unexpected token X in JSON at position 123`, row counts, ports, zod paths) creates a new fingerprint per
request; after 500 new fingerprints (`:226`, cap shared by all routes) every *other* new error that UTC day is reduced
to `error_event_overflow.dropped += 1` with no detail. I found no cheap unauthenticated trigger today (all
`req.json()` calls are wrapped), so Low. **Fix:** fingerprint on a normalised message (`\d+`→`N`, quoted values →
`V`) and on frames, not raw text; cap per `(route_path, error_name)` as well as per day; alert on overflow > 0 (V2-04).

### L-2 Request id is spoofable where the proxy does not run, and for proxy-thrown errors
`proxy.ts:118` excludes `.*\.(svg|png|jpg|jpeg|gif|webp)$` outside `/api`. `GET /patients/x.png` with
`x-request-id: <attacker UUID>` reaches the dynamic page without the overwrite; `getRequestId()`
(`lib/log/request-id.ts:18-25`) and `requestIdFrom()` (`lib/observability/error-event.ts:73-77`) accept any UUID.
For errors thrown inside the proxy, Next passes the *inbound* headers (`build/templates/middleware.js:105-112`).
Effect: an attacker can file log lines / sink rows under a chosen id (T-03-07 repudiation). **Fix:** drop the image
extension exclusion for non-`_next`/non-`public` paths, or have the proxy set a second, proxy-only header and ignore
`x-request-id` when absent; in `buildErrorEvent` store `request_id = null` when `route_type === "proxy"`.

### L-3 `error_name` and `error_code` are stored unscrubbed
`lib/observability/error-event.ts:93,103` only shape-check. `{ name: "9876543210", code: "ramesh.kumar_9876543210" }`
→ stored as `error_name: "9876543210"`, `error_code: "ramesh.kumar_9876543210"` (demonstrated); the DB re-scrub
(`000028:200-202`) touches only `message`. Third-party errors sometimes put values in `code`. **Fix:** drop either
value if it contains `\d{6,}` or `@`; prefer `error_code` only when it matches SQLSTATE (`^[0-9A-Z]{5}$`), `PGRST\d+`
or `^[A-Z][A-Z0-9_]{2,39}$`.

### L-4 `routePattern` accepts concrete paths with tokens
`lib/observability/scrub.ts:113-118` / DB `:165`: `/r/abcDEF1234567890token` and `/patients/9876543210` pass (only
`?`/`#` are cut). Today Next passes the pattern (`normalizedSrcPage`, `/proxy`), so no live leak, but the defence the
docstring claims ("never a concrete path") is not enforced. **Fix:** reject any segment that is not `[name]`,
`[...name]`, `(group)` or a lowercase static slug (`^[a-z0-9_-]{1,40}$`); same rule for the log `route` field (M-1).

### L-5 Token rules need a digit; `sb_secret_`/`sb_publishable_` and all-letter tokens survive
`scrub.ts:50`: `sb_secret_abcdefghijklmnop`, `sb_publishable_abcdefghijklmnopqrstuvwx`,
`/r/abcdefghijklmnopqrstuvwxyzABCDEF`, `/reschedule/Zq_-abcdefghijklmnopqrst` pass unchanged. Real keys and tokens
almost always contain a digit, so the chance is small, but the prefixes are known and cheap to match. **Fix:** add
`\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+` and path-token rules for `/r/`, `/reschedule/`, `/api/r/`,
`/reports/view` segments; drop the digit requirement for ≥ 24-character runs.

---

## Info

- **I-1 ReDoS:** none found. 4 000-character adversarial inputs per rule (`Key (` without close, `(((`, `+91 `
  repeated, `a1…!`, `a.a.…@`) run in ≤ 8 ms; input is cut to 4 000 characters first (`scrub.ts:72`).
- **I-2 Things that hold:** `cause` chains, `AggregateError.errors`, non-string `message` (`toString` objects) and
  thrown strings never reach the sink (verified); function names and columns are dropped from frames; `ops` has no
  API grant, RLS on, `search_path = ''`; the ingest key is compared by SHA-256 from vault and length-bounded; the sink
  never reads the response body; diag route order bearer → flag → throw is correct and production refuses the flag;
  `apiError` hides 5xx text; `reportClientError` is a production no-op; no `console.*` remains in `app/ components/
  features/ lib/` outside `lib/log/client.ts`.
- **I-3 Test gaps:** `logger.spec.ts` never puts PHI in `reason/action/module/route`; `scrub.spec.ts` corpus lacks the
  M-2 variants; the e2e diag test does not inspect server stderr (H-1); `on-request-error.spec.ts` does not cover a
  thrown `PostgrestError` with `details`.
- **I-4 Platform request logs:** Vercel request logs record concrete paths (share tokens in `/r/<token>`,
  `/reschedule/<token>`) and the `?next=` query from `proxy.ts:30-33`; outside app control, but belongs in the
  DATA_HANDLING processor row and the log-drain retention decision.
- **I-5 Ingest key in transit:** sent in the RPC JSON body; Postgres does not log bind parameters on error by default
  (`log_parameter_max_length_on_error = 0`). Confirm on staging during E9 that API/Postgres logs show no body.

## Recommended gate disposition
H-1 should be fixed (console wrapper + stderr assertion) or explicitly accepted by the PO with the Vercel-log
mitigation recorded, before acceptance item 8 / T-03-03 is marked mitigated. M-1 and M-2 are small, contained fixes
in `lib/log/fields.ts` and `lib/observability/scrub.ts` and should land in this phase. M-3 can be a tracked follow-up
with a 03-04 counter if the PO agrees.
