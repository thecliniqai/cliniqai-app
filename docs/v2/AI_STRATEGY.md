# clinicOS v2: AI strategy (LLM "AI Assist" and deterministic "Smart Assist")

**Status:** planning only; G1 approved 2026-11-10 with round-2 amendments (roadmap §16). **Author:** Claude (lead designer/architect, AI track). **Date:** 2026-11-10 (revised the same day after an independent review; see "Review disposition" at the end).
**Inputs:** SEC-15 and SEC-16 (`SECURITY_ASSESSMENT.md:224-245`), `DATA_HANDLING.md` §§ processors, AI and retention, `VERIFICATION_LOG.md` (SEC-15, SEC-16, D15, E-6, F8/D8, OI-9), the AI code (`lib/ai/**`, `features/ai/actions.ts`, `app/api/ai/**`, `components/ai/**`, `components/consultation/*`), the AI tests (`tests/ai/**`, `tests/security/pii-scrubber.spec.ts`, `tests/security/ai-rbac.spec.ts`), and the PO decisions of 2026-11-10.
**Companion:** `SUBSCRIPTIONS_AND_PLANS.md` ("SUB") owns plans, prices, the subscription lifecycle, `has_entitlement()` and the entitlement tables. This document owns the **final list of AI and assist feature keys** (SUB §7.3 defers to it) and the rules for using them. Where the two documents currently disagree, §11.2 lists the reconciliation.

Labels: **Fact**, **Problem**, **Risk**, **Assumption (validate)**, **Recommendation**, **Open question**. Priorities P0 to P3. Sizes S/M/L/XL are relative. ⚖ marks a legal point. There is no counsel and no human reviewer on the team (PO-10 to PO-18: PO + Claude only), so ⚖ items carry a conservative default and the PO decides on residual risk. There is no pilot: v2 goes live only once complete (PO-15). External facts were checked on 2026-11-10; anything I could not confirm is marked **(unconfirmed)**.

---

## 0. The decision in one page

> Update (2026-11-10, PO round 3; roadmap C48, C46, PO-25, V2-16; SUBSCRIPTIONS_AND_PLANS §14.12 SUB-D10; VERIFICATION_LOG addendum 4). **These override the round-2 banner below where they disagree.**
> - **AI preview consent: decided (C48).** A **one-time clinic-owner opt-in** (accepting the AI terms, which say the feature is a preview and that pseudonymised text is processed by Google) stays mandatory before the first draft. The PO's "silently" is interpreted as **no purchase or upsell flow, no quota meter and no quota marketing**, not as sending patient-derived data to Google without the clinic's consent. Reasoning: DPDP consent and notice, and the PO's explicit wish not to lose clinics' trust ("instead of misleading and loosing trust"). The 1,500-draft quota itself stays silent. This replaces the round-2 "Deviation (PO to accept)" label in §4.6.
> - **PO-25 stays the only open AI product decision** (default applies: preview access ends when the trial ends and AI shows "Coming soon").
> - **UAT stage (roadmap V2-16):** real-world UAT testers enter with `uat` coupon codes; by default (SUB-D10) they keep the AI preview, with the same owner opt-in, until the UAT exit date (`free_until`) rather than only for the 14-day trial; it then follows PO-25. A per-tenant `tenant_entitlement_overrides` grant with `expires_at = free_until` implements this without a code path.

> Update (2026-11-10, PO round-2 decisions; roadmap PO-21 ✅, PO-22 ✅, PO-23 ✅, PO-25, C41; VERIFICATION_LOG addendum 3). **These override anything below that disagrees.**
> - **No purchasable AI in v2.0.** The PO: "lets not give an option of AI yet at all to suers to subscribe to, Just mark it as coming soon." The AI Assist add-on, its price and its second Razorpay subscription (SUB-11) are **deferred until the AI Voice Receptionist launch**. Plan and billing pages show AI as **"Coming soon"** (no price, no buy button, no upsell in clinical screens).
> - **Trial preview.** "For Trails yes we will enable by default of 1500 draft requests but silently, just a note somewhere saying that AI fearures are in "preview" mode." During the 14-day trial the AI Scribe is available with a **1,500-draft trial quota**, counted over the whole trial (not per calendar month), with a **"Preview"** chip and the note **"AI features are in preview and not yet offered as a paid product"**. No quota meter, price or upsell is shown; a clear message appears only if the quota runs out.
> - **Safety unchanged.** Preview prompts still go to Google, so **every control in §4 applies to preview use**: entitlement check, **owner opt-in with acceptance of the AI terms (which say the feature is a preview)**, the patient objection flag, pseudonymisation, structured output with source spans, per-section human acceptance, Vertex `asia-south1` only, rate limits, quota and the kill switch.
> - **After the trial (PO-25, default):** preview access ends with the trial; the scribe is not shown in the consult screen; accepted notes and their provenance stay. Alternative: keep the preview quota for paying clinics by SQL.
> - **Configurable for later products.** Pricing must stay configurable because the AI Voice Receptionist will be priced very differently (likely per minute or per call). The SUB catalogue therefore models products with prices of several billing models (`flat_recurring`, `per_unit_recurring`, `metered`, `included_plus_overage`, `prepaid_pack`), a backend availability switch (`purchasable`, `visibility`) and the existing metered quota (`ai_usage_monthly` with a `feature` unit such as drafts or minutes) (SUB §7.1). D-1's ₹499 estimate is kept only as an input for that launch.
> - **Backlog:** AI-18 now seeds the catalogue rows (not purchasable) and the trial quota, in **V2-05**; AI-02 adds the "Preview" and "Coming soon" treatments; SUB-11 is deferred.

> Update (2026-11-10, PO decisions): Roadmap reconciliation (V2_MASTER_ROADMAP §10.3):
> - **C33:** D-1's pricing **mechanism** is replaced by SUB-D8 (a). AI Assist is sold as a separate add-on, billed as a second Razorpay subscription (`ai_assist`, a `tenant_addons` row), because Razorpay UPI/eMandate subscriptions cannot be updated. D-1's price and pooled-quota recommendation stands. The body below has been rewritten for the add-on (final review); `ai_pro` no longer appears as a plan. **Superseded by C41 (round 2): no AI is sold in v2.0.**
> - **C34:** D-2 (trial quota = paid quota) stands over SUB's 100-draft default.
> - **C37:** AI-05 (Scribe v2) is delivered in **V2-12**, after the AI-04 gateway, on top of the V2-09b save model.
> - **PO items:** D-1/D-2 become roadmap PO-21; D-9, D-10 and D-11 become PO-22; D-8 is part of PO-23. PO-9 is recorded as decided per this document.

### 0.1 Facts

1. **SEC-15 is not an AI finding.** SEC-15 covers the messaging "dev logger", which writes patient phone numbers and message parameters to logs (`lib/messaging/index.ts:20-31`, `lib/messaging/dev-logger.ts:59-90`). It is fixed by roadmap items P0-03 and P1-15 and SECURITY_REMEDIATION P0-8 (§2.2). **SEC-16 is the AI finding**, and this document resolves it.
2. **India-region LLM processing is available.** Vertex AI (now documented as "Gemini Enterprise Agent Platform") processes Gemini 3.5 Flash-Lite, 3.5 Flash and 2.5 Flash in `asia-south1` (Mumbai) on the regional endpoint; global endpoints carry no residency guarantee [1]. Bedrock offers Claude in India through geo inference (Mumbai and Hyderabad) [4].
3. **v1 labels deterministic output as "AI"** (§1.3), and its "AI evals" never call a model (E-6).

### 0.2 Recommendations

1. **Ship one LLM feature in v2.0, built properly: the AI Scribe** (round 2: as a trial **Preview** only, not sold) (shorthand text to a structured SOAP draft that the doctor accepts section by section). It has the best value for its risk. It needs no tools, works with pseudonymised input, the doctor reviews every output, and it is clinical documentation rather than diagnosis.
2. **Retire the two copilots for v2.0.**
   - **Operations copilot:** its Confirm button for reschedule and cancel does nothing (F8). It sends patient names and phone numbers to the LLM (SEC-16). And the v2 command palette plus the new front-desk screens cover its purpose more quickly. It comes back in v2.1 as a paid feature (`ai.operations_copilot`), rebuilt on the server commands from V2-07.
   - **Clinical Q&A copilot:** open-ended medical answers are the highest clinical-safety and regulatory exposure (CDSCO clinical decision support) for the least verifiable value. It is deferred with no date and needs its own decision later.
