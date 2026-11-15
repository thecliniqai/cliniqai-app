# 06-09c Wave B review triage (V2-06)

Reviewed commit `136cd04`. Reports in `reviews/`: `v206b-review-independent.md` (IND),
`v206b-review-adversarial-session-palette.md` (B). Triage by the orchestrator as CTO (PO delegated rulings; speed
ruling 2026-11-14). The session/auth items are security-sensitive (fresh re-verification after the fix); the clinical
component items are patient-safety defects and are fixed now even though the components are only on `/dev/ui` today,
because V2-07/08/09 wire them in. Fix plan: **06-09c** (application only, no migration), after 06-08.

## High

| ID | Source | Finding | Fix |
|---|---|---|---|
| H-AUTHOUT | IND H-1, B H-1 | A Supabase Auth outage (network, timeout, 5xx/429) makes `/api/session-status` answer 401, so every open device signs out, purges and loses unsaved input | `getActiveMembership` / the route distinguish "no or rejected session" (401) from retryable Auth failure (503); the client never signs out on 503 or network error and retries with backoff. Tests: mocked 503, 429, timeout and network error each answer 503 and leave the device signed in; a revoked session still answers 401 |

## Medium

| ID | Source | Decision |
|---|---|---|
| M-REMOVED | B M-1 | When the active-clinic cookie names a clinic that is no longer an active membership, treat it as removal (403 → purge and sign-in/clinic chooser) whatever the number of remaining clinics; never switch clinics silently. Test with a member of two clinics removed from the active one |
| M-VITALS | IND M-1 | A critical vital is never hidden in the summary and is visually distinct from "high" (icon + word + colour); criticals sort first |
| M-RXKEYS | IND M-2 | Keyboard dose entry: digits 1–5 map to the documented frequencies exactly as the inline help says, a bare number + Enter never becomes SOS; a later tap on a duration tile or stepper always wins over an unfinished typed duration; the line shows exactly what will be saved |
| M-PICKER | IND M-3 | Enter while a new search is loading does nothing (or waits); results are keyed to the query that produced them; a failed search shows an error state, never an endless spinner |
| M-DATE | IND M-4 | Editing the date text into an invalid value clears the stored value and shows the error; the form cannot submit a date the field shows as invalid |
| M-INFANTAGE | IND M-5 | Age entry in years/months derives a DOB consistent with what the screen then shows (no "0 years" → 10 m); infants are entered in months by default below 1 year |

## Lows fixed in 06-09c (cheap)

IND L-1 (update check reports offline/failed honestly); IND L-2 (a transient DB error in the consult/patient layouts
shows the error boundary, not 404 — clinic-isolation 404 unchanged); IND L-3 (palette Enter before results opens
nothing); IND L-4 + B L-1 (escape `%`, `_`, `*` in palette search; minimum 2 non-wildcard characters); IND L-5 (offline
guard covers default-submit buttons); IND L-6 (quick-register age error timing and failed-submit handling); IND L-7
(age-or-DOB input shows the existing value when editing).

## Accepted / assigned

| Item | Reason | Owner |
|---|---|---|
| B L-2: no server rate limit on session-status and palette actions | Shared rate limiter | V2-12 |
| IND I-1: admins no longer see Doctor's Cabin in nav | CTO: consistent with R-9 (admins hold no clinical access); the URL still opens for roles that can use it | — (ruling) |
| IND I-2 / B Info: doctor's palette searches the whole clinic queue | Same data the doctor can already open; no new exposure | V2-08 (scope by doctor if wanted) |
| IND I-3: DOB calendar pages month by month | Typing the date is the fast path | V2-08 |
| B Info: deployment id exposure, suspended = removed, `/SW.JS` header quirk | Recorded | V2-14 |

## Re-verification outcome (reviews/v206c-review-reverify.md, at de553cd) — CTO, 2026-11-15

H-AUTHOUT and M-REMOVED PARTIAL: original reproductions closed, new routes found. Fix plan **06-09d**:

| ID | Severity | Decision |
|---|---|---|
| H-AUTHOUT-R1 | High | Token-refresh errors that are not definitive (429, 408, 5xx, network, uncoded 400, gateway 404, non-GoTrue answers) never delete auth cookies in `proxy.ts` or `lib/supabase/server.ts`; the request is answered as "auth unavailable" (503 for APIs/actions, error page for navigations, never a `/login` redirect). Only GoTrue's definitive codes (e.g. refresh token revoked/not found/invalid) sign out |
| L (classify) | Low | Classify `/user` and refresh failures by GoTrue error codes, not by HTTP 4xx; a Kong "Invalid API key" 401 is "unavailable", not "signed out" |
| L (outage nav) | Low | During an outage, page navigations and `withPageAuth` (Today) show the unavailable state, not `/login` |
| L (retry) | Low | Bound server-side refresh retries to fit inside the client's timeout; add jitter to the client back-off |
| M-REMOVED-R1 | Medium | `/api/session-status` (and the layout) pin the active-clinic cookie to the resolved clinic when none is set, so a later removal answers 403 on every device; a member of only one clinic gets it pinned on first poll |
| L (last clinic) | Low | Removal from the last clinic on a full page load signs out and purges (no `/clinic/new` redirect for a removed member) |
