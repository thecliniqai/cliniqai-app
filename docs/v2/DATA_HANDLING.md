# clinicOS v2.0 — Data Handling & Healthcare Data Protection

| | |
|---|---|
| Date | 2026-11-10 |
| Basis | Static review of schema (`supabase/migrations/*`), application code and docs (`docs/compliance-data-layer.md`, `docs/operations/backups.md`, `docs/ops/backup-restore.md`) |
| Status | Engineering assessment. **Not a legal opinion; no compliance is claimed.** Items marked ⚖ need validation by Indian counsel. |

---

## 1. Roles under DPDP Act 2023 (⚖ to confirm in contracts)

| Data set | Data Principal | Data Fiduciary | Processor(s) |
|---|---|---|---|
| Patient demographics, clinical, billing, communications | Patient (or guardian for children) | **Clinic** (tenant) | **clinicOS** → sub-processors: Supabase (DB/Auth/Storage), Vercel (compute/logs), MSG91 (messaging), Google/OpenAI (AI), Cloudflare R2/AWS (optional storage) |
| Staff accounts (email, name, phone, medical council reg. no., signature) | Staff member | Clinic for employment purposes; **clinicOS** for platform account and security | Supabase, Vercel |
| Clinic business profile (GSTIN, registrations) | n/a (mostly not personal) or the owner | clinicOS | Supabase |

**Implications:**
- clinicOS must process patient data only on the clinic's documented instructions, apply "reasonable security safeguards", flow equivalent obligations down to sub-processors, assist the clinic with Data Principal rights and breach notification, and delete or return data at contract end. This is a contractual obligation under s.8(2) on the fiduciary. ⚖
- **Fact:** the repo has no DPA, sub-processor list, privacy notice template, or ToS. **Recommendation (P1):** prepare a clinic-facing DPA plus a sub-processor list, and a patient-notice template the clinic can display or send (English + Marathi/Hindi). ⚖
- Treatment-related processing is likely covered by the "legitimate uses" in s.7 (medical treatment / emergencies), and consent is still needed for non-essential purposes (e.g. WhatsApp reminders, AI-assisted processing, sharing with another clinic). ⚖

---

## 2. Personal-data inventory

Legend: **H** = health / sensitive · **P** = direct identifier · **C** = contact · **F** = financial.

