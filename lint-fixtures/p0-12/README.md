# P0-12 boundary lint fixtures (V2-04 04-03a, ruling R-33)

"No request path dispatches a message" as a structural property: the messaging provider factory
(`getMessagingProvider`), the direct senders (`sendDirectSms`, `sendDirectWhatsApp`) and the provider classes are
importable only from `lib/jobs/internal/**` (the `message.send` / `message.reply_unmatched` handlers) and
`lib/messaging/**`. V2-04 04-03c deleted `sendDirectSms`/`sendDirectWhatsApp` and the inbound messaging webhook's
allowance (its bot replies are queued); the deleted names stay in the banned list so they cannot come back, and the
fixtures that import them carry `// @ts-nocheck` (line 1). `tests/**` and `scripts/**` are tooling (excepted).

V2-04 04-03b: the same rule for outbound webhooks. The deliverer (`lib/webhooks/dispatcher`, `deliverWebhook`) and the
pinned transport (`lib/webhooks/transport`) are importable only from `lib/jobs/internal/**` (the `webhook.deliver`
handler) and `lib/webhooks/**`, so a request path can no longer start a webhook POST (the 03-10 fire-and-forget
dispatch); it enqueues with `enqueueWebhookEvent`. Type imports stay allowed.

`lint-fixtures/**` is ignored by `npx eslint .`; `tests/security/p0-12-lint-gates.spec.ts` lints each file as text at
virtual repository paths (inline configuration off), so the real `files:` globs of `eslint.config.mjs` decide.

| Fixture | Fails lint at (`@typescript-eslint/no-restricted-imports`, `P0-12:`) | Passes at |
|---|---|---|
| `provider-factory-import.ts` | a feature service, a server action, a page, `app/api/jobs/run/route.ts`, `lib/jobs/enqueue.ts`, another webhook route, the inbound messaging route (04-03c) | `lib/jobs/internal/x.ts`, `lib/messaging/x.ts`, `tests/**`, `scripts/**` |
| `direct-send-import.ts` | a feature service, `features/appointments/system.ts`, the inbound messaging route (04-03c) | `lib/jobs/internal/x.ts` |
| `provider-class-imports.ts` | a feature service (4 lines: alias, relative, dev logger, barrel `index`) | `lib/jobs/internal/x.ts`, `lib/messaging/x.ts` |
| `namespace-barrel-import.ts` | a feature service | `lib/messaging/x.ts` |
| `reexport-sender.ts` | `lib/db/x.ts` | |
| `webhook-fire-and-forget.ts` | a feature service, a server action, a v1 route, `features/appointments/system.ts`, the runner route, `lib/jobs/enqueue.ts` | `lib/jobs/internal/x.ts`, the `webhook.deliver` handler, `tests/**` |
| `webhook-transport-imports.ts` | a feature service (4 lines: transport alias, relative dispatcher, relative namespace, re-export; the spec also lints `./dispatcher` and `./transport.ts` inline) | `lib/webhooks/x.ts`, `lib/jobs/internal/x.ts` |
| `allowed-imports.ts` | nowhere (type imports, a constant, the synthetic-number check, the enqueue surface incl. `enqueueWebhookEvent`, the SSRF check) | a feature service |
