# 06-02b record: overlays, menus, tabs, toast and command; `Modal` and `Dropdown` adapters

Plan: `06-PLAN.md` § 06-02b (Wave 6, after G2-D). Under the speed ruling this is UI work: one independent review
afterwards, and Lows only if cheap. Branch `v2/phase-06-design-system-pwa-shell`, plan base `1d7651f` (Wave A, its
fixes, 06-01b, 06-02a and the 05a tip merged). Design contract: `06-UI-SPEC.md` (CTO defaults CD-01…CD-37 binding).
Visual reference: V2-DX `3a78a5d` (`shared/sketch.css` "Sheets, dialogs, menus, toasts" and `.tabs`;
`v2-dx-evidence/screens/components/`). Every number below is tool output: a file in `evidence/06-02b/` or the command
named in the row. Builds and e2e ran in this worktree under the shared e2e lane lock with an owner file
(`scratchpad/lane-02b.sh`: `mkdir` lock, owner file, port 3100 checked free, released on exit). The local stack was
not reset or stopped. Two commits on the branch inside this plan's range are not 06-02b's: `dbed175` and `37ccc11`
(the IND L-6 WebKit flake fix and its wave note, committed by the L-6 debugger while 06-02b waited for the lane).

## What changed

| Area | Change | Files |
|---|---|---|
| Dependencies | `cmdk` **1.1.1** and `sonner` **2.0.8**, exact (the plan's pins), installed with `--before=2026-08-10 --ignore-scripts`. `scripts/ci/lock-linux-check.sh --fix` rewrote the lock with Linux npm (PASS): exactly two new entries; cmdk's `@radix-ui/react-{dialog,id,primitive,compose-refs}` ranges dedupe onto the `radix-ui` 1.8.1 tree. Legitimacy record `plans."06-02b"`: 2 packages, integrity equal, no install scripts, 0 problems; `npm audit signatures`: 987 verified. | `package.json`, `package-lock.json`, `evidence/package-legitimacy.json` |
| Dialog | Centred, `min(440px, 100vw − 32px)`, `lg` 640 (CD-08), radius-xl, `shadow-overlay` on the `scrim` (no blur), padding 20, gap 12, Manrope `title-2` naming it. Radix gives the trap, Escape, scroll lock and the hidden background. The Close button is last in the DOM, so the first field or action takes the initial focus. With `dirty`, the scrim, Escape and Close ask "Discard changes?" first. | `components/ui/dialog.tsx` |
| AlertDialog | Dialog skin. Not dismissed by an outside click. The safe action (`AlertDialogCancel`, secondary) takes the initial focus; the confirm is `danger` (`AlertDialogAction`). `DiscardChangesDialog` carries the UI-SPEC copy ("Discard changes?" / "Your changes in this form will be lost." / "Keep editing" / "Discard"). | `components/ui/alert-dialog.tsx` |
| Sheet, Drawer, ResponsiveSheet | One content component with three placements. **Right** (Sheet): full height, `sheet` 448 / `sheet-lg` 608, left hairline. **Bottom** (Drawer): full width, at most 92 dvh, radius-xl top corners, a decorative 32×4 handle, no drag or snap points (CD-09), foot buttons share the width. **Responsive**: the bottom drawer below 768 px and the right sheet from 768 px, switched by CSS so nothing remounts. Same head (title, context line, Close), scrolling body (`overscroll-behavior: contain`) and sticky foot (12 px plus the safe-area inset). Initial focus goes to the body's first field, not the head's Close. 240 ms slide. | `components/ui/{sheet,drawer,responsive-sheet}.tsx` |
| Popover, Tooltip | **Popover**: radius-lg, hairline, `shadow-popover`, padding 12 (4 for lists), at most 320 px tall, never wider than the viewport − 32, 200 ms fade + 4 px. **Tooltip**: Midnight fill, white 12/500, radius-sm, 400 ms delay, label + Kbd. Opens on hover and keyboard focus, closes on Escape. Hidden on a coarse pointer (CD-10). Each Tooltip carries its own provider. | `components/ui/{popover,tooltip}.tsx` |
| DropdownMenu | Min width 196, padding 4, radius-lg, `shadow-popover`. Items 32 px (44 on touch), body-sm, icon 16, highlighted surface-muted, inset focus ring (CD-12). Destructive items in danger-fg. Arrows wrap (`loop`), typeahead, Escape returns focus to the trigger. **Non-modal by default** (see Deviations 6). | `components/ui/dropdown-menu.tsx` |
| Tabs | Local tabs: `tablist`, 36 px (44 touch), selected fg with the 2 px accent underline inset 8 px, arrows wrap, Home/End, automatic activation. Route tabs (`TabLinks`): links in a named `nav` with `aria-current="page"`. The list scrolls sideways, so the ring is the inset variant. | `components/ui/tabs.tsx` |
| Toast | `sonner` for the queue, timers and stacking; each toast is our own view. Midnight fill, white body-sm, radius-lg, `shadow-overlay`, at most 400 px; action button transparent with a white 50 % border, 30 px (44 touch). `notify.info/success` give `role="status"`, 4 s (8 s with `undo`). `notify.error` gives `role="alert"`, stays until dismissed, offers `retry` and a Dismiss button (CD-37). Phones: bottom-centre (`aboveBottomBar` for the shell's bar, plus 12 px and the safe area). ≥ 768: bottom-right 20 px. The shell mounts `<Toaster />` in 06-04b; the gallery mounts its own. | `components/ui/toast.tsx` |
| Command | `cmdk` with the palette skin: input 44 px, `text-body-lg`, no box (a 2 px ring-colour underline while focused), group headings 11/600 caps, rows 36 (44 touch), the active row `selected` with an inset 2 px accent bar, a trailing hint. `CommandDialog`: top 12 vh, `min(600px, 100vw − 32px)`, at most 70 dvh; full screen with a Close button below 768 px. **cmdk bug fixed in the wrapper**: see Deviations 7. | `components/ui/command.tsx` |
| Focus return | Radix's modal Dialog/AlertDialog refocus only their `Trigger` on close. The v1 `<Modal>` call sites, the palette and the discard question open from state, with no Trigger, so focus fell to `<body>` (the first keyboard run caught it). `useFocusReturn()` remembers the element focused at open (in `onOpenAutoFocus`, before the trap moves focus) and returns focus there. If nothing usable was remembered, Radix's Trigger behaviour stays in charge. | `lib/ui/focus-return.ts` |
| Modal adapter | The v1 `isOpen`/`onClose`/`title`/`description`/`maxWidth` API over Dialog. The ten `<Modal>` call sites compile unchanged and now get trap, Escape, Close, focus return, reference-counted scroll lock and a name. `maxWidth` `sm`/`md` → 440, `lg`/`xl` → 640. A title-less modal (revoke-key) is named by its first heading. | `components/ui/modal.tsx` |
| Dropdown adapter + user menu | The v1 `Dropdown`/`DropdownItem` API over DropdownMenu. The trigger element is the Radix trigger (`aria-haspopup`, `aria-expanded`, `aria-controls`). `DropdownItem type="submit"` keeps the menu, and so its sign-out form, mounted while the form submits (closing would unmount the form and cancel the submission). `DropdownLink` makes a nav item that is itself the link. The user menu uses `DropdownLink` and `DropdownSeparator` and is tokenised (no gray palette, no `text-[11px]`). | `components/ui/dropdown.tsx`, `components/layout/user-dropdown.tsx` |
| IconButton | Shows its label (plus an optional `shortcut`) in a Tooltip (UI-SPEC IconButton; the 06-02a open item). `tooltip={false}` for overlay Close buttons, which take focus. | `components/ui/icon-button.tsx` |
| Variant maps | `SCRIM`, `POP_IN`, `POPOVER_SURFACE`, `OVERLAY_SURFACE`, `MENU_ITEM` (+ danger), `TAB_LIST`, `TAB_ITEM`. Semantic tokens only. Enter motion uses `@starting-style` (`starting:`), so reduced motion drops it and no keyframes are added. | `lib/ui/variants.ts` |
| Gallery | `/dev/ui` section "Overlays, menus, tabs, toasts and command". Each component has a live specimen (opens the real overlay) and an inert, `aria-hidden` static preview of its open state, so a capture of the closed page shows the look. Also the toast buttons (info, Undo, error with Retry), inline Command, loading Command, palette dialog and v1 Modal adapter specimens. Synthetic copy only; no "AI" copy. | `app/dev/ui/sections/overlays.tsx`, `app/dev/ui/page.tsx` |
| Contrast | 7 new pairs (tooltip/toast text, highlighted menu rows incl. destructive and icon, active command option and its bar, drawer handle informational). Report regenerated by the tool: **211 pairs, 0 fail**. | `lib/design/contrast-pairs.ts`, `evidence/06-01b/contrast.md` |

## Commits

| Commit | What |
|---|---|
| `fb1df08` | `cmdk` 1.1.1 and `sonner` 2.0.8 exact pins, Linux lock, legitimacy record |
| `1d8e7d0` | Overlay primitives, menus, tabs, toast and command; Modal adapter; focus return; IconButton tooltip; gallery section; `keyboard/overlays.spec`, `overlays-axe.spec` |
| `ee5d15b` | Dropdown adapter, user menu, `shell/user-menu-keyboard.spec`; `settleAnimations` before the user-menu axe scans in `auth/signout.spec` and `pwa/ui-checks.spec` |
| `0ade487` | Contrast pairs for the overlays, report 211/211 |
| `13556fe` | The palette list fills its dialog (full screen on phones); overlays-axe waits for the info toast before the section capture |
| (this commit) | Record, evidence, wave notes |

## Acceptance (plan § 06-02b "Tests that fail without the change", "UI checks", "Acceptance mapping")

| Criterion | Result | Proof |
|---|---|---|
| Tracer: Dialog in the gallery with focus trap and restore + the Modal adapter + the `overlays.spec` Dialog case + one v1 `<Modal>` user passing its M0 flow | Met. The gallery Dialog and the adapter specimen are driven by `keyboard/overlays.spec.ts`. The v1 `<Modal>` user is `OverbookDialog` ("Slot Already Booked") in `m0/book-appointment.spec.ts` (both overbook paths), green on desktop-chrome and pixel-7. Sign & Bill is not a `<Modal>` user (Deviations 1). | `evidence/06-02b/e2e-pr.txt` |
| `overlays.spec.ts`: Dialog/AlertDialog/Sheet/Drawer trap Tab and Shift+Tab, close on Escape and on the close button, restore focus to the opener | Met: 13 tests, real Chromium. Every Tab and Shift+Tab stop is asserted inside the overlay, in order, wrapping both ways. Escape, the Close button and (for clean dialogs) the scrim close it, and focus is back on the opener. The page behind leaves the accessibility tree while it is open. The ring on Close is the approved ring. Sheet geometry at 1280: flush right, full height, 448 px, no handle. Drawer: flush bottom, full width, handle `aria-hidden`. Before the change: the v1 modal had no trap (Tab left it) and no focus return. | PR lane |
| AlertDialog's initial focus is the safe action | Met: "Keep" / "Keep editing" is focused on open and ringed; an outside click does not dismiss it; Escape cancels. | PR lane |
| Popover/Tooltip open on focus and close on Escape | Met as the accessible pattern: Tooltip opens on keyboard focus, describes the trigger (`aria-describedby`, the Kbd hint excluded), Escape hides it, hover opens it after the delay. Popover opens from its focused trigger with Enter or Space, focus moves inside, Escape closes it and focus returns; `aria-expanded` follows (Deviations 4). | PR lane |
| DropdownMenu/Tabs arrow navigation | Met. Menu: Enter opens on the first item; ArrowDown/ArrowUp wrap; the disabled item is skipped (`aria-disabled`); typeahead; Escape and selection return focus to the trigger with `aria-expanded` back to false; menu rows use the inset ring. Tabs: arrows select with wrap, the disabled tab is skipped, Home/End jump, Tab moves to the panel; route tabs mark `aria-current="page"`. | PR lane |
| Command filters and Enter selects | Met: typing filters (one option for "book"), the active option is `aria-selected` and the input's `aria-activedescendant` names it (after typing and after clearing), arrows move and wrap, Enter runs it, no match shows "No results for “zzqx”" + the hint. The palette dialog opens with the field focused and returns focus on Escape. | PR lane |
| Toasts announce through their live region | Met: info toasts are `role="status"` inside sonner's polite region and leave after 4 s; the error toast is `role="alert"` and is still there after the info toast left; Retry and Undo act; Dismiss removes an error. | PR lane |
| `user-menu-keyboard.spec.ts`: Enter opens the menu with `aria-expanded="true"`, ArrowDown moves through items, Escape closes and focus is back on the button, "Sign out" via keyboard runs `hardSignOut` (the purge happens) | Met, as a fresh synthetic nurse: items in order, ArrowDown wraps, ArrowUp back, Escape restores focus. Keyboard-only Sign out: the server logs `auth.signout.done` scope local, the device is purged (session storage, a stray cache, an IndexedDB database and a non-preference key gone, the `clinicos.pref.*` key kept), no auth cookie, `/login`. Before the change (03-12b note): no `aria-expanded`, no arrows, no Escape, no focus return. The pointer exit paths (`pwa/05-cache-audit`, `auth/signout`, `pwa/06-tabs-and-devices`) stay green on all three projects. | PR lane |
| Gallery axe 0 serious/critical | Met: `/dev/ui` (forms, overlays, ai sections) at 360/820/1180/1280: 0 violations of any impact, no horizontal scroll. | `evidence/06-02b/gallery-axe.json` |
| M0 e2e green (Modal users: Sign & Bill, booking and checkout drawers) | Met: every `m0/*` spec green on desktop-chrome and pixel-7 (book-appointment incl. both overbook paths, cancel, checkout-collect, consult-rx-finish incl. Sign & Bill, register, walk-in). | `evidence/06-02b/e2e-pr.txt` |
| UI checks: overlay states at 360/820/1180/1280 (sheet below md, dialog at md+); axe | Met by `overlays-axe.spec.ts`. Each of dialog, alert-dialog, responsive-sheet, drawer, popover, menu, tooltip, command-dialog and modal-adapter is opened at each width, and so are the info + error toasts. Results: axe 0 serious/critical on the page; no horizontal scroll; inside the viewport; ResponsiveSheet a bottom drawer below 768 and a 448 px right sheet from 768; palette full screen below 768 with an on-screen Close; dialog `min(440, viewport − 32)`; every control in the overlay ≥ 44×44 below 1024 px and ≥ 24×24 above; Escape closes each. Captures checked by eye at 360 and 1280 against the approved component sheet. | `evidence/06-02b/overlays-axe.json`; `design-captures/06-02b/*-{360,820,1180,1280}.png`, `gallery-overlays-{360,1280}.png` (git-ignored) |
| Acceptance mapping: P1-28 M2 2b; gallery axe and keyboard/focus (2b part); 03-12b dropdown carry-over closed | Met (rows above). | |

## Flaky-test root causes (found in this plan's own runs)

1. **Scrim clicks (`keyboard/overlays.spec.ts`).** The clean-Dialog scrim click failed in one run and passed in the
   next; the dirty-Sheet scrim click failed once the same way. Cause: Radix's DismissableLayer starts listening for
   outside `pointerdown` in a `setTimeout(0)` after the layer mounts. Chrome runs queued input before timers, so a
   synthetic click sent the instant an overlay opened can arrive first and be ignored. Probe (80 iterations): **7 of
   40** immediate clicks missed, **0 of 40** after one macrotask yield (`evidence/06-02b/flake-scrim-click.txt`, probe
   source alongside). A person cannot click inside that window. Fix: `clickOutside()` yields one macrotask first, a
   sync point and not a sleep.
2. **Tooltip contrast in `overlays-axe.spec.ts`** (2 of 4 widths in one run, then 0 of 4). Cause: the menu case returns
   focus to "More actions", whose own tooltip opens on that focus. The tooltip case's bare `[data-overlay=tooltip]`
   locator matched that one at once, settle finished, and axe met the hovered "Print prescription" tooltip at the
   start of its fade after the 400 ms delay. The diagnostic run with the old locator reproduced it (2 of 16) with the
   node: text `#fefefe` on `#f1f2f4`, 1.11:1, `data-state="delayed-open"`. Fix: locate the tooltip by its text, then
   settle. **After both fixes:** `overlays-axe` + `keyboard/overlays` `--repeat-each=4 --retries=0`: 73 passed,
   0 failed, 0 flaky (`evidence/06-02b/flake-tooltip-midfade.txt`).
3. **Gallery axe, found and fixed before commit** (not flakes; failed every time): a listbox holding only cmdk's
   loading `progressbar` (`aria-required-children`, critical), then an input whose `aria-controls` named a removed list
   (`aria-valid-attr-value`, critical); and Radix's *modal* menu `aria-hidden`ing a page that still had focusable
   controls (`aria-hidden-focus`, serious). Fixed in the components (Deviations 6) and the loading specimen.

## Suite results (local)

| Check | Result |
|---|---|
| `npm run typecheck` | Clean (app + tests) |
| `npx eslint .` | 0 errors. 457 warnings, all in pre-existing files; 0 in 06-02b's files (`evidence/06-02b/static-checks.txt`) |
| `npm run inventory` | 0 flagged |
| `node scripts/ci/ui-policy.mjs` | PASS; enforced rules 0 findings. Report-mode findings only fall: `raw-palette` 3504 → 3477 (the user menu), `arbitrary-color` 2, `px-font` 281 |
| `npm run ci:ai-l1` | PASS (the 4 waivers are pre-existing) |
| `node scripts/design/contrast.mjs` | 211 pairs, 0 fail |
| Vitest, full lane (`npx vitest run`, shared stack, at `13556fe`) | **274 files, 5652 passed, 0 failed** (`evidence/06-02b/vitest.txt`). The 6 failures 06-02a recorded on its base (b9463be) do not occur at this head |
| `npm run e2e:pr -- --retries=0` (build `13556fe`, lane lock) | **354 passed, 0 failed, 0 flaky, 82 skipped, 0 retried**: desktop-chrome 235, pixel-7 96 (+82 skipped by design), iphone-15 18, setup 5 (`evidence/06-02b/e2e-pr.txt`, from the JSON reporter). An earlier full run at `ee5d15b` gave the same 354/0/0 |
| `npm run e2e:design -- --retries=0` (build `ee5d15b`) | **105 passed, 0 failed, 16 skipped** (`evidence/06-02b/design-lane.txt`). `13556fe` changes only the palette dialog's list height and a spec, neither in the design lane's specs |
| Repeat run of the overlay specs | `overlays-axe` + `keyboard/overlays`, `--repeat-each=4 --retries=0`: 73 passed, 0 failed |
| Lockfile | `lock-linux-check.sh --fix`: PASS. Legitimacy `plans."06-02b"`: 0 problems. `npm audit signatures`: 987 verified |
| gitleaks | `evidence/06-02b/gitleaks.txt` |

## Deviations

1. **Tracer user.** The plan's tracer names Sign & Bill as "one v1 `<Modal>` user". `components/consultation/sign-and-bill-modal.tsx`
   is a hand-rolled `role="dialog"` with the same `isOpen`/`onClose` props; it does not import `<Modal>`. The ten real
   `<Modal>` importers (`grep -rl 'ui/modal' app components features`) are the scope the plan states ("the 10 `<Modal>`
   users get focus trap and restore through the adapter"). The tracer's M0 flow is therefore `m0/book-appointment.spec.ts`
   overbook path, whose "Slot Already Booked" dialog is `components/calendar/overbook-dialog.tsx` on `<Modal>`.
   Sign & Bill, the booking drawer and the checkout drawer are untouched and their M0 flows stay green (PR lane);
   they move to the primitives when V2-08/V2-09 rebuild those screens.
2. **One commit for the primitives, not a tracer commit first.** The Dialog tracer and the rest of 2b were built and
   driven by the same keyboard spec in one pass; splitting the files afterwards would have produced commits that never
   ran. The tracer path (Dialog + Modal adapter + the Dialog case + the overbook M0 flow) is the first thing the spec
   and the lane checked.
3. **Files outside the order-table row**, each needed by the UI-SPEC or a bug:
   - `components/ui/icon-button.tsx`: the Tooltip with label and shortcut (UI-SPEC IconButton; 06-02a open item handed
     to 06-02b) and `tooltip={false}` for overlay Close buttons.
   - `lib/ui/variants.ts`: shared overlay/menu/tab class maps (06-02a's pattern).
   - `lib/ui/focus-return.ts`: focus return for overlays opened from state (a bug the first keyboard run found; "Focus
     return" above).
   - `lib/design/contrast-pairs.ts` and the regenerated `evidence/06-01b/contrast.md` (UI-SPEC: "any new token pair is
     added … in the same commit"; the report is tool output).
   - `tests/e2e/auth/signout.spec.ts`, `tests/e2e/pwa/ui-checks.spec.ts`: `settleAnimations` before their user-menu axe
     scans, because the menu now fades in (the 06-02a flake rule).
   - `tests/e2e/design/overlays-axe.spec.ts`: the plan's "UI checks" for overlay states at four widths.
4. **Popover "opens on focus".** The plan's test line says Popover/Tooltip "open on focus". A Tooltip does; a Popover
   opening on mere focus would hijack Tab, so the spec proves the accessible pattern instead: focus the trigger, Enter
   or Space opens it and moves focus inside, Escape closes it and returns focus (`aria-expanded` follows).
5. **Sheet foot padding.** 12 px + the safe-area inset (the approved `calc(12px + env(safe-area-inset-bottom))`), not
   the `pb-safe` utility (`max(0.5rem, inset)`), which would give 8 px on a desktop sheet.
6. **DropdownMenu is non-modal by default** (`modal={false}`), the WAI-ARIA menu-button pattern. Radix's modal menu
   hides the rest of the page with `aria-hidden` while its controls stay focusable (axe `aria-hidden-focus`, serious,
   at every width with a menu open) and locks page scroll. Keyboard behaviour is unchanged: arrows, typeahead, Escape
   back to the trigger, Tab held in the menu; an outside click or focus moving away closes it.
7. **cmdk 1.1.1 `aria-activedescendant` lag fixed in our wrapper.** After a query change cmdk set it one step late
   (unset while "Book appointment" was active after typing "book"; left on "Book appointment" while "Add walk-in" was
   active after clearing; arrow-key moves were right). `Command` keeps the input's attribute on the option marked
   `aria-selected` with a MutationObserver. No dependency change. The Command case of `keyboard/overlays.spec.ts`
   asserts the attribute after typing and after clearing, the two states cmdk got wrong.
8. **Approved look kept, two small additions the spec leaves open:** the palette input draws a 2 px underline in the
   ring colour while focused (it has no box, and WCAG 2.4.7 needs a visible indicator), and error toasts carry a
   Dismiss button (they persist until dismissed, CD-37).

## Open (owner)

- **Sign & Bill, the booking drawer and the other hand-rolled `role="dialog"` components** (`grep -rl 'role="dialog"'
  components app`, outside `components/ui/`: 14 files), and the walk-in and checkout drawers (no dialog role at all),
  still have no focus trap. They are not `<Modal>` users and are outside 06-02b's files. Owner: the phases that rebuild
  those screens (V2-08 Today, V2-09 consult and billing) move them onto Dialog / ResponsiveSheet. Backlog row proposed.
- **Toaster is not mounted in the app yet.** The shell mounts it in 06-04b (plan step 2). Until then only the gallery
  shows toasts.
- **IconButton tooltips open when focus returns to them** (Radix opens on focus): after Escape on a menu, the
  trigger's tooltip shows. This is intended keyboard behaviour; the G3 reviewer may want `tooltip={false}` on menu
  triggers. Low; owner 06-04b when it places the shell's icon triggers.
- `scripts/ci/ui-policy-baseline.json` is not refreshed (06-08 owns it); 06-02b's counts only fall.

