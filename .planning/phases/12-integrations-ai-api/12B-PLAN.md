---
phase: "12B"
roadmap_id: V2-12 (part b)
name: AI gateway and AI Scribe v2
revision: "2026-11-28, first revision (CTO delegate; deadline 6 Dec 2026)"
gate: "G4 (light, per PR). One isolated reviewer (Sonnet). One adversarial security reviewer (Opus) over migrations 000165-000169, lib/integrations/ai/**, the scribe action and UI, the opt-in and objection paths, the env schema and every file under 'Security-sensitive files', with the specific brief: can any byte of PHI or a known identifier reach the provider body; can any gate be skipped; can a draft reach the record without a click. One fix round (12B-05a). The PO approves, or approval by delegation with the CI run recorded."
requirements: ["AI-03 app part (requireEntitlement for ai.scribe, opt-in UI, objection UI, kill switch, Preview label, PO-21, PO-25 default)", "AI-04 gateway + Vertex asia-south1 adapter + pseudonymiser + post-checks + ai_calls + rate limits + env build failure + /api/ready AI status (supersedes P1-16, P1-9)", "AI-05 Scribe v2 (C37) on the V2-09b save model", "AI-06 L2 gateway part and L3 harness", "AI-17 provider setup and terms (code and text; account steps are PO actions)", "P1-19 AI SDK major", "05b hand-offs: abort at the reserved timeout, commit within the 30 s grace, discard on AI_RESERVATION_EXPIRED, reservation cleanup job, reservation tied to visit/patient (AI I-2)", "VERIFICATION_LOG 2026-11-15: gateway designed so audio input can be added later without rework"]
plans: ["12B-01", "12B-02", "12B-03", "12B-04", "12B-05a", "close"]
order: "12A merged -> 12B-01 -> 12B-02 -> 12B-03 -> 12B-04 -> reviews -> 12B-05a -> close (sequential)"
preconditions: "12A merged into feature/v2 (rate limiter, zod 4). V2-05 gating DB (000091/000092/000094) and the V2-09b consult save model (000112) present."
migrations: {"12B-01": "000165_ai_gateway", "12B-03": "000166_scribe_provenance", "12B-05a": "000169_review_fixes_12b (only if needed)"}
migrations_note: "Range 000165-000169 (shared range 000160-000169 with 12A). Same registry rules as 12A."
new_dependencies: {"ai": "major upgrade 4.3.19 -> exact pin of the latest stable major at install (P1-19; generateObject with provider-native structured output)", "@ai-sdk/google-vertex": "exact pin matching the ai major; the Vertex provider for the only approved AI provider (AI §3.2); replaces @ai-sdk/google"}
removed_dependencies: ["@ai-sdk/google", "@ai-sdk/openai", "@ai-sdk/react (no chat UI in v2.0)"]
branch: "v2/phase-12b-ai-scribe -> PR into feature/v2"
source: "docs/v2/AI_STRATEGY.md §3.2, §4.1-§4.8, §5.3, §6.2, §7, §8, §9, §10, §11; roadmap PO-9, PO-21, PO-22, PO-25, C37, C41, C48, §12 V2-12; DATA_HANDLING §4, §5 (AI metadata row); SUBSCRIPTIONS_AND_PLANS §6.1, §7; 05b-SUMMARY hand-offs; 09B-NOTES (scribe modal removed, generateSoapAction kept for V2-12); DESIGN_SYSTEM AI token, glyph, Preview chip (AI-02)"
must_haves:
  truths:
    - "Every LLM call goes through lib/integrations/ai/gateway.ts and follows AI §4.1 steps 1-11 in order; there is no other import path to the provider (ESLint boundary rule)."
    - "The provider body contains only pseudonymised text and the allow-listed structured context; a 10-digit run after replacement blocks the request before the provider; the host is asia-south1-aiplatform.googleapis.com and the env schema refuses any other location."
    - "A non-entitled, opted-out, objected, over-quota, rate-limited, killed or offline request shows its specific message, keeps the doctor's notes unchanged and never calls the provider."
    - "During the trial the scribe shows the Preview chip and the note 'AI features are in preview and not yet offered as a paid product', with no meter, price or upsell, and only after the owner's one-time opt-in; after the trial (PO-25 default) the entry point is absent and the server denies ai.scribe."
    - "A draft reaches the clinical record only by the doctor accepting a section through save_consultation_draft; the saved record carries the ai_call_id and whether it was accepted as-is or edited, with an audit event."
    - "ai_calls has no text columns; detail rows live 90 days and roll up into a platform aggregate without tenant or user ids."
  artifacts:
    - "supabase/migrations/000165_ai_gateway.sql, 000166_scribe_provenance.sql; supabase/tests/database/{ai_calls,ai_gateway_gates,scribe_provenance}.test.sql"
    - "lib/integrations/ai/{gateway.ts,provider.ts,vertex.ts,fake.ts,pseudonymise.ts,post-checks.ts,context.ts,errors.ts,config.ts,prompts/scribe.v1.ts,schemas/scribe.v1.ts}"
    - "features/ai/{scribe-action.ts,opt-in-action.ts}, components/consult/scribe-panel.tsx, app/(dashboard)/settings/ai/page.tsx"
    - "tests/ai/{pseudonymise-corpus.spec.ts,post-checks.spec.ts,gateway-l2.spec.ts,vertex-contract.spec.ts}, tests/ai/fixtures/golden/*.json (>= 60), scripts/ai/eval-l3.mjs, .github/workflows/ai-eval.yml (workflow_dispatch only), tests/e2e/consult/scribe.spec.ts"
  key_links:
    - "gateway.ts calls public.ai_preflight / ai_reserve (000091) with the visit id, then pseudonymise, provider, post-checks, a second ai_preflight (step 9), then ai_commit or ai_release, and writes ai_calls through public.ai_record_call."
    - "context.ts builds the scribe context on the server from visitId through an INVOKER read (age, sex, vitals, coded chronic conditions) and refuses when patients.ai_processing_objected."
    - "The scribe panel's accept writes through the existing save_consultation_draft with p_ai_provenance; no new write path to clinical notes."
