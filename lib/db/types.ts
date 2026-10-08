export type UserRole = "owner" | "admin" | "doctor" | "receptionist" | "nurse";

export interface Tenant {
  id: string;
  name: string;
  address: string | null;
  specialties: string[];
  working_hours: Record<string, { open: string; close: string; closed?: boolean }>;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  tenant_id: string;
  role: UserRole;
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
  created_by: string;
  created_at: string;
  updated_at: string;
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
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      queue_tokens: {
        Row: QueueToken;
        Insert: {
          id?: string;
          tenant_id: string;
          visit_id: string;
          date?: string;
          token_number: number;
          priority?: QueuePriority;
          called_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          visit_id?: string;
          date?: string;
          token_number?: number;
          priority?: QueuePriority;
          called_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      waitlist_entries: {
        Row: WaitlistEntry;
        Insert: {
          id?: string;
          tenant_id: string;
          patient_id: string;
          doctor_id?: string | null;
          target_date: string;
          time_window?: string | null;
          status?: WaitlistStatus;
          promoted_visit_id?: string | null;
          priority?: number;
          notes?: string | null;
          created_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          patient_id?: string;
          doctor_id?: string | null;
          target_date?: string;
          time_window?: string | null;
          status?: WaitlistStatus;
          promoted_visit_id?: string | null;
          priority?: number;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: AuditLog;
        Insert: {
          id?: number;
          tenant_id: string;
          actor_id?: string | null;
          actor_role: string;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          occurred_at?: string;
          metadata?: Record<string, unknown> | null;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          actor_id?: string | null;
          actor_role?: string;
          action?: string;
          entity_type?: string;
          entity_id?: string | null;
          occurred_at?: string;
          metadata?: Record<string, unknown> | null;
        };
        Relationships: [];
      };
      consent_records: {
        Row: ConsentRecord;
        Insert: {
          id?: string;
          tenant_id: string;
          patient_id: string;
          consent_type: string;
          status: "granted" | "withdrawn";
          recorded_by: string;
          recorded_at?: string;
          note?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          patient_id?: string;
          consent_type?: string;
          status?: "granted" | "withdrawn";
          recorded_by?: string;
          recorded_at?: string;
          note?: string | null;
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
    };
  };
}
