---
phase: 06-design-system-pwa-shell
wave: B (06-01b, 06-02a/b/c, 06-03a/b, 06-04b, 06-06)
reviewed_commit: 136cd04 (first-parent commits 763673f..0732cec plus 06-01b/06-02a commits; V2-05 merge commits excluded)
reviewer: independent (fresh context; plan records and wave notes not read before findings were formed)
date: 2026-11-15
findings:
  high: 1
  medium: 5
  low: 7
  info: 3
  total: 16
status: issues_found
---

# V2-06 Wave B: independent review

## Scope and method

Reviewed in a private detached worktree at `136cd04`. Areas read in full:
- the session-status route and client (`app/api/session-status/route.ts`, `lib/pwa/session-status.ts`, `lock.ts`,
  `update.ts`, `skew.ts`, `dirty-guard.ts`, `components/shell/pwa-runtime.tsx`)
- the shell (`components/shell/*`, `lib/nav/*`, `lib/pwa/keyboard-aware.ts`, `resume.ts`)
- the palette server actions (`features/patients|queue/{actions,service}.ts`)
- the new route-group layouts and loading files
- the clinical entry components (`rx-entry-row`, `vitals-*`, `patient-picker`, `quick-register-form`,
  `patient-identity-header`)
- the date and identity primitives (`date-field`, `calendar`, `age-or-dob-input`, `day-strip`, `lib/ui/age.ts`,
  `lib/datetime/format.ts`)
- the primitives v1 screens consume (`modal`, `dropdown`, `input`, `phone-input`, `button`, `cn`)
- 06-01b's contrast test.

`npm run typecheck` equivalent (`tsc --noEmit`) passes. For the probes I used a review-only Vitest config with no
global setup, so they never touched the local stack. They were scratch files in the private worktree, which was removed
afterwards. "Verified by running" means one of those probes reproduced the behaviour. Every other finding was
verified by reading.

Each finding states whether it can be reached in production at `136cd04`. Several 06-02c/06-03b primitives are mounted
only on `/dev/ui` today (`DateField`, `AgeOrDobInput`, `QuickRegisterForm`, `PatientPicker`, `RxEntryRow`, `VitalsSummary`).
They are rated by the harm they would cause once V2-07/08/09 wires them as designed. The wiring phase inherits each
defect unless it is fixed first.

---

## High

### H-1: A transient GoTrue failure answers 401 from `/api/session-status`, and every open device then signs out (server revocation, all tabs, device purge)

**Files:** `app/api/session-status/route.ts:44-47`; `lib/auth/tenant.ts:104-111`; `lib/pwa/session-status.ts:82`;
`components/shell/pwa-runtime.tsx:134`; `lib/auth/hard-sign-out.ts:190-206`

**Problem.** The route maps `UnauthenticatedError` to 401. `getActiveMembership()` throws it on ANY `authError` from
`supabase.auth.getUser()`. In `@supabase/auth-js` 2.117.2, `_getUser` turns every `AuthError` into `{ user: null, error }`
(`GoTrueClient.js:2724-2732`). That includes `AuthRetryableFetchError`, which covers a network failure, a timeout or a
GoTrue 5xx/502/503, and also an `AuthApiError` such as a 429. A failed token refresh inside `_useSession`
surfaces the same way. The client maps 401 to `hardSignOut("expired")`, which:
- announces the sign-out to every other tab
- POSTs `/auth/signout`, revoking the session at GoTrue once it answers again
- purges sessionStorage, non-preference localStorage, IndexedDB and caches
- hard-navigates to `/login`.

