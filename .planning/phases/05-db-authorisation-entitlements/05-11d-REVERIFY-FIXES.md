---
phase: 05
plan: 05-11d
subsystem: 05a re-verification fixes (encounter child rows, amendment rows, invoice items, patient actor, notice links, v1 patients)
status: complete
findings: [N-1, N-2, N-3, N-5, N-6, N-7, N-8]
deferred: [N-4 (V2-09a with V2-08), N-9 (V2-09a / P1-37)]
migrations: [000075_reverify_integrity_expand, 000076_reverify_integrity_migrate]
plan_head_before: 505d10e9df3d8d2450192eac50456d7b903952c6
commits: [e77e91f, 6d834f6, 9610470, ad3123a, 7972f89, docs commit]
code_head_after: 7972f89
---

# 05-11d record: fixes for the 05a re-verification

**Outcome:** done locally. The re-verifier's report at `505d10e` (`reviews/v205a-review-reverify.md`) found 3 Medium,
1 latent Medium, 2 Low, 1 Low/Info, 1 Low and 1 Info. Fixed here: N-1, N-2, N-3 and N-6 (Medium), and the Lows N-5,
N-7 and N-8. N-9 is recorded for V2-09a as the brief asks. N-4 is **not** fixed. It was planned as a cheap Low, but it
is not local: the app's queue "Done" button and the checkout drawer complete unsigned visits by design today. See
Deviations: this needs the orchestrator's acknowledgement. Every fix has a regression test that fails without it. The
pgTAP file ran against the local stack at `000074`, and the v1 spec ran against the pre-fix route. The tool output is
in `evidence/05a/05-11d/`. Nothing hosted was contacted, and every Supabase CLI call used `--local`.

## Finding → fix → test → fails without

| Finding (reverify probe) | Fix | Regression test | Without the fix |
|---|---|---|---|
| **N-1** (Medium) A signed encounter's Rx items and diagnoses are moved to another patient, or edited/deleted, by any doctor; a diagnosis names a patient other than its visit's | 000075 `private.prescription_items_integrity_guard` and `private.consultation_diagnoses_integrity_guard` (BEFORE INSERT/UPDATE/DELETE). On **every** path, keys never change: item `id`/`prescription_id`/a set `tenant_id`; diagnosis `id`/`tenant_id`/`visit_id`/`patient_id`. A signed-in caller inserts a diagnosis only for its visit's own patient. A signed-in caller writes either child only while the visit is unsigned or reopened (`status = 'in_consultation'`), the M-SIGNED rule; a visit the caller cannot see counts as locked | `reverify_integrity.test.sql` 1-15 (the reviewer's re-key, edit and delete probes, both system-path cases, the insert-mismatch case, and two controls on an open visit); 22-25 (allowed after a reopen, locked again after finalize) | 13 of the 15 fail (UPDATE 1 / DELETE 1 as in the report); the 2 controls pass |
| **N-2** (Medium) The amendment row's `snapshot` is whatever the caller sends, so `'{}'` erases the record of the signed content | 000075 `private.visit_revisions_actor_guard` replaced, now SECURITY DEFINER. On every path, the database fills `snapshot` under the visit row lock: visit status, signature and specialty; `clinical_notes` (notes, vitals, complaints, specialty data, advice, investigations); diagnoses; the latest Rx with its items. The client value is ignored. A signed-in caller needs consultations:edit in the row's clinic (`AMENDMENT_FORBIDDEN`, checked before anything is read or locked). | 16-20 (the `'{}'` repro holds the signed note, vitals, diagnosis, Rx item and signer), 27-30 (the second amendment's snapshot is the amended, re-signed content; a system-path forged snapshot is replaced; another clinic's owner is refused) | all fail |
| **N-8** (Low) A squatted `revision_number` (2147483647) makes every later amendment overflow | same guard: `revision_number` = previous highest + 1 (at least `current_revision`), client value ignored | 16, 21, 22 (the squat gets 1, the next gets 2, the doctor's reopen still works), 27, 29 | 16, 21, 27 and 29 fail (22 passes before and after, because the app path computed max + 1 itself) |
| **N-3** (Medium) A doctor settles an invoice without collecting (MI5), zeroes it with a negative item (MI6), or types any line total (MI7) | 000075 `private.invoice_items_integrity_guard` (BEFORE, SECURITY DEFINER: it reads payments). On every path `total_price := round(unit_price * quantity, 2)` and item keys never change. For a caller the item policies admit, a `paid`/`cancelled` invoice's items are locked (`INVOICE_ITEMS_LOCKED`), and on an invoice with payments a write that lowers the total must leave it **above** the amount collected (`INVOICE_BELOW_COLLECTED`). CHECKs `invoice_items_unit_price_nonnegative` and `invoice_items_total_matches` are added NOT VALID, then VALIDATEd by 000076 after diagnostic D7i. `invoice_items_sync_invoice` never promotes to `paid`, which only `record_payment` sets. | pgTAP 31-47 (MI5/MI6/MI7 repros, a reduction that leaves a balance still allowed, a collector's removal below the collected amount refused, paid locks, key immutability, no promotion on the system path, a non-visit doctor refused by RLS as before, catalogue) and 57-61 (legacy row: D7i finds it, NOT VALID added over it, VALIDATE 23514, corrected, VALIDATE passes); `invoice-totals-db.spec.ts` (PostgREST MI5, MI6/MI7 with the doctor's JWT; the services' checkout with an advance) | pgTAP 31-47: 14 of 17 fail (35, 38 and 46 pass before and after). 57-61 abort at 000074 (the constraint does not exist) |
| **N-5** (Low) `patients.created_by` forged on INSERT and rewritten on UPDATE | 000075 `private.patients_actor_guard`: for a signed-in caller, `created_by` = the caller on INSERT and never changes on UPDATE (`ACTOR_INVALID`, the consent pattern of 05-11b) | 48-51 | 48 and 50 fail (49 and 51 are controls) |
| **N-7** (Low/Info) the notice link CHECK accepts `/<TAB>/host` | 000075 replaces `in_app_notifications_link_url_relative` (still NOT VALID): `'^/([^/\\[:cntrl:][:space:]][^[:cntrl:][:space:]]*)?$'`. A single leading `/`, then a character that is not `/`, `\`, a control or a space character, and no control or space character anywhere. VALIDATE stays a 05-b0 step after diagnostic D11n (triage assignment) | 52-56 (`/\t/`, `/\n/`, a trailing tab, `//host` refused; `/calendar`, `/queue?tab=waitlist`, `/patients/<id>`, `/` accepted) | 52-54 fail |
| **N-6** (Medium, latent behind PO-16) `PUT /api/v1/patients/:id` writes `allergies` and `chronic_conditions` with the system client | `9610470`: a body carrying either field gets 403 `CLINICAL_ACCESS_DENIED` before anything is read or written (`lib/api/patient-dto.ts`). The fields are removed from the zod schema, and the OpenAPI PUT description says so | `tests/api/v1-patients-no-clinical.spec.ts` (5: each field, a null value, a field next to a demographic change; nothing written and no audit row; demographics still update) | **5/5 fail** with the pre-fix route (200 or 422 and the allergy rewritten): `vitest-v1-patients-without-fix.txt` |

