# Runbook: error sink (`ops.error_events`)

V2-03 plan 03-09b (P1-25, FT-07 sink, C39/PO-12). Rulings R-7, R-18, R-27. Threats T-03-02, T-03-03, T-03-14,
T-03-15. The PO does every hosted step in this runbook (PO action E9). Agents never set hosted secrets, never run SQL
against a hosted project and never call a hosted diagnostic route.

## 1. What it is

| Piece | Where |
|---|---|
| Capture | `instrumentation.ts` `onRequestError` → `lib/observability/sink.ts` (render, route handler, server action and proxy errors on the Node.js runtime) |
| Scrubber | `lib/observability/scrub.ts` (message, frames, route pattern); the database re-scrubs emails, query strings and digit runs |
| Storage | `ops.error_events` in the project's own Postgres (staging and production are `ap-south-1`, India-resident, C39). One row per fingerprint and UTC day; repeats increment `count` |
| Ingest | `public.ops_ingest_error(p_ingest_key, p_event)`, SECURITY DEFINER, anon-executable, refused without the ingest key. Plain `fetch` with the publishable key: no service role (R-7) |
| Key | Vercel env `ERROR_INGEST_KEY` (server only). The database holds only its SHA-256 (hex) in the vault secret `ops_error_ingest_key_sha256` |
| Proof route | `POST /api/diag/error` (`CRON_SECRET` bearer, then `DIAG_ERROR_ROUTE_ENABLED=true`, refused by the env schema in production) throws a synthetic error (R-18) |
| Retention | `ops.purge_error_events(interval default '180 days')`, `ops.error_events_size()`; scheduling is V2-04 (R-27) |
| Cap | 500 new fingerprints per UTC day (`ops.error_sink_daily_cap()`); beyond it `ops.error_event_overflow.dropped` counts |
| Client errors (V2-06) | `reportClientRenderError` (`features/observability/actions.ts`): a signed-in dashboard error boundary reports an uncaught render error without a digest. See "Client render errors" below |

What a row holds: fingerprint, day, first/last seen, count, tier (`environment`), release (git SHA), route **pattern**
(`/r/[token]`, never the concrete path or query string), route type, method, error class name, code (SQLSTATE or
error code), Next digest, scrubbed message (at most 500 characters), up to 20 `file:line` frames, and the
`x-request-id`. `tenant_id`/`user_id` exist for later use and are null today. Never: headers, cookies, bodies, query
strings, raw messages, function names. `ops` is not exposed by the API and no API role has any grant on it.

If `ERROR_INGEST_KEY` is unset (allowed outside production), errors are still logged as one `request.error` JSON line
(request id, route pattern, code) but nothing is written to the sink.

### Client render errors (V2-06 06-04a, 06-09a)

A dashboard route error boundary (`components/shell/route-error.tsx`) sends the error's class name and the route
pattern, nothing else, to the `reportClientRenderError` server action (membership required; the browser's message and
stack never leave it). The row is `error_name = client.<Name>`, `route_type = render`, empty message and frames, no
digest, method or request id, and no tenant or user (R-3). Because any member can call the action directly, neither
string is stored as sent (06-09a M-ERRCAP):

- the name is kept only if it is a listed class (`CLIENT_ERROR_NAMES` in `lib/observability/client-render-event.ts`:
  `Error`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `AbortError`, `ChunkLoadError`,
  `DiagClientRenderError`), otherwise `client.Error`;
- the route is kept only if it is one of the dashboard's own route patterns (`lib/observability/client-routes.ts`,
  generated from `app/(dashboard)/` by `node scripts/observability/client-routes.mjs --write`; a test fails while it is
  out of date), otherwise `/`.

So clients can create at most names × routes fingerprints a day (152 today; a test keeps it ≤ 40 % of the 500 cap),
whatever the number of server instances, and nothing a caller types reaches a row or a log line. Per server instance
and UTC day: at most 50 distinct client keys; the same key again within a minute is dropped without a log line or a
write (so `count` is "reports at least a minute apart", not every render); the first report refused by the 50-key cap
writes one `observability.sink.client_cap_reached` line. Public, auth and onboarding boundaries never report (no
membership; the onboarding boundary is a recorded 06-04a deviation).

- **Client rows:** `select occurred_on, count, route_path, error_name from ops.error_events where error_name like
  'client.%' order by last_seen desc limit 50;`

## 2. Turn it on for staging and prove it (PO action E9)

Prerequisite: the staging Vercel project and Supabase project exist (E2, E4) and staging runs migration `000028`.

