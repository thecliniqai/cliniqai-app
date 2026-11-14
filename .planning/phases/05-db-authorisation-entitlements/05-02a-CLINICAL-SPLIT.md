---
phase: 05
plan: 05-02a
subsystem: database authorisation (clinical split, expand + migrate)
status: complete
requirements: [P1-01, PO-3, SVP §6.1 "visits.clinical_notes", R-2, R-3, R-4, R-5, R-37]
plan_head_before: 70c59d672de3ece3d6ff5494eff40f2e458f0d94
plan_head_after: 5dd7e1e
commits: [f757ea9, 5dd7e1e]
---

# 05-02a record: `clinical_notes` table, expand + migrate

**Outcome:** done locally. Migration `000053_clinical_notes_expand.sql` moves the clinical content of a visit
(`vitals`, `chief_complaints`, `clinical_notes`, `specialty_data`, `investigations_advised`, `advice`) out of
`visits` into the new 1:1 table `public.clinical_notes`, readable only with `consultations:view` and writable with
`consultations:edit` (nurses: `vitals` only). The backfill is lossless and idempotent; the six `visits` columns are
cleared and blocked by a VALID CHECK, so no path can put clinical content back into `visits` (they are dropped in
05-b0, R-37). Every app read and write of those columns now goes through the new table. A receptionist's PostgREST
read of `clinical_notes` returns `[]` (acceptance 2) while the visit row the front desk needs stays readable. Nothing
hosted was contacted; every Supabase CLI call used `--local`; resets ran under the test-run lock.

## What shipped

| Commit | Content |
|---|---|
| `f757ea9` | `000053_clinical_notes_expand.sql`; `EXPECTED_MIGRATION = "000053"`; schema snapshot; `types/database.ts`; `lib/db/clinical-notes.ts` (embed, flatten, `updateClinicalNotes`); `lib/db/types.ts` (`ClinicalNotes`; `Visit` loses the six fields); 14 app files switched (below); matrix target `clinical_notes` + regenerated `authz_matrix.test.sql` (2244) / `authz_completeness.test.sql` / `AUTHZ-MATRIX.md`; `table-matrix.spec.ts` DELETE column |
| `5dd7e1e` | `clinical_notes.test.sql` (53), `clinical_notes_backfill.test.sql` (9) + `tests/ci/clinical-notes-backfill-inline.spec.ts`; `composite_fks.test.sql` (103: the new FK case) and `delete_rules.test.sql` adapted; `tests/security/role-rls.spec.ts` (15, real JWTs); `tests/helpers/clinical-notes.ts`; 12 specs and `tests/e2e/support/m0-data.ts` seed/read through the new table; `tests/e2e/a11y/clinical-split-screens.spec.ts` (12) |
| docs | this record, wave notes, evidence |

### Migration 000053 (as built)

- `public.clinical_notes(visit_id uuid PK, tenant_id → tenants CASCADE, vitals jsonb '{}', chief_complaints jsonb '[]',
  clinical_notes text, specialty_data jsonb '{}', investigations_advised text[] '{}', advice text[] '{}', created_at,
  updated_at)`, `unique (tenant_id, visit_id)`, `clinical_notes_tenant_visit_fkey (tenant_id, visit_id) → visits
  (tenant_id, id) ON DELETE RESTRICT` (05-03 naming and pattern; deleting the tenant still cascades, tested).
- Closed by default (R-13): `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT SELECT, UPDATE TO authenticated`.
- `clinical_notes_select`: `tenant_id IN (SELECT authz.tenant_ids_with('consultations:view'))`;
  `clinical_notes_update` USING/WITH CHECK: `consultations:edit` OR `vitals:edit`. No INSERT/DELETE policy or privilege.
- `public.clinical_notes_guard()` (BEFORE UPDATE, invoker, `search_path=''`): `visit_id`/`tenant_id` never change
  (`CLINICAL_NOTES_KEY_IMMUTABLE`, 42501); a signed-in caller without `consultations:edit` (`has_permission`, bound to
  the active clinic) may change only `vitals` (`CLINICAL_NOTES_VITALS_ONLY`, 42501; compared as `to_jsonb(row) -
  'vitals' - 'updated_at'`, so a future column is covered); sets `updated_at = now()`.
- `private.visits_create_clinical_notes()` (AFTER INSERT on visits, SECURITY DEFINER, `search_path=''`, EXECUTE
  revoked from every API role): inserts `(NEW.id, NEW.tenant_id)` with the column defaults, `ON CONFLICT DO NOTHING`.
- Backfill: one row per visit, coalesced to the new defaults, `created_at` kept, `updated_at` = the visit's.
  Then the six columns are set to NULL and `visits_clinical_content_moved` (each column NULL or its old default)
  is added VALID.

### App switch (every read and write of the six columns)

Reads embed `notes:clinical_notes(<fields>)` (one-to-one over the composite FK; `null` when RLS hides the row) and
flatten it under the old field names (`withClinicalNotes`), so mappers, PDFs, the AI payloads and the v1 API keep
their shapes. Writes go through `updateClinicalNotes` (`.select(...)`, 0 rows → FORBIDDEN `ROW_NOT_AFFECTED`).

