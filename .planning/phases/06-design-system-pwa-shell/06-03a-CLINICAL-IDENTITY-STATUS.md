# 06-03a record: clinical identity and status patterns

Plan: `06-PLAN.md` § 06-03a (Wave 8, after G2-D). UI work under the speed ruling: one independent review afterwards,
Lows only if cheap. Branch `v2/phase-06-design-system-pwa-shell`, plan base `a0e330d` (06-02c's last commit). Design
contract: `06-UI-SPEC.md` rows "06-03a Clinical identity and status" and "Visit status hues"; CTO defaults CD-03, CD-06,
CD-12, CD-13, CD-15, CD-16, CD-17, CD-25, CD-26 and CD-29 apply here. Visual reference: V2-DX `3a78a5d`
(`shared/sketch.css` "Pills", "Token chip", `.allergy`; `003-today/today.{js,css}` `rowHtml` and `.row`; the Today and
component-sheet captures). Every number below is tool output: a file in `evidence/06-03a/` or the command named in the
row. Builds and e2e ran in this worktree under the shared e2e lane lock with an owner file
(`scratchpad/lane-03.sh`: `mkdir` lock, owner file, waits for the shared stack's test-run lock to have no live holder,
port 3100 checked free, released on exit). The local stack was not reset or stopped.

## What changed

| Area | Change | Files |
|---|---|---|
| Status map | `lib/visit-status.ts` is the one map. It holds every stored `visits.status` value (the 000006 CHECK, `VisitStatus`) and two display states that are not stored: `to_bill` (a completed visit with money due, `displayVisitStatus(status, balanceDue)`) and `rescheduled` (a timeline event, CD-29). Each entry has a label, a tone (`status-<tone>-*` tokens, `info-*` for Rescheduled), a 12 px lucide icon and a lifecycle order. Any other value (null, a typo, a status a later migration adds) is the neutral "Unknown status": no icon, never a throw, never another status's colour. The file also holds the queue wait helpers: `waitLevel` (< 30 normal, 30–60 long, > 60 critical), `formatWait` (`6 min`, `1 h 05 min`) and `spokenWait`. The v1 queue sort (in consultation first) stays in `features/queue/service.ts`: it is a queue rule, not a status fact. | `lib/visit-status.ts` |
| StatusChip | A 20 px pill: caption 11/600, tracking 0.01em, icon 12 + label, `status-<tone>-bg/fg`. It is never interactive and never the primary blue. Cancelled is a white pill with `status-cancelled-fg` text and a 1 px inset `border-control` ring, so it never reads as the filled slate Done chip. `balanceDue` turns a completed visit into "To bill". | `components/clinical/status-chip.tsx` |
| TokenChip | The token number in `font-display` (Manrope 800, −0.02em, tabular): 28 px row size with `text-token-sm`, 40 px large with `text-token`. White fill, Midnight number, a `--token-chip-border-width` border in the status hue (`border-control` when neutral). A booked visit shows its appointment time ("10:30" + "am" at 11 px, CD-06) on a 1 px dashed booked border. Screen readers hear "Token 14", "Appointment 10:30 am" or "Token not assigned". | `components/clinical/token-chip.tsx` |
| PatientIdentityHeader | Three variants. `full` is a `<header>` with the name as a heading (h1 by default; the gallery uses h4) in Manrope title-2, a meta line, the visit context and the safety line. `compact` is name 14/600 with meta 12. `inline` is name 500, `42 y · M`, the masked phone `+91 ••••• •0001` (read as "mobile ending 0001") and trailing text. The order is fixed: name, age/sex (read "42 y, male"), ID, phone, ABHA (a check, read "linked"), context, safety. The name wraps between words to two lines and is never ellipsized (CD-13). The avatar is initials on `surface-muted`, `aria-hidden`. Helpers: `initialsOf`, `formatPhone`, `maskPhone`, `MaskedPhone`. | `components/clinical/patient-identity-header.tsx` |
| AllergyBanner, AllergyChip | `allergies` carries the three states: a list (known), `[]` (recorded none) or null (not recorded). Known: solid `alert-allergy-bg` with white 600 text, OctagonAlert, "Allergy: Penicillin" / "Allergies: Penicillin, Sulfa", chronic conditions after "·" at 400 (CD-17). It is never dismissible and is `role="alert"` only in this state. Recorded none: a neutral "No known allergies" chip with a check. Not recorded: `alert-unrecorded-*`, TriangleAlert, "Allergies not recorded" and an optional "Record now" button (44 px on touch). `AllergyChip` shows the same states at row size (danger pill / neutral / white warning outline). It has no live role, because a lane of rows would announce every patient at once. | `components/clinical/allergy-banner.tsx` |
| QueueRow, QueueList | The token column is 44 px (48 on touch) and holds the TokenChip and the wait. The content holds the name, a meta line, a flags line and the actions. The name is an `h3` (or h4) holding a button or link whose `::after` covers the row, so a tap anywhere opens the visit. The actions sit above it (z-10) and are always visible: `sm` 28 px buttons and a ⋯ IconButton, 44 px on touch. Selected: `row-selected-bg`, a 3 px bar and `aria-current="true"`. Next-up: `row-next-bg` (#F2FCFA), the bar and a visible "NEXT" caption (CD-15). Wait: `wait-normal-fg`; long and critical waits are 600 with a clock and a spoken suffix (", long wait", ", over an hour"). A change flash runs 600 ms `accent-subtle` → transparent, motion-safe only, behind the content (`isolate`, `-z-10`). | `components/clinical/queue-row.tsx` |
| SaveStatus | One `role="status"` `aria-live="polite"` region that always exists. The states are "Saving…" (spinner), "Saved · 10:42 am" (check, `success-fg`), "Offline · not saved. Reconnect to save" (CloudOff, `warning-fg`) and "Couldn't save · Retry" (CircleAlert, `danger-fg`; Retry is a link button, 44 px on touch). Below 768 px saving and saved are `sr-only`: announced but not drawn (CD-26). | `components/clinical/save-status.tsx` |
| ShareButton | A secondary button that opens the Web Share sheet on a press. Without one, it becomes "Copy link" and confirms with the toast "Link copied", or "Couldn't copy the link" (error toast). A dismissed share sheet reports nothing. Nothing is stored (D-6). The label follows the browser after hydration (`useSyncExternalStore` with a server snapshot), so there is no mismatch. | `components/clinical/share-button.tsx` |
| Gallery | The `/dev/ui` section "Clinical identity and status" shows every state: all status chips plus derived and unknown, token chips (five tones, booked, neutral, large), the identity header (full, full long name, compact, compact long name, inline), the allergy line (known, known + chronic, none, not recorded, row chips), a live "Waiting" lane (next, selected, long and critical waits, the 30-character name, To bill, booked, a ⋯ menu per row, "Simulate an update" for the flash), the save status (four states plus a live one) and share (default, disabled). The data is synthetic: "Synthetic Patient 01", `90000000xx`, `example.invalid` links. | `app/dev/ui/sections/clinical-a.tsx`, `app/dev/ui/page.tsx` |
| Contrast | 19 new pairs: text, waits and bars on the next-up and selected rows, the token number, the row-chip warning outline, the unknown chip, the Saved check, and two informational ones (the separator dot, the flash). Report regenerated by the tool: **234 pairs, 0 fail**. | `lib/design/contrast-pairs.ts`, `evidence/06-01b/contrast.md` |

## Commits

| Commit | What |
|---|---|
| `86f473e` | Tracer: `lib/visit-status.ts`, StatusChip, `tests/clinical/visit-status.spec.ts` |
| `3d8f75c` | TokenChip, PatientIdentityHeader, AllergyBanner/AllergyChip, QueueRow, SaveStatus, ShareButton, the gallery section, `keyboard/clinical-a.spec.ts`, `clinical-a-axe.spec.ts`, 19 contrast pairs |
| `f2bf3cb` | Fix found in the 360 and 1280 captures: "⏱ 38 min" and "1 h 15 min" overflowed the 44 px token column, so the clock now goes above the time and "1 h 15 min" breaks only between hours and minutes. The `full` identity meta line wraps instead of ellipsizing "ABHA" at 360. `keyboard/clinical-a.spec.ts` gained the matching assertion (no wait part outside its column at 1280 and 360) in the 06-03b test commit, run on the 06-03b build |
| (this commit) | Record, evidence, wave notes |

## Acceptance (plan § 06-03a "Tests that fail without the change", "UI checks", "Acceptance mapping")

| Criterion | Result | Proof |
|---|---|---|
| Tracer: `lib/visit-status.ts` (the single map from every appointment/visit status value in the code and `types/database.ts` to label, status token and order) + StatusChip in the gallery + spec | Met. `types/database.ts` types `visits.status` as plain `string`, so the spec reads the schema's own list from the migrations' CHECK constraint. | `86f473e`; `npx vitest run tests/clinical/visit-status.spec.ts` 11/11 |
| `visit-status.spec.ts`: every status string used in `features/**` and `components/**` (collected from the generated types and the v1 status constants) has exactly one entry; unknown → neutral chip, never a crash | Met. The spec collects four sources and fails on any value without an entry: the latest `visits.status` CHECK in `supabase/migrations`, the `VisitStatus` union, the v1 constants (`VISIT_STATUSES`, `QUEUE_OPEN_STATUSES`, `PATIENT_ACTIONABLE_STATUSES`, the queue's `statusOrder` keys), and every `visit.status` / `v.status` / `appointment.status` comparison in `app/**`, `features/**` and `components/**` (> 40 sites; a broken collector would fail the count). It also checks: keys, labels and orders are unique; stored and derived keys are disjoint; the label/tone/icon table equals the UI-SPEC; every known status has an icon and no tone is the accent; `""`, `"Waiting"`, `"with_doctor"`, `"canceled"`, `"__proto__"`, `"toString"`, null, numbers and objects give the neutral entry. "To bill" is derived only from completed with a positive finite balance. Lifecycle sort puts unknown last. Wait levels and formats are checked at their boundaries. In the browser the gallery renders `awaiting_triage` as "Unknown status" (neutral colours, no icon). | `tests/clinical/visit-status.spec.ts`; `keyboard/clinical-a.spec.ts` "status chips" |
| `clinical-a.spec.ts`: QueueRow actions reachable by Tab with visible focus | Met. From the lane heading, Tab reaches row 1's name, "Vitals" and "More actions for Synthetic Patient 01". Each has the approved ring (`expectFocusRing`: 2 px `ring` outline outside the control plus the white halo). Enter opens the ⋯ menu (`aria-expanded="true"`). ArrowDown and Enter run "Reschedule", and focus returns to the ⋯ button. Tab continues into row 2 and row 3. Enter on a name opens that visit and moves `aria-current`. Every row's actions are visible without hover, and a mouse press on the row body (the stretched name) opens it. | PR lane (`evidence/06-03a/e2e-pr.txt`) |
| SaveStatus announces changes | Met. One polite `role="status"` node carries every state. A MutationObserver on it records "Saving…", "Offline · not saved. Reconnect to save" and "Couldn't save·Retry" (the dot is `aria-hidden`), and never an empty announcement. Retry is reached by keyboard (Shift+Tab) with the ring, and Enter returns to "Saving…". The offline icon is `warning-fg`. At 360 the saving and saved states are not drawn (≤ 2 px, `sr-only`) but stay in the accessibility tree; offline and error are drawn. | PR lane |
| Identity header shows a 30-character synthetic name unbroken at 360 | Met. At 360 px the name "Synthetic Patient Long Name 30" (exactly 30 characters) appears in the full header, the compact header and the queue row. In each the whole text is drawn (no clipping, no ellipsis) on at most 2 lines, and every word sits on one line (a Range per word). A name that fits stays on one line. The page has no horizontal scroll. | PR lane |
| Gallery axe 0 serious/critical | Met. `/dev/ui` whole page at 360/820/1180/1280: 0 serious/critical (`gallery-axe.spec`). The clinical-a section at each width: **0 violations of any impact**, also with a row's ⋯ menu open (`clinical-a-axe.spec`). | `evidence/06-03a/clinical-a-axe.json`, `e2e-pr.txt` |
| UI checks: clinical-a section at 360/820/1180/1280; axe | Met by `clinical-a-axe.spec.ts`. The checks: no horizontal scroll at any width; below 1024 px every control in the section is ≥ 44 × 44 (a row's name is measured by its row, its stretched hit area); on a fine pointer ≥ 24 × 24; row actions keep ≥ 8 px between them on touch. Captures were checked by eye at 360 and 1280 against the approved component sheet and Today, which is how `f2bf3cb` was found. | `design-captures/06-03a/{gallery-clinical-a,row-menu}-{360,820,1180,1280}.png` (git-ignored), `evidence/06-03a/clinical-a-axe.json` |
| Revision 2026-11-14 items | Met. Per-status hues, none blue (the spec compares the computed colours with the accent and requires 7 distinct looks for the 7 lifecycle states). The With-doctor border is `teal-550` through `status-with-doctor-border`, and the computed border equals the token. Cancelled is outlined with the inset `border-control` ring, Done is filled with no ring. The token number is Manrope 800, tabular, and carries the 1.5 px token (see Deviations 3). The next-up row uses `--row-next-bg`. | PR lane, "status chips", "token chips", "queue rows: next, selected…" |
| Acceptance mapping: P1-28 M2 2e (part); the single status map (FMP M1) | Met (rows above). | |

Also covered (UI-SPEC states): the token chip is read "Token 14" and the booked chip "Appointment 10:30 am" with a
dashed border. The full header is a `header` element; its meta reads `42 y · M · ID CQ-0042 · +91 90000 00001 · ABHA`
visibly and "42 y, male" / "linked" to screen readers. The inline variant shows only the masked number (the full
number is not in its DOM). The allergy line is `role="alert"` exactly twice in its group (the two known states) with
`alert-allergy-bg` and white text. The row chips have no role. "Record now" is a button with the ring. ShareButton
without a share sheet shows "Copy link"; Enter copies the link (a recorder replaces the clipboard) and the toast "Link
copied" appears. local/session storage keys are the same before and after. With a share sheet it shows "Share", passes
`{ url, title }` and writes nothing to the clipboard. The disabled state is disabled. The flash fades to transparent
within its 600 ms, and with reduced motion it has no transition.

## Suite results (local)

| Check | Result |
|---|---|
| `npm run typecheck` | Clean (app + tests) |
| `npx eslint .` | 0 errors; 457 warnings, the same count as 06-02c; 0 in the 14 files 06-03a added or changed (`evidence/06-03a/static-checks.txt`) |
| `npm run inventory` | 0 flagged |
| `node scripts/ci/ui-policy.mjs` | PASS; enforced rules 0 findings; report-mode counts unchanged from 06-02c (`raw-palette` 3445, `arbitrary-color` 2, `px-font` 281): the new files add none |
| `npm run ci:ai-l1` | PASS (the 4 waivers are pre-existing); no "AI" copy or Sparkles in 06-03a files |
| `node scripts/design/contrast.mjs` | 234 pairs, 0 fail |
| Vitest, targeted | `tests/clinical/visit-status.spec.ts` 11/11 |
| Vitest, full lane (`npx vitest run`, shared stack, at `3d8f75c`) | **278 files, 5485 passed, 13 failed, 303 skipped** (`evidence/06-03a/vitest.txt`). All of them (the 13 failed tests and the file-level setup failures, every FAIL line listed in the evidence) are outside this plan (`git diff a0e330d..3d8f75c -- supabase features app/api lib/db tests/security tests/integration tests/ops tests/ci` is empty). The shared stack now carries migrations 000079-000087 that this branch lacks (`npx supabase migration list --local`). Five failures are new since 06-02c: `subscription.spec` ×3, `cross-tenant` seed, `guard-actions` leg 3/3b, `guard-canary` (d) and `guard-routes` ×2 report PGRST205 "Could not find the table public.subscriptions / public.payment_records". `drill-lib-db` `drill_authz_matrix` is the known 06-02a row. The known ones are as in 06-02c: `membership-guard` SEC-09 ×3, `role-rls` clinical_notes ×3, `hosted-dump-diff` ×2. Re-run after the 05b merge-in |
| `npm run e2e:pr -- --retries=0` (build of the 06-03a tree before `f2bf3cb`, lane lock) | **388 passed, 0 failed, 0 flaky, 116 skipped, 0 retried**: desktop-chrome 269 (06-02c: 255; +14 = 10 keyboard + 4 axe cases), pixel-7 96 (+116 skipped by design: design specs are desktop-only), iphone-15 18, setup 5 (`evidence/06-03a/e2e-pr.txt`, from the JSON reporter). `f2bf3cb` and its spec assertion ran in 06-03b's PR lane (`evidence/06-03b/e2e-pr.txt`) |
| gitleaks | `evidence/06-03a/gitleaks.txt` |

## Flaky-test and harness findings (this plan's own runs)

No test passed only on retry: every run used `--retries=0`. The first targeted runs failed for test reasons, each
found and fixed before the lane run:

1. **Chromium draws and computes border widths in whole CSS pixels.** The approved token is 1.5 px. A probe outside
   the app (`scratchpad/bw-probe.mjs`) shows Chromium computes `1px` for `border: 1.5px` and for `var(--w)` = 1.5 px,
   at device scale 1, 2 and 3. The V2-DX prototype rendered the same way in the same browser. The spec checks the
   token (`--token-chip-border-width` = `1.5px`) and that the drawn border is ≥ 1 px.
2. **Radix focuses the first menu item in a timer after opening** (06-02a wave note). An ArrowDown sent at once was
   lost and Enter ran "Open patient". The spec now waits for the first item to have focus.
3. **A programmatic `focus()` after mouse clicks does not match `:focus-visible`.** Retry is reached by Shift+Tab,
   as a keyboard user would.
4. Strict-mode name matches (`"Synthetic Patient 01"` also matched "More actions for Synthetic Patient 01") use
   `exact: true`. A mouse press below the fold now scrolls its row into view first (a probe with `elementFromPoint`
   confirmed that the stretched name covers the row).

Lane notes: the e2e lane lock was held by `05b-executor` from 21:36Z for about 15 minutes. 06-03a's run waited for it
(the lane script waits; nothing was interrupted).

## Deviations

1. **Files outside the order-table row**, each needed by the plan text, the UI-SPEC or a bug:
   - `tests/e2e/design/clinical-a-axe.spec.ts`: the plan's "UI checks" at four widths (as 06-02c's
     `data-dates-axe.spec.ts`).
   - `lib/design/contrast-pairs.ts` and the regenerated `evidence/06-01b/contrast.md` (UI-SPEC: new pairs in the same
     commit; the report is tool output).
2. **The status spec reads the database list from the migrations**, because `types/database.ts` has no enum for
   `visits.status` (it is `string`). The plan's "collected from the generated types" is met by the schema's own CHECK
   constraint plus the hand-written `VisitStatus`.
3. **Token border 1.5 px renders as 1 px in Chromium** (Flaky-test 1). The token is unchanged. WebKit (the iPhone
   project) draws fractional borders.
4. **`AllergyChip` (row size) is in `allergy-banner.tsx`** and has no `role="alert"`. The UI-SPEC lists an "allergy
   chip" on queue rows but no component for it. A live role on every row would flood a screen reader. The words
   ("Allergy: Penicillin" with an sr-only prefix) carry the state.
5. **Lifecycle order in the map is Booked → Confirmed → Waiting → With doctor → To bill → Done → No-show → Cancelled →
   Rescheduled → Unknown.** The v1 queue sort (in consultation first) is unchanged in `features/queue/service.ts`.
   V2-08 decides whether Today keeps it.
6. **The wait time breaks to two lines when needed** (`f2bf3cb`). The UI-SPEC puts the wait under the token in a
   44 px column; "1 h 15 min" with its clock is about 66 px. The clock goes above the time, and hours and minutes
   break apart; the column width is unchanged.

## Open (owner)

- **Wait thresholds** (30 / 60 min) are constants in `lib/visit-status.ts`. DESIGN_SYSTEM §7.4 makes them a clinic
  setting (V2-08).
- **Allergy line on the consult (sticky, CD-14)** is a placement rule for V2-09. The component is ready.
- **`components/ui/badge.tsx` `StatusBadge`** (v1 aliases `with_doctor`, `canceled`, `no-show`) is not replaced. Its
  call sites move to StatusChip with their screens (V2-08).
- `scripts/ci/ui-policy-baseline.json` is not refreshed (06-08 owns it); 06-03a adds no findings.
