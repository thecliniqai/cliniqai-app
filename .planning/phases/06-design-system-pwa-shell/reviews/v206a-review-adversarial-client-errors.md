# V2-06 Wave A — adversarial review C: client render error capture (06-04a) and Lighthouse / route-JS reports (06-07)

- Reviewer: adversarial reviewer C (fresh context; per-plan records and wave notes not read before findings)
- Branch / commit: `v2/phase-06-design-system-pwa-shell` @ `ef24000`
- Scope: `features/observability/actions.ts`, `lib/observability/client-render-event.ts`, `lib/errors/client-route.ts`,
  `lib/errors/client-error-kind.ts`, `components/shell/route-error.tsx`, every `error.tsx`, `app/global-error.tsx`,
  `app/(dashboard)/diag/client-error/**`, `lib/observability/sink.ts` (shared flood bound), `ops_ingest_error`
  (000029), `scripts/perf/lhci-config.mjs`, `tests/e2e/perf/lhci.spec.ts`, `scripts/ci/route-js.mjs`, the CI/nightly jobs.
- Method: code reading; pure-function probes with `tsx` (scratchpad only); DB probes on 127.0.0.1:54322 inside
  `BEGIN … ROLLBACK` using the local synthetic ingest key. No source edits. All data below is synthetic.

## Summary

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 2 |
| Low | 3 |
| Info | 6 |

---

## Medium

### M-1 · The per-instance client key cap does not protect the 500/day DB cap: one self-signed-up member can blind the sink to new server errors for the rest of the UTC day (T-06-10)

`admitClientKey` (lib/observability/client-render-event.ts) keeps its 50-key budget in module memory "per server
instance and UTC day". The module comment states the purpose: "so a member sending made-up names cannot use up the
database's daily new-fingerprint cap (500) and blind the sink to server errors". On the deployment target (Vercel
serverless) module state is lost on every cold start, scale-out instance and deployment, so the bound is 50 × (instance
lifetimes per day), not 50. Ten instance lifetimes are enough to fill `ops.error_sink_daily_cap()` (500), which is
shared with server errors. Any user who signs up and creates a clinic (self-serve onboarding) is a member and may call
the action directly (it is a normal server action; no per-user or per-tenant rate limit).

A second, certain effect on a single instance: 50 made-up names exhaust that instance's client budget for the day, and
every later *new* client render error (a real `TypeError` on `/patients/[id]`) is dropped silently (see L-2).

Reproduction
1. Pure probe (scratchpad `advC/probe.ts`): 50 distinct junk names admitted, then
   `admitClientKey(client.TypeError @ /patients/[id])` → `false`.
2. Pure probe (`advC/probe2.ts`): 10 simulated instance lifetimes (`resetClientKeyState()` = cold start), 60 junk names
   each → **500 distinct fingerprints** reach `sendErrorEvent`.
3. DB probe (BEGIN … ROLLBACK): 500 calls to `public.ops_ingest_error` with `client.Junk<letters>` at `/`, then one
   server-shaped event (`TypeError`, `/patients/[id]`, synthetic message).

Observed: `server row stored: 0`, `ops.error_event_overflow.dropped = 1` for today. Server errors with a new fingerprint
are not stored until the UTC day rolls over (log lines `request.error` and the overflow counter remain).

Fix (any one closes it; first is preferred)
- Close the name set: store `client.<Name>` only for an allowlist of real JS/Next class names (`Error`, `TypeError`,
  `RangeError`, `ReferenceError`, `SyntaxError`, `URIError`, `ChunkLoadError`, `AbortError`, `DiagClientRenderError`,
  …) else `client.Error`; and accept `route_path` only if it is one of the app's route patterns (generate the list at
  build time from the app manifest). Then the client keyspace is bounded by the app (≈ names × routes), not by input.
- And/or bound client rows in the database, not in memory: a separate daily cap for `error_name LIKE 'client.%'`
  (e.g. 50) in `ops_ingest_error`, so client events can never consume the server budget. That is a migration (R-33
  says none in V2-06) — raise with the PO if chosen.
- Add a per-user/per-tenant rate limit on the action (e.g. Postgres-backed, P1-26 style) so one account cannot drive it.

### M-2 · The "class name + route pattern" channel accepts arbitrary free text: a member can store PHI-shaped data in `ops.error_events` and the logs, unattributed (T-06-09)

