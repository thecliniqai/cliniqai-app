# Requirements: ClinicQ

**Defined:** 2026-10-06
**Core Value:** Every core clinic action is obviously, overwhelmingly faster than the paper/WhatsApp status quo — zero-training, under 3 taps, usable entirely from a phone.

**Source:** `.planning/intel/requirements.md` (extracted from `docs/clinic-management-prd.md`, PRD confidence: high)

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Tenancy & Users

- [ ] **REQ-multi-tenancy**: Each clinic is an isolated tenant with full data partitioning; multi-staff accounts with role-based permissions (Owner/Admin, Doctor, Receptionist, Nurse); clinic profile; OTP-based staff invite/onboarding; subscription status (₹1,000/month, payment history, renewal) visible to Owner/Admin; data model anticipates a doctor belonging to multiple tenants in future. *(PRD §4.1)*

### Scheduling

- [ ] **REQ-appointment-booking**: Calendar-based scheduling per doctor with configurable slots, working hours, breaks, leave/holiday blocking; booking channels (in-app, patient self-booking link, future API); walk-in token/queue alongside scheduled appointments; states Booked → Confirmed → Checked-in → In-consultation → Completed / No-show / Cancelled / Rescheduled; recurring appointments; double-booking prevention with configurable overbooking; waitlist with auto-notify on cancellation; reminders tied to lifecycle. *(PRD §4.2)*

### Patient Records

- [ ] **REQ-patient-records**: Unified patient profile (demographics, allergies, chronic conditions, family history); deduplication on creation (name + phone + DOB fuzzy match); search by name, phone, patient ID, (future) ABHA; chronological filterable visit-history timeline; tagged file attachments; consent capture for data sharing/communication (DPDP). *(PRD §4.3)*
- [x] **REQ-specialty-templates**: Generic core visit record (chief complaint, HPI, exam notes, vitals, diagnosis, treatment plan, prescription, follow-up) plus a configuration-driven specialty template layer (field definitions as data, not hardcoded) for General Physician, Dental, Gynaecology/Obstetrics, Pediatrics, Dermatology, Orthopedics; new specialties addable without a full release; a clinic can select multiple specialties. *(PRD §4.4, completed in Phase 3)*

### Consultation & Prescribing

- [x] **REQ-diagnosis-visit-management**: ICD-10 diagnosis coding (ICD-11 readiness), searchable/auto-suggested from chief complaint; visit types (OPD, follow-up, procedure; teleconsultation future); visit workflow states Waiting → With Nurse (vitals) → With Doctor → Billing → Completed; AI-drafted structured clinical note for doctor review and one-tap approval — never auto-finalized. *(PRD §4.6, completed in Phase 3)*
- [x] **REQ-e-prescriptions**: Prescription builder with India-specific drug search (brand + generic + salt); per-doctor favorite/frequent templates; drug interaction and allergy warnings against patient's allergy list; digital signature / clinic letterhead; shareable PDF sent via WhatsApp/SMS on visit completion; searchable, re-printable history, editable only with audit trail. *(PRD §4.5, completed in Phase 3)*
- [ ] **REQ-billing-invoicing** ⚠️ **PROVISIONAL**: Per-visit billing (consultation fee, procedure charges, itemized); payment recording for cash/UPI/card (recording only, no gateway); PDF receipts shareable via WhatsApp; daily/monthly collection reports for owner. **Source status: unconfirmed assumption — PRD §4.10/§9 open question 1; deferred to Phase 3A per D-27.** *(PRD §4.10)*

### Diagnostics & Referrals

- [ ] **REQ-lab-records**: Lab order creation from within a visit (configurable local test catalog); in-house result-entry workflow or external partner-lab routing; structured numeric/coded results plus free-text/file upload; abnormal flagging against configurable reference ranges; patient-facing result visibility via secure link. *(PRD §4.7)*
- [ ] **REQ-referrals**: In-network referral to another doctor/clinic on the platform with consented shareable history summary; out-of-network PDF referral letter with clinical summary; statuses Sent / Acknowledged / Completed with closing-the-loop notes. *(PRD §4.9)*

### Communications

- [ ] **REQ-reminders-notifications**: Appointment reminders (configurable, e.g. 24h/2h); prescription/lab-result delivery notifications; follow-up due, vaccination due (pediatric), medication refill reminders; two-way WhatsApp allowing patient confirm/cancel/reschedule via reply (basic bot logic, not the Voice Agent); all patient communication logged against the patient record for audit/consent. *(PRD §4.8)*

### AI Assist

- [ ] **REQ-ai-features**: Visit summarization from doctor's shorthand/dictation; smart scheduling assist from historical no-show/duration patterns; patient history "catch-up" summary for returning patients; prescription suggestion sourced only from the doctor's own prescribing history (never generic/external advice, explicit doctor approval); all AI outputs labeled AI-generated/AI-suggested in the UI until clinician acceptance. *(PRD §4.11)*

### Platform & Compliance