Totals: `reverify_integrity.test.sql` has 61 cases. At 000074, **45 of the 56 cases that run fail**. The other 11 are
controls that pass before and after. The last 5 (legacy-row VALIDATE) abort, because the constraint does not exist
yet (`pgtap-reverify_integrity-without-000075-000076.tap`). At 000076 all 61 pass
(`pgtap-reverify_integrity-with-000075-000076.tap`).

## The N-3 rule (documented, as the brief asks)

Only `record_payment` moves an invoice to `paid`. Once money is collected, a bill can grow, or shrink while a balance is
still due. It can never shrink to the collected amount or below, and the items of a paid or cancelled invoice cannot
change. No refund or adjustment path exists yet (V2-10: cancel/void/refund).
Consequences:
- "Paid without a payment covering it" cannot be produced through items. Neither can an `issued` invoice with a zero
  balance that no payment could settle (`record_payment` needs an amount above 0).
- A doctor still sets their own visit's fee at Sign & Bill, and can change it before anything is collected. That is
  what the own-visit carve-out (PO-3) already allowed.
- Product effect: in the checkout drawer, the front desk can no longer add a charge to an invoice that is already
  paid. A removal that would bring the bill to or below the collected amount answers "This change would bring the
  bill to or below the amount already collected, and refunds are not available yet." The drawer already hides
  "remove" on paid invoices.

## Legitimate paths checked

| Path | Where proven |
|---|---|
| Doctor signs their own visit; Sign & Bill (issued invoice with items) | full Vitest (`consultation-service-guards`, `collect-permission`, `review3-fixes-db`), e2e PR lane (sign & bill flows) |
| Amend a signed visit twice: reopen, edit Rx items and diagnoses, finalize, amend again (numbers 2 and 3) | pgTAP 21-28; `tests/integration/prescription-versioning.spec.ts` (app flow; revision 1 and its snapshot now come from the database) |
| Receptionist checkout with an advance: part payment, a charge added after it, a removal that leaves a balance, then the rest collected → paid | `invoice-totals-db.spec.ts` "checkout with an advance"; e2e `checkout-collect` (₹200 then ₹400) |
| Adding a charge to an unpaid invoice (after Sign & Bill, or after a part payment) | same spec; `billing_rpc_only.test.sql` 17-18 |
| A receptionist registers a patient as itself; demographics edits | pgTAP 49, 51; full Vitest |
| The app's in-app links (`/calendar`, `/queue?tab=waitlist`, `/patients/<id>`) | pgTAP 56 |