---

# V2-12b AI gateway and AI Scribe v2: plan

## Goal

The single LLM feature of v2.0, the AI Scribe (a trial Preview only, PO-21), runs on Vertex AI `asia-south1` through one gateway
that cannot be bypassed, never sends identifiers, never writes to the record without the doctor, and can be switched off without a
deploy. Everything ships and is tested with a fake provider; the real provider is configured by the PO and switched on only after the
L3 eval passes.

## Current state (inventory 2026-11-28)

- `lib/ai/client.ts`: hand-written OpenAI-compatible fetch client for six providers; `lib/ai/soap-generator.ts`; `lib/ai/sanitizer.ts`
  (regex phone/Aadhaar/ABHA only); `features/ai/actions.ts:39` `generateSoapAction` with no UI caller and no `ai_reserve` call.
- `ai` 4.3.19 and `@ai-sdk/{google,openai,react}` installed, imported nowhere. No Vertex code.
- DB gating exists (000091/000092/000094): `tenant_ai_settings`, `patients.ai_processing_objected` (+ stamp and audit triggers),
  `ai_usage_monthly`, `ai_quota_reservations`, `private.ai_gate`, `ai_preflight`, `ai_reserve`, `ai_commit`, `ai_release`,
  `set_ai_opt_in`; kill switch `platform_settings.ai_features` (000082); `has_entitlement` (000083); seeds `ai.scribe` and
  `ai.scribe.monthly_drafts` = 1500 on trial (000084). No `ai_calls`; no reservation cleanup job.
- `lib/entitlements/require-entitlement.ts` exists (used for `assist.slots`).
- Consult save model: `public.save_consultation_draft` (000112, `draft_version`).

## Decisions (CTO delegate)

- D-1 **Delete the multi-provider client.** `lib/ai/{client,soap-generator,sanitizer,types}.ts` and `features/ai/actions.ts` are
  removed; their useful parts (shorthand regexes for drug detection, the reference dataset) move into the gateway and tests. One
  provider in v2.0 (AI D-7).
- D-2 **Credentials:** a Vertex service-account key (role `roles/aiplatform.user` only) in a Vercel Sensitive env var
  `GOOGLE_VERTEX_CREDENTIALS` (base64 JSON). Workload Identity Federation via Vercel OIDC is unconfirmed (AI §3.1) and can replace it
  later without code outside `vertex.ts`.
- D-3 **Model:** `gemini-3.5-flash-lite` pinned by exact version in config (`AI_MODEL_ID`), location fixed `asia-south1`; switching to
  3.5 Flash needs an L3 report (release rule, AI §7).