| File | Change |
|---|---|
| `features/consultation/service.ts` | draft save: visit write (status/specialty, sign-off lock in the filter) first, then the notes write; history, sign check (`hasNotes`), PDF payload, amendment snapshot read the embed |
| `features/visits/service.ts` | `recordVisitVitals` writes `clinical_notes.vitals` (a filtered write is now refused, not reported as recorded); visits register reads the embed |
| `features/queue/service.ts`, `components/queue/queue-card.tsx` | queue vitals from the embed (`QueueVisit = Visit & { vitals }`) |
| `app/(dashboard)/cabin/page.tsx`, `app/(dashboard)/consultation/[id]/page.tsx` | embed |
| `app/api/visits/[id]/prescription-pdf/route.ts`, `features/prescriptions/service.ts` | embed |
| `features/patients/service.ts`, `features/referrals/service.ts`, `features/dpdp/export.ts` | embed |
| `app/api/v1/visits/route.ts`, `app/api/v1/visits/[id]/route.ts` | GET embed (same fields); POST inserts the visit, then writes `chief_complaints` to its notes row; PATCH writes the notes **before** the visit (see deviation 3); response = visit row + notes content |
| `lib/db/types.ts`, `features/consultation/schema.ts` | `ClinicalNotes` type; comment |

No Realtime subscription exists (`channel(` grep: none). No SQL function reads the moved columns (catalogue query:
only `authz.*` key lists). `components/*` other than `queue-card.tsx` take props only and needed no change; no JSX
changed, so layouts are unchanged by construction (screens below). Grep evidence: `grep-moved-columns.txt` (the only
`visits` statements naming a moved column are `clinicalNotesEmbed(...)` calls and `role-rls.spec.ts`, which proves the
legacy columns empty).

## Tests that fail without the change (tool output, `evidence/05a/05-02a/`)

- `clinical_notes.test.sql` (53) + `clinical_notes_backfill.test.sql` (9): with the guard trigger and the CHECK
  dropped (fault injection on 000053), **14 of 53 fail** (every 23514 case, the nurse 42501 cases, key immutability)
  and the backfill file aborts (`pgtap-without-guard-and-check.tap`); on a stack without 000053 both files abort and
  the matrix fails 44 `clinical_notes` cells plus completeness (`pgtap-without-000053.tap`).
- Backfill lossless: the pgTAP replay of the migration's statements (pinned verbatim) on 120 planted visits covering
  SQL NULL, JSON null, empty and populated values, unicode, 5 kB text and arrays with NULL elements; plus a replay of
  the real migration file with `psql -1` on 500 planted visits: 0 rows differ, identical md5 over old (coalesced) and
  new content, re-run inserts 0, writing a note into `visits` afterwards fails on the CHECK
  (`replay-on-planted-data.txt`).
- App reads/writes go through the new table: the 12 affected spec files against the pre-switch app files (schema
  000053): **29 tests fail** (`specs-without-app-switch.txt`: draft save, vitals attribution, sign-off, DPDP export,
  referral snapshot, v1 GET/POST/PATCH, role-rls service cases, visit-service-guards).
- `role-rls.spec.ts` (acceptance path, real JWTs through supabase-js): receptionist `from("clinical_notes")
  .select("*")` → `[]`, admin `[]`, doctor/nurse/owner read the note, clinic B nothing; the receptionist's `visits`
  select of the six columns returns only empty values; writes of clinical text into `visits` → 23514 (owner, doctor,
  service role); nurse vitals → 1 row, nurse note → 42501, receptionist/admin → 0 rows; no member INSERT/DELETE
  (42501); a receptionist's booking gets one empty notes row and cannot carry content; patient history and queue
  return clinical data as absent for the receptionist.
- `visit-service-guards.spec.ts`: a vitals write that RLS filtered → FORBIDDEN and no audit row (before: success).
- Matrix regenerated: `clinical_notes` S `consultations:view` (owner, doctor, nurse, dual-in-A = 1; admin,
  receptionist, B, dual-in-B = 0), I/D no privilege (42501), U `consultations:edit|vitals:edit`, anon no privilege.

## Decisions and deviations

1. **Embed alias `notes:`** for `clinical_notes(...)`, so a `*` select of `visits` (which still has a
   `clinical_notes` column until 05-b0) never collides with it.
2. **[Rule 1] `recordVisitVitals` no longer reports a filtered write as recorded** (before: a visit of another clinic
   or a refused role got success + an audit row; now FORBIDDEN, no audit). `visits.updated_at` is no longer bumped by
   a vitals write (the notes row has its own `updated_at`).
3. **Two writes where there was one.** App draft save: the visit write (sign-off lock in its filter) goes first, then
   the notes; v1 PATCH: the notes first (zod lets any JSON through as `advice`/`investigations_advised`, and a refused
   body must not leave a visit completed without the notes the clinical safety check counted), then the visit with the
   lock in its filter. The window between the two statements (a sign-off racing a draft save) is the residual that
   V2-07 (one command per use-case) / V2-09a (record immutability, R-21) close; the plan's write shape is kept.
   v1 POST inserts the visit, then writes the complaints (a failed second write answers 500; the visit exists).
