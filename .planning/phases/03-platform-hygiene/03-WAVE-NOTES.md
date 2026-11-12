# V2-03 wave notes (orchestrator)

Cross-plan handoffs raised by implementers. Each later plan's implementer must read this file.

| From | For | Note |
|---|---|---|
| 03-06 | CI | Lockfile written by macOS npm 11.6.2 broke `npm ci` on Linux npm 11.19.1 (missing optional `@emnapi/*`). Fix and guard owned by 03-03. Any plan that changes `package.json` must re-validate the lock in a `node:24` container before committing. |
| 03-06 | 03-04 / V2-06 | Three new React lint rules set to warn (+35 warnings); restore to error in V2-06. |
| 03-09a | 03-04 | `lib/log/client.ts` reads `process.env.NODE_ENV` and uses `console.warn` (dev only): allow-list it in the no-console and `process.env` rules. |
| 03-09a | 03-09c | `console.error` in `lib/api/envelope.ts` still logs the raw message and details; convert in the sweep. |
| 03-09a | all | `apiError` is now async (reads the request id via `headers()`); `await` it. |
