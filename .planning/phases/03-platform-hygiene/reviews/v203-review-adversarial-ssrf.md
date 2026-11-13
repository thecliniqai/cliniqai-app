# V2-03 adversarial review (E): SSRF, outbound webhooks, storage provider removal

- Scope: `origin/feature/v2..3f81bfb`; `lib/webhooks/**`, `features/webhooks/service.ts`, `app/api/cron/webhooks/route.ts`,
  outbound fetches in `lib/messaging/providers/**`, `lib/auth/pwned.ts`, `lib/email/**`, `lib/observability/sink.ts`,
  `lib/ai/client.ts`, and `lib/storage/**` + `features/sharing/system.ts` after the R2/S3 removal.
- Requirements: 03-PLAN §03-10, threat T-03-11, VERIFICATION_LOG E-6, roadmap P2-06 (SSRF redirect/DNS hardening, V2-14).
- Method: fresh context, hostile. The validator was driven directly from a scratch script (validator imported from
  the repo, nothing in the repo changed). The cross-tenant queue PoC ran on the local stack inside `BEGIN … ROLLBACK`,
  so no data was left behind. `tests/api/webhook-ssrf.spec.ts` was run: 10/10 pass.
  Implementer records were read only after the findings below were written. They already list the rebinding window
  and the NAT64/6to4 gap as residuals, which agrees with E-2 and E-3.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 5 |
| Info | 4 |

What held up: every IPv4 alternate form (`2130706433`, `0177.0.0.1`, `0x7f.1`, `127.1`, `127.0.0.1.`, `0`,
full-width digits and `。` dots) is normalised by WHATWG `URL` before the range check and blocked. Also blocked:
`::1`, `::`, `::ffff:127.0.0.1` / `::ffff:7f00:1` (fail-closed: any `::ffff:` remainder that is not dotted is
rejected), `fc00::/7`, `fe80::/10`, zone ids (fail to parse), `0.0.0.0`, `169.254.169.254`, `100.64/10`,
multicast and broadcast, userinfo `evil@127.0.0.1`, `localhost.`/`*.localhost.` (resolved, so they fail closed),
`file:` and `http:`. Every DNS answer is checked, mixed public and private answers are rejected, and resolver errors
fail closed. `redirect: "manual"` is set and nothing follows a 3xx (the 3xx counts as a failed delivery). The 5 s
`AbortSignal.timeout` covers connect and headers, and the body is never read, so a large response or slowloris
cannot pin memory. Request headers are fixed constants, so no header injection is possible. No production caller
can reach `allowHttp`, `resolve` or `fetch`: the cron route, test ping and outbox pass nothing. No `R2_*`, S3 SDK or
`STORAGE_PROVIDER` path is left, and the env schema denies the stale keys. Storage keys go through charset,
segment and tenant-prefix checks, and the share path re-checks the token's tenant prefix and the bucket allowlist.

Important limiter for every SSRF finding: delivery is **https-only** with normal certificate validation. A
redirected connection to an internal host therefore stops at the TLS handshake unless that host serves a
publicly trusted certificate for the attacker's name. The realistic primitive is a TCP connect + TLS ClientHello to
an internal IP:port, with an oracle: `durationMs` / `responseStatus` are returned synchronously by the test-ping
action and stored in delivery logs. That makes blind internal port scanning possible, but not request smuggling
into plaintext services.

---

## Medium

### E-1 (Medium, pre-existing, confirmed): a tenant owner can make the service-role dispatcher send a forged, validly-signed webhook to **another tenant's** endpoint
- `supabase/migrations/000018_api_keys_webhooks_dpdp.sql:121-166`: the `webhook_delivery_queue` RLS `WITH CHECK`
  only checks the row's own `tenant_id`. `subscription_id` is a plain FK to `webhook_subscriptions(id)`, and an FK
  check ignores RLS. `authenticated` has INSERT/UPDATE on the table.
- `lib/webhooks/dispatcher.ts:70-74,90,137-140`: the cron dispatcher (`getSystemDb`) loads the queue row, embeds
  `subscription:webhook_subscriptions(endpoint_url, signing_secret, …)` through the FK, and signs `item.payload`
  with that subscription's secret. It never checks `item.tenant_id === subscription.tenant_id`.
- PoC (local stack, rolled back): tenant A's owner (JWT `sub` = A-owner) sees 0 of B's subscriptions but
  `INSERT INTO webhook_delivery_queue (tenant_id, subscription_id, event_type, payload) VALUES ('<A>', '<B-sub-id>',
  'payment.recorded', '{"forged":true}')` succeeds. The join the dispatcher performs then yields
  `POST https://b.example.test/hook signed with whsec_victim`. A can also `UPDATE` its own row's `subscription_id`
  to the same effect, and can read the delivery outcome (`response_status`, `duration_ms`) from its own row.
