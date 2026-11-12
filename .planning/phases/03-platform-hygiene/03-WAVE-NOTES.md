# V2-03 wave notes (orchestrator)

Cross-plan handoffs raised by implementers. Each later plan's implementer must read this file.

| From | For | Note |
|---|---|---|
| 03-06 | CI | Lockfile written by macOS npm 11.6.2 broke `npm ci` on Linux npm 11.19.1 (missing optional `@emnapi/*`). Fix and guard owned by 03-03. Any plan that changes `package.json` must re-validate the lock in a `node:24` container before committing. |
| 03-06 | 03-04 / V2-06 | Three new React lint rules set to warn (+35 warnings); restore to error in V2-06. |
| 03-09a | 03-04 | `lib/log/client.ts` reads `process.env.NODE_ENV` and uses `console.warn` (dev only): allow-list it in the no-console and `process.env` rules. |
| 03-09a | 03-09c | `console.error` in `lib/api/envelope.ts` still logs the raw message and details; convert in the sweep. |
| 03-09a | all | `apiError` is now async (reads the request id via `headers()`); `await` it. |
| 03-10 | 03-01 | `tests/api/health-probes.spec.ts` "verifies Cloudflare R2 storage provider when STORAGE_PROVIDER=r2" fails from `3004926` on (storage is Supabase-only; the mock admin has no `storage` → 503). Your planned rewrite removes it, together with the dead R2 branch at `app/api/ready/route.ts:51-59`. |
| 03-10 | 03-01 | `tests/api/webhooks-outbox.spec.ts` (03-10) cron section sets `process.env.CRON_SECRET` in `beforeAll`; with the cron route on a memoised `serverEnv()` it may need a reset/stub. 03-10 left that section untouched: adjust it at the wave merge if needed. |
| 03-10 | 03-01 / all | AI-06 L1-R3 now scans `app/ components/ features/ lib/ proxy.ts`: no `VITEST`, `test-api-key` or `AI_EVAL_LIVE` there (incl. `lib/env*.ts`). Tracked `.env.test` still sets `STORAGE_PROVIDER=supabase` (not opened by 03-10). |
| 03-10 | 03-11b | No `@aws-sdk/*` package is left in the lockfile, so the "same train as the S3 SDK already in the lockfile" reason for the `@aws-sdk/client-sesv2` 3.1155.0 pin no longer holds; re-check the pin and its whole new dependency tree in `package-legitimacy.json`. |
| 03-10 | V2-04 | `enqueueWebhookEvent` fires a background `dispatchWebhookQueueItem` on the same row that cron/test-ping may dispatch: two writers, no atomic claim (double POST, last write wins). Dispatcher tests now insert rows directly. Needs the outbox claim. |
| 03-10 | close / review E | `redirect: "manual"` added to webhook delivery (Rule 2 deviation). SSRF residuals: DNS-rebinding window between check and `fetch` (pin the address in an undici dispatcher); `isPrivateIp` misses NAT64/6to4 embeddings. P2-03 live AI eval lane deferred to V2-12 (R-8) for 03-SUMMARY. FLOOR unchanged (−2 R2 tests, +17). |
