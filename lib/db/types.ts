export type UserRole = "owner" | "admin" | "doctor" | "receptionist" | "nurse";

export interface Tenant {
  id: string;
  name: string;
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

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: Tenant;
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
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
    };
    Views: Record<string, never>;
    Functions: {
      create_clinic_with_owner: {
        Args: {
          p_name: string;
        };
        Returns: string;
      };
    };
  };
}
