export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      api_key_usage_daily: {
        Row: {
          api_key_id: string;
          date: string;
          error_count: number;
          last_request_at: string | null;
          request_count: number;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          api_key_id: string;
          date: string;
          error_count?: number;
          last_request_at?: string | null;
          request_count?: number;
          tenant_id: string;
        };
        Update: {
          api_key_id?: string;
          date?: string;
          error_count?: number;
          last_request_at?: string | null;
          request_count?: number;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "api_key_usage_daily_tenant_api_key_fkey";
            columns: ["tenant_id", "api_key_id"];
            isOneToOne: false;
            referencedRelation: "api_keys";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "api_key_usage_daily_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      api_keys: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          key_hash: string;
          key_prefix: string;
          last_used_at: string | null;
          name: string;
          revoked_at: string | null;
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          key_hash: string;
          key_prefix: string;
          last_used_at?: string | null;
          name: string;
          revoked_at?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          key_hash?: string;
          key_prefix?: string;
          last_used_at?: string | null;
          name?: string;
          revoked_at?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "api_keys_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_role: string;
          actor_type: string;
          api_key_id: string | null;
          entity_id: string | null;
          entity_type: string;
          id: number;
          metadata: Json | null;
          occurred_at: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_role: string;
          actor_type?: string;
          api_key_id?: string | null;
          entity_id?: string | null;
          entity_type: string;
          id?: number;
          metadata?: Json | null;
          occurred_at?: string;
          tenant_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_role?: string;
          actor_type?: string;
          api_key_id?: string | null;
          entity_id?: string | null;
          entity_type?: string;
          id?: number;
          metadata?: Json | null;
          occurred_at?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_api_key_fkey";
            columns: ["tenant_id", "api_key_id"];
            isOneToOne: false;
            referencedRelation: "api_keys";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "audit_logs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      cdci_brands: {
        Row: {
          brand_name: string;
          form_id: string | null;
          generic_id: string | null;
          id: string;
          product_id: string | null;
          route_id: string | null;
          supplier_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          brand_name: string;
          form_id?: string | null;
          generic_id?: string | null;
          id: string;
          product_id?: string | null;
          route_id?: string | null;
          supplier_id?: string | null;
        };
        Update: {
          brand_name?: string;
          form_id?: string | null;
          generic_id?: string | null;
          id?: string;
          product_id?: string | null;
          route_id?: string | null;
          supplier_id?: string | null;
        };
        Relationships: [];
      };
      cdci_drug_forms: {
        Row: {
          form_name: string;
          id: string;
        };
        ComputedFields: never;
        Insert: {
          form_name: string;
          id: string;
        };
        Update: {
          form_name?: string;
          id?: string;
        };
        Relationships: [];
      };
      cdci_generics: {
        Row: {
          generic_name: string;
          id: string;
        };
        ComputedFields: never;
        Insert: {
          generic_name: string;
          id: string;
        };
        Update: {
          generic_name?: string;
          id?: string;
        };
        Relationships: [];
      };
      cdci_medicines_search: {
        Row: {
          brand_name: string;
          dose_form: string | null;
          generic_name: string | null;
          id: string;
          product_name: string | null;
          route: string | null;
          search_vector: unknown;
          supplier_name: string | null;
        };
        ComputedFields: never;
        Insert: {
          brand_name: string;
          dose_form?: string | null;
          generic_name?: string | null;
          id: string;
          product_name?: string | null;
          route?: string | null;
          search_vector?: never;
          supplier_name?: string | null;
        };
        Update: {
          brand_name?: string;
          dose_form?: string | null;
          generic_name?: string | null;
          id?: string;
          product_name?: string | null;
          route?: string | null;
          search_vector?: never;
          supplier_name?: string | null;
        };
        Relationships: [];
      };
      cdci_products: {
        Row: {
          id: string;
          product_name: string;
        };
        ComputedFields: never;
        Insert: {
          id: string;
          product_name: string;
        };
        Update: {
          id?: string;
          product_name?: string;
        };
        Relationships: [];
      };
      cdci_routes: {
        Row: {
          id: string;
          route_name: string;
        };
        ComputedFields: never;
        Insert: {
          id: string;
          route_name: string;
        };
        Update: {
          id?: string;
          route_name?: string;
        };
        Relationships: [];
      };
      cdci_substances: {
        Row: {
          id: string;
          substance_name: string;
        };
        ComputedFields: never;
        Insert: {
          id: string;
          substance_name: string;
        };
        Update: {
          id?: string;
          substance_name?: string;
        };
        Relationships: [];
      };
      cdci_suppliers: {
        Row: {
          id: string;
          supplier_name: string;
        };
        ComputedFields: never;
        Insert: {
          id: string;
          supplier_name: string;
        };
        Update: {
          id?: string;
          supplier_name?: string;
        };
        Relationships: [];
      };
      communication_queue: {
        Row: {
          appointment_id: string | null;
          channel: string;
          created_at: string;
          created_by: string | null;
          dedupe_key: string | null;
          error_message: string | null;
          external_message_id: string | null;
          id: string;
          max_retries: number;
          message_type: string;
          metadata: Json | null;
          next_retry_at: string;
          patient_id: string | null;
          recipient_phone: string | null;
          recipient_user_id: string | null;
          retry_count: number;
          sent_at: string | null;
          status: string;
          template_id: string;
          template_params: NonNullable<Json>;
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          appointment_id?: string | null;
          channel: string;
          created_at?: string;
          created_by?: string | null;
          dedupe_key?: string | null;
          error_message?: string | null;
          external_message_id?: string | null;
          id?: string;
          max_retries?: number;
          message_type: string;
          metadata?: Json | null;
          next_retry_at?: string;
          patient_id?: string | null;
          recipient_phone?: string | null;
          recipient_user_id?: string | null;
          retry_count?: number;
          sent_at?: string | null;
          status?: string;
          template_id: string;
          template_params?: NonNullable<Json>;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          appointment_id?: string | null;
          channel?: string;
          created_at?: string;
          created_by?: string | null;
          dedupe_key?: string | null;
          error_message?: string | null;
          external_message_id?: string | null;
          id?: string;
          max_retries?: number;
          message_type?: string;
          metadata?: Json | null;
          next_retry_at?: string;
          patient_id?: string | null;
          recipient_phone?: string | null;
          recipient_user_id?: string | null;
          retry_count?: number;
          sent_at?: string | null;
          status?: string;
          template_id?: string;
          template_params?: NonNullable<Json>;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "communication_queue_tenant_appointment_fkey";
            columns: ["tenant_id", "appointment_id"];
            isOneToOne: false;
            referencedRelation: "visits";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "communication_queue_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communication_queue_tenant_patient_fkey";
            columns: ["tenant_id", "patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      consent_records: {
        Row: {
          consent_type: string;
          id: string;
          note: string | null;
          patient_id: string;
          recorded_at: string;
          recorded_by: string;
          status: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          consent_type: string;
          id?: string;
          note?: string | null;
          patient_id: string;
          recorded_at?: string;
          recorded_by: string;
          status: string;
          tenant_id: string;
        };
        Update: {
          consent_type?: string;
          id?: string;
          note?: string | null;
          patient_id?: string;
          recorded_at?: string;
          recorded_by?: string;
          status?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "consent_records_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consent_records_tenant_patient_fkey";
            columns: ["tenant_id", "patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      consultation_diagnoses: {
        Row: {
          created_at: string;
          diagnosis_name: string;
          icd11_code: string | null;
          id: string;
          is_chronic: boolean;
          is_custom: boolean;
          notes: string | null;
          patient_id: string;
          snomed_concept_id: string | null;
          tenant_id: string;
          visit_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          diagnosis_name: string;
          icd11_code?: string | null;
          id?: string;
          is_chronic?: boolean;
          is_custom?: boolean;
          notes?: string | null;
          patient_id: string;
          snomed_concept_id?: string | null;
          tenant_id: string;
          visit_id: string;
        };
        Update: {
          created_at?: string;
          diagnosis_name?: string;
          icd11_code?: string | null;
          id?: string;
          is_chronic?: boolean;
          is_custom?: boolean;
          notes?: string | null;
          patient_id?: string;
          snomed_concept_id?: string | null;
          tenant_id?: string;
          visit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "consultation_diagnoses_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consultation_diagnoses_tenant_patient_fkey";
            columns: ["tenant_id", "patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "consultation_diagnoses_tenant_visit_fkey";
            columns: ["tenant_id", "visit_id"];
            isOneToOne: false;
            referencedRelation: "visits";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      consultations: {
        Row: {
          chief_complaint: string | null;
          clinical_notes: string | null;
          created_at: string;
          doctor_id: string;
          icd10_code: string | null;
          icd10_display: string | null;
          id: string;
          patient_id: string;
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          chief_complaint?: string | null;
          clinical_notes?: string | null;
          created_at?: string;
          doctor_id: string;
          icd10_code?: string | null;
          icd10_display?: string | null;
          id?: string;
          patient_id: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          chief_complaint?: string | null;
          clinical_notes?: string | null;
          created_at?: string;
          doctor_id?: string;
          icd10_code?: string | null;
          icd10_display?: string | null;
          id?: string;
          patient_id?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "consultations_tenant_doctor_fkey";
            columns: ["doctor_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["user_id", "tenant_id"];
          },
          {
            foreignKeyName: "consultations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consultations_tenant_patient_fkey";
            columns: ["tenant_id", "patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      doctor_custom_diagnoses: {
        Row: {
          created_at: string;
          diagnosis_name: string;
          doctor_id: string;
          id: string;
          specialty: string | null;
          tenant_id: string;
          updated_at: string;
          use_count: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          diagnosis_name: string;
          doctor_id: string;
          id?: string;
          specialty?: string | null;
          tenant_id: string;
          updated_at?: string;
          use_count?: number;
        };
        Update: {
          created_at?: string;
          diagnosis_name?: string;
          doctor_id?: string;
          id?: string;
          specialty?: string | null;
          tenant_id?: string;
          updated_at?: string;
          use_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "doctor_custom_diagnoses_tenant_doctor_fkey";
            columns: ["doctor_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["user_id", "tenant_id"];
          },
          {
            foreignKeyName: "doctor_custom_diagnoses_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      doctor_custom_medicines: {
        Row: {
          created_at: string;
          default_dosage: string | null;
          default_duration: string | null;
          default_timing: string | null;
          doctor_id: string;
          dose_form: string | null;
          generic_name: string | null;
          id: string;
          medicine_name: string;
          tenant_id: string;
          updated_at: string;
          use_count: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          default_dosage?: string | null;
          default_duration?: string | null;
          default_timing?: string | null;
          doctor_id: string;
          dose_form?: string | null;
          generic_name?: string | null;
          id?: string;
          medicine_name: string;
          tenant_id: string;
          updated_at?: string;
          use_count?: number;
        };
        Update: {
          created_at?: string;
          default_dosage?: string | null;
          default_duration?: string | null;
          default_timing?: string | null;
          doctor_id?: string;
          dose_form?: string | null;
          generic_name?: string | null;
          id?: string;
          medicine_name?: string;
          tenant_id?: string;
          updated_at?: string;
          use_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "doctor_custom_medicines_tenant_doctor_fkey";
            columns: ["doctor_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["user_id", "tenant_id"];
          },
          {
            foreignKeyName: "doctor_custom_medicines_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      doctor_prescription_templates: {
        Row: {
          created_at: string;
          doctor_id: string;
          id: string;
          items: NonNullable<Json>;
          specialty: string | null;
          template_name: string;
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          doctor_id: string;
          id?: string;
          items?: NonNullable<Json>;
          specialty?: string | null;
          template_name: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          doctor_id?: string;
          id?: string;
          items?: NonNullable<Json>;
          specialty?: string | null;
          template_name?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "doctor_prescription_templates_tenant_doctor_fkey";
            columns: ["doctor_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["user_id", "tenant_id"];
          },
          {
            foreignKeyName: "doctor_prescription_templates_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      document_share_tokens: {
        Row: {
          access_count: number;
          created_at: string;
          created_by: string | null;
          document_id: string | null;
          expires_at: string;
          id: string;
          last_accessed_at: string | null;
          resource_id: string | null;
          resource_type: string;
          revoked_at: string | null;
          tenant_id: string;
          token_hash: string;
        };
        ComputedFields: never;
        Insert: {
          access_count?: number;
          created_at?: string;
          created_by?: string | null;
          document_id?: string | null;
          expires_at?: string;
          id?: string;
          last_accessed_at?: string | null;
          resource_id?: string | null;
          resource_type?: string;
          revoked_at?: string | null;
          tenant_id: string;
          token_hash: string;
        };
        Update: {
          access_count?: number;
          created_at?: string;
          created_by?: string | null;
          document_id?: string | null;
          expires_at?: string;
          id?: string;
          last_accessed_at?: string | null;
          resource_id?: string | null;
          resource_type?: string;
          revoked_at?: string | null;
          tenant_id?: string;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_share_tokens_tenant_document_fkey";
            columns: ["tenant_id", "document_id"];
            isOneToOne: false;
            referencedRelation: "patient_documents";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "document_share_tokens_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      follow_ups: {
        Row: {
          created_at: string;
          doctor_id: string;
          follow_up_date: string;
          id: string;
          notes: string | null;
          patient_id: string;
          status: string;
          tenant_id: string;
          visit_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          doctor_id: string;
          follow_up_date: string;
          id?: string;
          notes?: string | null;
          patient_id: string;
          status?: string;
          tenant_id: string;
          visit_id?: string | null;
        };
        Update: {
          created_at?: string;
          doctor_id?: string;
          follow_up_date?: string;
          id?: string;
          notes?: string | null;
          patient_id?: string;
          status?: string;
          tenant_id?: string;
          visit_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "follow_ups_tenant_doctor_fkey";
            columns: ["doctor_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["user_id", "tenant_id"];
          },
          {
            foreignKeyName: "follow_ups_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_ups_tenant_patient_fkey";
            columns: ["tenant_id", "patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "follow_ups_tenant_visit_fkey";
            columns: ["tenant_id", "visit_id"];
            isOneToOne: false;
            referencedRelation: "visits";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      in_app_notifications: {
        Row: {
          category: string;
          created_at: string;
          event_type: string;
          id: string;
          is_read: boolean;
          link_url: string | null;
          message: string;
          metadata: Json | null;
          read_at: string | null;
          recipient_role: string | null;
          recipient_user_id: string | null;
          tenant_id: string;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          category: string;
          created_at?: string;
          event_type: string;
          id?: string;
          is_read?: boolean;
          link_url?: string | null;
          message: string;
          metadata?: Json | null;
          read_at?: string | null;
          recipient_role?: string | null;
          recipient_user_id?: string | null;
          tenant_id: string;
          title: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          event_type?: string;
          id?: string;
          is_read?: boolean;
          link_url?: string | null;
          message?: string;
          metadata?: Json | null;
          read_at?: string | null;
          recipient_role?: string | null;
          recipient_user_id?: string | null;
          tenant_id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "in_app_notifications_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          consumed_at: string | null;
          consumed_by: string | null;
          created_at: string;
          created_by: string;
          expires_at: string;
          id: string;
          invited_address: string;
          role: string;
          tenant_id: string;
          token_hash: string;
        };
        ComputedFields: never;
        Insert: {
          consumed_at?: string | null;
          consumed_by?: string | null;
          created_at?: string;
          created_by: string;
          expires_at: string;
          id?: string;
          invited_address: string;
          role: string;
          tenant_id: string;
          token_hash: string;
        };
        Update: {
          consumed_at?: string | null;
          consumed_by?: string | null;
          created_at?: string;
          created_by?: string;
          expires_at?: string;
          id?: string;
          invited_address?: string;
          role?: string;
          tenant_id?: string;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_items: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          invoice_id: string;
          item_type: string;
          quantity: number;
          tenant_id: string;
          total_price: number;
          unit_price: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description: string;
          id?: string;
          invoice_id: string;
          item_type: string;
          quantity?: number;
          tenant_id: string;
          total_price?: number;
          unit_price?: number;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          invoice_id?: string;
          item_type?: string;
          quantity?: number;
          tenant_id?: string;
          total_price?: number;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_items_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_items_tenant_invoice_fkey";
            columns: ["tenant_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      invoices: {
        Row: {
          created_at: string;
          discount: number;
          id: string;
          invoice_number: string;
          patient_id: string;
          status: string;
          subtotal: number;
          tax: number;
          tenant_id: string;
          total_amount: number;
          updated_at: string;
          visit_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          discount?: number;
          id?: string;
          invoice_number: string;
          patient_id: string;
          status?: string;
          subtotal?: number;
          tax?: number;
          tenant_id: string;
          total_amount?: number;
          updated_at?: string;
          visit_id: string;
        };
        Update: {
          created_at?: string;
          discount?: number;
          id?: string;
          invoice_number?: string;
          patient_id?: string;
          status?: string;
          subtotal?: number;
          tax?: number;
          tenant_id?: string;
          total_amount?: number;
          updated_at?: string;
          visit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_tenant_patient_fkey";
            columns: ["tenant_id", "patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "invoices_tenant_visit_fkey";
            columns: ["tenant_id", "visit_id"];
            isOneToOne: false;
            referencedRelation: "visits";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      memberships: {
        Row: {
          availability_schedule: Json | null;
          created_at: string;
          default_slot_duration_minutes: number | null;
          default_specialty: string | null;
          full_name: string | null;
          id: string;
          medical_council_reg_no: string | null;
          phone: string | null;
          qualifications: string | null;
          role: string;
          signature_url: string | null;
          tenant_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          availability_schedule?: Json | null;
          created_at?: string;
          default_slot_duration_minutes?: number | null;
          default_specialty?: string | null;
          full_name?: string | null;
          id?: string;
          medical_council_reg_no?: string | null;
          phone?: string | null;
          qualifications?: string | null;
          role: string;
          signature_url?: string | null;
          tenant_id: string;
          user_id: string;
        };
        Update: {
          availability_schedule?: Json | null;
          created_at?: string;
          default_slot_duration_minutes?: number | null;
          default_specialty?: string | null;
          full_name?: string | null;
          id?: string;
          medical_council_reg_no?: string | null;
          phone?: string | null;
          qualifications?: string | null;
          role?: string;
          signature_url?: string | null;
          tenant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      opd_diagnoses: {
        Row: {
          category: string | null;
          icd11_code: string | null;
          id: string;
          is_chronic: boolean;
          name: string;
          snomed_concept_id: string | null;
          specialties: string[] | null;
          synonyms: string[] | null;
        };
        ComputedFields: never;
        Insert: {
          category?: string | null;
          icd11_code?: string | null;
          id?: string;
          is_chronic?: boolean;
          name: string;
          snomed_concept_id?: string | null;
          specialties?: string[] | null;
          synonyms?: string[] | null;
        };
        Update: {
          category?: string | null;
          icd11_code?: string | null;
          id?: string;
          is_chronic?: boolean;
          name?: string;
          snomed_concept_id?: string | null;
          specialties?: string[] | null;
          synonyms?: string[] | null;
        };
        Relationships: [];
      };
      patient_documents: {
        Row: {
          created_at: string;
          document_type: string;
          file_size_bytes: number;
          id: string;
          is_abnormal: boolean;
          mime_type: string;
          notes: string | null;
          original_filename: string;
          patient_id: string;
          report_date: string;
          storage_path: string;
          tenant_id: string;
          title: string;
          updated_at: string;
          uploaded_by: string;
          visit_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          document_type?: string;
          file_size_bytes: number;
          id?: string;
          is_abnormal?: boolean;
          mime_type: string;
          notes?: string | null;
          original_filename: string;
          patient_id: string;
          report_date?: string;
          storage_path: string;
          tenant_id: string;
          title: string;
          updated_at?: string;
          uploaded_by: string;
          visit_id?: string | null;
        };
        Update: {
          created_at?: string;
          document_type?: string;
          file_size_bytes?: number;
          id?: string;
          is_abnormal?: boolean;
          mime_type?: string;
          notes?: string | null;
          original_filename?: string;
          patient_id?: string;
          report_date?: string;
          storage_path?: string;
          tenant_id?: string;
          title?: string;
          updated_at?: string;
          uploaded_by?: string;
          visit_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "patient_documents_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "patient_documents_tenant_patient_fkey";
            columns: ["tenant_id", "patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "patient_documents_tenant_visit_fkey";
            columns: ["tenant_id", "visit_id"];
            isOneToOne: false;
            referencedRelation: "visits";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      patients: {
        Row: {
          abha_id: string | null;
          address: Json | null;
          age: number | null;
          allergies: string[] | null;
          chronic_conditions: string[] | null;
          created_at: string;
          created_by: string;
          date_of_birth: string | null;
          emergency_contact: Json | null;
          erased_at: string | null;
          erasure_reason: string | null;
          full_name: string;
          guardian_name: string | null;
          guardian_phone: string | null;
          guardian_relationship: string | null;
          hfr_facility_id: string | null;
          id: string;
          is_deleted: boolean;
          national_health_id: string | null;
          phone: string;
          preferred_language: string;
          sex: string | null;
          status: string | null;
          tenant_id: string;
          updated_at: string;
          whatsapp_opt_out: boolean;
        };
        ComputedFields: never;
        Insert: {
          abha_id?: string | null;
          address?: Json | null;
          age?: number | null;
          allergies?: string[] | null;
          chronic_conditions?: string[] | null;
          created_at?: string;
          created_by: string;
          date_of_birth?: string | null;
          emergency_contact?: Json | null;
          erased_at?: string | null;
          erasure_reason?: string | null;
          full_name: string;
          guardian_name?: string | null;
          guardian_phone?: string | null;
          guardian_relationship?: string | null;
          hfr_facility_id?: string | null;
          id?: string;
          is_deleted?: boolean;
          national_health_id?: string | null;
          phone: string;
          preferred_language?: string;
          sex?: string | null;
          status?: string | null;
          tenant_id: string;
          updated_at?: string;
          whatsapp_opt_out?: boolean;
        };
        Update: {
          abha_id?: string | null;
          address?: Json | null;
          age?: number | null;
          allergies?: string[] | null;
          chronic_conditions?: string[] | null;
          created_at?: string;
          created_by?: string;
          date_of_birth?: string | null;
          emergency_contact?: Json | null;
          erased_at?: string | null;
          erasure_reason?: string | null;
          full_name?: string;
          guardian_name?: string | null;
          guardian_phone?: string | null;
          guardian_relationship?: string | null;
          hfr_facility_id?: string | null;
          id?: string;
          is_deleted?: boolean;
          national_health_id?: string | null;
          phone?: string;
          preferred_language?: string;
          sex?: string | null;
          status?: string | null;
          tenant_id?: string;
          updated_at?: string;
          whatsapp_opt_out?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "patients_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_records: {
        Row: {
          amount_inr: number;
          created_at: string;
          id: string;
          method: string;
          paid_at: string;
          reference: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount_inr: number;
          created_at?: string;
          id?: string;
          method?: string;
          paid_at?: string;
          reference: string;
          tenant_id: string;
        };
        Update: {
          amount_inr?: number;
          created_at?: string;
          id?: string;
          method?: string;
          paid_at?: string;
          reference?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_records_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          command_id: string | null;
          id: string;
          invoice_id: string;
          notes: string | null;
          payment_method: string;
          recorded_at: string;
          recorded_by: string | null;
          recorded_by_system: string | null;
          reference_number: string | null;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          command_id?: string | null;
          id?: string;
          invoice_id: string;
          notes?: string | null;
          payment_method: string;
          recorded_at?: string;
          recorded_by?: string | null;
          recorded_by_system?: string | null;
          reference_number?: string | null;
          tenant_id: string;
        };
        Update: {
          amount?: number;
          command_id?: string | null;
          id?: string;
          invoice_id?: string;
          notes?: string | null;
          payment_method?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          recorded_by_system?: string | null;
          reference_number?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_tenant_invoice_fkey";
            columns: ["tenant_id", "invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      prescription_items: {
        Row: {
          cdci_brand_id: string | null;
          cdci_generic_id: string | null;
          created_at: string;
          dosage: string;
          dose_form: string | null;
          duration: string;
          generic_name: string | null;
          id: string;
          medicine_name: string;
          prescription_id: string;
          sort_order: number;
          special_instructions: string | null;
          tenant_id: string;
          timing: string | null;
        };
        ComputedFields: never;
        Insert: {
          cdci_brand_id?: string | null;
          cdci_generic_id?: string | null;
          created_at?: string;
          dosage: string;
          dose_form?: string | null;
          duration: string;
          generic_name?: string | null;
          id?: string;
          medicine_name: string;
          prescription_id: string;
          sort_order?: number;
          special_instructions?: string | null;
          tenant_id: string;
          timing?: string | null;
        };
        Update: {
          cdci_brand_id?: string | null;
          cdci_generic_id?: string | null;
          created_at?: string;
          dosage?: string;
          dose_form?: string | null;
          duration?: string;
          generic_name?: string | null;
          id?: string;
          medicine_name?: string;
          prescription_id?: string;
          sort_order?: number;
          special_instructions?: string | null;
          tenant_id?: string;
          timing?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "prescription_items_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prescription_items_tenant_prescription_fkey";
            columns: ["tenant_id", "prescription_id"];
            isOneToOne: false;
            referencedRelation: "prescriptions";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      prescriptions: {
        Row: {
          amendment_reason: string | null;
          created_at: string;
          doctor_id: string;
          id: string;
          letterhead_mode: string;
          patient_id: string;
          pdf_storage_path: string | null;
          signed_at: string | null;
          status: string;
          tenant_id: string;
          updated_at: string;
          version: number;
          visit_id: string;
        };
        ComputedFields: never;
        Insert: {
          amendment_reason?: string | null;
          created_at?: string;
          doctor_id: string;
          id?: string;
          letterhead_mode?: string;
          patient_id: string;
          pdf_storage_path?: string | null;
          signed_at?: string | null;
          status?: string;
          tenant_id: string;
          updated_at?: string;
          version?: number;
          visit_id: string;
        };
        Update: {
          amendment_reason?: string | null;
          created_at?: string;
          doctor_id?: string;
          id?: string;
          letterhead_mode?: string;
          patient_id?: string;
          pdf_storage_path?: string | null;
          signed_at?: string | null;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
          version?: number;
          visit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "prescriptions_tenant_doctor_fkey";
            columns: ["doctor_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["user_id", "tenant_id"];
          },
          {
            foreignKeyName: "prescriptions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "prescriptions_tenant_patient_fkey";
            columns: ["tenant_id", "patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "prescriptions_tenant_visit_fkey";
            columns: ["tenant_id", "visit_id"];
            isOneToOne: false;
            referencedRelation: "visits";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      queue_tokens: {
        Row: {
          called_at: string | null;
          completed_at: string | null;
          created_at: string;
          date: string;
          id: string;
          priority: string;
          tenant_id: string;
          token_number: number;
          visit_id: string;
        };
        ComputedFields: never;
        Insert: {
          called_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          date?: string;
          id?: string;
          priority?: string;
          tenant_id: string;
          token_number: number;
          visit_id: string;
        };
        Update: {
          called_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          date?: string;
          id?: string;
          priority?: string;
          tenant_id?: string;
          token_number?: number;
          visit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "queue_tokens_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "queue_tokens_tenant_visit_fkey";
            columns: ["tenant_id", "visit_id"];
            isOneToOne: false;
            referencedRelation: "visits";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      referrals: {
        Row: {
          acknowledged_at: string | null;
          active_medications_snapshot: Json | null;
          clinical_summary: string | null;
          closed_by: string | null;
          closure_notes: string | null;
          completed_at: string | null;
          consented_history_snapshot: Json | null;
          created_at: string;
          id: string;
          investigations_advised: string[] | null;
          letterhead_mode: string;
          patient_consents_history_sharing: boolean;
          patient_id: string;
          pdf_storage_path: string | null;
          provisional_diagnosis: string | null;
          reason_for_referral: string;
          referral_type: string;
          referred_to_contact: string | null;
          referred_to_facility: string | null;
          referred_to_name: string;
          referred_to_specialty: string | null;
          referring_doctor_id: string;
          sent_at: string;
          status: string;
          target_doctor_id: string | null;
          target_tenant_id: string | null;
          tenant_id: string;
          updated_at: string;
          urgency: string;
          visit_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          acknowledged_at?: string | null;
          active_medications_snapshot?: Json | null;
          clinical_summary?: string | null;
          closed_by?: string | null;
          closure_notes?: string | null;
          completed_at?: string | null;
          consented_history_snapshot?: Json | null;
          created_at?: string;
          id?: string;
          investigations_advised?: string[] | null;
          letterhead_mode?: string;
          patient_consents_history_sharing?: boolean;
          patient_id: string;
          pdf_storage_path?: string | null;
          provisional_diagnosis?: string | null;
          reason_for_referral: string;
          referral_type: string;
          referred_to_contact?: string | null;
          referred_to_facility?: string | null;
          referred_to_name: string;
          referred_to_specialty?: string | null;
          referring_doctor_id: string;
          sent_at?: string;
          status?: string;
          target_doctor_id?: string | null;
          target_tenant_id?: string | null;
          tenant_id: string;
          updated_at?: string;
          urgency?: string;
          visit_id?: string | null;
        };
        Update: {
          acknowledged_at?: string | null;
          active_medications_snapshot?: Json | null;
          clinical_summary?: string | null;
          closed_by?: string | null;
          closure_notes?: string | null;
          completed_at?: string | null;
          consented_history_snapshot?: Json | null;
          created_at?: string;
          id?: string;
          investigations_advised?: string[] | null;
          letterhead_mode?: string;
          patient_consents_history_sharing?: boolean;
          patient_id?: string;
          pdf_storage_path?: string | null;
          provisional_diagnosis?: string | null;
          reason_for_referral?: string;
          referral_type?: string;
          referred_to_contact?: string | null;
          referred_to_facility?: string | null;
          referred_to_name?: string;
          referred_to_specialty?: string | null;
          referring_doctor_id?: string;
          sent_at?: string;
          status?: string;
          target_doctor_id?: string | null;
          target_tenant_id?: string | null;
          tenant_id?: string;
          updated_at?: string;
          urgency?: string;
          visit_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "referrals_target_tenant_id_fkey";
            columns: ["target_tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referrals_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referrals_tenant_patient_fkey";
            columns: ["tenant_id", "patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "referrals_tenant_referring_doctor_fkey";
            columns: ["referring_doctor_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["user_id", "tenant_id"];
          },
          {
            foreignKeyName: "referrals_tenant_visit_fkey";
            columns: ["tenant_id", "visit_id"];
            isOneToOne: false;
            referencedRelation: "visits";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      schedule_blocks: {
        Row: {
          all_day: boolean | null;
          created_at: string;
          created_by: string;
          doctor_id: string | null;
          end_time: string;
          id: string;
          reason: string | null;
          start_time: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          all_day?: boolean | null;
          created_at?: string;
          created_by: string;
          doctor_id?: string | null;
          end_time: string;
          id?: string;
          reason?: string | null;
          start_time: string;
          tenant_id: string;
        };
        Update: {
          all_day?: boolean | null;
          created_at?: string;
          created_by?: string;
          doctor_id?: string | null;
          end_time?: string;
          id?: string;
          reason?: string | null;
          start_time?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "schedule_blocks_tenant_doctor_fkey";
            columns: ["doctor_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["user_id", "tenant_id"];
          },
          {
            foreignKeyName: "schedule_blocks_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          amount_inr: number;
          created_at: string;
          current_period_end: string;
          id: string;
          plan: string;
          status: string;
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount_inr?: number;
          created_at?: string;
          current_period_end?: string;
          id?: string;
          plan?: string;
          status?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          amount_inr?: number;
          created_at?: string;
          current_period_end?: string;
          id?: string;
          plan?: string;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_messaging_config: {
        Row: {
          auto_lab_share: boolean;
          auto_prescription_share: boolean;
          auto_receipt_share: boolean;
          auto_reminder_hours: number;
          created_at: string;
          id: string;
          messages_sent_this_month: number;
          monthly_quota: number;
          quiet_hours_enabled: boolean;
          quiet_hours_end: string;
          quiet_hours_start: string;
          quota_warning_sent_at: string | null;
          quota_warning_threshold: number;
          sms_enabled: boolean;
          tenant_id: string;
          updated_at: string;
          whatsapp_enabled: boolean;
        };
        ComputedFields: never;
        Insert: {
          auto_lab_share?: boolean;
          auto_prescription_share?: boolean;
          auto_receipt_share?: boolean;
          auto_reminder_hours?: number;
          created_at?: string;
          id?: string;
          messages_sent_this_month?: number;
          monthly_quota?: number;
          quiet_hours_enabled?: boolean;
          quiet_hours_end?: string;
          quiet_hours_start?: string;
          quota_warning_sent_at?: string | null;
          quota_warning_threshold?: number;
          sms_enabled?: boolean;
          tenant_id: string;
          updated_at?: string;
          whatsapp_enabled?: boolean;
        };
        Update: {
          auto_lab_share?: boolean;
          auto_prescription_share?: boolean;
          auto_receipt_share?: boolean;
          auto_reminder_hours?: number;
          created_at?: string;
          id?: string;
          messages_sent_this_month?: number;
          monthly_quota?: number;
          quiet_hours_enabled?: boolean;
          quiet_hours_end?: string;
          quiet_hours_start?: string;
          quota_warning_sent_at?: string | null;
          quota_warning_threshold?: number;
          sms_enabled?: boolean;
          tenant_id?: string;
          updated_at?: string;
          whatsapp_enabled?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_messaging_config_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          accepted_payment_methods: string[] | null;
          address: string | null;
          clinical_establishment_reg_no: string | null;
          created_at: string;
          default_consultation_fee: number | null;
          default_followup_fee: number | null;
          drug_license_no: string | null;
          email: string | null;
          gstin: string | null;
          id: string;
          letterhead_bottom_margin: number | null;
          letterhead_top_margin: number | null;
          logo_url: string | null;
          name: string;
          owner_is_practicing_doctor: boolean | null;
          phone: string | null;
          registration_number: string | null;
          specialties: string[] | null;
          state_medical_council_reg_no: string | null;
          timezone: string;
          updated_at: string;
          working_hours: Json | null;
        };
        ComputedFields: never;
        Insert: {
          accepted_payment_methods?: string[] | null;
          address?: string | null;
          clinical_establishment_reg_no?: string | null;
          created_at?: string;
          default_consultation_fee?: number | null;
          default_followup_fee?: number | null;
          drug_license_no?: string | null;
          email?: string | null;
          gstin?: string | null;
          id?: string;
          letterhead_bottom_margin?: number | null;
          letterhead_top_margin?: number | null;
          logo_url?: string | null;
          name: string;
          owner_is_practicing_doctor?: boolean | null;
          phone?: string | null;
          registration_number?: string | null;
          specialties?: string[] | null;
          state_medical_council_reg_no?: string | null;
          timezone?: string;
          updated_at?: string;
          working_hours?: Json | null;
        };
        Update: {
          accepted_payment_methods?: string[] | null;
          address?: string | null;
          clinical_establishment_reg_no?: string | null;
          created_at?: string;
          default_consultation_fee?: number | null;
          default_followup_fee?: number | null;
          drug_license_no?: string | null;
          email?: string | null;
          gstin?: string | null;
          id?: string;
          letterhead_bottom_margin?: number | null;
          letterhead_top_margin?: number | null;
          logo_url?: string | null;
          name?: string;
          owner_is_practicing_doctor?: boolean | null;
          phone?: string | null;
          registration_number?: string | null;
          specialties?: string[] | null;
          state_medical_council_reg_no?: string | null;
          timezone?: string;
          updated_at?: string;
          working_hours?: Json | null;
        };
        Relationships: [];
      };
      visit_revisions: {
        Row: {
          amended_at: string;
          amended_by: string;
          amendment_reason: string;
          id: string;
          revision_number: number;
          snapshot: NonNullable<Json>;
          tenant_id: string;
          visit_id: string;
        };
        ComputedFields: never;
        Insert: {
          amended_at?: string;
          amended_by: string;
          amendment_reason: string;
          id?: string;
          revision_number: number;
          snapshot: NonNullable<Json>;
          tenant_id: string;
          visit_id: string;
        };
        Update: {
          amended_at?: string;
          amended_by?: string;
          amendment_reason?: string;
          id?: string;
          revision_number?: number;
          snapshot?: NonNullable<Json>;
          tenant_id?: string;
          visit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "visit_revisions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "visit_revisions_tenant_visit_fkey";
            columns: ["tenant_id", "visit_id"];
            isOneToOne: false;
            referencedRelation: "visits";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      visits: {
        Row: {
          advice: string[] | null;
          chief_complaints: Json | null;
          clinical_notes: string | null;
          created_at: string;
          created_by: string;
          current_revision: number;
          doctor_id: string;
          estimated_duration_minutes: number;
          id: string;
          investigations_advised: string[] | null;
          is_overbooked: boolean;
          metadata: NonNullable<Json>;
          origin_type: string;
          patient_id: string;
          reason_for_visit: string | null;
          scheduled_at: string | null;
          signed_at: string | null;
          signed_by: string | null;
          specialty: string;
          specialty_data: Json | null;
          status: string;
          tenant_id: string;
          updated_at: string;
          vitals: Json | null;
        };
        ComputedFields: never;
        Insert: {
          advice?: string[] | null;
          chief_complaints?: Json | null;
          clinical_notes?: string | null;
          created_at?: string;
          created_by: string;
          current_revision?: number;
          doctor_id: string;
          estimated_duration_minutes?: number;
          id?: string;
          investigations_advised?: string[] | null;
          is_overbooked?: boolean;
          metadata?: NonNullable<Json>;
          origin_type: string;
          patient_id: string;
          reason_for_visit?: string | null;
          scheduled_at?: string | null;
          signed_at?: string | null;
          signed_by?: string | null;
          specialty?: string;
          specialty_data?: Json | null;
          status?: string;
          tenant_id: string;
          updated_at?: string;
          vitals?: Json | null;
        };
        Update: {
          advice?: string[] | null;
          chief_complaints?: Json | null;
          clinical_notes?: string | null;
          created_at?: string;
          created_by?: string;
          current_revision?: number;
          doctor_id?: string;
          estimated_duration_minutes?: number;
          id?: string;
          investigations_advised?: string[] | null;
          is_overbooked?: boolean;
          metadata?: NonNullable<Json>;
          origin_type?: string;
          patient_id?: string;
          reason_for_visit?: string | null;
          scheduled_at?: string | null;
          signed_at?: string | null;
          signed_by?: string | null;
          specialty?: string;
          specialty_data?: Json | null;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
          vitals?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "visits_tenant_doctor_fkey";
            columns: ["doctor_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["user_id", "tenant_id"];
          },
          {
            foreignKeyName: "visits_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "visits_tenant_patient_fkey";
            columns: ["tenant_id", "patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      waitlist_entries: {
        Row: {
          created_at: string;
          created_by: string;
          doctor_id: string | null;
          id: string;
          notes: string | null;
          patient_id: string;
          priority: number;
          promoted_visit_id: string | null;
          status: string;
          target_date: string;
          tenant_id: string;
          time_window: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by: string;
          doctor_id?: string | null;
          id?: string;
          notes?: string | null;
          patient_id: string;
          priority?: number;
          promoted_visit_id?: string | null;
          status?: string;
          target_date: string;
          tenant_id: string;
          time_window?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          doctor_id?: string | null;
          id?: string;
          notes?: string | null;
          patient_id?: string;
          priority?: number;
          promoted_visit_id?: string | null;
          status?: string;
          target_date?: string;
          tenant_id?: string;
          time_window?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_tenant_doctor_fkey";
            columns: ["doctor_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "memberships";
            referencedColumns: ["user_id", "tenant_id"];
          },
          {
            foreignKeyName: "waitlist_entries_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "waitlist_entries_tenant_patient_fkey";
            columns: ["tenant_id", "patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "waitlist_entries_tenant_promoted_visit_fkey";
            columns: ["tenant_id", "promoted_visit_id"];
            isOneToOne: false;
            referencedRelation: "visits";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      webhook_delivery_queue: {
        Row: {
          created_at: string;
          delivered_at: string | null;
          duration_ms: number | null;
          event_key: string | null;
          event_type: string;
          id: string;
          last_error: string | null;
          max_retries: number;
          next_retry_at: string;
          payload: string;
          response_status: number | null;
          retry_count: number;
          status: string;
          subscription_id: string;
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          delivered_at?: string | null;
          duration_ms?: number | null;
          event_key?: string | null;
          event_type: string;
          id?: string;
          last_error?: string | null;
          max_retries?: number;
          next_retry_at?: string;
          payload: string;
          response_status?: number | null;
          retry_count?: number;
          status?: string;
          subscription_id: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          delivered_at?: string | null;
          duration_ms?: number | null;
          event_key?: string | null;
          event_type?: string;
          id?: string;
          last_error?: string | null;
          max_retries?: number;
          next_retry_at?: string;
          payload?: string;
          response_status?: number | null;
          retry_count?: number;
          status?: string;
          subscription_id?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_delivery_queue_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "webhook_delivery_queue_tenant_subscription_fkey";
            columns: ["tenant_id", "subscription_id"];
            isOneToOne: false;
            referencedRelation: "webhook_subscriptions";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      webhook_subscriptions: {
        Row: {
          created_at: string;
          created_by: string | null;
          endpoint_url: string;
          event_types: string[];
          id: string;
          is_active: boolean;
          signing_secret: string;
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          endpoint_url: string;
          event_types: string[];
          id?: string;
          is_active?: boolean;
          signing_secret: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          endpoint_url?: string;
          event_types?: string[];
          id?: string;
          is_active?: boolean;
          signing_secret?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_subscriptions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      change_member_role: {
        Args: { p_membership_id: string; p_role: string };
        Returns: {
          availability_schedule: Json | null;
          created_at: string;
          default_slot_duration_minutes: number | null;
          default_specialty: string | null;
          full_name: string | null;
          id: string;
          medical_council_reg_no: string | null;
          phone: string | null;
          qualifications: string | null;
          role: string;
          signature_url: string | null;
          tenant_id: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "memberships";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      claim_jobs: {
        Args: {
          p_batch: number;
          p_kinds: string[];
          p_lease_seconds: number;
          p_per_tenant?: number;
          p_worker: string;
        };
        Returns: {
          attempts: number;
          claim_order: number;
          id: string;
          kind: string;
          lease_token: string;
          max_attempts: number;
          payload: Json;
          run_at: string;
          tenant_id: string;
        }[];
      };
      communication_metadata_strip_tokens: { Args: { p: Json }; Returns: Json };
      communication_payload_redact: { Args: { p: Json }; Returns: Json };
      communication_queue_apply_dlr: {
        Args: {
          p_at: string;
          p_external_message_id: string;
          p_reason_code: string;
          p_status: string;
        };
        Returns: Json;
      };
      communication_queue_claim: {
        Args: { p_id: string };
        Returns: {
          appointment_id: string | null;
          channel: string;
          created_at: string;
          created_by: string | null;
          dedupe_key: string | null;
          error_message: string | null;
          external_message_id: string | null;
          id: string;
          max_retries: number;
          message_type: string;
          metadata: Json | null;
          next_retry_at: string;
          patient_id: string | null;
          recipient_phone: string | null;
          recipient_user_id: string | null;
          retry_count: number;
          sent_at: string | null;
          status: string;
          template_id: string;
          template_params: NonNullable<Json>;
          tenant_id: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "communication_queue";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      communication_queue_dead_letter: {
        Args: { p_error_code: string; p_id: string };
        Returns: undefined;
      };
      communication_queue_finish: {
        Args: {
          p_error: string;
          p_external_message_id: string;
          p_id: string;
          p_success: boolean;
        };
        Returns: {
          new_retry_count: number;
          new_status: string;
        }[];
      };
      complete_job: {
        Args: { p_id: string; p_lease_token: string };
        Returns: boolean;
      };
      consume_invitation: { Args: { p_token_hash: string }; Returns: string };
      consume_reschedule_token: {
        Args: { p_new_at: string; p_token: string };
        Returns: Json;
      };
      create_clinic_with_owner: { Args: { p_name: string }; Returns: string };
      create_reschedule_token: {
        Args: { p_visit_id: string };
        Returns: string;
      };
      create_share_token: {
        Args: { p_resource_id: string; p_resource_type: string };
        Returns: {
          expires_at: string;
          token: string;
        }[];
      };
      current_user_has_role: {
        Args: { p_roles: string[]; p_tenant_id: string };
        Returns: boolean;
      };
      current_user_is_admin_or_owner: {
        Args: { p_tenant_id: string };
        Returns: boolean;
      };
      current_user_tenant_ids: {
        Args: Record<PropertyKey, never>;
        Returns: string[];
      };
      defer_job: {
        Args: {
          p_error_code: string;
          p_id: string;
          p_lease_token: string;
          p_retry_at: string;
        };
        Returns: string;
      };
      enqueue_message: {
        Args: {
          p_channel: string;
          p_dedupe_key?: string;
          p_message_type: string;
          p_metadata: Json;
          p_patient_id: string;
          p_recipient_phone: string;
          p_recipient_user_id: string;
          p_run_at?: string;
          p_template_id: string;
          p_template_params: Json;
          p_tenant_id: string;
          p_visit_id: string;
        };
        Returns: Json;
      };
      enqueue_message_system: {
        Args: {
          p_channel: string;
          p_dedupe_key?: string;
          p_message_type: string;
          p_metadata: Json;
          p_patient_id: string;
          p_recipient_phone: string;
          p_recipient_user_id: string;
          p_run_at?: string;
          p_system_actor: string;
          p_template_id: string;
          p_template_params: Json;
          p_visit_id: string;
        };
        Returns: Json;
      };
      enqueue_unmatched_reply_system: {
        Args: {
          p_dedupe_key: string;
          p_system_actor: string;
          p_template_id: string;
          p_to: string;
        };
        Returns: string;
      };
      enqueue_webhook_event: {
        Args: {
          p_event_type: string;
          p_subject_id: string;
          p_subscription_id?: string;
          p_tenant_id: string;
        };
        Returns: Json;
      };
      enqueue_webhook_event_system: {
        Args: {
          p_event_type: string;
          p_subject_id: string;
          p_system_actor: string;
        };
        Returns: Json;
      };
      fail_job: {
        Args: {
          p_error_code: string;
          p_id: string;
          p_lease_token: string;
          p_retry_at?: string;
          p_retryable: boolean;
        };
        Returns: string;
      };
      generate_daily_queue_token: {
        Args: { p_date: string; p_tenant_id: string };
        Returns: number;
      };
      generate_tenant_invoice_number: {
        Args: { p_tenant_id: string };
        Returns: string;
      };
      get_reschedule_context: {
        Args: { p_from: string; p_to: string; p_token: string };
        Returns: Json;
      };
      get_tenant_table_rls_policies: {
        Args: Record<PropertyKey, never>;
        Returns: {
          cmd: string;
          policy_name: string;
          qual: string;
          rls_enabled: boolean;
          roles: string[];
          table_name: string;
          with_check: string;
        }[];
      };
      has_permission: {
        Args: { p_perm: string; p_tenant: string };
        Returns: boolean;
      };
      inbound_webhook_begin: {
        Args: { p_dedupe_key: string; p_provider: string };
        Returns: string;
      };
      inbound_webhook_finish: {
        Args: { p_dedupe_key: string; p_outcome: string; p_provider: string };
        Returns: undefined;
      };
      is_safe_storage_key: { Args: { p_path: string }; Returns: boolean };
      is_valid_weekly_schedule: {
        Args: { p_schedule: Json };
        Returns: boolean;
      };
      jobs_runner_begin: {
        Args: { p_source: string; p_worker: string };
        Returns: number;
      };
      jobs_runner_end: {
        Args: {
          p_claimed: number;
          p_dead: number;
          p_done: number;
          p_error_code: string;
          p_ok: boolean;
          p_retried: number;
          p_run_id: number;
        };
        Returns: undefined;
      };
      normalize_indian_phone_e164: {
        Args: { raw_phone: string };
        Returns: string;
      };
      ops_alert_notified: {
        Args: {
          p_alert_id: string;
          p_provider_message_id: string;
          p_seq: number;
        };
        Returns: boolean;
      };
      ops_alert_payload: { Args: { p_alert_id: string }; Returns: Json };
      ops_ingest_error: {
        Args: { p_event: Json; p_ingest_key: string };
        Returns: undefined;
      };
      permission_matrix: {
        Args: Record<PropertyKey, never>;
        Returns: {
          perm: string;
          role: string;
        }[];
      };
      readiness_probe: {
        Args: { p_expected_migration?: string };
        Returns: Json;
      };
      record_payment: {
        Args: {
          p_amount: number;
          p_command_id: string;
          p_invoice_id: string;
          p_method: string;
          p_notes?: string;
          p_reference: string;
          p_system_actor?: string;
          p_tenant_id: string;
        };
        Returns: Json;
      };
      referral_source_clinics: {
        Args: { p_ids: string[] };
        Returns: {
          id: string;
          name: string;
          phone: string;
        }[];
      };
      release_job: {
        Args: { p_id: string; p_lease_token: string };
        Returns: boolean;
      };
      reschedule_token_visit: { Args: { p_token: string }; Returns: Json };
      resolve_share_token: {
        Args: { p_kinds: string[]; p_token: string };
        Returns: Json;
      };
      revoke_share_token: { Args: { p_token_id: string }; Returns: string };
      search_medicines: {
        Args: {
          p_doctor_id: string;
          p_limit?: number;
          p_query: string;
          p_tenant_id: string;
        };
        Returns: {
          default_dosage: string;
          default_duration: string;
          default_timing: string;
          dose_form: string;
          generic_name: string;
          id: string;
          is_custom: boolean;
          is_favorite: boolean;
          medicine_name: string;
        }[];
      };
      share_object_path: {
        Args: {
          p_owner_id: string;
          p_path: string;
          p_tenant_id: string;
          p_type: string;
        };
        Returns: string;
      };
      share_resource_tenant: {
        Args: { p_id: string; p_type: string };
        Returns: string;
      };
      share_token_hash: { Args: { p_token: string }; Returns: string };
      share_token_object: {
        Args: { p_kinds: string[]; p_token: string };
        Returns: Json;
      };
      share_token_resource: {
        Args: { p_resource_id: string; p_tenant_id: string; p_type: string };
        Returns: Json;
      };
      share_type_roles: { Args: { p_type: string }; Returns: string[] };
      show_limit: { Args: Record<PropertyKey, never>; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
      start_job: {
        Args: { p_id: string; p_lease_token: string };
        Returns: number;
      };
      webhook_delivery_claim: {
        Args: { p_id: string };
        Returns: {
          endpoint_url: string;
          event_type: string;
          id: string;
          is_active: boolean;
          max_retries: number;
          payload: string;
          retry_count: number;
          signing_secret: string;
          subscription_id: string;
          subscription_tenant_id: string;
          tenant_id: string;
        }[];
      };
      webhook_delivery_finish: {
        Args: {
          p_duration_ms: number;
          p_error_code: string;
          p_id: string;
          p_retryable: boolean;
          p_status_code: number;
          p_success: boolean;
        };
        Returns: {
          new_status: string;
          next_retry_at: string;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
