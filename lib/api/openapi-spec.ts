/**
 * ClinicQ External Developer REST API — OpenAPI 3.0.3 Specification Generator
 * Conforms to D-03, D-07, and AGENTS.md §11.
 * Hand-crafted typed specification covering all /api/v1/* resources without runtime reflection dependencies.
 */

export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
    contact?: {
      name?: string;
      email?: string;
      url?: string;
    };
    license?: {
      name: string;
      url?: string;
    };
  };
  servers: Array<{ url: string; description?: string }>;
  security: Array<Record<string, string[]>>;
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, any>;
  components: {
    securitySchemes: Record<string, any>;
    schemas: Record<string, any>;
    parameters?: Record<string, any>;
    responses?: Record<string, any>;
  };
}

export function generateOpenApiSpec(): OpenApiSpec {
  return {
    openapi: "3.0.3",
    info: {
      title: "ClinicQ External Developer REST API",
      version: "1.0.0",
      description:
        "Multi-tenant practice management REST API for ClinicQ. Access is strictly scoped to the authenticated clinic tenant via Bearer API keys (`clq_live_*`). All mutating endpoints enforce strict clinical governance (e.g. Doctor Guard assignment), audit trails, and DPDP Act compliance.",
      contact: {
        name: "ClinicQ Developer Platform Support",
        email: "developers@clinicos.in",
      },
      license: {
        name: "Proprietary",
      },
    },
    servers: [
      {
        url: "/api/v1",
        description: "ClinicQ Current Version 1 Namespace",
      },
    ],
    security: [
      {
        BearerAuth: [],
      },
    ],
    tags: [
      { name: "Patients", description: "Patient demographic registry and DPDP Act rights" },
      { name: "Appointments", description: "Clinic appointment scheduling and status transitions" },
      { name: "Visits", description: "Clinical encounters, vitals, and consultation management" },
      { name: "Prescriptions", description: "Doctor-issued e-prescriptions with itemized medication schedules" },
      { name: "Lab Orders", description: "Diagnostic orders, test records, and patient medical documents" },
      { name: "Referrals", description: "Inter-clinic and external specialist medical referrals" },
    ],
    paths: {
      "/patients": {
        get: {
          tags: ["Patients"],
          summary: "List patients",
          description: "Retrieve a paginated collection of active patient records in the clinic.",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 }, description: "Page number" },
            { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 }, description: "Items per page" },
            { name: "search", in: "query", schema: { type: "string" }, description: "Search by name or 10-digit phone number" },
          ],
          responses: {
            "200": {
              description: "Paginated patient collection envelope",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: { $ref: "#/components/schemas/Patient" } },
                      meta: { $ref: "#/components/schemas/StandardMeta" },
                    },
                    required: ["data", "meta"],
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
        post: {
          tags: ["Patients"],
          summary: "Create a new patient",
          description: "Register a patient in the clinic tenant with E.164 phone normalization.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PatientCreateInput" },
              },
            },
          },
          responses: {
            "201": {
              description: "Created patient envelope",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { $ref: "#/components/schemas/Patient" },
                    },
                    required: ["data"],
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/patients/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["Patients"],
          summary: "Get patient details",
          responses: {
            "200": {
              description: "Patient details envelope",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { data: { $ref: "#/components/schemas/Patient" } },
                  },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        put: {
          tags: ["Patients"],
          summary: "Update patient record",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/PatientCreateInput" } },
            },
          },
          responses: {
            "200": {
              description: "Updated patient envelope",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { data: { $ref: "#/components/schemas/Patient" } },
                  },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          tags: ["Patients"],
          summary: "Soft-delete patient record (DPDP Right to Erasure)",
          description: "DPDP Right to Erasure: Suppresses patient from active search and listings while preserving medical records under NMC 3-year statutory mandate.",
          responses: {
            "200": {
              description: "Erasure confirmation envelope",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "object",
                        properties: { success: { type: "boolean" }, id: { type: "string" }, status: { type: "string" } },
                      },
                    },
                  },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/patients/{id}/export": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          { name: "format", in: "query", schema: { type: "string", enum: ["json", "pdf"], default: "json" }, description: "Export format" },
        ],
        get: {
          tags: ["Patients"],
          summary: "Export patient data (DPDP Right to Access)",
          description:
            "Generates either an allow-listed machine-readable JSON archive or a clinic-branded consolidated Medical Summary PDF. The API key needs the exports:create scope.",
          responses: {
            "200": {
              description: "Export archive (application/json or application/pdf)",
              content: {
                "application/json": { schema: { type: "object", properties: { data: { type: "object" } } } },
                "application/pdf": { schema: { type: "string", format: "binary" } },
              },
            },
            "403": { description: "The API key does not have the exports:create scope" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/appointments": {
        get: {
          tags: ["Appointments"],
          summary: "List appointments",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "doctor_id", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["scheduled", "in_queue", "completed", "cancelled"] } },
          ],
          responses: {
            "200": {
              description: "Appointment list envelope",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: { $ref: "#/components/schemas/Appointment" } },
                      meta: { $ref: "#/components/schemas/StandardMeta" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Appointments"],
          summary: "Book an appointment",
          description: "Schedules an encounter in public.visits with conflict detection and Doctor Guard validation.",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/AppointmentCreateInput" } },
            },
          },
          responses: {
            "201": {
              description: "Created appointment envelope",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Appointment" } } },
                },
              },
            },
            "409": { description: "Doctor scheduling conflict" },
          },
        },
      },
      "/appointments/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["Appointments"],
          summary: "Get appointment details",
          responses: {
            "200": {
              content: {
                "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Appointment" } } } },
              },
            },
          },
        },
        patch: {
          tags: ["Appointments"],
          summary: "Reschedule appointment",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { scheduled_at: { type: "string", format: "date-time" } },
                  required: ["scheduled_at"],
                },
              },
            },
          },
          responses: {
            "200": {
              content: {
                "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Appointment" } } } },
              },
            },
          },
        },
        delete: {
          tags: ["Appointments"],
          summary: "Cancel appointment",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { data: { type: "object", properties: { success: { type: "boolean" } } } } },
                },
              },
            },
          },
        },
      },
      "/visits": {
        get: {
          tags: ["Visits"],
          summary: "List clinical visits",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "status", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: { $ref: "#/components/schemas/Visit" } },
                      meta: { $ref: "#/components/schemas/StandardMeta" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Visits"],
          summary: "Create a clinical visit encounter",
          description: "Requires Doctor Guard assignment (doctor_id must belong to clinic tenant).",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/VisitCreateInput" } },
            },
          },
          responses: {
            "201": {
              content: {
                "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Visit" } } } },
              },
            },
            "403": { description: "Doctor Guard assignment failure" },
          },
        },
      },
      "/visits/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["Visits"],
          summary: "Get clinical visit details",
          responses: {
            "200": {
              content: {
                "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Visit" } } } },
              },
            },
          },
        },
        patch: {
          tags: ["Visits"],
          summary: "Update clinical visit (notes, status)",
          description: "Completing a visit requires clinical safety guards (at least one diagnosis or note).",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["in_progress", "completed", "cancelled"] },
                    clinical_notes: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              content: {
                "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Visit" } } } },
              },
            },
          },
        },
      },
      "/prescriptions": {
        get: {
          tags: ["Prescriptions"],
          summary: "List prescriptions",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "patient_id", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "visit_id", in: "query", schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: { $ref: "#/components/schemas/Prescription" } },
                      meta: { $ref: "#/components/schemas/StandardMeta" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Prescriptions"],
          summary: "Create an e-prescription",
          description: "Creates an immutable prescription header and nested itemized medication schedule.",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/PrescriptionCreateInput" } },
            },
          },
          responses: {
            "201": {
              content: {
                "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Prescription" } } } },
              },
            },
          },
        },
      },
      "/prescriptions/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["Prescriptions"],
          summary: "Get prescription with items",
          responses: {
            "200": {
              content: {
                "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Prescription" } } } },
              },
            },
          },
        },
      },
      "/lab-orders": {
        get: {
          tags: ["Lab Orders"],
          summary: "List diagnostic lab orders and patient documents",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "patient_id", in: "query", schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: { $ref: "#/components/schemas/LabOrder" } },
                      meta: { $ref: "#/components/schemas/StandardMeta" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Lab Orders"],
          summary: "Record a diagnostic lab document or test order",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    patient_id: { type: "string", format: "uuid" },
                    title: { type: "string" },
                    document_type: { type: "string", default: "lab_report" },
                    storage_path: {
                      type: "string",
                      maxLength: 512,
                      description: "Object key under tenants/<tenant_id>/patients/<patient_id>/ (422 otherwise).",
                    },
                  },
                  required: ["patient_id", "title", "storage_path"],
                },
              },
            },
          },
          responses: {
            "201": {
              content: {
                "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/LabOrder" } } } },
              },
            },
          },
        },
      },
      "/lab-orders/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["Lab Orders"],
          summary: "Get diagnostic lab order details",
          responses: {
            "200": {
              content: {
                "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/LabOrder" } } } },
              },
            },
          },
        },
      },
      "/referrals": {
        get: {
          tags: ["Referrals"],
          summary: "List clinical referrals",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "status", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: { $ref: "#/components/schemas/Referral" } },
                      meta: { $ref: "#/components/schemas/StandardMeta" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Referrals"],
          summary: "Create a clinical referral",
          description: "Requires Doctor Guard assignment (referring_doctor_id). In-network history sharing requires explicit patient consent.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    patient_id: { type: "string", format: "uuid" },
                    referring_doctor_id: { type: "string", format: "uuid" },
                    referred_to_name: { type: "string" },
                    referred_to_specialty: { type: "string" },
                    reason_for_referral: { type: "string" },
                    patient_consents_history_sharing: { type: "boolean", default: false },
                  },
                  required: ["patient_id", "referring_doctor_id", "referred_to_name"],
                },
              },
            },
          },
          responses: {
            "201": {
              content: {
                "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Referral" } } } },
              },
            },
          },
        },
      },
      "/referrals/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        get: {
          tags: ["Referrals"],
          summary: "Get referral details",
          responses: {
            "200": {
              content: {
                "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Referral" } } } },
              },
            },
          },
        },
        patch: {
          tags: ["Referrals"],
          summary: "Update referral status",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { type: "string", enum: ["pending", "accepted", "completed", "cancelled"] } },
                  required: ["status"],
                },
              },
            },
          },
          responses: {
            "200": {
              content: {
                "application/json": { schema: { type: "object", properties: { data: { $ref: "#/components/schemas/Referral" } } } },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "clq_live_*",
          description:
            "ClinicQ Developer API Key. Pass in the HTTP Authorization header: `Bearer clq_live_xxxx...` or `x-api-key: clq_live_xxxx...`.",
        },
      },
      schemas: {
        Patient: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            tenant_id: { type: "string", format: "uuid" },
            full_name: { type: "string" },
            phone: { type: "string", example: "+919876543210" },
            gender: { type: "string", enum: ["male", "female", "other"] },
            date_of_birth: { type: "string", format: "date" },
            age: { type: "integer" },
            blood_group: { type: "string" },
            status: { type: "string", example: "active" },
            is_deleted: { type: "boolean" },
            created_at: { type: "string", format: "date-time" },
          },
          required: ["id", "full_name", "phone"],
        },
        PatientCreateInput: {
          type: "object",
          properties: {
            full_name: { type: "string", example: "Aarav Sharma" },
            phone: { type: "string", example: "+919876543210" },
            gender: { type: "string", enum: ["male", "female", "other"] },
            date_of_birth: { type: "string", format: "date" },
            age: { type: "integer" },
            blood_group: { type: "string", example: "O+" },
            address: { type: "string" },
          },
          required: ["full_name", "phone"],
        },
        Appointment: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            tenant_id: { type: "string", format: "uuid" },
            patient_id: { type: "string", format: "uuid" },
            doctor_id: { type: "string", format: "uuid" },
            scheduled_at: { type: "string", format: "date-time" },
            estimated_duration_minutes: { type: "integer", default: 15 },
            origin_type: { type: "string", enum: ["scheduled", "walk_in"] },
            status: { type: "string", enum: ["scheduled", "in_queue", "in_consultation", "completed", "cancelled"] },
            reason_for_visit: { type: "string" },
            created_at: { type: "string", format: "date-time" },
          },
          required: ["id", "patient_id", "doctor_id", "scheduled_at"],
        },
        AppointmentCreateInput: {
          type: "object",
          properties: {
            patient_id: { type: "string", format: "uuid" },
            doctor_id: { type: "string", format: "uuid" },
            scheduled_at: { type: "string", format: "date-time" },
            estimated_duration_minutes: { type: "integer", default: 15 },
            reason_for_visit: { type: "string" },
          },
          required: ["patient_id", "doctor_id", "scheduled_at"],
        },
        Visit: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            patient_id: { type: "string", format: "uuid" },
            doctor_id: { type: "string", format: "uuid" },
            status: { type: "string" },
            origin_type: { type: "string" },
            reason_for_visit: { type: "string" },
            chief_complaints: { type: "array", items: { type: "string" } },
            clinical_notes: { type: "string" },
            created_at: { type: "string", format: "date-time" },
          },
          required: ["id", "patient_id", "doctor_id"],
        },
        VisitCreateInput: {
          type: "object",
          properties: {
            patient_id: { type: "string", format: "uuid" },
            doctor_id: { type: "string", format: "uuid" },
            origin_type: { type: "string", enum: ["scheduled", "walk_in"], default: "walk_in" },
            reason_for_visit: { type: "string" },
            chief_complaints: { type: "array", items: { type: "string" } },
          },
          required: ["patient_id", "doctor_id"],
        },
        PrescriptionItem: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            medicine_name: { type: "string" },
            dosage: { type: "string" },
            timing: { type: "string" },
            duration: { type: "string" },
            special_instructions: { type: "string" },
          },
          required: ["medicine_name"],
        },
        Prescription: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            tenant_id: { type: "string", format: "uuid" },
            patient_id: { type: "string", format: "uuid" },
            doctor_id: { type: "string", format: "uuid" },
            visit_id: { type: "string", format: "uuid" },
            version: { type: "integer" },
            status: { type: "string" },
            items: { type: "array", items: { $ref: "#/components/schemas/PrescriptionItem" } },
            created_at: { type: "string", format: "date-time" },
          },
          required: ["id", "patient_id", "doctor_id", "visit_id", "items"],
        },
        PrescriptionCreateInput: {
          type: "object",
          properties: {
            patient_id: { type: "string", format: "uuid" },
            doctor_id: { type: "string", format: "uuid" },
            visit_id: { type: "string", format: "uuid" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  medicine_name: { type: "string" },
                  dosage: { type: "string" },
                  timing: { type: "string" },
                  duration: { type: "string" },
                  special_instructions: { type: "string" },
                },
                required: ["medicine_name"],
              },
            },
          },
          required: ["patient_id", "doctor_id", "visit_id", "items"],
        },
        LabOrder: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            patient_id: { type: "string", format: "uuid" },
            title: { type: "string" },
            document_type: { type: "string" },
            original_filename: { type: "string" },
            storage_path: { type: "string" },
            created_at: { type: "string", format: "date-time" },
          },
          required: ["id", "patient_id", "title"],
        },
        Referral: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            patient_id: { type: "string", format: "uuid" },
            referring_doctor_id: { type: "string", format: "uuid" },
            referred_to_name: { type: "string" },
            referred_to_specialty: { type: "string" },
            reason_for_referral: { type: "string" },
            status: { type: "string" },
            patient_consents_history_sharing: { type: "boolean" },
            created_at: { type: "string", format: "date-time" },
          },
          required: ["id", "patient_id", "referring_doctor_id", "referred_to_name"],
        },
        StandardMeta: {
          type: "object",
          properties: {
            page: { type: "integer" },
            limit: { type: "integer" },
            total: { type: "integer" },
            total_pages: { type: "integer" },
          },
          required: ["page", "limit", "total", "total_pages"],
        },
        ApiError: {
          type: "object",
          properties: {
            code: { type: "string", example: "INVALID_INPUT" },
            message: { type: "string", example: "Phone number is required." },
            details: { type: "object" },
          },
          required: ["code", "message"],
        },
      },
      responses: {
        BadRequest: {
          description: "Bad Request — Invalid payload or schema validation failure",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { error: { $ref: "#/components/schemas/ApiError" } },
                required: ["error"],
              },
            },
          },
        },
        Unauthorized: {
          description: "Unauthorized — Missing, expired, or invalid API key",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { error: { $ref: "#/components/schemas/ApiError" } },
                required: ["error"],
              },
            },
          },
        },
        NotFound: {
          description: "Not Found — Entity does not exist or belongs to another tenant",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { error: { $ref: "#/components/schemas/ApiError" } },
                required: ["error"],
              },
            },
          },
        },
        RateLimited: {
          description: "Too Many Requests — Rate limit threshold exceeded (default: 120 req/min)",
          headers: {
            "X-RateLimit-Limit": { schema: { type: "integer" } },
            "X-RateLimit-Remaining": { schema: { type: "integer" } },
            "X-RateLimit-Reset": { schema: { type: "integer" } },
            "Retry-After": { schema: { type: "integer" } },
          },
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { error: { $ref: "#/components/schemas/ApiError" } },
                required: ["error"],
              },
            },
          },
        },
      },
    },
  };
}