- Impact: B's receiver gets a payload chosen by the attacker with a correct `X-ClinicQ-Signature` (for example a fake
  `payment.recorded`), so cross-tenant integrity breaks. B never sees the row in its delivery log. The only
  precondition is B's subscription UUID (random v4, and I found nowhere it is exposed across tenants), so this is
  Medium, not High.
- Fix (03-13): (1) in the dispatcher, refuse and fail the item when `subscription.tenant_id !== item.tenant_id`
  (select `tenant_id` in the embed). (2) Migration: composite FK `(subscription_id, tenant_id) →
  webhook_subscriptions(id, tenant_id)` (expand: add unique `(id, tenant_id)`, add FK `NOT VALID`, validate).
  (3) Revoke INSERT/UPDATE/DELETE on `webhook_delivery_queue` from `authenticated`, since only the server and the
  SECURITY DEFINER outbox writer should write it (check that `enqueueWebhookEvent`'s request-path insert moves to an
  RPC first). Regression test: an owner of A inserting a row bound to B's subscription is refused, and the
  dispatcher fails a mismatched row without sending.

### E-2 (Medium, known residual): DNS rebinding TOCTOU, because the validated address is not pinned
- `lib/webhooks/ssrf.ts:153-156` resolves and checks. `lib/webhooks/dispatcher.ts:150` then calls `fetch(endpoint_url)`,
  which resolves again. A TTL-0 name answering public then `10.x`/`127.0.0.1`/`169.254.169.254` passes the check
  and connects internally. The test-ping action (`features/webhooks/service.ts:281-288`) gives an attacker with
  `clinic:manage` an immediate oracle on demand (status + `durationMs`; refused vs filtered vs open is
  distinguishable by timing).
- Bypassing input: `https://<rebind-host>:<port>/` with alternating A records. The validator cannot see the bypass.
- Impact is limited to connect + TLS ClientHello (see the limiter above). Metadata endpoints are plain HTTP, so they
  are not reachable over https.
- Fix: do the check inside the connect. Use an undici `Agent({ connect: { lookup } })` whose `lookup` resolves once,
  rejects private answers with the same `isPrivateIp`, and returns only the vetted address (keep SNI/Host = hostname).
  Pass it as `dispatcher` to `fetch`. Already scheduled as P2-06 (V2-14). If it is not fixed in 03-13, record it as
  an accepted residual with owner and phase.

### E-3 (Medium): the IPv6 blocklist misses IPv4-embedding and transition prefixes
`lib/webhooks/ssrf.ts:48-73`. These were proven ALLOWED by the validator, both as URL literals and as DNS answers:

| Input (URL host after `URL` normalisation) | Embeds |
|---|---|
| `[::127.0.0.1]` → `::7f00:1` (IPv4-compatible `::/96`) | 127.0.0.1 |
| `[64:ff9b::127.0.0.1]`, `[64:ff9b::a9fe:a9fe]` (NAT64 well-known `/96`) | 127.0.0.1, 169.254.169.254 |
| `[64:ff9b:1::a00:1]` (local-use NAT64 `64:ff9b:1::/48`) | 10.0.0.1 |
| `[2002:7f00:1::]`, `[2002:a9fe:a9fe::]` (6to4 `2002::/16`) | 127.0.0.1, 169.254.169.254 |
| `[2001:0:…]` (Teredo `2001::/32`) | obfuscated v4 |
| `[fec0::1]` (deprecated site-local `fec0::/10`; regex only covers `fe8`–`feb`) | n/a |
| `[100::1]` (discard-only `100::/64`) | n/a |

Whether these reach an internal host depends on the platform. On a host behind a NAT64 gateway (for example
IPv6-only subnets with DNS64/NAT64), `64:ff9b::<private v4>` is translated to that private IPv4. The TLS limiter
still applies. The fix is cheap and inside T-03-11's "private ranges blocked".
- Fix: parse to 16 bytes (a small hand parser; `ipaddr.js` is not installed and would be a new dependency) and decide on
  bytes rather than string prefixes. Extract and re-check the embedded IPv4 for `::/96`, `::ffff:0:0/96`,
  `64:ff9b::/96`, `64:ff9b:1::/48` and `2002::/16`. Block Teredo `2001::/32`, `fec0::/10`, `100::/64`,
  `2001:db8::/32` and `2001:10::/28` outright. A simpler and safer option is an allowlist: accept only IPv6 in
  `2000::/3` minus the prefixes above. Add each table row to `webhook-ssrf.spec.ts`.

## Low

