# clinicOS (working name "ClinicQ")

> **Authority.** This file is a GSD summary. The approved sources of truth are listed in `CLAUDE.md`
> (`docs/v2/V2_MASTER_ROADMAP.md`, `docs/v2/VERIFICATION_LOG.md`, the architecture and design docs,
> `docs/adr/`). Where this file disagrees with them, they win; fix this file.

## What This Is

A clinic management SaaS for independent doctors and small outpatient clinics in India, covering the clinic
day from booking through queue, consult and prescription to billing, plus patient messaging. Roles: owner/admin,
doctor, receptionist, nurse, and platform admins. It handles patient health data, so every record is sensitive.

## Core Value

Every core clinic action is obviously faster than the paper/WhatsApp status quo — zero-training, few taps,
usable from a phone — **and no clinic can ever see or change another clinic's data.**

## Business Context

- **Customer**: independent doctor / small clinic owner in India; receptionist, nurse and doctor are daily users
- **Revenue model**: Standard plan ₹1,499/month + 18% GST per clinic on Razorpay Subscriptions, 14-day
  trial; coupons and SaaS refunds; no AI sold in v2.0 (PO-20, PO-21; roadmap §1.1)
- **Success metric**: see roadmap §15 (milestone acceptance) and gates G6 (UAT start) / G7 (paid launch)
- **Strategy notes**: `docs/v2/SUBSCRIPTIONS_AND_PLANS.md`, `docs/v2/AI_STRATEGY.md`

## Current Milestone: v2.0

**Goal:** make clinicOS safe to run with real patient data, rebuild its foundations and workflows, add the
SaaS business layer, and take it through real-world UAT to a paid launch (roadmap §1.1, §12).

**Target features:**
- Security containment of the v1 P0 defects, on a local DB regression harness (V2-01a, V2-01)
- Foundations: CI, platform hygiene, reliable jobs, role-aware RLS with entitlements, design system + PWA shell
- Rebuilt workflows: front desk, consult, Rx, billing, profile/registers/settings, integrations/AI/API, DPDP lifecycle
- SaaS subscriptions, coupons and refunds; platform admin portal and tenant data lifecycle
- Password auth (OTP only for signup/recovery), installable PWA, gated AI (Smart Assist + trial-only Scribe preview)
- Security verification, production readiness, real-world UAT (G6) and paid launch (G7)

## Requirements

### Validated

None. v1.0 built the clinic workflows but closed without verification (override closeout, `MILESTONES.md`);
the v2 assessment found P0 defects. v1 requirements are re-specified in the v2.0 backlog.

### Active

The full v2.0 requirement set is the approved backlog in roadmap §10, indexed in `.planning/REQUIREMENTS.md`
with its phase traceability. Tracks: P0–P2 technical debt (§10.1), SUB / SUB-COUPON, AI, AUTH, PWA and FT (§10.2).

### Out of Scope

Items placed in v2.1, "after v2.0" or "post-v2.0" in roadmap §10 (listed in `.planning/REQUIREMENTS.md`,
Future Requirements), plus: native apps (PWA only), structured lab orders/results (PO-5: v2.1), non-appointment
reminders (PO-8: v2.1), selling any AI product in v2.0 (PO-21), live ABDM integration.

## Context

- **v1.0** (archived 2026-11-11, tag `v1.0-mvp-baseline` on `main`) proves the product but is not safe for
  real patient data; it is not live (PO-1). The hosted `.env` Supabase project is a test DB; production is a new
  project built once in V2-15 (PO-15, big-bang go-live).
- **V2-00** (pre-flight) is done; G0 signed off 2026-11-11 (PR #1), ADR-0005 Accepted.
- Team is the PO + Claude only; every gate gets an isolated Claude reviewer, the PO approves (PO-10, PO-18).

## Constraints

- **Working agreement**: `CLAUDE.md` (stack, commands, non-negotiables, definition of done) — binding.
- **Branching**: `v2/phase-<n>-<slug>` off `feature/v2`, PR into `feature/v2`; never touch `main`.
- **Data**: no PHI or secrets in logs, fixtures, prompts, commits or docs; India-only storage (PO-12).
- **Tests**: never against hosted Supabase; until V2-01a lands, only the approved override command, with PO approval.

## Key Decisions

PO decisions PO-1…PO-26 are in roadmap §1.2; prioritisation rulings C1…C50 in §10.3; architecture decisions
in `docs/v2/ARCHITECTURE_DECISIONS.md` and `docs/adr/` (ADR-0005 Accepted at G0). Not duplicated here.

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-11-11 at the start of milestone v2.0*