Both the route doc ("A lookup failure: 503 … never a sign-out") and the client doc ("A transient failure never signs
anyone out", `session-status.ts:21`) promise the opposite.

**Failure scenario.** Supabase Auth has a 30-second blip or a regional 503 during clinic hours. Every installed PWA
and open tab checks within minutes: on the 5-minute interval, on `visibilitychange`, on `online`, and after any client
error through `noteAppError` → `requestSessionCheck("error")`. Each one gets 401, so every receptionist, nurse and
doctor in every clinic is signed out mid-consult and loses whatever is on screen. Their sessions are then revoked
server-side, so they cannot recover by simply reloading.

**Verified by running.** With `getUser` mocked to return `AuthRetryableFetchError("fetch failed", 0)`, `GET()` answered
`401 { error: "unauthenticated" }`, and `readSessionStatus` maps that answer to `{ kind: "expired" }`. No spec covers
this path: `tests/api/session-status-db.spec.ts` tests only real sign-outs and revocations.

**Fix.** Separate "no session" from "could not check" in the route rather than in `getActiveMembership`, because the
page callers rely on the throw:

```ts
// route.ts: read the user first and classify the auth error
const supabase = await createClient();
const { data: { user }, error } = await supabase.auth.getUser();
if (error && (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500 || error.status === 429)) {
  return refuse(503, "unavailable", "auth_unavailable");
}
if (!user) return refuse(401, "unauthenticated", "unauthenticated");
```

Only a definitive answer should yield 401: `AuthSessionMissingError`, or a 401/403 from GoTrue for a revoked session.
Add a spec that mocks a retryable auth error and asserts 503, plus a client spec asserting that 503 → `unknown` → no
reaction.

---

## Medium

### M-1: VitalsSummary can hide a critical reading in the overflow popover behind three merely-high readings, and inline it looks no different from "high"

**Files:** `lib/clinical/vitals.ts:207-212`; `components/clinical/vitals-summary.tsx:21-29`

**Problem.** `summarizeVitals` sorts "flagged first" but treats `low`/`high` and `critical-*` the same. Inline, a
critical reading reads the same as a non-critical one (`"SpO₂ 84% low"`, same `danger-fg` style). Only the popover says
"critical".

**Failure scenario.** A queue row shows a patient with BP 150/95, pulse 110 and temperature 100.8 °F (all `high`) and
SpO₂ 84 % (`critical-low`). The row reads "BP 150/95 high · P 110 high · 100.8°F high", and the desaturation is
visible only if someone opens the popover. This is a triage-safety defect in the component V2-08's queue rows and
the V2-09 consult context will use. Not reachable in production at `136cd04` (`/dev/ui` only).

**Verified by running.** `summarizeVitals({ systolic:150, diastolic:95, pulse:110, temperatureF:100.8, spo2:84 })`
returned shown = `[BP 150/95:high, P 110:high, 100.8°F:high]` and left `SpO₂ 84%:critical-low` out.

**Fix.** Rank by severity: `[...critical, ...flagged, ...normal].slice(0, max)`. Render critical items inline with
their own marker, for example "SpO₂ 84% low · critical" with an `OctagonAlert` icon, as the popover and VitalsForm
already do. Add the four-item case above to the vitals spec.

### M-2: RxEntryRow keyboard grammar can silently record the wrong frequency or duration

**Files:** `components/clinical/rx-entry-row.tsx:107-127, 156-166, 129-132, 360, 364-371`

**Problem 1: a bare digit means frequency, not days.** With the builder open, the first digit from 1 to 5 picks a
frequency preset (`5` = `SOS`, `3` = `0-0-1`). The comment in `commit` says "Digits without a unit are days ('5' then
Enter = 5 days)". That holds only after a frequency digit has been typed.

Scenario: the doctor picks Paracetamol, whose usual dose is 1-0-1 for 3 days, and types `5` then Enter meaning 5 days.
The line committed is `SOS · After food · 3 days`, a different regimen. A digit followed by `d` (for example `3d`)
first changes the frequency, then the `d` falls through into the search box and drops the pending line.

**Problem 2: a typed duration overrides a later tap.** Type `2` (frequency), then `1`, so `durBuffer = "1"` and the
stepper shows "1…". Then tap the "7 days" tile or the + stepper. `update({days})` does not clear `durBuffer`, so
`commit()` overrides the tapped value with `Number(durBuffer)` and records 1 day while the screen showed 7 days.

**Status.** Verified by reading. Not reachable in production at `136cd04` (`/dev/ui` only; V2-09 wires it).

