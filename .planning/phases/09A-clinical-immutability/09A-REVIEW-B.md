# 09A-05 review B (isolated reviewer, static)

**Verdict: CHANGES REQUESTED. 1 BLOCKER, 6 WARNING.** The sealed and amending state logic is mostly sound. The database remains the enforcer, and no finding lets a sealed row change. One blocker is an acceptance miss: a live editor on a signed record. The rest are wrong text, focus loss, a dismiss race, and thin tests.

Scope: commits `5c430a1 0e1d622 7202dee afd0e9b c5022cb` against `09A-PLAN.md` 09A-05 and the 09A-05 section of `09A-NOTES.md`. Static review only: file reads and `git show`. Nothing was run.

Checked and found fine, so nobody re-opens them:
- `canAmend` is display only. `reopenVisitForAmendment` and `finalizeVisitAmendment` re-check permissions in the action, the service and the DB (`consultations:edit`, `prescriptions:edit`, `appointments:edit`). The tenant comes from the session in the page, so there is no client-only authorization.
- No PHI in logs. The new code adds no log call. The amendment reason is shown as React text, which is escaped.
- `isSealedRefusal` matches the guard names raised in 000107 to 000109. The seal-related names are covered.
- Deleting "Re-sign / Bill" is justified.
  - `step_sign_consultation` refuses a signed visit (`ALREADY_SIGNED`) and one that is not `waiting` or `in_consultation` (`VISIT_NOT_SIGNABLE`).
  - The one billing-only resume branch in `complete_and_bill` needs a visit this user signed that has no non-cancelled invoice. I found no app path that cancels an invoice.
- Disabling inputs on cancelled visits matches R-11. `isDraftLocked` already refused their saves.
- `useCommand` idempotency in the Amend form is correct.
  - One id per submit.
  - `reset()` on edit after an error.
  - A `handleSubmit` guard on `pending`.
  - Retry with the same id.

---

## B-1 BLOCKER: the vitals editor stays live when a record becomes sealed in the same session

**Files:** `components/consultation/vitals-block.tsx:25,120-137` (the `isEditing` state and the `isEditing ? <inputs>` render, which ignores `disabled`); `components/consultation/consultation-workspace.tsx:884-892` (passes `disabled={readOnly}`); `components/consultation/sign-and-bill-modal.tsx:436-441` ("Review Encounter" does `router.refresh()` in place).

**Failure:**
- `VitalsBlock` gates only the "Edit vitals" toggle with `!disabled`. Its seven inputs have no `disabled` prop, and `isEditing` is local state that survives `router.refresh()`.
- Draft case: the doctor opens "Record Vitals", does not press Done, then runs Complete and Sign and presses "Review Encounter". The workspace is now `sealed`, but the vitals inputs are live and editable on a signed record.
- Amending case: the same happens after Finalize amendment, when the doctor had the editor open.
- Typing calls `markDirty()`. The 15 s autosave then calls `saveConsultationDraft`, which `isDraftLocked` refuses. The user gets a save-error banner after editing a signed record in the UI.
- The same transient-UI class exists in the builder's staged-drug panel (`prescription-builder.tsx:592`). Its dosage, timing and duration inputs are not disabled. Only the Add action is guarded by `if (!stagedDrug || disabled) return`, so it silently does nothing.
- This breaks the plan's rule that every input is disabled when sealed (R-16, plan task 2).
- Nothing catches it: `workspace-sealed.spec.ts` renders static markup from initial props, and the e2e only opens a fresh page.

**Fix:**
- In `vitals-block.tsx`, derive the mode from props: `const editing = isEditing && !disabled;`. Render the editor on `editing` and make the effective state read-only whenever `disabled` is true.
- Better, add a `useEffect` that resets `isEditing` to false when `disabled` becomes true.
- In the builder, clear `stagedDrug` and close the template and remove-confirm overlays when `disabled` turns true, or pass `disabled` to the staged inputs and the Add button.
- Add an interaction test that mounts the workspace, opens vitals edit, rerenders with the sealed props, and asserts no enabled `input` inside `#vitals`.

