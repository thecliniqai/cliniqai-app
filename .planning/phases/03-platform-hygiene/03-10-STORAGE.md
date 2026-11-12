# 03-10 record: R2/S3 removal + test-env branch removal (P1-43, P2-03, E-6, RL-12, R-8)

**Outcome:** done locally. No hosted step. One cross-plan dependency left for the wave merge: 03-01's planned rewrite
of `tests/api/health-probes.spec.ts` and `app/api/ready/route.ts` removes the R2 readiness case, which fails after
this plan (see "Open at merge").
**Evidence:** `evidence/03-10/` (tool output only; `commit.txt` is the SHA the static checks ran on, in a throwaway
worktree so 03-01's uncommitted edits in the shared checkout were not included).

## Commits

| SHA | Subject |
|---|---|
| `3004926` | feat: remove the R2/S3 storage provider; Supabase Storage only (P1-43) |
| `4d1a27f` | fix: SSRF check always resolves DNS via an injectable resolver; no test-env branches in `lib/webhooks` (P2-03, E-6, T-03-11) |
| `34d52b2` | ci: AI-06 L1-R3 covers `app/ components/ features/ lib/ proxy.ts` (RL-12) |
| (next) | docs: this record, the evidence and the wave-note rows |

## What changed

- **Storage (P1-43).** `lib/storage/r2-provider.ts` deleted with its `export *`. `getStorageProvider()` and
  `getStorageProviderForDb()` no longer read `STORAGE_PROVIDER` or `R2_*`. `features/sharing/system.ts` signs share
  objects through `SupabaseStorageProvider` only. `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are removed. The
  lock was rewritten by `scripts/ci/lock-linux-check.sh --fix` (node:24). The diff only deletes lines (414), and
  `npm ci --dry-run` passes on Linux (`lock-linux.txt`). No `@aws-sdk/*` entry remains in the lock.
- **SSRF (T-03-11).** `validateWebhookEndpoint(url, { allowHttp?, resolve? })`. `isTestEnv` and the
  `.test`/`.example.com` skip are gone, and so is `allowTestDomains` (it had no caller). Every non-literal hostname is
  resolved (default `dns.promises.lookup(host, { all: true, verbatim: true })`), and every answer must pass `isPrivateIp`.
  A resolver error, an empty answer or a malformed answer fails closed. Bracketed IPv6 literals are now range-checked.
  Before this change, `https://[fd12::1]/` went to DNS as `"[fd12::1]"` and the test lane's resolver accepted it.
- **Dispatcher.** `isTest` is gone. `dispatchWebhookQueueItem(db, id, { allowHttp?, resolve?, fetch? })` and
  `dispatchPendingWebhookQueue(db, { limit?, ...same })`. The production callers (cron route, `testPingWebhook`, the
  outbox's immediate dispatch) pass nothing, so they get https only, system DNS and global `fetch`.
- **AI-06 L1-R3.** The scope widened from `lib/ai|features/ai` to `app/ components/ features/ lib/ proxy.ts`. The repo
  passes (`ai-l1.txt`), and `greps.txt` shows no `VITEST` in app code.
- **P2-03 live AI eval lane:** deferred to V2-12 under ruling R-8. There is no code change. The deferral goes in 03-SUMMARY.
- `scripts/inventory-server-actions.ts` did not list the R2 module, so it is unchanged. The `FLOOR` in
  `assert-vitest-report.mjs` is unchanged: the suite lost the 2 R2 selection tests and gained 17.

## Deviations

1. **[Rule 2, T-03-11] `redirect: "manual"` on webhook delivery.** The SSRF check covers only the configured URL.
   Following a 3xx would let a public endpoint redirect the POST to `169.254.169.254` or a private address. A redirect
   now counts as a failed attempt and is retried with backoff. Behaviour impact: API v1 webhooks are off in production
   (PO-16), so no partner is affected. The change is tested in `webhooks-outbox.spec.ts`. It is flagged here for the
   adversarial SSRF review (E).
2. **[Rule 1, test race] Dispatcher tests insert queue rows directly.** `enqueueWebhookEvent` starts a background
   `dispatchWebhookQueueItem` on the same row. The old tests hid this by patching the global `fetch`, so both
   dispatches hit the mock. Once `fetch` was injected, the background dispatch (production transport, blocked by the
   test-lane network guard) overwrote `delivered` with `pending`. The old SSRF test had the same latent race, because
   it repointed the row after the enqueue. The root cause is two writers on one row with no claim, which belongs to
   V2-04 (atomic outbox claim; wave note). The tests now create rows without the background trigger. The 3 specs passed
   5 consecutive runs (51/51 each).
3. `.env.test` (tracked) still sets `STORAGE_PROVIDER=supabase`. CLAUDE.md forbids opening `.env*`, so it was not
   opened or edited. 03-01's env lane owns it.

## Tests that fail without the change (`tests-against-old-code.txt`)

The 03-10 test files from `34d52b2` were run against the pre-03-10 code (`b120a2f`) in a throwaway worktree:
**17 failed / 36 passed**.
- `webhook-ssrf.spec.ts`: 9 of 10 fail. Examples: a `.test` host whose resolver answers `10.0.0.5` (accepted before),
  mixed public and private answers, a throwing resolver, a `.test` host through the default resolver, and bracketed
  IPv6 literals. The case "http:// without allowHttp is rejected" passed before too, because the validator never used
  `isTestEnv` for the scheme. The dispatcher test below covers the old `VITEST` allowance.
- `webhooks-outbox.spec.ts`: 7 fail. Examples: http without `allowHttp` is sent before and failed after; a private
  DNS answer is skipped before; a 302 is followed before; `fetch` is injected.
- `ai-l1-greps.spec.ts`: the `r3-test-branch-wide` fixture (VITEST in `lib/webhooks/`, in `proxy.ts`, and
  `AI_EVAL_LIVE` in a route) passes the old scope.
- `storage-provider.spec.ts`: it fails to load on the old code because `r2-provider.ts` imports the removed SDK. By
  construction, the old selection rule returned R2 for `STORAGE_PROVIDER=r2` (the deleted tests asserted exactly that).

## Runner results (tool output)

- `npm run typecheck` exit 0. `npx eslint .`: 0 errors, 433 warnings (03-03 baseline 435). `npm run inventory`:
  0 flagged. `node scripts/ci/ai-l1-greps.mjs`: PASS.
- Full Vitest lane at `34d52b2` (`vitest-full-summary.txt`): **1961 passed, 3 failed / 1964**.
  - `health-probes.spec.ts` "verifies Cloudflare R2 storage provider": expected after this plan. The storage
    provider is always Supabase now, and the test's mock admin has no `storage`. 03-01's rewrite removes the case.
  - `hosted-dump-diff.spec.ts` ×2: environmental. 03-01 had applied its uncommitted `000025` to the shared stack, so
    the local DB was ahead of the migrations at `34d52b2`. It is not related to this plan.
- e2e was not run. 03-10 touches no route, page, proxy or env file. The share-link signing path differs only when R2
  was configured, which no lane ever did.

## Open at merge

- 03-01 removes the R2 case from `health-probes.spec.ts` and the dead R2 branch in `app/api/ready/route.ts:51-59`
  (its plan already includes both).
- Residuals for SSRF review (E): there is a DNS-rebinding window between the check and `fetch`'s own resolution (fix:
  pin the validated address in an undici dispatcher). `isPrivateIp` does not cover NAT64 (`64:ff9b::/96`) or 6to4
  (`2002::/16`) embeddings.
