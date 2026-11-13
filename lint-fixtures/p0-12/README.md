# P0-12 boundary lint fixtures (V2-04 04-03a, ruling R-33)

"No request path dispatches a message" as a structural property: the messaging provider factory
(`getMessagingProvider`), the direct senders (`sendDirectSms`, `sendDirectWhatsApp`) and the provider classes are
importable only from `lib/jobs/internal/**` (the `message.send` handler) and `lib/messaging/**`, plus one
owner-commented allowance for `app/api/webhooks/messaging/[provider]/route.ts` (owner 04-03c, which queues the bot
replies and deletes `sendDirect*` with the allowance). `tests/**` and `scripts/**` are tooling (excepted).

`lint-fixtures/**` is ignored by `npx eslint .`; `tests/security/p0-12-lint-gates.spec.ts` lints each file as text at
virtual repository paths (inline configuration off), so the real `files:` globs of `eslint.config.mjs` decide.

| Fixture | Fails lint at (`@typescript-eslint/no-restricted-imports`, `P0-12:`) | Passes at |
|---|---|---|
| `provider-factory-import.ts` | a feature service, a server action, a page, `app/api/jobs/run/route.ts`, `lib/jobs/enqueue.ts`, another webhook route | `lib/jobs/internal/x.ts`, `lib/messaging/x.ts`, the inbound messaging route, `tests/**`, `scripts/**` |
| `direct-send-import.ts` | a feature service, `features/appointments/system.ts` | the inbound messaging route (04-03c allowance), `lib/jobs/internal/x.ts` |
| `provider-class-imports.ts` | a feature service (4 lines: alias, relative, dev logger, barrel `index`) | `lib/jobs/internal/x.ts`, `lib/messaging/x.ts` |
| `namespace-barrel-import.ts` | a feature service | `lib/messaging/x.ts` |
| `reexport-sender.ts` | `lib/db/x.ts` | |
| `allowed-imports.ts` | nowhere (type imports, a constant, the synthetic-number check, the enqueue surface) | a feature service |
