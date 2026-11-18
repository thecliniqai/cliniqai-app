# V2-06 G3 design review (isolated reviewer)

Scope: the G3 screenshot set at `.planning/phases/06-design-system-pwa-shell/evidence/06-08/screens/` (129 captures, 33 screens at
360/820/1180/1280). I compared it with the approved V2-DX design at `3a78a5d` (`themes/cliniq-ai.css`, `003-today`, `004-consult`,
`005-surfaces`, `006-components`, and the `v2-dx-evidence/screens/*` captures), with `06-UI-SPEC.md` (CD-01…CD-37) and with the PO's
stated preferences. I looked at the images themselves; I sliced the tall gallery captures so I could see them at full resolution.
I did not read the V2-06 implementation records, wave notes, SUMMARY or VERIFICATION.

## Verdict: **approve with changes**

Counts: **High 0 · Medium 5 · Low 12 · Polish 8**

The design system matches the approved design closely. These all match `cliniq-ai.css` and the `006-components` captures: white canvas, Midnight ink, CliniQ Blue held to the reserved accent uses, slate neutrals, radii 6/10/14/20, the focus ring on its halo, a separate hue for each status with none in primary blue, Manrope 800 token chips with status borders, the dashed Booked time token, the solid danger allergy strip, the warning "Allergies not recorded" strip, and the next-up row (tint, bar and "Next").

The shell structure also follows UI-SPEC §6:
- Sidebar at 1280, Rail at 820/1180, BottomBar below 768.
- Top-bar title in Manrope; the 28 px mark on the phone Today screen.
- Palette field with Kbd at 1024 px and up; full-screen palette on phones; Rail plus no BottomBar in focus mode.

No capture shows horizontal scroll, clipping or broken icons. Density is right on desktop. Every finding below is a fix to apply, not a change of direction. The Mediums are the ones a doctor would notice on a phone or on the consult.

---

## High

None.

---

## Medium

**M1. Two Back controls stacked on the consult and on the patient record**
- Captures: `{360,820,1180,1280}/doctor-consult.png`, `{360,820,1180,1280}/owner-patient.png`
- What is wrong: The shell top bar shows a Back arrow and the screen title ("Consultation", "Patient"). Directly below it, the v1 page header shows a second Back arrow ("←" beside the avatar on the consult, "← Patients" on the record). Two back arrows about 50 px apart, with different targets possibly, is the first thing a doctor sees on the consult. This is a shell-integration seam, not v1 content debt.
- Expected: One Back control. UI-SPEC §6 puts it in the TopBar ("BackButton … on every non-root screen below 1280 and always in focus mode"); the approved consult (`consult_1280.png`, `consult_360.png`) has a single back in the bar next to the token. Hide or suppress the v1 in-page back when the page renders inside the new shell, until V2-09/V2-11 rebuild these pages.

**M2. QueueRow at touch widths stacks a 44 × 54 action tile under the content; rows are about twice the approved height**
- Captures: `360/gallery-clinical-a.png`, `820/gallery-clinical-a.png` (Queue rows)
- What is wrong: Below 1024 px every row puts its action ("Vitals", "Collect ₹700", "Check in") on its own line under the flags, as a squarish bordered tile, with the ⋯ far right. Each row is about 135 px tall, so roughly four rows fit on a 360 × 780 screen. That is cramped-by-height and reads clunky rather than premium.
- Expected: The approved phone and tablet rows (`today_360.png`, `today_820.png` at `3a78a5d`) keep the 44 px action in a right-hand column beside the content: token · name/meta/flags · action. That gives rows of about 80 px and about seven visible rows. UI-SPEC §7 (360: "QueueRows: 48 px token column, padding 10 14, actions 44 px") supports that layout. Stacked actions are the 1280 lane layout only ("actions on a line under the content").

**M3. BottomBar labels wrap to two lines and push their icons out of line**
- Captures: `360/owner-*.png`, `360/install-card.png`, `360/update-toast.png`, `360/state-dashboard-loading.png`, `360/receptionist-*.png`, `360/gallery-shell.png`
- What is wrong: For the owner, "Doctor's Cabin" wraps ("Doctor's / Cabin"). In the receptionist specimen, "Live Queue" wraps. The wrapped cell's icon sits about 8 px higher than its neighbours, so the bar looks uneven on every owner phone screen.
- Expected: One baseline for every icon and label (UI-SPEC §6 BottomBar: icon 18 over a caption label 11/500). The approved `today_360.png` bar is perfectly aligned. Use a short label for the bar ("Cabin", "Queue", keeping the full name as the accessible name if R-8/CD-30 needs it), or clamp to one line with ellipsis and pin icons to the top of the cell.