### E-4 (Low): IPv4 special-purpose ranges not blocked
`lib/webhooks/ssrf.ts:16-43` allows `198.18.0.0/15` (benchmark; some providers use it internally),
`192.0.0.0/24` (IETF protocol assignments, e.g. `192.0.0.170`), and `192.88.99.0/24` (6to4 relay anycast).
Proven: `https://198.18.0.1/`, `https://198.19.255.1/`, `https://192.0.0.170/` and `https://192.88.99.1/` are
ALLOWED. Fix: add these three ranges, or use the IANA special-purpose registry as an allowlist complement.

### E-5 (Low): DNS answers are range-checked as raw strings, not canonicalised
`lib/webhooks/ssrf.ts:49-55,172`: an injected resolver answering `0:0:0:0:0:ffff:7f00:1` (127.0.0.1, uncompressed
form) is ALLOWED, because `startsWith("::ffff:")` fails. The production `dns.lookup` returns inet_ntop-compressed
text, so this does not affect production today. It is a trap for a future resolver (DoH, a cache). Fix: the byte
parser in E-3 removes the whole class.

### E-6 (Low, pre-existing): outbound provider calls have no timeout
`lib/messaging/providers/msg91.ts:49,117,184`, `gupshup.ts:79`, `twilio.ts:51,125` and `lib/ai/client.ts:101`
call `fetch` without `signal`. The hosts and paths are fixed, or env-only (`AI_BASE_URL`, Twilio SID), and no
user-controlled URL reaches them, so this is not SSRF. A hung provider holds a request or job until the platform kill,
and the messaging dispatcher processes items serially. Fix: `AbortSignal.timeout(…)` on each call, as `pwned.ts`
(1.5 s, plus a race deadline), `sink.ts` (2 s), `mailpit.ts` (5 s) and SES (1.5/3 s, 2 attempts) already do.
These have bounded timeouts and fixed or env-validated hosts (`PWNED_API_BASE_URL` and `MAILPIT_API_URL` are
loopback-only outside dev or forbidden; the sink uses `NEXT_PUBLIC_SUPABASE_URL`).

### E-7 (Low): endpoint URL, including any userinfo or query secret, is written verbatim to the audit log
`features/webhooks/service.ts:151` puts `Webhook subscription registered for ${cleanUrl}` in audit metadata.
Receivers commonly embed a token (`?token=…`, `https://user:pass@…`). Fix: record `origin + pathname` only. Also
reject URLs with `username`/`password` in the validator: undici `fetch` throws on them anyway, so they can never
deliver.

### E-8 (Low): owner-controlled retry and abuse knobs
Because of the RLS in E-1, an owner can `UPDATE` its own queue rows (`max_retries`, `retry_count`, `next_retry_at`,
`status`), which gives unbounded re-delivery attempts per cron tick. Test ping has no rate limit, and each call
makes a synchronous outbound connect on any port (e.g. `https://8.8.8.8:25/` is valid). Fix: the grant revoke in
E-1, plus a per-tenant rate limit on test ping (P1 rate-limit work) and optionally a port allowlist (443, 8443, or
>1024).

## Info

- I-1: `dispatcher.ts:150-166` never consumes or cancels `res.body`, so the undici socket is held until GC. Add
  `await res.body?.cancel()`, as `sink.ts` does.
- I-2: dispatch has no atomic claim. The outbox's immediate dispatch and the cron tick can both send the same item.
  This belongs to V2-04 (jobs reliability) per CLAUDE.md "claim work atomically", and is not an SSRF issue.
- I-3: `listWebhookSubscriptions` returns `signing_secret` on every list (`features/webhooks/service.ts:45,63`)
  to `clinic:manage`. RLS limits it to owner/admin, so there is no leak to other roles, but show-once plus a
  rotate action is better practice.
- I-4 (storage, pre-existing): lab object keys embed the patient's name
  (`features/labs/utils.ts:14`, `…/patients/<id>/labs/<Patient_Name>_…`), so PHI appears in storage keys and
  signed-URL paths. Lab uploads also default to `upsert: true`, so a same-name same-date upload silently replaces
  the earlier object. Neither is a tenant-escape: `validateStoragePath` plus `isPatientStoragePath` and the
  share-path `isTenantStoragePath` + bucket allowlist hold. `validateStoragePath` alone accepts any tenant's
  `<uuid>/` prefix (shape check only). Every current caller pairs it with a tenant-bound check or builds the key
  from `ctx.tenantId`, and that must stay true.

## Triage proposal for 03-13
- Fix now: E-1 (dispatcher tenant check + migration + revoke), E-3/E-4/E-5 (byte-level range check), E-7.
- Fix now or accept with owner: E-2 (P2-06 / V2-14 already owns it), E-6 (cheap: recommend fixing now).
- Defer: E-8 to the rate-limit item, I-2 to V2-04.
