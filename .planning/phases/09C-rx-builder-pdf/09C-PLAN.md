---
phase: 09C
roadmap_id: V2-09c
name: Rx builder & PDF
gate: "G4 (light, per PR): one isolated reviewer (Sonnet) over the Rx builder, the keyboard path, the PDF goldens and print, the finish review, Web Share, camera capture, a11y and the UI contract + one adversarial security reviewer (Opus) over migrations 000117 to 000119 (the Rx line command, the allergy record command, the repeat command, the grant narrowing on the prescription tables, three INVOKER reads, the registration default), the two search routes, the allergy check and its override, the PDF and Web Share paths (PHI on the device, file names, document title) and image re-encoding (EXIF); one fix round (09C-06a, lean process, VERIFICATION_LOG 2026-11-15). Approved by delegation if the PO's 2026-11-21 delegation (V2-07 to V2-11) is still in force when the gate is reached, with the CI run recorded; otherwise the PO approves. The PO is informed and sees Q-1, Q-2, Q-6, Q-8 and Q-9."
requirements: ["P1-32 (Rx part: keyboard Rx builder, one command per Rx change, medicine search route, Same as last visit as one command)", "P2-10 (Rx part: print, letterhead, paper size)", "AI-08 (SA-02 Rx favourites fix, your usual, protocol ranking)", "AI-11 (SA-07 substance-level allergy check; class level v2.1 per PO-22)", "PWA-12 (Rx part: camera capture for documents, Web Share of the Rx PDF)", "FT-04 (client-side image compression)", "§9.1 decision: Rx PDFs stored or regenerated on demand", "P1-42 (journey 6 Rx-by-keyboard leg; 09B Q-1)", "M4.4 Rx criteria (FRONTEND_MIGRATION_PLAN §3: add Rx line by keyboard only; Add 3 Rx lines keyboard only, 0 mouse)", "V2-09b hand-offs: finish review with print and WhatsApp defaults and the two-tap finish, whole-consult 10-tap count, structured exam on the PDF, medicine search on a GET route, Repeat Rx exception, PDF preview, camera beside FileDrop", "V2-09a hand-offs: store-or-regenerate keeps write-once if it stores, golden-file tests, R-A unchanged", "V2-06 hand-offs: prescription-builder and frequent-rx-chips React Compiler waivers, RxEntryRow/RxLineItem wired"]
plans: [09C-01, 09C-02, 09C-03, 09C-04, 09C-05, 09C-06a, close]
order: "09C-01 -> 09C-02 -> 09C-03 -> 09C-04 -> 09C-05 -> reviews -> 09C-06a -> close (sequential; one local stack; one executor at a time)"
migrations: {09C-01: 000117_rx_lines_command, 09C-02: 000118_rx_allergy_check, 09C-03: 000119_rx_assist}
migrations_note: "000116_consult_review_fixes is the newest migration at 02b2f49. Run `ls supabase/migrations | tail -3` at the start of each plan and renumber if needed. Every migration commit also bumps app/api/ready/expected-migration.ts, the schema snapshot, types/database.ts (npm run db:types) and scripts/ci/assert-pgtap-report.mjs (REQUIRED_FILES and FLOOR with the arithmetic in its header). 09C-04 and 09C-05 add no migration; 09C-06a takes the next free number only if a fix needs SQL."
base_commit: "f7bade97 on v2/phase-09c-rx-builder-pdf (02b2f49, the V2-09b merge into feature/v2, plus the 09B gate-record docs commit)"
branch: "v2/phase-09c-rx-builder-pdf -> PR into feature/v2"
source: "docs/v2/V2_MASTER_ROADMAP.md §1.2 (PO-8, PO-15, PO-17, PO-21, PO-22, PO-23), §9.1 (Storage row: 'Rx PDFs regenerated on demand rather than stored where possible (decided in V2-09c)'), §10 (P1-32, P2-10, AI-08, AI-11, PWA-12, FT-04), §10.3, §12 V2-09c; docs/v2/AI_STRATEGY.md §1.1 A4, §1.2, §4.4, §5.2 (SA-02, SA-06, SA-07), §5.3, §6.2, §8 AI-P3, AIR-5, AIR-7, D-9; docs/v2/DESIGN_SYSTEM.md §7.2, §7.6, §7.10, §8; docs/v2/PWA_STRATEGY.md §4 (D-3, D-6, D-7), §6.5, §9; docs/v2/FRONTEND_MIGRATION_PLAN.md §3 (M4 template, M4.4) and the appendix; docs/v2/DATA_HANDLING.md (MSG91/Meta processor row); docs/v2/TARGET_ARCHITECTURE.md §3.9, §7; docs/v2/ARCHITECTURE_DECISIONS.md ADR-004, ADR-016, ADR-019; docs/adr/0005; docs/v2/VERIFICATION_LOG.md rulings 2026-11-14, 2026-11-15, 2026-11-20, 2026-11-21; .planning/sketches/004-consult (V2-DX consult prototype: Rx favourites, bundle, keyboard, edit line, finish review) and v2-dx-evidence/counts.md (D1-D4, E, whole consult); 09A-PLAN.md (R-12, Deferred, Q-7, Q-8), 09A-REVIEW-TRIAGE.md (R-A, S-8); 09B-PLAN.md (R-1, R-2, R-8, Deferred, Q-1, Q-12), 09B-SUMMARY.md, 09B-NOTES.md (v1 inventory, hand-offs), 09B-REVIEW-TRIAGE.md (R-U)"
research: "No separate research file. The design is settled (V2-DX consult prototype approved at G2-D; DESIGN §7.6 and §7.10; AI §5.2 SA-02/SA-07; PWA §6.5). The code inventory below is the research. Facts checked in the tree because they shape the plan: RxEntryRow/RxLineItem exist but are wired only to the dev gallery; every request-path writer of prescription rows is in features/prescriptions/service.ts (the v1 API writes with the system client); CDCI generic-to-substance ids exist in GenericMaster.txt but are not loaded; registration records 'No known allergies' when nothing was entered; @react-pdf takes a fixed creationDate as a Document prop (the only time-dependent input found in its writer); the PDF uses the standard Helvetica fonts (no embedded font, small files)."
must_haves:
  truths:
    - "A doctor writes a three-medicine prescription with the keyboard only; every Rx change (add, edit, remove, template, repeat) is one idempotent command; the dose builder never prefills a dose the doctor did not choose or has not prescribed before."
    - "A medicine whose CDCI substances (or, without CDCI substances, whose name) match a recorded allergy is flagged before it is added and is stored only with a reason; the database refuses it otherwise; 'not recorded', 'no known allergies' and 'not checked' stay visibly distinct, and registration no longer records 'no known allergies' by default."
    - "Favourites and 'your usual' come only from the calling doctor's own signed prescriptions with stored doses only; 'Same as last visit' copies the patient's last signed diagnoses and Rx in one command and never copies an allergy-matching medicine silently."
    - "The Rx PDF prints on A4 or A5 with the clinic's letterhead settings and no invented text, matches the golden files byte for byte for a signed version, and the canonical signed version is archived once with its SHA-256; every other rendering is made on demand and never stored."
    - "From the review sheet the visit is finished in two taps (WhatsApp send preselected when allowed); the Rx PDF can be shared through the system share sheet; a phone photo is re-encoded to at most 1 MB with no location metadata before upload; nothing clinical is stored on the device."
  artifacts:
    - "supabase/migrations/000117_rx_lines_command.sql, 000118_rx_allergy_check.sql, 000119_rx_assist.sql"
    - "supabase/tests/database/rx_lines_command.test.sql, rx_allergy_check.test.sql, rx_assist.test.sql"
    - "app/api/prescriptions/medicines/route.ts, app/api/terminology/substances/route.ts"
    - "features/prescriptions/{lines.ts,allergy.ts}, components/consultation/workspace/sections/prescription-section.tsx, components/clinical/allergy-editor.tsx, components/clinical/share-pdf-button.tsx, components/consultation/workspace/finish-review.tsx, lib/files/compress-image.ts"
    - "tests/prescriptions/{change-prescription-rpc,medicine-search-route,rx-lines,allergy-match,allergy-check-rpc,rx-favourites-db,repeat-visit-plan-rpc,rx-golden,rx-pdf-content}.spec.ts, tests/prescriptions/golden/*, tests/patients/{record-allergies-rpc,allergy-states}.spec.ts"
    - "tests/e2e/consult/{rx-keyboard,rx-allergy,rx-assist,rx-print,finish-review,rx-share,capture-compress}.spec.ts, tests/e2e/journeys/journey-06-consult.spec.ts (Rx keyboard leg and the whole-consult count)"
  key_links:
    - "public.change_prescription is the only request-path writer of prescription_items and of new prescription headers (INSERT/UPDATE/DELETE narrowed for authenticated after the writer inventory); the v1 API keeps the system client until V2-12."
    - "private.rx_allergy_matches (000118) is the one SQL source of the allergy rule; change_prescription and repeat_visit_plan both call it; features/prescriptions/allergy.ts implements the same rule for the UI and one shared case table runs against both."
    - "consult_assist_context (replaced in 000119) reads visits.doctor_id = auth.uid() and signed versions only; it is the only source of favourites and 'your usual'."
    - "renderPrescriptionPdf passes the header's signed_at as creationDate, so the archived bytes of a signed version are reproducible; resolvePrescriptionPdf, the write-once pair and ruling R-A are unchanged."
---

# V2-09c Rx builder & PDF: plan

## Goal

Fast, safe prescriptions with a printable, trustworthy output. A doctor adds, edits and removes medicines from the keyboard (or by
tapping), with no dose prefilled that they did not choose or have not used before; every change is one idempotent command. A
medicine that matches a recorded allergy is flagged before it is added and is stored only with a reason, and the database enforces
it. The doctor's own favourites, "your usual for {diagnosis}" and "Same as last visit" add whole prescriptions in one tap, from the
doctor's own signed history only (the SA-02 defect is fixed). The PDF prints on A4 or A5 with the clinic's letterhead settings,
carries no invented text, is byte-reproducible for a signed version, and is archived once per signed version with its hash;
everything else is rendered on demand. The visit is finished from a review sheet in two taps, the PDF can be shared through the
system share sheet, and phone photos are compressed before upload.

Tracer: 09C-01 starts with the narrowest end-to-end slice (one medicine added by keyboard: migration with the search read and the
line command, the GET route, the service and action, the existing RxEntryRow wired to them inside the consult, and a keyboard-only
e2e that reads the row back from the database) and only then expands to edit, remove, templates and repeat, so a dead end in the
command or the keyboard path shows after one commit and before the allergy check and the Smart Assist sit on top of it.

## Current state (inventory 2026-11-22; tree at f7bade97; highest migration 000116)