**M4. A monospace face leaks into the new type system**
- Captures:
  - `{360,1280}/login.png`: "Token #18", "3 Patients", "14 Today", "6.5 mins" in the preview card
  - `{360,820}/owner-patient.png`: "ID: 5f4854d1-3236…", "+919000015207", "12:33 pm"
  - `{820,1280}/doctor-consult.png`
- What is wrong: Tokens, counts, IDs and phone numbers render in a system monospace. The approved type is Manrope (titles, token numbers) plus Inter with tabular figures; there is no mono face (`cliniq-ai.css` §3, `palette_1280.png` "Numbers, money and dates": receipt numbers, phones and doses in Inter tabular). The login preview is the first branded surface a clinic sees, and the mono numerals there look off-brand.
- Expected: Map v1's `font-mono` usage to `font-sans` + `tabular-nums` at the token layer (06-01 owns font mapping), or remove `font-mono` from these v1 screens.

**M5. Headings on the brand and PWA surfaces lose the display hierarchy**
- Captures: `{360,…}/install-card.png`, `360/offline.png` (and the other widths), `*/state-dashboard-error.png`, `*/state-dashboard-not-found.png`
- What is wrong:
  - The install card title ("Add CliniQ AI to your Home Screen") is regular-weight Inter body text with the mark stacked above it, so the card has no visible title.
  - The `/offline` heading "You're offline" is a small semibold line with no WifiOff glyph, and Retry has no icon.
  - The route-state headings are semibold Inter.
- Expected:
  - Card titles in Manrope 700 (`cliniq-ai.css`: `.card h2 { font-family: var(--font-display); font-weight: 700 }`). The approved Android card (`install_360.png`) puts the mark at the left of a Manrope "Install CliniQ AI on this device" with the privacy line "Patient data is not stored on the device."
  - The approved offline page (`offline_360.png`) has mark, WifiOff, "You're offline" in Manrope 800 at about 20–22 px, and Retry with a RefreshCw icon.
  - Use title-1/title-2 Manrope for the not-found and error headings.

---

## Low

**L1. The sidebar clinic block shows "CliniQ AI" where the clinic's place belongs.**
- Captures: `1280/*` sidebar captures, `*/gallery-shell.png`
- Expected: clinic name plus place (12 px fg-muted), per UI-SPEC §6 and `today_1280.png` ("Asha Clinic / Kothrud, Pune"). If no place is stored, show nothing rather than repeating the product name under the clinic.

**L2. The user block and account menu show a login identifier, not a person's name.**
- Captures: `1280/*` ("test-doctor-17947261…"), `gallery-shell` ("pooja.n@example.com")
- Partly synthetic data, but the specimen also uses an email. Expected: display name (13 px) plus role (`today_1280.png`: "Pooja N / Front desk"), with an email fallback only when no name exists.

**L3. The Kbd hint says "⌘K" and "Ctrl K" in the same run.**
- Captures: `1280/owner-today.png` top bar shows ⌘K; `1280/gallery-overlays.png` tooltip and `1280/gallery-shell.png` palette-field specimen show "Ctrl K".
- Expected: one platform-derived label everywhere (UI-SPEC §6, CD-20).

**L4. Account menu grouping and colour.**
- Captures: `*/owner-account-menu.png`
- "Switch user" sits in the sign-out group after the separator, and both sign-out items are danger red.
- Expected (UI-SPEC §6): v1 items, then a separator, then "Sign out" last. Danger colour is reserved for destructive items (UI-SPEC colour table). Signing out is not destructive, so a neutral fg with only "Sign out of all devices" in danger-quiet would read calmer.

**L5. The error route state has an empty top-bar title.**
- Captures: `*/state-dashboard-error.png`
- The not-found state keeps a title ("Patient"); the error state shows a blank bar. Expected: keep the route's title, or "Something went wrong".

**L6. The install sheet is thinner than the approved iOS sheet.**
- Captures: `360/install-sheet.png`
- Expected (`install_360.png`): the key terms in bold ("Share", "Add to Home Screen", "Open as Web App", "Add") and a full-width "Done" button in the foot. The straight quotes in 'Open as Web App' should be typographic.

**L7. "With doctor" shows three hues across screens.**
- Captures: `*/owner-today.png`, `*/owner-queue.png`, `*/owner-patient.png` show a blue "In Consultation" pill; `*/doctor-consult.png` and `*/doctor-cabin.png` show green.
- The approved rule is Care Teal for With doctor and never primary blue (`cliniq-ai.css` status block; UI-SPEC status table). This is v1 content, but the blue contradicts a core rule and appears on the screens users open most. Cheap fix: route v1 badges through `lib/visit-status.ts` / StatusChip now.