- [ ] **REQ-api-access**: API-first REST API covering patients, appointments, visits, prescriptions, lab orders, referrals; tenant-scoped API keys / OAuth2 with role-scoped permissions matching in-app roles; webhooks for key events (appointment booked/cancelled, visit completed, lab result ready); per-tenant/per-key rate limiting and usage logging. *(PRD §4.12)*
- [ ] **REQ-compliance-data-layer**: ABDM/ABHA/FHIR data-layer readiness with no future migration — optional nullable ABHA number/address on patient from day one; ICD-coded diagnosis fields; structured drug-database references; clinical documents in structured internal format transformable to HL7 FHIR R4 without re-authoring; consent events as first-class immutable records; facility/practitioner records ready for future HFR/HPR IDs. Live integration out of scope. *(PRD §4.13)*

### Non-Functional

- [ ] **REQ-nfr-multi-tenancy-scalability**: Strict database-level tenant isolation (RLS, not just app checks); scales from pilot clinics to thousands of tenants without redesign; Vercel + Supabase start with clear migration path to dedicated cloud (India regions); stateless application layer. *(PRD §5.1)*
- [ ] **REQ-nfr-performance**: Core actions (open patient record, create appointment, save prescription) under 1–2 seconds on typical Indian 3G/4G; offline-tolerant UX evaluated for spotty-connectivity clinics (queue view, draft prescriptions cached/synced). *(PRD §5.2)*
- [ ] **REQ-nfr-security**: Encryption at rest and in transit; RBAC enforced at API and UI layers; audit logging of all patient-record access/modification (who/what/when); OTP-based staff auth, no shared logins; regular automated backups with tested restore. *(PRD §5.3)*
- [ ] **REQ-nfr-regulatory-compliance**: DPDP Act 2023 — explicit consent capture, right to access/delete, purpose limitation, breach notification readiness; store clinic registration/license details (no state-specific enforcement); teleconsultation and live ABDM deferred. *(PRD §5.4)*
- [ ] **REQ-nfr-reliability**: Target uptime 99.5%+; if SMS/WhatsApp provider is down, in-app data entry and clinical workflows continue unaffected. *(PRD §5.5)*

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Future

- **REQ-future-api-booking**: API-driven booking channels from AI Voice Agent / third-party channels (REQ-appointment-booking acceptance defers this).
- **FUTURE-doctor-multi-tenant**: Doctor belonging to multiple clinic tenants (visiting consultant) — data model anticipates it; not built at launch.
- **FUTURE-teleconsultation**: Teleconsultation visit type under Telemedicine Practice Guidelines (PRD §5.4).
- **FUTURE-abdm-live**: Live ABDM/ABHA/UHI integration (data-layer readiness ships now per REQ-compliance-data-layer).
- **FUTURE-offline**: Full offline mode beyond evaluated offline-tolerant UX (PRD §5.2 scope).

## Out of Scope

| Feature | Reason |
|---------|--------|
| AI Voice Agent / receptionist | Separate product vertical with its own PRD; consumes ClinicQ API (PRD §1.4) |
| In-patient / hospital ward management | Outpatient clinic product (PRD §1.4) |
| Insurance/TPA claims + NHCX | Future integration point (PRD §1.4) |
| Live ABDM/ABHA/UHI integration | Design-now-integrate-later; separate future initiative (PRD §4.13) |
| Native mobile applications | Responsive web first (PRD §6) |
| Multi-language / regional UI | English-only assumed (PRD §10) |
| Payment gateway (per-visit billing) | Recording only initially (PRD §4.10) |
| Feature gating / tiered pricing | Single plan by design — differentiation is quality (PRD §1.3) |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REQ-multi-tenancy | Phase 1 | Pending |
| REQ-compliance-data-layer | Phase 1 | Pending |
| REQ-nfr-multi-tenancy-scalability | Phase 1 | Pending |
| REQ-nfr-security | Phase 1 | Pending |
| REQ-patient-records | Phase 2 | Pending |
| REQ-appointment-booking | Phase 2 | Pending |
| REQ-specialty-templates | Phase 3 | Complete |
| REQ-diagnosis-visit-management | Phase 3 | Complete |
| REQ-e-prescriptions | Phase 3 | Complete |
| REQ-billing-invoicing (provisional) | Phase 3 | Deferred to Phase 3A |
| REQ-lab-records | Phase 4 | Pending |
| REQ-referrals | Phase 4 | Pending |
| REQ-reminders-notifications | Phase 5 | Pending |
| REQ-ai-features | Phase 5 | Pending |
| REQ-api-access | Phase 6 | Pending |
| REQ-nfr-performance | Phase 6 | Pending |
| REQ-nfr-reliability | Phase 6 | Pending |
| REQ-nfr-regulatory-compliance | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0 ✓

**Notes:**
- `REQ-billing-invoicing` is **provisional** (source-flagged open question, PRD §9.1) — mapped to Phase 3 but may be descoped on owner confirmation.
- Messaging-dependent acceptances (appointment reminders, waitlist auto-notify, lab-result/PDF delivery) are delivered by Phase 5 (`REQ-reminders-notifications`); Phases 2–4 provide the in-app behavior first.

---
*Requirements defined: 2026-10-06*
*Last updated: 2026-10-06 after initial doc ingest (gsd-roadmapper)*
