# 05b Review triage (V2-05b)

Reviewed commit `5e9d1df`. Three fresh reviewers; reports in `reviews/`: `v205b-review-independent.md` (IND),
`v205b-review-adversarial-access.md` (ACC), `v205b-review-adversarial-ai-billing.md` (AI). Triage by the orchestrator
as CTO (PO delegated rulings; speed ruling 2026-11-14: Highs/Mediums fixed with a test that fails without the fix and
a fresh re-verification; Lows only when cheap). Fix plan: **05-12** (migrations from 000092 + app).

## High

| ID | Source | Finding | Fix |
|---|---|---|---|
| H-AITZ | AI H-1, ACC M-1 | Owner/admin multiplies the AI trial quota (and shifts the monthly key) by editing `tenants.timezone` (no CHECK, unaudited) | AI periods computed independently of `tenants.timezone`: trial key anchored on the stored trial start, month in Asia/Kolkata (the billing anchor). `tenants.timezone` CHECKed against valid IANA names, changes audited. pgTAP changes the time zone mid-trial and mid-month |

## Medium

| ID | Source | Decision |
|---|---|---|
| M-AIEXP | AI M-1 | `ai_commit` refuses an expired reservation (`AI_RESERVATION_EXPIRED`); the V2-12 gateway contract aborts the provider call at the reserved timeout (recorded) |
| M-CANCEL | IND M-1, AI L-1 | Cancelling a job (tenant_not_full) closes its delivery row (`communication_queue` / `webhook_delivery_queue` → cancelled) and scrubs PHI exactly like the dead path; `backfill_delivery_jobs` never recreates a closed row; a cancelled `email.invite` leaves the invitation resendable. Spec goes through `enqueue_message` |
| M-REINVITE | IND M-2 | A pending invite to the same address with a different role is revoked and recreated (new version, new email); the action tells the owner which happened |

## Lows fixed in 05-12 (cheap)

- IND L-3 + ACC L-1: removing a member disables the webhook subscriptions they created (and the signing secret stops being valid for them).
- ACC L-2: API-key authentication re-checks that the key's creator is still an active member with the required role.
- IND L-6: `ai_commit` / `ai_release` bound to the reserving user (or the system path).
- IND L-2 + I-5: quota key per feature from the entitlement row; null limit semantics fixed in the helper comment and code.
- AI L-3: clearing a patient's AI objection is audited and limited to doctor/receptionist (AI §4.6).
- IND L-7: referral target guard requires an active doctor.
- IND L-4: the restricted prescription response for an expired clinic returns the SUB-D6 metadata list (doctor name/registration, no patient name).
- IND L-5: an owner of a locked clinic can still remove staff (safety), with the same rules and audit.
- ACC L-3: patient WhatsApp replies do not change visits of a clinic without full access (reply handled as unavailable).
- ACC L-4 + IND I-7: pages that read the membership directly redirect a locked clinic on client navigation instead of rendering empty.
- IND I-6: the server Turnstile check verifies the widget `action`.
- Locked/onboarding page copy names no internal phase ids (CTO, 2026-11-15).

## Accepted / assigned

| Item | Reason | Owner |
|---|---|---|
| IND L-1: invite throttles (20 sends/h per clinic, 3 resends, 10 accepts/h per token) | Needs the shared rate limiter scheduled for V2-12; deferral now recorded | V2-12 |
| AI L-2: a plan purchasable without a provider plan id; Standard seeded so | Enforcing it now blocks `start_trial` until the Razorpay plan id exists | V2-13b |
| AI I-2: reservation not tied to visit/patient (objection during the window) | Gateway work | V2-12 |
| AI I-3: comp on a still-`trialing` clinic keeps trial AI entitlement | Lifecycle jobs set status at trial end | V2-13b |
| AI I-5: `tax_rate_bp` not pinned to 1800 | GST rate can change by law; platform-admin RPC only, audited | — (accepted) |
| AI I-1, I-6, I-7; ACC Info items; IND I-3 (suspended unused), I-4 (platform actor ids visible to owners) | Recorded; no current exposure of PHI or cross-tenant data | V2-13c / V2-14 |
| IND I-1: new clinics land on `/onboarding/billing` until V2-13b; un-comped clinics lock when 000090 applies | Planned (R-24/R-25); stays in the deploy runbook | 05b gate / runbook |
| IND I-2: 000079 drops columns without an explicit emptiness assert | Applied migration; safe by construction (000053 moved content, checked) | — (accepted) |

## CTO ruling (2026-11-15): who may clear a patient's AI objection

05-12 limited clearing to doctor or receptionist (AI §4.6). Ruling: an **owner who practises** (holds the doctor
permissions, typical in single-doctor clinics) may also clear it; admins and nurses may not. The clear stays audited.
Implemented with the 05b gate close.