## B-2 WARNING: wrong version numbers for a consultation with no prescription header

**File:** `components/consultation/consultation-workspace.tsx:171` (the `signedVersion` fallback); `app/(dashboard)/consultation/[id]/page.tsx:180` (`current_revision ... ?? 0`).

**Failure:**
- The fallback assumes `current_revision` starts at 0 (the prop comment says "0 or absent: never amended").
- In the database it defaults to 1 (migration 000007 `DEFAULT 1`; 000068 insists on 1 at insert).
- The guard sets `current_revision := max(revision_number) + 1` on each reopen (000107 around line 177).
  - Sealed, never amended: `current_revision` is 1, so the code shows v2. It should be v1.
  - Amending after the first reopen: `current_revision` is 2, so the banner reads "v2 to v3". It should be "v1 to v2".
- The Amend dialog says "keeps the signed version (v2) ... stamps the amended prescription as v3". The Finalize dialog says "signed as version 3".
- The fallback is reached whenever the visit has no `prescriptions` header. That is common: sign-off needs a diagnosis or a note, not a prescription.
- The spec masks it by always passing `prescription_version`, and by using `current_revision: 0` for sealed, a value the database never stores.

**Fix:** For this fallback the count is the number of signatures, which is `current_revision` when sealed and `current_revision - 1` when amending. Use `Math.max(1, current_revision - (state === "amending" ? 1 : 0))`, and make the page default to 1. Add specs with a null header and `current_revision` 1, 2 and 3.

## B-3 WARNING: keyboard focus is lost after a successful Amend and after a successful Finalize

**Files:** `components/consultation/amendment-modal.tsx:77-78`; `components/consultation/finalize-amendment-dialog.tsx:81-85`; `lib/ui/focus-return.ts:28-34`; `components/consultation/consultation-workspace.tsx:742-751` and `685-692`.

**Failure:**
- Both dialogs open from state, so focus returns to the remembered opener (`useFocusReturn`).
- On success, `onSuccess()` calls `router.refresh()` and `onClose()` runs right after.
  - The opener is still connected at close, so it gets focus.
  - The refresh then swaps the branch. The Amend button is replaced by Save Draft and Finalize, and the Finalize button is replaced by the sealed actions.
  - The focused element is removed, and focus falls to `<body>`.
- A keyboard or screen-reader user is thrown to the top of the document after the most important action in the flow.
- The new a11y spec checks focus only on the Escape path. It never checks focus after a successful reopen, and it never finalizes.

**Fix:** After the state flips, move focus deliberately. Examples: an effect on `state` that focuses a `tabIndex={-1}` banner when entering `amending`, and the signed chip or Amend button when entering `sealed`. Add the assertion to `amendment-screens.spec.ts` (after confirm, `document.activeElement` is inside the page, not `body`).

## B-4 WARNING: the Finalize dialog can be dismissed during the save phase, and Finalize still runs

**File:** `components/consultation/finalize-amendment-dialog.tsx:62-86` (`submit`) and `89` (`DialogContent` without a busy guard). The reopen dialog has the same shape at `amendment-modal.tsx:70-80`.

**Failure:**
- "Keep editing" is disabled while busy, but Escape, an outside click and the X are not. `dirty` is unset, so `useDismissGuard.hold` lets them through.
- Dismissing unmounts `FinalizeBody` (`open && ...`).
- The `submit` closure is still awaiting `onBeforeFinalize()`. When the save returns, it runs `finalize.run(...)` anyway.
- The consultation is sealed as the next version and the Rx is re-issued after the doctor pressed Escape to cancel.
- On a slow clinic connection the save phase can take seconds.

**Fix:** While `saving || finalize.pending`, hold dismissal. Pass `onEscapeKeyDown` and `onInteractOutside` handlers that call `event.preventDefault()` while busy, and hide or disable the X. Also check an `aborted` ref before `finalize.run`. Do the same for the reopen dialog.