3. **Provider: Google Vertex AI, Gemini, pinned to the regional `asia-south1` (Mumbai) endpoint, and only that in v2.0.** The gateway keeps an `AiProvider` interface so a second provider can be added later. On a provider outage the scribe shows "unavailable" and the doctor types notes as usual. A Bedrock India adapter is a v2.1 item (AI-26). Do not use AI Studio keys (today's setup) or any "global" endpoint.
4. **The base plan gets "Smart Assist"**: deterministic features built in TypeScript and SQL that make the product feel smart, including terminology search with synonyms, the doctor's own prescribing favourites, shorthand expansion, a patient snapshot, slot suggestions, duplicate-patient detection and follow-up booking. **No Python service** (D-8): nothing in the catalogue needs one.
5. **Honest labelling:** only LLM features may carry the word "AI" or the sparkle glyph. Deterministic features are called **Smart Assist** (or carry no label). This deviates from the PO's wording ("feels like AI") and is recorded as D-8.
6. **Gating:** *(round 2: no AI is sold in v2.0; the scribe is a trial Preview with a 1,500-draft quota and "Coming soon" elsewhere, see the update above; the pricing sentences below describe the deferred add-on.)* LLM features are paid, and **included during the 14-day trial**. Each request is checked on the server for the feature key (`ai.scribe`), subscription state, owner opt-in, the patient's objection flag, a monthly quota and a kill switch. **Pricing:** an "AI Assist" **add-on** (`ai_assist`), billed as a second Razorpay subscription on top of Standard (SUB §7.4, roadmap C33), per clinic, with a pooled monthly draft quota. The initial price and cap are estimated from L3 eval token counts before go-live and re-priced after the first 2 weeks of production `ai_calls` data (D-1).

---

## 1. Inventory of current AI features (v1)

### 1.1 Feature table

| # | Feature (entry point) | What it does | LLM or deterministic | Data sent to the provider | Key problems (evidence) | Risk | Verdict for v2.0 |
|---|---|---|---|---|---|---|---|
| A1 | **AI Scribe**: `components/consultation/ai-scribe-modal.tsx` → `generateSoapAction` (`features/ai/actions.ts:21-39`) → `generateSoapFromShorthand` (`lib/ai/soap-generator.ts:58-128`) | Turns shorthand or dictation into `{chief_complaints, examination, diagnosis_hypothesis, advice}` | **LLM** (OpenAI-compatible chat call, `lib/ai/client.ts:211-273`); falls back to a regex parser | Free-text shorthand **unscrubbed**; age, sex, vitals and conditions **supplied by the client** (`actions.ts:21-30`; workspace passes them at `consultation-workspace.tsx:1564-1600`) | `stripPiiFromText` is never called (SEC-16). The LLM is told to infer a diagnosis "if stated or strongly implied" (`soap-generator.ts:52`). When the LLM fails, the **silent fallback** returns regex output that is still shown as an "AI Suggested Draft" (`soap-generator.ts:123-127`, modal `:338,394`). The fallback **invents advice and a diagnosis** that the doctor never wrote (`soap-generator.ts:237-275`, including a fixture-specific `152/94` hack at `:263`) | **High** (clinical integrity) | **Keep, rebuild** as the paid `ai.scribe` (§3, §6) |
| A2 | **Voice dictation** inside A1 (`ai-scribe-modal.tsx:96-106`, Web Speech API, `lang = "en-IN"`) | The browser converts speech to text | Browser or OS speech service | **Raw audio of the consultation**: Chrome's default engine sends it to Google servers, and other browsers use their vendor's service. This is an **undocumented sub-processor flow** that is in no processor list | No contract, no residency, behaviour varies by browser. `processLocally` is experimental (MDN) | **High** (privacy) | **Remove in v2.0.** clinicOS provides no dictation. A doctor's OS keyboard dictation is the clinic's own device choice, outside clinicOS processing, and the clinic AI terms say so ⚖. Server speech-to-text in India is a v2.1 candidate (AI-24) |
| A3 | **Returning-patient catch-up**: `returning-patient-catchup.tsx` → `generatePatientCatchUpSummary` (`lib/ai/catch-up-summary.ts:18-161`) | Three bullets summarising the last 3 visits | **LLM**, with a deterministic fallback | Visit dates, diagnoses and medicine names (no direct identifiers) | It counts `booked` and `waiting` visits as history (`:37`). The LLM adds little over a template. It is labelled "AI" even when the fallback runs (`returning-patient-catchup.tsx:77,118`). The mock provider returns **invented clinical history** when no key is set (`client.ts:87-97`) | Medium | **Replace with a deterministic "Patient snapshot"** (Smart Assist, base plan). No LLM |
| A4 | **Frequent Rx chips**: `frequent-rx-chips.tsx` → `getDoctorFrequentPrescriptions` (`lib/ai/prescription-suggestions.ts:18-139`) | Ranks past prescriptions for a diagnosis | **Deterministic** (SQL plus aggregation) | None | **Bug:** it is documented as "the doctor's own" but `doctorId` is never used in the queries (`:7` vs `:38-64`), so it suggests **other doctors' regimens** across the tenant. The action also accepts any `doctorId` from the client (`actions.ts:79`). It shows the AI sparkle glyph (`frequent-rx-chips.tsx:76`). It defaults missing fields to `"1 tab"`, `"1-0-1"` and `"5 days"` (`:101-103`), which **invents dosing** | Medium-High | **Keep as Smart Assist**, fixing the doctor filter, dropping the invented defaults and removing the AI label |
| A5 | **ICD suggestions**: `suggestIcd10Action` (`actions.ts:103-130`) → `clinical-tools.ts:105-160`; card `icd-code-suggestion-card.tsx` | Up to 4 diagnosis codes | **Deterministic** (DB `ilike` plus a curated list of 12) | None | It returns **ICD-11** codes from `opd_diagnoses.icd11_code` under the label ICD-10 (`:129`). With no match it returns **3 unrelated codes** (`:149`). Its PostgREST `.or()` string interpolation is a filter-injection pattern (`:123`, SEC-20 class). It duplicates `features/terminology/actions.ts:23-60`, which is the better search (about 1,550 conditions with synonyms) | Medium | **Merge into the terminology search** (Smart Assist). This also answers SUB's assumption (`SUBSCRIPTIONS_AND_PLANS.md:83`): it is a lookup, not a model call |
| A6 | **Operations copilot**: drawer in every page header (`components/layout/app-header.tsx:9,154-157`) → `app/api/ai/operations-copilot/route.ts` with 8 tools (`lib/ai/tools/operations-tools.ts`) | Chat to search patients, check slots, stage booking, reschedule or cancel, show the queue, answer product help | **LLM with tool calling** (`streamText`, `maxSteps: 3`) | **Patient full name, phone, age, sex, last visit** (`operations-tools.ts:62-107`), plus anything typed | The client controls the whole `messages` array, including `system` and `tool` roles (`route.ts:35-40`), so prompt and tool-result injection is possible. Tenant and role fall back to `app_metadata` (`:24-33`). There is no route-level permission check, no rate limit, no metering. **Confirm for reschedule and cancel is a no-op** that shows "Slot Released" (F8, `operations-copilot-drawer.tsx:347-390`). The drawer ships in every page's JS (FTA-perf) | **High** | **Remove from v2.0.** Rebuild in v2.1 as `ai.operations_copilot` (§4.5). Product-help search becomes Smart Assist |
| A7 | **Clinical copilot Q&A**: `clinical-copilot-panel.tsx:132` → `app/api/ai/clinical-copilot/route.ts` with 2 tools | Free-form clinical questions plus ICD and catch-up tools | **LLM** | Free-text question (unscrubbed); age, sex, vitals and conditions from the client (`route.ts:50-56`) | Route RBAC exists (`:37-48`), but the same client-controlled history and `app_metadata` fallback apply (`:25-34`). Clinical answers are ungrounded. The disclaimer depends on the model obeying an instruction (`:58-74`) | **High** (clinical / regulatory) | **Remove from v2.0.** Future decision: AI-23 |
| A8 | **Mock provider and VITEST branches**: `client.ts:79-171,218-226`; `soap-generator.ts:302-318` | Returns canned clinical content when the key is missing, is `test-api-key` or starts `mock-` | Fake | None | A missing key in production silently produces **fabricated clinical content** that looks like AI (D15). The AI "evals" run the regex parser under `VITEST`, which gives false confidence (E-6). `tests/ai/evals/shorthand-soap.spec.ts:17` calls `extractStructuredSoap`, which never reaches a model in CI | **High** (silent wrongness) | **Delete.** Tests use an injected fake adapter, and production fails closed (§4.6) |
| A9 | **PII sanitizer**: `lib/ai/sanitizer.ts` (plus a duplicate at `soap-generator.ts:12-33`) | Allow-lists structured context; regexes for phone, Aadhaar and ABHA | Deterministic | n/a | `stripPiiFromText` is used only in tests (SEC-16). The regexes miss names, emails, addresses and dates of birth. There are two copies of the context sanitizer | Medium | **Keep and extend** into the pseudonymiser (§4.2) |
| A10 | **Client/gateway setup**: `lib/ai/client.ts:43-77,174-209` | Two code paths: AI SDK `getAiGatewayModel` and a hand-rolled `fetch` client | n/a | n/a | Defaults to `openai` and `gpt-4o-mini` or Gemini via **AI Studio** (`:52-54,61-66`), which gives no residency guarantee. Reads 3 env-var aliases. Has a `thoughtSignature` skip hack (`:10-41`). The AI SDK chain carries 6 of the 10 audit findings (SEC-24, P1-19) | Medium | **Replace** with one gateway module (§4.1) |

### 1.2 Facts worth preserving

- **Fact.** Several good safety intentions are already written down: zero autonomous prescribing and no invented examination findings (`clinical-copilot/route.ts:70-74`; `soap-generator.ts:56,130-136`), structured context minimisation (`sanitizer.ts:12-40`), Zod validation of the draft (`soap-generator.ts:103-108`), and mutating copilot tools that only stage a preview, with the commit done by the separately guarded `bookAppointment` (`operations-copilot-drawer.tsx:123-148`). v2 turns these intentions into enforced mechanisms.
- **Fact.** The deterministic data assets are worth more than the LLM features:
  - `opd_diagnoses`, about 1,550 conditions with ICD-11, SNOMED CT IDs and synonyms (`scripts/generate-diagnoses.ts:16-22`; `features/terminology/actions.ts:23`);
  - per-doctor custom diagnoses and medicines;
  - the **CDCI drug master** (Common Drug Codes for India, C-DAC/NRCeS, **CC BY 4.0, redistribution and derivatives permitted within India**, SNOMED Affiliate clauses apply: `supabase/seed-data/cdci/License.txt`);
  - WHO growth data (`lib/pediatrics/who-data.ts`);
  - patient dedup scoring (`features/patients/dedup.ts:20-25`);
  - the `follow_ups` table (`supabase/migrations/000007_consultation_prescriptions_cdci.sql:162`);
  - a static product-help manifest (`lib/ai/knowledge/product-manifest.ts`).
- **Fact.** Patient allergies are free-text `TEXT[]` (`000006_appointments_queue_waitlist.sql:7`). They are not coded, so allergy checks need a coding step (§5, SA-07).
- **Fact.** Interaction alerts were deliberately deferred in v1 (`product-manifest.ts:105`).

### 1.3 Problem: deterministic output is labelled as AI today

- The sparkle glyph and "AI" wording appear on deterministic features (`frequent-rx-chips.tsx:76`) and on fallback output (`returning-patient-catchup.tsx:118`; `ai-scribe-modal.tsx:338,394`).
- The clinical disclaimer names the product "CliniQ AI" (`clinical-copilot/route.ts:59`), and the vision document brands the product "CliniQ AI" (`docs/ai-vision.md:7`).
- Once real AI is paid-only, a base-plan clinic would see "AI" branding on features that are not AI. That is the misleading-claims problem described in §5.3.

---

## 2. SEC-16 and SEC-15: what each means and how it is closed

### 2.1 SEC-16 (AI): closure map

| SEC-16 sub-finding (verified) | v2 control | Where |
|---|---|---|
| Patient names and phones sent to the LLM (`operations-tools.ts:62-107`) | Ops copilot removed in v2.0. When it returns (v2.1), tools return opaque handles plus masked display names, and the UI resolves the handles | §4.5, AI-21 |
| Scrubber unused for free text (`sanitizer.ts:45`) | Mandatory `pseudonymise()` step inside the gateway, so no path exists that skips it | §4.2, AI-04 |
| Client-controlled conversation (`operations-copilot/route.ts:35-40`) | The scribe is single-turn with a server-built prompt. Future chat stores turns on the server and accepts only `{text}` from the client | §4.3 |
| `app_metadata` fallback (`route.ts:24-33`) | All AI goes through `requirePermission()` plus `requireEntitlement()`, which fail closed. No fallback | §4.6 |
| No DPA, residency or retention terms (OI-9) | Vertex `asia-south1` regional endpoint under Google Cloud terms (no training, caching disabled, request-response logging off, zero-data-retention request); processor listed in the sub-processor register | §3 |
| No patient-level control | Per-patient `ai_processing_objected` flag checked on every call | §4.6 |
| AI cost (API4 in OWASP mapping) | Per-tenant quota, a rate limit, a GCP budget alert plus a Vertex project quota, and a kill switch | §4.6 |

### 2.2 SEC-15 (messaging dev logger, not AI): remediation restated for the PO

- **Problem.** If `MESSAGING_PROVIDER` is unset or the MSG91 key is missing, the app silently uses a "dev" provider. That provider logs recipient phone numbers and template parameters (patient names, document links with bearer tokens) to `console.log` and to `.planning/dev-messages.txt` (`lib/messaging/index.ts:20-31`, `lib/messaging/dev-logger.ts:59-90`). The unauthenticated `dev` webhook is the P0 part, and it is merged into SEC-04.
- **Recommendation (already in the roadmap):**
  1. In production, fail closed when no real provider is configured (P1-15).
  2. Remove file writes from the app runtime.
  3. Logs keep only the last 4 phone digits and never template parameters.
  4. Remove or env-gate the `dev` and unknown webhook providers (P0-03).
  5. CI grep rule `console-log-pii` (`SECURITY_VERIFICATION_PLAN.md:39`).
  6. **Owner action:** securely delete the local `.planning/dev-messages.txt` and `.planning/dev-auth-logs.txt` once their contents are confirmed.
- **The AI-specific equivalent** (D15 for AI) is AI-01 below: no mock AI in production and no prompt text in logs.

---

## 3. Provider choice (India data residency)

### 3.1 Current facts (checked 2026-11-10)

Google's generative-AI docs now appear under the name **"Gemini Enterprise Agent Platform"** (URLs still under `vertex-ai/…`). This document keeps the name "Vertex AI".

| Option | In-India processing | Retention and training | Notes |
|---|---|---|---|
| **Google Vertex AI, Gemini, regional endpoint `asia-south1`** | **Fact:** Google's data-residency page lists ML processing in `asia-south1` for **Gemini 3.5 Flash, Gemini 3.5 Flash-Lite, Gemini 2.5 Flash (128k context)** and `text-embedding-005`. **Global endpoints "don't provide regional isolation or data residency guarantees."** Delhi (`asia-south2`) is not listed. [1] | **Fact** [2]: no training on customer data without permission. **Caching:** in-memory (deleted within 24 h) **and durable caching (stored at rest) are both on by default**. Turning caching off disables both; alternatively, retention type `EPHEMERAL` keeps only in-memory caching. Changes need `roles/aiplatform.admin`. **Request-response logging** to BigQuery is off by default and must stay off. **Interactions API:** `store` defaults to `true`; zero data retention needs `store = false`. **Grounding with Google Search** keeps logs for up to 3 days and this cannot be disabled, so it must not be used. **Fact** [11]: **abuse-monitoring prompt logging** applies to customers under the Google Cloud Platform Terms of Service; logs are kept up to **90 days**; customers with a **Google Cloud Master Agreement are exempt by default**; otherwise zero data retention is arranged through the account team and "is not guaranteed". Gemini 3.5 Flash-Lite is not designated "Advanced AI" (stricter logging) on that page. The storage region of abuse-monitoring logs is **(unconfirmed)** | The Vercel AI SDK has a Vertex provider. Authentication from Vercel uses a service account or Workload Identity Federation via Vercel OIDC **(unconfirmed for our plan; validate in AI-04)**. Price for 3.5 Flash-Lite is about **$0.30 / $2.50 per 1M input/output tokens** (aggregators, not Google's page **(unconfirmed)**). One aggregator notes a regional premium for 3.5 Flash; whether `asia-south1` carries one for Flash-Lite is **(unconfirmed)**. [3] |
| **Amazon Bedrock, India geographic cross-Region inference (`in.` prefix)** | **Fact:** Since 29 Sep 2026, **Claude Opus 5, Claude Sonnet 5 and Claude Haiku 4.5** are available with India geo inference. Requests route **only between Mumbai (`ap-south-1`) and Hyderabad (`ap-south-2`)**, and logs and billing stay in the source Region. [4] | **Fact:** Bedrock does not store prompts or outputs by default, with the caveat that automated safety classifiers can trigger human review for some models. [4] | **Not in v2.0** (one provider is enough for a one-person team). Kept as the v2.1 second adapter (AI-26). Single-Region in-region inference in Mumbai is **not** offered for Sonnet 5 per its model card; geo inference within India is acceptable. [5] |
| **Azure OpenAI, Central India / South India** | **(unconfirmed)** Microsoft Q&A answers say GPT-4-class deployments exist in Central and South India. Current model availability and Data Zone options for India could not be confirmed from official pages. "Global" deployment types may process anywhere. [6] | Standard Azure terms (no training). Abuse-monitoring storage applies unless an exemption is granted **(unconfirmed for India)** | Not chosen. It means another cloud account, approval gating, and India model availability I could not confirm |
| **OpenAI API direct / Anthropic API direct / Google AI Studio** | Data residency for India is not established for direct APIs (in-country Claude inference is described as Bedrock-only [7]). AI Studio has no regional guarantee | Varies; AI Studio free tier may use data ⚖ (`DATA_HANDLING.md:80`) | **Do not use for PHI** |

### 3.2 Recommendation

- **Provider (v2.0): Vertex AI Gemini on the `asia-south1` regional endpoint only.** Use Gemini 3.5 Flash-Lite for the scribe; if evals require it, use 3.5 Flash. Rationale:
  - in-region processing is guaranteed by the official page;
  - lowest unit cost for a ₹1,499 product;
  - the current prompts are tuned for Gemini;
  - one cloud account, one DPA, one eval run per change.
- **On outage:** no automatic failover in v2.0. The gateway returns "AI unavailable", the doctor's notes are untouched, and they type as usual. The scribe is a convenience, so a short outage is acceptable.
- **Gateway, not lock-in.** One module, `lib/integrations/ai/` (the path in `TARGET_ARCHITECTURE.md:151`), with an `AiProvider` interface (`generateStructured(schema, prompt, opts)`) and one Vertex adapter. Model IDs, region and prompt version live in config, not code. Pin exact model versions, because a new model version is a change that must pass evals (§7).
- **Configuration controls (P1, owner actions, part of AI-17):**
  1. Use a dedicated GCP project for production AI.
  2. **Turn off caching** on that project (this disables both durable and in-memory caching) and record the `GET` cache-config output as evidence.
  3. Keep **request-response logging off**; set **`store = false`** wherever an API supports it (e.g. the Interactions API, if ever used).
  4. Never enable Grounding with Google Search.
  5. **Abuse-monitoring logging:** request zero data retention for the project through Google Cloud sales/the account team. **Assumption (validate):** a new sole-proprietor or small company may not get a Master Agreement or ZDR approval. If refused, pseudonymised prompts may be kept by Google for up to 90 days for abuse review (region unconfirmed). This is accepted as residual risk AIR-9 and disclosed in the clinic AI terms ⚖. Pseudonymisation (§4.2) is what makes it tolerable.
  6. Accept the Google Cloud Data Processing Addendum (click-through, part of standard terms).
  7. Add Google (AI only) to the sub-processor register and the clinic-facing privacy notice template.
  8. Keep a separate non-production GCP project for evals, which receives synthetic data only (§7).
- **Assumption (validate):** Vercel functions run in `bom1` (`INFRASTRUCTURE_ASSESSMENT.md:140`), so PHI does not leave India in transit to the AI provider.
- **⚖ Note.** DPDP s.16 currently allows cross-border transfer except to notified countries. The PO stance (PO-12) is "store only in India". India-region inference keeps the AI path consistent with that stance without relying on the cross-border exception; the only known gap is the abuse-monitoring log location (AIR-9). Pseudonymised data is still personal data under DPDP, so clinic opt-in, the patient notice and the patient objection flag still apply.

---

## 4. Safety architecture (industrial grade, right-sized)

### 4.1 Request path (every LLM call)

```
UI (labelled "AI draft") ─► Server Action / route
   1 requirePermission(feature perm)            fail closed, no app_metadata
   2 requireEntitlement(tenant, "ai.scribe")    SUB has_entitlement (state + plan/trial + override)
                                                + owner opt-in (tenant_ai_settings)
   3 killSwitch check                           platform_settings.ai_features + env AI_ENABLED
   4 buildContext(server-side from visitId)     never trust client clinical context;
                                                refuses if patient.ai_processing_objected
   5 quota.reserve(tenant, feature)             atomic SQL function, reservation with expires_at;
                                                rate limit (P1-26)
   6 pseudonymise(text, knownIdentifiers)       mandatory inside gateway
   7 gateway.generateStructured(schema, …)      Vertex asia-south1 only (v2.0)
   8 validate(schema) + safety post-checks      drop/flag, never "repair" silently
   9 re-check entitlement + kill switch         state may have flipped mid-call: if denied,
                                                discard draft, release reservation
  10 reidentify placeholders (if any) for display
  11 ai_calls row (metadata only) + quota.commit
─► Draft returned with provenance {ai_call_id, model, prompt_version}
   Doctor accepts per section ─► normal save command writes record + audit "ai.draft.accepted"
```

### 4.2 PII minimisation and pseudonymisation

- **Recommendation (P1):** extend `lib/ai/sanitizer.ts` into `pseudonymise(text, ctx)` inside the gateway:
  1. Phone (Indian mobile and landline), Aadhaar, ABHA number and address, email, PIN code, and dates in DOB form become typed placeholders.
  2. **Known identifiers for this encounter**, which the server resolves from the patient ID (patient's name tokens, guardian name, doctor and clinic names), become `[PATIENT]`, `[DOCTOR]` and similar. Matching is case-insensitive, whole-word, and includes common transliteration variants.
  3. If text contains a run of 10 or more digits after replacement, block the request (fail closed) and tell the user to remove identifiers.
- Structured context is allow-listed and built on the server from `visit_id`: age in years (months under 2 years), sex, current vitals, and coded chronic conditions. **Never** name, phone, address, IDs, dates of birth or free-text history.
- The gateway owns this step, so no AI call can skip it. A unit test asserts that the adapter receives only the pseudonymised body (MSW or a fake adapter capturing the payload).
- **Assumption (validate):** a regex plus known-identifier approach catches the realistic leak paths in OPD shorthand (doctors rarely write third-party names). Residual leakage is measured by the eval suite's PII cases (§7).

### 4.3 Server-owned conversation state and structured outputs

- The **scribe is single-turn.** The server assembles the system prompt, a delimited user block and the context. The client sends only `{visitId, shorthand}`.
- Every output uses **provider-native structured output** (JSON schema / response schema), validated with Zod. On a validation failure the user sees "Could not draft, your notes are unchanged". There is no partial "repair" and **no silent fallback to another engine presented as AI** (this removes `soap-generator.ts:110-127`).
- **Schema changes from v1:**
  - Drop `diagnosis_hypothesis` inference. Replace it with `diagnosis_as_written` (extract only if the doctor wrote it).
  - Each item is `{text, source_span}`. **`text`** is the expanded, readable wording ("Fever for 3 days"). **`source_span`** is the **verbatim input substring** the item was derived from ("c/o fvr x3d"), returned as-is by the model.
  - **Post-check:** after case and whitespace normalisation of both, `source_span` must be a substring of the (pseudonymised) input. If it is not, the item is dropped and counted as a fabrication. Expansions therefore survive; invented items do not.
- **Future chat features** (v2.1 ops copilot): a `ai_conversations` / `ai_turns` server store with a short TTL. The client sends `{conversationId, text}` only. System, assistant and tool turns are rebuilt on the server.

### 4.4 Human in the loop and clinical safety

- **Rule H1:** AI output is never written to the clinical record without an explicit clinician action. Acceptance is per section (complaints, examination, advice) or "accept all", always through the normal consultation save command. The record stores provenance (`ai_call_id`, accepted as-is vs edited) and an audit event.
- **Rule H2:** AI drafts are visually distinct ("AI draft — review before saving") and use an AI colour token and glyph **to be added to `DESIGN_SYSTEM.md` by AI-02** (one colour, one glyph). The glyph is reserved for LLM output.
- **Rule H3:** post-checks enforce the stated guardrails mechanically, not by prompt:
  - **Drug mentions in `advice`** (detected with the regexes at `soap-generator.ts:228-230` plus a CDCI generic-name match): if the mention's `source_span` is **not** in the input, it is dropped and counted as a fabrication. If the doctor wrote it ("adv tab PCM SOS fever"), it is **kept and flagged "move to Rx"** in the UI, never silently removed;
  - `examination` is empty unless the input contains an exam marker or the item's `source_span` maps into the input (the v1 "Negative Syllogism" intent);
  - any output item whose `source_span` is not found in the input is dropped and counted (§4.3).
- **Rule H4:** the scribe is not available after a consultation is signed. Amendments follow the V2-09a amendment flow.
- **Disclaimer:** a static UI string (not model-generated): "AI drafts can be wrong. You are responsible for the clinical record." It also appears in the clinic's AI opt-in terms.
- **CDSCO / medical-device software ⚖:**
  - **Fact (secondary sources only):** CDSCO issued a draft Medical Device Software guidance on 21 Oct 2025, and law-firm and news write-ups report the final guidance `CDSCO/MD/GD/MDSW/01/2026` as issued on 21 Jul 2026 [8][13][14] **(unconfirmed: the official CDSCO document was not opened)**. Software is classified by intended use; clinical decision support, treatment recommendation and triage, and software that quantifies parameters to inform clinical decisions, are likely medical devices under MDR 2017.
  - **Recommendation:** in v2.0, state the intended use of every assistive feature as "**documentation and reference aid; does not diagnose, treat or recommend therapy**".
  - Keep LLM features to documentation (the scribe).
  - Allergy and duplicate-therapy checks compare doctor-entered prescriptions with the patient's recorded allergies; they are advisory with a confirm step.
  - **Risk (high impact, unconfirmed): the weight-based dose calculator (SA-05) is likely in scope as medical device software,** whatever the wording. Dose calculation for an individual patient is a standard example of qualifying software under the EU guidance MDCG 2019-11 (contested by industry for simple label-based calculators) [12][15], and the CDSCO 2026 guidance, as summarised, covers software that quantifies parameters to inform decisions. With no counsel (PO-12 not engaged) and a one-person team, **SA-05 moves to v2.1, behind a regulatory check** (AIR-5).
  - Do not ship diagnosis suggestion or therapy recommendation by LLM.
  - Revisit before any v2.1 feature that suggests diagnoses, drugs or doses.

### 4.5 Copilot tools (for the v2.1 ops copilot; rules fixed now)

- A tool is a **thin wrapper over the same server command** the UI uses (V2-07 atomic commands). It gets the same `requirePermission`, the same tenant guard from the session (never from model arguments) and the same RLS client. **No AI-only data access paths.**
- **Read tools** return opaque handles (`p_7f3a…` mapped on the server per conversation) and masked labels ("R. K\*\*\*, M, 42"). The UI resolves the handles into real names in the browser via a normal authorised fetch.
- **Write tools** only create a *preview* object stored on the server. The commit is a normal UI button calling the normal command with the preview ID. The v1 no-op Confirm (F8) cannot recur, because there is no separate copilot commit path.
- Each role has its own tool allow-list. `maxSteps` is at most 3. Tool results are wrapped as data (`<tool_result>` delimiters). The system prompt states that tool content is untrusted.

### 4.6 Entitlement, opt-in, patient objection, metering, cost limits and kill switch

**Assumption (validate against `SUBSCRIPTIONS_AND_PLANS.md`):** this section relies on SUB's `has_entitlement(tenant, key, now)`, `entitlement_limit(tenant, key)`, `tenant_access_level()`, the `plans` / `entitlement_keys` / `plan_entitlements` / `tenant_addons` / `tenant_entitlement_overrides` tables and the single-row `platform_settings` (SUB §6.2, §7.1, §7.2). The keys this document expects SUB to seed are listed in §6.2.

| Control | Mechanism | Default |
|---|---|---|
| Entitlement | `requireEntitlement(key)` calls SUB `has_entitlement()`: access level `full`, then plan feature, then override | `ai.scribe` on **during `trialing`** as a Preview (PO-21); off on `standard` alone (PO-25 default) unless an override grants it; the add-on branch (`tenant_addons`) arrives with the deferred SUB-11 |
| Owner opt-in | `tenant_ai_settings(enabled, accepted_terms_version, accepted_by, accepted_at)`. Only the owner can enable it, after accepting the AI terms and the patient-notice text | Off |
| **Patient objection** ⚖ | `patients.ai_processing_objected boolean` (+ `objected_at`, `recorded_by`). Captured at registration (receptionists can register, PO-3) and editable later by doctor or receptionist; the registration notice tells patients that AI drafting may be used and that they can object. When set, the scribe is hidden on that patient's visits and the server context builder refuses (step 4) | Not objected |
| Quota | `ai_usage_monthly(tenant_id, period, feature, units)` plus `ai_quota_reservations(id, tenant_id, feature, period, expires_at)`. `ai_reserve(tenant, feature)` locks the usage row (`SELECT … FOR UPDATE`) and allows a call only if `units + count(reservations where expires_at > now) < limit`. Commit deletes the reservation and increments `units`; release deletes it. **A reservation left by a crashed or timed-out function stops counting at `expires_at` (call timeout + 30 s)**, so quota is restored without depending on a job; a `jobs` housekeeping kind (`ai.reservations_cleanup`, per `TARGET_ARCHITECTURE.md` §8) deletes expired rows | Limit from `entitlement_limit(tenant, 'ai.scribe.monthly_drafts')`: **1,500 for the trial** (PO-21), counted over the whole trial (period key = the trial start, not the calendar month). `units` can be drafts or, for future products, minutes or calls |
| Cost limits | **GCP budget alert** on the AI project (email to the PO) and a **Vertex project quota** (requests and tokens per minute) as the hard platform ceiling. No separate in-app daily spend cap in v2.0 | Budget set at go-live from the D-1 estimate |
| Rate limit | Postgres limiter (P1-26): per user 10/min, per tenant 60/min | As stated |
| Kill switch | env `AI_ENABLED` (deploy-level) plus a `platform_settings.ai_features jsonb` column (one flag per feature key; SQL now, admin portal later) | Enabled per key |
| **Write protection of gating tables** | `platform_settings`, `plans`, `plan_prices`, `entitlement_keys`, `plan_entitlements`, `tenant_addons`, `tenant_entitlement_overrides`, `ai_usage_monthly` and `ai_quota_reservations` have **no INSERT/UPDATE/DELETE grants for tenant roles** (`authenticated`, `anon`). Writes happen only through SECURITY DEFINER functions (`ai_reserve`, `ai_commit`, `ai_release`, SUB platform RPCs) or the service role. `tenant_ai_settings` is updatable only by the owner role under RLS. `patients.ai_processing_objected` follows the patient-update permission | Enforced by pgTAP rows in the P1-01 matrix |
| Failure mode | (a) An env schema makes **`next build` fail in production** when `AI_ENABLED=true` and the Vertex config (project, region `asia-south1`, model ID, credentials) is incomplete. (b) At runtime, any failed check returns "AI unavailable" with a reason, **never mock output**. (c) `/api/ready` reports AI provider status (consistent with P1-15) | Fail closed |

**AI access across the subscription lifecycle** (SUB §6.1 states; access is decided by timestamps at query time, so step 9 catches a mid-call flip):

| Subscription state | AI access | Quota |
|---|---|---|
| `incomplete` | Denied (onboarding only) | — |
| `trialing` | **Allowed as a "Preview"** (PO-21), owner opt-in still required | **1,500 drafts for the whole trial** (PO-21) |
| `active` on `standard` | **Denied** (PO-25 default); no upsell; AI shows "Coming soon" on plan and billing pages only | — |
| `active` on `standard` with PO-25's alternative chosen | Allowed as a "Preview" | The `standard` limit set by SQL |
| *Deferred with SUB-11 (not in v2.0):* `active` + live add-on; add-on `cancel_at_period_end`; base locked while the add-on is live; `past_due` with a live add-on | As in revision 2 (add-on access bounded by base access `full`) | Add-on quota |
| `comped` / override (incl. UAT testers per SUB-D10, until `free_until`) | Per override (`expires_at`), owner opt-in still required | Override limit (UAT default: **1,500 drafts per IST calendar month** until `free_until`, the `ai.scribe.monthly_drafts` period; the 14-day trial itself stays 1,500 for the whole trial, PO-21). Cost ceiling (Assumption, §5): about ₹225 per tester clinic per month, about ₹2,250/month for 10 clinics, capped by the Vertex quota and GCP budget alert |
| `expired` (1-month lock; logins redirect to billing) | Denied | — |
| `archived` | Denied | — |
| `purged` | Denied (tenant AI data deleted; §4.7) | — |

- Each row is an L2 test case.
- **Note — Decided (round 3, roadmap C48; previously "Deviation (PO to accept)"):** owner opt-in kept for preview use. Owner opt-in remains required during the trial and during UAT. It is a consent step (terms and notice), not a restriction on features. **Round 2:** the "silent" default the PO asked for means no meter, price or upsell; it does **not** remove the opt-in, because preview prompts are still processed by Google (pseudonymised) and the AI terms must be accepted first. The opt-in screen says the feature is a preview, free during the trial, and not yet a paid product.

### 4.7 Logging, observability and retention (metadata, never PHI)

- **`ai_calls` table:** `id, tenant_id, user_id, feature, provider, model, region, prompt_version, input_tokens, output_tokens, latency_ms, status, error_class, pii_blocked bool, fabrication_drops int, cost_estimate_paise, accepted enum(none|partial|all|edited), created_at`. **No prompt or output text.**
- **Retention:**
  - `ai_calls` detail rows: **90 days**, then rolled into `ai_usage_monthly` and deleted.
  - `ai_usage_monthly`: while the tenant is live, at most 13 months.
  - **Tenant lifecycle:** all `ai_calls`, `ai_usage_monthly` and `ai_quota_reservations` rows for a tenant are **deleted at archive** (SUB §6.4 step 2 deletes "AI logs" as derived data), and in any case **no later than the purge at expiry + 180 days** (SUB T11/T12). This keeps AI metadata inside the PO's 180-day ceiling.
  - **Platform aggregates** (`ai_usage_platform_monthly(period, feature, model, calls, tokens, cost_paise)`) are kept for cost analysis **without tenant or user identifiers**.
  - `DATA_HANDLING.md` §5 needs an "AI metadata" retention row with these values (§11.2).
- Prompts and outputs are **not stored** (`DATA_HANDLING.md:108`). The draft lives only in the browser until accepted. Once accepted, the text is part of the clinical record with provenance.
- Sentry and Vercel logs: AI errors log the `ai_call_id` and error class only (no request bodies), as `INFRASTRUCTURE_ASSESSMENT.md:233` requires.
- Weekly ops view: calls, acceptance rate, edit rate, fabrication drops, PII blocks, p95 latency and cost by tenant. This is a SQL view for now and goes to the admin portal later.

### 4.8 Prompt-injection defences (summary)

The defences are layered:
1. No client-supplied roles.
2. User text inside clear delimiters, with the instruction that it is data.
3. Structured output only.
4. No tools for the scribe.
5. The `source_span` grounding check.
6. Human acceptance.
7. RBAC-bound server commands for any future tools.
8. Output length caps.
9. Adversarial eval cases (§7).

Residual risk: a malicious staff member can make their own draft wrong, which is equivalent to typing it themselves.

---

## 5. "Smart Assist": the deterministic base-plan catalogue

### 5.1 Does clinicOS need Python? No (D-8).

- **Fact.** Each candidate feature reduces to text normalisation, fuzzy matching, ranking by counts or recency, arithmetic, or rule-table lookups. Postgres (`pg_trgm`, full-text search, `unaccent`) and TypeScript cover all of them, inside the Next.js and Supabase stack already tested and deployed.
- **Problem with adding Python:** a second runtime, deploy target, dependency chain, CI lane and security surface, for a team of one person plus Claude.
- **Recommendation:** **no Python service in v2.** The PO mentioned "python and stuff"; the intent (code-driven features that feel smart) is met in TypeScript/SQL. This deviation is recorded as D-8. Revisit only for model training or self-hosted speech recognition, and neither is planned.
- **"Feels like AI" is achieved through UX:** instant suggestions as the doctor types, learning from the doctor's own history, and one-tap insertion.

### 5.2 Catalogue (feature keys `assist.*`, all in the base plan)

v2.0 commits to the P1 items. Items marked **"if time permits"** ship only if the P1 scope is done; otherwise they move to v2.1.

| ID | Feature | How it works (in-stack) | Data and licensing | Placement | Size | Priority |
|---|---|---|---|---|---|---|
| SA-01 | **Diagnosis search with synonyms and abbreviations** (`assist.terminology`, replaces SUB's `assist.icd10_lookup`) | One terminology search replacing A5. `pg_trgm` plus `tsvector` on `opd_diagnoses.name/synonyms`, an Indian-OPD abbreviation table (URTI, AGE, T2DM, HTN, k/c/o …), the doctor's custom diagnoses ranked first by `use_count`. Shows ICD-11 codes labelled correctly. Parameterised RPC (removes the `.or()` interpolation) | ICD-11: WHO licence (CC BY-ND 3.0 IGO) **(unconfirmed, verify attribution terms in AI-17)**. SNOMED CT IDs: India is a SNOMED member via NRCeS, so use in India is free **(unconfirmed, verify with NRCeS in AI-17)** | V2-09b | M | P1 |
| SA-02 | **My favourites and my prescribing history** (`assist.frequent_rx`, SUB's key) | Fix A4: filter on `prescriptions.doctor_id = session.userId` (or `visits.doctor_id`). Rank by frequency × recency decay for the diagnosis. Return only stored values with no invented defaults. One-tap insert into the Rx builder. Plus doctor-saved protocols (existing `protocolTemplateSchema`) | Own data | V2-09c | S | P1 |
| SA-03 | **Shorthand expansion and dot-phrases** (`assist.shorthand`) | A rewritten deterministic parser (derived from `parseShorthandLocally`, but it **never adds text not present in the input**). It expands c/o, k/c/o, o/e, adv, f/u, sos, stat, BD/TDS into the structured complaints, exam and advice fields. Doctor-defined macros (".urti" expands to their own template). Live preview, insert on accept | Own data | V2-09b | M | P1 |
| SA-04 | **Patient snapshot** (`assist.snapshot`, replaces A3 and SUB's `ai.catchup_summary`) | SQL over the last N **completed** visits: last seen, last diagnoses, last Rx, chronic conditions, allergies, overdue follow-ups, abnormal last vitals. Rendered as a template, with no LLM | Own data | V2-09b | S | P1 |
| SA-05 | **Weight-based dose calculator (paediatrics)** (`assist.dose_calc`) | The doctor stores mg/kg/dose, frequency and maximum dose per medicine. The calculator takes the latest weight, computes the dose, rounds to the formulation strength, caps at the maximum, and shows the working | Doctor-authored parameters only. **Likely medical device software (§4.4) ⚖** | **v2.1, behind a regulatory check** | M | P2 (v2.1) |
| SA-06 | **Duplicate-therapy check** (`assist.dup_therapy`) | Warn when two Rx lines map to the same CDCI generic or substance | CDCI generic and substance mapping (CC BY 4.0, India), so attribution is required on the About page | V2-09c | S | P2, if time permits |
| SA-07 | **Allergy check** (`assist.allergy_check`) | Patient allergies become **coded** to CDCI substances or generics at entry (typeahead, with free text kept). On Rx add, check whether the generic contains an allergic substance and show a blocking-confirm warning. **v2.0 = substance-level matching only.** Class-level allergies (e.g. "penicillins") need a curated class table of about 50 rows and ship only once D-9 is resolved | CDCI substance master; class table authored by Claude, sign-off per D-9 | V2-09c | M | P2 |
| SA-08 | **Drug–drug interaction alerts** | **Not in v2.0.** Needs a licensed, maintained interaction knowledge base (commercial DDI databases are licensed; open sets such as DrugBank's are typically non-commercial **(unconfirmed)**). Shipping a home-made DDI table is a clinical-safety liability | Licence decision | v2.1+ (D-6) | L | P3 |
| SA-09 | **Smart slot suggestions** (`assist.slots`) | Pure function over doctor shifts, blocks, bookings, the queue's average consult duration and the patient's past preferred time of day. Returns the top 3 slots plus "next free". Also used by the follow-up flow | Own data | V2-08 | M | P1 |
| SA-10 | **Duplicate patient detection** (`assist.duplicates`) | Extend `features/patients/dedup.ts`: exact phone, `pg_trgm` name similarity ≥ 0.6, a transliteration and short-form table (Mohd/Mohammed, Kumar/Kr.), DOB or age ±2 years, guardian phone for children. Shown on registration, which receptionists can now perform (PO-3) | Own data | V2-08 | S-M | P1 |
| SA-11 | **Follow-up booking** (`assist.followup`) | Parse "f/u 1 wk", "review after 3 days" and "repeat HbA1c 3 months" from advice. On doctor accept, it **proposes an appointment** (booking form prefilled with SA-09's slot) that the doctor or receptionist confirms. **Only booked appointments get reminders** (PO-8: appointments only). A bare `follow_ups` row, if one is kept for tracking, sends no message in v2.0 | Own data | V2-09b | S | P2 |
| SA-12 | **Help and command search** (`assist.help`) | Fuzzy search over `product-manifest.ts` plus the command palette actions, replacing the copilot's `get_product_help` | Own content | V2-06 | S | P2, if time permits |
| SA-13 | **Vitals flags** (`assist.vitals`) | Age-banded normal ranges, BMI, WHO growth percentiles (existing `lib/pediatrics/who-data.ts`). Highlights only | WHO growth standards licence **(unconfirmed; verify terms)** | V2-09b | S | P2, if time permits |
| SA-14 | **Vaccine schedule engine** (`assist.vaccines`) | **v2.1** (PO-8): a rule table for the national schedule (UIP) and an optional clinic-chosen schedule, producing due and overdue doses and reminders | Schedule content: UIP is public. The IAP schedule is copyright IAP **(unconfirmed, needs a licence check)**. Clinics can author their own | v2.1 | M | P2 (v2.1) |

### 5.3 Honest labelling and naming

- **Recommendation (P1):**
  - Deterministic features carry the label **"Smart Assist"** with a neutral glyph (e.g. a lightning icon from lucide, chosen in the design system), or no label at all where the help is self-evident.
  - LLM features carry **"AI Assist"** and the reserved AI glyph and token.
  - **Round 2 (PO-21):** in v2.0 the scribe also carries a **"Preview"** chip with the note "AI features are in preview and not yet offered as a paid product", and plan, billing and marketing pages show AI only as **"Coming soon"**, never with a price or as included in Standard. The CI copy grep also fails on "AI" next to a price or a "Buy"/"Upgrade" action.
  - Marketing, plan pages and invoices follow the same split. Copy is reviewed against a grep rule: the word "AI" must not appear in base-plan feature copy.
- **⚖ Rationale:**
  - The Consumer Protection Act 2019 prohibits misleading advertisements, and the CCPA's 2022 guidelines on misleading advertisements apply to claims about product capabilities **(unconfirmed for "AI-washing" specifically; there is no AI-specific Indian rule I could confirm)**.
  - Separately, a clinic paying for "AI" must receive LLM features, and one not paying must not be told it has them.
  - "Smart" is a defensible description of deterministic suggestions.
- **This deviates from the PO's wording** ("feels like AI"): the features should *feel* smart, but they are not *called* AI. Recorded as D-8.
- **Open question (D-3):** the product and company branding ("CliniQ AI", `docs/ai-vision.md:7`) sits awkwardly with a base plan that contains no AI. Recommendation: keep the company name, but avoid "AI" in the product name shown inside the app and on the base plan's marketing.

---

## 6. AI Assist (paid) feature set

> Update (2026-11-10, PO round 2): **nothing in this section is sold in v2.0** (PO-21, C41). `ai.scribe` ships as a trial Preview; the other keys stay disabled. A new future product, the **AI Voice Receptionist**, is added below so the catalogue and key list already account for it; its pricing model (likely per minute or per call) is decided at its launch.

### 6.1 Features

| Key | Feature | v2.0? | Notes |
|---|---|---|---|
| `ai.scribe` | Shorthand/typed notes become a structured SOAP draft, accepted per section, pseudonymised, in-India model | **Yes, as a trial Preview only (not sold; PO-21)** | The only LLM feature at go-live |
| `ai.voice_receptionist` | Answers and places clinic phone calls (booking, rescheduling, FAQs) by voice | **No** (separate release after v2.0; not scheduled here) | The PO's next AI product; it triggers making AI products purchasable. Needs its own provider, residency, consent and call-recording review, and a metered price (`ai.voice_receptionist.monthly_minutes`) |
| `ai.scribe.voice` | Server speech-to-text in India, feeding the scribe | No (v2.1, AI-24) | Needs an in-region speech service plus audio retention terms. Vertex speech models in `asia-south1` are **(unconfirmed)** |
| `ai.patient_advice` | Rewrites the doctor's advice into simple English or Hindi (and other regional languages later) for the Rx PDF and WhatsApp, with doctor review | Candidate v2.1 (AI-22), or v2.0 if the PO wants a second paid feature (D-4) | Low PHI (advice text only), high patient value in tier 2/3 India |
| `ai.operations_copilot` | Natural-language front-desk assistant | No (v2.1, AI-21) | Rebuilt per §4.5 |
| `ai.clinical_copilot` | Clinical Q&A | **No, indefinitely** (AI-23) | Only with grounded, cited sources plus a regulatory review |

### 6.2 Final feature-key list (for SUB to seed)

| Key | Kind | `standard` | future `ai_assist` (not purchasable in v2.0) | During `trialing` |
|---|---|---|---|---|
| `assist.terminology`, `assist.frequent_rx`, `assist.shorthand`, `assist.snapshot`, `assist.slots`, `assist.duplicates`, `assist.followup`, `assist.allergy_check` | boolean | ✓ | — (from base) | ✓ |
| `assist.dup_therapy`, `assist.help`, `assist.vitals` (if time permits) | boolean | ✓ | — (from base) | ✓ |
| `ai.scribe` | boolean | ✗ | ✓ | ✓ |
| `ai.scribe.monthly_drafts` | limit (per clinic, pooled) | 0 (PO-25 default) | Set at launch | **1,500 for the whole trial** (PO-21), shown as "Preview" |
| `ai.operations_copilot`, `ai.clinical_copilot`, `ai.patient_advice`, `ai.scribe.voice` | boolean | ✗ | ✗ in v2.0 | ✗ |
| `ai.voice_receptionist` (boolean), `ai.voice_receptionist.monthly_minutes` (limit) | boolean / limit | ✗ | (its own future product, `ai_voice_receptionist`) | ✗ |

- **Retired from SUB §7.3:** `assist.icd10_lookup` (→ `assist.terminology`), `ai.catchup_summary` (→ `assist.snapshot`, no LLM), `ai.monthly_token_quota` (→ `ai.scribe.monthly_drafts`; drafts are the unit clinics understand).
- **Assist keys in the base plan** exist so that the admin portal can list them and an override can switch one off for a clinic if a defect is found. They are never sold separately.

### 6.3 Pricing approach (PO decision D-1)

> Update (2026-11-10, PO round 2): **D-1 is decided as "no AI sold in v2.0"** (PO-21). The analysis below is kept as input for the later launch. Pricing must stay configurable: the SUB catalogue stores prices with a `billing_model` (`flat_recurring`, `per_unit_recurring`, `metered`, `included_plus_overage`, `prepaid_pack`), units (drafts, minutes, calls), included units and overage rates, all versioned and set by SQL or the Plans & prices screen (SUB §7.1, §8.1). A per-minute voice product cannot be billed as a fixed Razorpay subscription amount, so its payment mechanism is designed at its launch (**Open question**, out of v2.0 scope).

**Unit (used everywhere in this document):** **per clinic per month, with a pooled monthly draft quota for the whole clinic.** A flat per-clinic amount fits one Razorpay plan amount and the ₹1,499 per-clinic base plan.

| Option | Description | Pros | Cons |
|---|---|---|---|
| A. AI tier as a combined plan (`ai_pro`) | "Standard + AI Assist" as one plan | One debit | **Rejected (C33):** UPI/eMandate subscriptions cannot be updated (SUB [S25]), so every upgrade or downgrade would need a full re-mandate of the base plan |
| **B. Add-on as a second subscription (`ai_assist`, adopted, SUB-D8 (a))** | A separate Razorpay subscription with its own mandate, stored in `tenant_addons` | Start or cancel AI Assist without touching the base subscription; same code path as the base | A second mandate authorisation and a second monthly debit; its period anchors on its own purchase date (SUB §7.4). Razorpay's one-time add-on API is not used: it fails on UPI subscriptions (SUB [S26]) |
| C. Usage credits | Prepaid draft packs | Exact cost recovery | Friction; small clinics dislike metering; a second payment flow |

- **Unit-cost sketch (Assumption, re-estimate from L3 token counts before go-live):** a scribe call is about 1.5k input and 0.5k output tokens. At about $0.30 / $2.50 per 1M (3.5 Flash-Lite, unconfirmed) and ₹88 per USD, that is roughly **₹0.15 per draft**. A pooled quota of **1,500 drafts per clinic per month** (about 2 busy doctors) costs about **₹225 a month** at list price, before any `asia-south1` regional premium **(unconfirmed)**. If evals force 3.5 Flash, multiply by its price ratio (aggregator figures only; recompute from Google's price page in AI-17). An AI price around **₹499 per clinic per month** (₹1,998 + GST = ₹2,357.64) leaves margin after gateway fees.
- **Recommendation for the later AI launch** (not v2.0): Option B (the add-on, C33). Set an initial price and quota by SQL (the PO's interim approach), estimated from L3 eval token counts before go-live, and re-price after the first 2 weeks of production `ai_calls` data.
- **Trial (D-2), decided in round 2:** AI is included in the trial as a **Preview with 1,500 drafts** for the whole trial (PO-21). The owner must still opt in (§4.6). *Superseded text:* "the same quota as the paid `ai_assist` add-on".
- **Trial cost check (Assumption):** at about ₹0.15 per draft, a clinic that uses the full 1,500 drafts costs about ₹225 of Vertex usage; 5 pilot clinics cost at most about ₹1,125 per trial cycle, inside the GCP budget alert.

---

## 7. Evaluation harness (replaces the regex-under-VITEST false confidence)

- **Problem.** `extractStructuredSoap` silently runs the regex parser whenever `VITEST` is set (`soap-generator.ts:302-318`). The "evals" therefore never test a model (E-6). The mock provider returns canned clinical content whenever a key is missing (`client.ts:218-226`).
- **Recommendation (P1):** use three lanes and **no environment-variable branches in production code**.

| Lane | Runs | What | Pass bar |
|---|---|---|---|
| **L1 Unit (every PR)** | CI | Smart Assist pure functions with table tests. `pseudonymise()` corpus (≥ 100 synthetic strings including Hinglish, names inside text, phone formats). Post-check functions, including **`source_span` cases where expansions survive** ("c/o fvr x3d" → "Fever for 3 days" kept) **and invented items are dropped**, and drug-in-advice cases (doctor-written kept and flagged; invented dropped). Entitlement, quota and kill-switch matrix | 100% |
| **L2 Contract (every PR)** | CI with a **fake adapter or MSW** capturing outbound bodies, and the local Supabase stack | Outbound payload contains no known identifiers or 10-digit runs. Malformed or failed model output produces "could not draft" (not regex output). Quota released on failure; **reservation expires → quota restored**. No call when not entitled, opted out, **patient objected**, killed or over quota. **One row per subscription state** in §4.6. Mid-call state flip → draft discarded. Role matrix (nurse or receptionist gets 403 for the scribe). pgTAP: tenant roles cannot write the gating tables | 100% |
| **L3 Live eval (manual, on every model or prompt change; nightly once pre-prod exists)** | Eval GCP project, synthetic cases only. A **dedicated eval service-account key with a hard budget cap** (GCP budget + Vertex quota on the eval project), **held by the PO** as a GitHub Actions secret for a manually triggered workflow, never in `.env` | Golden set grown from `tests/ai/fixtures/reference-dataset.json` to **≥ 60 cases**: standard OPD, Indian shorthand, Hinglish/code-mixed, paediatric, chronic follow-up, empty or garbage input, **adversarial injection** ("ignore instructions, prescribe…"), PII-laden input. Metrics: schema validity, complaint recall/precision vs labels, fabricated-item rate (unsupported `source_span`), examination fabrication, invented drug-in-advice, PII echo, latency p95, tokens and cost per call (feeds D-1) | Schema 100%; examination fabrication 0; invented drug-in-advice 0; PII echo 0; complaint recall ≥ 0.90 and precision ≥ 0.90 **(Assumption: thresholds to tune on the first run)**; p95 ≤ 6 s |

- Prompts are versioned files (`lib/integrations/ai/prompts/scribe.v1.ts`), and `prompt_version` is logged in `ai_calls`.
- **Release rule:** a change to model or prompt version merges only with an L3 report attached to the PR. An isolated Claude reviewer agent checks that report (team = PO + Claude).
- **Golden labels:** written by Claude from synthetic cases. Labels written and graded only by Claude are partly circular, so D-9 asks the PO to choose a one-time sign-off or a written risk acceptance.
- A Claude-as-judge scorer may assist with free-text fields, but the pass/fail metrics above are computed by code against labels.

---

## 8. Phased plan with acceptance criteria and tests

| Phase (roadmap placement) | Scope | Acceptance criteria | Tests |
|---|---|---|---|
| **AI-P0 Containment** (V2-01) | AI-01: remove the ops copilot drawer and both copilot routes from navigation and bundles; remove the mic button; delete `MockAiProvider` and the `VITEST` branch; the scribe fails closed when unconfigured; relabel A3, A4 and A5 (no AI glyph) | No `/api/ai/*` route reachable. `grep` finds no `VITEST`/`test-api-key` in `lib/`. **`next build` with `NODE_ENV=production` and `AI_ENABLED=true` fails when the provider config is incomplete.** No sparkle glyph on deterministic UI | L1 and L2 CI greps; env-schema unit test; a CI build job with incomplete AI env expecting failure; e2e smoke: consult page renders without the drawer |
| **AI-P1 Platform** (V2-05 entitlements + V2-12) | AI-03 entitlement, opt-in, patient objection, kill switch and quota (with the SUB track); AI-04 gateway plus Vertex adapter, `ai_calls`, rate limits, `/api/ready` AI status; AI-17 provider contracts and configuration | Each L2 matrix cell enforced. The `ai_calls` row has no text columns. Vertex calls go to an `asia-south1` regional host only (assert the hostname in the adapter test). Runtime check returns "AI unavailable", never mock output. Tenant roles cannot write gating tables | L2 contract suite; DB tests for `ai_reserve` concurrency (two parallel reserves at quota minus 1, so exactly one succeeds) and reservation expiry; pgTAP grants; config evidence: cache-config `GET` output showing caching off, request-response logging off, budget alert and quota set, ZDR request outcome |
| **AI-P2 Scribe v2** (V2-12, plan 12-06, on the V2-09b save model; C37) | AI-05: server-built context from `visitId`, `pseudonymise`, structured output with `{text, source_span}`, post-checks, per-section accept with provenance and audit, new UI states | Draft never saved without a click. Accepted text carries `ai_call_id` provenance. The **6 failure states** (not entitled, opted out, patient objected, over quota, provider down, **offline**, consistent with `PWA_STRATEGY.md`) each show a specific message and keep the doctor's notes unchanged. L3 thresholds met | L1, L2, L3 report; e2e: doctor drafts, edits examination, accepts, saves, then the audit row and provenance are present; nurse cannot see the scribe; offline shows the offline state |
| **AI-P3 Smart Assist** (V2-06, V2-08, V2-09b, V2-09c) | P1 items first (SA-01, 02, 03, 04, 09, 10), then SA-07 and SA-11, then "if time permits" items (SA-06, 12, 13) | Each feature works with AI fully disabled. SA-02 never returns another doctor's Rx. SA-03 output contains only input-derived text. SA-11 sends no message unless an appointment is booked | Table-driven unit tests per feature; RLS and DB tests for SA-02 and SA-10; e2e for the registration-dedup (as receptionist) and Rx-builder flows |
| **AI-P4 Eval and ops** (V2-02 lane + V2-15) | AI-06 harness, ops SQL view, runbook (kill switch, provider outage behaviour, key rotation, budget alert response) | L3 report attached at G5. Kill-switch drill done in staging. Outage drill: Vertex blocked, so the scribe shows "unavailable" and notes are untouched | Drill records in `VERIFICATION_LOG.md` |
| **v2.1** | AI-21 ops copilot, AI-22 advice translation, AI-24 voice, AI-26 Bedrock adapter, SA-05 dose calculator (after regulatory check), SA-14 vaccines, SA-08 decision | Separate G-gate per feature | As per §4.5 rules |

---

## 9. Risks

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| AIR-1 | Model output wrong but accepted by a hurried doctor | M | H | Per-section accept, `source_span` highlighting, fabrication drop, edit-rate monitoring |
| AIR-2 | Regional model retired, not offered in `asia-south1` for newer versions, or a Vertex outage | M | M | Version pinning, the `AiProvider` interface, L3 eval before swap; outage degrades to manual notes; second adapter (Bedrock India) in v2.1 (AI-26) |
| AIR-3 | PII leaks through names the pseudonymiser does not know | M | M | Known-identifier replacement, PII-echo eval metric, no third-party names expected in OPD shorthand |
| AIR-4 | Cost overrun from abuse or loops | L | M | Per-tenant quotas, rate limits, Vertex project quota, GCP budget alert, kill switch, single-turn scribe |
| AIR-5 | Regulatory classification (CDSCO MDSW 2026) of assistive features ⚖ | M | H | Documentation-only LLM scope; intended-use statements; **dose calculator (SA-05) deferred to v2.1 behind a regulatory check**; allergy/duplicate checks advisory |
| AIR-6 | Misleading AI claims ⚖ | M | M | Label rules (§5.3), copy grep rule |
| AIR-7 | Smart Assist clinical tables (allergy classes) are wrong | M | H | v2.0 ships substance-level matching only unless D-9 is resolved; warnings are advisory with a confirm step; no DDI until licensed |
| AIR-8 | Licensing of terminologies (ICD-11, SNOMED, WHO growth, IAP) misunderstood | M | M | Attribution page; verification task inside AI-17 |
| AIR-9 | Google keeps pseudonymised prompts for up to 90 days for abuse monitoring (no Master Agreement or ZDR), possibly outside India ⚖ | M | M | Request ZDR; pseudonymisation; disclose in AI terms; accepted (PO-22 ✅, 2026-11-10) |
| AIR-10 | Golden labels and clinical tables authored and reviewed only by Claude (no clinician) | M | M | D-9: one-time PO or external-clinician sign-off, or written risk acceptance; conservative v2.0 scope |

---

## 10. Decisions for the PO (genuinely open; each has a recommended default)

| ID | Decision | Recommended default |
|---|---|---|
| **D-1** ✅ | AI pricing and unit | **Decided 2026-11-10 (PO-21): no AI is sold in v2.0; AI shows "Coming soon"; pricing stays configurable for later products, including the AI Voice Receptionist (metered).** *Earlier default, kept as input:* **AI Assist add-on `ai_assist`, a second Razorpay subscription** (C33, SUB-D8 (a)), **per clinic per month with a pooled draft quota** (indicative 1,500 drafts, ₹499 on top of ₹1,499). Initial price and quota estimated from L3 token counts before go-live; re-priced after the first 2 weeks of production `ai_calls` data. Roadmap PO-21 |
| **D-2** ✅ | Is AI included in the 14-day free trial? | **Decided 2026-11-10 (PO-21): yes, as a "Preview" with 1,500 drafts for the whole trial**, owner opt-in required, no meter or upsell. After the trial: PO-25 (default: preview ends) |
| **D-3** | Product branding containing "AI" while the base plan has no AI | Keep the company name. Do not use "AI" in the in-app product name or base-plan marketing |
| **D-4** | A second paid AI feature at go-live (patient-advice simplification/translation) | **No:** go live with the scribe only; ship `ai.patient_advice` first in v2.1 |
| **D-5** | Remove browser voice dictation in v2.0 | **Yes, remove.** clinicOS provides no dictation; OS keyboard dictation is the clinic's own device choice, outside clinicOS processing, stated in the clinic AI terms ⚖. Reintroduce as `ai.scribe.voice` with in-India speech-to-text in v2.1 |
| **D-6** | Drug–drug interaction alerts | **Defer.** Revisit with a licensed DDI source and cost in v2.1. v2.0 ships allergy (substance-level) and, if time permits, duplicate-therapy checks |
| **D-7** | Provider | **Vertex AI Gemini `asia-south1` only in v2.0**; Bedrock India adapter in v2.1 (AI-26) |
| **D-8** ✅ (PO-23(c)) | **Deviation from the PO's wording:** base-plan assistive features are labelled **"Smart Assist", never "AI"**, and are implemented in **TypeScript/SQL, not Python** | **Accept.** Rationale: misleading-claims exposure under consumer-protection law ⚖ if non-LLM features are called AI; one runtime for a one-person team. The features still "feel" smart (§5.1) |
| **D-9** ✅ (PO-22) | **Clinical-content review** with no clinician on the team: who signs off the allergy-class table (SA-07) and the L3 golden labels? (a) the PO, or one external clinician, signs both off once; or (b) a written PO risk acceptance that both are Claude-authored and Claude-reviewed | **Default if neither is chosen by G4:** class-level allergies move to v2.1 (substance-level only in v2.0), and L3 runs with Claude-reviewed labels under a recorded risk acceptance |
| **D-10** ✅ (PO-22) | Patient-level control ⚖: notice plus objection (opt-out) or explicit consent (opt-in) for AI drafting | **Notice plus objection flag** (§4.6), since the data is pseudonymised and the doctor reviews every draft. If the PO prefers explicit consent, the same column is inverted (`ai_processing_consented`, default false) at S cost. `DATA_HANDLING.md:22` notes consent is likely needed for non-essential AI processing ⚖ |
| **D-11** ✅ (PO-22) | Accept AIR-9 (possible 90-day abuse-monitoring prompt logging by Google if ZDR is not granted) | **Accept** with pseudonymisation and disclosure; revisit if Google grants ZDR or a Master Agreement |

The removal of the operations and clinical copilots (§0) is my recommendation under the PO's delegation and not a separate decision. Say so if you want either kept.

---

## 11. Roadmap impact

### 11.1 New backlog items (prefix `AI-`)

| ID | Item | Priority | Size | Depends on | Phase placement |
|---|---|---|---|---|---|
| AI-01 | AI containment: remove copilot drawer and routes, mic, mock provider and `VITEST` branch; scribe fails closed; relabel deterministic UI. **Replaces** P1-22 (copilot no-op fix), absorbs part of P2-02 (lazy drawer no longer needed) and P2-03 (AI part), and makes PWA-11 moot | P0/P1 | S | — | V2-01 |
| AI-02 | Labelling system: add the "AI Assist" token and glyph and the "Smart Assist" glyph to `DESIGN_SYSTEM.md`; the **"Preview"** chip and note, and the **"Coming soon"** row (PO-21); copy rules; CI grep for "AI" in base-plan copy and next to prices | P1 | S | V2-06 tokens | V2-06 |
| AI-03 | `requireEntitlement` for `ai.*` and `assist.*` on top of SUB `has_entitlement`; trial rule; `tenant_ai_settings` opt-in; `patients.ai_processing_objected`; `platform_settings.ai_features` kill switch; `ai_reserve`/commit/release with expiring reservations; grants and pgTAP for gating tables | P1 | M | SUB-01, SUB-02, V2-05 | V2-05 (DB) + V2-12 |
| AI-04 | AI gateway (`lib/integrations/ai`): Vertex `asia-south1` adapter behind `AiProvider`, structured output, `pseudonymise`, post-checks, `ai_calls` and retention, rate limits (P1-26), env schema (build-time fail), `/api/ready` AI status. **Supersedes** P1-16 and P1-9; done together with P1-19 (AI SDK major) | P1 | M | P1-19, P1-26, P1-15, AI-03 | V2-12 |
| AI-05 | AI Scribe v2 (server context, `{text, source_span}`, per-section accept, provenance and audit, 6 failure states incl. offline) | P1 | M | AI-04, V2-09a/b save model | V2-12 (plan 12-06), on the V2-09b save model (C37) |
| AI-06 | Eval harness L1 to L3, golden set ≥ 60 synthetic cases, prompt versioning, release rule, budget-capped eval key | P1 | M | L1: V2-02 CI; L2: AI-03 (DB), AI-04; L3: AI-04, D-9 | V2-02 (L1 copy and route greps), V2-05 (L2 gating matrix, database part), V2-12 (L2 gateway part, L3) |
| AI-07 | SA-01 unified terminology search (`pg_trgm`, abbreviations, parameterised RPC; removes `.or()` interpolation) | P1 | M | V2-05 | V2-09b |
| AI-08 | SA-02 Rx favourites fix (doctor filter, no invented defaults) plus protocol ranking | P1 | S | — | V2-09c (bug fix may go in V2-01) |
| AI-09 | SA-03 deterministic shorthand expander plus doctor macros | P1 | M | — | V2-09b |
| AI-10 | SA-04 patient snapshot (replaces LLM catch-up) | P1 | S | — | V2-09b |
| AI-11 | SA-07 coded allergies and substance-level allergy check (class table per D-9); SA-06 duplicate therapy if time permits | P2 | M | CDCI mapping, patient form (V2-08), D-9 | V2-09c |
| AI-12 | SA-05 weight-based dose calculator (doctor-authored mg/kg), **v2.1 after a regulatory check** | P2 (v2.1) | M | Vitals, Rx builder, CDSCO MDSW review ⚖ | v2.1 |
| AI-13 | SA-09 smart slot suggestions | P1 | M | V2-07 scheduling commands | V2-08 |
| AI-14 | SA-10 duplicate patient detection v2 (supports receptionist registration, PO-3) | P1 | S-M | V2-05 RLS | V2-08 |
| AI-15 | SA-11 follow-up parsing → proposed appointment via SA-09; reminders only for booked appointments | P2 | S | AI-13, V2-07 booking command | V2-09b |
| AI-16 | SA-12 help and command search; SA-13 vitals flags (if time permits) | P3 | S | V2-06 palette | V2-06 / V2-09b |
| AI-17 | Provider setup and terms: GCP AI project (caching off, request-response logging off, no grounding, ZDR request, budget alert, Vertex quota), Google DPA, sub-processor register, AI opt-in terms (incl. OS dictation and AIR-9 disclosure), patient-notice and objection text, licence and attribution checks (CDCI, ICD-11, SNOMED via NRCeS, WHO) ⚖ | P1 | S | PO account actions | V2-12 (before AI-05 goes live) |
| AI-18 | AI feature keys (incl. `ai.voice_receptionist*`); catalogue rows `ai_assist` and `ai_voice_receptionist` with `purchasable = false`, `visibility = 'coming_soon'` and no provider price; the `standard_trial` limit `ai.scribe.monthly_drafts = 1500`; the `platform.set_product_availability` RPC (backend switch); SQL first, the V2-13c Plans & prices screen edits them | P1 | S | SUB-01, D-1 ✅, PO-25 | **V2-05** (moved from V2-13b, C41) |
| AI-21 | v2.1 operations copilot rebuilt on server commands (handles, previews, server-owned turns) | P2 | L | V2-07, AI-04 | v2.1 |
| AI-22 | v2.1 `ai.patient_advice` simplify/translate | P2 | M | AI-04 | v2.1 |
| AI-23 | Clinical Q&A: only grounded and cited, with a regulatory review | P3 | XL | AI-04, counsel ⚖ | Unscheduled |
| AI-24 | v2.1 `ai.scribe.voice` in-India speech-to-text | P2 | M | AI-05 | v2.1 |
| AI-25 | v2.1 SA-14 vaccine schedule engine (UIP first; IAP licence check) | P2 (v2.1) | M | Reminders (P1-14) | v2.1 |
| AI-26 | v2.1 Bedrock India (`in.` profile) adapter: AWS DPA and residency review, L3 run, failover flag and drill | P3 | M | AI-04, AI-06 | v2.1 |

### 11.2 Changes to existing roadmap items and other documents

- **P1-16** is replaced by AI-04 plus AI-05.
- **P1-22** is replaced by AI-01 (remove, not fix). **Roadmap V2-08 scope (`V2_MASTER_ROADMAP.md:598`)** still lists P1-22 and "the copilot confirm fix"; remove both.
- **P2-02** loses its "lazy-load the AI drawer" part.
- **`V2_MASTER_ROADMAP.md:65` PO-9:** its default ("copilot actions read-only until fixed") is superseded by the removal of both copilots and by this document.
- **Acceptance criterion 9** (`V2_MASTER_ROADMAP.md:807`) becomes: "AI behind entitlement plus owner opt-in and patient objection, India-region processing, Google DPA accepted, L3 eval report attached".
- **R11** keeps its mitigation, with the AI scope reduced to the scribe.
- **`TARGET_ARCHITECTURE.md:151,305`:** the AI module lives at `lib/integrations/ai` (adopted here); remove the `ai.summary` job kind (the LLM catch-up is replaced by the deterministic snapshot, SA-04); add `ai.reservations_cleanup`.
- **`PWA_STRATEGY.md:513` PWA-11** becomes moot once AI-01 removes the drawer.
- **`SECURITY_REMEDIATION_PLAN.md:45` P1-9** and **`THREAT_MODEL.md` §3.8 / SR-8 (`:235`)**: re-point both to AI-04 and AI-05.
- **`TEST_STRATEGY.md:129-131`:** retire the copilot specs (`clinical-copilot.spec.ts`, `operations-copilot-ui.spec.ts`, copilot parts of `gateway-tools.spec.ts`) and the regex "evals" (`tests/ai/evals/*`); replace with the §7 lanes.
- **`DATA_HANDLING.md`:** replace the processors row "Google (Gemini API) or OpenAI" (`:80`) and the `:15` sub-processor mention with "Google Vertex AI, `asia-south1`, pseudonymised scribe text only"; add an "AI metadata" row to §5 (`ai_calls` 90 days; `ai_usage_monthly` ≤ 13 months while live; deleted at archive and never later than purge at expiry + 180 days; platform aggregates without identifiers).
- **`SUBSCRIPTIONS_AND_PLANS.md`** (reconcile):
  - §7.3 key list → replace with §6.2 here (retire `assist.icd10_lookup`, `ai.catchup_summary`, `ai.monthly_token_quota`; rename to `ai.operations_copilot`/`ai.clinical_copilot` as already used there).
  - §6.1 `trialing`: during `trialing`, `has_entitlement` also grants `ai.scribe` with `ai.scribe.monthly_drafts` equal to the `ai_assist` limit (D-2, C34). **Done in SUB.**
  - SUB-D8 / D-1: resolved as the `ai_assist` add-on on a second subscription (C33). **Done in SUB.** **Round 2 (C41):** deferred; no add-on is sold in v2.0, and the trial quota is a fixed 1,500 drafts. **Done in SUB.**
  - `platform_settings` gains an `ai_features jsonb` column.
  - The open question in §6.3 option B (recurring add-on on an existing mandate) applies only if the PO chooses B.

---

## Sources (accessed 2026-11-10)

1. Google Cloud: Vertex AI generative AI data residency. https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency
2. Google Cloud: Vertex AI zero data retention / data governance (now titled under "Gemini Enterprise Agent Platform"). https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance
3. Gemini 3.5 Flash-Lite pricing (third-party aggregators, **unconfirmed** against Google's pricing page), e.g. https://www.getmaxim.ai/bifrost/llm-cost-calculator/provider/vertex_ai/model/gemini-3.5-flash-lite
4. AWS ML Blog: Amazon Bedrock expands Claude model availability to India (geographic cross-Region inference), 29 Sep 2026. https://aws.amazon.com/blogs/machine-learning/amazon-bedrock-expands-claude-model-availability-to-india-cross-region-inference/
5. AWS: Claude Sonnet 5 model card / regional availability. https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html
6. Microsoft Q&A: Azure OpenAI in Central/South India (forum, **unconfirmed**). https://learn.microsoft.com/en-gb/answers/questions/2245190/requirement-for-azure-open-ai-services
7. Press coverage of Anthropic in-country inference via Bedrock (direct API not covered), e.g. https://inc42.com/buzz/anthropic-brings-claude-inference-to-india-as-sovereign-ai-race-heats-up/
8. CDSCO Medical Device Software guidance commentary: https://www.india-briefing.com/news/cdsco-draft-guidance-medical-software-40691.html and https://corporate.cyrilamarchandblogs.com/2026/01/medical-device-as-software-has-cdsco-guidance-changed-the-rules/
9. MDN: `SpeechRecognition.processLocally` (experimental); Chrome server-based recognition. https://developer.mozilla.org/docs/Web/API/SpeechRecognition/processLocally
10. CDCI licence (repo): `supabase/seed-data/cdci/License.txt` (C-DAC/NRCeS, CC BY 4.0, India-only redistribution).
11. Google Cloud: Abuse monitoring (Master Agreement exemption, 90-day retention, Advanced AI rules). https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/abuse-monitoring
12. OpenRegulatory: MDCG 2019-11 explained (patient-specific dose calculation usually qualifies as MDSW). https://openregulatory.com/mdcg/mdcg-2019-11
13. Nishith Desai Associates: India medical device software guidance. https://www.nishithdesai.com/research-and-articles/hotline/pharma-healthcare-update/from-code-to-compliance-decoding-indias-medical-device-software-guidance-15623
14. Digital Health News: CDSCO final MDSW guidance. https://www.digitalhealthnews.com/cdsco-unveils-final-medical-device-software-guidance-bringing-greater-regulatory-clarity-for-digital-health-innovators
15. EFPIA position on medical calculator qualification (industry view that simple label-based calculators should not qualify; proposed, not adopted). https://www.efpia.eu/media/b4bnh2ef/efpia-position-on-medical-calculator-qualification_v5_sept2024.pdf
16. Google Cloud: Vertex AI multimodal FAQ (consulted; it does **not** mention invoiced billing). https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/multimodal-faqs

---

## Review disposition (independent review of 2026-11-10)

All required items were checked against the sources and repo before applying.

| # | Disposition |
|---|---|
| 1 | **Applied.** All "pilot" references replaced (L3 token-count estimate before go-live; re-price after 2 weeks of production data; "14-day trial"). |
| 2 | **Applied.** Trial gets the paid AI quota; §0 says "included during the 14-day trial"; lower cap flagged as a deviation. |
| 3 | **Applied** as D-8. |
| 4 | **Applied** (§4.7), aligned with SUB §6.4, which already deletes AI logs at archive. The `DATA_HANDLING.md` §5 row is listed in §11.2 because this task may edit only this file. |
| 5 | **Applied** with SUB's actual states (adds `incomplete`, `past_due`, `comped`, `purged`, downgrade); mid-call re-check is step 9 of §4.1. |
| 6 | **Applied, simpler mechanism:** expired reservations stop counting at `expires_at` inside `ai_reserve`, so quota recovery does not depend on a reaper; a `jobs` cleanup only deletes old rows. L2 case added. |
| 7 | **Applied** (`{text, source_span}`, normalised substring check, L1 cases). |
| 8 | **Applied** (doctor-written drugs kept and flagged "move to Rx"). |
| 9 | **Applied** (`ai_processing_objected`, L2 row), plus D-10 on objection vs consent. The evidence line is `DATA_HANDLING.md:22`, not `:107-108` (those lines are the retention table). |
| 10 | **Applied** as D-9 and AIR-10, with the stated default. |
| 11 | **Applied.** SA-05/AI-12 moved to v2.1 behind a regulatory check; AIR-5 updated. MDCG 2019-11's treatment was confirmed via secondary sources [12]; industry contests it for simple calculators [15]. |
| 12 | **Applied** (SA-11 proposes an appointment; no message from a bare `follow_ups` row). |
| 13 | **Applied in part.** Durable caching default, "turning caching off disables both", request-response logging and `store=false` were confirmed [2] and added. **Rejected:** the invoiced-billing exemption cannot be cited to the multimodal FAQ, which does not mention it [16], and the current English abuse-monitoring page [11] no longer mentions invoiced billing either (it exempts Master Agreement customers and keeps logs up to 90 days). The doc now drops the invoiced-billing claim and records the gap as AIR-9 / D-11 instead of the proposed credit-approval assumption. |
| 14 | **Applied.** One unit everywhere (per clinic, pooled quota). Option A is re-expressed as SUB's plan switch (`ai_pro`), which is the reviewer's fallback and matches SUB §8.2. The add-on mandate question is kept as an open question under Option B. **Superseded (final review, 2026-11-10):** roadmap C33 adopted the add-on as a second subscription; §0.2, §4.6, §6.2, §6.3, D-1 and AI-18 are rewritten accordingly. |
| 15 | **Applied** for the §4.5 reference and the DESIGN_SYSTEM token (now AI-02's job). **Partly rejected:** `SUBSCRIPTIONS_AND_PLANS.md` does exist in `docs/v2/` (577 lines). The keys were reconciled against it (§6.2, §11.2), and dependence on its functions is marked as an assumption to validate. |
| 16 | **Applied** (§11.2). Line references verified. |
| 17 | **Applied** (build-time env schema, runtime "AI unavailable", `/api/ready`). |
| 18 | **Applied.** Vertex only in v2.0; Bedrock moved to AI-26 (v2.1); AIR-2, D-7, §4.1, AI-P4 updated. |
| 19 | **Applied** (A2 and D-5 wording; AI terms line in AI-17). |
| 20 | **Applied** (§4.6 write-protection row; pgTAP in AI-03 and L2). |
| 21 | **Rejected as proposed:** the multimodal FAQ does not support the claim (see 13). §3.1 now cites the abuse-monitoring page [11] and notes the "Gemini Enterprise Agent Platform" naming. |
| Opt. | **Applied:** Smart Assist trimmed (SA-06, 12, 13 "if time permits"); per-user switch and in-app daily spend cap dropped in favour of a GCP budget alert, Vertex quota and kill switch; regional premium noted as unconfirmed and Flash fallback costing method stated; budget-capped eval key held by the PO; offline failure state; §0 split into Facts and Recommendations. **Not applied:** direct ICD-11/SNOMED licence confirmation. It needs correspondence with WHO/NRCeS, so it stays an AI-17 task. |
