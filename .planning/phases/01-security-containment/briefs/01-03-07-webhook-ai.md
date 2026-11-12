# V2-01 brief: 01-03 webhook lockdown (P0-03) and 01-07 AI-01 containment

Read-only research, branch `v2/phase-01-security-containment`, 2026-11-11. Line numbers are at HEAD `1491899`.

---

## Part A: 01-03 webhook lockdown (P0-03)

### A1. Requirements (quoted)

- Roadmap `docs/v2/V2_MASTER_ROADMAP.md:408` P0-03: "Webhook lockdown: remove/env-gate the `dev`, Twilio and unknown
  providers (default deny); MSG91 header secret with `timingSafeEqual`; route only via `replyMsgId`; `.eq` not `.or`;
  no IDs or tokens in responses" (SEC-04, SEC-19, SEC-15, D9; SEC-REM P0-3).
- Roadmap `:748` V2-01 acceptance: "`/api/webhooks/messaging/dev` returns 404 or 401".
- `docs/v2/SECURITY_REMEDIATION_PLAN.md:23` P0-3: "delete or env-gate `dev`/`twilio`/`gupshup` handlers; default-deny
  unknown providers; MSG91 header-only secret with `timingSafeEqual`; remove cross-tenant phone fallback; stop returning
  tokens/IDs in responses; replace `.or()` with `.eq()`." (note: includes **gupshup**; roadmap omits it.)
