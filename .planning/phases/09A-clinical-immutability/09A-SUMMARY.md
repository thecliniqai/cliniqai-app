# V2-09a Clinical integrity (DB): summary

**Outcome:** a signed clinical record cannot change for any writer, the service role and postgres included, except through
the amendment commands. A signed prescription's PDF is stored once, hashed, and verified when served. Lab documents are
append-only. Branch `v2/phase-09a-clinical-immutability`, PR #15 into `feature/v2`, base `082d40e`, verified at `a7188a4`.
36 commits, 111 files.

## What shipped

| Plan | Migration | Changes |
|---|---|---|
| 09A-01 | 000107 | Seal on signed visits, notes, diagnoses, Rx items and follow-ups (BEFORE ROW INVOKER triggers, every role); `recordState` with a SQL/TS parity test; v1 API cancel answers 409 `VISIT_LOCKED`; fixtures sign through the command (R-15) |
| 09A-02 | 000108 | Prescription header seal (column grants, one header per request path); amendment versioning: Rx v2, `prescription.issued ...:signed:v2` |
| 09A-03 | 000109 | Write-once Rx PDF pair, insert-only `rx` storage policy, SHA-256 recorded and checked on read; drafts and variants never stored |
| 09A-04 | 000110 | Lab documents: no member DELETE on rows or objects; Delete button removed (void in V2-11, Q-5) |
| 09A-05 | — | Workspace: signed consultation read-only; Amend (reason 10–500) and Finalize for owner and doctor; journey 6; P1-03 known bug closed |
| 09A-06a | 000111 | Review fixes (`09A-REVIEW-TRIAGE.md`): signer-only Rx archive (R-A), share link hash check, lab rows not updatable, `visit_revisions` command-only, snapshot includes reason and location, TRUNCATE/TRIGGER revoked; UI rows B-1..B-7 |

## Behaviour changes users may notice

- A signed consultation opens read-only; changes go through Amend with a reason, then Finalize (Rx version goes up).
- Lab documents cannot be deleted by anyone until V2-11's void.
- Only the signing doctor's session stores a prescription's PDF; others get an on-demand copy until then, and a
  regenerated copy says so.
- Patient share links serve a prescription only after its hash checks out ("being prepared" just after an amendment).
- The v1 API answers 409 `VISIT_LOCKED` for changes to a signed visit.

## Backlog added (owner)

| Item | Owner |
|---|---|
| S-6: several active Rx headers per visit through the v1 API | V2-12 |
| Trusted `rx.archive` job (closes R-A residual and "signer left before archive") | V2-14, PO decision |
| Discard an open amendment | V2-13 (09B plan Q-5) |
| `patient_document.delete` audit action left in allow-lists | next migration touching them |

## Decisions

Plan rulings and Q defaults (`09A-PLAN.md`); ruling R-A (`09A-REVIEW-TRIAGE.md`), taken by the CTO delegate within ADR-0005.
