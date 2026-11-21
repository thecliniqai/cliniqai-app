# V2-09b review triage (CTO delegate, 2026-11-21)

Sources: `09B-REVIEW-A.md` (isolated, Sonnet) and `09B-REVIEW-SEC.md` (adversarial, Opus); both static, whole phase
(`f15fa25..9cfd5102`). No Critical. Lean process: one fix round (09B-06a). Every fix needs a test that fails without it,
measured, not assumed.

## Ruling R-U (upload body size), CTO delegate

Production runs on Vercel (`vercel.json`, TARGET §3.9 "Unchanged Vercel deployment"). Vercel refuses request bodies over
4.5 MB, and with `proxy.ts` in place Next cuts bodies at 10 MB, so the 26 MB server-action limit cannot deliver 25 MB uploads
in production; it only widens the pre-authentication memory surface (S-1 / A-5).

- `bodySizeLimit` goes to `"4mb"`. The client and server lab-file limit becomes 4 MB with the existing refusal text pattern
  ("larger than 4 MB"). Before 09B the limit was effectively 1 MB (a defect), so 4 MB is still a gain.
- `proxy.ts` answers 413 to any non-GET/HEAD request whose `content-length` is over 1 MB or missing, unless the caller has
  a session and the path starts with `/consultation/` or `/patients/`. Spec in Vitest on the proxy function.
- **PO decision:** uploads up to 25 MB need a direct-to-Storage upload (signed upload URL under the existing storage RLS,
  plus a small finalize action). That changes the upload path in the architecture, so it is the PO's call; proposed for
  V2-14 or earlier if clinics need large scans.

## Rows

| ID | Sev | Decision | Fix (09B-06a) |
|---|---|---|---|
| S-1 / A-5 | Med | Fix (R-U) | As R-U |
| A-1 | High | Fix | Unsent edits flush on in-app navigation and unmount (flush, then dispose; Next router navigation and Back). Tile taps arm the save like typing. e2e: tap tiles, navigate away within 5 s, the DB holds them |
| A-2 | High | Fix | Applying an exam template when legacy free-text `systemic` (or any exam text) has content asks for confirmation and never silently replaces typed findings; cancel keeps the text. e2e or Vitest on real rows |
| A-3 | Med | Fix | No preselected follow-up: the 5-day option is shown as a suggestion and is not stored until the doctor taps it (consistent with "no default value is invented"). Spec: an unrelated edit stores no follow-up |
| A-4 | Med | Fix | Upload idempotency: the client generates a request id per file; the server derives the storage key from it and the insert is unique on `(tenant_id, client_request_id)` (migration 000116), so a retry after a lost response stores one row and one object. Spec simulates a lost response after commit |
| S-2 / A-8 | Med | Fix | Uploads refused on a signed, completed or cancelled visit on every path: service check plus a BEFORE INSERT trigger on `patient_documents` in 000116 (visit-linked rows only; a patient-record upload with no visit stays allowed). pgTAP and Vitest |
| S-3 | Low | Fix if no request-path writer remains | Revoke direct UPDATE of `clinical_notes.vitals` from `authenticated` when every writer is a definer command (inventory in the notes); otherwise defer to V2-14 with the inventory. pgTAP grants |
| S-4 | Low | Fix (part) | `save_consultation_draft` (replaced in 000116) checks vitals ranges equal to the zod schema, follow-up date within today..+366 days, complaint objects' keys and types. `specialty_data` catch-all deferred to V2-14 (backlog row). pgTAP |
| A-6 | Low | Fix | The saver recreated after Amend or Finalize starts from the server's current values, not the mount-time snapshot. Vitest |
| A-7 | Low | Fix | An out-of-range or half-typed vital is held back (marked invalid in place) and does not block saving the other dirty fields. Vitest plus e2e |
| A-9 | Low | Accept | Macro expansion before parsing is by design: the preview shows the result and nothing is inserted without a tap. Note in 09B-NOTES |
| S-5 | Hard | Accept / V2-12 | Search term in a GET query string: the term is a diagnosis word, not a patient identifier; rate limit is V2-12. PO informed |
| S-6 | Hard | Fix (cheap part) | Storage extension from the verified type, not the client name; PDF/JPEG/PNG signature bytes checked server-side; stored file name stripped of control and bidi characters and capped. Vitest |
| S-7 | Hard | Fix | Revoke EXECUTE from PUBLIC on the two 000115 trigger functions (in 000116). pgTAP |

## Other close items

- Consult route JS 368 kB against the 200 kB report-only budget: V2-14 performance backlog.
- 09B-P3 (staging): duplicate follow-ups per visit check before 000112 (query in `09B-NOTES.md`).