- `docs/v2/SECURITY_ASSESSMENT.md:121` (SEC-04 remediation): "gate them behind `NODE_ENV !== "production" &&
  ALLOW_DEV_WEBHOOKS === "1"`. Default-deny unknown providers ... Route inbound replies **only** by `replyMsgId` →
  `communication_queue` → `(tenant_id, appointment_id)`. Remove the cross-tenant phone fallback ... Never return tokens".
  `:122` verification: "`verifyWebhookSignature("dev", …)` must return false when `NODE_ENV=production`; an unknown
  provider must return false ... GET `/api/webhooks/messaging/dev?from=98&action=btn_cancel` must return 403 and leave
  no visit changed."
- `SECURITY_ASSESSMENT.md:288` (SEC-19): "Use a dedicated webhook secret (not the API auth key), compare it in constant
  time, accept it in a header only, and dedupe on `request_id`/event ID." Replay dedupe is **P1-10** (SEC-REM:46), not P0-3.
- `docs/v2/SECURITY_VERIFICATION_PLAN.md:111` TC-WH-01..07: "`dev`/unknown provider in production mode → 403; MSG91
  without secret → 403; secret in query only → 403; replayed event → no-op; no cross-tenant phone fallback; response
  contains no tokens; `.or` injection in `replyMsgId` has no effect." `:37` lint rule `webhook-auth-return-true`.
  `:150` config check: "MSG91 webhook URL contains no secret in the query string — Header-based".
- `docs/v2/VERIFICATION_LOG.md:41` SEC-04 (Cr/P0), `:51` SEC-15 (dev-webhook part P0 via SEC-04), `:54` SEC-19 (H/P0,
  "`replyMsgId` allows filter injection"), `:72` D9 (H/P0, "removed in P0-03").
- Out of scope here: outbound dev provider in production (P1-15, V2-03, roadmap:437); replay dedupe (P1-10).

### A2. Current sites

`lib/messaging/webhook-helpers.ts`
- `:29-86` `verifyWebhookSignature`: `:35-37` `dev` → `true` (no env gate); `:39-48` twilio: no token → true outside
  production, header present → `true` with no HMAC; `:50-57` gupshup: unset key → true outside production, `===` compare;
  `:59-83` msg91: both secrets unset → true outside production (the "dev bypass"), accepts the **API auth key** in an
  `authkey` header (`:73`), accepts the secret from `x-webhook-secret` **or `?secret=`** (`:61-62`), plain `===`;
  `:85` unknown provider → `return true`.
- `:137-175+` `parseMsg91Payload` falls back to query params (`:157-159`).

`app/api/webhooks/messaging/[provider]/route.ts` (service role via `getAppointmentsDbClient`, `:30`)
- `:19` default provider `"dev"`; `:23-28` signature check → 403.
- `:34-210` msg91 branch: DLR uses `.eq("external_message_id", requestId)` (fine, `:47-51`); response echoes `requestId`
  (`:55`). Inbound → `handleInboundAction` (`:201-209`).
- `:212-256` fallback parser for dev/twilio/gupshup (query/body `from`, `action`, `replyMsgId`).
- `:291-296` **`.or(\`external_message_id.eq.${replyMsgId},metadata->>message_id.eq.${replyMsgId}\`)`** (injection).
- `:316-318` **cross-tenant phone fallback** `findActiveAppointmentByPhone(from)`.
- `:321-341` unmatched → sends `bot_not_found` WhatsApp to `from`.
- Responses with IDs/tokens: `:388` `appointment_id`; `:432` `appointment_id`; `:472-473` `appointment_id` +
  **`reschedule_url`** (bearer token); `:506` `appointment_id`; `:55` `requestId`.
- `:331,379,423,463,497` `provider === "dev" ? "dev" : undefined` (forces the dev sender for replies).
- `:510-524` both GET and POST exported.

`features/appointments/actions.ts:343-386` `findActiveAppointmentByPhone`: service role, `ilike('phone', %last10%)`
across all tenants, no future-date filter. Only caller: route `:317` (plus test spies).

`lib/messaging/dev-logger.ts:56` prints simulated click URLs `http://localhost:3000/api/webhooks/messaging/dev?action=…&from=…`.
`lib/messaging/index.ts:20-61` provider factory (outbound; default `dev`, msg91 → dev when `MSG91_AUTH_KEY` unset).
Not changed by P0-03 (P1-15). `middleware.ts:4-12` does not gate `/api/webhooks/*` (session refresh only).

### A3. Exact changes, file by file

1. `lib/messaging/webhook-helpers.ts`
   - **Delete** the `dev`, `twilio`, `gupshup` branches and the final `return true`.
   - Replace with `verifyMsg91Webhook(headers: Headers): boolean` (or keep the name, provider-specific): read only
     `x-webhook-secret` header; expected = `process.env.MSG91_WEBHOOK_SECRET`; if expected is unset/empty → `false`
     **in every NODE_ENV** (no dev bypass); compare `crypto.timingSafeEqual(sha256(given), sha256(expected))` (hashing
     equalises length so `timingSafeEqual` never throws and length does not leak). Do **not** accept `authkey`/
     `MSG91_AUTH_KEY` as a webhook credential (SEC-19) and do **not** read `searchParams`.
   - `parseMsg91Payload`: drop the `searchParams` fallback (body only), or keep only if MSG91 DLR is confirmed to be
     GET-with-query (see conflict C-A4).
2. `app/api/webhooks/messaging/[provider]/route.ts`
   - Provider allow-list: `if (params.provider !== "msg91") return 404` **before** reading the body (default deny;
     satisfies "dev returns 404"). Remove `|| "dev"` default (`:19`).
   - Auth failure → **401** `{ error: "Unauthorized" }` (no detail).
   - **Delete** the fallback parser `:212-256` and every `provider === "dev"` reply override.
   - `handleInboundAction`: resolve **only** by `replyMsgId`: `.from("communication_queue").select(<needed cols>)
     .eq("external_message_id", replyMsgId).maybeSingle()` (drop the `metadata->>message_id` alternative, or run it as a
     second `.eq`/`.filter` call, never string-built). Then visit by `.eq("id", apptId).eq("tenant_id", queueItem.tenant_id)`
     (already `:301-306`). Missing/unknown `replyMsgId` → 200 `{ ok: true }`, no DB write, no phone lookup.
     Optional hardening (not in docs; recommend): require normalised `from` to equal `queueItem.recipient_phone`.
   - **Delete** the phone fallback `:315-318` and its import.
   - Responses: every branch returns only `{ ok: true }` (or `{ ok: true, event: "<static string>" }`); remove
     `appointment_id`, `reschedule_url`, `requestId`, `status` echoes. Send the reschedule link only via WhatsApp.
   - Decide GET: recommend **POST only** (delete `GET`, `:510-516`) unless MSG91 is confirmed to call GET (C-A4).
3. `features/appointments/actions.ts:340-386` **delete** `findActiveAppointmentByPhone` (no remaining caller).
4. `lib/messaging/dev-logger.ts:55-57` remove the simulated `/api/webhooks/messaging/dev` click URLs (print button
   ids only), so nothing documents a dead/forbidden endpoint.
5. Env: `MSG91_WEBHOOK_SECRET` (existing; `docs/ops/secret-rotation.md:27`). If the env-gate option is chosen instead
   of deletion for `dev`: `ALLOW_DEV_WEBHOOKS === "1" && NODE_ENV !== "production"` (only name the docs define,
   SECURITY_ASSESSMENT:121). **Recommendation: delete, do not env-gate** — `next dev` runs with `NODE_ENV=development`
   against whatever `.env` holds (cf. SEC-14), local testing can POST the msg91 path with a test secret header, and
   the acceptance "404" is then unconditional. Default deny either way.
6. Lint (SEC-VER:37 `webhook-auth-return-true`) can land with P1-34/V2-02; not required for 01-03.
7. PO ops action: configure the MSG91 console to send `x-webhook-secret` as a header and remove `?secret=` from the
   URL (SEC-VER:150); rotate `MSG91_WEBHOOK_SECRET` if the URL with the query secret was ever logged.

### A4. Tests: delete / change / keep

| File | Disposition |
|---|---|
| `tests/messaging/msg91-webhook.spec.ts` | **Change.** `:25` "accepts authkey header" → invert (authkey alone rejected). `:31` "accepts secret query parameter" → invert (query secret rejected). `:38` header secret: keep. `:44` invalid → keep, expect **401**. `:66` **"allows dev/test environment bypass when secrets are unset"** → delete and replace with "rejects when `MSG91_WEBHOOK_SECRET` unset under NODE_ENV test/development/production". `:75` keep. `:101,184,259,332,483` use the `findActiveAppointmentByPhone` spy → rewrite to correlate via `replyMsgId`; assert response bodies carry no `appointment_id`/`reschedule_url`. `:392` replyMsgId tenant test: keep and strengthen. DLR `:560-856`: keep; `:856` assert no `requestId` echo. `:879` parser unit tests: keep. |
| `tests/messaging/two-way-bot.spec.ts` | **Change.** `:26` "allows dev provider" → delete (covered by new 404 test). `:31` Gupshup verify → delete (branch removed). `:40` MSG91 authkey → rewrite to header secret or delete as duplicate. `:51-75` `parseInboundAction`: keep. `:92,125,158` "via GET dev simulator" → delete (dev route gone; msg91 equivalents live in msg91-webhook.spec). |
| `tests/messaging/messaging-provider.spec.ts` | Keep; `:87` asserts simulated callback URLs → change if dev-logger `:56` is edited. Outbound factory untouched (P1-15). |
| `msg91-provider`, `msg91-sync-templates`, `outbox-queue`, `tokenized-sharing` (tests/messaging) | Keep, unaffected. |

### A5. Regression tests to add (`tests/security/webhook-lockdown.spec.ts`, local stack per V2-01a)

1. `POST` and `GET /api/webhooks/messaging/dev?from=98&action=btn_cancel` → 404; also `twilio`, `gupshup`, `foo`
   → 404, under `NODE_ENV` test **and** production (stub). Seeded visit unchanged (local DB read back).
2. msg91 with no header, wrong header, correct secret only in `?secret=`, correct `authkey` only, secret env unset
   (all NODE_ENV values) → 401 and 0 rows changed.
3. Timing-safe: `vi.mock("node:crypto", partial)` spy proves `timingSafeEqual` is called on the auth path; a
   different-length secret returns false without throwing; correct header → 200.
4. Cross-tenant `replyMsgId`: tenants A and B each with a queued message + booked visit; `btn_cancel` with A's
   `replyMsgId` cancels A only, B untouched; a queue row whose metadata points at B's visit but `tenant_id` A → no
   change. `from` of B's patient with A's `replyMsgId` → (if hardening adopted) no change.
5. Injection: `replyMsgId = "x,tenant_id.neq.null"` and `"x),or(id.neq.null"` → no match, no mutation; no `.or(` call
   on the query builder (spy) or 0 rows changed (DB).
6. No phone fallback: msg91 inbound `btn_cancel` without `replyMsgId` from a seeded patient's phone → 200 `{ok:true}`,
   visit unchanged.
7. No IDs/tokens: for confirm, cancel, reschedule, triage, every DLR status: body keys ⊆ `{ok, event}`; body
   matches no UUID regex and no reschedule token (`/reschedule/`).

---

## Part B: 01-07 AI-01 containment

### B1. Requirements (quoted)

- Roadmap `:744` V2-01 scope: "**AI-01** (remove both copilots, the drawer, the mic and the mock provider; the scribe
  fails closed)". `:748` acceptance: "no `/api/ai/*` copilot route is reachable".