**L8. The toast action looks about 28 px tall on the phone.**
- Captures: `360/gallery-overlays.png` (Toast "Undo" and ✕)
- UI-SPEC Toast: action 30 px, 44 on touch. Check the hit area; if only the visual is compact, ignore this.

**L9. The Rx search has no "M" Kbd hint at 1280 or wider.**
- Captures: `1280/gallery-clinical-b.png`
- UI-SPEC RxEntryRow and `consult-rx_1280.png` show it. If this was dropped on purpose under CD-18 (single-key shortcuts arrive in V2-09), note that in the spec.

**L10. A selected chip inside a disabled ChipGroup keeps full accent colour.**
- Captures: `*/gallery-forms.png` ("Disabled group": Fever)
- It reads as enabled. Expected: the disabled treatment (accent-disabled border, muted text) on selected items too.

**L11. The Billing page has a double gutter on phones.**
- Captures: `360/owner-billing.png`
- Content starts about 32 px in; other pages start at 16 (`owner-settings`, `owner-today`). The v1 page padding stacks on the shell's main padding.

**L12. Two page titles on v1 screens.**
- Captures: `*/owner-today.png` ("Dashboard" plus "Front Desk Overview"), `*/owner-queue.png`, `*/doctor-cabin.png`, `*/owner-billing.png`, `*/owner-settings.png`
- This is expected until V2-08/V2-11 rebuild these pages, but check that only one `h1` is exposed (UI-SPEC: the top-bar title is the `h1`).

---

## Polish

**P1.** Avatar initials take digits: "S0" and "S3" (`gallery-clinical-a`), "E3" (`owner-palette`). Take letters only (first letter of the first and last alphabetic words).

**P2.** Apostrophes are inconsistent. "Doctor’s Cabin" (typographic) in the top bar but "Doctor's Cabin" in nav (`*/doctor-cabin.png`). "You're", "doesn't" and "isn't" use straight quotes (`offline`, `state-*-not-found`), while the approved copy uses typographic quotes throughout.

**P3.** In the Command "Loading" specimen, a stray light-blue bar sits before "Searching…" (`1280/` and `360/gallery-overlays.png`).

**P4.** Command rows show the trailing "Enter" hint on phones (`360/gallery-overlays.png`), where it means nothing. Hide it with the other Kbd hints below 1024 px (CD-33 spirit).

**P5.** The SaveStatus specimen at 360 shows empty "SAVING" and "SAVED" headings, because those states are hidden below 768 px (`360/gallery-clinical-a.png`). Caption them "(announced only on phones)".

**P6.** The error and not-found states use different primary button sizes: "Try again" is 36 px and "Go to Today" is 44 px (`1280/state-dashboard-*.png`).

**P7.** The standalone not-found page has no brand mark (`*/state-root-not-found.png`). It is a signed-out-capable page and could carry the 32 px mark like `/offline`.

**P8.** The DataTable specimen's Status column is plain text (`*/gallery-data.png`). Showing StatusChip there would demonstrate the real table look (the `components_1280.png` table uses pills).

---

## What is right (for the record)
- Tokens and hues match `cliniq-ai.css` exactly across all four widths:
  - Midnight ink, CliniQ Blue primary, hover and pressed steps.
  - Status chips: Booked violet, Waiting amber, With doctor teal, To bill green, Done slate; Cancelled outlined; Rescheduled info; Unknown neutral.
- Clinical components (`gallery-clinical-a/b`) are faithful to `006-components` and `004-consult`:
  - TokenChip Manrope 800 with 1.5 px status borders, and the large 108 token.
  - Allergy strip solid danger with chronic conditions at weight 400.
  - Rx lines with option pills, and the allergy-match line with "Prescribe anyway…".
  - Vitals form with unit adornments and segmented °F/°C.
- Focus ring: a 2 px `ring` on a white halo, visible on primary, secondary, danger and tiles, as in `palette_1280.png` "Focus".
- Overlays: Dialog radius 20 on the Midnight scrim; Drawer with handle and 44 px foot buttons; Midnight tooltip and toast; menus with the popover shadow.
- Shell: the 216 px sidebar with a 3 px active bar, the 56 px rail with 44 px items, and the 60 px bottom bar are all correct. The brand mark is never recoloured or placed on a tile, and its sizes match the placements.
- Touch: inputs, buttons, segments, option pills and checkboxes rise to 44 px at 360 and 820.
- Density at 1280 is right: dense but not cramped.
