export type UserRole = "owner" | "admin" | "doctor" | "receptionist" | "nurse";

export interface Tenant {
  id: string;
  name: string;
  address: string | null;
  specialties: string[];
  working_hours: Record<string, { open: string; close: string; closed?: boolean }>;
  timezone: string;
  logo_url?: string | null;
  phone?: string | null;
  email?: string | null;
  registration_number?: string | null;
  letterhead_top_margin?: number;
  letterhead_bottom_margin?: number;
  owner_is_practicing_doctor?: boolean;
  default_consultation_fee?: number;
  default_followup_fee?: number;
  accepted_payment_methods?: string[];
  created_at: string;
  updated_at: string;
}

export interface DayShiftSchedule {
  start: string;
  end: string;
}

export interface DayAvailability {
  enabled: boolean;
  shifts: DayShiftSchedule[];
}

export type DayOfWeek = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export type DoctorWeeklySchedule = Record<DayOfWeek, DayAvailability>;

export interface ScheduleBlock {
  id: string;
  tenant_id: string;
  doctor_id: string | null;
  start_time: string;
  end_time: string;
  reason: string | null;
  all_day: boolean;
  created_by: string;
  created_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  tenant_id: string;
  role: UserRole;
  full_name?: string | null;
  phone?: string | null;
  qualifications?: string | null;
  medical_council_reg_no?: string | null;
  signature_url?: string | null;
  default_specialty?: string;
  availability_schedule?: DoctorWeeklySchedule | null;
  default_slot_duration_minutes?: number;
  created_at: string;
}

export interface Invitation {
  id: string;
  tenant_id: string;
  role: UserRole;
  invited_address: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  consumed_by: string | null;
  created_by: string;
  created_at: string;
}