- Roadmap `:519` AI-01: "Containment: remove both copilots, the drawer, the mic and `MockAiProvider`; scribe fails
  closed; relabel deterministic UI. Replaces P1-22".
- `docs/v2/AI_STRATEGY.md:456` (§11.1 AI-01): "remove copilot drawer and routes, mic, mock provider and `VITEST`
  branch; scribe fails closed; relabel deterministic UI."
- `AI_STRATEGY.md:404` (§8 AI-P0): scope adds "delete `MockAiProvider` and the `VITEST` branch ... relabel A3, A4 and
  A5 (no AI glyph)". Acceptance: "No `/api/ai/*` route reachable. `grep` finds no `VITEST`/`test-api-key` in `lib/`.
  **`next build` with `NODE_ENV=production` and `AI_ENABLED=true` fails when the provider config is incomplete.** No
  sparkle glyph on deterministic UI". Tests: "L1 and L2 CI greps; env-schema unit test; a CI build job with incomplete
  AI env expecting failure; e2e smoke: consult page renders without the drawer".
- `AI_STRATEGY.md:239` §4.6 failure mode: "(a) ... `next build` fail in production when `AI_ENABLED=true` and the Vertex
  config (project, region `asia-south1`, model ID, credentials) is incomplete. (b) At runtime, any failed check returns
  'AI unavailable' with a reason, **never mock output**." `:237` kill switch "env `AI_ENABLED`".