The only server-side controls on the two client strings are shape filters: `NAME_PATTERN` `[A-Za-z0-9_.$-]{1,80}` minus
`\d{6,}|@`, and `routePattern()` minus UUID / `\d{6,}` / `@` per segment. Bracketed segments may contain mixed case and
digits; lower-case slugs, dots and hyphens are free. Identifiers survive simply by being split (`98765-43210`,
`1234-5678-9012`), names and diagnoses are plain words, and hyphen-less hex ids pass. The same text is also written to the
application log (`client.render_error` line, `route` and `code`). The rows carry no `tenant_id`/`user_id`, so the
writer cannot be identified from the sink.

The honest client path is sound (params replaced by `[name]`, message and stack never sent). The issue is that the
server trusts the content of two attacker-controlled strings that only need to look like a name and a pattern.

Reproduction
1. `buildClientRenderEvent` (the exact value sent to the sink), scratchpad `advC/probe.ts` / `probe2.ts`:
   - name `Ravi_Kumar_ph_98765-43210`, route `/patients/[Ravi_Kumar_98765_43210]` → stored unchanged
     (`client.Ravi_Kumar_ph_98765-43210`, `/patients/[Ravi_Kumar_98765_43210]`).
   - name `aadhaar-1234-5678-9012` → `client.aadhaar-1234-5678-9012`.
   - name `Asha.Rao.F.52.HbA1c-9.8`, route `/patients/asha-rao/hiv-positive` → route stored unchanged.
   - name `Pat.ravi.example.com` (an email with the `@` removed) → stored.
2. DB probe (BEGIN … ROLLBACK): `ops_ingest_error` accepts and stores both events above; `tenant_id`, `user_id` null.

Observed: synthetic name + phone + national-id + diagnosis text persisted in `ops.error_events` (and, by code reading, in
the `client.render_error` log line).

Fix: the same allowlists as M-1 (closed class-name set; route accepted only if it is a known app route pattern, else `/`).
With both closed, nothing a caller types reaches storage. Optionally record `tenant_id`/`user_id` from the session on
client rows (columns already exist and the RPC accepts them) so abuse is attributable — confirm with the PO, as R-3 says
the report carries no tenant data.

---

## Low

### L-1 · Unlimited repeats: one log line and one DB write per call; `count` can be inflated to poison triage

For an already-admitted key, `admitClientKey` and `admitToSink` always return true, and `log.warn` runs before any
check. A member looping the action produces one `client.render_error` log line and one `UPDATE … count = count + 1`
per call with no bound. Effects: log-volume cost; dead-tuple churn on `ops.error_events`; and the runbook's triage
(`docs/runbooks/error-sink.md`, ordered by `count`) can be steered, e.g. `client.TypeError` on `/patients/[id]` at a
huge count. Alerting on counts would misfire. Reproduction: by code reading (`features/observability/actions.ts` lines
`log.warn(...)` and `if (admitClientKey(event) && admitToSink(event)) await sendErrorEvent(event)`); the RPC's repeat
path is an unconditional UPDATE (000029). Fix: per-user rate limit on the action (e.g. a few reports per minute) and
log the drop once per key instead of each call.

### L-2 · Client drops are silent

`reportRequestError` logs `observability.sink.flood_dropped` once per key when the flood bound refuses an event; the
client path drops without any signal when `admitClientKey` (or `admitToSink`) refuses. An operator cannot tell that
client capture is saturated (M-1 single-instance effect). Fix: log `observability.sink.client_cap_reached` once per
instance-day when `admitClientKey` first refuses.

### L-3 · Lighthouse scrub covers the report files, not the failure channel

`lhci()` in `tests/e2e/perf/lhci.spec.ts` throws `Error(... + output)` with the full `lhci` stdout/stderr. On a
Lighthouse failure `@lhci/cli` prints `err.stdout.slice(0, 4000)` (the head of the LHR: URLs, warnings, early audit
details) and Lighthouse's stderr. That text goes to the Playwright error, the job log and any Playwright report, none of
which pass through `scrubReportFile` / the `secrets` check. By code reading, the Cookie header itself is not in that
text (lhci passes settings via a flags file in `.lighthouseci/`, deleted in `finally`; Lighthouse only sends the
headers via `Network.setExtraHTTPHeaders` and does not log them), so this is a defence-in-depth gap, not an observed
leak. Fix: run `redactValue(output, secrets)` before putting lhci output in the thrown error / attachment
(`lhci-assert.txt` too).

---

## Info

