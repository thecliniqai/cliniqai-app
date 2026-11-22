# V2-09b Consult workspace: summary

**Outcome:** the doctor's consult screen is rebuilt for speed and safety. Drafts save through one atomic command and
survive refreshes, lost answers and leaving the screen; entry is tap-first with Smart Assist ordering learned from the
doctor's own signed visits; diagnosis search understands Indian OPD shorthand; a deterministic patient snapshot replaces
the LLM catch-up. Branch `v2/phase-09b-consult-workspace`, PR #16 into `feature/v2`, merged as `02b2f49`.

## What shipped

| Plan | Migration | Changes |
|---|---|---|
| 09B-01 | 000112 | `save_consultation_draft` definer command, `draft_version`, one follow-up per visit; client saver with retry, rebase and unload guard |
| 09B-02a/02b | — | Workspace layout rebuild for phone, tablet and desktop |
| 09B-03 | 000113 | Tap-first complaints, exam templates and plan; `consult_assist_context` (own signed visits, names and counts only) |
| 09B-04a | 000114 | `GET /api/terminology/diagnoses` with abbreviations; `patient_snapshot` on the consult and Today doctor mode; LLM catch-up deleted |
| 09B-04b | 000115 | Shorthand command bar, private doctor macros, follow-up chip and Book follow-up (consult and front desk) |
| 09B-05 | — | Upload drop zone, journey 6, accessibility pass, PO kit |
| 09B-06a | 000116 | Review fixes: upload idempotency, no uploads on closed or signed visits, draft-command range checks, flush on leave, no preselected follow-up, 4 MB upload limit with a proxy 413 gate |
| CI fixes | — | Quick OPD chips deduped against learned tiles; unload guard set with the edit; e2e isolation; lane limit 85 min |

## Behaviour changes users may notice

- No follow-up is preselected; the doctor taps one.
- Lab uploads are limited to 4 MB (Vercel's body cap); uploads are refused on a signed, completed or cancelled visit.
- An exam template asks before replacing findings already typed.
- The snapshot replaces "Last visit" in the consult's patient column.

## Backlog added (owner)

| Item | Owner |
|---|---|
| 25 MB uploads via direct-to-Storage (architecture) | PO decision; V2-14 proposed |
| S-3: `recordVisitVitals` writes `clinical_notes.vitals` with the session; move to a definer command and revoke | V2-14 |
| S-4: `specialty_data` unchecked in the draft command | V2-14 |
| Consult route JS 368 kB (budget 200 kB, report-only) | V2-14 |
| Today: PostgREST `max_rows = 1000` silently truncates a day above 1000 visits | V2-11 / V2-14 |
| Today: full re-render on each Realtime signal; ~6 s to "Live" (first channel join refused, then rejoined) | V2-14 |
| e2e lane at 85 minutes; Vitest job 25–35 of 45 minutes: shard | PO decision (09B-P5) |
| `search_diagnoses` p95 39 ms against 50 ms: trigram prefilter if the real catalogue pushes it over | V2-14 |
