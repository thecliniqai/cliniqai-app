---
phase: 09B
roadmap_id: V2-09b
name: Consult workspace & save model
gate: "G4 (light, per PR): one isolated reviewer (Sonnet) over the workspace, a11y and UI contract + one adversarial security reviewer (Opus) over migrations 000112 to 000115 (the draft-save definer command, the grant narrowing, three INVOKER read functions, a new tenant table with RLS), the diagnosis-search route, the upload path and the in-memory draft buffer (PHI); one fix round (lean process, VERIFICATION_LOG 2026-11-15). Approved by delegation if the PO's 2026-11-21 delegation (V2-07 to V2-11) is still in force when the gate is reached, with the CI run recorded; otherwise the PO approves. The PO is informed and sees Q-3, Q-5 and Q-7."
requirements: ["P1-32 (workspace part: save model, two-pane workspace, templates)", "P1-24 (in-consult upload dropzone)", "P1-42 (consult journey; TEST_STRATEGY §7 journey 6, Q-1)", AI-07, AI-09, AI-10, AI-15, "AI-16 (vitals flags half; V2-06 R-10 hand-off)", "PWA-03b (tablet two-pane consult)", "PWA-06b (consult)", "M4.4 workspace criteria (FRONTEND_MIGRATION_PLAN §3)", "V2-09a hand-offs: recordState contract, sealed read-only, reopen and finalize flows, banner tone, consult axe debt, discard and open-amendments (T-09A-07, Q-3 of 09A)", "V2-08 hand-off: doctor-mode patient snapshot panel", "V2-06 hand-offs: sign & bill onto ResponsiveSheet, consult axe debt, diagnosis-section React Compiler waiver, tablet two-pane"]
plans: [09B-01, 09B-02a, 09B-02b, 09B-03, 09B-04a, 09B-04b, 09B-05, close]
order: "09B-01 -> 09B-02a -> 09B-02b -> 09B-03 -> 09B-04a -> 09B-04b -> 09B-05 -> close (sequential; one local stack; one executor at a time)"
migrations: {09B-01: 000112_consult_draft_save, 09B-03: 000113_consult_assist_context, 09B-04a: 000114_diagnosis_search_snapshot, 09B-04b: 000115_doctor_text_macros}
migrations_note: "Numbers are the next free ones at planning time (000111_clinical_review_fixes is the newest on v2/phase-09a-clinical-immutability). V2-09a's PR #15 may still add a migration in review: run `ls supabase/migrations | tail -3` at the start of each plan, renumber, and bump app/api/ready/expected-migration.ts in the same commit."
base_commit: "head of feature/v2 after PR #15 (V2-09a) merges. If #15 is still open when 09B-01 starts, branch from v2/phase-09a-clinical-immutability (a7188a4 at planning time) and merge forward with merge commits only (as V2-08 and V2-09a did)."
branch: "v2/phase-09b-consult-workspace (git.phase_branch_template) -> PR into feature/v2"
source: "docs/v2/V2_MASTER_ROADMAP.md §1.2 (PO-15, PO-21, PO-22), §10 (P1-32, P1-24, P1-42, AI-07/09/10/15/16, PWA-03, PWA-06), §10.3 C37, §12 V2-09b; docs/v2/FRONTEND_MIGRATION_PLAN.md §3 (M4 template, M4.4, PR-10); docs/v2/PWA_STRATEGY.md §3.4, §3.8 (consult drafts, D3), §4 (D-1 to D-8), §9.1; docs/v2/AI_STRATEGY.md §1.1 (A1, A3, A5), §5.2 (SA-01, SA-03, SA-04, SA-11, SA-12, SA-13), §5.3, §6.2, §8 AI-P3; docs/v2/DESIGN_SYSTEM.md §4.2, §6.2 (FileDrop, form behaviour), §6.8, §6.9, §7.1, §7.2, §8; docs/v2/UX_AUDIT.md §5.7; docs/v2/INFORMATION_ARCHITECTURE.md §3.4; docs/v2/TARGET_ARCHITECTURE.md §3.9, §7; docs/v2/ARCHITECTURE_DECISIONS.md ADR-004, ADR-005 (docs/adr/0005), ADR-016, ADR-019; docs/v2/TEST_STRATEGY.md §7; docs/v2/VERIFICATION_LOG.md rulings 2026-11-15, 2026-11-18, 2026-11-20, 2026-11-21; .planning/phases/06-design-system-pwa-shell/06-UI-SPEC.md §7-§8, 06-SUMMARY.md; .planning/sketches/004-consult (V2-DX, approved at G2-D), V2-DX-R2-V1-CONSULT-ANALYSIS.md, v2-dx-evidence/{counts.md,screens/consult*}; 08-PLAN.md; 09A-PLAN.md, 09A-NOTES.md, 09A-REVIEW-TRIAGE.md"
research: "No separate research file. The design is settled (V2-DX consult prototype and UI-SPEC §7, approved at G2-D; PWA §3.8 save model; AI §5.2 catalogue). The code inventory below is the research. Two facts were checked in the tree because they shape the design: Next runs server actions one at a time (V2-08 R-20), and every clinical_notes writer is known (two request paths)."
must_haves:
  truths:
    - "A doctor's typing reaches the server at most 5 s after the first unsaved change, on blur, when the app is hidden and before sign, amend, finalize or in-app navigation; killing the tab loses at most that window; no clinical text is stored on the device."
    - "Two tabs or devices editing one consult never overwrite each other silently: changes to different fields merge, the same field changed in both shows a conflict prompt, and the database refuses a save made against a stale version."
    - "Each draft save is one transaction (notes, specialty, AI provenance, follow-up, start of the consult, audit) with an idempotency key; a save retried after a lost response changes the draft once."
    - "The consult follows UI-SPEC §7 at 360, 820, 1180, 1280 and 1440 px, is keyboard-first (Alt+1 to Alt+5), keeps the allergy strip visible, and keeps V2-09a's sealed, amending and draft behaviour unchanged."
    - "Complaints, an exam template with one abnormal finding, a diagnosis and a follow-up are entered by taps; terminology search, patient snapshot, shorthand and follow-up proposal are deterministic Smart Assist, work with AI fully disabled and never insert anything without a tap."
    - "A report uploaded from the consult is stored append-only and listed on the consult and the patient."
  artifacts:
    - "supabase/migrations/000112_consult_draft_save.sql, 000113_consult_assist_context.sql, 000114_diagnosis_search_snapshot.sql, 000115_doctor_text_macros.sql"
    - "supabase/tests/database/consult_draft_save.test.sql, consult_assist_context.test.sql, diagnosis_search_snapshot.test.sql, doctor_text_macros.test.sql"
    - "features/consultation/{draft-saver.ts,draft-rebase.ts,catalogue.ts,exam-templates.ts,shorthand.ts}, features/terminology/abbreviations.ts, app/api/terminology/diagnoses/route.ts, components/ui/file-drop.tsx, components/consultation/workspace/**"
    - "tests/consultation/{draft-save-rpc,draft-saver,draft-rebase,shorthand}.spec.ts, tests/e2e/consult/{draft-persistence,workspace-layout,tap-entry,smart-assist,upload}.spec.ts, tests/e2e/a11y/consult-screens.spec.ts, tests/e2e/journeys/journey-06-consult.spec.ts"
  key_links:
    - "clinical_notes.draft_version is raised by a trigger on every committed write; save_consultation_draft compares it under the visit and notes row locks; the draft saver's rebase is the only consumer of DRAFT_CONFLICT."
    - "recordState (V2-09a) drives every read-only and action decision of the rebuilt workspace; the 09A specs (workspace-sealed, workspace-review-fixes, sealed-refusal-messages, amendment-screens, consult-rx-finish) are the check and keep their assertions."
    - "Smart Assist reads (search_diagnoses, consult_assist_context, patient_snapshot) are INVOKER under RLS with the tenant taken from the session; each assist.* key is resolved on the server and decides whether the UI shows the feature."
---

# V2-09b Consult workspace & save model: plan

## Goal

Doctors never lose consult work, and the consult is keyboard-first and tap-first. Every change is held in memory and saved to
the server within 5 s, on blur, when the app is hidden and before any sign-off or navigation; a killed tab loses at most those
few seconds and nothing clinical is stored on the device. A second tab or device editing the same consult is detected:
changes to different fields merge silently, the same field changed twice asks the doctor. Each save is one transaction with an
idempotency key. The workspace is rebuilt to the approved V2-DX structure (patient column, note with five sections, summary
pane, sticky allergy strip; one column with a section strip and Finish bar on a phone), keeps V2-09a's sealed record and
amendment flows exactly, and replaces typing with tiles and templates. Deterministic Smart Assist (terminology search, patient
snapshot, shorthand with doctor macros, follow-up proposal) works with AI switched off and never inserts without a tap. The
dead upload dropzone becomes a real, append-only upload. The AI Scribe is not in this phase (C37: V2-12).

Tracer: 09B-01 starts with the narrowest end-to-end slice (the free-text note through a new versioned save command: migration,
command, service, action, the in-memory saver, the existing workspace, and a kill-the-tab e2e) and only then expands to every
field, the conflict prompt and the unload guard, so a dead end in the save model shows up after one commit and before the
workspace is rebuilt on top of it.

## Current state (inventory 2026-11-21; tree at a7188a4 on v2/phase-09a-clinical-immutability; highest migration 000111)