export interface Subscription {
  id: string;
  tenant_id: string;
  plan: string;
  amount_inr: number;
  status: "active" | "past_due" | "canceled" | "trialing";
  current_period_end: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentRecord {
  id: string;
  tenant_id: string;
  amount_inr: number;
  paid_at: string;
  method: string;
  reference: string;
  created_at: string;
}

export interface Patient {
  id: string;
  tenant_id: string;
  full_name: string;
  phone: string;
  date_of_birth: string | null;
  age?: number | null;
  sex: "male" | "female" | "other" | null;
  address: Record<string, unknown> | null;
  allergies?: string[];
  chronic_conditions?: string[];
  emergency_contact?: Record<string, unknown> | null;
  abha_id: string | null;
  hfr_facility_id?: string | null;
  national_health_id?: string | null;
  preferred_language?: "en" | "mr";
  whatsapp_opt_out?: boolean;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  guardian_relationship?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: number;
  tenant_id: string;
  actor_id: string | null;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
}

export interface ConsentRecord {
  id: string;
  tenant_id: string;
  patient_id: string;
  consent_type: string;
  status: "granted" | "withdrawn";
  recorded_by: string;
  recorded_at: string;
  note: string | null;
}

export type VisitOriginType = "scheduled" | "walk_in";
export type VisitStatus =
  | "booked"
  | "confirmed"
  | "waiting"
  | "in_consultation"
  | "completed"
  | "cancelled"
  | "no_show";

export type ClinicalSpecialty = "general_physician" | "dental" | "pediatrics";

export interface Visit {
  id: string;
  tenant_id: string;
  patient_id: string;
  doctor_id: string;
  origin_type: VisitOriginType;
  status: VisitStatus;
  scheduled_at: string | null;
  estimated_duration_minutes: number;
  reason_for_visit: string | null;
  is_overbooked: boolean;
  vitals?: Record<string, unknown> | null;
  chief_complaints?: Array<Record<string, unknown>> | null;
  clinical_notes?: string | null;
  specialty?: ClinicalSpecialty;
  specialty_data?: Record<string, unknown> | null;
  investigations_advised?: string[];
  advice?: string[];
  current_revision?: number;
  signed_at?: string | null;
  signed_by?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown> | null;
}

export interface ConsultationDiagnosis {
  id: string;
  tenant_id: string;
  visit_id: string;
  patient_id: string;
  diagnosis_name: string;
  snomed_concept_id: string | null;
  icd11_code: string | null;
  is_custom: boolean;
  is_chronic: boolean;
  notes: string | null;
  created_at: string;
}

export type PrescriptionStatus = "active" | "amended" | "cancelled";
export type LetterheadMode = "blank_paper" | "preprinted_letterhead";

export interface Prescription {
  id: string;
  tenant_id: string;
  visit_id: string;
  patient_id: string;
  doctor_id: string;
  version: number;
  status: PrescriptionStatus;
  letterhead_mode: LetterheadMode;
  pdf_storage_path: string | null;
  signed_at: string | null;
  amendment_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrescriptionItem {
  id: string;
  prescription_id: string;
  medicine_name: string;
  generic_name: string | null;
  dose_form: string | null;
  dosage: string;
  timing: string | null;
  duration: string;
  special_instructions: string | null;
  cdci_brand_id: string | null;
  cdci_generic_id: string | null;
  sort_order: number;
  created_at: string;
}

export interface DoctorCustomMedicine {
  id: string;
  tenant_id: string;
  doctor_id: string;
  medicine_name: string;
  generic_name: string | null;
  dose_form: string | null;
  default_dosage: string | null;
  default_timing: string | null;
  default_duration: string | null;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface DoctorCustomDiagnosis {
  id: string;
  tenant_id: string;
  doctor_id: string;
  diagnosis_name: string;
  specialty: string | null;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface DoctorPrescriptionTemplate {
  id: string;
  tenant_id: string;
  doctor_id: string;
  template_name: string;
  specialty: string | null;
  items: Record<string, unknown>[];
  created_at: string;
  updated_at: string;
}

export interface VisitRevision {
  id: string;
  tenant_id: string;
  visit_id: string;
  revision_number: number;
  amended_by: string;
  amended_at: string;
  amendment_reason: string;
  snapshot: Record<string, unknown>;
}

export type FollowUpStatus = "scheduled" | "attended" | "cancelled" | "missed";

export interface FollowUp {
  id: string;
  tenant_id: string;
  patient_id: string;
  visit_id: string | null;
  doctor_id: string;
  follow_up_date: string;
  notes: string | null;
  status: FollowUpStatus;
  created_at: string;
}

export interface CdciMedicineSearch {
  id: string;
  brand_name: string;
  product_name: string | null;
  generic_name: string | null;
  dose_form: string | null;
  route: string | null;
  supplier_name: string | null;
}

export interface OpdDiagnosis {
  id: string;
  name: string;
  icd11_code: string | null;
  snomed_concept_id: string | null;
  category: string | null;
  specialties: string[];
  is_chronic: boolean;
  synonyms: string[];
}

export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled";
export type InvoiceItemType = "consultation" | "procedure" | "medicine" | "other";
export type PaymentMethod = "cash" | "upi" | "card";

export interface Invoice {
  id: string;
  tenant_id: string;
  visit_id: string;
  patient_id: string;
  invoice_number: string;
  subtotal: number;
  discount: number;
  tax: number;
  total_amount: number;
  status: InvoiceStatus;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: string;
  tenant_id: string;
  invoice_id: string;
  item_type: InvoiceItemType;
  description: string;
  unit_price: number;
  quantity: number;
  total_price: number;
  created_at: string;
}

export interface Payment {
  id: string;
  tenant_id: string;
  invoice_id: string;
  amount: number;
  payment_method: PaymentMethod;
  reference_number: string | null;
  notes: string | null;
  recorded_by: string;
  recorded_at: string;
}

export type QueuePriority = "normal" | "urgent" | "vip";

export interface QueueToken {
  id: string;
  tenant_id: string;
  visit_id: string;
  date: string;
  token_number: number;
  priority: QueuePriority;
  called_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export type WaitlistStatus = "waiting" | "promoted" | "expired" | "cancelled";

export interface WaitlistEntry {
  id: string;
  tenant_id: string;
  patient_id: string;
  doctor_id: string | null;
  target_date: string;
  time_window: string | null;
  status: WaitlistStatus;
  promoted_visit_id: string | null;
  priority: number;
  notes: string | null;
  created_by: string;
  created_at: string;
}

export type DocumentType = "lab_report" | "imaging" | "prescription_scan" | "other";

export interface PatientDocument {
  id: string;
  tenant_id: string;
  patient_id: string;
  visit_id: string | null;
  title: string;
  document_type: DocumentType;
  original_filename: string;
  storage_path: string;
  file_size_bytes: number;
  mime_type: string;
  report_date: string;
  notes: string | null;
  is_abnormal: boolean;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

export type DocumentShareResourceType = "patient_document" | "prescription" | "invoice" | "referral";

export interface DocumentShareToken {
  id: string;
  tenant_id: string;
  document_id: string | null;
  resource_type?: DocumentShareResourceType;
  resource_id?: string | null;
  token: string;
  expires_at: string;
  access_count: number;
  last_accessed_at: string | null;
  revoked_at: string | null;
  created_by: string;
  created_at: string;
}

export type ReferralType = "out_of_network" | "in_network";
export type ReferralUrgency = "routine" | "priority" | "urgent";
export type ReferralStatus = "sent" | "acknowledged" | "completed" | "cancelled";

export interface Referral {
  id: string;
  tenant_id: string;
  patient_id: string;
  visit_id: string | null;
  referral_type: ReferralType;
  referring_doctor_id: string;
  referred_to_name: string;
  referred_to_facility: string | null;
  referred_to_specialty: string | null;
  referred_to_contact: string | null;
  target_tenant_id: string | null;
  target_doctor_id: string | null;
  reason_for_referral: string;
  provisional_diagnosis: string | null;
  urgency: ReferralUrgency;
  clinical_summary: string | null;
  active_medications_snapshot: Record<string, unknown>[] | null;
  investigations_advised: string[];
  patient_consents_history_sharing: boolean;
  consented_history_snapshot: Record<string, unknown> | null;
  status: ReferralStatus;
  sent_at: string;
  acknowledged_at: string | null;
  completed_at: string | null;
  closure_notes: string | null;
  closed_by: string | null;
  pdf_storage_path: string | null;
  letterhead_mode: LetterheadMode;
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: Tenant;
        Insert: {
          id?: string;
          name: string;
          address?: string | null;
          specialties?: string[];
          working_hours?: Record<string, unknown>;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          address?: string | null;
          specialties?: string[];
          working_hours?: Record<string, unknown>;
          timezone?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      memberships: {
        Row: Membership;
        Insert: {
          id?: string;
          user_id: string;
          tenant_id: string;
          role: UserRole;
          full_name?: string | null;
          phone?: string | null;
          qualifications?: string | null;
          medical_council_reg_no?: string | null;
          signature_url?: string | null;
          default_specialty?: string;
          availability_schedule?: DoctorWeeklySchedule | null;
          default_slot_duration_minutes?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          tenant_id?: string;
          role?: UserRole;
          full_name?: string | null;
          phone?: string | null;
          qualifications?: string | null;
          medical_council_reg_no?: string | null;
          signature_url?: string | null;
          default_specialty?: string;
          availability_schedule?: DoctorWeeklySchedule | null;
          default_slot_duration_minutes?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      schedule_blocks: {
        Row: ScheduleBlock;
        Insert: {
          id?: string;
          tenant_id: string;
          doctor_id?: string | null;
          start_time: string;
          end_time: string;
          reason?: string | null;
          all_day?: boolean;
          created_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          doctor_id?: string | null;
          start_time?: string;
          end_time?: string;
          reason?: string | null;
          all_day?: boolean;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      invitations: {
        Row: Invitation;
        Insert: {
          id?: string;
          tenant_id: string;
          role: UserRole;
          invited_address: string;
          token_hash: string;
          expires_at: string;
          consumed_at?: string | null;
          consumed_by?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          role?: UserRole;
          invited_address?: string;
          token_hash?: string;
          expires_at?: string;
          consumed_at?: string | null;
          consumed_by?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: Subscription;
        Insert: {
          id?: string;
          tenant_id: string;
          plan?: string;
          amount_inr?: number;
          status?: "active" | "past_due" | "canceled" | "trialing";
          current_period_end?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          plan?: string;
          amount_inr?: number;
          status?: "active" | "past_due" | "canceled" | "trialing";
          current_period_end?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_records: {
        Row: PaymentRecord;
        Insert: {
          id?: string;
          tenant_id: string;
          amount_inr: number;
          paid_at?: string;
          method?: string;
          reference: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          amount_inr?: number;
          paid_at?: string;
          method?: string;
          reference?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      patients: {
        Row: Patient;
        Insert: {
          id?: string;
          tenant_id: string;
          full_name: string;
          phone: string;
          date_of_birth?: string | null;
          age?: number | null;
          sex?: "male" | "female" | "other" | null;
          address?: Record<string, unknown> | null;
          allergies?: string[];
          chronic_conditions?: string[];
          emergency_contact?: Record<string, unknown> | null;
          abha_id?: string | null;
          hfr_facility_id?: string | null;
          national_health_id?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          full_name?: string;
          phone?: string;
          date_of_birth?: string | null;
          age?: number | null;
          sex?: "male" | "female" | "other" | null;
          address?: Record<string, unknown> | null;
          allergies?: string[];
          chronic_conditions?: string[];
          emergency_contact?: Record<string, unknown> | null;
          abha_id?: string | null;
          hfr_facility_id?: string | null;
          national_health_id?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      visits: {
        Row: Visit;
        Insert: {
          id?: string;
          tenant_id: string;
          patient_id: string;
          doctor_id: string;
          origin_type: VisitOriginType;
          status?: VisitStatus;
          scheduled_at?: string | null;
          estimated_duration_minutes?: number;
          reason_for_visit?: string | null;
          is_overbooked?: boolean;
          vitals?: Record<string, unknown> | null;
          chief_complaints?: Array<Record<string, unknown>> | null;
          clinical_notes?: string | null;
          specialty?: ClinicalSpecialty;
          specialty_data?: Record<string, unknown> | null;
          investigations_advised?: string[];
          advice?: string[];
          current_revision?: number;
          signed_at?: string | null;
          signed_by?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
          metadata?: Record<string, unknown> | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          patient_id?: string;
          doctor_id?: string;
          origin_type?: VisitOriginType;
          status?: VisitStatus;
          scheduled_at?: string | null;
          estimated_duration_minutes?: number;
          reason_for_visit?: string | null;
          is_overbooked?: boolean;
          vitals?: Record<string, unknown> | null;
          chief_complaints?: Array<Record<string, unknown>> | null;
          clinical_notes?: string | null;
          specialty?: ClinicalSpecialty;
          specialty_data?: Record<string, unknown> | null;
          investigations_advised?: string[];
          advice?: string[];
          current_revision?: number;
          signed_at?: string | null;
          signed_by?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
          metadata?: Record<string, unknown> | null;
        };
        Relationships: [];
      };
      consultation_diagnoses: {
        Row: ConsultationDiagnosis;
        Insert: {
          id?: string;
          tenant_id: string;
          visit_id: string;
          patient_id: string;
          diagnosis_name: string;
          snomed_concept_id?: string | null;
          icd11_code?: string | null;
          is_custom?: boolean;
          is_chronic?: boolean;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          visit_id?: string;
          patient_id?: string;
          diagnosis_name?: string;
          snomed_concept_id?: string | null;
          icd11_code?: string | null;
          is_custom?: boolean;
          is_chronic?: boolean;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      prescriptions: {
        Row: Prescription;
        Insert: {
          id?: string;
          tenant_id: string;
          visit_id: string;
          patient_id: string;
          doctor_id: string;
          version?: number;
          status?: PrescriptionStatus;
          letterhead_mode?: LetterheadMode;
          pdf_storage_path?: string | null;
          signed_at?: string | null;
          amendment_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          visit_id?: string;
          patient_id?: string;
          doctor_id?: string;
          version?: number;
          status?: PrescriptionStatus;
          letterhead_mode?: LetterheadMode;
          pdf_storage_path?: string | null;
          signed_at?: string | null;
          amendment_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      prescription_items: {
        Row: PrescriptionItem;
        Insert: {
          id?: string;
          prescription_id: string;
          medicine_name: string;
          generic_name?: string | null;
          dose_form?: string | null;
          dosage: string;
          timing?: string | null;
          duration: string;
          special_instructions?: string | null;
          cdci_brand_id?: string | null;
          cdci_generic_id?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          prescription_id?: string;
          medicine_name?: string;
          generic_name?: string | null;
          dose_form?: string | null;
          dosage?: string;
          timing?: string | null;
          duration?: string;
          special_instructions?: string | null;
          cdci_brand_id?: string | null;
          cdci_generic_id?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      doctor_custom_medicines: {
        Row: DoctorCustomMedicine;
        Insert: {
          id?: string;
          tenant_id: string;
          doctor_id: string;
          medicine_name: string;
          generic_name?: string | null;
          dose_form?: string | null;
          default_dosage?: string | null;
          default_timing?: string | null;
          default_duration?: string | null;
          use_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          doctor_id?: string;
          medicine_name?: string;
          generic_name?: string | null;
          dose_form?: string | null;
          default_dosage?: string | null;
          default_timing?: string | null;
          default_duration?: string | null;
          use_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      doctor_custom_diagnoses: {
        Row: DoctorCustomDiagnosis;
        Insert: {
          id?: string;
          tenant_id: string;
          doctor_id: string;
          diagnosis_name: string;
          specialty?: string | null;
          use_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          doctor_id?: string;
          diagnosis_name?: string;
          specialty?: string | null;
          use_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      doctor_prescription_templates: {
        Row: DoctorPrescriptionTemplate;
        Insert: {
          id?: string;
          tenant_id: string;
          doctor_id: string;
          template_name: string;
          specialty?: string | null;
          items?: Record<string, unknown>[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          doctor_id?: string;
          template_name?: string;
          specialty?: string | null;
          items?: Record<string, unknown>[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      visit_revisions: {
        Row: VisitRevision;
        Insert: {
          id?: string;
          tenant_id: string;
          visit_id: string;
          revision_number: number;
          amended_by: string;
          amended_at?: string;
          amendment_reason: string;
          snapshot: Record<string, unknown>;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          visit_id?: string;
          revision_number?: number;
          amended_by?: string;
          amended_at?: string;
          amendment_reason?: string;
          snapshot?: Record<string, unknown>;
        };
        Relationships: [];
      };
      follow_ups: {
        Row: FollowUp;
        Insert: {
          id?: string;
          tenant_id: string;
          patient_id: string;
          visit_id?: string | null;
          doctor_id: string;
          follow_up_date: string;
          notes?: string | null;
          status?: FollowUpStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          patient_id?: string;
          visit_id?: string | null;
          doctor_id?: string;
          follow_up_date?: string;
          notes?: string | null;
          status?: FollowUpStatus;
          created_at?: string;
        };
        Relationships: [];
      };
      cdci_substances: {
        Row: { id: string; substance_name: string };
        Insert: { id: string; substance_name: string };
        Update: { id?: string; substance_name?: string };
        Relationships: [];
      };
      cdci_drug_forms: {
        Row: { id: string; form_name: string };
        Insert: { id: string; form_name: string };
        Update: { id?: string; form_name?: string };
        Relationships: [];
      };
      cdci_routes: {
        Row: { id: string; route_name: string };
        Insert: { id: string; route_name: string };
        Update: { id?: string; route_name?: string };
        Relationships: [];
      };
      cdci_suppliers: {
        Row: { id: string; supplier_name: string };
        Insert: { id: string; supplier_name: string };
        Update: { id?: string; supplier_name?: string };
        Relationships: [];
      };
      cdci_products: {
        Row: { id: string; product_name: string };
        Insert: { id: string; product_name: string };
        Update: { id?: string; product_name?: string };
        Relationships: [];
      };
      cdci_generics: {
        Row: { id: string; generic_name: string };
        Insert: { id: string; generic_name: string };
        Update: { id?: string; generic_name?: string };
        Relationships: [];
      };
      cdci_brands: {
        Row: {
          id: string;
          brand_name: string;
          generic_id?: string | null;
          product_id?: string | null;
          supplier_id?: string | null;
          form_id?: string | null;
          route_id?: string | null;
        };
        Insert: {
          id: string;
          brand_name: string;
          generic_id?: string | null;
          product_id?: string | null;
          supplier_id?: string | null;
          form_id?: string | null;
          route_id?: string | null;
        };
        Update: {
          id?: string;
          brand_name?: string;
          generic_id?: string | null;
          product_id?: string | null;
          supplier_id?: string | null;
          form_id?: string | null;
          route_id?: string | null;
        };
        Relationships: [];
      };
      cdci_medicines_search: {
        Row: CdciMedicineSearch;
        Insert: {
          id: string;
          brand_name: string;
          product_name?: string | null;
          generic_name?: string | null;
          dose_form?: string | null;
          route?: string | null;
          supplier_name?: string | null;
        };
        Update: {
          id?: string;
          brand_name?: string;
          product_name?: string | null;
          generic_name?: string | null;
          dose_form?: string | null;
          route?: string | null;
          supplier_name?: string | null;
        };
        Relationships: [];
      };
      opd_diagnoses: {
        Row: OpdDiagnosis;
        Insert: {
          id?: string;
          name: string;
          icd11_code?: string | null;
          snomed_concept_id?: string | null;
          category?: string | null;
          specialties?: string[];
          is_chronic?: boolean;
          synonyms?: string[];
        };
        Update: {
          id?: string;
          name?: string;
          icd11_code?: string | null;
          snomed_concept_id?: string | null;
          category?: string | null;
          specialties?: string[];
          is_chronic?: boolean;
          synonyms?: string[];
        };
        Relationships: [];
      };
      patient_documents: {
        Row: PatientDocument;
        Insert: {
          id?: string;
          tenant_id: string;
          patient_id: string;
          visit_id?: string | null;
          title: string;
          document_type?: DocumentType;
          original_filename: string;
          storage_path: string;
          file_size_bytes: number;
          mime_type: string;
          report_date?: string;
          notes?: string | null;
          is_abnormal?: boolean;
          uploaded_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          patient_id?: string;
          visit_id?: string | null;
          title?: string;
          document_type?: DocumentType;
          original_filename?: string;
          storage_path?: string;
          file_size_bytes?: number;
          mime_type?: string;
          report_date?: string;
          notes?: string | null;
          is_abnormal?: boolean;
          uploaded_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      document_share_tokens: {
        Row: DocumentShareToken;
        Insert: {
          id?: string;
          tenant_id: string;
          document_id: string;
          token: string;
          expires_at?: string;
          access_count?: number;
          last_accessed_at?: string | null;
          revoked_at?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          document_id?: string;
          token?: string;
          expires_at?: string;
          access_count?: number;
          last_accessed_at?: string | null;
          revoked_at?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      referrals: {
        Row: Referral;
        Insert: {
          id?: string;
          tenant_id: string;
          patient_id: string;
          visit_id?: string | null;
          referral_type: ReferralType;
          referring_doctor_id: string;
          referred_to_name: string;
          referred_to_facility?: string | null;
          referred_to_specialty?: string | null;
          referred_to_contact?: string | null;
          target_tenant_id?: string | null;
          target_doctor_id?: string | null;
          reason_for_referral: string;
          provisional_diagnosis?: string | null;
          urgency?: ReferralUrgency;
          clinical_summary?: string | null;
          active_medications_snapshot?: Record<string, unknown>[] | null;
          investigations_advised?: string[];
          patient_consents_history_sharing?: boolean;
          consented_history_snapshot?: Record<string, unknown> | null;
          status?: ReferralStatus;
          sent_at?: string;
          acknowledged_at?: string | null;
          completed_at?: string | null;
          closure_notes?: string | null;
          closed_by?: string | null;
          pdf_storage_path?: string | null;
          letterhead_mode?: LetterheadMode;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          patient_id?: string;
          visit_id?: string | null;
          referral_type?: ReferralType;
          referring_doctor_id?: string;
          referred_to_name?: string;
          referred_to_facility?: string | null;
          referred_to_specialty?: string | null;
          referred_to_contact?: string | null;
          target_tenant_id?: string | null;
          target_doctor_id?: string | null;
          reason_for_referral?: string;
          provisional_diagnosis?: string | null;
          urgency?: ReferralUrgency;
          clinical_summary?: string | null;
          active_medications_snapshot?: Record<string, unknown>[] | null;
          investigations_advised?: string[];
          patient_consents_history_sharing?: boolean;
          consented_history_snapshot?: Record<string, unknown> | null;
          status?: ReferralStatus;
          sent_at?: string;
          acknowledged_at?: string | null;
          completed_at?: string | null;
          closure_notes?: string | null;
          closed_by?: string | null;
          pdf_storage_path?: string | null;
          letterhead_mode?: LetterheadMode;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_clinic_with_owner: {
        Args: {
          p_name: string;
        };
        Returns: string;
      };
      consume_invitation: {
        Args: {
          p_token_hash: string;
        };
        Returns: string;
      };
      generate_daily_queue_token: {
        Args: {
          p_tenant_id: string;
          p_date: string;
        };
        Returns: number;
      };
      search_medicines: {
        Args: {
          p_query?: string | null;
          p_doctor_id: string;
          p_tenant_id: string;
          p_limit?: number | null;
        };
        Returns: {
          id: string;
          medicine_name: string;
          generic_name: string | null;
          dose_form: string | null;
          default_dosage: string | null;
          default_timing: string | null;
          default_duration: string | null;
          is_custom: boolean;
          is_favorite: boolean;
        }[];
      };
    };
  };
}

// ============================================================================
// Phase 5: Communications & AI Assist Database Interfaces
// ============================================================================

export type CommunicationChannel = "whatsapp" | "sms" | "in_app";
export type CommunicationStatus =
  | "pending"
  | "processing"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "cancelled"
  | "dead_letter";

export interface CommunicationQueueItem {
  id: string;
  tenant_id: string;
  patient_id: string | null;
  appointment_id: string | null;
  channel: CommunicationChannel;
  message_type: string;
  template_id: string;
  template_params: Record<string, unknown>;
  recipient_phone: string | null;
  recipient_user_id: string | null;
  status: CommunicationStatus;
  retry_count: number;
  max_retries: number;
  next_retry_at: string;
  error_message: string | null;
  external_message_id: string | null;
  sent_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface TenantMessagingConfig {
  id: string;
  tenant_id: string;
  whatsapp_enabled: boolean;
  sms_enabled: boolean;
  monthly_quota: number;
  messages_sent_this_month: number;
  quota_warning_threshold: number;
  quota_warning_sent_at: string | null;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  auto_prescription_share: boolean;
  auto_lab_share: boolean;
  auto_receipt_share: boolean;
  auto_reminder_hours: number;
  created_at: string;
  updated_at: string;
}

export type NotificationCategory = "clinical" | "queue" | "billing" | "system";
export type NotificationRecipientRole = "doctor" | "receptionist" | "admin" | "owner" | "nurse";

export interface InAppNotificationItem {
  id: string;
  tenant_id: string;
  recipient_user_id: string | null;
  recipient_role: NotificationRecipientRole | null;
  category: NotificationCategory;
  event_type: string;
  title: string;
  message: string;
  link_url: string | null;
  is_read: boolean;
  read_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface PatientCommunicationPreferences {
  preferred_language: "en" | "mr";
  whatsapp_opt_out: boolean;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  guardian_relationship?: string | null;
}