## B-5 WARNING: Finalize does not stop on a follow-up write failure, so it can seal a stale follow-up

**Files:** `features/consultation/service.ts:238-244` (`await recordFollowUp(...)`, result ignored); `components/consultation/finalize-amendment-dialog.tsx:19-21,67-75` (docstring and logic: "A failed save stops the finalize").

**Failure:**
- `handleSaveDraft` reports `{success: true}` once the visit and notes writes pass. `saveConsultationDraft` discards the `recordFollowUp` result.
- If that write fails (for example a refusal or a tenant mismatch), the amendment still finalizes. The new signed version then carries the old follow-up, and the seal makes it permanent, with no message to the doctor.
- This was tolerable for autosave. For Finalize it contradicts the dialog's contract.
- The new `SIGNED_CONSULTATION_MESSAGE` mapping in `recordFollowUp` returns a result nobody reads here.

**Fix:** Have `saveConsultationDraft` return a failure (the `FOLLOW_UP_CLEAR_FAILED_MESSAGE` style) when `recordFollowUp` fails, so the finalize gate sees it. Alternatively, add a failing-follow-up case to the finalize flow test.

## B-6 WARNING: sealed clinical notes are in a `disabled` textarea, which keyboard users cannot focus or scroll

**File:** `components/consultation/chief-complaints-section.tsx:240-246` (`rows={3}`, `min-h-[96px]`, `disabled={disabled}`).

**Failure:**
- A disabled textarea is not focusable. A keyboard-only user cannot reach or scroll long signed notes. This is a WCAG 2.1.1 regression for the main read-only artifact.
- Copying note text is also unreliable in some browsers.
- Previously the textarea was always editable and therefore focusable.

**Fix:**
- Use `readOnly` plus `aria-readonly="true"` for text areas in the sealed state. Keep `disabled` only on controls that act.
- Update `workspace-sealed.spec.ts` and the e2e `toBeDisabled()` assertions for that one field.
- A read-only textarea still blocks typing.

## B-7 WARNING: the disabled plumbing and the new states are not actually tested

**Files:** `tests/consultation/workspace-sealed.spec.ts:60-69` (`visitProps` seeds no vitals, complaints, investigations, advice, specialty data or past encounters); `:98-107` (the chip regex); `tests/consultation/sealed-refusal-messages.spec.ts`.

**Failure:**
- The sealed spec asserts the disabled state of the notes, medicine search, diagnosis search, the specialty selects, the chips and three custom inputs. It never renders vitals or a complaint.
- It also renders no "Remove investigation ..." or "Remove advice item ..." buttons (`consultation-workspace.tsx:1051,1134`, matched by none of the chip regexes) and no specialty-panel controls. The `disabled` props passed to `VitalsBlock`, `ChiefComplaintsSection` items, `GPSystemicReview`, `DentalOdontogram` and `PediatricsTools` are untested.
- `renderToStaticMarkup` of initial props cannot see a state change, so B-1 passes the suite.
- There is no `cancelled` case, even though NOTES deviation 2 claims the cancelled behaviour (no Save Draft or Complete and Sign).
- `getOrCreateDraftPrescription`'s new `isSealedRefusal` branch (`features/prescriptions/service.ts:141`) has no case. NOTES lists "the header insert" as covered, and the refusal spec does not cover it.
- The version fallback (B-2) is untested, and `current_revision: 0` is an unrealistic input.
- The page-level axe check in `amendment-screens.spec.ts:84-85` only asserts "no new rule id vs the M0 baseline" for the whole page. A new serious violation of an already-baselined rule, such as `color-contrast` on the sealed body, passes. Only the header, chip, dialogs and banner are held at zero.

**Fix:** Seed a populated visit (vitals, one complaint, one investigation, one advice item, specialty data for all three specialties) and assert that every `input`, `select`, `textarea` and `button` that mutates is disabled or absent in the sealed state. Add the `cancelled` state, the sealed header-creation refusal, and the fallback-version cases. Add one jsdom or Playwright test for the in-session transition (B-1).