## Deviations

1. **N-4 not fixed (deviation from the brief; needs acknowledgement).** The brief lists N-4 as a cheap Low ("a
   receptionist cannot set an unsigned visit to completed — completion only through sign-off"). The re-verifier
   assumed the queue completes only signed visits. It does not. `transitionQueueState(…, "completed")` moves an open,
   unsigned visit to `completed`. It is used by the queue's "Done" button (`components/queue/status-actions.tsx`) and
   by the checkout drawer after collecting (`components/queue/checkout-drawer.tsx`), and
   `tests/security/review2-fixes-db.spec.ts` AR2-L2 asserts that path. A database rule "completed only with sign-off"
   would break the front desk's checkout for visits a doctor documents on paper. That is a product change, not a cheap,
   local one. Under the PO ruling of 2026-11-14 (item 3) the Low goes to the backlog with an owner: **V2-09a**
   (sign-off and amendment RPC; decide whether checkout completes only the queue token or the doctor can sign a
   front-desk-completed visit), with **V2-08** (queue UI). No code changed for it.
2. **[Rule 2] Child keys are immutable on every path, not only for signed-in callers.** This is the visits precedent
   (05-11a). A NULL `prescription_items.tenant_id` may still be backfilled (000048's statement, which
   `migration_edge_cases_fk` replays). `composite_fks` case 87 now expects 42501, because the guard refuses before the
   FK does.
3. **[Rule 2] The amendment guard became SECURITY DEFINER.** A snapshot taken with the caller's read rights would
   silently miss what the caller cannot read. The permission check runs first, so nothing is read or locked for a
   refused caller. The guard is catalogued in `definer_functions.test.sql` with no EXECUTE grant.
4. **The amendment row is not restricted to signed visits.** Restricting it would flip the generated authz matrix's
   `visit_revisions` INSERT cells (the fixture visit is unsigned). A row on an unsigned visit opens nothing, because
   reopen is gated on signed visits only. Its number and snapshot are now the database's.
5. **The prescription header is not locked on a signed visit.** The reviewer's `update prescriptions set version = 9,
   signed_at = null` still works for a prescriptions:edit holder. The app seals the header after the visit is signed
   (`completeAndSignConsultation` step 4), so a lock needs the sign-off to become one command. That is the V2-09a
   amendment RPC (R-21, already deferred by the triage).
6. **The N-3 refusals are for callers the item policies admit.** Anyone else falls through to RLS, so the error text
   never reveals an invoice's state (pgTAP 46). The system path (service role, migrations) is not locked. No
   caller-facing service-role writer of `invoice_items` exists.
7. **App simplification.** `reopenVisitForAmendment` no longer reads diagnoses, the Rx or earlier revisions to build a
   snapshot it would only have discarded. It inserts the row and reads back the number. Deploy order: 000075 before
   this app build (an older database would refuse the insert, because `snapshot` and `revision_number` are NOT NULL).
8. **[Rule 3] Two latent harness defects hit the first full run, and both are root-caused (flaky-test policy).**
   (a) `review2-fixes-db.spec.ts` rescheduled its clinic's visit to day 4 at 05:00 UTC. That lies inside
   `seedSlotIso`'s window for the same doctor's other seeds (2 days + a random base of up to 2 days + 20 minutes per
   seed), so a high random base made two later seeds collide (23P01). It now reschedules to day 13, clear of the window
   and of the day-9/day-11 cases; 3 consecutive file runs passed. (b) `tests/setup/teardown.ts` checked tenant ages
   with one unchunked `in` list of every run tenant. The final run created 208, past the gateway's URL limit, so the
   teardown failed and left the run's data behind. It is now chunked (`TENANT_CHUNK`). The run data the failed
   teardown left was removed by a `db reset --local` before the final run. Commit `7972f89`.

## Shared artefacts (commit `ad3123a`)

`EXPECTED_MIGRATION = "000076"`; `scripts/drift/schema-snapshot.txt` (after `supabase db reset --local`, 000001-000076);
`authz_matrix.test.sql` / `AUTHZ-MATRIX.md` (`authz:gen`: the patients INSERT row names the caller, plus notes);
`types/database.ts` unchanged (no column change; `db:types` was re-run with no diff).

## Local evidence (tool output, `evidence/05a/05-11d/`)

| Check | Result | File |
|---|---|---|
| typecheck, `eslint .` (0 errors), inventory (0 flagged), schema snapshot `--check`, `db:drift:local` | all exit 0 | `static-checks.txt` |
| pgTAP lane + gate at `ad3123a` (db 000076) | 29 files, **3257/3257**, gate PASS | `pgtap-lane.tap`, `pgtap-lane.txt` |
| new pgTAP file without / with 000075-000076 | 45 of 56 run fail, then abort / 61/61 | `pgtap-reverify_integrity-*.tap` |
| v1 spec against the pre-fix route | 5/5 fail | `vitest-v1-patients-without-fix.txt` |
| full Vitest, first run at `ad3123a` | 247 files passed; 2 tests failed in `review2-fixes-db.spec.ts` (seed visit 23P01), and the teardown failed with "URI too long". Root-caused and fixed in `7972f89` (Deviation 8); neither is a 05-11d behaviour | `vitest-full-first-run.txt` |
| full Vitest at `7972f89` (fresh `db reset --local`) | **248 files, 4873/4873 passed, 0 retried**; teardown removed 208 run tenants and verified none remain | `vitest-full.txt` |
| e2e PR lane (desktop, Pixel 7, iPhone 15), fresh `e2e:build` at `ad3123a` (later commits change tests only), run at `7972f89` | **220 passed, 9 skipped, 0 retried**, exit 0 (the ✘ lines are the existing `knownBug` expected failures; P1-03's signed-Rx case asserts the UI and still fails as expected) | `e2e-build.txt`, `e2e-pr.txt` |
| diagnostics on a populated local database (before the reset: 208 clinics, 757 invoices, 1673 visits, 688 Rx items) | D7i = D1p = D11n = D11r = 0; D6d = D9t = D5s = FKNV = 0 | `../diagnostics/after-05-11d.json` |
| gitleaks (repo config) over `505d10e..7972f89` | 5 commits, no leaks | `gitleaks.txt` |

The local stack is shared with V2-06's worktree. Every recorded run took the test-run lock, waiting for V2-06's runs
to finish first. `supabase db reset --local` ran twice: before the artefacts were regenerated, and before the final
Vitest run.

## Threats

New surface: two SECURITY DEFINER trigger functions (`invoice_items_integrity_guard`, `visit_revisions_actor_guard`).
Neither has an EXECUTE grant, both pin `search_path ''` and use qualified names, and both check the caller's permission
before reading other rows. Every refusal is a fixed 42501 or 23514 with no row data. No grant, policy or table changed.
The v1 change only narrows what a key can write.

## Open items

- **N-4** → V2-09a with V2-08 (Deviation 1).
- **N-9** (Info) → V2-09a / P1-37 invariant: service-role writes can still reopen a signed visit without an amendment
  row. The only caller-facing service-role writer (v1 PATCH) refuses locked visits. Either the amendment rule moves to
  every path in the V2-09a amendment RPC, or every service-role visit writer stays lock-filtered.
- **P1-37** list now includes `/api/v1/patients`: GET still returns allergies and chronic conditions, and POST accepts
  them at creation (as the app's registration does: R-8's guard is UPDATE-only). PUT refuses them since 05-11d.
- **Prescription header lock** on a signed visit → V2-09a (Deviation 5).
- **Refund / adjustment path** for collected or paid invoices → V2-10 (the N-3 rule refuses until then).
- **05-b0:** 000076 stops on D7i > 0 (no automatic remedy for a bill); VALIDATE `in_app_notifications_link_url_relative`
  after D11n; keep "Confirm email" on in the hosted project (re-verifier H-INVITE note).
- **05a gate:** add `reverify_integrity` (61) to the pgTAP `REQUIRED_FILES`; `billing_rpc_only` stays 25,
  `composite_fks` 105, `definer_functions` 40. The Vitest gate list may add `tests/api/v1-patients-no-clinical.spec.ts`.
- Fresh re-verification of N-1, N-2, N-3 and N-6 (Mediums), per the triage rules.

## Self-Check: PASSED

Migrations 000075/000076, `reverify_integrity.test.sql`, `lib/api/patient-dto.ts`, `tests/api/v1-patients-no-clinical.spec.ts`
and every evidence file listed above exist. Commits e77e91f, 6d834f6, 9610470, ad3123a and 7972f89 are ancestors of
HEAD (`git rev-list --count 505d10e..7972f89` = 5, plus this docs commit). No commit deletes a file.

