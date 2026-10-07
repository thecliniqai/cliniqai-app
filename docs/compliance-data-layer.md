# Compliance Data Layer: ClinicQ Architecture & FHIR R4 Mapping

## 1. Overview & Scope
ClinicQ implements a compliance-ready data foundation designed for the Indian healthcare ecosystem (ABDM / ABDM-M1/M2/M3 readiness, Digital Personal Data Protection Act 2023).

> **Important (AGENTS.md §9):** This document defines data modeling conventions, schema future-proofing, and target FHIR R4 resource mappings. It explicitly **does NOT** represent a claim of active government certification or live ABDM gateway interoperability in Phase 1. Real ABDM milestone integration (M1/M2/M3) is an external gateway phase.

---

## 2. Core Principles
1. **Optional Identifiers Day One**: National health identifiers such as the **ABHA number/address** are strictly optional and nullable (`NULL` = unlinked). A patient can always be treated with basic demographic records (name and phone).
2. **Immutable Append-Only Consent**: Consent records are never updated in-place (`UPDATE` is forbidden by RLS). Any grant or withdrawal appends a new discrete timestamped record. Current consent state is derived deterministically from the latest entry.
3. **Auditability on Access & Mutation**: Every patient creation, edit, view access, and consent transition writes to an append-only `audit_logs` table recording actor ID, role, action, and safe metadata (field names only, never clinical notes or PII).
4. **Structured Clinical Columns**: Discrete columns are reserved for clinical diagnoses (ICD-10 codes, descriptions) and prescription components (drug name, code, dosage, frequency, duration) so that migrations are backward and forward compatible. Free-text fields are stored as unverified clinical notes and never masqueraded as structured data.

---

## 3. Data Dictionary & FHIR R4 Intended Mappings

### 3.1 Patient Demographics (`patients`)
| ClinicQ Column | SQL Type | Nullable | FHIR R4 Resource / Path | Notes |
|----------------|----------|----------|-------------------------|-------|
| `id` | UUID | No | `Patient.id` | Internal tenant-scoped identifier |
| `full_name` | TEXT | No | `Patient.name.text` | Full human name |
| `phone` | TEXT | No | `Patient.telecom[system='phone'].value` | E.164 formatted contact |
| `date_of_birth`| DATE | Yes | `Patient.birthDate` | ISO 8601 date |
| `sex` | TEXT | Yes | `Patient.gender` | `male` \| `female` \| `other` |
| `address` | JSONB | Yes | `Patient.address` | Structured line, city, state, postalCode |
| `abha_id` | TEXT | Yes | `Patient.identifier[system='https://healthid.ndhm.gov.in']` | Optional ABHA address or 14-digit number |
| `hfr_facility_id`| TEXT | Yes | `Patient.managingOrganization.identifier` | Facility Registry ID |

### 3.2 Clinical Consultations (`consultations`)
| ClinicQ Column | SQL Type | Nullable | FHIR R4 Resource / Path | Notes |
|----------------|----------|----------|-------------------------|-------|
| `id` | UUID | No | `Encounter.id`, `Condition.id` | Consultation record |
| `chief_complaint`| TEXT | Yes | `Condition.code.text` | Chief symptom described |
| `icd10_code` | TEXT | Yes | `Condition.code.coding[system='http://hl7.org/fhir/sid/icd-10'].code` | International Classification of Diseases |
| `icd10_display`| TEXT | Yes | `Condition.code.coding.display` | Standardized condition name |
| `clinical_notes`| TEXT | Yes | `Encounter.note.text` | Free-text unstructured notes |

### 3.3 E-Prescriptions (`prescriptions`)
| ClinicQ Column | SQL Type | Nullable | FHIR R4 Resource / Path | Notes |
|----------------|----------|----------|-------------------------|-------|
| `id` | UUID | No | `MedicationRequest.id` | Order identifier |
| `drug_name` | TEXT | No | `MedicationRequest.medicationCodeableConcept.text` | Brand / generic drug name |
| `drug_code` | TEXT | Yes | `MedicationRequest.medicationCodeableConcept.coding.code` | SNOMED CT or Indian Pharmacopoeia code |
| `dosage` | TEXT | No | `MedicationRequest.dosageInstruction.doseAndRate.doseQuantity` | Strength / unit (e.g. 500mg) |
| `frequency` | TEXT | No | `MedicationRequest.dosageInstruction.timing` | Frequency (e.g. 1-0-1, TDS) |
| `duration` | TEXT | No | `MedicationRequest.dosageInstruction.timing.repeat.duration` | Duration (e.g. 5 days) |

### 3.4 Consent Records (`consent_records`)
| ClinicQ Column | SQL Type | Nullable | FHIR R4 Resource / Path | Notes |
|----------------|----------|----------|-------------------------|-------|
| `id` | UUID | No | `Consent.id` | Discrete consent grant/withdrawal |
| `consent_type` | TEXT | No | `Consent.category.coding.code` | `treatment`, `data_sharing`, `teleconsultation` |
| `status` | TEXT | No | `Consent.status` | `active` (granted) vs `inactive` (withdrawn) |
| `recorded_at` | TIMESTAMPTZ | No | `Consent.dateTime` | Immutable execution timestamp |
