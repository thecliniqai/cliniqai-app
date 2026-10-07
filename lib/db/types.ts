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
    };
  };
}