| Area | Today | Gap | Plan |
|---|---|---|---|
| Workspace | `components/consultation/consultation-workspace.tsx` (1,497 lines; the roadmap counted 1,681 before V2-09a): one long page, sticky header (identity, specialty `<select>`, History, Save Draft, Complete & Sign; V2-09a's signed chip, Amend and amending banner), seven card sections, `patient-history-drawer.tsx` (232; Repeat Rx is a client loop of `addPrescriptionItem`, `:484-503`), LLM catch-up card `returning-patient-catchup.tsx` (175, `getPatientCatchUpSummaryAction`, AI §1.1 A3), v1 scribe `ai-scribe-modal.tsx` (266, `generateSoapAction`, fails closed when unconfigured). The shell already has a focus mode for the consult (`components/shell/app-shell.tsx`, `isFocusMode`: Rail at 768 px and up, no BottomBar) | Not two-pane; context in a drawer; no section shortcuts; the scribe must not ship here (C37); M0 axe debt on this route (06-SUMMARY) | 09B-02a, 09B-02b |
| Save | `handleSaveDraft` with a 15 s debounce (`consultation-workspace.tsx:417-426`), the full payload every time, no version. `saveConsultationDraft` (`features/consultation/service.ts:111-300`) runs five statements: visit UPDATE, `clinical_notes` UPDATE, a best-effort `start_consultation`, the follow-up through `recordFollowUp` (select, then insert or update, or delete), app-side audit `consultation.draft_save`. No `beforeunload` or `pagehide` handler exists in `app`, `components` or `lib`. `SaveStatus` (`components/clinical/save-status.tsx`), `useCommand` (15 s timeout, one retry with the same id) and `lib/commands/save-state.ts` exist but the consult draft uses none of them | F-08: edits lost, the last tab silently wins, no unload guard, not one transaction (ADR-004, M4 criterion 7) | 09B-01 |
| Clinical notes and follow-ups | `clinical_notes`: six content columns, one row per visit (05-02a), no version; request-path writers are the draft service and `recordVisitVitals` (`features/visits/service.ts:554`, vitals only, through `updateClinicalNotes`). `follow_ups`: no one-per-visit constraint, status `scheduled`, sealed with the visit (000107), RLS 000055 (read: appointments:view). Today's Realtime signal fires only when `vitals` changes (000102 `clinical_notes_today_signal`) | No version for conflict detection | 09B-01 |
| Sealed contract (V2-09a) | `recordState`, `signedVersionOf`, `SIGNED_CONSULTATION_MESSAGE`, `isSealedRefusal` (`features/consultation/record-state.ts`); `amendment-modal.tsx` (Dialog), `finalize-amendment-dialog.tsx` (saves first); specs `tests/consultation/{workspace-sealed,workspace-review-fixes,sealed-refusal-messages}.spec.ts`, `tests/e2e/a11y/amendment-screens.spec.ts`, `tests/e2e/m0/consult-rx-finish.spec.ts` | Must survive the rebuild with unchanged behaviour | every plan |
| Finish | `sign-and-bill-modal.tsx` (713 lines, hand-rolled dialog; V2-06 hand-off "V2-09b (sign & bill)") | No focus trap | 09B-02a |
| Entry | 12 fixed complaint chips (`chief-complaints-section.tsx`), GP exam = PICCLE toggles + four free-text systems (`specialty/gp-systemic-review.tsx`; about 170 typed characters for a normal exam, V2-DX analysis §4), dental odontogram (632), paediatrics tools (558), 14 investigation and 10 advice chips, follow-up chips; specialty chosen in a header `<select>` | No templates, no learning, typing-heavy | 09B-03 |
| Diagnosis search | Server action `searchDiagnoses` (`features/terminology/service.ts:28-120`): `ilike` on `doctor_custom_diagnoses.diagnosis_name` and `opd_diagnoses.name`; `opd_diagnoses.synonyms` unused; trigram index on `name` only (000007:247); the typeahead sits on the server-action queue; `diagnosis-section.tsx` (559) holds a React Compiler waiver naming V2-09b. `opd_diagnoses` is empty on the local stack (`seed:diagnoses` targets the hosted project and is never run): tests seed synthetic rows | AI-07 | 09B-04a |
| Snapshot and flags | No snapshot; only the A3 LLM catch-up. Today doctor mode (`components/today/doctor-mode.tsx`, `next-patient-card.tsx`) has no snapshot panel (08 deferred AI-10 here). Vitals flags exist in `lib/clinical/vitals.ts` (V2-06) | AI-10, AI-16 | 09B-04a |
| Shorthand, macros, follow-up proposal | None (the v1 regex fallback was deleted by AI-01) | AI-09, AI-15 | 09B-04b |
| Upload | The "Clinical attachments" dropzone is a no-op (`consultation-workspace.tsx:1373-1407`, empty `onChange`). `uploadLabDocument(formData)` (`features/labs/service.ts:32-185`): labs:edit (owner, doctor, nurse), PDF/JPEG/PNG/WEBP, 25 MB, id-only key, `upsert: false`, audit, `lab_result.ready` webhook; documents are append-only since 09A-04/06a. No `FileDrop` in `components/ui` | P1-24 | 09B-05 |
| Entitlements | `requireEntitlement` / `activeEntitlements` (`lib/entitlements/require-entitlement.ts`); `assist.*` keys seeded in 000084 (`assist.terminology`, `assist.shorthand`, `assist.snapshot`, `assist.followup`, `assist.vitals`, ...); one caller today (`features/visits/scheduling.ts:110`, slots). Kill switch `platform_settings.ai_features` (000082) | | 09B-03 to 09B-04b |
| Journeys | No `journey-06` spec in `tests/e2e/journeys`; the consult journey lives in `tests/e2e/m0/consult-rx-finish.spec.ts` with V2-09a's tail | P1-42 | 09B-05 |

Gate scripts today: pgTAP FLOOR 8494 (`scripts/ci/assert-pgtap-report.mjs:130`), Vitest FLOOR 6455 (`assert-vitest-report.mjs:119`; the
V2-09a close may re-measure it), `EXPECTED_MIGRATION = "000111"`, route budget `/consultation/[id]` 200 kB gz (`scripts/ci/route-js.mjs`),
consult waivers in `scripts/ci/react-compiler-waivers.json`: `diagnosis-section.tsx` (this phase), `frequent-rx-chips.tsx` and
`prescription-builder.tsx` (V2-09c).

### Carried in from V2-09a (hand-offs; 09A-NOTES "Notes for the close and for 09A-06a / V2-09b", 09A-PLAN Deferred, 09A-REVIEW-TRIAGE)

- `recordState`, the sealed read-only contract (every input disabled, notes `readOnly` and focusable per B-6, Amend for owner and doctor),
  and the two flows (reopen with a 10 to 500 character reason; finalize with the form saved first) are this phase's contract. The 09A specs
  are the check and keep their assertions; only selectors may change.
- R-A: only the signing doctor archives a Rx PDF, in their own sign-off and finalize requests or the self-heal on open. The workspace never
  archives; it calls the same actions as today. `RX_ARCHIVE_PENDING` keeps its fixed text in the Amend dialog.
- Banner tone for amending: "a dedicated amendment tone would be a V2-09b design-system call" (09A-05 deviation 3). Decided in R-6.
- Consult axe debt: 09A-05 asserted zero serious or critical only on the new surfaces and "no rule outside the M0 baseline" for the page.
  After 09B-02a the whole page must be clean with no baseline allowance.
- Discard of an abandoned amendment and an "open amendments" indicator were assigned here (09A Deferred, T-09A-07, Q-3). The indicator
  ships (09B-04a); discard is re-ruled in Q-5.
- Growth calculator inputs stay enabled on a sealed record (local calculator state, never saved; 09A-06a deviation 9).

## Rulings

CTO rulings under the lean process and the PO's delegation (VERIFICATION_LOG 2026-11-21). Where the documents are silent the default is
recorded here and in Open questions; the PO may overturn any of them at the gate.

| # | Ruling | Why / how |
|---|---|---|
| R-1 | **Scope.** P1-32 workspace part (save model, two-pane workspace, templates), P1-24 in-consult upload, the consult journey (Q-1), AI-07, AI-09, AI-10, AI-15, AI-16 vitals flags, PWA-03b and PWA-06b for the consult, and the hand-offs above. Out: keyboard Rx builder, Rx favourites fix (AI-08), "your usual" Rx bundle, "Same as last visit" as one command, the finish review sheet, PDF template, allergy check, camera capture and compression (V2-09c); the billing part of sign and bill (V2-10); the AI Scribe and its top-bar button (V2-12, C37); the URL move (Q-2); discard of an open amendment (Q-5) | Roadmap §12 V2-09b, §10.3 C37; plan models |
| R-2 | **The draft and its version.** The draft is the six `clinical_notes` columns, `visits.specialty`, the AI provenance keys of `visits.metadata` (08-06a S-3; kept for V2-12) and the visit's follow-up. New `clinical_notes.draft_version integer NOT NULL DEFAULT 0`, raised by exactly 1 on every committed UPDATE of the row by a BEFORE UPDATE trigger `clinical_notes_version_bump` on every path (a caller-supplied value is ignored). The trigger name sorts after `clinical_notes_guard`, so a sealed row is refused before any bump. Diagnoses and Rx items stay row-level writes outside the version: each add or remove is its own row, so they cannot overwrite each other; the other tab sees them on its next refresh (resume refetch, PWA §3.8) | TARGET §7.3 "optimistic `version` columns only where long-lived edits occur (consultation draft autosave)"; FRONTEND PR-10 |
| R-3 | **One command per save** (ADR-004, M4 criterion 7, PWA-06a). `public.save_consultation_draft(p_tenant_id uuid, p_visit_id uuid, p_expected_version integer, p_patch jsonb, p_client_request_id uuid)`, SECURITY DEFINER in the V2-07 pattern under the caller's JWT. Guard block (actor; tenant = active full clinic; `consultations:edit`); `p_patch` keys limited to `vitals`, `chief_complaints`, `clinical_notes`, `specialty_data`, `investigations_advised`, `advice`, `specialty`, `provenance`, `follow_up`, with jsonb types checked and the whole patch at most 256 kB (`INPUT_INVALID`); claim; lock the visit (`FOR NO KEY UPDATE`) and the notes row (`FOR UPDATE`); refuse a sealed visit and an unsigned `completed` or `cancelled` one (`DRAFT_LOCKED`, P0001, CONFLICT; the service maps it to `SIGNED_CONSULTATION_MESSAGE` when signed); refuse `draft_version <> p_expected_version` (`DRAFT_CONFLICT`, P0001, CONFLICT). Then write only the keys present: notes columns (vitals keep the stored recorder when the measurements are unchanged, else the actor, the TS `attributeVitals` rule moved into SQL), `visits.specialty` only when it differs, provenance merged as today, the follow-up (upsert of the visit's one row, `follow_up = null` deletes it); a `waiting` visit moves to `in_consultation` exactly as `start_consultation` does (a shared `private.step_start_consultation` extracted from its latest body: status, the token's `called_at`, audit `visit.consultation_start`) when the caller also holds `appointments:edit`; command-only audit `consultation.draft_save` with `fields_changed`, `draft_version` and `conflict_overwrite`; result `{visit_id, draft_version, started, replayed}` (ids, numbers, flags only, F-5). Contract: after the writer inventory, `UPDATE` on `clinical_notes` for `authenticated` is narrowed to `(vitals)` (the vitals path; the trigger maintains `updated_at` and `draft_version`) and `INSERT`, `UPDATE`, `DELETE` on `follow_ups` are revoked from `authenticated` if no request path writes them any more; a partial unique index `follow_ups_one_per_visit (tenant_id, visit_id) WHERE visit_id IS NOT NULL` (no live data, PO-15). The old multi-statement service path and `recordFollowUp` are deleted | V2-07 command pattern; 08 R-15 contract precedent |
| R-4 | **When the draft is saved** (PWA §3.8, D3). (a) 5 s after the first unsaved change, a maximum wait that further typing does not reset, so continuous typing still saves every 5 s; (b) on blur (focus leaves an edited field); (c) on `visibilitychange` to hidden and on `pagehide` (best effort); (d) a flush that callers await before Sign, Amend, Finalize, Finish, in-app navigation and the "Save draft" control (kept: the 09A amending contract names it), and on Ctrl/Cmd+S. One save in flight at a time; edits made during a save go into the next one. Each save attempt carries its own `client_request_id` bound to its exact payload; a timeout (15 s) or a transport failure is retried once with the same id after 1 s (`COMMAND_TIMEOUT_MS`, `COMMAND_RETRY_DELAY_MS` of `useCommand`), never with a new payload. Offline at save time sends nothing, shows "Offline · not saved. Reconnect to save" and saves on the `online` event. A `beforeunload` prompt is registered only while the draft is dirty or a save is in flight. The unsent buffer lives in memory only: no localStorage, sessionStorage, IndexedDB or Cache Storage (PWA §4 D-3). `SaveStatus` sits in the top bar ("Saving…", "Saved · 10:42 am", offline, "Couldn't save · Retry"; on a phone only the failures are drawn, as the component already does) | Worst-case loss is the last 5 s plus a save in flight |
| R-5 | **Conflict handling.** On `DRAFT_CONFLICT` the client reads the server copy (`getConsultationDraft`, consultations:view: the draft fields, follow-up, specialty, `draft_version`, record state) and rebases field by field (pure `rebaseDraft(base, mine, theirs)`): a field the other writer did not change keeps mine; a field only they changed takes theirs; when both changed the same field to different values, an AlertDialog "This consultation was changed in another tab or device" lists the fields and offers "Use the other version" (theirs for those fields) or "Keep mine" (re-sent at the new version, audited with `conflict_overwrite: true`). No silent overwrite. Sign, Finalize and Finish wait until the conflict is resolved. A nurse recording vitals while the doctor types notes therefore merges silently | M4.4 "conflict prompt, not a silent overwrite"; avoids prompts for unrelated edits |
| R-6 | **Record-state contract kept** (09A R-16, 09A-05, 09A-06a). Read-only for sealed, unsigned completed and cancelled visits; Amend for holders of consultations:edit, prescriptions:edit and appointments:edit; the amending `Banner` keeps the `past-due` (warning) tone with `role="status"` and gains "opened {clinic date}" (decided: no new design token); Finalize flushes the draft saver first and stops on a failed or conflicting save; focus after Amend and Finalize (B-3) and editor remount keyed on the state (B-1) are kept. The draft command refuses sealed visits itself, and the 09A guards still fire for its definer body (09A R-3) | 09A hand-offs |
| R-7 | **Layout** (06-UI-SPEC §7 consult, PWA §3.4, DESIGN §4.2). 360: one column, allergy strip sticky under the top bar, section strip (44 px pills with counts), Patient and Summary as drawers, fixed Finish bar (Patient + "Finish visit", `pb-safe`). 744 is the phone shell. 820: note only (max 896), label column 96, top bar with SaveStatus, "Patient" (opens a Patient sheet), "Finish visit". 1180: patient column 264 (identity, vitals grid with flags, allergies, problems, last visit, history) + note, label column 120 with Kbd "Alt 1…5" hints on fine pointers. 1280: + "Summary" toggle (`aria-pressed`) adding the 272 summary pane, closed below 1440 and open from 1440 ("Summary · as the patient will see it"). Sections in order: Complaints (Alt+1), Examination (Alt+2), Diagnosis (Alt+3), Prescription (Alt+4), Plan (Alt+5: investigations, advice, follow-up, refer, attach). Single-key shortcuts M (medicine search), F (Finish), `/` (command bar, 09B-04b) sit behind the existing per-device switch (`clinicos.pref.shortcuts`); Alt combinations always work. The allergy strip is `AllergyBanner` in all three states and is never dismissible or scrolled away (DESIGN §7.2) | Approved V2-DX structure; "allergy banner always visible" (M4.4) |
| R-8 | **Finish.** "Finish visit" flushes the draft and opens the existing Sign & Bill flow, moved onto `ResponsiveSheet` (focus trap, Escape, focus return) with the same props, commands and texts (V2-06 hand-off). Its billing part is rebuilt by V2-10; the review summary with print and WhatsApp defaults and the two-tap finish land with the Rx print work in V2-09c (Q-12) | Precedent: V2-08 kept the checkout drawer for V2-10 |
| R-9 | **Templates and tiles** (roadmap 09b-02 "templates"; V2-DX steps A to C). A static catalogue `features/consultation/catalogue.ts` (complaints: the approved V2-DX list plus v1's chips; general signs: PICCLE; investigations and advice: v1's strings verbatim plus the V2-DX ones not already present; follow-up intervals None, 3 days, 5 days, 1 week, 2 weeks, 1 month, custom date) and `features/consultation/exam-templates.ts` (the six templates of the approved prototype `004-consult/consult.js`: Fever workup, GP general, Respiratory, Abdomen, Dental, Child; normal texts and finding lists copied verbatim). The exam is stored in `specialty_data.exam` (`{template_id, systems: {key: {abnormal, findings[], side, note}}}`, a new optional object on the GP schema) and mirrored by a pure function into the existing `systemic` text and `general_exam` booleans, so existing readers keep working; Dental and Child select the dental and paediatrics specialties and their existing tools (switching specialty with data present asks first, AlertDialog). Findings start normal; nothing is diagnostic. Complaint durations are option pills (1d, 2d, 3d, 5d, 1w, 2w, 1m) | Typing toward zero (V2-DX brief); no new clinical logic (Q-7) |
| R-10 | **Smart Assist** (AI §5.2, §5.3, §6.2; 08 R-18). Deterministic TypeScript and SQL, labelled "Smart Assist" with `SmartAssistLabel` (Zap glyph), never "AI" or the sparkle. Each feature is resolved per key on the server (`activeEntitlements()` in the page loader or route; never caller input): `assist.terminology` (abbreviation and synonym search, likely diagnoses, learned order of complaints, templates and plan tiles), `assist.snapshot`, `assist.shorthand` (with macros), `assist.followup`, `assist.vitals` (flags). Not entitled: the feature is hidden or the fixed v1 lists apply. A suggestion is applied only by a tap or Enter on it and is shown in its own labelled group until then ("marked until accepted"). Every feature works with AI fully disabled (no provider env, kill switch on) | AI-P3 acceptance |
| R-11 | **AI-07 terminology.** The typeahead moves to `GET /api/terminology/diagnoses?q=&specialty=` (a route handler: typeahead never rides the server-action queue, 08 R-11, TARGET §3.9) over `public.search_diagnoses(p_tenant_id, p_terms text[], p_specialty text, p_limit int)` (INVOKER, STABLE, parameterised). The service expands the query with a fixed Indian-OPD abbreviation table (`features/terminology/abbreviations.ts`: URTI, AGE, T2DM, HTN, AOM, UTI, k/c/o and about 40 more, each mapped to the expansion text, not to an id) when `assist.terminology` is entitled. Ranking: the doctor's own custom diagnoses first by `use_count`, then exact name, name prefix, synonym match, word prefix, then trigram similarity of at least 0.3 on name and synonyms; `%`, `_` and `\` escaped. Codes shown as "ICD-11" (the v1 label said ICD-10, AI §1.1 A5). Response: id, name, ICD-11 code, SNOMED id, chronic flag, custom flag; `private, no-store`; rate limiting is V2-12 | SA-01 |
| R-12 | **Learned order and likely diagnoses** (V2-DX "chain"; own data only). `public.consult_assist_context(p_tenant_id uuid)` (INVOKER, STABLE) reads the calling doctor's own last 300 signed visits in the active clinic and returns names and counts only (no patient or visit ids): complaint frequencies, complaint-to-diagnosis co-occurrence, recent diagnoses, per diagnosis the usual investigations, advice and follow-up interval, and the last exam template used. "Likely from the complaints" diagnosis tiles come only from this co-occurrence (Q-8); no Claude-authored complaint-to-diagnosis table exists | Clinical-content risk kept at zero (PO-22) |
| R-13 | **AI-10 patient snapshot.** `public.patient_snapshot(p_tenant_id uuid, p_patient_id uuid, p_exclude_visit_id uuid)` (INVOKER, STABLE): the last five signed visits of the patient other than the current one (unsigned and future visits excluded, the A3 defect), each with clinic-zone date, doctor display name, diagnoses and the signed version's Rx lines; allergies and chronic conditions; follow-ups due before the clinic's today with no visit since; the latest signed visit's vitals. Rendered from a template in the patient column and, for doctors, in Today doctor mode beside the Next card at 768 px and up (08 hand-off). Vitals flags from `lib/clinical/vitals.ts` when `assist.vitals` is entitled (AI-16). The LLM catch-up (`returning-patient-catchup.tsx`, `getPatientCatchUpSummaryAction`, `lib/ai/catch-up-summary.ts`) is deleted | SA-04, SA-13 |
| R-14 | **AI-09 shorthand and macros.** Pure parser `features/consultation/shorthand.ts`: segments split on `;` or new lines, each led by a marker: `c/o` (complaints: name plus optional duration such as `3d`, `2 wk`, `1 mo`), `k/c/o` and `o/e` (kept with their marker in the notes text), `adv` (advice items split on commas; OD, BD, TDS, QID, HS, SOS, stat expanded from a fixed table), `f/u` (follow-up interval); an unmarked segment goes to the notes text verbatim; `.name` tokens are replaced by the doctor's macro text before parsing. Invariant (property-tested): every word of the output is a word of the input, a fixed expansion of an abbreviation present in the input, or a word of a macro the input names; no value is defaulted (a complaint with no duration is inserted with no duration: the complaint duration becomes optional in the schema and every reader prints it only when present). Shown in the consult command bar (`/` or a visible "Shorthand" button) as a live preview grouped by section; Enter or "Insert" applies it, Escape discards. Macros: new tenant table `doctor_text_macros` (tenant_id, doctor_id, shortcut `^\.[a-z0-9_-]{1,24}$`, expansion up to 2,000 characters, unique per doctor, at most 200 per doctor) with RLS to the owning doctor holding `consultations:edit`; managed from the command bar's macro list; expansion text is never logged | SA-03 |
| R-15 | **AI-15 follow-up proposal.** The same parser finds "f/u 1 wk", "review after 3 days" and "repeat HbA1c 3 months" in advice and notes and offers a labelled chip "Set follow-up: 1 week (Tue, 24 Nov)" in Plan; a tap sets the follow-up (the input words of the phrase become the follow-up note). "Book follow-up" (doctor, in Plan) and a To-bill or Done row action on Today (receptionist) open the V2-08 booking sheet `?book=1&patient=&doctor=&date=` where the SA-09 suggestions preselect a slot; the user confirms. Nothing about the booking is stored on the sealed follow-up row; the action is shown while the patient has no booked or confirmed visit with that doctor from three days before the follow-up date onward (Q-14). A follow-up row alone never enqueues a message (PO-8) | SA-11 |
| R-16 | **Upload (P1-24).** New `components/ui/file-drop.tsx` (DESIGN §6.2): drop zone and picker, client checks of type and size against constants exported once from `features/labs` (PDF, JPEG, PNG, WEBP; 25 MB, the server's limit), one status row per file (queued, uploading, stored, failed with Retry; server actions expose no byte progress, Q-11). Uploads go through the existing `uploadLabDocument` with `visit_id` (labs:edit; owner, doctor, nurse), one action per file. Listed under Plan "Attachments" and the patient column "Documents"; opened through the existing 5-minute signed link. Disabled when the record is read-only (09A contract). No new bucket, path or storage policy; documents stay append-only. Camera capture and compression are V2-09c (PWA-12, FT-04) | Roadmap acceptance 3 |
| R-17 | **Platform rules.** No service-role client anywhere in this phase (ADR-0005): the command runs under the caller's JWT, reads are INVOKER, the route and actions take the tenant from the session. No PHI on the device (R-4). No new dependency. No per-flow flags and the v1 screens are deleted as they are replaced (PO-15). Tenant-local dates come from `lib/datetime` (ADR-016). No cross-request caching of tenant data (ADR-019) | CLAUDE.md non-negotiables |
| R-18 | **Evidence and latency.** Tool output only: `node scripts/phase-evidence.mjs .planning/phases/09B-consult-workspace/evidence 1`, then `--ci-run <id>`; `scripts/perf/command-latency.ts` gains `save_consultation_draft` (p95 under 150 ms, the V2-08 condition) and times the three INVOKER reads on a synthetic seed (2,000 `opd_diagnoses` rows, 300 signed visits for one doctor, 50 for one patient; p95 under 50 ms); `ux` counter JSON for the tap targets; the axe summary; captures at 360, 820, 1180, 1280 and 1440 | CLAUDE.md DoD 5 |
| R-19 | **Migrations.** New files only; each bumps `app/api/ready/expected-migration.ts` in the same commit; expand first, contract (grant narrowing) only after the writer inventory in the same plan as the app change that stops using the privilege (no live data, PO-15) | CLAUDE.md |

## Shared rules for every plan

- Command pattern (07-PLAN; 08 shared rules): signature with `p_tenant_id` and a required `p_client_request_id uuid`, `search_path = ''`,
  `lock_timeout = '2s'`, guard block, claim, lock, invariants, writes, in-transaction audit through `private.log_command_audit`,
  `command_complete`, `REVOKE ALL ... FROM PUBLIC, anon, service_role; GRANT EXECUTE ... TO authenticated`. The spec calls
  `expectCommandCatalog` (`tests/helpers/command-catalog.ts`) and covers the happy path with its audit row, fault injection
  (`tests/helpers/fault.ts`: nothing persists), replay, `IDEMPOTENCY_MISMATCH` with each hashed input varied, the role matrix, cross-tenant
  and one concurrency case. A replaced function body starts from its LATEST definition (`grep -n "FUNCTION <name>" supabase/migrations/*.sql`)
  and changes only what the plan names; the diff against it is part of the review.
- Read functions: INVOKER, STABLE, `search_path = ''`, every name schema-qualified, `p_tenant_id` passed by the server from the session and
  filtered in the body (RLS still applies, so a forged id returns nothing), EXECUTE for `authenticated` only, the narrowest output.
- Registries a migration touches: `RPC_REASON_CODES` (`lib/db/errors.ts`), `AUDIT_ACTIONS` and `COMMAND_ONLY_AUDIT_ACTIONS` (`lib/audit/audit.ts`)
  with `tests/audit/log-audit-allowlist.spec.ts` and the SQL lists (`private.audit_client_actions()`, `private.audit_metadata_keys()`, latest
  bodies), the pgTAP definer registry and grantee sets (`definer_functions.test.sql`, `grants.test.sql`), `tests/security/guard-manifest.ts` and
  `npm run inventory` for every added or removed action or route, the schema snapshot (`node scripts/drift/schema-snapshot.mjs --local --write`,
  then `--check`; `npm run db:drift:local`), `npm run db:types` in the same commit, `npm run authz:gen` when a policy or grant changes,
  `scripts/ci/assert-pgtap-report.mjs` (new files in REQUIRED_FILES, FLOOR = measured total with the arithmetic in the header) and
  `scripts/ci/assert-vitest-report.mjs` REQUIRED_FILES (FLOOR re-measured once at the close).
- Affected-test discovery: before editing, grep for what the plan changes and list the hits in the notes:
  `grep -rln "saveConsultationDraft\|recordFollowUp\|clinical_notes\|follow_ups\|ConsultationWorkspace\|consultation-workspace\|searchDiagnoses\|ReturningPatientCatchup\|getPatientCatchUpSummaryAction\|AiScribeModal\|SignAndBillModal\|duration_val" tests supabase/tests scripts`,
  narrowed per plan. The grep, not any list in this plan, is authoritative. Fixtures that wrote `clinical_notes` content or `follow_ups` as a
  JWT user after 09B-01 write through the command or as the service role on an unsigned visit (09A R-15 still applies to signed ones).
- Tests assert real outcomes (rows, versions, statuses, DOM state, bytes), never source text or "renders". One "fails without" proof per
  High-risk control. No mutant runs.
- UI work: V2-06 parts (`components/ui`, `components/clinical`), no hex or raw palette class, `dvh` not `vh`, 44 px touch targets, no new React
  Compiler waiver (the waiver file only shrinks), `npm run ci:ui-policy` and `npm run ci:ai-l1` clean, checked at 360, 820, 1180 and 1280,
  axe clean. No new dependency.
- Plan record: each executor appends a section to `.planning/phases/09B-consult-workspace/09B-NOTES.md` (what changed, deviations, grep hits
  and their fixes, test names, the exact commands run with counts). Evidence is not typed there.
- Run order inside a plan: migration first (`npx supabase db reset --local`, `npm run db:types`), then service, then UI, then specs; then
  affected Vitest and pgTAP, `npm run typecheck`, `npx eslint .`, `npm run inventory`, and the plan's e2e lane after `npm run e2e:build`.
  Delete `.planning/dev-messages.txt` if a run recreates it.
- Never run `seed:cdci*`, `seed:diagnoses`, `msg91:*` or anything with `--env-file=.env`; never read `.env*`; synthetic data only; local stack only.

## Plans

### 09B-01 Save model: versioned draft, one save command, autosave, conflict prompt, unload guard · M-L · migration 000112_consult_draft_save

Goal: R-2 to R-5. A doctor's work reaches the server within 5 s in one transaction; two tabs never overwrite each other silently; leaving
with unsaved work is guarded; the existing workspace uses the new model (09B-02a rebuilds the screen on top of it).

Files: `supabase/migrations/000112_consult_draft_save.sql`; new `supabase/tests/database/consult_draft_save.test.sql`; `features/consultation/{service.ts,actions.ts,schema.ts}`;
new `features/consultation/draft-saver.ts`, `features/consultation/draft-rebase.ts`, `components/consultation/use-consult-draft.ts`,
`components/consultation/draft-conflict-dialog.tsx`; `components/consultation/consultation-workspace.tsx` (wiring only), `finalize-amendment-dialog.tsx`
and `sign-and-bill-modal.tsx` (flush instead of the old save); `app/(dashboard)/consultation/[id]/page.tsx` (reads `draft_version`); `lib/db/errors.ts`;
`lib/audit/audit.ts`; `scripts/perf/command-latency.ts`; new `tests/consultation/{draft-save-rpc,draft-saver,draft-rebase}.spec.ts`; new
`tests/e2e/consult/draft-persistence.spec.ts`; `tests/e2e/pwa/05-cache-audit.spec.ts`; `tests/ci/no-client-command-chains.spec.ts`; the fixture fallout;
registries.

1. Tracer (one vertical slice, committed first). Only `clinical_notes.clinical_notes` (the free-text note) travels through the new path: the
   column and bump trigger, the command accepting a patch with that one key, the service and action, `createDraftSaver` with the 5 s maximum
   wait, and the existing workspace's note field. Write `draft-persistence.spec.ts` "a killed tab keeps everything saved up to 5 s before" first,
   red against 000111: with `page.clock` installed, type "first line", advance 5 s, wait for "Saved", type " second", close the page without
   unload handlers, open the consult again, the note reads "first line"; and typing continuously for 12 s (a key every 500 ms) produces at least
   two saves (the wait is not reset by typing). Then build the slice. Acceptance: the spec fails on the old 15 s debounce and passes on the slice.
2. Migration 000112. (a) `ALTER TABLE public.clinical_notes ADD COLUMN draft_version integer NOT NULL DEFAULT 0` with a CHECK `draft_version >= 0`.
   (b) INVOKER trigger function and BEFORE UPDATE trigger `clinical_notes_version_bump` (R-2). (c) `private.step_start_consultation(p_tenant_id, p_visit_id)`
   extracted from the latest `start_consultation` body (000100:235 unless replaced later; grep), and `start_consultation` replaced to call it with every
   other statement unchanged. (d) `public.save_consultation_draft` per R-3. (e) Partial unique index `follow_ups_one_per_visit`. (f) Reason codes
   `DRAFT_CONFLICT`, `DRAFT_LOCKED`; `consultation.draft_save` becomes command-only (removed from the client-action list; `follow_up.record` too once
   `recordFollowUp` is gone); metadata keys `fields_changed`, `draft_version`, `conflict_overwrite`. (g) Writer inventory first (record it in the notes:
   `grep -rn "updateClinicalNotes\|from(\"clinical_notes\")\|from(\"follow_ups\")" app features lib components` plus SQL writers), then the R-3 contract:
   `REVOKE UPDATE ON public.clinical_notes FROM authenticated; GRANT UPDATE (vitals) ON public.clinical_notes TO authenticated`, and the `follow_ups`
   write privileges revoked only if the inventory finds no remaining request-path writer. Header comment names R-2, R-3 and states "additive column,
   new command, grant narrowing after inventory".
3. Service and action. `saveConsultationDraft(ctx, { visit_id, expected_version, patch, client_request_id })` validates the patch with the zod
   schemas (unchanged field rules), calls the command through `callCommand`, maps `DRAFT_CONFLICT` to a `CONFLICT` result carrying no data, and
   `DRAFT_LOCKED` or a sealed refusal to the fixed texts (09A R-17). New read action `getConsultationDraft(visitId)` (consultations:view). Delete the old
   five-statement path, `attributeVitals` (now SQL), `recordFollowUp` (service and action) and their guard-manifest rows.
4. Client. `features/consultation/draft-saver.ts` (no React; injected clock and transport): `update(fields)`, `blur()`, `hidden()`, `online()`,
   `flush(): Promise<Result>`, state `{saveState, savedAt, version, dirtyFields, conflict}`; R-4 timing, single flight, id per attempt bound to its
   payload, one retry with the same id, offline handling. `features/consultation/draft-rebase.ts`: pure `rebaseDraft(base, mine, theirs)` returning the
   merged draft and the overlapping fields (deep, key-order-independent equality). `use-consult-draft.ts` binds the saver to the workspace, registers
   `beforeunload` only while dirty or saving, saves on `visibilitychange` hidden and `pagehide`, and exposes `saveStatusProps`. `draft-conflict-dialog.tsx`
   is the R-5 AlertDialog. The workspace sends dirty fields only; the vitals editor, complaints, notes, specialty data, investigations, advice,
   specialty select and follow-up all go through the saver; "Save draft" and Ctrl/Cmd+S call `flush()`; `SaveStatus` replaces the hand-made status.
   `FinalizeAmendmentDialog.onBeforeFinalize` and Sign & Bill's `onSaveDraftBeforeSign` await `flush()` and stop on a failed or conflicting save.
5. Specs. `draft-save-rpc.spec.ts` (shared command rules) plus: only the keys present are written; version +1 per save; a stale version gives
   `DRAFT_CONFLICT` and the row is unchanged; two parallel saves with the same expected version give one success and one `DRAFT_CONFLICT`; a
   fault after the notes write leaves notes, follow-up, version and audit untouched; follow-up upsert, change and delete keep one row per visit;
   a `waiting` visit is started once (audit `visit.consultation_start`), a replay starts nothing; owner and doctor allowed; nurse, receptionist,
   admin refused; another clinic `NOT_FOUND`; sealed, unsigned completed and cancelled give `DRAFT_LOCKED` with rows unchanged; amending is
   allowed; vitals attribution (unchanged measurements keep the nurse as recorder, changed ones record the doctor); a vitals write through
   `recordVisitVitals` raises the version (so the doctor's stale save conflicts at the database). `draft-saver.spec.ts` (fake clock, at least 15
   cases: 5 s maximum wait, blur, hidden, single flight, edits during a save, retry with the same id after a timeout, no second retry, offline then
   online, a late answer of a timed-out attempt ignored, conflict hand-off, flush ordering). `draft-rebase.spec.ts` (table of at least 20 cases:
   disjoint, same change both sides, overlap per field type, nested objects, arrays, follow-up null versus set). pgTAP `consult_draft_save.test.sql`:
   column default and CHECK, the bump on every path (authenticated, service_role, postgres; a caller value ignored), trigger order with the seal
   guard (a sealed row is refused and keeps its version), the column grant (`has_column_privilege`), the follow-up uniqueness, command grants and
   the definer registry. `draft-persistence.spec.ts` adds: two pages of the same doctor on one consult, overlapping note edits show the dialog and
   both choices end in the expected database row (one `conflict_overwrite` audit row for "Keep mine"); disjoint edits (advice in one, note in the
   other) merge with no dialog; a nurse records vitals on Today while the doctor types a note and both survive with the nurse as vitals
   recorder; offline (`context.setOffline`) shows the offline state, keeps the text and saves after reconnecting; spec 7 leg (`commit-then-abort.ts`
   on the draft-save action): one abort is retried and the version rises once; aborting every attempt shows "Couldn't save · Retry", and Retry
   after clearing the route raises it once; `beforeunload` fires a dialog only while dirty. `05-cache-audit.spec.ts`: after typing a note,
   localStorage, sessionStorage, IndexedDB and Cache Storage hold no part of it.
6. Fallout and registries. Grep hits: callers of the old action signature (`sealed-refusal-messages`, `workspace-review-fixes`, `integration/consultation-flow`,
   `integration/consultation-service-guards`, `security/review-fixes-app`, guard manifests and valid inputs) move to the new input; pgTAP files that compare
   whole `clinical_notes` rows or amendment snapshots (`amendment_snapshot`, `clinical_notes`, `clinical_seal`) accept the new column; fixtures that wrote notes
   or follow-ups with a JWT client follow the shared rule. `no-client-command-chains.spec.ts` covers `components/consultation` for the removed writers and
   registers the v1 Repeat Rx loop as a named exception with owner V2-09c. Latency: add `save_consultation_draft` to the script and record p95.
   Schema snapshot, `db:types`, `authz:gen`, `EXPECTED_MIGRATION`, pgTAP FLOOR and REQUIRED_FILES, Vitest REQUIRED_FILES.

Tests: pgTAP `consult_draft_save` plus the changed files, full `npm run test:pgtap` (a trigger and grants on a clinical table change);
Vitest `tests/consultation tests/clinical tests/integration tests/security tests/visits tests/today tests/audit tests/authz tests/commands tests/ci`.
E2E lane: `npm run e2e:build`, then `npx playwright test tests/e2e/consult tests/e2e/m0/consult-rx-finish.spec.ts tests/e2e/a11y/amendment-screens.spec.ts tests/e2e/a11y/sign-and-bill-screens.spec.ts tests/e2e/pwa/05-cache-audit.spec.ts tests/e2e/pwa/13-idempotent-retry.spec.ts --project=desktop-chrome --project=pixel-7`.
Done: the above green with no retry; the tracer's fails-without proof and the conflict spec's fails-without proof (run against 000111) recorded;
`save_consultation_draft` p95 under 150 ms; writer inventory and grep hits in the notes.

### 09B-02a Workspace frame: regions, sections, sealed contract, Sign & Bill sheet, cut-over · M-L · no migration

Goal: R-6 to R-8. The consult has the V2-DX structure at every width with the existing section bodies inside it, the V2-09a contract
intact, Sign & Bill on a real sheet, and the v1 workspace, scribe entry and LLM catch-up gone.

Files: `app/(dashboard)/consultation/[id]/{page.tsx,loading.tsx}`; new `components/consultation/workspace/{consult-workspace.tsx,consult-top-bar.tsx,allergy-strip.tsx,consult-section.tsx,section-strip.tsx,finish-bar.tsx,amending-banner.tsx}`;
`components/consultation/{chief-complaints-section.tsx,diagnosis-section.tsx,vitals-block.tsx,amendment-modal.tsx,finalize-amendment-dialog.tsx,sign-and-bill-modal.tsx}` (hosting and sheet
only); deleted `components/consultation/{consultation-workspace.tsx,ai-scribe-modal.tsx}`; `features/consultation/record-state.ts` (unchanged API);
`tests/consultation/{workspace-sealed,workspace-review-fixes}.spec.ts` (re-pointed); new `tests/e2e/consult/workspace-layout.spec.ts`, new
`tests/e2e/a11y/consult-screens.spec.ts`; `tests/e2e/{m0/consult-rx-finish,a11y/amendment-screens,a11y/sign-and-bill-screens,a11y/clinical-split-screens}.spec.ts`
(selectors); `tests/e2e/design/screens/*` routes if they capture the consult.

1. v1 behaviour inventory first (M4 criterion 1) in `09B-NOTES.md`, from V2-DX-R2-V1-CONSULT-ANALYSIS §3 and the current file: every capability gets a new
   home (and the plan that builds it), a test, or an approved removal. Removals named now: the v1 scribe (C37, V2-12), the LLM catch-up (replaced by the
   snapshot in 09B-04a; until then the patient column shows the last visit from `pastEncounters`), the header specialty select (exam template tiles,
   09B-03), the hand-made autosave text (SaveStatus). Repeat Rx and Copy notes move with the history list (09B-02b).
2. Frame. `consult-workspace.tsx` owns the record state, the draft hook of 09B-01, the section refs and the dialogs; top bar per R-7 (Back to My queue
   → `/today?mode=doctor`, TokenChip, compact `PatientIdentityHeader`, SaveStatus, signed chip or amending state, Amend, "Finish visit"); `allergy-strip.tsx`
   wraps `AllergyBanner` sticky under the top bar at every width (also on sealed records); `consult-section.tsx` renders the label column (title-3 plus
   a one-line summary) and the body with `id`, heading focus target and Alt shortcut; the five sections host today's bodies (complaints and notes,
   vitals line plus specialty panels, diagnosis, the Rx builder unchanged, plan: investigations, advice, follow-up, referral, attach placeholder
   for 09B-05); below 768 the section strip (follows the scroll, counts) and the Finish bar. No card stack; hairlines between sections.
3. Contract (R-6). Port the read-only and action logic exactly: `readOnly` for sealed, unsigned completed and cancelled; every input disabled, notes
   `readOnly`; Amend for `canAmend`; `amending-banner.tsx` (`Banner` tone `past-due`, `role="status"`, "(v{n} to v{n+1}): {reason} · opened {clinic date}");
   Save draft and Finalize amendment while amending; no Complete and Sign there; focus after Amend and Finalize; editor remount keys. The two 09A unit
   specs are re-pointed at the new component with their assertions unchanged.
4. Sign & Bill (R-8). Move `sign-and-bill-modal.tsx` onto `ResponsiveSheet` (bottom drawer below 768, right sheet above) with the same props, commands
   and copy; its hand-rolled `role="dialog"` and scroll lock go. "Finish visit" flushes the draft first.
5. Cut-over. The page builds the new props (adds `draft_version`, the assist entitlements map for later plans, the signed `opened` time of the open
   revision). Delete the v1 workspace and `ai-scribe-modal.tsx` with their waivers (none today) and component specs; `generateSoapAction` and
   `lib/ai/soap-generator.ts` stay untouched for V2-12 (no UI entry remains). `loading.tsx` becomes a skeleton of the new regions.
6. Specs. `workspace-layout.spec.ts` (desktop-chrome, pixel-7, iphone-15 golden): at 360 the section strip, Finish bar and allergy strip are visible
   and no BottomBar; the allergy strip is still on screen after scrolling to Plan at 360 and 1280; Alt+1 to Alt+5 move focus to the section headings;
   no horizontal scroll at 360, 375, 744, 800, 820, 1180; every interactive control in the frame is at least 44 px below 1024. `consult-screens.spec.ts`:
   axe zero serious or critical on the whole page, with no M0 baseline allowance, at 360, 820, 1180, 1280 for draft, sealed and amending, plus the
   Sign & Bill sheet open. 09A e2e specs: selectors only, same assertions.

Tests: Vitest `tests/consultation tests/components tests/design tests/ci tests/security` (affected), plus the ported specs.
E2E lane: `npm run e2e:build`, `npx playwright test tests/e2e/consult tests/e2e/m0/consult-rx-finish.spec.ts tests/e2e/a11y/amendment-screens.spec.ts tests/e2e/a11y/sign-and-bill-screens.spec.ts tests/e2e/a11y/consult-screens.spec.ts tests/e2e/a11y/clinical-split-screens.spec.ts tests/e2e/journeys --project=desktop-chrome --project=pixel-7 --project=iphone-15`.
Done: the lane green with no retry; no reference to the deleted components remains (grep in the notes); the inventory table complete; the waiver
file did not grow; `ci:ui-policy`, `ci:ai-l1` clean.
Split point: if the frame and contract (steps 2 and 3) consume the session, step 4 (Sign & Bill sheet) moves into 09B-02b; it stays in this phase.

### 09B-02b Context panes, history, shortcuts, tablet layouts · M · no migration

Goal: R-7 complete and PWA-03b. The patient's context is always one glance or one tap away, and the tablet layouts match the approved prototype.

Files: new `components/consultation/workspace/{patient-column.tsx,patient-sheet.tsx,summary-pane.tsx,history-list.tsx,use-consult-shortcuts.ts}`; deleted
`components/consultation/patient-history-drawer.tsx`; `consult-workspace.tsx`, `consult-top-bar.tsx`; `lib/pwa/device-prefs.ts` (reuse only);
`tests/e2e/consult/workspace-layout.spec.ts` (extended); new `tests/e2e/consult/tablet-captures.spec.ts`; `tests/consultation/consult-shortcuts.spec.ts`.

1. `patient-column.tsx` (1180 and up; scrolls on its own): identity, vitals grid (three columns, value 14/600 tabular, flagged value with "· high" when
   `assist.vitals`, from `lib/clinical/vitals.ts`), allergies, problems (chronic conditions), last visit, history (`history-list.tsx`: past encounters
   with Repeat Rx and Copy notes moved from the drawer; Repeat Rx keeps its v1 behaviour until V2-09c's one-command repeat, registered exception of
   09B-01). `patient-sheet.tsx`: the same content in a `ResponsiveSheet` from the "Patient" button at 768 to 1179 and from the Finish bar below 768.
2. `summary-pane.tsx` (1280 and up): a read-only rendering of the current in-memory draft as the patient will see it (complaints, findings, diagnoses,
   Rx lines, investigations, advice, follow-up date in the clinic zone); "Summary" toggle with `aria-pressed`; closed by default at 1280 to 1439, open
   from 1440; at 360 it opens as a drawer.
3. Shortcuts (`use-consult-shortcuts.ts`): Alt+1 to Alt+5 always; M (focus the medicine search), F (Finish visit), `/` (reserved for 09B-04b) only when
   `clinicos.pref.shortcuts` is on and focus is not in a field; the existing `?` sheet lists them. Unit spec with a fake document.
4. Tablet and desktop (PWA-03b): `tablet-captures.spec.ts` writes captures of draft and amending at 360, 744, 820, 1180, 1280, 1440 into
   `.planning/phases/09B-consult-workspace/evidence/screens/` next to the references in `.planning/sketches/v2-dx-evidence/screens/consult*/`; structural
   assertions per width (which panes exist, label column width, summary state). Run once on the nightly tablet projects.
5. Route weight: `npm run ci:route-js` reports `/consultation/[id]` under 200 kB gz; the number goes in the notes.

Tests: Vitest `tests/consultation tests/components tests/pwa`; e2e as above.
E2E lane: `npm run e2e:build`, `npx playwright test tests/e2e/consult tests/e2e/a11y/consult-screens.spec.ts --project=desktop-chrome --project=pixel-7 --project=iphone-15`, plus once `npx playwright test tests/e2e/consult/tablet-captures.spec.ts tests/e2e/consult/workspace-layout.spec.ts --project=ipad-mini-744 --project=android-tablet-800 --project=ipad-gen7 --project=ipad-gen7-landscape --project=galaxy-tab-s4-landscape`.
Done: captures written; the drawer deleted; route budget met; lanes green with no retry.

### 09B-03 Tap-first entry: complaints, exam templates, plan tiles, learned order · M-L · migration 000113_consult_assist_context

Goal: R-9 and R-12. Complaints, an exam template with an abnormal finding, investigations, advice and a follow-up are entered by taps, in the
order this doctor usually needs them.

Files: `supabase/migrations/000113_consult_assist_context.sql`; new `supabase/tests/database/consult_assist_context.test.sql`; new
`features/consultation/{catalogue.ts,exam-templates.ts,exam-text.ts,assist-ranking.ts}`; `features/consultation/schema.ts` (optional `exam` on the GP
schema; `follow_up.interval` gains `1_month`); `features/consultation/service.ts` (`getConsultAssistContext`); new
`components/consultation/workspace/sections/{complaints-section.tsx,examination-section.tsx,plan-section.tsx}`; `components/consultation/chief-complaints-section.tsx`
and `specialty/gp-systemic-review.tsx` (replaced or reduced to what the new sections reuse); `app/(dashboard)/consultation/[id]/page.tsx`;
new `tests/consultation/{exam-text,assist-ranking,catalogue}.spec.ts`, new `tests/e2e/consult/tap-entry.spec.ts`.

1. Catalogue and templates per R-9 (strings copied verbatim; the notes list their source line). `exam-text.ts`: pure mapping of `exam` to the
   `systemic` texts ("Normal: …" or "Abnormal: Crepts (Right) · note") and `general_exam` booleans; a unit table covers every template, side and note.
2. Sections. Complaints: tiles (ChipGroup `tile` variant) for the ranked list, duration option pills per added complaint, severity not added,
   per-complaint note kept, free entry of a new complaint name. Examination: vitals line (with "Edit vitals" opening the existing vitals editor),
   template tiles ranked by the complaints present, per system a Normal/Abnormal SegmentedControl, finding tiles, side for RS, a note; general signs
   tiles; Dental and Child switch to the existing odontogram and paediatrics tools (AlertDialog when data would be lost). Plan: investigation and
   advice tiles with free add, follow-up interval tiles with the clinic-date hint ("Tue, 24 Nov · the front desk books it when you finish"), referral
   and attach entries. Every change goes through the draft saver.
3. Migration 000113: `public.consult_assist_context(p_tenant_id uuid)` per R-12 (the caller is the doctor: `auth.uid()`; signed visits only; limit 300
   by `signed_at DESC`; names and counts only); EXECUTE for authenticated only. Measure on the synthetic seed of R-18; add a partial index on
   `visits (tenant_id, doctor_id, signed_at DESC) WHERE signed_at IS NOT NULL` only if the plan shows a sequential scan (expand-safe), and say so.
4. `assist-ranking.ts` (pure): ranked complaints (the doctor's frequency, then co-occurrence with those already added, then the catalogue order),
   ranked templates (complaint match, then the last used), plan tiles ("usual for {diagnosis} first" when a diagnosis is present), the follow-up
   "your usual for {diagnosis}". Smart Assist label only where ranking is shown as a suggestion (likely, usual). Not entitled to
   `assist.terminology`: catalogue order, no label.
5. Specs. pgTAP `consult_assist_context.test.sql`: a doctor sees only their own signed visits' aggregates; another doctor of the same clinic gets their
   own; nurse, receptionist and admin get nothing; another clinic gets nothing; unsigned and cancelled visits are not counted; no column of the
   output carries an id. Vitest ranking tables (at least 15 cases) and catalogue integrity (no duplicates, every template system has a normal text).
   `tap-entry.spec.ts` with the `ux` counter: three complaints with durations in at most 3 taps and 0 typed characters; a template with one abnormal
   finding in at most 3 taps and 0 typed; a follow-up in 1 tap; after a refresh the database holds the complaints, the `exam` object, the mirrored
   `systemic` text and the follow-up date; with `assist.terminology` switched off by a platform override the tiles show in catalogue order without
   a label.

Tests: pgTAP `consult_assist_context`, `grants`; Vitest `tests/consultation tests/components tests/ci`.
E2E lane: `npm run e2e:build`, `npx playwright test tests/e2e/consult tests/e2e/a11y/consult-screens.spec.ts --project=desktop-chrome --project=pixel-7`.
Done: targets met in the `ux` JSON (copied to evidence at the close); read p95 recorded; the lane green.

### 09B-04a Smart Assist read side: diagnosis search, likely diagnoses, patient snapshot, open amendments · M-L · migration 000114_diagnosis_search_snapshot

Goal: R-11, R-13 and the 08 and 09A hand-offs. The diagnosis needed is one tap or a few typed letters away; the patient's history is a
deterministic snapshot on the consult and on Today; a doctor sees their open amendments.

Files: `supabase/migrations/000114_diagnosis_search_snapshot.sql`; new `supabase/tests/database/diagnosis_search_snapshot.test.sql`; new
`app/api/terminology/diagnoses/route.ts`; new `features/terminology/abbreviations.ts`; `features/terminology/{service.ts,actions.ts,schema.ts}`;
new `features/consultation/snapshot.ts`; new `components/consultation/workspace/sections/diagnosis-section.tsx` (replaces `components/consultation/diagnosis-section.tsx`
and its waiver); `components/consultation/workspace/patient-column.tsx`; `components/today/{doctor-mode.tsx,next-patient-card.tsx}` and new
`components/today/patient-snapshot-panel.tsx`, `components/today/open-amendments.tsx`; the Today page loader; deleted
`components/consultation/returning-patient-catchup.tsx`, `getPatientCatchUpSummaryAction` (in `features/ai/actions.ts`), `lib/ai/catch-up-summary.ts` and its
export; `scripts/ci/ai-l1-greps.mjs` and `scripts/ci/react-compiler-waivers.json` (entries removed); new `tests/terminology/diagnosis-search.spec.ts`,
`tests/terminology/diagnosis-search-route.spec.ts`, `tests/consultation/snapshot.spec.ts`; `tests/e2e/consult/smart-assist.spec.ts`; `tests/e2e/today/*` (doctor mode).

1. Migration 000114: `public.search_diagnoses` (R-11) and `public.patient_snapshot` (R-13), both INVOKER STABLE, EXECUTE authenticated only.
   No new index unless the measurement on 2,000 synthetic rows misses the R-18 target (the name trigram index exists; synonyms are scanned).
2. Search. `features/terminology/abbreviations.ts` (the table and an `expandQuery` pure function, also used by 09B-04b); the service calls the RPC
   with the expanded terms (plain terms only when not entitled); `GET /api/terminology/diagnoses` follows the `GET /api/patients/search` pattern
   (session context with `consultations:view`, fixed error bodies, 401/403/503/500 mapping, `private, no-store`, exact response keys); the
   `searchDiagnoses` server action is deleted with its guard-manifest row. The new diagnosis section: "Likely from the complaints" (Smart Assist,
   from 09B-03's context), "Your recent", the specialty's fixed chips as the fallback, and a Combobox fed by the route with abort on each keystroke
   (debounce 200 ms); add, remove and note keep the existing actions and their sealed-refusal texts; no React Compiler waiver.
3. Snapshot. `features/consultation/snapshot.ts` maps the RPC to the template rendered in the patient column ("Last seen 12 Oct · Dr Rao",
   diagnoses, Rx lines, "Due follow-up 3 Nov (no visit since)", last vitals with flags) and in `patient-snapshot-panel.tsx` beside the Next card on
   Today doctor mode at 768 px and up, gated by `assist.snapshot` (hidden otherwise; the plain last-visit block stays in the column). Delete the LLM
   catch-up files and update the L1 labelled-file lists.
4. Open amendments: Today doctor mode shows "Open amendments (n)" for the doctor's own signed visits currently reopened (`signed_at IS NOT NULL AND
   status = 'in_consultation'`), each linking to its consult with "opened {date}"; read under RLS in the Today loader.
5. Specs. pgTAP `diagnosis_search_snapshot.test.sql`: search returns the caller's own custom diagnoses first, never another doctor's or clinic's custom
   rows, escapes `%` and `_`; snapshot counts only signed visits, excludes the current one, returns nothing to roles without `consultations:view` and
   nothing across clinics. `diagnosis-search.spec.ts` ranking table (at least 20 cases: abbreviations HTN, T2DM, URTI, AGE; synonyms; a one-letter typo
   through trigram; prefix before infix; custom first; "ICD-11" label; specialty filter; not entitled gives plain matches only). Route spec: 401, 403
   for receptionist, 403 locked, keys exactly as listed, `no-store`. `snapshot.spec.ts` (DB): the A3 defect is gone (a booked and a waiting visit are not
   history), overdue follow-up rule, flags only when entitled. `smart-assist.spec.ts`: with seeded history the likely tile adds the diagnosis in 1 tap;
   typing "htn" finds the hypertension entry; the snapshot shows on the consult and on Today doctor mode at 820; the open amendment appears on Today;
   every check runs with AI fully disabled (the e2e server has no provider env, and the spec turns the `ai_features` kill switch on first).
   Latency: the two reads join `command-latency.json` (p95 under 50 ms).

Tests: pgTAP `diagnosis_search_snapshot`, `grants`; Vitest `tests/terminology tests/consultation tests/today tests/ai tests/security tests/ci tests/design`.
E2E lane: `npm run e2e:build`, `npx playwright test tests/e2e/consult tests/e2e/today --project=desktop-chrome --project=pixel-7`.
Done: the diagnosis-section waiver gone; no catch-up code remains (grep); the lane green with no retry.

### 09B-04b Smart Assist write side: shorthand with doctor macros, follow-up proposal · M · migration 000115_doctor_text_macros

Goal: R-14 and R-15. A doctor who types can write "c/o fever 3d, cough 2d; adv steam inhalation BD; f/u 5d" and insert exactly that into the
right sections; a follow-up in the advice becomes a proposed appointment that the doctor or the front desk confirms.

Files: `supabase/migrations/000115_doctor_text_macros.sql`; new `supabase/tests/database/doctor_text_macros.test.sql`; new
`features/consultation/{shorthand.ts,macros-service.ts,macros-actions.ts}` (or the existing service and actions files, executor's choice, one module
per concern); `features/consultation/schema.ts` (complaint duration optional; macro schemas); readers of `duration_val`
(`features/prescriptions/pdf/prescription-document.tsx`, the complaints section, the history list) print a duration only when present; new
`components/consultation/workspace/{command-bar.tsx,macro-list.tsx,follow-up-suggestion.tsx}`; `components/consultation/workspace/sections/plan-section.tsx`;
`components/today/{today-row.tsx,use-row-commands.ts}` or the row menu for "Book follow-up"; new `tests/consultation/shorthand.spec.ts`,
`tests/consultation/macros.spec.ts`; `tests/e2e/consult/smart-assist.spec.ts` (extended); `tests/e2e/today/*` (receptionist leg).

1. Migration 000115: `public.doctor_text_macros` (R-14 columns, CHECKs, unique `(tenant_id, doctor_id, shortcut)`, composite FK to the tenant), RLS
   enabled with SELECT, INSERT, UPDATE, DELETE policies `tenant_id IN (SELECT authz.tenant_ids_with('consultations:edit')) AND doctor_id = auth.uid()`,
   a BEFORE INSERT trigger that sets `doctor_id = auth.uid()` and refuses the 201st macro, grants to `authenticated` only; registries, `authz:gen`.
2. Parser per R-14, with the property test: 500 generated inputs built from words, markers, abbreviations and macros; every output word is
   accounted for; no default value is produced. Fixed tables live next to the parser (frequency words) and in `abbreviations.ts`.
3. Command bar (`/` or the "Shorthand" button in the note; gated `assist.shorthand`): input, live preview grouped by Complaints, Notes, Advice,
   Follow-up, each item listed with its section; Enter or "Insert" applies through the draft saver (one save); Escape closes; it also lists matching
   macros (`.ur…`). `macro-list.tsx`: add, edit and delete the doctor's macros in a `ResponsiveSheet`. Hidden when the record is read-only.
4. Follow-up proposal per R-15 (gated `assist.followup`): `follow-up-suggestion.tsx` in Plan; "Book follow-up" in Plan and on Today rows in To bill or
   Done for the front desk, opening the booking sheet with patient, doctor and date; the read for "already booked" uses the visits the Today loader
   already reads plus one query for future visits of those patients.
5. Specs. `shorthand.spec.ts`: a table of at least 30 inputs with exact outputs (markers, durations, abbreviation expansion, unknown segments,
   macros, empty segments, mixed case, Devanagari text passed through untouched) plus the property test. `macros.spec.ts` (DB): own macros only,
   another doctor and another clinic see nothing, nurse refused, the 201st refused, shortcut shape refused. pgTAP `doctor_text_macros.test.sql`: the
   policy matrix per role, grants, the trigger. `smart-assist.spec.ts` adds: the shorthand above lands in Complaints (Fever 3 days, Cough 2 days),
   Advice ("steam inhalation twice daily") and the follow-up (5 days) and nothing else, with the `ux` count; a macro expands; a follow-up phrase in
   advice yields the chip, the tap sets the date, "Book follow-up" opens the booking sheet with the date and a preselected slot and booking creates
   one visit; as the receptionist the Today row offers "Book follow-up" and hides it after booking; no message row is enqueued for a follow-up that
   is not booked (DB assertion); with `assist.shorthand` and `assist.followup` overridden off the bar and the chip are absent.

Tests: pgTAP `doctor_text_macros`, `grants`, `authz_matrix` (regenerated), full `npm run test:pgtap` (a new tenant table and policies);
Vitest `tests/consultation tests/today tests/prescriptions tests/security tests/authz tests/ci`.
E2E lane: `npm run e2e:build`, `npx playwright test tests/e2e/consult tests/e2e/today tests/e2e/schedule --project=desktop-chrome --project=pixel-7`.
Done: the property test and tables green; the lane green with no retry; the PDF still renders complaints with durations as before (existing PDF specs).

### 09B-05 Upload dropzone, consult journey, accessibility pass, PO kit · M · no migration

Goal: R-16, the consult journey (Q-1) and the M4 template's remaining proofs; the material the PO needs for the walkthrough.

Files: new `components/ui/file-drop.tsx`; `features/labs/{service.ts,utils.ts}` (export the type and size constants once); new
`components/consultation/workspace/attachments.tsx`; `components/consultation/workspace/{sections/plan-section.tsx,patient-column.tsx}`; new
`tests/components/file-drop.spec.ts`; new `tests/e2e/consult/upload.spec.ts`; new `tests/e2e/journeys/journey-06-consult.spec.ts`; new
`tests/e2e/consult/keyboard-golden.spec.ts`; `tests/e2e/a11y/consult-screens.spec.ts` (upload states);
`.planning/phases/09B-consult-workspace/{09B-PO-WALKTHROUGH.md,09B-DEVICE-CHECKLIST.md}` (written by a Haiku docs agent from this plan).

1. `FileDrop` per R-16: drop zone and picker (keyboard reachable, label, `aria-describedby` with the limits), multiple files, the client check before
   any upload with the same texts as the server, per-file status rows with Retry, never a no-op; no `capture` attribute yet (V2-09c).
2. `attachments.tsx`: uploads each file through `uploadLabDocument` with `patient_id`, `visit_id`, a title from the file name and the clinic date;
   lists this visit's documents (Plan) and the patient's recent documents (patient column "Documents") with an Open action through
   `getDocumentSignedUrl`; disabled with a reason when the record is read-only or the role lacks `labs:edit`.
3. Specs. `file-drop.spec.ts` (DOM): a 26 MB file and an `.exe` are refused before any request; status transitions; Retry re-sends only the failed
   file. `upload.spec.ts`: a PDF and a JPEG uploaded from the consult are stored (row with this `visit_id`, object at its id key) and listed; the
   list survives a refresh and appears on the patient's documents; a failed upload (route abort) shows Retry and Retry stores exactly one row; the
   sealed consult shows the list and no drop zone; storage audit: no file bytes left in Cache Storage or IndexedDB.
4. `journey-06-consult.spec.ts` (desktop-chrome, pixel-7, iphone-15 golden, axe on each screen): the doctor opens the consult from Today, enters
   complaints and an exam by taps, adds a diagnosis from the likely tile, adds two medicines with the existing builder, uploads a report, waits for
   "Saved", finishes through Sign & Bill (fee to reception), sees the sealed read-only record, downloads the Rx PDF (`%PDF-`, hash equals the stored
   one), amends with a reason and finalizes (V2-09a's tail stays in `consult-rx-finish.spec.ts`). `keyboard-golden.spec.ts`: the same consult up to the
   diagnosis with the keyboard only (Alt+1 to Alt+5, Tab, Enter, Space, the command bar); the Rx line by keyboard is V2-09c's.
5. PO kit: `09B-PO-WALKTHROUGH.md` (a 10-minute script: tap entry, shorthand, conflict in two tabs, kill the app mid-note, upload, amend) and
   `09B-DEVICE-CHECKLIST.md` (the consult on a low-end Android phone and a tablet: kill the installed app mid-note and reopen, the keyboard over the
   note, the Patient sheet, the upload from the file picker, TalkBack and VoiceOver on the consult). PO-ACTIONS entries are added at the close.

Tests: Vitest `tests/components tests/labs tests/consultation tests/ci`.
E2E lane: `npm run e2e:build`, then `npm run e2e:pr` once (the phase's full PR lane), and `npx playwright test tests/e2e/consult --project=ipad-gen7 --project=android-tablet-800` once.
Done: the PR lane green with no retry; the journey at phone and desktop; the PO files written.

### Close (docs by Haiku, reviews, evidence)

1. Reviews, fresh context, given the phase diff and this plan's rulings only. Isolated reviewer (Sonnet): UI-SPEC §7 per width against the captures,
   the V2-09a contract (diff of the read-only and action logic against the deleted workspace), a11y and keyboard paths, the v1 behaviour inventory,
   M4 criteria 1 to 8, Smart Assist labelling and "never inserts without a tap", tests that assert outcomes. Adversarial reviewer (Opus): the draft
   command (tenant and permission checks, sealed bypass through a patch, version forging or rollback, a stale save racing sign-off or finalize, replay
   and mismatch, fault injection, patch size and key abuse, the start step), the grant narrowing (any remaining direct write of notes or follow-ups),
   the three INVOKER reads (cross-tenant, another doctor's aggregates, identifiers leaking through names or counts), the macros table RLS and the
   insert trigger, the search route (injection through the terms array, wildcard abuse, keys), the upload path (type spoofing, size, cross-visit or
   cross-patient `visit_id`), the in-memory buffer and storage audit (PHI on the device), the `beforeunload` and `pagehide` paths. One fix round
   (09B-06a): Highs and Mediums fixed with a test that fails without the fix; Lows to the backlog with an owner; Highs re-checked once.
2. Evidence (R-18): `node scripts/phase-evidence.mjs .planning/phases/09B-consult-workspace/evidence 1`; push; CI green with 0 retried tests; then
   `node scripts/phase-evidence.mjs .planning/phases/09B-consult-workspace/evidence --ci-run <id>`; copy `command-latency.json` (re-run if the fix round touched
   the command or a read), the `ux` count files, the axe summary and the captures into `evidence/`; the Vitest FLOOR re-measured once with the arithmetic in
   the gate header.
3. Docs (Haiku): `09B-SUMMARY.md`, `09B-VERIFICATION.md` (numbers copied from the tool files), roadmap V2-09b status line, the FRONTEND_MIGRATION_PLAN
   appendix "v2 measured" column from the `ux` JSON, VERIFICATION_LOG entry with the CI link and SHA, `.planning/ROADMAP.md`. PO-ACTIONS: `09B-P1` gate
   (delegated if in force), `09B-P2` walkthrough and device run (the two files, about 30 minutes), `09B-P3` staging migrate of 000112 to 000115 after merge
   (not delegated), `09B-P4` acknowledgement of Q-3, Q-5 and Q-7. No architecture erratum is proposed (TARGET §3.9 kept, Q-3).
4. Gate: approved by delegation if in force, with the CI run recorded (0 retried tests); otherwise the PO approves. The PO is informed either way.

## Acceptance mapping (roadmap §12 V2-09b, the M4 template and the hand-offs)

| Criterion | Proof |
|---|---|
| Kill the tab mid-note: restored up to the last server autosave (≤ 5 s), no PHI on the device (roadmap 1, PWA D3) | `draft-persistence.spec.ts` (clock-controlled kill test, continuous-typing save cadence), `05-cache-audit.spec.ts` after typing, `draft-saver.spec.ts` timing cases |
| A concurrent edit shows a conflict prompt (roadmap 2, M4.4) | `draft-persistence.spec.ts` two-page cases (overlap prompt with both choices, disjoint merge, nurse vitals), `draft-save-rpc.spec.ts` stale version and parallel saves (conflict DB test), pgTAP `consult_draft_save`, `draft-rebase.spec.ts` |
| An upload in the consult is stored and listed (roadmap 3, P1-24) | `upload.spec.ts` (row, object, list, refresh, patient documents, retry once), `file-drop.spec.ts`, journey 6 |
| Each Smart Assist feature works with AI fully disabled (roadmap 4) | `smart-assist.spec.ts` with the kill switch on and no provider env (search, likely tiles, snapshot, shorthand, macros, follow-up); DB and unit specs per feature; overrides off hide each one |
| The PO completes a walkthrough (roadmap 5) | `09B-P2` with `09B-PO-WALKTHROUGH.md` (PO action) |
| Tests named by the roadmap: consult journey at both viewports, save-model unit tests, conflict DB test | `journey-06-consult.spec.ts` (desktop-chrome, pixel-7, iphone-15), `draft-saver`, `draft-rebase`, `draft-save-rpc` |
| M4 1 functional parity | v1 behaviour inventory in `09B-NOTES.md` (09B-02a), each row with a test, a plan or an approved removal; the 09A and M0 consult specs keep their assertions |
| M4 2 interaction targets | `ux` JSON: three complaints ≤ 3 taps, 0 typed; template plus one abnormal finding ≤ 3 taps, 0 typed; likely diagnosis 1 tap; follow-up 1 tap; shorthand insert = typing + 2 keys. Rx by keyboard and the whole-consult 10 taps are V2-09c's (Q-12) |
| M4 3 accessibility | `consult-screens.spec.ts` (whole page, no baseline allowance, 360/820/1180/1280, draft, sealed, amending, Sign & Bill sheet, upload states), `keyboard-golden.spec.ts`, TalkBack and VoiceOver in `09B-P2` |
| M4 4 responsive | `workspace-layout.spec.ts` on the PR projects and once on the tablet projects; captures at 360, 744, 820, 1180, 1280, 1440 next to the V2-DX references |
| M4 5 resilience | offline and abort cases plus the spec 7 draft leg in `draft-persistence.spec.ts`; `upload.spec.ts` retry; double submit = replay (`draft-save-rpc.spec.ts`) |
| M4 6 performance | `npm run ci:route-js`: `/consultation/[id]` under 200 kB gz (notes); command and read p95 in `command-latency.json` |
| M4 7 data integrity | one command per draft save (R-3); `no-client-command-chains.spec.ts` covers `components/consultation` with the Repeat Rx exception owned by V2-09c; the grant narrowing pgTAP |
| M4 8 observability | route `loading.tsx` and the dashboard error boundary report render errors (V2-06 capture); save failures logged by tag (`consultation.draft_save.failed`), never content |
| M4.4: amendment flow parity; AI suggestions marked until accepted; allergy banner always visible | 09A specs unchanged in assertions plus journey 6; R-10 grouping and the "never inserts without a tap" assertions; allergy strip assertions in `workspace-layout.spec.ts` |
| PWA-03b tablet two-pane consult | `tablet-captures.spec.ts` structural assertions and captures judged by the isolated reviewer; nightly tablet projects run once |
| PWA-06b | SaveStatus states, 15 s timeout and one retry with the same id (`draft-saver.spec.ts`), spec 7 leg |
| AI-07, AI-09, AI-10, AI-15, AI-16 | `diagnosis-search.spec.ts`, route spec, `shorthand.spec.ts` (table and property), `snapshot.spec.ts`, follow-up legs of `smart-assist.spec.ts`, flags gated by `assist.vitals` |
| V2-09a hand-offs | R-6; ported unit specs; amending banner "opened"; open amendments on Today (09B-04a); discard per Q-5 |
| V2-08 hand-off: doctor-mode snapshot panel | `patient-snapshot-panel.tsx`, `smart-assist.spec.ts` Today leg |
| V2-06 hand-offs: Sign & Bill on a sheet, consult axe debt, diagnosis-section waiver, tablet two-pane | 09B-02a step 4, `consult-screens.spec.ts`, waiver entry removed in 09B-04a, 09B-02b |
| Latency condition on definer commands | `save_consultation_draft` p95 under 150 ms in `command-latency.json` |
| Evidence | CI run link, axe summary, captures, `ux` JSON, `command-latency.json`, reviewer sign-offs (isolated and adversarial), PO walkthrough (PO) |

## Source audit

| Source | Items | Covered by |
|---|---|---|
| GOAL | doctors never lose consult work; the consult is keyboard-first | 09B-01 (save model), 09B-02a/02b (keyboard, layout), 09B-03 (tap entry), acceptance table |
| REQ | P1-32 workspace part: draft versioning, unload guard, explicit save state, conflict detection | 09B-01 |
| | P1-32 workspace part: two-pane workspace, templates | 09B-02a, 09B-02b, 09B-03 |
| | P1-24 in-consult upload dropzone | 09B-05 |
| | P1-42 consult journey | 09B-05 (journey 6, Q-1) |
| | AI-07 terminology | 09B-04a (search, route), 09B-03 (context for likely tiles) |
| | AI-09 shorthand and macros | 09B-04b |
| | AI-10 patient snapshot | 09B-04a |
| | AI-15 follow-up proposal | 09B-04b |
| | AI-16 vitals flags (help search: Q-15) | 09B-02b, 09B-04a |
| | PWA-03b two-pane consult | 09B-02a, 09B-02b |
| | PWA-06b consult | 09B-01 |
| RESEARCH (docs) | UI-SPEC §7 consult regions and widths; DESIGN §6.2 FileDrop and form behaviour, §6.9 save status, §7.1 compact header, §7.2 allergy states, §8 keyboard; PWA §3.8 and §4; AI §5.2, §5.3, §6.2 and AI-P3 acceptance; UX_AUDIT §5.7 save model; V2-DX counts A to C | R-4, R-7, R-9 to R-16; 09B-01 to 09B-05 |
| CONTEXT (rulings) | C37 (no scribe), PO-15 (no flags, delete v1), PO-21 and PO-22 (no AI sold; no clinician sign-off: no new clinical logic), ADR-0005, ADR-004, ADR-016, ADR-019, lean process, delegation 2026-11-21, V2-08 latency condition, TARGET §3.9 (actions for mutations, GET routes for typeahead) | R-1, R-3, R-9, R-12, R-17, R-18; Execution |
| Hand-offs | 09A: recordState, sealed read-only, two flows, banner tone, axe debt, discard, open amendments; 08: doctor-mode snapshot; 06: Sign & Bill sheet, axe debt, waiver, tablet two-pane, AI-16 | R-6, 09B-02a, 09B-04a, Q-5, Q-13 |
No item is unplanned. Items outside this phase are under Deferred.

## Threat register (STRIDE; security_enforcement on)

| ID | Cat. | Component | Sev. | Disposition | Mitigation |
|---|---|---|---|---|---|
| T-09B-01 | T | Lost update between two tabs, devices or the nurse's vitals path | high | mitigate | `draft_version` raised by a trigger on every write, compared under row locks in the command, `DRAFT_CONFLICT`, field rebase, prompt on overlap, `conflict_overwrite` audited; parallel-save and stale-save DB tests |
| T-09B-02 | E / T | `save_consultation_draft` (new definer command) | high | mitigate | V2-07 guard block (actor, active full clinic, consultations:edit), key allow-list, jsonb type and size checks, `DRAFT_LOCKED` before any write, 09A seal guards still fire for the definer body, catalog test, role matrix, cross-tenant case, fails-without proofs |
| T-09B-03 | T / R | Direct PostgREST writes of notes or follow-ups bypassing the command's audit | medium | mitigate | `UPDATE` on `clinical_notes` narrowed to `vitals`; follow-up writes revoked when no request path remains; pgTAP column privileges; the bump trigger catches any remaining writer |
| T-09B-04 | I | Clinical text on the device (draft buffer, caches) | high | mitigate | In-memory buffer only (R-4); no storage API used; `05-cache-audit` after typing; `hardSignOut` purge unchanged; documents opened by 5-minute signed links only |
| T-09B-05 | I | `consult_assist_context`, `patient_snapshot`, `search_diagnoses` | high | mitigate | INVOKER under RLS, tenant from the session and filtered, doctor scope `auth.uid()` for the context, names and counts only, roles without `consultations:view` get nothing; two-clinic and two-doctor pgTAP cases |
| T-09B-06 | T / I | `GET /api/terminology/diagnoses` | medium | mitigate | Session context and permission, parameterised RPC with escaped wildcards, fixed error bodies, exact response keys, `no-store`; rate limiting V2-12 (accepted until then, as T-08-02) |
| T-09B-07 | E / I | `doctor_text_macros` (new tenant table) | medium | mitigate | RLS to the owning doctor with consultations:edit, `doctor_id` set by trigger, unique and size CHECKs, 200-row cap, authz matrix and policy pgTAP; expansion text never logged |
| T-09B-08 | T / S | Upload from the consult | medium | mitigate / accept | Existing `uploadLabDocument` checks (labs:edit, patient and visit in the clinic, type, size, id key, `upsert: false`, append-only rows and objects since 09A); client checks are UX only. Residual: the type is the client-declared MIME type (no magic-byte check), owner V2-14 |
| T-09B-09 | Safety (T) | Shorthand or Smart Assist inventing clinical content | high | mitigate | Output-only-from-input invariant with a property test; no defaults; deterministic tables; suggestions inserted only by a tap; Smart Assist label; no LLM anywhere in this phase |
| T-09B-10 | R | Who changed the draft and when | low | mitigate | Command-only audit per save with fields changed, version and overwrite flag, in the same transaction |
| T-09B-11 | D | Autosave volume (audit and `command_results` rows; Today refresh) | low | accept | At most one save per 5 s per open consult; Today signals fire only on vitals and status changes (000102); purge of `command_results` V2-13 |
| T-09B-12 | D | A stalled autosave delays other server actions (Next action queue) | low | accept | Single flight, 15 s timeout, one retry; device run `09B-P2`; route-handler transport is Q-3 |
| T-09B-SC | T | npm installs | high | mitigate | No new package in this phase; any addition needs the package-legitimacy gate and a blocking human checkpoint |

## Risks

| Risk | Plan response |
|---|---|
| The rebuild drops a v1 capability or a V2-09a rule | Inventory first (09B-02a step 1); the 09A specs keep their assertions; the isolated reviewer diffs the read-only and action logic against the deleted file |
| The save model and the rebuild interact badly (two moving parts) | The save model lands first on the old screen (09B-01, tracer), so 09B-02a only re-hosts a proven hook |
| Grant narrowing breaks fixtures that wrote notes or follow-ups as a JWT user | Grep-first rule; fixtures move to the command or the service role on unsigned visits; pgTAP files that need the old grant widen it inside their own transaction, as 09A-06a did |
| The new column changes rows compared by existing specs (amendment snapshots, notes rows) | Grep hits listed in 09B-01 step 6; specs accept the column, intent unchanged |
| Server-action queue: a stalled autosave delays a diagnosis add | R-4 single flight and timeout; device run; Q-3 keeps the approved transport and records the alternative |
| Learned-ranking or search queries get slow on large histories | Limits (300 visits, 5 snapshot visits), measured p95 under 50 ms on a synthetic seed, an index only if measured |
| Exam template wording (clinical boilerplate) without clinician review | Copied verbatim from the approved V2-DX prototype, editable per visit, no diagnostic logic; PO acknowledges Q-7 |
| `opd_diagnoses` is empty outside the hosted project | Tests seed synthetic rows; loading the real catalogue into production is the existing PO-side seed step at V2-15 (recorded in the notes) |
| 09B-02a and 09B-03 are the largest plans | Split point in 09B-02a; 09B-03 may move the learned order (steps 3 and 4) into 09B-04a if the session runs out; each plan leaves the tree green |
| V2-09a's PR #15 changes guards or the workspace during its review | Merge forward before each plan; re-read the latest bodies and the 09A specs; renumber migrations |

## Deferred, with owner

| Item | Owner |
|---|---|
| Keyboard Rx builder, Rx favourites fix (AI-08), "your usual" Rx bundle and favourite tiles, "Same as last visit" (diagnosis and Rx) as one command replacing the Repeat Rx loop, medicine search on a GET route, the finish review sheet with print and WhatsApp defaults and the two-tap finish, the whole-consult 10-tap measurement, printing the structured exam on the Rx PDF, camera capture (PWA-12) with compression (FT-04), PDF preview onto Dialog, allergy check | V2-09c |
| Billing part of the Sign & Bill sheet (fee, discount, collect at the desk) | V2-10 |
| AI Scribe v2 with per-section accept, the top-bar AI Assist button, LLM "marked until accepted"; removal of the v1 scribe server code (`generateSoapAction`, `lib/ai/soap-generator.ts`, now without a UI entry) | V2-12 |
| Rate limiting of the diagnosis search route | V2-12 |
| Consult URL `/consultation/[id]` to `/visits/[id]/consult` with a permanent redirect (IA §3.4), together with `/visits` to `/records/visits`; macros management on a settings page | V2-11 |
| Discard of an open amendment (restore from the snapshot, re-seal without a new version) and the report of open amendments | V2-13 (Q-5) |
| `command_results` purge (autosave adds rows) | V2-13 (unchanged) |
| Magic-byte type check on uploads; residual Mediums | V2-14 |
| Help and command search (SA-12, the other half of AI-16); doctor-authored exam templates | v2.1 backlog (Q-15, Q-7) |
| Staging migrate of 000112 to 000115 | PO (`09B-P3`, not delegated) |

## Open questions and the default taken (PO away)

| # | Question | Default |
|---|---|---|
| Q-1 | The roadmap names "P1-42 journey 5" for V2-09b; TEST_STRATEGY §7 numbers walk-in 5 (delivered in V2-08) and the consult 6 | Deliver journey 6's consult part on the new workspace (`journey-06-consult.spec.ts`); its Rx-by-keyboard leg lands with V2-09c (as V2-08 Q-1 read its numbers) |
| Q-2 | IA §3.4 moves the consult to `/visits/[id]/consult`; roadmap §12 names `app/(dashboard)/consultation/[id]/**` | Keep the URL (the roadmap wins; about 30 app files and 65 test files reference it, `/visits` is still the register); the move with a permanent redirect goes to V2-11 with the other record URLs |
| Q-3 | Autosave transport: server action (TARGET §3.9) or a route handler (no action queue, `keepalive` flush on `pagehide`) | Server action, as approved; the alternative needs a TARGET erratum and is offered to the PO only if the device run shows stalls |
| Q-4 | How a conflict is resolved | Field-level automatic merge when the changes do not overlap; a prompt with "Use the other version" or "Keep mine" when they do (R-5) |
| Q-5 | Discard of an open amendment was handed to V2-09b by V2-09a | Not built here: restoring sealed rows from the snapshot means a new definer command and changes to the 09A seal guards while PR #15 is in review, for a case with a safe exit today (Finalize with no change; T-09A-07 accepted). The open-amendments indicator ships now; discard moves to V2-13 with the open-amendments report. PO to acknowledge |
| Q-6 | The v1 scribe modal in the workspace | Removed with the v1 workspace (C37); its server code stays for V2-12 to replace |
| Q-7 | Exam template content without a clinician | The six templates of the approved V2-DX prototype, verbatim: documentation boilerplate that starts normal, is edited per visit and drives no suggestion. Doctor-authored templates are v2.1. PO to acknowledge (PO-22 analogue) |
| Q-8 | Source of "Likely from the complaints" | The doctor's own signed history only (R-12); no authored complaint-to-diagnosis table |
| Q-9 | Which key gates the learned order of complaints, templates and plan tiles | `assist.terminology`; not entitled gives the fixed lists |
| Q-10 | What the snapshot counts as history (AI §5.2 "completed visits") | Signed visits only; desk-completed unsigned visits hold at most vitals and are excluded |
| Q-11 | "Progress per file" for uploads through server actions | Per-file status (queued, uploading, stored, failed with Retry), no byte percentage; limit = the server's 25 MB |
| Q-12 | The finish step (V2-DX E) and the whole-consult count | V2-09b keeps the existing Sign & Bill flow on a sheet; the review summary and two-tap finish land in V2-09c with print and share, the billing part in V2-10 |
| Q-13 | A dedicated amendment banner tone | No new token: `past-due` warning tone with a pencil icon and "opened {date}" |
| Q-14 | How AI-15 knows a follow-up was booked (follow-up rows are sealed with the visit) | Display rule only: the patient has a booked or confirmed visit with that doctor from three days before the follow-up date onward; nothing stored |
| Q-15 | AI-16's help search (SA-12, P3 "if time permits") | Deferred to v2.1; the vitals-flags half ships (R-13) |
| Q-16 | Complaint duration when shorthand gives none | No default is invented: the duration becomes optional and is printed only when present (R-14) |
| Q-17 | More than one follow-up row per visit | One per visit, enforced by a partial unique index (no live data, PO-15) |

## Execution (lean process)

- Executors: Sonnet `gsd-executor`, one plan at a time, in the order above, migration numbers as in the front matter (renumber at start). Never
  set a mode when starting a subagent (CLAUDE.md). Each plan runs only its affected Vitest and pgTAP files (full pgTAP in 09B-01 and 09B-04b)
  plus its one e2e lane; CI runs everything after the push, once for the phase. The evidence run at the close is the only full Vitest run; the
  FLOOR is re-measured from it once.
- One "fails without" proof per High control only (09B-01: the version check and the tracer; others where a review row is High). No mutant runs.
- Reviews: Sonnet for the isolated review, Opus for the adversarial security review and for hard debugging; docs, evidence and the PO kit by
  Haiku. One review round, one fix round (09B-06a).
- Evidence: one run (`... evidence 1`) plus CI (R-18).
- Branch `v2/phase-09b-consult-workspace` off `feature/v2` (or off the V2-09a branch while PR #15 is open, merging forward with merge
  commits); PR into `feature/v2`; never `main`; no force-push; local stack only, never hosted Supabase.
- New dependencies: none.
