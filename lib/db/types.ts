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

export interface Membership {
  id: string;
  user_id: string;
  tenant_id: string;
  role: UserRole;
  qualifications?: string | null;
  medical_council_reg_no?: string | null;
  signature_url?: string | null;
  default_specialty?: string;
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
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          tenant_id?: string;
          role?: UserRole;
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