- `AI_STRATEGY.md:64` A8: "**Delete.** Tests use an injected fake adapter, and production fails closed". `:58` A2 mic:
  "Remove in v2.0". `:62-63` A6/A7: remove both copilots. `:384` §7: "no environment-variable branches in production code".
- `AI_STRATEGY.md:492` + `docs/v2/TEST_STRATEGY.md:133`: retire `clinical-copilot.spec.ts`,
  `operations-copilot-ui.spec.ts`, "the copilot parts of `gateway-tools.spec.ts`" and `tests/ai/evals/*`.

### B2. Current sites

- Routes: `app/api/ai/clinical-copilot/route.ts` (105 lines), `app/api/ai/operations-copilot/route.ts` (92; auth then
  `app_metadata` fallback `:24-33`, client-controlled `messages` `:35-40`). Only files under `app/api/ai/`.
- Drawer + Cmd+K: `components/layout/app-header.tsx:9` import, `:24` state, `:26-41` Cmd/Ctrl+K handler (`:42-43` is
  the `/` search shortcut — keep), `:126-~150` trigger button, `:153-157` `<OperationsCopilotDrawer>`.
  `components/ai/*` (6 files, 1,088 lines): `operations-copilot-drawer.tsx` (`useChat` from `@ai-sdk/react`, `:4`,
  `api: "/api/ai/operations-copilot"` `:54`), `action-preview-card`, `chat-bubble`, `conflict-recovery-card`,
  `patient-disambiguation-card`, `quick-registration-card` — only consumer is the drawer.
- Clinical copilot panel: `components/consultation/clinical-copilot-panel.tsx` (521; calls `generateSoapAction` `:87`,
  `suggestIcd10Action` `:110`, renders `IcdCodeSuggestionCard` `:429`). Wiring in
  `components/consultation/consultation-workspace.tsx`: imports `:25-26`, state `:173`, toggle button `:861-876`
  ("AI Copilot", Sparkles), layout `:1021`, desktop panel `:1558-1583`, mobile overlay `:1585-1611`, collision modal
  `:1612-1621`; handlers used only by the panel: `handleInsertChiefComplaints :231`, `handleInsertExamination :263`,
  `handleInsertAdvice :291`, `handleInsertAllSoap :324`, `handleApplyDiagnosis :405`, `collisionModal` state `:179`.
- Scribe: `components/consultation/ai-scribe-modal.tsx` (mic: `Mic` import `:6`, SpeechRecognition types `:20-49`,
  recognition ref/handlers `:73-130`, `lang="en-IN"` `:106`, mic button/notice `:288-295`). **Finding:** the modal is
  mounted at `consultation-workspace.tsx:1669-1678` but `setIsAiScribeOpen(true)` is never called — it is unreachable.
  The only reachable scribe path today is the clinical copilot panel's SOAP tab. Server action:
  `features/ai/actions.ts:21-39` `generateSoapAction` (`consultations:edit`) → `lib/ai/soap-generator.ts:58-128`.