- D-4 **Ships killed in production.** `platform_settings.ai_features.ai.scribe` defaults to false in production seeds and
  `AI_ENABLED=false`; the PO's switch-on is a recorded step after the L3 report is reviewed (see C-1). Staging may switch on after the
  eval project exists.
- D-5 **Fake provider is a test seam, not a runtime mode.** `fake.ts` is importable only from `tests/**` (ESLint rule); production code
  has no env branch to it (AI §7 "no environment-variable branches"). The e2e server uses an MSW-backed Vertex stub on loopback via the
  allowlisted test env, never a code branch.
- D-6 **Audio-ready interface.** `AiProvider.generateStructured({schema, system, input: {kind: 'text'} | {kind: 'audio_ref'}})`; only
  `text` is implemented; `audio_ref` throws `NOT_SUPPORTED` (VERIFICATION_LOG 2026-11-15, v2.1 voice).
- D-7 **Reservation tied to the visit** (05b AI I-2): `ai_reserve` gains `p_visit_id`; a reservation for one visit cannot be committed for
  another; the timeout contract is the 05b one (abort at the reserved timeout, commit within 30 s grace, discard on
  `AI_RESERVATION_EXPIRED`).
- D-8 **Six failure states plus two.** The panel has fixed copy for: not entitled (entry point absent), not opted in (owner: "Turn on in
  Settings", others: "Ask the clinic owner"), patient objected (entry point absent on that visit), over quota, provider unavailable,
  offline, rate limited, and "Could not draft, your notes are unchanged" (schema/post-check failure).
- D-9 **Owner opt-in page** `/settings/ai` (owner only): AI terms v1 and the patient-notice text (Claude-drafted per AI-17, PO-12
  delegation), the Preview note, a single "I accept and turn on" (calls `set_ai_opt_in` with the terms version) and "Turn off". Text lives in
  `lib/integrations/ai/terms.ts` with a version string.
- D-10 **Objection UI** lives where the patient's details are edited (QuickRegister already has it, V2-08) and as a toggle in the consult
  patient header for doctors and receptionists; it follows the patient-update permission.
- D-11 **ai_calls rollup** runs as job kind `ai.calls_rollup` (daily) together with `ai.reservations_cleanup` (every 10 min); V2-13
  registers both as retention rules.
- D-12 **L3 golden set** (>= 60 synthetic cases) is Claude-authored and Claude-reviewed under the recorded PO risk acceptance (PO-22,
  D-9 of AI §10).

## CTO decisions needed

- **C-1 L3 acceptance depends on a PO account.** Roadmap acceptance "the L3 thresholds are met" needs the eval GCP project and a
  budget-capped key (PO action). **Recommend:** 12B closes its gate with L1/L2 green and the L3 harness proven against the fake; the scribe
  stays killed in production (D-4) until the PO runs `ai-eval.yml`, the report meets the thresholds and an isolated reviewer checks it;
  that report is a precondition of G5, not of the 12B merge.

## Shared rules

As 12A "Shared rules for every plan" (09E conventions, registries, latency lane, no outside hosts). In addition: **no test, script or
CI job calls Vertex or any AI host**; `tests/setup/worker-guard.ts` already refuses non-loopback traffic; the L3 workflow is the only
place a real AI call is made and it runs only on `workflow_dispatch` by the PO with synthetic data. No prompt ever contains PHI: only the
pseudonymised doctor input and the allow-listed context (AI §4.2). Logs carry `ai_call_id` and error class only.

## Security-sensitive files

`supabase/migrations/000165..000169`; `lib/integrations/ai/**`; `features/ai/**`; `components/consult/scribe-panel.tsx`;
`app/(dashboard)/settings/ai/**`; `lib/env.ts` (AI keys); `app/api/ready/**` (AI status); `eslint.config.*` boundary rules;
`.github/workflows/ai-eval.yml`; `scripts/ai/eval-l3.mjs`.

## Plans

### 12B-01 AI SDK major, gateway, pseudonymiser, Vertex adapter, ai_calls · L · migration 000165_ai_gateway · split point after step 3

Goal: AI-04, P1-19 (AI SDK). The gateway with every gate, tested end to end against a captured provider.

Files: `000165_ai_gateway.sql`: `public.ai_calls(id, tenant_id, user_id, visit_id, feature, provider, model, region, prompt_version,
input_tokens, output_tokens, latency_ms, status, error_class, pii_blocked, fabrication_drops, cost_estimate_paise, accepted
none|partial|all|edited, created_at)` — no text columns, RLS read for owner only, no tenant writes; `public.ai_record_call(...)` and
`public.ai_mark_accepted(p_call_id, p_mode)` SECURITY DEFINER (caller must be the call's user in the same clinic); `ai_reserve` gains
`p_visit_id` (D-7, dropped and created again with the parameter last, `DEFAULT NULL`, grants restored); `ops.ai_usage_platform_monthly
(period, feature, model, calls, tokens, cost_paise)`; job kinds `ai.reservations_cleanup` and `ai.calls_rollup` with pg_cron schedules
and dedupe keys. `lib/integrations/ai/*` per artifacts; `lib/env.ts`: `AI_ENABLED`, `AI_PROVIDER` = `vertex` only, `GOOGLE_VERTEX_PROJECT`,
`GOOGLE_VERTEX_LOCATION` literal `asia-south1`, `AI_MODEL_ID`, `GOOGLE_VERTEX_CREDENTIALS`; production build fails when `AI_ENABLED=true`
and any is missing (AI §4.6 failure mode a); `/api/ready` reports `ai: disabled | configured | killed` (no network call); ESLint: only
`lib/integrations/ai/**` may import `ai`/`@ai-sdk/*`; only `tests/**` may import `fake.ts`.

1. Tracer: `gateway.generateScribe({visitId, shorthand})` with the fake provider returns a validated draft, writes one `ai_calls` row,
   commits one unit of quota.
2. `pseudonymise(text, knownIdentifiers)` (AI §4.2: phones, Aadhaar, ABHA, email, PIN, DOB-form dates, known identifiers with
   case-insensitive whole-word and transliteration variants; >= 10-digit run blocks) and the corpus (>= 100 synthetic strings incl.
   Hinglish).
3. Vertex adapter on the new AI SDK (`generateObject`, provider-native schema, timeout = reservation timeout, abort signal); host
   asserted. (split point)
4. Gate order AI §4.1 1-11 in `gateway.ts`; rate limits `ai.user`/`ai.tenant` from 12A; mid-call re-check (step 9) discards and releases.
5. Delete `lib/ai/**` and `features/ai/actions.ts` (D-1); remove the three old packages; drop the audit allowlist row from 12A-01.

Tests: L1 `pseudonymise-corpus.spec.ts` (100%), `post-checks.spec.ts` (source_span cases: expansions kept, invented dropped; drug in advice:
doctor-written kept and flagged "move to Rx", invented dropped; examination empty without an exam marker). L2 `gateway-l2.spec.ts` with
MSW capturing the Vertex request (stack up): outbound body contains no known identifier and no 10-digit run; hostname
`asia-south1-aiplatform.googleapis.com`; malformed model output -> "could not draft" with quota released; reservation expiry restores quota;
one row per subscription state (AI §4.6 table: incomplete, trialing, active standard, comped override, expired, archived) and the
not-entitled, not-opted-in, objected, killed (env and platform flag), over-quota, rate-limited cases each with zero provider requests;
mid-call kill -> draft discarded; nurse and receptionist get 403. pgTAP `ai_calls.test.sql` (column list has no text type, grants, owner-only
read, cross-tenant refusal) and `ai_gateway_gates.test.sql` (reserve tied to visit, two parallel reserves at quota minus 1 -> exactly one).
Env unit test: production build config with `AI_ENABLED=true` and a missing key fails. **Fails-without (High: PHI to provider):** with the
known-identifier step removed, the MSW capture contains the synthetic patient's name; recorded, restored. **Fails-without (High: gate
skipped):** with the objection check removed from `context.ts`, the objected-patient case reaches the provider; recorded, restored.
Run: Vitest `tests/ai tests/entitlements tests/env`, pgTAP files, `npm run ci:ai-l1`.
Done: gateway complete with fake and MSW; old AI code and packages gone; 0 high/critical audit with no allowlist row.

### 12B-02 Opt-in, objection and entitlement surfaces · M · no migration

Goal: AI-03 app part, AI-17 text, PO-21/PO-25 visibility rules.

Files: `app/(dashboard)/settings/ai/page.tsx` and `features/ai/opt-in-action.ts` (owner only, `requireRecentAuth` if enrolled per
V2-11, calls `set_ai_opt_in`); `lib/integrations/ai/terms.ts` (AI terms v1 incl. OS dictation and AIR-9 disclosure; patient-notice text;
intended-use statement "documentation aid; does not diagnose, treat or recommend therapy"; disclaimer string); the QuickRegister notice
text replaced by the final version (V2-08 left a placeholder); the objection toggle in the consult patient header (D-10) through the
existing patient-update path; `my_entitlements` consumers decide whether the scribe entry point renders; the settings nav shows "AI
(Preview)" only while `ai.scribe` is entitled; the CI copy grep (AI-02) extended to the new pages.

1. Tracer: an owner of a trialing clinic opens `/settings/ai`, accepts, and `tenant_ai_settings.enabled` is true with the terms version.
2. Page, action, objection toggle, entry-point rules; specs.

Tests: Vitest: action refuses non-owners and locked clinics; terms version stored. e2e (desktop-chrome, pixel-7, iphone-15): owner opt-in
and opt-out; a doctor sees "Ask the clinic owner"; after `TEST_NOW` past trial end (PO-25 default) the settings entry and the consult entry
point are absent and the server action denies; the Preview chip and the exact note are visible and no meter, price or "Buy"/"Upgrade"
text exists on the AI surfaces (DOM assertions); axe clean at 360/820/1280.
Run: Vitest `tests/ai tests/settings`, e2e `tests/e2e/settings tests/e2e/consult`.
Done: consent path complete; visibility follows entitlement.

### 12B-03 AI Scribe v2 · L · migration 000166_scribe_provenance

Goal: AI-05 (C37). Doctor types shorthand, gets a structured draft, accepts per section; the record carries provenance.

Files: `000166_scribe_provenance.sql`: `save_consultation_draft` gains `p_ai_provenance jsonb DEFAULT NULL` last (dropped and created
again, grants and comment restored): `{ai_call_id, sections: {complaints|examination|advice: 'as_is'|'edited'}}`, validated (the call
belongs to the same visit, user and clinic, status ok, not older than 2 h), stored on the draft row, carried into the signed note by the
existing sign path, audit `ai.draft.accepted` (metadata: call id and modes only), and `ai_calls.accepted` updated in the same transaction;
refused after signing (Rule H4). `features/ai/scribe-action.ts` (input `{visitId, shorthand}` only; `requirePermission` consult edit;
gateway); `prompts/scribe.v1.ts`, `schemas/scribe.v1.ts` (`{text, source_span}` items, `diagnosis_as_written`); `components/consult/
scribe-panel.tsx` (V2-06 parts, AI token and glyph, "AI draft — review before saving", Preview chip and note, per-section Accept / Accept
all / Discard, source-span highlight, "move to Rx" flag on kept drug mentions, every D-8 state); wiring into the consult workspace; the
draft lives only in component memory (never in the query cache persisted anywhere, never in IndexedDB).

1. Tracer: with MSW Vertex returning a recorded synthetic structured response, the doctor drafts, accepts complaints only, saves; the draft
   row has provenance for complaints `as_is`; one audit row.
2. Migration, action, panel, specs.

Tests: pgTAP `scribe_provenance.test.sql` (call of another visit/user/clinic refused, stale call refused, signed visit refused, audit row,
`ai_calls.accepted` set, `draft_version` stale-write rule unchanged). Vitest: action input schema rejects any field other than visitId and
shorthand. e2e `tests/e2e/consult/scribe.spec.ts` (all three devices): draft -> edit examination -> accept all -> save -> provenance
`edited` for examination in the DB; nurse sees no entry point; objected patient sees no entry point; offline (Playwright `setOffline`)
shows the offline state and the notes are unchanged; provider 503 shows "unavailable" and notes unchanged. **Fails-without (High: write
without a click):** with the accept handler auto-invoked on draft arrival, the e2e "notes unchanged until accept" assertion fails; recorded,
restored. Latency lane: the consult screen row's calls and depth unchanged (the panel adds no read until opened).
Run: Vitest `tests/ai tests/consultation`, pgTAP file and the 09B consult files, e2e `tests/e2e/consult`, `npm run perf:latency`.
Done: scribe works end to end with the stub; provenance stored.

### 12B-04 L3 harness, kill-switch and outage drills · M · no migration

Goal: AI-06 L3 and AI §8 AI-P4 drills, runnable now locally against the stub and by the PO against the eval project.

Files: `tests/ai/fixtures/golden/*.json` (>= 60 synthetic cases: standard OPD, Indian shorthand, Hinglish, paediatric, chronic follow-up,
empty/garbage, adversarial injection, PII-laden), labels per AI §7; `scripts/ai/eval-l3.mjs` (computes schema validity, complaint
recall/precision, fabricated-item rate, examination fabrication, invented drug-in-advice, PII echo, p95 latency, tokens, cost; writes
`evidence/ai-l3-<date>.json` and fails under the thresholds of AI §7); `.github/workflows/ai-eval.yml` (`workflow_dispatch` only,
environment `ai-eval` with the PO-held secret, uploads the report artifact); a `--provider stub` mode that runs the same scorer over
recorded stub outputs in CI (proves the scorer, not the model); `docs/ops/ai-runbook.md` (kill switch by SQL and env, outage behaviour,
key rotation, budget alert response); drills as e2e: platform flag flipped mid-session -> the next draft shows the killed message and no
provider request; Vertex stub returning 503/timeout -> "unavailable", notes untouched, quota released.

Tests: the stub-mode scorer run in CI (thresholds on stub data must pass; a corrupted stub case must fail: fails-without for the scorer);
the two drill e2e files on desktop-chrome.
Run: `node scripts/ai/eval-l3.mjs --provider stub`, e2e `tests/e2e/consult/scribe-drills.spec.ts`.
Done: harness ready; the live L3 run is a PO action (C-1).

### 12B-05a Review fixes · S-M

As 12A-06a, with the adversarial brief in the frontmatter gate.

### Close

As 12A close, evidence dir `evidence-12B`; add the AI-17 configuration evidence slots (cache-config GET output, request-response logging
off, ZDR request outcome, budget alert and Vertex quota) as PO-supplied files referenced in `12B-VERIFICATION.md`, marked pending until
supplied.

## Threat register (short)

| Threat | Control | Proof |
|---|---|---|
| PHI in the provider body (I) | server context allow-list + mandatory pseudonymise + 10-digit block | fails-without 12B-01 |
| Gate skipped via another import path (E) | ESLint boundary + single gateway | lint test case |
| Objected patient processed (I, consent) | context refuses; entry point hidden | fails-without 12B-01 |
| Wrong region (I) | env literal + host assertion | L2 hostname case |
| Cost abuse (D) | rate limits, quota with expiring reservations, Vertex quota, budget alert | L2 cases, pgTAP concurrency |
| Prompt injection writes clinical content (T) | structured output, source_span grounding, per-section human accept | post-checks + e2e |
| Provenance forged for another visit (T) | definer validation of call/visit/user/clinic | scribe_provenance.test.sql |

## Doc amendments (at the close)

AI_STRATEGY §4.1 step 5 (reservation carries visit id), §3.2 (credential approach D-2), roadmap P1-19 (AI SDK done), DATA_HANDLING §4
processors row for Google (model and region pinned), DESIGN_SYSTEM (scribe panel states if new parts were added).

## PO actions (external)

1. GCP: dedicated production AI project and a separate eval project; Vertex API on; **caching off** (record the GET cache-config output);
   request-response logging off; no Grounding with Google Search; Vertex quota (requests/tokens per minute) and a budget alert on both
   projects; accept the Google Cloud DPA; request ZDR through the account team and record the outcome (AI-17, AIR-9).
2. Service account with `roles/aiplatform.user` only; put its key in Vercel staging/production as `GOOGLE_VERTEX_CREDENTIALS` (Sensitive)
   with `GOOGLE_VERTEX_PROJECT`, `AI_MODEL_ID`; never in `.env` or the repo.
3. Eval key (budget-capped) as the GitHub Actions secret of environment `ai-eval`; run `ai-eval.yml`; send Claude the run link.
4. After the L3 report is reviewed: switch on `AI_ENABLED` and the `ai.scribe` platform flag (SQL given in the runbook).
5. Accept (or change) the Claude-drafted AI terms and patient notice in `lib/integrations/ai/terms.ts` (PO-12 delegation).

## Hand-offs

- V2-13: retention rules for `ai_calls` (90 d), `ai_usage_monthly` (13 months), `ai_quota_reservations`, deletion at archive.
- V2-13c: AI ops view in the admin portal (SQL view now: `ops.ai_weekly` over `ai_calls`).
- v2.1: `audio_ref` input (voice), Bedrock adapter (AI-26).

## Out of scope

Copilots, dictation, patient-advice translation, any purchasable AI (PO-21), class-level allergy checks.