| Table / location | Fields (personal) | Class | Who can access today (DB-level) | Notes |
|---|---|---|---|---|
| `patients` | full_name, phone, date_of_birth, age, sex, address (JSON), abha_id, national_health_id, allergies[], chronic_conditions[], emergency_contact (JSON), guardian_name/phone/relationship, preferred_language, whatsapp_opt_out, erasure fields | P, C, H | All tenant members (SELECT/INSERT/UPDATE) (`000003:64-85`; SEC-06) | ABHA collected without ABDM integration (minimise). |
| `visits` | vitals (JSON), chief_complaints (JSON), clinical_notes, specialty_data (JSON, dental odontogram, pediatrics growth), investigations_advised, advice, reason_for_visit, metadata | H | All members | Signed state is not DB-immutable (SEC-06). |
| `visit_revisions` | Historical snapshots of the above | H | All members (append-only) | Good amendment trail. |
| `consultation_diagnoses` | diagnosis_name, ICD/SNOMED codes, notes | H | All members | |
| `prescriptions`, `prescription_items` | Medicines, dosage, duration, amendment_reason, pdf_storage_path | H | All members (UPDATE allowed) | |
| `follow_ups` | follow_up_date | H | All members | |
| `patient_documents` + bucket `clinic-records` | Lab reports and imaging (PDF/images); original_filename; object key contains the **patient name** | H, P | All members; storage by tenant prefix | SEC-23 |
| bucket `prescriptions` | Prescription and receipt PDFs (name, age, sex, phone, address, ABHA, diagnoses, meds) | H, P | All members; storage by tenant prefix | SEC-18 |
| `referrals` | clinical_summary, provisional_diagnosis, active_medications_snapshot, consented_history_snapshot, referred_to_* contact | H, P | Originating tenant (all), **target tenant (read + update all columns)** | SEC-33; cross-fiduciary sharing |
| `consent_records` | consent_type, status, note, recorded_by | P | All members | Append-only (good) |
| `invoices`, `invoice_items`, `payments` | Amounts, payment method/reference, patient link | F, P | All members | GST retention |
| `communication_queue` | recipient_phone, template_params (names, doctor, time, document links incl. share tokens), error messages, metadata | C, P, (H by inference) | All members (`FOR ALL`) | Kept indefinitely; not erased |
| `in_app_notifications` | Messages containing patient names, phone (WhatsApp failure), inbound patient free text | P, C | All members | |
| `document_share_tokens` | Bearer tokens (plaintext), resource refs | Credential | All members | SEC-22 |
| `audit_logs` | actor_id, role, action, entity ids, filtered metadata; webhook writes recipient_phone | P | Owner/admin read; all members insert | SEC-29 |
| `memberships` | Staff full_name, phone, qualifications, medical_council_reg_no, signature_url, availability | P | All tenant members | |
| `auth.users` (Supabase) | Staff email, phone, metadata, login history | P | Supabase / service role | |
| `waitlist_entries`, `queue_tokens` | patient links, notes | P | All members | |
| `webhook_delivery_queue` | Payload text: **IDs only** (appointment_id, patient_id, visit_id, timestamps) | Pseudonymous | Owner/admin | Good minimisation (`features/appointments/actions.ts:131-139`, `features/consultation/actions.ts:695-724`) |
| Vercel function logs | `console.error` of DB errors; **dev messaging provider logs phone + template params** when misconfigured | C, P | Vercel project members, log drains | SEC-15 |
| Local developer machine | `.planning/dev-messages.txt` (225 recipient entries), `.planning/dev-auth-logs.txt` (emails, OTP lines). Git-ignored, never committed | C, credentials | Developer | Purge after confirming whether real data is present (Assumption, validate) |
| AI providers | Copilot prompts and tool results (patient names, phones, ages, last visit), SOAP shorthand (free text), clinical context (age, sex, vitals, conditions) | P, C, H | Provider (retention per its terms) | SEC-16 |
| MSG91 | Recipient phone, template parameters (patient name, doctor, clinic, time, document URLs with bearer tokens) | P, C, (H by inference: "your lab report") | MSG91, Meta (WhatsApp) | DLT/WhatsApp templates |

**Data minimisation observations:**
- **Problem:** ABHA ID and `national_health_id` are stored without an ABDM integration. Collect them only when a use case exists. If they are kept, they are high-value identifiers that should be masked in UI and exports.
- **Problem:** The patient name is used in storage keys and download filenames (SEC-23). Use random keys.
- **Good:** Outbound webhooks carry IDs only. Audit metadata is allow-listed. The AI clinical context is minimised (age/sex/vitals/conditions).
- **Problem:** Share links in WhatsApp messages are long-lived bearer tokens (7 days) to clinical documents. Consider a short TTL plus a DOB challenge for clinical documents (SEC-22).

---

## 3. Access control & access logging

- **Fact:** Tenant isolation is enforced by RLS for direct table access and tested (`tests/security/cross-tenant.spec.ts`). It is **broken at the application layer** by SEC-01 (service-role via `sessionOverride`), SEC-04 (webhook) and SEC-05 (token resolvers).
- **Fact:** Role-based restrictions exist only in the app (`lib/permissions/matrix.ts`). The DB grants all tenant members full clinical read and write (SEC-06), and members can make themselves owner (SEC-03).
- **Fact:** Access logging covers writes broadly but reads only for the patient detail page (`features/patients/actions.ts:192-199`) and DPDP exports (SEC-29).
- **Recommendation:** Treat "who viewed which patient's record" as a first-class audit stream. Clinics will need it to answer patient complaints and breach investigations. Give owners a per-patient "access history" view.

---

## 4. Third-party processors & cross-border flows