- Mock and VITEST: `lib/ai/client.ts:49` `"test-api-key"` default; `:79-172` `MockAiProvider` (canned SOAP/catch-up/ops
  content incl. fake patient phone); `:185` defaults provider to `"mock"` when no key; `:218-226` mock branch.
  `lib/ai/soap-generator.ts:110-122` Zod-failure partial fallback (dumps shorthand into examination);
  `:123-127` LLM error → `parseShorthandLocally` (regex, invents advice/diagnosis); `:288-320` `extractStructuredSoap`
  with the `VITEST`/`AI_EVAL_LIVE`/`test-api-key` branch (`:302-307`).
- Other LLM caller: `lib/ai/catch-up-summary.ts:111-123` (A3) via `OpenAiGatewayClient`; UI
  `returning-patient-catchup.tsx:77,86,117-118` ("AI Catch-Up", Sparkles). A4 `frequent-rx-chips.tsx:4,76` Sparkles.
- Tools/knowledge: `lib/ai/tools/operations-tools.ts`, `lib/ai/tools/clinical-tools.ts` (both import `ai`'s `tool`),
  `lib/ai/knowledge/product-manifest.ts`; `client.ts:43-77` `getAiGatewayModel` and `:13-41` `geminiFetchInterceptor`
  are used only by the two routes. `features/ai/actions.ts:103-130` `suggestIcd10Action` used only by the panel.
- Other `VITEST` reads in `lib/`: `lib/webhooks/dispatcher.ts:94`, `lib/webhooks/ssrf.ts:103` (SEC-10, not AI).

### B3. "Scribe fails closed" — required meaning

Per `AI_STRATEGY.md:239`, `:64`, `:384` and L2 (`:394`): with AI disabled or misconfigured, or when the provider errors
or returns invalid output, `generateSoapAction` returns `{ success: false, error: "AI unavailable" }` (reason code, no
detail) and **no draft**; never mock content, never regex output, never a partial Zod fallback; no outbound call when
disabled. Config is decided once, not by `VITEST`/key-prefix branches. Since the only compliant provider (Vertex
`asia-south1`) arrives with AI-04 in V2-12, the V2-01 default is **AI off**; see C-B2.

### B4. Exact changes, file by file

Delete (files):
- `app/api/ai/clinical-copilot/route.ts`, `app/api/ai/operations-copilot/route.ts` (→ Next 404 for `/api/ai/*`).
- `components/ai/operations-copilot-drawer.tsx`, `action-preview-card.tsx`, `chat-bubble.tsx`,
  `conflict-recovery-card.tsx`, `patient-disambiguation-card.tsx`, `quick-registration-card.tsx`.
- `components/consultation/clinical-copilot-panel.tsx`, `icd-code-suggestion-card.tsx`, `append-replace-modal.tsx`
  (only used by the panel's insert flow).
- `lib/ai/tools/operations-tools.ts`, `lib/ai/tools/clinical-tools.ts`, `lib/ai/knowledge/product-manifest.ts`
  (C-B5 if the PO wants the manifest kept for Smart Assist).

Edit:
- `components/layout/app-header.tsx`: remove `:9`, `:24`, the Cmd/Ctrl+K branch in `:26-41` (keep `/`), trigger
  `:126-~150`, drawer `:153-157`.
- `consultation-workspace.tsx`: remove panel imports/state/toggle/panels/collision modal and the 5 panel-only handlers
  listed in B2; keep `AiScribeModal` mount and `handleAcceptSoapDraft :465` (no new scribe entry point in V2-01).
- `ai-scribe-modal.tsx`: remove mic (`:6`, `:20-49`, `:73-130`, `:288-295`); handle `success:false` with an
  "AI unavailable" state; drop the "AI Suggested Draft" label on non-LLM output (`:338,394` per AI §1.3).
- `lib/ai/client.ts`: delete `MockAiProvider`, `getAiGatewayModel`, `geminiFetchInterceptor`,
  `SKIP_THOUGHT_SIGNATURE_VALIDATOR`, the `"test-api-key"` literal and the mock branch; `OpenAiGatewayClient` constructor
  throws `AiUnavailableError` unless `AI_ENABLED === "true"` and config is complete; no `"mock"` provider value.
  Tests inject a fake client through the existing `clientOverride` parameter.
- `lib/ai/soap-generator.ts`: delete `extractStructuredSoap` (`:288-320`) and `parseShorthandLocally` (`:137-~286`,
  no other consumer once evals retire); Zod failure and provider error → throw/return unavailable (`:110-127`).
- `features/ai/actions.ts`: `generateSoapAction` maps `AiUnavailableError`/validation failure to
  `{success:false, error:"AI unavailable"}` without logging content; delete `suggestIcd10Action` (`:97-130`).
- `lib/ai/catch-up-summary.ts` (A3): remove the LLM call (`:109-130`), keep the deterministic bullets; relabel
  `returning-patient-catchup.tsx` (no Sparkles, no "AI"; `[AI Catch-Up Summary]` prefix `:77` → neutral). See C-B3.
- `frequent-rx-chips.tsx:4,76`: remove Sparkles (A4 relabel; doctor-filter bug stays for SA-02).
- `lib/ai/index.ts`, `lib/ai/types.ts`: drop exports of deleted symbols.
- `lib/env.ts`: add `AI_ENABLED` (optional, `"true"|"false"`) and a production refine: `AI_ENABLED=true` requires the
  provider config → `next build` fails if incomplete (AI §8). Variable set: see C-B2.
- `package.json`: remove `ai`, `@ai-sdk/react`, `@ai-sdk/openai`, `@ai-sdk/google` (all four have no importer after
  the deletions: importers today are only the two routes, `client.ts`, both tools files and the drawer). See C-B4.
- `tests/setup/test-env.ts:21-31`: add `AI_ENABLED: ["false","0"]` to `PINNED_IF_SET`; `AI_PROVIDER: ["mock"]` and
  `AI_EVAL_LIVE` become inert sentinels (keep or drop; CLAUDE.md command references `AI_PROVIDER=mock`, C-B6).

### B5. Tests: delete / change / keep

| File | Disposition |
|---|---|
| `tests/ai/clinical-copilot.spec.ts` | **Delete** (retired, TEST_STRATEGY:133). |
| `tests/ai/operations-copilot-ui.spec.ts` | **Delete** (retired). |
| `tests/ai/evals/*.spec.ts` (icd10-ranking, negative-syllogism, operations-eval, prescribing-guardrail, shorthand-soap) | **Delete** (retired). |
| `tests/ai/gateway-tools.spec.ts` | **Change → mostly delete.** Keep §1 sanitizer `:22-84` (move to pii-scrubber or keep file). Delete §2 manifest `:86-115`, §3 tool RBAC `:117-167`, §4 ops previews `:169-275`, §5 gateway/Mock/Gemini `:277-350`. |
| `tests/security/ai-rbac.spec.ts` | **Delete** (exercises the removed copilot tools; scribe role matrix is AI-05 L2). |
| `tests/ai/ai-gateway.spec.ts` | **Change.** Delete §1 MockAiProvider `:24-51`; `:53` OpenAI schema test: keep with an injected fake/`fetch` stub and `AI_ENABLED=true`. Keep §2 `:109-147`. §3 `:149-170`: rewrite on the fake client; add fail-closed cases. |
| `tests/ai/prescription-suggestions.spec.ts` | **Change** `:171-240` (catch-up uses `OpenAiGatewayClient({provider:"mock"})`, `:221`) → assert deterministic bullets and no client call. Rx tests `:7-145` keep. |
| `tests/security/pii-scrubber.spec.ts` | **Keep** (sanitizer stays; extended in AI-04). |
| `tests/ai/fixtures/reference-dataset.json` | **Keep** (L3 golden set seed, AI §7; used by pii-scrubber). |
| `tests/setup/test-env-guard.spec.ts:34-35,90` | Change only if the pins change (C-B6). |

### B6. Regression tests to add

1. Routes 404: Playwright `request.post('/api/ai/operations-copilot')` and `/api/ai/clinical-copilot` (authenticated
   and anonymous) → 404; plus build evidence: `.next/server/app-paths-manifest.json` has no `/api/ai/` key.
2. Scribe fails closed (`tests/ai/scribe-fail-closed.spec.ts`): `AI_ENABLED` unset → `generateSoapAction` returns
   `{success:false}` and `fetch` spy is not called; `AI_ENABLED=true` with missing key/model → same; fake client
   throwing → unavailable, no draft; fake client returning invalid JSON or schema-invalid JSON → unavailable, no
   draft; no result ever contains the old mock strings.
3. Env schema: `NODE_ENV=production`, `AI_ENABLED=true`, incomplete config → env validation throws (unit); CI build
   job expecting failure lands with V2-02.
4. Module shape: `import * as ai from "@/lib/ai"` has no `MockAiProvider`/`extractStructuredSoap`/`getAiGatewayModel`.
5. e2e smoke: consult page and app header render with no copilot button, no drawer, no mic button; Cmd+K opens nothing.
6. "No sparkle on deterministic UI": render assertions on catch-up and Rx chips (role/text queries, not class greps).

---

## Conflicts and open points (raise with PO)

- **C-A1 status code.** Roadmap:748 "404 or 401" vs SEC-ASSESS:122 and SEC-VER:111 "403". Recommend 404 for
  non-msg91 providers and 401 for bad msg91 auth; record as erratum to TC-WH-01..03.
- **C-A2 gupshup.** SEC-REM:23 lists gupshup; roadmap:408 does not. Its branch passes unauthenticated outside production
  and uses `===`. Recommend deleting it under "unknown providers default deny".
- **C-A3 phone fallback removal (D9) changes product behaviour:** patient free-text replies without `replyMsgId` will
  no longer reach the receptionist feed or trigger `bot_not_found`. This is what P0-03 mandates; note for PO.
- **C-A4 MSG91 transport.** Unknown whether MSG91 DLR/inbound uses POST body or GET query and whether it can send a
  custom header. Header-only auth requires the console change (SEC-VER:150). If headers are unsupported, P0-03 cannot
  be met as written: stop and ask.
- **C-A5 `authkey` acceptance.** Current code accepts `MSG91_AUTH_KEY` as a webhook credential; SEC-19 says dedicated
  secret only. Recommend drop it (could break a live config that relies on it).
- **C-B1 acceptance wording.** Roadmap:748 "no `/api/ai/*` copilot route" vs AI §8 "No `/api/ai/*` route reachable";
  both satisfied by deleting `app/api/ai/`. AI §8 "`grep` finds no `VITEST` in `lib/`" fails on
  `lib/webhooks/dispatcher.ts:94` and `ssrf.ts:103` (SEC-10): scope the check to `lib/ai/`.
- **C-B2 "fails closed" with no compliant provider.** AI §4.6 defines the build guard for **Vertex** config, which
  does not exist until AI-04/V2-12; today's provider (OpenAI / AI Studio) is rejected by AI §0.2 item 3. Options:
  (a) recommended: `AI_ENABLED` unset/false in every environment until V2-12; the guard requires
  `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL_NAME`, `AI_BASE_URL` now and is re-pointed to Vertex vars in AI-04;
  (b) forbid `AI_ENABLED=true` outright until V2-12. Either way the scribe is unreachable in the UI in V2-01 (its only
  entry point was the copilot panel). PO to confirm.
- **C-B3 catch-up (A3).** AI-01 says "relabel"; AI §1.1 replaces it with deterministic SA-04 later. Removing the LLM
  call now is a small step beyond "relabel" but avoids non-India processing; PO to confirm.
- **C-B4 dependencies.** Removing `ai` and the three `@ai-sdk/*` packages is not named in AI-01; P1-19 (V2-12) plans
  their major upgrade. They are dead after AI-01 and carry 6 SEC-24 findings, so removal is low risk; state it in the
  plan (CLAUDE.md dependency rule) and update P1-19 to "add the gateway dependency" rather than upgrade.
- **C-B5 A5 relabel.** The ICD card only exists inside the copilot panel, so A5 has no UI after AI-01; the
  "relabel A5" item becomes moot (merge into terminology search later).
- **C-B6 test pins and CLAUDE.md.** `tests/setup/test-env.ts:22-24` pins `AI_PROVIDER=mock` and
  `MESSAGING_PROVIDER=dev`; the CLAUDE.md approved command sets both. They stay valid as "offline" sentinels; changing
  CLAUDE.md needs PO approval.
- **C-B7 TC-AI-05** (SEC-VER:113) asserts "via the mock provider capturing the payload"; after AI-01 this must read
  "fake adapter/MSW" (AI §7 L2). Doc erratum.
- **C-B8 grep-style evidence vs DoD.** AI §8 asks for "CI greps"; CLAUDE.md DoD forbids "source-grep tests". Implement
  greps as ESLint/CI checks (evidence), with behavioural tests (B6) as the test evidence.