**Fix.**
- Clear `durBuffer` in `update()` whenever `days` is patched, and on any tile or stepper interaction.
- Either require the frequency digit to be explicit (e.g. `f1`…`f5`), or make a bare digit followed by Enter mean
  days when no frequency was typed, and make the comment true.
- When an unhandled letter arrives with `freqTyped` set, refuse it (`preventDefault` plus an error) instead of
  dropping the pending line.
- Add unit tests for `5`+Enter, `3d`, and a typed digit followed by a tile tap.

### M-3: PatientPicker acts on the previous query's results while a newer search runs (wrong patient on Enter)

**File:** `components/clinical/patient-picker.tsx:59-74, 105-115`

**Problem.** `results` is kept while a newer query loads, and the list renders it unconditionally. cmdk keeps the
first row selected, so Enter during the request picks a patient from the OLD query. The palette avoids this by showing
patients only when `results.query === trimmed` (`command-palette.tsx:86`); the picker does not.

`run()` also has no `try/catch`. A rejected server search leaves `loading` true forever and raises an
`unhandledrejection`, which feeds the skew guard and a session check. There is also no debounce, so each keystroke
makes one server call.

**Failure scenario.** At the front desk the receptionist types "98765" (two matches show), then quickly "4" and
Enter. The first patient for "98765" is added to the queue instead of the patient whose number is "987654…".

**Status.** Verified by reading. Not reachable in production at `136cd04`; V2-08 wires it ("Add to queue").

**Fix.**
- Render and select results only when `answered === trimmed`, as the palette does.
- Wrap `search()` in `try/catch/finally` so loading always clears.
- Debounce for 200 ms, like the palette.

### M-4: DateField keeps the previous valid date when the text is edited to an invalid one, so a form submits a date the user can see is wrong

**Files:** `components/ui/date-field.tsx:126-138, 172-179`; consumer `components/clinical/quick-register-form.tsx:76`

**Problem.** `commit()` returns on an error reading without calling `onValueChange(null)`. The parent's value therefore
stays at the last good date while the field shows other text and an error.

**Failure scenario.** The receptionist picks 12/11/1984, then corrects it to `31/02/1985`. The field shows "Enter the
date as dd/mm/yyyy", but `value` is still `1984-11-12`. QuickRegisterForm's check (`age: !age.dob`) passes, and the
patient is registered with the old DOB. A partial edit (`12/11/19` then blur) behaves the same way.

**Status.** Verified by reading. Not reachable in production at `136cd04` (`/dev/ui` only).

**Fix.** On an error reading, call `onValueChange(null)` when `value !== null`, or expose the invalid state to the
parent (for example `onValueChange(null, { invalid: true })`) so the form blocks submit. Add a spec that edits a valid
date into an invalid one and asserts the value is cleared.

### M-5: AgeOrDobInput turns an infant's age in years into a DOB months away from the truth (0 y → "10 m", 1 y → "22 m")

**Files:** `lib/ui/age.ts:92-98`; `components/ui/age-or-dob-input.tsx:122-152`

**Problem.** The unit select defaults to years and allows 0 or 1. `dobFromAge` maps years to 1 January of the birth
year, so the stored DOB says something else than what was typed.

**Failure scenario.** On 15 Nov 2026 a receptionist registers a newborn as "0 years". The stored DOB is `2026-01-01`,
and every later screen shows "10 m". "1 year" stores `2025-01-01` and shows "22 m". Paediatric growth and dosing work
from age (`lib/pediatrics/who-data.ts` exists, and V2-09 owns paediatric ranges), so an approximate DOB that is up to
11 months wrong for an infant is a clinical-data defect. The hint "Born about 2026" does not reveal it.

**Verified by running.** `dobFromAge(0,"y","2026-11-15")` gave `2026-01-01`, displayed as "10 m";
`dobFromAge(1,"y","2026-11-15")` gave `2025-01-01`, displayed as "22 m".

**Status.** Not reachable in production at `136cd04` (`/dev/ui` via QuickRegisterForm only).

**Fix.** Refuse years below 2 ("Enter the age in months below 2 years") or switch the unit to months automatically.
Alternatively use mid-year or same-day-N-years-ago for small ages and flag the result as approximate. Raise the
server's 1-January convention (`features/patients/schema.ts:24`) with the PO: it is the root cause for small ages.