> Update (2026-11-10, PO decisions): The AI processor is now **Google Vertex AI, regional `asia-south1` endpoint only, pseudonymised scribe text only** (AI_STRATEGY §3). AI Studio keys, OpenAI and global endpoints are not used. Google may keep pseudonymised prompts for up to 90 days for abuse monitoring unless zero data retention is granted (AIR-9, PO-22). New processors: **Amazon SES** (`ap-south-1`, auth and app email) and **Razorpay** (SaaS subscription payments; clinicOS stores only provider IDs, card network and last 4). The Cloudflare R2/AWS storage option is removed (C23). The rows below predate this update.

> Update (2026-11-10, PO round 3; roadmap C45–C48, PO-26, V2-16; VERIFICATION_LOG addendum 4):
> - **Vercel** is handled by the PO personally (PO-24 closed). It stays a processor (request data and runtime logs; functions in `bom1` desirable); no plan or terms item applies here.
> - **Supabase Free is used only during the real-world UAT stage** (roadmap V2-16), when tester clinics may enter real patient data; the FT-02 backups and other compensating controls apply throughout UAT. Production moves to **Pro + PITR before paid launch** (default at UAT exit, PO-26).
> - **Turnstile** in Managed mode on every endpoint Supabase's CAPTCHA switch covers is the accepted default (C43); a signup-only design was rejected.
> - **AI preview consent (decided, C48):** a one-time clinic-owner opt-in is required before any pseudonymised scribe text reaches Vertex, including UAT testers' preview use (SUB-D10); the quota itself is silent (no meter or upsell).
> - **Coupons and refunds (SUB §14):** coupon codes, redemptions and refund records are platform billing data about clinics (owner email for assigned codes, Razorpay payment and refund IDs), with no patient data; they are kept with the platform's statutory billing records (SaaS GST invoices and credit notes 72 months, SUB §6.6), which survive a clinic purge.