- **I-1 · Reports embed page content.** Lighthouse JSON/HTML include `final-screenshot`, `screenshot-thumbnails`,
  `full-page-screenshot` and DOM `snippet`/`nodeLabel` text of `/patients` and `/consultation/<id>`. With the e2e
  synthetic seed this is not PHI, and the server is loopback-locked to the local stack. If a public artifact should
  never carry rendered patient rows, set `disableFullPageScreenshot: true` and skip the screenshot audits in
  `lighthouserc.base.json`.
- **I-2 · Derived session values are not in the secret list.** `secretsOf` covers the whole Cookie header and each
  value ≥ 16 chars, but not the access/refresh tokens inside a `base64-` Supabase cookie. Nothing in an LHR is expected
  to carry them (no request headers in `network-requests`), and they belong to an ephemeral local stack. Hardening:
  decode `base64-` cookie values and add `access_token`/`refresh_token` to `secrets`.
- **I-3 · Deviation from plan step 2:** the plan says the onboarding `error.tsx` reports; it does not (comment: no
  membership yet, every report would be refused). Reasonable, but record it as a deviation for 06-P7. Plan also says
  the action "returns nothing"; it returns `{ ok }` (no information beyond success).
- **I-4 · Stale runbook:** `docs/runbooks/error-sink.md` still says client errors are not captured until V2-06; it should
  describe the `client.` rows, their source and the 50-key cap.
- **I-5 · Unscrubbed local leftovers on scrub failure:** if `scrubReportFile` throws (a secret survived), that file and
  the rest of `test-results/lhci/` stay unscrubbed on disk. CI does not upload them (gated on `summary.json`) and the
  path is git-ignored; local only.
- **I-6 · Route-JS report:** reads `.next` manifests and gzips chunks; output is route paths and byte counts only; the
  build uses placeholder env values. No cookie, env or page content reaches it.

---

## Attacks that failed

- **Call without a session or membership:** `resolveServiceContext()` returns `ok:false` for unauthenticated,
  no-membership and multiple-clinic-unselected users → `{ ok: false }`, nothing logged or written (code reading; the
  existing `client-error-action-db.spec.ts` covers it — could not be re-run here because another test run held the
  local-stack lock).
- **Act for another clinic:** the action takes no tenant input; zod strips extra keys (`tenant_id`, `message`, …); the
  event has no tenant/user fields.
- **Get the real message/stack/query into the sink through the honest path:** `message` is hard-coded `""`, `frames`
  `[]`; the client sends only `name` and the pattern; `usePathname` has no query; params are replaced by `[name]`
  (`/patients/<uuid>/edit` → `/patients/[id]/edit`). The diag error's synthetic phone/email never leave the browser.
- **Identifier-shaped values:** 6+ digit runs, `@`, UUIDs, `?`/`#`, upper case or digits in static segments → `/` or
  `client.Error`; the RPC re-applies the same rules (000029). Oversize name (>80) / route (>200) refused by zod.
- **Impersonate server errors / inject a code, digest, request id or release:** always `client.` prefixed,
  `route_type = render`, `error_code`/`digest`/`request_id` null, release only from `deploymentInfo()`.
- **Make an error UI reveal the message:** `RouteError` and `global-error` render fixed copy only; the digest is shown
  only if it matches `^[A-Za-z0-9_-]{1,64}$` (Next's internal `NEXT_…;…` digests fail the pattern). Public and auth
  boundaries never report.
- **Reach the diag trigger in production:** page `notFound()` unless `DIAG_ERROR_ROUTE_ENABLED`, which the env schema
  refuses for the production tier.
- **Cookie in a Lighthouse artifact:** `extraHeaders` deleted from every object, `Cookie`/`Set-Cookie`/`Authorization`
  keys and `{name,value}` header pairs redacted, the whole header and each ≥16-char value replaced in all strings, the
  HTML report's embedded JSON re-serialised and the whole text redacted, a fail-closed survivor check, configs and
  `.lighthouseci/` (flags files) deleted in `finally`, upload gated on `summary.json` (written after the checks). The
  signed-out group carries no cookie; the only other cookie (`clinic_active_tenant`, a UUID) is ≥16 chars and redacted.
- **Send the cookie off-machine:** Chrome `--host-resolver-rules` maps every non-loopback host to NOTFOUND; URLs are
  asserted loopback; the spec fails on any answered off-machine request; filesystem upload only.
- **Environment leak into lhci:** `minimalEnv()` passes only PATH/HOME/LANG/TMPDIR/CI to the tools.