---

## Low

### L-1: "Check for updates" says "You're on the latest version" when the check failed (offline, 5xx, timeout)

**Files:** `components/shell/more-sheet.tsx:51-62`; `lib/pwa/session-status.ts:134`

**Problem.** `readSessionStatus` returns `unknown` on failure, and `reactToStatus` maps that to `"none"`, which is the
same value as a successful check that found no update. `CHECK_FAILED_TEXT` is shown only for `"skipped"`.

**Verified by running.** A manual check with a throwing fetch resolved `"none"`. The only e2e case
(`tests/e2e/shell/toasts.spec.ts:69`) tests the online path.

**Fix.** Return a distinct `"failed"` reaction for `unknown`, and show `CHECK_FAILED_TEXT` for it.

### L-2: The consult and patient-record layouts turn a transient database error into a 404

**Files:** `app/(dashboard)/consultation/[id]/layout.tsx:19-31`; `app/(dashboard)/patients/[id]/layout.tsx:22-35`

**Problem.** `error` from the lookup, or any thrown error other than unauthenticated or locked, leaves
`visible = false` and calls `notFound()`. Before 06-04b the page's own loader would reach the route error boundary,
which offers Retry and reports the error. Now a doctor reloading mid-consult during a PostgREST hiccup is told the
visit does not exist, and nothing is reported. Verified by reading.

**Fix.** Call `notFound()` only for `!error && data === null` (or a malformed id). Rethrow the other errors so
`error.tsx` handles them.

### L-3: Pressing Enter in the palette before results arrive runs whatever action or nav item matches the text

**File:** `components/shell/command-palette.tsx:84-96`

**Problem.** While a search runs, `patients` is empty and `values[0]` is the first matching action or destination. A
fast "re" + Enter, intended for a patient called "Rekha", opens "Register patient"; "ref" + Enter opens Referrals.
Verified by reading.

**Fix.** While `loading`, ignore Enter (or wait for the answer and then pick the first row). Alternatively keep
Actions and Navigate out of the default selection when the query is two or more characters long.

### L-4: The palette's "no directory dump" minimum can be bypassed with LIKE wildcards

**Files:** `features/patients/service.ts:238-248, 326-337`; test claim at `tests/patients/palette-search-db.spec.ts:107`

**Problem.** `buildPatientSearchFilter` strips only `,()`, so `%%` or `__` passes the 2-character minimum and returns
the 8 newest patients. This stays within the caller's permission and clinic (RLS and `tenant_id`), so it exposes
nothing new; the stated control just does not hold. Verified by reading.