> Update (2026-11-10, PO round 2; roadmap PO-17, PO-21, PO-23 ✅, §9.1):
> - **New processor: AWS S3 + a scheduled task in `ap-south-1`** holding the encrypted production backups (roadmap FT-02), because Supabase Free has no backups. Data stays in India; dumps are encrypted with age before upload, and the bucket is versioned with a 30-day lifecycle.
> - **Supabase** runs on the Free plan in `ap-south-1` during the UAT stage only (round 3; no PITR); production and staging are separate organisations.
> - **Vercel:** production front end handled by the PO (round 3, PO-24 closed), functions in `bom1`; runtime logs are short-lived, so security events are kept in app tables (FT-07).
> - **Leaked-password check:** while Supabase is on Free, the app server sends a 5-character k-anonymity SHA-1 prefix to the HIBP Pwned Passwords API (outside India; no personal or health data). Accepted in PO-23(h).
> - **Cloudflare Turnstile** (outside India; CAPTCHA token, IP and browser signals) covers signup, sign-in, OTP, recovery and resend (Supabase's single CAPTCHA switch, C43). Managed mode; Invisible mode would require referencing the Turnstile Privacy Addendum.
> - **Google Vertex AI:** no AI is sold in v2.0, but the scribe runs as a **trial Preview** (PO-21), so pseudonymised scribe text still reaches Vertex `asia-south1` for trial clinics whose owner opted in. Owner opt-in (with AI terms that say the feature is a preview; decided in round 3, C48), the patient notice and objection flag, and the AIR-9 disclosure all still apply.
> - All PO-23(h) items were **accepted by the PO on 2026-11-10**.

| Processor | Data | Purpose | Location | Contract status | Actions |
|---|---|---|---|---|---|
| Supabase (AWS) | Everything | DB, Auth, Storage | **Unknown, OI-1.** Recommend `ap-south-1` (Mumbai) | Not in repo | Confirm region; Supabase DPA; PITR after the Pro upgrade (PO-17); document encryption (AES-256 at rest by AWS; TLS in transit) |
| Vercel | Request data, logs (may contain PII) | Hosting | Function region configurable (recommend `bom1`); logs are global | Not in repo | Set function region; log drain to India-region storage for CERT-In; Vercel DPA |
| MSG91 (Walkover, India) | Phones, names, appointment details, document links | WhatsApp/SMS | India (Assumption, validate); WhatsApp messages transit Meta | Not in repo | DPA; DLT registrations; opt-in evidence; message-content minimisation (avoid diagnosis or test names in templates) |
| Google (Gemini API) or OpenAI | Prompts with patient identifiers (SEC-16) and clinical free text | AI assist | Outside India | Not in repo. **AI Studio keys on free tier may allow provider use of data** ⚖ | Paid/enterprise endpoint with no-training and limited retention (Vertex AI in `asia-south1`, or Azure OpenAI India region); DPA; tenant opt-in; patient notice |
| Cloudflare R2 / AWS S3 (optional) | Documents | Storage | Configurable | — | Choose an India/APAC jurisdiction; SSE; bucket versioning for signed artefacts |
| Customer webhook endpoints | IDs only | Integrations | Customer-controlled | Clinic's own responsibility | Document that the clinic is the fiduciary for onward transfer |

DPDP s.16 currently permits cross-border transfer except to notified restricted countries. The DPDP Rules 2025 may attach conditions. ⚖ Even where transfer is lawful, health data to LLM vendors needs a clear purpose, a notice and (likely) consent, because it is not essential to treatment. ⚖

---

## 5. Retention, deletion and erasure

> Update (2026-11-10, PO decisions): The PO declined counsel (PO-12) because data is stored in India only. This schedule is therefore Claude-drafted and PO-approved; DPDP obligations and sub-processor locations still apply. Two additions:
> - **Tenant data lifecycle (SUBSCRIPTIONS_AND_PLANS §6).** When a clinic's subscription ends, access is locked immediately (enforced in RLS and storage). Data is kept intact for **30 days** (`expired`), then **logically archived** (locked, not moved) with a full export offered to the clinic in-app only. At **expiry + 180 days** the clinic's data and files are **purged** after a dry run and admin approval, with a deletion certificate. The platform's own statutory records survive: SaaS GST invoices 72 months; audit and security logs ≥ 1 year (≥ 180 days in India for CERT-In). A re-purchase before the purge restores access instantly.
> - **AI metadata.** `ai_calls` (no prompt or output text) is kept 90 days; `ai_usage_monthly` ≤ 13 months while the clinic is live. Both are deleted at archive, and never later than the purge.

**Current state (Fact):**
- Erasure (`features/dpdp/erasure.ts`) sets `is_deleted=true, status='erased'` and keeps every field. It is available only through the API key route (`app/api/v1/patients/[id]/route.ts:207`), with no staff UI.
- Patient hard delete is blocked (no DELETE policy, good), and visits and prescriptions are retained.
- `communication_queue`, notifications, storage objects, AI interactions and backups are not touched by erasure.
- There are no scheduled purge jobs and no per-tenant retention configuration. The code hard-codes "NMC 1.3.1, 3-year".

**Reconciling DPDP erasure with medical-record retention (⚖):**
- DPDP s.8(7) requires erasure when the purpose is served, **unless retention is necessary for compliance with any law**. Medical-record retention under IMC 2002 reg. 1.3.1 (3 years for in-patient records; commonly applied to OPD too), the Clinical Establishments rules and state laws, and medico-legal limitation periods justify keeping **the clinical record**. They do not justify keeping marketing preferences, message logs or AI logs.
- GST/Income-tax law requires billing records for ~6-8 years. ⚖

**Recommended retention schedule (defaults; legal to confirm per state; configurable per tenant):**

| Category | Default retention | After retention | Erasure request before expiry |
|---|---|---|---|
| Clinical record (visits, diagnoses, prescriptions, documents, referrals) | max(3 years from last visit, state requirement); many clinics choose 7-10 years ⚖ | Anonymise, or hard-delete plus delete storage objects | **Restrict** (block processing and hide from normal UI; keep for legal hold); record the reason |
| Billing (invoices, payments) | 8 years ⚖ | Delete patient linkage | Restrict |
| Contact and communication data (communication_queue, notifications, WhatsApp opt-in) | 12 months | Delete | **Delete** (except proof of opt-in/out, which is kept minimally) |
| Share tokens | Expiry + 30 days | Delete | Revoke immediately |
| AI prompts / outputs (if stored) | Do not store; or 30 days | Delete | Delete |
| Audit / access logs | ≥ 1 year (DPDP Rules indicate one-year log retention ⚖); security logs ≥ 180 days in India (CERT-In) | Archive or delete | Keep (legal basis: security) |
| Staff accounts | Contract + 1 year | Delete or anonymise; keep `actor_id` references | — |
| Backups (free tier: self-run encrypted logical dumps in S3 `ap-south-1`; after the Pro upgrade also PITR 7 days) | 30 days rolling (dumps); 7 days (PITR, after upgrade) | Expire automatically (bucket lifecycle: expire current versions at 30 days and noncurrent versions 1 day after they become noncurrent, and remove expired delete markers; the FT-02 acceptance check verifies this rule) | Erasure is applied when backups age out (within 30 days); document this in the notice |
| Tenant offboarding | 30-90 days after termination for return or export | Delete the tenant (cascade) plus storage prefix plus any logical dumps | — |

**Recommendations (P1):** a `retention_policies` table per tenant, a nightly purge/anonymisation job with an audit trail, an erasure workflow in the staff UI with "restrict vs erase" decisions, and storage deletion included in erasure. Erased patients must be excluded by RLS for non-owner roles.

---

## 6. Consent and communication preferences

- **Fact:** `consent_records` is append-only with purposes `global`, `treatment` and `data_sharing` (`features/patients/consent.ts:156-190`). Patients have `whatsapp_opt_out` and `preferred_language`. Governance checks opt-out, quiet hours and quota (`lib/messaging/governance.ts:139-163`).
- **Problem:** A single "global" toggle bundles treatment, communications and data sharing. DPDP requires consent to be specific, informed and itemised, and treatment may not need consent at all (legitimate use). ⚖
- **Problem:** WhatsApp opt-in is not recorded positively (only opt-out), although WhatsApp Business policy requires opt-in. There is no record of which notice version the patient saw.
- **Problem:** Consent can be forged cross-tenant (SEC-01) and by any member (SEC-06). `recorded_by` comes from the caller.
- **Problem:** Children: guardian fields exist, but there is no verifiable guardian-consent capture (s.9). ⚖
- **Recommendation:** Purposes: `treatment` (legitimate use, notice only), `appointment_communications` (WhatsApp/SMS), `document_sharing_via_link`, `referral_history_sharing`, `ai_assistance`. Each record should hold notice version, language, channel and evidence (signature/OTP/staff attestation). Allow withdrawal as easily as grant. Enforce communication purposes in `governance.ts`.

---

## 7. Integrity of medical records & e-prescriptions

- Signed consultations have revisions (`visit_revisions`), which is good. The DB does not enforce immutability, PDFs are overwritten (`upsert: true`), and signer identity can be spoofed through `sessionOverride` (SEC-02, SEC-06, SEC-18).
- **Recommendation:** an immutable signed artefact (hash stored, write-once object, signer = `auth.uid()` set by the DB), amendments only as new versions with a reason, and display of the doctor's registration number (IMC 1.4.2). Consider digital signatures (Aadhaar eSign / DSC) for e-prescriptions as a voluntary step. ⚖

---

## 8. Breach readiness

- No incident-response runbook, no breach-notification templates, no security contact, and no log retention pipeline exist.
- **Required capabilities:** (a) detection: alerts on service-role anomalies, spikes in webhook or share-link traffic, and mass exports; (b) **6-hour CERT-In reporting** (clinicOS) ⚖; (c) prompt notice to affected clinics (contractual), which the clinics then use for their DPDP notice to the Board and to patients ⚖; (d) per-tenant impact queries from audit logs; (e) secret-rotation playbooks (service role, MSG91, AI, CRON, webhook secrets).
- **Immediate:** given SEC-01/03/04/05, if v1 has real patient data, carry out the forensic review listed in `SECURITY_ASSESSMENT.md` §6.2 before deciding whether a reportable incident occurred. ⚖

---

## 9. Encryption

| Layer | State | Recommendation |
|---|---|---|
| In transit (browser ↔ Vercel ↔ Supabase / MSG91 / AI) | TLS by platforms. **HSTS not set** (SEC-13) | Add HSTS; enforce HTTPS webhooks (already enforced) |
| At rest (DB, storage, backups) | Supabase/AWS volume encryption (AES-256) — platform default. **Assumption (validate)**. `docs/operations/backups.md:32` claims "customer-isolated KMS keys", which Supabase does not provide by default; correct this unsupported claim | Document actual controls; consider column-level encryption (pgsodium/Vault) only for ABHA/Aadhaar-like identifiers if collected |
| Secrets | Env vars in Vercel; `.env` locally (never committed) | Secret manager; rotation schedule; remove service-role key from developer machines (SEC-25) |
| Share tokens / API keys / invites | API keys and invites hashed (good); share tokens plaintext | Hash share tokens (SEC-22) |
| Webhook signing secrets | Plaintext (needed for HMAC) | Acceptable; restrict reads to owner; consider Vault |

---

## 10. Backups & DR (data protection view)

> Update (2026-11-10, PO round 2; roadmap §9.1, FT-02; scoped by round 3): production starts the **UAT stage on Supabase Free, which has no automatic backups and no PITR**, and moves to Pro + PITR before paid launch. Backups are therefore self-run: encrypted (age) logical dumps of the database and a sync of Storage objects, twice a day, produced **inside India** by a scheduled task in AWS `ap-south-1` (never on a laptop or a GitHub-hosted runner), kept in a versioned, SSE-KMS bucket in `ap-south-1` for 30 days (bucket lifecycle: expire current versions at 30 days and noncurrent versions 1 day after they become noncurrent, and remove expired delete markers; the FT-02 acceptance check verifies this rule), with access limited to the PO (MFA) and logged. A monthly restore drill into a local stack proves them. RPO ≤ 12 h until the upgrade to Supabase Pro + PITR (triggers in roadmap §9.1). Erasure reaches backups within the 30-day rolling window; the privacy notice says so.

- The docs describe Supabase PITR (7 days), daily logical dumps and cross-region object replication (`docs/ops/backup-restore.md:17-55, 134-160`). **None of this can be verified from the repo (OI-1).** The "drill log" should be treated as aspirational until a restore drill is evidenced.
- **Data-protection requirements:** backups must be in an approved jurisdiction, encrypted, access-logged and time-bounded so that erasure takes effect; logical dumps must not land on laptops; tenant-offboarding exports must be delivered securely (expiring link, encrypted archive).

---

## 11. Export & portability

- **Fact:** A JSON/PDF patient dossier export exists (`features/dpdp/export.ts`, `app/api/v1/patients/[id]/export/route.ts`) and is audited (`dpdp.data_export`). It is available to any role with `patients:view` (including receptionist and nurse), which is broader than necessary.
- **Recommendation:** restrict to owner/doctor (or a dedicated `exports:create`, which already exists in the matrix but is unused); require a reason; add watermarking; offer FHIR R4 bundle export (mapping already drafted in `docs/compliance-data-layer.md`). Tenant-level export for clinic offboarding is needed (portability between EMR vendors).

---

## 12. Development & test data hygiene

- **Problem:** Tests and seed scripts write to a hosted Supabase project (SEC-25). If that is production, real patient data and test data are mixed, and test runs act on production.
- **Rule for v2:** no real patient data in development, prompts, test fixtures, screenshots or AI tooling (including coding assistants). Use synthetic generators (e.g. faker with Indian locales) and a local Supabase. Add a CI grep for 10-digit Indian mobile patterns in fixtures that are not in the reserved test ranges.
- **Action:** confirm the nature of the local `.planning/dev-*.txt` files and purge them (SEC-15).