| Area | Today | Gap | Plan |
|---|---|---|---|
| Rx builder | `components/consultation/prescription-builder.tsx` (927 lines; React Compiler waiver, 2 sites, owner V2-09c), hosted unchanged in the 09B Prescription section (`components/consultation/workspace/consult-workspace.tsx:854-870`; it reports lines through `onItemsChange`, which drives the section count, the summary pane and Sign & Bill). Medicine search is a server action with a 120 ms debounce (`:120-143`), so typeahead rides the action queue. A picked medicine is staged with "1-0-1", "After food", "5d" (`:79-82`, `:180-182`). Enter in the field does nothing (no keyboard path). Lines cannot be edited (remove and re-add). Remove and templates use hand-rolled dialogs (`:834-924`) | No keyboard Rx; invented dosing; M4.4 | 09C-01 |
| Design-system parts | `components/clinical/rx-entry-row.tsx` (521: cmdk combobox and dose builder; Enter picks, digit 1-5 picks the frequency, `5d`/`2w`/`1m` the duration, Enter adds; 06-09c key rules) and `components/clinical/rx-line-item.tsx` (155: pills that edit the dose, remove, "Repeated" marker, allergy match with "Prescribe anyway…" and a reason), from 06-03b, used only by the dev gallery (`app/dev/ui/sections/clinical-b.tsx`). RxEntryRow searches an in-memory list. `lib/clinical/rx.ts:33` `DEFAULT_DOSE` (1-0-1, After food, 5 days) is prefilled when a medicine has no usual dose | Not wired; prefills a dose nobody chose | 09C-01 |
| Rx writes | `features/prescriptions/service.ts` `addPrescriptionItem` (`:166-276`): get-or-create the header, read the highest sort order, insert, upsert `doctor_custom_medicines` (always `use_count: 1`), app-side audit `prescription.item_add`: five statements, no idempotency key. `removePrescriptionItem` (`:285-338`). Templates are applied by a client loop plus `window.location.reload()` (`prescription-builder.tsx:381-395`). Repeat Rx is a client loop of `addPrescriptionItem` (`consult-workspace.tsx:476-495`, `:864-869`; `history-list.tsx:107`), the registered exception at `tests/ci/no-client-command-chains.spec.ts:49` (owner V2-09c). RLS: `prescriptions:edit` for INSERT/UPDATE/DELETE (000054, 000052); the header UPDATE grant is only the PDF pair and `updated_at` (000108, 000109). The v1 API writes with the system client (`app/api/v1/prescriptions/route.ts`, ADR-0005 register) | Not atomic or idempotent (ADR-004, PWA-06a, M4 criterion 7) | 09C-01, 09C-03 |
| Medicine search SQL | `public.search_medicines(p_query, p_doctor_id, p_tenant_id, p_limit)`, latest body 000061:549: DEFINER, the caller must pass its own id; CDCI rows return invented `'After food'` and `'5 days'`; `to_tsquery` is built from raw input (`replace(q, ' ', ' & ') || ':*'`), so `(`, `!`, `&` or `:` raise a syntax error; `%` and `_` are not escaped. The CDCI tables (000007:178-233) are empty on the local stack (`seed:cdci` targets the hosted project and is never run); `scripts/seed-cdci-test-fixture.ts` holds a synthetic drug list; `tests/setup/teardown.ts` documents upserted global `test-cdci-*` fixture rows as accepted | Server-action typeahead; defaults; input errors | 09C-01 |
| Favourites (AI-08; AI §1.1 A4) | `components/consultation/frequent-rx-chips.tsx` (113; waiver listed with owner V2-09b, the file is V2-09c's) → `getFrequentPrescriptionsAction` (`features/ai/actions.ts:67-89`, accepts a client `doctorId`) → `lib/ai/prescription-suggestions.ts:18-135`: no doctor filter (any doctor of the clinic), unsigned visits counted, invented "1 tab", "1-0-1", "5 days" (`:97-99`). `consult_assist_context` (000113, latest) returns the doctor's own per-diagnosis plan (investigations, advice, follow-up) but no Rx | SA-02 defect | 09C-03 |
| Allergies | `patients.allergies text[]`, nullable: NULL = not recorded, `{}` = no known allergies, a list = known; `AllergyBanner` draws the three states and the consult strip keeps it visible. Entry: `components/patients/edit-patient-modal.tsx` (comma text) through `updatePatient`; nothing is coded. **Defect:** registration stores `{}` when nothing was entered (`features/patients/schema.ts:128`; `private.patient_input_normalize`, 000101:304), and a clinical-role demographics edit writes `[]` over NULL (`features/patients/service.ts:28-31`, `:78-96`), so "No known allergies" shows for patients nobody asked. The builder shows an amber text banner only (`prescription-builder.tsx:438-454`). CDCI generics carry their substance ids in `GenericMaster.txt` column 3 (`+`-separated), but `cdci_generics` has no such column and `scripts/seed-cdci.ts:114-117` drops it. Keys `assist.allergy_check`, `assist.frequent_rx`, `assist.dup_therapy` are seeded on every plan (000084) | AI-11 needs coding, a mapping and a safe default | 09C-02 |
| PDF | `features/prescriptions/pdf/{generator.ts (396), payload.ts (210), prescription-document.tsx (649)}`: A4 only (`:385`); Helvetica standard fonts; pre-printed mode pads a fixed 110/60 pt (`:104-105`) although `tenants.letterhead_top_margin` and `letterhead_bottom_margin` exist (000007:28-29, unused); a missing timing prints "After food" (`:581`); dates through `toLocaleDateString` (`:410`, `:631`: server locale and zone, ADR-016); the Document title carries the patient's name (`:384`; PWA D-7); footer "Generated by ClinicOS" (`:639`); `logo_url` is loaded and never drawn; `creationDate` defaults to the render time, so two renders differ; the structured exam (09B `specialty_data.exam`) is not printed. Route `app/api/visits/[id]/prescription-pdf/route.ts` (71): `prescriptions:view`, `?letterhead=` variant, `?download=true`, file name with the patient's name (`:53`) | P2-10; no golden; non-deterministic bytes | 09C-04 |
| Archive (V2-09a) | `archivePrescriptionPdf` / `readArchivedPrescriptionPdf` / `resolvePrescriptionPdf` (generator.ts): one write-once object per signed version at `<tenant>/<visit>/rx_v<version>.pdf` with `pdf_sha256`; drafts, open amendments and letterhead variants rendered on demand and never stored (09A R-12); only the signer archives (R-A); a regenerated copy prints "Regenerated copy, not the archived original" (S-8); `tests/prescriptions/{rx-pdf-archive,rx-archive-signer}.spec.ts` | The §9.1 store-or-regenerate decision is open | 09C-04 (R-11) |
| Print and share | Record bar on a completed visit: "WhatsApp Rx & Bill", "Print Rx" (opens the PDF route), "Receipt" (`consult-workspace.tsx:733-765`). Sign & Bill success screen: Print and WhatsApp buttons (`sign-and-bill-modal.tsx:275-330`). `components/consultation/pdf-preview-modal.tsx` (284) has no importer; its `getPrescriptionPdfSignedUrl` action is used only there. `sharePrescriptionViaWhatsApp` (`features/prescriptions/service.ts:605-703`) creates a 7-day `/r/[token]` link and enqueues `prescription_ready` with no dedupe key. No Web Share | PWA-12 | 09C-04, 09C-05 |
| Finish | `components/consultation/sign-and-bill-modal.tsx` (650) on `ResponsiveSheet` (09B R-8): the fee and collect form, "Sign & Route to Reception" or "Sign & Collect", then the success screen. No review of what the patient receives, no send defaults | V2-DX step E; 09B Q-12 | 09C-05 |
| Uploads | `components/ui/file-drop.tsx` and `components/consultation/workspace/attachments.tsx` (09B-05/06a): 4 MB limit (R-U), first-bytes type check, one request id per file. `components/patients/patient-lab-documents.tsx` (V2-11 waiver) uploads through the same `uploadLabDocument`. No camera input; no compression; `app/manifest.ts` has no shortcuts | PWA-12, FT-04 | 09C-05 |

Gate scripts today: pgTAP FLOOR 8824 (`scripts/ci/assert-pgtap-report.mjs:145`), Vitest FLOOR 6455 (`assert-vitest-report.mjs:131`, re-measured once at the
close), `EXPECTED_MIGRATION = "000116"`, `/consultation/[id]` 368.0 kB gz against the 200 kB report-only budget (`npm run ci:route-js`), e2e PR lane
limit 85 minutes (job 95; sharding is `09B-P5`, a PO decision). Waivers this phase removes: `prescription-builder.tsx` and `frequent-rx-chips.tsx`.

### Carried in (09B-PLAN Deferred and R-8/Q-1/Q-12, 09B-NOTES hand-offs, 09A-PLAN Deferred, 09A-REVIEW-TRIAGE)

- From V2-09b: the keyboard Rx builder, AI-08, "your usual" and favourite tiles, "Same as last visit" (diagnosis and Rx) as one command replacing the
  Repeat Rx loop, medicine search on a GET route, the finish review sheet with print and WhatsApp defaults and the two-tap finish, the whole-consult
  10-tap count, printing the structured exam, camera capture beside `FileDrop` (not inside it), compression, the PDF preview, the allergy check; journey
  6's Rx-by-keyboard leg (09B Q-1). The `M` shortcut (`use-consult-shortcuts.ts`) focuses the medicine field and must keep doing so. Rx lines stay
  row-level writes outside `draft_version` (09B R-2): they never conflict with the draft saver.
- From V2-09a: one canonical archive per signed version, variants on demand (R-12); "store-or-regenerate (keeps write-once if it stores), golden-file
  tests" (09A-PLAN Deferred); R-A (only the signer archives; the trusted `rx.archive` job is the PO's V2-14 decision, 09A-P1); the S-8 notice; the
  read-only contract (`recordState`): a sealed, unsigned completed or cancelled record has no Rx input; amending allows Rx changes; the B-1 rule (a
  staged medicine does not survive the sign-off refresh) is kept by remounting the section on the record state.
- R-U (09B-06a): uploads stay at 4 MB through the server action; direct-to-Storage uploads are a PO decision for V2-14. Compression makes 4 MB enough
  for phone photos.

## Rulings

CTO rulings under the lean process and the PO's delegation (VERIFICATION_LOG 2026-11-21). Where the documents are silent the default is recorded here
and in Open questions; the PO may overturn any of them at the gate.

| # | Ruling | Why / how |
|---|---|---|
| R-1 | **Scope.** P1-32 Rx part, P2-10 Rx part, AI-08, AI-11 (substance level), PWA-12 Rx part (camera capture for documents, Web Share of the Rx PDF), FT-04 compression, the §9.1 store-or-regenerate decision, the V2-09b and V2-09a hand-offs above. Deleted as replaced (PO-15): the v1 builder, the frequent-Rx chips and their action and library, the unused PDF preview. Out: class-level allergies (D-9, v2.1), SA-06 duplicate therapy (Q-11), SA-05 dose calculator and SA-08 interactions (v2.1), receipt print and invoice share (V2-10), manifest shortcuts (Q-10), a QR code, a logo or Hindi text on the PDF, the v1 API Rx path (V2-12), the trusted archiver (V2-14, PO), direct-to-Storage uploads (V2-14, PO), the billing part of the sheet (V2-10) | Roadmap §12 V2-09c; plan models |
| R-2 | **One command for every Rx change** (ADR-004, PWA-06a, M4 criterion 7). `public.change_prescription(p_tenant_id uuid, p_visit_id uuid, p_changes jsonb, p_client_request_id uuid)`, SECURITY DEFINER in the V2-07 pattern under the caller's JWT. Guard block (actor; active full clinic; `prescriptions:edit`). `p_changes` = `{add: [line] (0-30), update: [{id, dosage?, timing?, duration?, special_instructions?}] (0-30), remove: [uuid] (0-30)}` (09C-02 adds `allergy_override_reason`), closed key sets, jsonb types, at most 64 kB, at least one operation (`INPUT_INVALID`); a line is `{medicine_name 1-250, generic_name ≤250, dose_form ≤50, dosage 1-50, timing ≤100 or null, duration 1-50, special_instructions ≤500, cdci_brand_id}` (the zod rules of `prescriptionItemSchema`); a `cdci_brand_id` must exist in `cdci_medicines_search`. Claim; lock the visit (`FOR NO KEY UPDATE`); refuse a sealed, an unsigned `completed` and a `cancelled` visit with `DRAFT_LOCKED` (the predicate of `save_consultation_draft`, latest body 000116:290); admit the states that command admits. The visit's latest header (created when none exists, with the columns `getOrCreateDraftPrescription` writes today plus `letterhead_mode` and `paper_size` from the clinic's print settings); every update and remove id must be an item of that header (`NOT_FOUND`, nothing written); updates change dose fields only (the medicine is changed by remove and add); adds take the next `sort_order` in array order; a line without `cdci_brand_id` upserts the doctor's `doctor_custom_medicines` row with the line's dose as their stored values and `use_count + 1`. Command-only audit `prescription.lines_change` with counts only (`added`, `updated`, `removed`); result `{prescription_id, added_item_ids, replayed}` (ids and flags only). The 09A seal guards still fire for the definer body. After the writer inventory, `INSERT, UPDATE, DELETE` on `prescription_items`, `INSERT` on `prescriptions` and `INSERT, UPDATE` on `doctor_custom_medicines` are revoked from `authenticated` (the header's PDF-pair column grant stays for the signer's archive, R-A) | V2-07 command pattern; 08 R-15 and 09B R-3 contract precedent |
| R-3 | **Medicine search** (TARGET §3.9: typeahead on GET routes). `GET /api/prescriptions/medicines?q=&limit=` over a new `public.search_medicines(p_tenant_id uuid, p_query text, p_limit integer)` (INVOKER, STABLE; the doctor is `auth.uid()`, never a parameter; EXECUTE for `authenticated` only; the old 4-argument DEFINER function is dropped in the same migration). Query trimmed, 1-60 characters, `%`, `_` and `\` escaped, no `to_tsquery` on input. Ranking: the caller's own custom medicines first by `use_count`, then CDCI brand name prefix, word prefix, generic prefix, then trigram similarity ≥ 0.3 on brand and generic (the existing GIN indexes). Columns: `id`, `kind` (`cdci`/`custom`), `medicine_name`, `generic_name`, `dose_form`, `substance_ids` (from `cdci_brands.generic_id` → `cdci_generics.substance_ids`; empty until the CDCI seed loads them), and for custom rows only the doctor's stored `dosage`, `timing`, `duration`; never a default. Route: `prescriptions:edit` from the session, the `GET /api/terminology/diagnoses` pattern (fixed error bodies, 401/403/503/500, `private, no-store`, exact keys); rate limiting is V2-12 | 08 R-11; 09B R-11 |
| R-4 | **No invented dosing** (AI §1.1 A4, SA-02 "return only stored values", 09B R-14). `DEFAULT_DOSE` is removed from `lib/clinical/rx.ts`; the dose builder opens with the doctor's own usual dose for that medicine (09C-03, from their signed history) or their custom medicine's stored values, and otherwise with no frequency, no timing and no duration: Enter then adds nothing and says "Choose a frequency (1 to 5) and a duration such as 5d". Search, favourites and repeat return stored values only (a stored null stays null). The PDF prints no default timing | Clinical safety; no clinical logic authored (PO-22) |
| R-5 | **Keyboard builder** (DESIGN §7.6, 06-03b). The Prescription section is rebuilt on `RxEntryRow` and `RxLineItem`. RxEntryRow gains an async `search(query, signal)` prop (abort per keystroke, 150 ms debounce) alongside its list prop. Keys as 06-09c: Enter picks the top match and opens the dose builder, a digit 1-5 picks the frequency, `5d`/`2w`/`1m` the duration, Tab walks timing and the instruction, Enter adds and refocuses the field. A committed line is edited in place from its pills (the dose builder opens with the line's values; Enter sends one update) and removed with an 8 s Undo toast (Undo re-adds the line through one command). A line being sent shows "Adding…"; a failed send keeps the line in the dose builder with the fixed error and Enter retries; `useCommand` semantics (15 s timeout, one retry with the same id). `M` and Alt+4 keep their 09B meaning. Templates move into a "Templates" `ResponsiveSheet` (apply = one command; save = the existing `saveDoctorProtocolTemplate`). Read-only records show the lines without the entry row or pills; the section remounts on the record state (B-1) | M4.4 "add Rx line by keyboard only"; roadmap acceptance 1 |
| R-6 | **Allergy coding** (SA-07 "coded to CDCI substances at entry, typeahead, free text kept"; Q-3). An allergy stays one string in `patients.allergies`. The allergy editor offers a CDCI substance typeahead (`GET /api/terminology/substances`, `public.search_substances`, INVOKER); picking one stores the substance's exact CDCI name; free text is allowed. A string counts as coded when it equals a CDCI substance name (case-insensitive, trimmed); every entry shows "Checked against medicines" or "Not a listed substance: checked by name only". No new patient column | Deterministic; one source of truth; no drift between two arrays |
| R-7 | **Allergy check** (AI-11, SA-07 substance level; DESIGN §7.2, §7.6; AIR-5, AIR-7). One rule, in SQL (`private.rx_allergy_matches`) for the commands and in TypeScript (`features/prescriptions/allergy.ts`) for the UI, both run against one shared case table: a line matches an allergy when (a) the line's CDCI substance ids (brand → generic → `substance_ids`) intersect the substance ids of the coded allergy strings, or (b) for a line with no CDCI substance ids, the allergy string's word sequence appears in the line's medicine or generic name (case-insensitive, split on non-alphanumerics). No class table, no salt relations (D-9). `change_prescription` (and `repeat_visit_plan`) refuse a matching add with `ALLERGY_MATCH` (P0001, CONFLICT, nothing written, no audit) unless `allergy_override_reason` (5-300 characters, Q-4) is given; the reason, the matched strings, the actor and the time are stored on the line (`prescription_items.allergy_override`) and counted in the audit (`allergy_overrides`; the reason text is never in audit metadata or logs). An update may confirm an existing line that matches an allergy recorded after it was added. The check runs when `assist.allergy_check` is entitled (every plan today; a platform override is the kill switch for a bad mapping, Q-12), resolved in SQL from `billing_internal.has_entitlement` and on the server for the UI; it never depends on the AI kill switch. UI: an "Allergy" danger chip on a matching search result; the dose builder shows "Matches allergy: {allergies}" and adds only after "Prescribe anyway…" with a reason; a line added that way shows its reason; an existing line that matches shows the RxLineItem danger state with "Prescribe anyway…" or Remove; "Allergies not recorded · Record now" above the entry while not recorded; "Checked by name only" on lines with no CDCI substances while allergies are known. The Finish review blocks Sign while a match is unresolved (UI; the sign command is unchanged, Q-5) | Roadmap acceptance 3; server authority, client UX |
| R-8 | **Allergy states and recording** (DESIGN §7.2: "Unknown" and "none" are visually distinct). Registration stores NULL (not recorded) unless allergies were entered: `newPatientPayload` and `private.patient_input_normalize` (replaced from 000101:207) keep an absent or null `allergies` as NULL; QuickRegister and the front-desk sheets send no `allergies` key. `updatePatient` sends `allergies` only when they changed and treats NULL and `[]` as different. Allergies are recorded through a new command `public.record_patient_allergies(p_tenant_id, p_patient_id, p_allergies jsonb, p_client_request_id)` (definer, V2-07 pattern; the permission rule of the 000055 guard: `patients:edit` and `consultations:view`, so the front desk cannot; 0-50 strings of 1-200 characters, duplicates removed case-insensitively; `[]` = "No known allergies"; command-only audit `patient.allergies_record` with counts). The consult allergy strip gets "Record now" (not recorded) and "Edit" (known or none) opening the allergy editor in a `ResponsiveSheet`, while the record is editable. The patient edit modal keeps its comma field (its strings are still matched by name); the editor moves into the patient profile with V2-11 (Q-6) | Safety defect found in the inventory; AI-11 depends on it |
| R-9 | **Rx Smart Assist** (AI-08, SA-02; V2-DX D1, D2). `consult_assist_context` (latest 000113) is replaced, adding: `rx_favourites` (the calling doctor's 12 most prescribed medicines over their own last 300 signed visits, signed version of each visit only, ranked by Σ 0.5^(age in days / 90), each with its `usual` = the most frequent exact (dosage, timing, duration) triple of this doctor for that medicine, ties to the most recent; stored values only) and per diagnosis `rx` (medicines present in at least 40 % of this doctor's signed visits with that diagnosis, at least 2 visits, at most 6, with `usual`); each entry carries `cdci_brand_id` and `substance_ids` for the UI pre-check; names and counts only, no patient or visit id. UI in the Prescription section: "Your usual for {diagnosis}" bundle tile (one tap adds the missing lines in one command), favourite tiles (one tap each with the usual dose; a favourite without a complete usual dose opens the dose builder instead), labelled `SmartAssistLabel` and gated by `assist.frequent_rx` (hidden when not entitled). Lines inserted by a tile, a template or a repeat carry the "Repeated" marker until the doctor touches them (session state). Lines that would match an allergy are left out of a one-tap add and opened in the dose builder flagged. Protocol templates are ranked: the visit's specialty first, then a name containing a current diagnosis, then newest. The v1 A4 path is deleted | Roadmap acceptance 4 ("SA-02 never returns another doctor's Rx") |
| R-10 | **Same as last visit** (UX_AUDIT §4.2, V2-DX "Repeat last visit (diagnosis + prescription)", 09B Deferred). `public.repeat_visit_plan(p_tenant_id uuid, p_visit_id uuid, p_source_visit_id uuid, p_parts text[], p_client_request_id uuid)` (definer, V2-07 pattern, `prescriptions:edit` and `consultations:edit`): the source must be a signed visit of the same patient in the same clinic (any doctor of the clinic; Q-14); `p_parts` ⊆ {`diagnoses`, `prescription`}; copies the source's signed-version lines (skipping a medicine already on this Rx, case-insensitive) and its diagnoses (skipping those present) from the database, never from caller input; a line that matches an allergy is not copied and its source item id is returned in `skipped_item_ids` (the UI opens it in the dose builder flagged); same lock and state rules as R-2; audit `visit.repeat_plan` with counts. "Same as last visit · {date}" tile (both parts) and the history list's "Repeat this Rx" (prescription only) call it; the client Repeat loop and its exception go | M4 criterion 7; replaces the registered exception |
| R-11 | **Store or regenerate** (§9.1, Q-1). Decided: **store exactly one object per signed version** (the canonical rendering at the header's own letterhead and paper size, the 09A write-once pair with its SHA-256, R-A unchanged) and **render everything else on demand, never stored**: drafts, open amendments, letterhead and paper variants, previews, share-link reads of a version not yet archived. Reasons: a regenerated PDF cannot prove what was signed once the template, clinic details or renderer change; the roadmap acceptance requires the hash to be stored; the files are small (standard fonts, no images). 09C-04 measures the golden renders and projects the PO-13 pilot volume (5 clinics × 60 Rx a day × 30 days, one version each) against the 1 GB Free Storage quota; the numbers go in the notes and the summary. If the projection exceeds 10 % of the quota per UAT month the PO is asked before the gate | Integrity over a small Storage saving; 09A "keeps write-once if it stores" |
| R-12 | **PDF and print** (P2-10, DESIGN §7.6, §7.10; Q-2, Q-9). The PDF is the single printed rendering: "Print" opens it; no second HTML rendering of the prescription. Paper size A4 or A5 and the default letterhead mode come from new clinic settings (`tenants.rx_paper_size`, `tenants.rx_letterhead_mode`) and are frozen on the header at creation (`prescriptions.paper_size` new, `letterhead_mode` existing, both INSERT-only); pre-printed mode uses `tenants.letterhead_top_margin` and `letterhead_bottom_margin` (points, CHECK 0-300, edited in millimetres). A "Prescription printing" card in clinic settings (`clinic:manage`, through `updateClinicSettings`) sets them; changes apply to new prescriptions. Content: no default timing; dates in the clinic zone through `lib/datetime` (ADR-016); the structured exam (abnormal systems with findings and side, "Normal" systems listed in one line, general signs) from `features/consultation/exam-text.ts`; complaint durations only when present (09B R-14); the Document title "Prescription v{n}" and the download file name `Prescription-{visit date}-v{n}.pdf` carry no patient name (PWA D-7); the product name is not printed (the footer reads "Rx v{n} · Page x of y", Q-9); `creationDate` and `modificationDate` are the header's `signed_at` (the render time for an unsigned rendering, never stored), so a signed version renders to the same bytes. Characters outside the standard fonts are a known limit (Hindi printing is P3, Deferred); the golden set includes a case that proves such a name does not fail the render | Golden files; determinism; one rendering |
| R-13 | **Finish review** (V2-DX step E; 09B R-8, Q-12). "Finish visit" flushes the draft and opens the sheet on a review screen: the summary as the patient receives it (the 09B summary-pane content), unresolved allergy matches (Sign is disabled until each is confirmed with a reason or removed, with a link to the line), "Send prescription on WhatsApp" (preselected when the patient has a phone and has not opted out, `patients.whatsapp_opt_out`; Q-8), the existing fee and collect choice (billing part unchanged for V2-10; "Front desk collects" stays the default for non-collectors), "Signing locks this prescription. Changes after signing are amendments with a reason.", "Sign and finish". Two taps from the consult with the defaults. The WhatsApp send happens in the same server action after a committed sign (`completeAndBillConsultation` gains `send_rx_whatsapp`), through `sharePrescriptionViaWhatsApp` with dedupe key `prescription_ready:{prescription_id}:v{version}`, so a replayed or retried sign queues one message. The success screen offers "Print", "Share PDF" (R-14) and the WhatsApp state; Print is a separate tap because browsers block opening a window after an asynchronous sign | Two-tap finish (counts.md E) |
| R-14 | **Web Share of the Rx PDF** (PWA-12, PWA §4 D-6, §6.5). "Share PDF" on the success screen and on the record bar of a completed visit. The PDF is fetched from the PDF route into memory when the button mounts (Safari requires `navigator.share` inside the tap), shared as `File(Prescription-{date}-v{n}.pdf, application/pdf)` when `navigator.canShare({files})` is true, and dropped on unmount; otherwise the button is "Download PDF". Nothing is written to any storage API; the route stays `no-store` | User-initiated share (D-6); no PHI in names (D-7) |
| R-15 | **Camera capture and compression** (PWA-12, FT-04, PWA §6.5; Q-7). A "Take photo" button beside `FileDrop` (09B hand-off), shown on coarse pointers, is an `<input type="file" accept="image/*" capture="environment">` feeding the same queue. `lib/files/compress-image.ts` (browser APIs only: `createImageBitmap` with `imageOrientation: "from-image"`, canvas or OffscreenCanvas, `toBlob("image/jpeg")`): every JPEG, PNG or WEBP is re-encoded as JPEG with the long edge at most 2,000 px and quality 0.82, stepping to 0.7, 0.6 and 0.5, then scaling by 0.8, until it is at most 1 MB (at most 6 attempts); re-encoding drops EXIF and GPS; PDFs pass unchanged. If decoding fails the original is sent when it is within the 4 MB server limit, else refused with "This photo could not be compressed. Try a smaller photo or a PDF." Applied in every upload path (`attachments.tsx`, `patient-lab-documents.tsx`); the server checks are unchanged | Roadmap acceptance 5; Free Storage quota (§9.1) |
| R-16 | **Platform rules.** No service-role client in this phase (ADR-0005): commands under the caller's JWT, reads INVOKER, routes and actions take the tenant from the session. No PHI on the device (PWA D-3). No new dependency: the PDF stays `@react-pdf/renderer`, compression uses browser APIs, the golden helper reads PDFs with `node:zlib` (`tests/helpers/pdf-text.ts`). No per-flow flags; v1 code deleted as replaced (PO-15). Tenant-local dates from `lib/datetime` (ADR-016); no cross-request caching of tenant data (ADR-019) | CLAUDE.md non-negotiables |
| R-17 | **Evidence and latency.** Tool output only: `node scripts/phase-evidence.mjs .planning/phases/09C-rx-builder-pdf/evidence 1`, then `--ci-run <id>`. `scripts/perf/command-latency.ts` gains `change_prescription`, `record_patient_allergies` and `repeat_visit_plan` (p95 under 150 ms) and times `search_medicines` (20,000 synthetic CDCI rows), `search_substances`, `rx_allergy_context` and `consult_assist_context` with Rx keys (300 signed visits of 3 lines for one doctor) at p95 under 50 ms. Also: the `ux` count files, the axe summary, the golden PDFs as samples, the compression measurements (input and output bytes and dimensions) | CLAUDE.md DoD 5; V2-08 latency condition |
| R-18 | **Migrations.** New files only, expand first, contract (grant narrowing) only after the writer inventory in the plan that removes the last writer (no live data, PO-15); a replaced function starts from its latest body (`grep -n "FUNCTION <name>" supabase/migrations/*.sql`) and changes only what the plan names; the diff is part of the review | CLAUDE.md |

## Shared rules for every plan

- Command pattern (07-PLAN; 08 and 09B shared rules): `p_tenant_id` and a required `p_client_request_id uuid`, `search_path = ''`, `lock_timeout = '2s'`,
  the guard block, `private.command_claim`, locks, invariants, writes, in-transaction audit through `private.log_command_audit`, `private.command_complete`,
  `REVOKE ALL ... FROM PUBLIC, anon, service_role; GRANT EXECUTE ... TO authenticated`. Its spec calls `expectCommandCatalog` (`tests/helpers/command-catalog.ts`)
  and covers the happy path with its audit row, fault injection (`tests/helpers/fault.ts`: nothing persists), replay, `IDEMPOTENCY_MISMATCH` with each
  hashed input varied, the role matrix, cross-tenant and one concurrency case.
- Read functions: INVOKER, STABLE, `search_path = ''`, every name schema-qualified, `p_tenant_id` from the session and filtered in the body (RLS still
  applies, so a forged id returns nothing), EXECUTE for `authenticated` only, the narrowest output.
- Registries a migration touches: `RPC_REASON_CODES` (`lib/db/errors.ts`), `AUDIT_ACTIONS` and `COMMAND_ONLY_AUDIT_ACTIONS` (`lib/audit/audit.ts`) with
  `tests/audit/log-audit-allowlist.spec.ts` and the SQL lists (`private.audit_client_actions()`, `private.audit_metadata_keys()`, latest bodies), the pgTAP
  definer registry and grantee sets (`definer_functions.test.sql`, `grants.test.sql`), `tests/security/guard-manifest.ts` and `npm run inventory` for every
  added or removed action or route, the schema snapshot (`node scripts/drift/schema-snapshot.mjs --local --write`, then `--check`; `npm run db:drift:local`),
  `npm run db:types`, `npm run authz:gen` when a policy or grant changes, `app/api/ready/expected-migration.ts`, `scripts/ci/assert-pgtap-report.mjs`
  (REQUIRED_FILES and FLOOR = the measured total with the arithmetic in the header) and `scripts/ci/assert-vitest-report.mjs` REQUIRED_FILES, all in the
  migration's commit.
- Affected-test discovery: before editing, grep for what the plan changes and list the hits in the notes, for example
  `grep -rln "addPrescriptionItem\|removePrescriptionItem\|getOrCreateDraftPrescription\|searchMedicines\|search_medicines\|PrescriptionBuilder\|prescription-builder\|FrequentRxChips\|getFrequentPrescriptionsAction\|prescription_items\|doctor_custom_medicines\|allergies\|prescription-document\|renderPrescriptionPdf\|SignAndBillModal\|uploadLabDocument" tests supabase/tests scripts`,
  narrowed per plan. The grep, not any list in this plan, is authoritative. After 09C-01, fixtures write Rx lines through the command, or as the service
  role on an unsigned visit (09A R-15 still applies to signed ones).
- Each e2e test owns its data: its own doctor and clinic (`tests/e2e/support/own-doctor.ts`) and its own patients, because desktop-chrome, pixel-7 and
  iphone-15 share one database. Synthetic CDCI rows are global reference fixtures upserted with fixed ids `test-cdci-09c-*` and never changed or deleted
  by a test (the accepted pattern in `tests/setup/teardown.ts`). No test reads `.env*`; synthetic data only.
- Tests assert real outcomes (rows, ids, bytes, hashes, DOM state, stored object size), never source text or "renders". One "fails without" proof per
  High control. No mutant runs. E2E on desktop-chrome, pixel-7 and iphone-15 with 0 retries; axe 0 serious or critical at 360, 820 and 1280.
- UI work: V2-06 parts (`components/ui`, `components/clinical`), no hex or raw palette class, `dvh` not `vh`, 44 px touch targets below 1024, no new
  React Compiler waiver (the waiver file only shrinks), `npm run ci:ui-policy` and `npm run ci:ai-l1` clean, checked at 360, 820 and 1280. No new dependency.
- Plan record: each executor appends a section to `.planning/phases/09C-rx-builder-pdf/09C-NOTES.md` (what changed, deviations, grep hits and fixes, test
  names, the exact commands run with counts). Evidence is never typed there.
- Run order inside a plan: migration first (`npx supabase db reset --local`, `npm run db:types`), then service, then UI, then specs; then the affected Vitest
  and pgTAP files, `npm run typecheck`, `npx eslint .`, `npm run inventory`, and the plan's e2e lane after `npm run e2e:build` (always rebuild first).
  Delete `.planning/dev-messages.txt` if a run recreates it.
- Never run `seed:cdci*`, `seed:diagnoses`, `msg91:*` or anything with `--env-file=.env`; never read `.env*`; local stack only.

## Plans

### 09C-01 Rx line command, medicine search route, keyboard builder · M-L · migration 000117_rx_lines_command

Goal: R-2 to R-5. A doctor adds, edits and removes medicines from the keyboard; every change, template and repeat is one idempotent command;
nothing is prefilled that the doctor did not choose. The v1 builder is gone.

Files: `supabase/migrations/000117_rx_lines_command.sql`; new `supabase/tests/database/rx_lines_command.test.sql`; new `app/api/prescriptions/medicines/route.ts`;
`features/prescriptions/{service.ts,actions.ts,schema.ts}`; new `features/prescriptions/lines.ts` (pure: stored item ↔ `RxLine`, duration text ↔ days, the
change payload); `lib/clinical/rx.ts`, `components/clinical/{rx-entry-row.tsx,rx-line-item.tsx}`, `app/dev/ui/sections/clinical-b.tsx`; new
`components/consultation/workspace/sections/prescription-section.tsx`, new `components/consultation/workspace/use-rx-lines.ts`;
`components/consultation/workspace/{consult-workspace.tsx,history-list.tsx}`; deleted `components/consultation/{prescription-builder.tsx,frequent-rx-chips.tsx}`;
`scripts/ci/react-compiler-waivers.json`; `tests/ci/no-client-command-chains.spec.ts`; `lib/db/errors.ts`; `lib/audit/audit.ts`; `scripts/perf/command-latency.ts`;
new `tests/prescriptions/{change-prescription-rpc,medicine-search-route,rx-lines}.spec.ts`; `tests/clinical/rx.spec.ts`; new `tests/e2e/consult/rx-keyboard.spec.ts`;
the fixture fallout; registries.

1. Tracer (one vertical slice, committed first). Write `rx-keyboard.spec.ts` "one medicine by keyboard" first, red on the current build: own doctor, a
   synthetic CDCI brand, a consult in draft; press `M` (shortcuts switch on) or Alt+4 then Tab, type four letters, Enter, `2`, `5d`, Enter; reload; the
   database holds one `prescription_items` row with that `medicine_name`, `dosage` "1-0-0", `duration` "5 days", `timing` null, `cdci_brand_id` set, and the
   `ux` count shows 0 clicks. Then build only that path: the migration's `search_medicines` and the `add` branch of `change_prescription`, the route, the
   service and action, RxEntryRow's async `search` prop, the Prescription section with the entry row and the line list. Acceptance: red on the v1 builder
   (Enter does nothing), green on the slice.
2. Migration 000117. (a) `tenants.rx_paper_size text NOT NULL DEFAULT 'A4'` and `tenants.rx_letterhead_mode text NOT NULL DEFAULT 'blank_paper'` with
   CHECKs; CHECK `BETWEEN 0 AND 300` on `letterhead_top_margin` and `letterhead_bottom_margin`; `prescriptions.paper_size text NOT NULL DEFAULT 'A4'` with a
   CHECK (covered by the 000108/000109 column grant and seal guard: assert in pgTAP that it cannot change after INSERT); `cdci_generics.substance_ids text[]
   NOT NULL DEFAULT '{}'` with a GIN index (filled by the CDCI seed, 09C-02; written here so the search reads it once). (b) `public.search_medicines(uuid, text,
   integer)` per R-3; `DROP FUNCTION public.search_medicines(text, uuid, uuid, integer)`. (c) `public.change_prescription` per R-2. (d) Reason codes reuse
   `DRAFT_LOCKED`, `NOT_FOUND`, `INPUT_INVALID`; `prescription.lines_change` command-only; `prescription.item_add` and `prescription.item_remove` leave the
   client-action list once no writer remains; metadata keys `added`, `updated`, `removed`. (e) Writer inventory first (record it:
   `grep -rn "from(\"prescription_items\")\|from(\"prescriptions\")\|from(\"doctor_custom_medicines\")" app features lib components` plus SQL writers), then the
   R-2 contract revokes. Header comment names R-2, R-3, R-12 (print columns) and states "additive columns, a new read and command, the old search dropped,
   grant narrowing after inventory".
3. Service, action, route. `changePrescription(ctx, {visit_id, changes, client_request_id})` validates with zod (`prescriptionItemSchema` rules), calls the
   command through `callCommand`, maps `DRAFT_LOCKED` and sealed refusals to the fixed texts (09A R-17), `NOT_FOUND` to "This medicine is no longer on the
   prescription."; action `changePrescriptionAction` (`prescriptions:edit`). Delete `addPrescriptionItem`, `removePrescriptionItem`, `getOrCreateDraftPrescription`
   and the `searchMedicines` action and service, with their guard-manifest rows; add the route's row.
4. Client. `lib/clinical/rx.ts`: `DEFAULT_DOSE` removed, `usual` optional and partial-safe; RxEntryRow: `search` prop, a pending dose with no values when
   there is no usual, Enter's refusal text per R-4; `use-rx-lines.ts`: lines from the server, pending lines, `useCommand` with one id per attempt, Undo;
   `prescription-section.tsx`: entry row, `<ol>` of RxLineItem with pill edit, remove with Undo toast, Templates sheet (apply = one `change_prescription` with
   the template's lines; save unchanged), `onItemsChange` kept for the counts, the summary pane and Sign & Bill. Repeat Rx (history list and the section's
   "Repeat last Rx") becomes one `change_prescription` call with the past lines (09C-03 moves it to the server-side copy); the no-client-command-chains
   exception is removed and the spec covers `components/consultation` for the deleted writers. The builder and the chips are deleted with their waivers.
5. Specs. `change-prescription-rpc.spec.ts` (shared command rules) plus: add creates the header once with the clinic's letterhead mode and paper size; two
   parallel adds on a fresh visit create one header and contiguous sort orders; update changes dose fields only and keeps the id; an update or remove id from
   another visit or clinic is `NOT_FOUND` with nothing written; sealed, unsigned completed and cancelled are `DRAFT_LOCKED` with rows unchanged; amending is
   allowed; a custom line raises `use_count` by one and stores its dose; owner and doctor allowed, nurse, receptionist and admin refused; a direct JWT
   insert, update or delete of `prescription_items` is refused after the narrowing (fails without the revoke). `medicine-search-route.spec.ts`: 401, 403 for
   nurse and receptionist, 503 when Auth is unavailable, exact keys, `no-store`; `(`, `!`, `&`, `:`, `%`, `_` and `\` return 200 with literal matching; the
   caller's custom medicines first and never another doctor's; no CDCI row carries a dosage, timing or duration. `rx-lines.spec.ts` (pure table, at least 15
   cases: durations "5 days", "1 week", "1 month", "Continue" kept as text, null timing). `tests/clinical/rx.spec.ts`: no default dose. pgTAP
   `rx_lines_command.test.sql`: columns and CHECKs, `paper_size` frozen after INSERT, the old search gone, the new search's grants, the command catalog and
   grants, the column privileges after the narrowing (`has_table_privilege`, `has_column_privilege`), the seal guard still refusing the definer body on a
   sealed visit. `rx-keyboard.spec.ts` adds: three medicines without the mouse (acceptance 1; `ux` 0 clicks); a custom medicine's stored dose accepted with
   Enter, Enter; no usual dose: Enter after the pick says why and stores nothing; edit a committed line's duration in at most 3 taps (V2-DX D4; same id,
   new duration); remove then Undo leaves one row with the same values; a lost response (`commit-then-abort.ts` on the action) is retried and stores one
   line; aborting every attempt keeps the line in the dose builder with the error and Enter stores one; a sealed consult shows the lines with no entry row
   or pills; amending accepts a line; at 360 the entry row and dose builder fit with no horizontal scroll (pixel-7).
6. Fallout and registries. Grep hits: `m0/consult-rx-finish` and `a11y/amendment-screens` (B-1 "a staged drug does not survive the sign-off refresh":
   same assertion, new selectors), journey 6, `keyboard-golden`, unit specs that mounted the builder, fixtures that inserted items with a JWT. Latency:
   `change_prescription` and `search_medicines` (seed 20,000 synthetic CDCI rows in the latency script only). Registries as the shared rules.

Tests: pgTAP `rx_lines_command` plus the changed files, then full `npm run test:pgtap` (grants on clinical tables change); Vitest
`tests/prescriptions tests/clinical tests/consultation tests/security tests/audit tests/authz tests/commands tests/ci tests/integration`.
E2E lane: `npm run e2e:build`, then `npx playwright test tests/e2e/consult/rx-keyboard.spec.ts tests/e2e/m0/consult-rx-finish.spec.ts tests/e2e/a11y/amendment-screens.spec.ts tests/e2e/a11y/consult-screens.spec.ts tests/e2e/consult/keyboard-golden.spec.ts tests/e2e/consult/workspace-layout.spec.ts tests/e2e/journeys/journey-06-consult.spec.ts --project=desktop-chrome --project=pixel-7`.
Done: the lane green with no retry; the tracer's fails-without proof and the narrowing's fails-without proof recorded; no reference to the deleted files
(grep in the notes); the waiver file shrank by two entries; `change_prescription` p95 under 150 ms and `search_medicines` p95 under 50 ms.
Split point: if the session runs out after step 3, edit in place, Undo and the Templates sheet (part of step 4) move to the start of 09C-03; the tree
stays green and the v1 builder is not restored.

### 09C-02 Allergy check, allergy recording, safe defaults · M-L · migration 000118_rx_allergy_check

Goal: R-6 to R-8. A known allergen triggers an inline warning before the medicine is added, the database refuses it without a reason, and the three
allergy states are true again.

Files: `supabase/migrations/000118_rx_allergy_check.sql`; new `supabase/tests/database/rx_allergy_check.test.sql`; new `scripts/seed/cdci-parse.ts`
(pure `parseGenericSubstanceIds`, no side effects) and `scripts/seed-cdci.ts` (imports it; never run here); new `features/prescriptions/allergy.ts`; `features/prescriptions/{service.ts,actions.ts,schema.ts}`;
`features/patients/{service.ts,schema.ts,actions.ts}` (`recordPatientAllergies`); the registration forms the grep finds (`components/clinical/quick-register-form.tsx`,
`components/front-desk/{register-patient-sheet,walk-in-sheet,booking-sheet}.tsx`); new `app/api/terminology/substances/route.ts`;
`features/terminology/{service.ts,search.ts}`; new `components/clinical/allergy-editor.tsx`; `components/clinical/allergy-banner.tsx` (the record action);
`components/consultation/workspace/{allergy-strip.tsx,consult-workspace.tsx,sections/prescription-section.tsx}`; `components/clinical/{rx-entry-row.tsx,rx-line-item.tsx}`;
`app/(dashboard)/consultation/[id]/page.tsx` (`rx_allergy_context`); new `tests/prescriptions/{allergy-match,allergy-check-rpc}.spec.ts`, new
`tests/patients/{record-allergies-rpc,allergy-states}.spec.ts`, new `tests/terminology/substance-search-route.spec.ts`, new `tests/prescriptions/cdci-generic-substances.spec.ts`;
new `tests/e2e/consult/rx-allergy.spec.ts`; registries.

1. Migration 000118. (a) `prescription_items.allergy_override jsonb` with a CHECK on its shape (`reason` 5-300 characters, `allergens` 1-50 strings of at most
   200, `by` uuid, `at` timestamptz); an index on `lower(btrim(cdci_substances.substance_name))`. (b) `private.allergy_substance_ids(text[])`,
   `private.rx_line_substance_ids(cdci_brand_id, generic_name)` and `private.rx_allergy_matches(p_allergies text[], p_substance_ids text[], p_names text[])`
   (R-7 rule (a) and (b); EXECUTE revoked from everyone). (c) `change_prescription` replaced from its 000117 body: the R-7 check on every add, the optional
   `allergy_override_reason` key, an update may set the override on a line that now matches, the entitlement resolved in SQL, `ALLERGY_MATCH` (P0001),
   audit metadata `allergy_overrides`. (d) `public.rx_allergy_context(p_tenant_id, p_visit_id)` (INVOKER): the allergy state (`not_recorded`, `none`,
   `known`), each allergy string with its substance ids (empty = not coded), each current item with the strings it matches and whether it carries an
   override. (e) `public.search_substances(p_tenant_id, p_query, p_limit)` (INVOKER; `consultations:view`; prefix then trigram on substance names; escaped).
   (f) `public.record_patient_allergies` per R-8. (g) `private.patient_input_normalize` replaced from 000101:207: absent or null `allergies` stays NULL; every
   other rule unchanged. (h) Reason code `ALLERGY_MATCH`; audit `patient.allergies_record` (command-only), metadata keys `allergy_overrides`, `allergies_count`,
   `coded_count`. Header comment names R-6 to R-8 and states "additive column, helpers, replaced command and normalizer, two reads, one command".
2. CDCI mapping. `scripts/seed-cdci.ts` loads `substance_ids` from `GenericMaster.txt` column 3 (`+`-separated, trimmed, empty dropped) through
   `parseGenericSubstanceIds` in `scripts/seed/cdci-parse.ts`; `cdci-generic-substances.spec.ts` imports only that module (never `seed-cdci.ts`, which loads
   `.env` and creates an admin client at import) and covers it on a synthetic TSV string. The production and staging load is a PO action (`09C-P4`); until it
   runs, CDCI lines have no substances and are matched by name only (R-7 (b)), which the UI says.
3. Patient side. Registration and the front-desk sheets send no `allergies` key; `newPatientPayload` keeps NULL; `updatePatient` sends allergies only when
   changed with NULL ≠ `[]`. `allergy-editor.tsx`: the substance typeahead (Combobox on the route, abort per keystroke), free text, chips with "Checked against
   medicines" or "Not a listed substance: checked by name only", an explicit "No known allergies" choice, Save through `recordPatientAllergies` (one command).
   The strip's "Record now" and "Edit" open it in a `ResponsiveSheet` while the record is editable and the role may record allergies.
4. Rx side per R-7: result chip, dose-builder match with "Prescribe anyway…" and its reason (RxLineItem's existing pattern), overridden lines with their
   reason, existing unresolved matches with confirm or remove, the not-recorded hint, "Checked by name only"; the client pre-check uses the search result's
   `substance_ids` and `rx_allergy_context`; the server's `ALLERGY_MATCH` shows "This medicine matches a recorded allergy. Review it and give a reason to
   prescribe it." and keeps the line in the dose builder. Not entitled: nothing of this is shown and the command does not check.
5. Specs. `allergy-match.spec.ts`: one shared table (at least 25 cases: coded string ∩ ids, a multi-substance generic, case and spaces, a string that is not a
   substance, a custom line by name, a word inside a longer word does not match, a brand recorded as the allergy, no allergies, none recorded, not recorded)
   run against the TS function and, through the local database, against `private.rx_allergy_matches` with identical results. `allergy-check-rpc.spec.ts`: a
   matching add without a reason is `ALLERGY_MATCH` with no row and no audit; with a reason the line stores the override and the audit counts it; three
   lines with one matching and no reason store nothing; an update confirms a later match; entitlement overridden off adds without a reason; the reason never
   appears in `audit_logs`. `record-allergies-rpc.spec.ts` (shared command rules): doctor and nurse allowed, receptionist and admin refused, `[]` vs a
   list, duplicates removed, 51 strings refused, another clinic `NOT_FOUND`. `allergy-states.spec.ts` (DB): QuickRegister and the register command store
   NULL with no allergies entered (fails without the fix); a clinical-role demographics edit keeps NULL (fails without the fix); an explicit `[]` stays `[]`.
   Route spec for substances (401, 403 receptionist, keys, `no-store`, escaped input). pgTAP `rx_allergy_check.test.sql`: column and CHECK, helper grants,
   the command refusal and override on every path (doctor, owner), the normalizer, the new command's catalog and grants, the reads return nothing across
   clinics. `rx-allergy.spec.ts`: a patient with "Amoxicillin" recorded through the editor's typeahead; searching a synthetic brand whose generic contains
   amoxicillin shows the result chip; Enter opens the dose builder with "Matches allergy: Amoxicillin"; Enter without a reason stores nothing; "Prescribe
   anyway…" with a reason stores the line and its override (acceptance 3); a free-text "Augmentin" allergy flags a custom "Augmentin 625" line by name; a newly
   registered patient shows "Allergies not recorded" and "Record now" records "No known allergies"; the strip is still on screen while the sheet is open.

Tests: pgTAP `rx_allergy_check`, `rx_lines_command`, the patient and grants files, then full `npm run test:pgtap` (a replaced normalizer used by the
front-desk commands); Vitest `tests/prescriptions tests/patients tests/terminology tests/today tests/consultation tests/security tests/audit tests/authz tests/commands tests/ci`.
E2E lane: `npm run e2e:build`, `npx playwright test tests/e2e/consult/rx-allergy.spec.ts tests/e2e/consult/rx-keyboard.spec.ts tests/e2e/consult/workspace-layout.spec.ts tests/e2e/a11y/consult-screens.spec.ts tests/e2e/journeys/journey-03-register-patient.spec.ts tests/e2e/today --project=desktop-chrome --project=pixel-7`.
Done: acceptance 3 green; the two default-fix fails-without proofs and the `ALLERGY_MATCH` fails-without proof recorded; `record_patient_allergies` p95
under 150 ms; `rx_allergy_context` and `search_substances` p95 under 50 ms; the lane green with no retry.
Split point: if needed, steps 3 and the editor half of step 5 (the recording command stays in the migration) become 09C-02b before 09C-03.

### 09C-03 Rx Smart Assist: favourites, your usual, Same as last visit · M · migration 000119_rx_assist

Goal: R-9 and R-10. Three medicines in one tap for the usual case, three taps from favourites, the last visit repeated in one tap, all from the right
person's signed history only.

Files: `supabase/migrations/000119_rx_assist.sql`; new `supabase/tests/database/rx_assist.test.sql`; `features/consultation/{service.ts,assist-ranking.ts}`;
`features/prescriptions/{service.ts,actions.ts}` (`repeatVisitPlan`, template ranking); `components/consultation/workspace/{sections/prescription-section.tsx,history-list.tsx,consult-workspace.tsx}`;
deleted `getFrequentPrescriptionsAction` (`features/ai/actions.ts`), `lib/ai/prescription-suggestions.ts`, the `PrescriptionSuggestion` type if unused,
`tests/ai/prescription-suggestions.spec.ts`; `scripts/ci/ai-l1-greps.mjs` lists; new `tests/prescriptions/{rx-favourites-db,repeat-visit-plan-rpc}.spec.ts`;
`tests/consultation/assist-ranking.spec.ts` (extended); new `tests/e2e/consult/rx-assist.spec.ts`; registries.

1. Migration 000119: `consult_assist_context` replaced from its 000113 body adding `rx_favourites` and per-diagnosis `rx` per R-9 (the empty result for
   callers without `consultations:edit` gains the two keys); `public.repeat_visit_plan` per R-10 (uses `private.rx_allergy_matches`); audit `visit.repeat_plan`
   (command-only, counts). Measure `consult_assist_context` on the R-17 seed; an index only if the plan shows a sequential scan, said in the notes.
2. Ranking and UI: `assist-ranking.ts` adds favourite and bundle selection (bundle for each current diagnosis, at most two tiles; favourites not already
   on the Rx) and template ranking (pure, tables); the section's suggestion row: bundle tiles, "Same as last visit · {clinic date}" (from the history the page
   already loads), favourite tiles with "your usual" doses, labels and gating per R-9; the "Repeated" marker; allergy pre-check per R-9; `skipped_item_ids`
   from a repeat open in the dose builder flagged. "Repeat this Rx" in the history list calls the command with `{prescription}`.
3. Delete the A4 path and its L1 list entries; the 09C-01 client repeat payload goes.
4. Specs. pgTAP `rx_assist.test.sql`: two doctors in one clinic and a third clinic, each with signed visits: the context of doctor A holds only A's medicines
   (never B's, never the other clinic's), unsigned and superseded versions are not counted, `usual` reproduces stored values including nulls, no output
   value is an id, nurse, receptionist and admin get the empty result; the repeat command's catalog and grants. `rx-favourites-db.spec.ts` (the roadmap's
   "SA-02 never returns another doctor's Rx", Vitest on real rows through the service): B's identical diagnosis with different medicines never appears in A's
   favourites or bundle; fails on the deleted library's behaviour (recorded once by running the old query against the same rows before deletion).
   `repeat-visit-plan-rpc.spec.ts` (shared command rules): same patient only, a signed source only, another clinic's visit `NOT_FOUND`, duplicates skipped,
   an allergy-matching line skipped and returned by id, sealed target `DRAFT_LOCKED`, diagnoses copied with their codes. `assist-ranking.spec.ts` at least 15
   new cases. `rx-assist.spec.ts` (own doctor with seeded signed history): "Your usual for Viral fever" adds three lines in 1 tap, 0 typed (`ux`); three
   favourite tiles add three lines in 3 taps; "Same as last visit" adds the diagnosis and the lines in 1 tap; a favourite without a complete usual opens the
   dose builder; with `assist.frequent_rx` overridden off the favourites and bundle are absent and Same as last visit stays; every check with AI fully
   disabled (no provider env, `ai_features` kill switch on).

Tests: pgTAP `rx_assist`, `consult_assist_context`, `grants`; Vitest `tests/prescriptions tests/consultation tests/ai tests/security tests/audit tests/ci`.
E2E lane: `npm run e2e:build`, `npx playwright test tests/e2e/consult/rx-assist.spec.ts tests/e2e/consult/smart-assist.spec.ts tests/e2e/consult/rx-keyboard.spec.ts tests/e2e/consult/rx-allergy.spec.ts tests/e2e/consult/tap-entry.spec.ts --project=desktop-chrome --project=pixel-7`.
Done: acceptance 4 green with its fails-without record; no A4 code remains (grep); `consult_assist_context` p95 under 50 ms and `repeat_visit_plan` p95
under 150 ms; the lane green with no retry.

### 09C-04 PDF template, print settings, golden files, store decision · M · no migration

Goal: R-11 and R-12. The PDF a patient receives is correct, prints on the clinic's paper, is reproducible, and the storage decision is measured and
recorded.

Files: `features/prescriptions/pdf/{prescription-document.tsx,payload.ts,generator.ts}`; `app/api/visits/[id]/prescription-pdf/route.ts`;
`features/settings/{schema.ts,service.ts}`; new `components/settings/rx-print-card.tsx` and its host page; `components/consultation/workspace/consult-workspace.tsx`
(record bar print entries); deleted `components/consultation/pdf-preview-modal.tsx` and `getPrescriptionPdfSignedUrl` (action, service, guard-manifest row);
new `tests/prescriptions/{rx-golden,rx-pdf-content}.spec.ts` with `tests/prescriptions/golden/` (PDF and text files); `tests/prescriptions/{rx-pdf-archive,rx-archive-signer}.spec.ts`
(texts only if a golden-affected string changes); new `tests/settings/rx-print-settings.spec.ts`; new `tests/e2e/consult/rx-print.spec.ts`.

1. Content per R-12: no default timing; clinic-zone dates (`payload` carries the clinic zone; `signed_at` and `amended_at` formatted through `lib/datetime`);
   the exam section from `exam-text.ts`; complaint durations only when present; neutral Document title and file name; footer without the product name; `℞`
   and every fixed string checked to render in the standard fonts (replaced by "Rx" if it does not).
2. Paper and letterhead: page size from `header.paper_size` (A4 or A5, styles scaled for A5), pre-printed padding from the tenant margins, blank paper as
   today. Settings card (paper size, default letterhead, margins in millimetres converted to points, a line explaining that changes apply to new
   prescriptions) through `updateClinicSettings` (`clinic:manage`, zod ranges).
3. Determinism: `creationDate` and `modificationDate` from the header's `signed_at`; render twice and compare bytes in the golden spec.
4. Goldens. `rx-golden.spec.ts` renders fixed synthetic payloads: A4 blank paper, A4 pre-printed with margins, A5 blank paper, amended v2 with a reason, a
   regenerated copy (S-8 notice), a two-page Rx (continuation header), a name outside the standard fonts (no failure). For each: two renders give identical
   bytes; the bytes equal `golden/<case>.pdf`; `pdfTextLines` equals `golden/<case>.txt`; the page size is the expected one. Goldens are rewritten only with
   `UPDATE_GOLDEN=1 npx vitest run tests/prescriptions/rx-golden.spec.ts` when the template changes on purpose; the text diff is reviewed. `rx-pdf-content.spec.ts`:
   no "After food" for a null timing, no patient name in the title or file name, clinic-zone dates with the server zone set to UTC, the exam lines.
5. Store decision (R-11): sizes of the golden files and the pilot projection go into the notes; the archive code is unchanged and its specs stay green.
6. Print entries: the record bar's "Print Rx" opens the PDF; a second entry prints the other letterhead variant (rendered on demand, never stored, 09A
   R-12); the dead preview modal and its action are deleted.
7. `rx-print.spec.ts` (desktop-chrome; one pixel-7 case): the settings card saves A5 and pre-printed with 40 mm top; a new consult signed afterwards serves a
   PDF whose page size is A5 (read from the bytes) and whose `pdf_sha256` equals the SHA-256 of the downloaded bytes; a visit signed before the change
   keeps A4; the variant entry returns a PDF that is not stored (no new object, the pair unchanged); axe clean on the settings card.

Tests: Vitest `tests/prescriptions tests/settings tests/consultation tests/security tests/ci`; pgTAP unchanged (no migration).
E2E lane: `npm run e2e:build`, `npx playwright test tests/e2e/consult/rx-print.spec.ts tests/e2e/m0/consult-rx-finish.spec.ts tests/e2e/a11y/settings-billing-screens.spec.ts --project=desktop-chrome`, then `npx playwright test tests/e2e/consult/rx-print.spec.ts --project=pixel-7`.
Done: goldens committed and green twice; the projection in the notes; the preview modal gone (grep); the lane green with no retry.

### 09C-05 Finish review, Web Share, camera capture and compression, journey, PO kit · M · no migration

Goal: R-13 to R-15, the roadmap's last acceptance, the whole-consult count and the material for the PO's walkthrough.

Files: `components/consultation/sign-and-bill-modal.tsx` (review screen), new `components/consultation/workspace/finish-review.tsx`,
`components/consultation/workspace/summary-pane.tsx` (shared summary content); `features/billing/{actions.ts,service.ts}` (`send_rx_whatsapp` only);
`features/prescriptions/service.ts` (dedupe key); new `components/clinical/share-pdf-button.tsx`; new `lib/files/compress-image.ts`;
`components/consultation/workspace/attachments.tsx` (Take photo, compression); `components/patients/patient-lab-documents.tsx` (compression only);
new `tests/e2e/support/jpeg.ts` (reads SOF dimensions and APP1 markers from bytes); new `tests/e2e/consult/{finish-review,rx-share,capture-compress}.spec.ts`;
`tests/e2e/journeys/journey-06-consult.spec.ts`; `tests/e2e/consult/keyboard-golden.spec.ts`; `tests/e2e/a11y/consult-screens.spec.ts`;
`tests/e2e/pwa/05-cache-audit.spec.ts`; `.planning/phases/09C-rx-builder-pdf/{09C-PO-WALKTHROUGH.md,09C-DEVICE-CHECKLIST.md}` (Haiku docs agent from this plan).

1. Finish review per R-13. The send runs after a committed sign inside `completeAndBillConsultation`; a failure to queue is shown on the success screen
   with "Send again" and never undoes the sign.
2. Web Share per R-14 on the success screen and the record bar.
3. Camera and compression per R-15 in both upload paths.
4. Specs. `finish-review.spec.ts`: from a consult with complaints, a diagnosis and two lines, "Finish visit" then "Sign and finish" (2 taps) signs, routes the
   fee to reception and queues one `prescription_ready` row for the patient; a replayed sign (lost response) still leaves one queued row; a patient without
   a phone or opted out has the toggle off and no row; an unresolved allergy match disables Sign until confirmed; the review shows the lines and the
   follow-up date in the clinic zone. `rx-share.spec.ts` (navigator.share and canShare stubbed by an init script that records the File): the shared file is
   `application/pdf`, starts with `%PDF-`, is named without the patient's name, and its SHA-256 equals the stored `pdf_sha256`; with canShare false the button
   downloads; `05-cache-audit` after a share finds no part of the PDF in any storage API or Cache Storage. `capture-compress.spec.ts` (desktop-chrome,
   pixel-7, iphone-15): a 4,000 × 3,000 synthetic JPEG with an APP1 Exif segment holding GPS tags, built in the test, uploaded through the "Take photo" input
   (`setInputFiles`), is stored as `image/jpeg` of at most 1 MB with a long edge of at most 2,000 px and no APP1 Exif segment (bytes read from the stored
   object); a PNG screenshot is stored as JPEG within the budget; a PDF is stored byte-identical; the input carries `capture="environment"` and
   `accept="image/*"` on a coarse pointer and is absent on desktop. Journey 6 gains the Rx-by-keyboard leg (three lines, 0 clicks) and the finish through
   the review; a new desktop-chrome case counts the whole consult by tap (3 complaints, template plus one abnormal finding, a likely diagnosis, the usual
   bundle, Finish visit, Sign and finish: at most 10 taps, 0 typed; V2-DX whole-consult row) with seeded history for its own doctor. `keyboard-golden` gains
   the Rx line by keyboard. `consult-screens.spec.ts`: axe on the Rx section (entry open, dose builder, allergy match, favourites), the allergy editor sheet,
   the Templates sheet, the review and the success screen at 360, 820 and 1280.
5. PO kit: `09C-PO-WALKTHROUGH.md` (a 10-minute script: three medicines by keyboard, an allergy match with a reason, your usual and Same as last visit, A5
   print on pre-printed paper, finish in two taps with WhatsApp, Share PDF to WhatsApp from a phone, a photo of a report) and `09C-DEVICE-CHECKLIST.md`
   (low-end Android and an iPad: camera capture, share sheet with a PDF, print through the share sheet, the keyboard over the Rx field, TalkBack and
   VoiceOver on the Rx section and the review).

Tests: Vitest `tests/billing tests/prescriptions tests/labs tests/components tests/consultation tests/ci`.
E2E lane: `npm run e2e:build`, then `npm run e2e:pr` once (the phase's full PR lane), and `npx playwright test tests/e2e/consult/capture-compress.spec.ts tests/e2e/consult/finish-review.spec.ts --project=ipad-gen7 --project=android-tablet-800` once.
Done: acceptance 5 green on the three projects; the whole-consult count at or under 10 taps in the `ux` JSON; the PR lane green with no retry; the PO files
written.

### Close (reviews, fix round, evidence, docs)

1. Reviews, fresh context, given the phase diff and this plan's rulings only. Isolated reviewer (Sonnet): the keyboard path against DESIGN §7.6 and the
   06-09c key rules, "no invented dosing" end to end, the Rx section and sheets at 360, 820 and 1280 against the V2-DX consult-rx captures, the read-only
   contract (diff against the deleted builder's `disabled` handling), the PDF goldens and the text diffs, the finish review's two taps, Smart Assist labelling
   and "never inserts without a tap", tests that assert outcomes. Adversarial reviewer (Opus): `change_prescription` (tenant and permission, item ids of
   another visit, header creation races, sealed bypass, replay and mismatch, size and key abuse, the allergy override path), `record_patient_allergies` (role
   matrix, the R-8 guard), `repeat_visit_plan` (another patient's or clinic's visit, unsigned or superseded source, allergy skip), the grant narrowing (any
   remaining direct write of Rx rows), the reads (`search_medicines` another doctor's custom medicines, `consult_assist_context` another doctor's Rx,
   `rx_allergy_context` and `search_substances` across clinics), both routes (injection through the query, wildcards, keys), the SQL and TS allergy rule
   parity, the registration default, the PDF and Web Share paths (PHI in titles and names, storage APIs), EXIF stripping. One fix round (09C-06a): Highs and
   Mediums fixed with a test that fails without the fix (Opus for security fixes, Sonnet otherwise); Lows cheap and local or to the backlog with an owner;
   Highs re-checked once.
2. Evidence (R-17): `node scripts/phase-evidence.mjs .planning/phases/09C-rx-builder-pdf/evidence 1`; push once; CI green with 0 retried tests; then
   `node scripts/phase-evidence.mjs .planning/phases/09C-rx-builder-pdf/evidence --ci-run <id>`; copy `command-latency.json` (re-run if 09C-06a touched a
   command or read), the `ux` count files, the axe summary, the compression measurements and the golden PDFs (`evidence/pdf-samples/`); the Vitest FLOOR
   re-measured once with the arithmetic in the gate header.
3. Docs (Haiku): `09C-SUMMARY.md`, `09C-VERIFICATION.md` (numbers copied from the tool files), the roadmap V2-09c status line and the §9.1 decision text
   ("decided in V2-09c: one archived object per signed version, everything else on demand"), the FRONTEND_MIGRATION_PLAN appendix rows "Add 3 Rx lines" and
   the whole consult from the `ux` JSON, VERIFICATION_LOG entry with the CI link and SHA, `.planning/ROADMAP.md`, PO-ACTIONS `09C-P1` to `09C-P5`.
4. Gate: approved by delegation if in force, with the CI run recorded (0 retried tests); otherwise the PO approves. The PO is informed either way.

## Acceptance mapping (roadmap §12 V2-09c, the M4 template and the hand-offs)

| Criterion | Proof |
|---|---|
| A 3-drug Rx can be written without the mouse (roadmap 1) | `rx-keyboard.spec.ts` three-line case (`ux` 0 clicks) on desktop-chrome and pixel-7; journey 6 Rx leg on three projects; `keyboard-golden` |
| The PDF matches the golden file and its hash is stored (roadmap 2) | `rx-golden.spec.ts` (byte and text goldens, determinism, seven cases); `rx-print.spec.ts` and `rx-share.spec.ts` (served or shared bytes' SHA-256 = `pdf_sha256`); `rx-pdf-archive`, `rx-archive-signer` unchanged |
| A known allergen triggers an inline warning (roadmap 3) | `rx-allergy.spec.ts`; `allergy-match.spec.ts` (shared TS and SQL table); `allergy-check-rpc.spec.ts`; pgTAP `rx_allergy_check` |
| SA-02 never returns another doctor's Rx (roadmap 4, RLS/DB test) | pgTAP `rx_assist.test.sql`; `rx-favourites-db.spec.ts` with its fails-without record |
| A phone photo is compressed below the agreed size budget before upload (roadmap 5, FT-04) | `capture-compress.spec.ts` on desktop-chrome, pixel-7, iphone-15 and once on two tablets (≤ 1 MB, ≤ 2,000 px, no Exif) |
| Tests named by the roadmap: golden-file PDF tests, Rx builder e2e, allergy-check unit tests | `rx-golden`, `rx-keyboard` and `rx-assist`, `allergy-match` |
| Evidence: CI links, PDF samples, PO walkthrough notes | CI run, `evidence/pdf-samples/`, `09C-P2` with `09C-PO-WALKTHROUGH.md` |
| §9.1 store or regenerate decided | R-11; the projection in the notes and summary; roadmap §9.1 text updated at the close |
| M4 1 functional parity | v1 builder inventory in `09C-NOTES.md` (09C-01): search, staging, presets, custom medicine, special instructions, remove with confirm, templates save and apply, frequent chips, allergy banner, Repeat last Rx, each with its new home and test or an approved removal |
| M4 2 interaction targets | `ux` JSON: 3 lines by keyboard with 0 mouse; your usual 1 tap; favourites 3 taps; edit a line ≤ 3 taps; Same as last visit 1 tap; finish 2 taps; whole consult ≤ 10 taps, 0 typed |
| M4 3 accessibility | `consult-screens.spec.ts` additions at 360/820/1280; keyboard-only Rx path; TalkBack and VoiceOver in `09C-P2` |
| M4 4 responsive | Rx specs on desktop-chrome, pixel-7, iphone-15; tablets once in 09C-05 |
| M4 5 resilience | lost response and abort-every-attempt cases in `rx-keyboard`; replayed sign in `finish-review`; double submit = replay in the command specs |
| M4 6 performance | `npm run ci:route-js` number in the notes (the v1 builder and chips leave the route; report-only budget, V2-14 backlog stands); command and read p95 in `command-latency.json` |
| M4 7 data integrity | one command per Rx change, per repeat and per allergy record; the Repeat Rx exception removed from `no-client-command-chains.spec.ts`; grant narrowing pgTAP |
| M4 8 observability | command failures logged by tag (`prescriptions.change.failed`, `patients.allergies_record.failed`, `files.compress.failed`), never content |
| M4.4 Rx: allergy banner always visible; suggestions marked until accepted | allergy strip assertions kept in `workspace-layout`; "Repeated" marker and SmartAssistLabel in `rx-assist` |
| PWA-12 Rx part | `rx-share.spec.ts`, `capture-compress.spec.ts`, device checklist |
| V2-09b hand-offs | 09C-01 (keyboard, route, Repeat exception), 09C-03 (favourites, usual, Same as last visit), 09C-04 (structured exam on the PDF, preview resolved), 09C-05 (finish review, two taps, whole-consult count, camera beside FileDrop, journey 6 leg) |
| V2-09a hand-offs | R-11 keeps write-once; goldens; R-A unchanged |
| Latency condition on definer commands | `change_prescription`, `record_patient_allergies`, `repeat_visit_plan` p95 under 150 ms |

## Source audit

| Source | Items | Covered by |
|---|---|---|
| GOAL | fast, safe prescriptions with a printable, trustworthy output | 09C-01 (fast), 09C-02 (safe), 09C-04 (printable, trustworthy), 09C-05 (finish and share) |
| REQ | P1-32 Rx part: keyboard Rx | 09C-01 |
| | P2-10 Rx print stylesheet and letterhead | 09C-04 (R-12; the HTML stylesheet per Q-2) |
| | AI-08 Rx favourites fix (doctor filter, no invented defaults, protocol ranking) | 09C-03 (R-9), 09C-01 (R-4) |
| | AI-11 allergy check, substance level | 09C-02 (R-6 to R-8) |
| | PWA-12 camera capture, Web Share of the Rx PDF | 09C-05 (R-14, R-15) |
| | FT-04 client-side image compression | 09C-05 (R-15) |
| | §9.1 store or regenerate | 09C-04 (R-11) |
| RESEARCH (docs) | DESIGN §7.2, §7.6, §7.10, §8; AI §5.2 SA-02/SA-07, §5.3, AIR-5/7, D-9; PWA §4 D-3/D-6/D-7, §6.5; M4 template and M4.4; V2-DX counts D1-D4, E, whole consult | R-4 to R-15; acceptance table |
| CONTEXT (rulings) | PO-15 (no flags, delete v1), PO-21/PO-22 (no AI sold; no clinician sign-off: substance level only), PO-8 (Rx WhatsApp is a user-chosen send, not a reminder), ADR-0005, ADR-004, ADR-016, ADR-019, lean process, delegation 2026-11-21, V2-08 latency condition, TARGET §3.9, 09A R-12/R-A/S-8, 09B R-2/R-8/R-U | R-1, R-2, R-7, R-11, R-13, R-16, R-17; Execution |
| Hand-offs | 09B (eleven items), 09A (three items), 06 (two waivers, the clinical parts) | Carried in; acceptance table |

No item is unplanned. Items outside this phase are under Deferred.

## Threat register (STRIDE; security_enforcement on)

| ID | Cat. | Component | Sev. | Disposition | Mitigation |
|---|---|---|---|---|---|
| T-09C-01 | E / T | `change_prescription` (new definer command) | high | mitigate | V2-07 guard block (actor, active full clinic, `prescriptions:edit`), item ids bound to the visit's header, `DRAFT_LOCKED` before any write, key allow-list, sizes, brand ids checked, 09A seal guards still fire, catalog test, role matrix, cross-tenant case, fails-without proofs |
| T-09C-02 | T / R | Direct PostgREST writes of Rx rows bypassing the command, its audit and the allergy check | high | mitigate | INSERT/UPDATE/DELETE on `prescription_items`, INSERT on `prescriptions` and writes on `doctor_custom_medicines` revoked from `authenticated` after the inventory; pgTAP privileges; the header PDF-pair column grant stays (R-A) |
| T-09C-03 | I | `search_medicines` and the medicines route | medium | mitigate | INVOKER, doctor = `auth.uid()` (no caller id), escaped input and no `to_tsquery` on input, fixed error bodies, exact keys, `no-store`; rate limiting V2-12 (accepted until then, as T-09B-06) |
| T-09C-04 | I | `consult_assist_context` Rx keys (SA-02) | high | mitigate | `visits.doctor_id = auth.uid()`, signed versions only, names and counts only, roles without `consultations:edit` get the empty result; two-doctor and two-clinic pgTAP and Vitest cases (roadmap acceptance 4) |
| T-09C-05 | Safety (T) | Allergy check false negatives (uncoded strings, unmapped medicines, related salts, classes, CDCI mapping not loaded) | high | mitigate / accept | Server-side check in both commands; name matching for unmapped lines; visible "not checked" and "checked by name only" states; "not recorded" restored (R-8); class level and salt relations deferred (D-9, AIR-7); advisory with a reason (AIR-5); `09C-P4` loads the mapping before UAT |
| T-09C-06 | Safety (T) / R | Allergy override | medium | mitigate | The server computes the match itself (the client cannot claim no match); a reason of 5-300 characters stored on the line with actor and time; audited by count; the review blocks Sign while a match is unresolved |
| T-09C-07 | E | `record_patient_allergies` and the registration default | medium | mitigate | The 000055 rule (front desk cannot change allergies) inside the command; role matrix; NULL kept for "not recorded" with fails-without tests |
| T-09C-08 | T / I | `repeat_visit_plan` | medium | mitigate | Source must be a signed visit of the same patient in the same clinic; rows copied from the database, never from input; allergy-matching lines skipped and reported by id; shared command rules |
| T-09C-09 | I | PHI on the device and in names (PDF fetch for Web Share, titles, file names) | medium | mitigate | PDF held in memory only and dropped on unmount; no storage API; route `no-store`; Document title and file names without the patient's name (PWA D-7); cache audit after a share |
| T-09C-10 | I | Location metadata in photos | medium | mitigate | Re-encoding drops EXIF and GPS (asserted on stored bytes); the fallback original path only when decoding fails, within 4 MB, logged by tag |
| T-09C-11 | T / R | PDF integrity | medium | mitigate / transfer | 09A write-once pair, hash check on read, S-8 notice, unchanged; reproducible bytes for a signed version; R-A residual (a signer could archive different bytes) stays with the PO (trusted `rx.archive` job, V2-14) |
| T-09C-12 | I | Rx-ready WhatsApp message preselected | low | mitigate / transfer | Preselected only with a phone and no opt-out; the doctor sees the toggle before signing; the message carries the existing link template (DATA_HANDLING MSG91/Meta row); dedupe key; PO acknowledges (Q-8) |
| T-09C-13 | D | Typeahead volume on two new routes; Rx command volume | low | accept | Result limits (15), query length cap, abort per keystroke; rate limiting V2-12; `command_results` purge V2-13 |
| T-09C-SC | T | npm installs | high | mitigate | No new package in this phase; any addition needs the package-legitimacy gate and a blocking human checkpoint |

## Risks

| Risk | Plan response |
|---|---|
| The builder rebuild drops a v1 capability or breaks a 09A rule (B-1, read-only) | v1 builder inventory first (09C-01); the 09A and M0 specs keep their assertions; the isolated reviewer diffs the read-only handling against the deleted file |
| CDCI substance ids are not loaded in production, so the check sees no substances for CDCI medicines | Name matching still runs; the UI says "checked by name only"; `09C-P4` (PO) loads the mapping on staging and production before UAT; V2-15 checklist line added at the close |
| Byte goldens break on an `@react-pdf` upgrade | Text goldens give the readable diff; the update command is explicit; the archive stores bytes, so old signed versions are unaffected |
| Safari blocks `navigator.share` after an asynchronous fetch | Prefetch on mount; Download fallback; device checklist |
| `createImageBitmap` or HEIC fails on a device | Original sent when within 4 MB, else a fixed refusal; device checklist with an iPhone photo from the library |
| Grant narrowing breaks fixtures that insert Rx rows with a JWT | Grep-first rule; fixtures move to the command or the service role on unsigned visits; pgTAP files that need the old grant widen it inside their own transaction, as 09A-06a and 09B-01 did |
| The registration default change surprises front-desk specs | `allergy-states.spec.ts`; affected V2-08 specs adapted in intent ("not recorded" instead of "none") and listed in the notes |
| e2e lane time (85 minutes today) | Few new specs; viewport-independent cases on desktop-chrome only; the PO's sharding decision (`09B-P5`) stands |
| 09C-01 and 09C-02 are the largest plans | Split points named; each plan leaves the tree green |
| The roadmap sizes V2-09c as M; five plans are closer to L | Recorded; the lean rules keep one review and one fix round |

## Deferred, with owner

| Item | Owner |
|---|---|
| Class-level allergies and salt relations (D-9; curated class table and its sign-off) | v2.1 |
| SA-06 duplicate-therapy check (P2, "if time permits"; the substance mapping it needs lands here) | v2.1 (Q-11) |
| SA-05 dose calculator, SA-08 interactions | v2.1 (unchanged) |
| Receipt print and letterhead (P2-10 receipt part), invoice PDF Web Share, manifest shortcuts (rest of PWA-12) | V2-10 (Q-10) |
| Allergy editor in the patient profile and for the nurse's Today path; clinic logo upload and drawing it on the letterhead | V2-11 |
| v1 API Rx writes through the command (and so the allergy check); rate limits on the medicine and substance routes | V2-12 (P1-37, S-6) |
| Trusted `rx.archive` job (R-A residual); direct-to-Storage uploads above 4 MB; route JS budget | V2-14 (PO decisions where marked) |
| QR code to `/r/[token]` on the PDF (needs a library and a token-lifetime rule); Hindi text on the PDF (P3, a Devanagari font) | v2.1 backlog |
| Staging migrate of 000117 to 000119; CDCI reload with substance ids on staging and production | PO (`09C-P3`, `09C-P4`, not delegated) |

## Open questions and the default taken (PO away)

| # | Question | Default |
|---|---|---|
| Q-1 | Rx PDFs stored or regenerated on demand (§9.1, "decided in V2-09c") | Store exactly one write-once object per signed version (hash stored, roadmap acceptance 2); everything else on demand (R-11). The measured projection is reported; the PO is asked before the gate only if it exceeds 10 % of the Free Storage quota per UAT month |
| Q-2 | DESIGN §7.10 asks for an `@media print` stylesheet; the server PDF was to stay for WhatsApp only | The PDF is the single printed rendering, with A4/A5 and letterhead settings: one legal document, one rendering, golden-tested (DESIGN §7.6 "Print: the same order and wording as on screen"). No HTML print view. PO to acknowledge (deviation from an approved design document) |
| Q-3 | How allergies are coded (SA-07) | The CDCI substance name stored as the allergy string, matched case-insensitively; no new patient column (R-6). Alternative (an id column beside the strings) kept for v2.1 if CDCI renames substances |
| Q-4 | Length of the "Prescribe anyway" reason | 5 to 300 characters (amendment reasons are 10 to 500; a clinical override is often short, e.g. "Tolerated before") |
| Q-5 | Should signing be refused in the database while an allergy match is unresolved | No: the review sheet blocks Sign in the UI, and the commands enforce the check when a medicine is added; the 09A sign command is not changed (advisory per AIR-5). A database sign gate can be added in V2-14 if the PO wants it |
| Q-6 | Registration records "No known allergies" when nothing was entered | Fixed: NULL (not recorded) unless allergies were entered or "No known allergies" was chosen in the allergy editor (R-8). Front-desk behaviour changes: new patients show "Allergies not recorded". PO to acknowledge |
| Q-7 | The agreed size budget for photos (FT-04; PWA §6.5 says ≤ 2 MB) | At most 1 MB per image, long edge at most 2,000 px (within PWA §6.5; Free Storage is 1 GB) |
| Q-8 | WhatsApp send preselected on the review (approved V2-DX) while PO-23(h) lists WhatsApp for reminders and billing notices only | Preselected when the patient has a phone and has not opted out; the doctor sees it before signing; DATA_HANDLING's MSG91/Meta row already covers document links. PO to acknowledge and add the Rx-ready message to the PO-23(h) list |
| Q-9 | Product name on the printed Rx ("Generated by ClinicOS" today; the brand is now "CliniQ AI") | Not printed: a clinic's prescription carries the clinic's identity, and "CliniQ AI" on a clinical document could read as AI authorship. Footer "Rx v{n} · Page x of y" |
| Q-10 | PWA-12's manifest shortcuts | V2-10 with the rest of PWA-12 (roadmap V2-09c scope names camera and Web Share only) |
| Q-11 | SA-06 duplicate therapy ("if time permits", AI-11 row) | v2.1 (lean process); the substance mapping it needs is loaded here |
| Q-12 | Can the allergy check be switched off | Yes, only by a platform entitlement override of `assist.allergy_check` (the kill switch for a bad mapping); UI and command read the same key; the AI kill switch never affects it |
| Q-13 | Who may search medicines | `prescriptions:edit` (owner, doctor): the people who prescribe |
| Q-14 | "Same as last visit" from a visit signed by another doctor of the clinic | Allowed (same patient, same clinic, signed), as the 09B snapshot already shows it |
| Q-15 | Journey numbering for the Rx leg | Journey 6 gains the Rx-by-keyboard leg (09B Q-1 read) |
| Q-16 | The PDF preview "onto Dialog" (09B Deferred) | The preview has no caller; deleted with its action |
| Q-17 | Dose when the doctor has no usual for a medicine | None: the builder asks for a frequency and a duration (R-4) |

## Execution (lean process)

- Executors: Sonnet `gsd-executor`, one plan at a time, in the order above, migration numbers as in the front matter (renumber at start). Never set a
  mode when starting a subagent (CLAUDE.md). Each plan runs only its affected Vitest and pgTAP files (full pgTAP in 09C-01 and 09C-02) plus its one e2e
  lane; 09C-05 runs the full PR lane once; CI runs everything after the push, once for the phase. The evidence run at the close is the only full Vitest
  run; the FLOOR is re-measured from it once.
- One "fails without" proof per High control only (09C-01: the tracer and the narrowing; 09C-02: `ALLERGY_MATCH` and the two default fixes; 09C-03: SA-02).
  No mutant runs.
- Reviews: Sonnet for the isolated review; Opus for the adversarial review, security fixes and hard debugging; Haiku for docs, evidence and the PO kit.
  One review round, one fix round (09C-06a).
- Evidence: one run (`... evidence 1`) plus CI (R-17). Push once.
- Branch `v2/phase-09c-rx-builder-pdf` off `feature/v2`; PR into `feature/v2`; never `main`; no force-push; local stack only, never hosted Supabase.
- PO-ACTIONS at the close: `09C-P1` gate (delegated if in force), `09C-P2` walkthrough and device run (the two kit files, about 30 minutes, including A5
  pre-printed paper on a real printer), `09C-P3` staging migrate of 000117 to 000119 after `09B-P4` (not delegated), `09C-P4` CDCI reload with substance
  ids on staging, and on production at V2-15 (hosted; PO only), `09C-P5` acknowledgement of Q-1, Q-2, Q-6, Q-8, Q-9.
- New dependencies: none.

## CTO delegate rulings on the defaults (2026-11-22)

These override the defaults above where they differ. Rule applied: a default may not depart from an approved document;
where it would, the approved document stands and the change goes to the PO.

- **Q-2 overruled.** DESIGN_SYSTEM §7.10 is approved: an `@media print` stylesheet for the Rx (A4/A5, letterhead from
  settings, configurable margins for pre-printed letterhead) plus the server PDF for WhatsApp delivery. 09C-04 builds the
  print stylesheet on the signed Rx view, sharing the A4/A5, letterhead and margin settings with the PDF. Keep it small:
  one print stylesheet, no separate print route unless the existing view cannot carry it.
- **Q-8 overruled.** WhatsApp is **not** preselected on the finish review. PO-23(h) accepts WhatsApp processing for
  reminders and billing notices; preselecting Rx delivery by WhatsApp widens that default and is the PO's call (09C-P5).
  The channel choice stays one tap.
- **Q-9 overruled.** The printed product line stays as it is today; dropping or rewording branding on the prescription
  is a product decision for the PO (09C-P5). The page and version line ("Rx v{n} · Page x of y") is added alongside it.
- Q-1, Q-3…Q-7, Q-10…Q-17: defaults approved as written.