**Fix.** Escape `%`, `_` and `*` (PostgREST's `ilike` wildcard alias), or require two alphanumeric characters. Add
`%%` to the spec.

### L-5: Button's offline guard treats only an explicit `type="submit"` as a write

**File:** `components/ui/button.tsx:85`

**Problem.** `requiresNetwork ?? type === "submit"` sees `undefined` for a `<Button>` inside a `<form>` without a
`type`, even though HTML makes it a submit button. Such forms still submit offline. Most v1 forms set `type`
explicitly; I did not enumerate every multi-line case. Verified by reading.

**Fix.** Default `type` to `"button"` (the safer primitive) and require `type="submit"` for writes. Alternatively
check `event.currentTarget.form && event.currentTarget.type === "submit"` at click time.

### L-6: QuickRegisterForm shows the age error too early and swallows a failing submit

**File:** `components/clinical/quick-register-form.tsx:84-97, 145`

**Problems.**
- `onBlur` on the wrapper `div` fires when focus moves from the Age/DOB toggle into the age input, so "Enter an age
  or a date of birth" appears before anything was typed.
- If `onSubmit` rejects, `submit()` has no `catch`. That produces an `unhandledrejection`, which the skew guard can
  classify, and the user sees no error.
- Verified by reading. `/dev/ui` only.

**Fix.** Mark the field checked when focus leaves the whole group (`relatedTarget` outside the group). Add a `catch`
that shows an error Alert.

### L-7: AgeOrDobInput is half-controlled

**File:** `components/ui/age-or-dob-input.tsx:63-64`

**Problem.** `ageText` and `unit` are internal state. When the parent passes a value with a `dob` (editing a patient)
or resets it, the age box stays empty or stale while the hint shows "Born about 1984". Verified by reading.

**Fix.** Derive `ageText` from `value` when it changes from outside, the same way DateField does with `shown`.

---

## Info

### I-1: The admin role no longer has "Doctor's Cabin" in the navigation (v1 showed it to owner and admin)

**Files:** `lib/nav/nav-for-role.ts:103-111` versus v1 `components/layout/app-sidebar.tsx` (removed in d610d9d)

This is consistent with F-01: admin lacks `consultations:view`, so the cabin's actions would fail anyway. It is still a
visible change to a v1 screen set. Confirm it is intended (IA §3.2), and if so, decide whether `/cabin` should
redirect an admin, as it does receptionist and nurse (`cabin/layout.tsx:12`).

### I-2: The palette's "Today queue" for a doctor searches the whole clinic's queue

**File:** `features/queue/service.ts:340-344`

There is no `doctorId` filter, while the doctor's navigation shows only the cabin. This is no new exposure: a doctor
already holds `appointments:view` and can open `/queue`. The palette result opens `/cabin`, where another doctor's
patient is not listed, which is a small dead end.

### I-3: Picking a DOB in the calendar means paging month by month

**File:** `components/ui/calendar.tsx:89-92`

There is no year or month dropdown (`captionLayout`), so reaching 1960 takes about 790 PageUp presses or about 66
Shift+PageUp presses. Typing works and is the primary path; consider `captionLayout="dropdown"` when `max` is today and
no `min` is set.

---

## Checked and found sound (by reading)

- **Session-status route.** It reads no input (tenant from the session only), sends `private, no-store` on every
  answer, and its body is exactly `{deploymentId, accessLevel, redirect}`. The client accepts only the three known
  destinations and refuses an inconsistent `full`/redirect pair. The proxy runs on `/api/session-status`, which is not
  sessionless. The lock reaction keeps the session.
- **Palette server actions.** `resolveServiceContext` checks the permission before reading input. Tenant and RLS come
  from the context. The patient projection is the four fields (no full phone, no DOB). Nothing is persisted on the
  client, and results are cleared on close.
- **navForRole.** It is resolved on the server from the session role. Every destination's permission is held by the
  role. The BottomBar takes at most four items. The settings group is owner/admin only. Receptionist and nurse do not
  see Billing & Reports, which matches v1.
- **Route-group layouts.** The redirects run above `loading.tsx`, so a full load still answers 307 or 404. The patient
  layout requires `patients:view` and filters deleted records.
- **Dates.** Calendar, DayStrip, DateField and `lib/ui/age` work on clinic `YYYY-MM-DD` dates in the clinic's zone
  (`TZDate` at noon, `todayInTz`). `parseDmy` validates through `isYmd`, and the 29 Feb / month-end age arithmetic is
  correct.
- **Modal adapter.** Same `onClose` semantics, now with a focus trap and naming. The PhoneInput restyle keeps the v1
  logic.
- **`cn()`.** The theme scales are registered, so `text-body-sm` and `text-fg` no longer collide.
- **06-01b contrast spec.** It measures the shipped `globals.css` against the approved 169 pairs, so it cannot pass
  without the token values.

## Tests that would pass without the change

- **H-1 and L-1.** The session-status specs do not cover an auth outage, and the "Check for updates" spec does not
  cover a failed check, so both defects pass the current suite.
- **`tests/nav/nav-for-role.spec.ts:75-79`.** It compares against a hand-copied `EXPECTED` table of the
  implementation's own output: a snapshot, not an independent rule. The e2e `nav-per-role.spec.ts` does add a real
  check (each destination opens with 200 and no refusal text), so the pair is adequate.
- **`tests/patients/palette-search-db.spec.ts:107-110` ("no directory dump").** It passes while `%%` dumps (L-4).
