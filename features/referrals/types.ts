import {
  Referral,
  ReferralType,
  ReferralUrgency,
  ReferralStatus,
  LetterheadMode,
} from "@/lib/db/types";

export interface ReferralItem extends Referral {
  patient?: {
    full_name: string;
    phone: string | null;
    uhid: string | null;
    age?: number | null;
    sex?: string | null;
  } | null;
  referring_doctor?: {
    name: string;
    email?: string | null;
  } | null;
  originating_clinic?: {
    id: string;
    name: string;
    phone?: string | null;
  } | null;
  target_clinic?: {
    id: string;
    name: string;
    phone?: string | null;
  } | null;
}

export interface ConsentedHistorySnapshot {
  generated_at: string;
  consented_by_patient: boolean;
  encounters: {
    visit_id: string;
    visit_date: string;
    chief_complaints?: unknown[];
    diagnoses?: string[];
    vitals?: Record<string, unknown> | null;
    medications?: {
      medicine_name: string;
      dosage: string;
      timing?: string | null;
      duration: string;
    }[];
  }[];
}

export interface CreateReferralInput {
  patient_id: string;
  visit_id?: string | null;
  referral_type: ReferralType;
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
  investigations_advised?: string[] | null;
  patient_consents_history_sharing?: boolean;
  letterhead_mode?: LetterheadMode;
}

export interface CloseReferralLoopInput {
  referral_id: string;
  closure_notes: string;
  return_date?: string | null;
}

export interface AcknowledgeReferralInput {
  referral_id: string;
}
