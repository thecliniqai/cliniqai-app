# 03-13d record: logging, PII scrubbing, raw error messages, SSRF and outbound-call fixes

**Outcome:** every 03-13d item of `03-13-REVIEW-TRIAGE.md` is fixed, each with a test that fails without the fix
(before/after tool output in `evidence/03-13d/`). Local stack only; no hosted service, no real outbound request (the
lanes' socket guards refuse every non-loopback connect; provider and webhook transports are injected or stubbed).
**H-LOG needs the fresh re-verification review (Highs rule).**

## Triage ID → commit → test

| ID | Commit | Test (fails without the fix) | Evidence (before → after) |
|---|---|---|---|
| **H-LOG** (C H-1) | `7b67008` | `tests/e2e/observability/error-sink.spec.ts` (built server's captured stdout+stderr for the diag error: carries `Key (phone)=([REDACTED])`, none of the synthetic phone/email/token); `tests/observability/console-scrub.spec.ts` (Error args, PostgREST `details`/`hint`, `cause` chain, strings, objects, idempotence, hostile args) | `h-log-e2e-before.txt` (Next printed `⨯ Error [DiagnosticError]: … diag.synthetic@… +9190… token=…`; 1 failed) → `h-log-e2e-after.txt` (7 passed; printed `⨯ DiagnosticError [DIAG_SYNTHETIC]: … [EMAIL] … [REDACTED]`), `h-log-unit-after.txt` |
| **M-LOGFIELDS** (C M-1) | `06fd200`, `4cd4c4b` (module paths for `getSystemDb` owners; envelope reason expectation) | `tests/observability/logger.spec.ts` "closed field values (03-13d)" (PHI corpus in `reason`/`action`/`module`, concrete routes, phone-sized numbers, `@ts-expect-error` that `reason: err.message` does not compile) | `m-logfields-before.txt` (14 failed) → `m-logfields-after.txt` (25 passed) |
| **M-SCRUB** (app half; C M-2, C L-3/L-4/L-5) | `3668e90` (vectors), `6058c9f` | `tests/observability/scrub.spec.ts` "shared scrub vectors (app layer)" over `tests/fixtures/scrub-vectors.json` (46 message vectors, 7 benign, 10 field, 13 route); 03-13c's DB spec runs the same file | `m-scrub-before.txt` (27 failed) → `m-scrub-after.txt` (146 passed) |
| **M-ERRMSG** (C M-3, 03-09c residual) | `be876e7`, `c060dfb` (session-refusal texts kept: the guard legs' "no session" check) | `tests/security/no-raw-error-responses.spec.ts`: a real 22P02 echoing a phone (`getPatientConsultationHistory`), a real Storage refusal on a key carrying a patient name (`getDocumentSignedUrl` + the provider's own message), 20 swept services over a client that throws a phone/email/named key, permission text kept | `m-errmsg-before.txt` (spec run in a worktree at `be876e7^`: 22 failed) → `m-errmsg-after.txt` (23 passed); census below |
| **M-XTENANT-WH** (E-1) | `aadb8f4` | `tests/api/webhook-dispatch-hardening.spec.ts` "tenant A's owner can insert a row naming B's subscription, and the dispatcher refuses it without sending" (PoC through A's RLS session; pinned and fetch paths) | `ssrf-webhooks-before.txt` → `ssrf-webhooks-after.txt` |
| **M-SSRF-V6** (E-3/E-4/E-5, IND M-1) | `aadb8f4` | `tests/api/webhook-ssrf.spec.ts` "IPv4-embedding IPv6, transition prefixes, special-purpose IPv4" (18 rows as address, as DNS answer, as bracketed literal; public NAT64/6to4 forms still allowed; userinfo refused) | same files (54 of the new cases failed before) |
| **M-SSRF-DNS** (E-2, IND M-1) | `aadb8f4` | `webhook-dispatch-hardening.spec.ts` "resolves once and pins host to the vetted address" (rebinding resolver consulted once; `host` = address, `servername`/`Host` = name) and "with the real transport, the socket is opened to the vetted address, never to the name"; test ping limit (below) | same |
| Low: provider/AI timeouts (E-6) | `a69fa3f` | `tests/messaging/provider-timeouts-and-synthetic.spec.ts` (hung MSG91 SMS / WhatsApp ×2, Gupshup, Twilio ×2, AI client settle as failures; bound asked = 10 s / 30 s) | `providers-before.txt` (7 hung, 12 failed in all) → `providers-after.txt` (157 passed, messaging + AI suites) |
| Low: webhook URL redacted in audit (E-7) | `aadb8f4` | `webhook-dispatch-hardening.spec.ts` "the subscription audit row records the endpoint origin, never its path or query" | `ssrf-webhooks-*` |
| Low: owner retry limit capped (E-8) | `aadb8f4` | same spec, "retry cap" (row `max_retries` 1000 → failed at 5; negative `retry_count` → 0) | same |
| Low: test ping rate limit (E-8, M-SSRF-DNS) | `aadb8f4` | same spec, "allows at most 5 test pings per tenant per minute" (6th and 7th refused unsent; 5 ping rows) | same |
| Low: error-sink per-fingerprint flood bound (C L-1) | `332992f` | `tests/observability/sink-flood.spec.ts` (65 varying errors on one route send 25; repeats and other routes still sent; one drop line, no message) | `sink-flood-before.txt` (2 failed) → `sink-flood-after.txt` |
| M-SEEDPHONE (messaging guard) | `a69fa3f` | `provider-timeouts-and-synthetic.spec.ts` "synthetic recipients are never sent to" (5 real providers × 6 forms, no fetch, `retryable: false`) | `providers-*` |

## M-ERRMSG census (before / after, by command)

Command: `bash evidence/03-13d/errmsg-count.sh` (every read of an error object's `.message` in `features/**` except
`auth`/`billing`, `app/**` except `app/api/v1`, `app/api/ready` and the auth routes, plus `lib/messaging`,
`lib/storage`, `lib/webhooks`).

| | Reads of `err.message` | Of which reach a response, a thrown message or a stored provider error |
|---|---|---|
| Before (`errmsg-census-before.txt`, at `332992f`) | **90** | **85** (90 minus the 5 classification reads below) |
| After (`errmsg-census-after.txt`) | **5** | **0** |

The 5 left are classification reads that return fixed text only: `app/api/patients/[id]/export/route.ts:50`
(`startsWith("Patient not found")` → fixed 404), `features/clinics/actions.ts:59` (`includes("unique")` → fixed
text; the other branch now fixed too), `features/settings/service.ts:41` and `features/staff/actions.ts:141` (RPC
reason → fixed text), `features/staff/actions.ts:91` (`=== "Unauthenticated"`).

What changed: 61 `err instanceof Error ? err.message : "<fallback>"` sites → `clientErrorMessage(err, "<fallback>"[,
"<domain>.<function>.failed"])` (the event only where the catch did not already log); `consultation` rethrows the
PostgREST error instead of `new Error(<pgErr>.message)` and its revision-insert failure is a fixed text;
`clinics/actions` no longer returns the RPC message; `dpdp/{export,erasure}`, `appointments/system`, the two PDF
generators and `lib/messaging/dispatcher` throw fixed texts with `cause`; `lib/storage/supabase-provider.ts` never puts
the object key or the Storage text in its message (`storageError`); provider exceptions are stored as
`<Provider> request failed (<errorTag>)`.

## Decisions and deviations

1. **M-SSRF-DNS without undici.** `undici` is not a dependency (Node's bundled copy is not importable), so the pinned
   connect uses `node:https` with `host` = the vetted address and `servername`/`Host` = the name
   (`lib/webhooks/transport.ts`). Same effect as an undici `connect.lookup` dispatcher (resolve once, connect to the
   checked address only), no new dependency. Redirects are not followed, the body is never read, 5 s bound.
2. **Key/Failing-row redaction runs to the end of the text** (review fix, C M-2): a value containing `)` or a newline
   cannot leak. The diag error now puts its `Key (…)` detail last so the e2e still proves the email/mobile/query rules.
3. **Console scrubber wraps `error`, `warn`, `log`, `info`, `debug`, `trace`** (triage named error/warn): Next's
   `uncaughtException`/`unhandledRejection` and render-error prints use `error`, but any library could print an error
   through the others. Errors keep class, code, digest and `file:line` frames (debuggable), never the raw stack or own
   properties; objects that are not error-like print as `[Object]`.
4. **Logger words are lower case** (`LogWord = Lowercase<string>`): three callers that built words at run time use
   `logWord()` (send-email provider/action, v1 envelope code, pwned reason union). The v1 envelope's
   `reason: "DATABASE_ERROR"` is now written as `database_error`. `module` may also be a lower-case module path
   (`MODULE_PATTERN`), which keeps `getSystemDb`'s `REASON_OWNER` values (`4cd4c4b`, after 03-13c's full lane caught the
   drop).
5. **Flood bound is app-side and per instance** (25 distinct messages per route/name/code per UTC day). The DB's
   fingerprint normalisation (review L-1 "`\d+`→N") stays with the migration owner if wanted.
6. **Synthetic range** `+91 90000 000xx` (`lib/messaging/synthetic-numbers.ts`, `SYNTHETIC_PHONE_PREFIX`); 03-13b's
   seeds use it (`85e5e9e`). Real people may own these 100 numbers; they can never be messaged by this product.

## Residuals (not in 03-13d scope)

- Provider *response* text (`data.message` from MSG91/Gupshup/Twilio on a non-2xx) is still stored as the queue error;
  it is the provider's text, not ours (V2-04 messaging outbox rework).
- Webhook port allow-list (review E-8 "optionally") not added; the test-ping limit bounds the scanning oracle.
- Composite FK / revoke of direct queue writes stay with V2-05 P1-02 / V2-04 (triage).

## Verification

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | exit 0 | `typecheck.txt` |
| `npx eslint .` | 0 errors (warnings pre-existing style) | `eslint.txt` |
| `npm run inventory` | exit 0, flagged 0 | `inventory.txt` |
| Full Vitest lane at `c060dfb` (shared tree) | 3455 passed, 2 failed: both in `tests/api/proxy-session.spec.ts` "03-13a H-AUTH", i.e. 03-13a's uncommitted WIP in the same tree (`lib/auth/session-age.ts`, that spec); no 03-13d file involved. The earlier run at `be876e7` also caught 6 guard-leg failures of mine, fixed in `c060dfb` | `vitest-full.txt` |
| `npm run e2e:build` + `npm run e2e:pr` at `c060dfb` | 188 passed, 7 skipped (by design), 0 failed, 0 flaky, 0 retried results | `e2e-pr-summary.txt` |
| gitleaks v8.30.1 (docker) over this plan's commits | no leaks | `gitleaks.txt` |