1. Generate a key on your machine: `openssl rand -hex 32`. Put it in Vercel → `clinicos-staging` → Settings →
   Environment Variables as `ERROR_INGEST_KEY` (sensitive).
2. Compute its hash locally: `printf %s "<key>" | shasum -a 256`. Copy only the 64 hex characters (not the trailing
   ` -`).
3. In the staging Supabase SQL editor, store the **hash only**:

   ```sql
   select vault.create_secret('<sha256 hex>', 'ops_error_ingest_key_sha256');
   ```

4. Set `DIAG_ERROR_ROUTE_ENABLED=true` in Vercel and redeploy.
5. Throw the diagnostic error and note the `x-request-id` response header:

   ```sh
   curl -s -X POST -H "authorization: Bearer <CRON_SECRET>" -D - https://staging.<domain>/api/diag/error
   ```

   Expect `HTTP/2 500` and an `x-request-id: <uuid>` header.
6. Run the export query (§3) in the staging SQL editor for that request id and save the single `export` cell as JSON,
   for example `error-events-export-staging.json`.
7. Set `DIAG_ERROR_ROUTE_ENABLED=false` in Vercel and redeploy.

*Verify (Claude):* `node scripts/ops/check-error-export.mjs <export file>` passes (allowed columns only, no scrub
pattern), and the export is committed under `.planning/phases/03-platform-hygiene/evidence/`.

## 3. Export query (staging)

Replace `<x-request-id>` with the UUID from step 5. The column list is exactly the set the checker allows.

```sql
select coalesce(json_agg(r order by r.last_seen), '[]'::json) as export
from (
  select fingerprint, occurred_on, first_seen, last_seen, count, environment, release, route_path, route_type,
         method, error_name, error_code, digest, message, frames, request_id, tenant_id, user_id
  from ops.error_events
  where request_id = '<x-request-id>'
) r;
```

The checker accepts the cell's JSON array as the whole file, or the SQL editor's "Copy as JSON" form
`[{"export": [...]}]`.

Locally the same export is a tool: `node scripts/ops/export-error-events.mjs --request-id <uuid> --out <file>` (local
stack only, through `docker exec`; it runs the check on what it wrote). The e2e spec
`tests/e2e/observability/error-sink.spec.ts` does this on every run.

## 4. Operating it

- **Recent errors** (SQL editor): `select occurred_on, count, route_path, error_name, error_code, message, request_id
  from ops.error_events order by last_seen desc limit 50;`
- **Find one request:** `... where request_id = '<x-request-id>'` (the id is on every response and in every log line).
  A row keeps the **latest** request id of its fingerprint that day.
- **Dropped by the cap:** `select * from ops.error_event_overflow order by day desc;`
- **Size:** `select ops.error_events_size();`
- **Purge now** (until V2-04 schedules it): `select ops.purge_error_events();` (default 180 days; refuses less than
  one day).
- **Rotate the key:** generate a new key (step 1), then
  `select vault.update_secret((select id from vault.secrets where name = 'ops_error_ingest_key_sha256'), '<new sha256 hex>');`
  and update `ERROR_INGEST_KEY` in Vercel and redeploy. Between the two steps the sink refuses writes (errors are still
  logged).
- **Refusals:** a sink write refused by the database is logged as `observability.sink.refused` with the HTTP status;
  a network failure or timeout (2 s) as `observability.sink.failed`. `ingest_refused` means the vault hash does not
  match `ERROR_INGEST_KEY` (or the secret is missing). Error reporting never changes the response the user gets.

## 5. Local lanes

The test lanes use the synthetic `LOCAL_ERROR_INGEST_KEY` (`tests/setup/test-env.ts`); the Vitest and Playwright
global setups install its hash into the local vault (`tests/setup/error-sink-key.ts`, after every `db reset`). The
e2e app server runs with the sink and the diagnostic route on. A test lane refuses any other `ERROR_INGEST_KEY` value.

## 6. Known limits

- Pattern scrubbing cannot recognise names, addresses or other free text. The sink stores only the error's own
  message (never request data), and Postgres row details, quoted input values and identifiers are removed.
- Next.js itself still prints an uncaught error (with its raw message) to the server's stderr, i.e. the Vercel
  function logs. That output is outside this sink; see the 03-09b record for the follow-up.
- Client (browser) errors: only uncaught render errors of the signed-in dashboard, as class name + route pattern
  (above). Event-handler and promise errors in the browser are not captured.