4. **`private` schema for the definer trigger function** (EXECUTE revoked from every API role); the invoker guard stays
   in `public` like `prescription_items_fill_tenant`. The guard also maintains `updated_at` (plan: "may change").
5. **Matrix fixture via the trigger:** the `clinical_notes` target uses `inBase` (doc widened: "or a trigger on an
   earlier fixture created it"); `anon: ""` (no privilege).
6. **pgTAP adaptations:** `composite_fks.test.sql` adds the `clinical_notes_tenant_visit_fkey` case (plan 101 → 103)
   and removes the trigger rows of the visits its cases need childless; `delete_rules.test.sql` keeps its V2
   "no children" visit childless the same way. The notes row's own RESTRICT is in `clinical_notes.test.sql`.
7. **Not pre-empted (05-02b):** visits/patients/front-desk policies; `role-rls.spec.ts` covers only 05-02a's table.

## Open items for the gate reviewer / PO

- **Queue and cabin cards for roles without `consultations:view`.** A receptionist's queue card now always shows the
  amber "Vitals Pending" badge (vitals hidden reads like "not recorded"), and an admin viewing all doctors in the
  cabin sees "Triage vitals have not been entered yet". The values are correctly hidden (R-3, PO-3); the misleading
  label is UI copy owned by V2-08 (role-aware screens). A "vitals recorded" flag for the front desk would need a
  product decision (it reveals workflow state, not values). Not changed here (no UI change in this plan).
- **E2E `/patients` `request.error` lines (asked by the orchestrator): root-caused, pre-existing, not 05-02a.** 8 in
  this run (4 per project on desktop-chrome and Pixel 7), exactly one after each of J-A4 (reset), J-A5 (change
  password), sign-out local (replayed old cookie) and sign-out global (other device): a session revoked at GoTrue
  still carries a cryptographically valid access token, so `proxy.ts` (`getClaims()`, local JWT verification) treats
  the request as signed in; `app/(dashboard)/layout.tsx` then calls `getUser()` (GoTrue round trip), gets no user and
  redirects to `/login` (the tests assert that and pass), but the page `app/(dashboard)/patients/page.tsx` renders
  concurrently, `getActiveMembership()` throws `Error("Unauthenticated")`, and `onRequestError` logs `request.error`
  (and ingests it through `ops_ingest_error`). The same 8 lines are in 05-03's evidence (`05-03/e2e-pr.txt`); 05-04's
  and 05-01b's files do not carry the web-server log. User-visible effect: none (redirect wins). Cost: one false error
  event per revoked-session page load, which pollutes the V2-04 error sink/alerts. Suggested fix (auth area, not this
  plan): treat "Unauthenticated" in the dashboard pages as `redirect("/login")` (or have `getActiveMembership` call
  `redirect` for page callers), or verify the session server-side in the proxy for page GETs. The 6 `ECONNRESET:
  aborted` lines are WebKit/Chromium aborting in-flight requests when a test ends (iPhone 15 and Pixel 7 golden
  specs); benign, as in 05-04.

## Lanes (final, tool output in `evidence/05a/05-02a/`)

On the tree of `5dd7e1e`:
- `npm run typecheck` clean; `npx eslint .` 0 errors (387 warnings, pre-existing kinds); `npm run inventory` exit 0;
  `npm run authz:gen -- --check` clean; `npm run db:drift:local` PASS (`static-checks.txt`).
- pgTAP lane: 10 files, **2559 tests, PASS**; report gate PASS (`pgtap-lane.tap`).
- Full Vitest: **4495 tests, 4495 passed, 0 failed**, 223 files (`vitest-full.txt`).
- E2E PR lane (desktop-chrome, Pixel 7, iPhone 15): **208 passed, 9 skipped** (pre-existing project-scoped skips),
  **0 retried / 0 flaky** (`e2e-pr.txt`), including the 12 new split-screen tests and M0 consult-rx-finish, journey 8,
  cabin/queue flows.
- Screens (`screens/`): consultation (doctor, receptionist) and queue (nurse, receptionist) at 360/820/1280. The
  doctor sees the seeded note and `128/84` vitals; the nurse's queue card shows `BP 128/84`; the receptionist's
  queue and consultation URL show neither and no "undefined". Axe serious/critical per screen equals the committed
  M0 baseline rule set and node counts (consultation: desktop `color-contrast` 18; 360 px `button-name` 1,
  `color-contrast` 15, `select-name` 1, `target-size` 1; queue `color-contrast` only); the 1280 px consultation
  screenshot matches the M0 baseline layout (`vp-1280/route-consultation-id.jpg`) with only the data differing.
  Horizontal scroll at 360 px on both screens is v1 debt (as in the baseline).

## Self-Check

PASSED. Files present: migration, `lib/db/clinical-notes.ts`, two pgTAP files, `role-rls.spec.ts`, the e2e spec,
the inline spec, evidence; commits `f757ea9`, `5dd7e1e` are ancestors of HEAD; the local stack is at 000053
(`db reset --local` after the fault-injection runs).
