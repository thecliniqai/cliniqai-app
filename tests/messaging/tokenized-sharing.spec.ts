import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET as getDocumentRoute } from "@/app/api/r/[token]/route";
import {
  GET as getRescheduleRoute,
  POST as postRescheduleRoute,
} from "@/app/api/reschedule/[token]/route";
import * as adminSupabase from "@/lib/supabase/admin";
import * as appointmentsActions from "@/features/appointments/actions";
import * as storageModule from "@/lib/storage";
import { NextRequest } from "next/server";

describe("Tokenized Sharing & Public Mobile Routes (REQ-reminders-notifications, T-05-06)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("1. Public Document Viewer API (/api/r/[token])", () => {
    const validHexToken = "a".repeat(64);

    it("rejects missing or short token with 400", async () => {
      const req = new NextRequest("http://localhost:3000/api/r/short-token");
      const res = await getDocumentRoute(req, {
        params: Promise.resolve({ token: "short-token" }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid or missing token");
    });

    it("returns 404 when token record does not exist", async () => {
      const mockAdmin = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
            }),
          }),
        }),
      };
      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockAdmin as any);

      const req = new NextRequest(`http://localhost:3000/api/r/${validHexToken}`);
      const res = await getDocumentRoute(req, {
        params: Promise.resolve({ token: validHexToken }),
      });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain("does not exist");
    });

    it("returns 410 when token has been revoked", async () => {
      const mockAdmin = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "token-1",
                  token: validHexToken,
                  revoked_at: new Date().toISOString(),
                  expires_at: new Date(Date.now() + 86400000).toISOString(),
                  tenants: { name: "Clinic A", phone: "+919876543210" },
                },
                error: null,
              }),
            }),
          }),
        }),
      };
      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockAdmin as any);

      const req = new NextRequest(`http://localhost:3000/api/r/${validHexToken}`);
      const res = await getDocumentRoute(req, {
        params: Promise.resolve({ token: validHexToken }),
      });
      expect(res.status).toBe(410);
      const json = await res.json();
      expect(json.error).toContain("has been revoked");
    });

    it("returns 410 when token has expired (>7 days old)", async () => {
      const mockAdmin = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: "token-1",
                  token: validHexToken,
                  revoked_at: null,
                  expires_at: new Date(Date.now() - 1000).toISOString(), // in the past
                  tenants: { name: "Clinic A", phone: "+919876543210" },
                },
                error: null,
              }),
            }),
          }),
        }),
      };
      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockAdmin as any);

      const req = new NextRequest(`http://localhost:3000/api/r/${validHexToken}`);
      const res = await getDocumentRoute(req, {
        params: Promise.resolve({ token: validHexToken }),
      });
      expect(res.status).toBe(410);
      const json = await res.json();
      expect(json.error).toContain("has expired");
    });

    it("resolves patient_document and increments access count", async () => {
      const mockDoc = {
        id: "doc-123",
        title: "Complete Blood Count",
        document_type: "lab_report",
        original_filename: "cbc_report.pdf",
        storage_path: "tenants/t1/doc-123.pdf",
        mime_type: "application/pdf",
        report_date: "2026-10-25",
        patients: { full_name: "Anita Sharma" },
      };

      const updateSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const mockAdmin = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "document_share_tokens") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "token-1",
                      token: validHexToken,
                      tenant_id: "tenant-1",
                      resource_type: "patient_document",
                      resource_id: "doc-123",
                      access_count: 2,
                      expires_at: new Date(Date.now() + 86400000).toISOString(),
                      tenants: { name: "City Care Clinic", phone: "+919876543210" },
                    },
                    error: null,
                  }),
                }),
              }),
              update: updateSpy,
            };
          }
          if (table === "patient_documents") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: mockDoc, error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockAdmin as any);
      vi.spyOn(storageModule, "getSignedUrl").mockResolvedValue({
        signedUrl: "https://storage.supabase.com/signed/cbc_report.pdf",
      });

      const req = new NextRequest(`http://localhost:3000/api/r/${validHexToken}`);
      const res = await getDocumentRoute(req, {
        params: Promise.resolve({ token: validHexToken }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.resource_type).toBe("patient_document");
      expect(json.document.title).toBe("Complete Blood Count");
      expect(json.patient_name).toBe("Anita Sharma");
      expect(json.signed_url).toBe("https://storage.supabase.com/signed/cbc_report.pdf");
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ access_count: 3 })
      );
    });

    it("resolves prescription resource_type cleanly", async () => {
      const mockRx = {
        id: "rx-456",
        pdf_storage_path: "tenant-1/visit-1/rx_v1.pdf",
        patients: { full_name: "Rahul Verma" },
        created_at: "2026-10-26T10:00:00.000Z",
      };

      const mockAdmin = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "document_share_tokens") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "token-2",
                      token: validHexToken,
                      tenant_id: "tenant-1",
                      resource_type: "prescription",
                      resource_id: "rx-456",
                      access_count: 0,
                      expires_at: new Date(Date.now() + 86400000).toISOString(),
                      tenants: { name: "City Care Clinic" },
                    },
                    error: null,
                  }),
                }),
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            };
          }
          if (table === "prescriptions") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: mockRx, error: null }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockAdmin as any);
      vi.spyOn(storageModule, "getSignedUrl").mockResolvedValue({
        signedUrl: "https://storage.supabase.com/signed/rx_v1.pdf",
      });

      const req = new NextRequest(`http://localhost:3000/api/r/${validHexToken}`);
      const res = await getDocumentRoute(req, {
        params: Promise.resolve({ token: validHexToken }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.resource_type).toBe("prescription");
      expect(json.document.title).toBe("Official Prescription");
      expect(json.patient_name).toBe("Rahul Verma");
    });
  });

  describe("2. Public Reschedule API (/api/reschedule/[token])", () => {
    const validRescheduleToken = "b".repeat(64);

    it("rejects invalid reschedule token with 404", async () => {
      const mockAdmin = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: "Not found" } }),
            }),
          }),
        }),
      };
      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockAdmin as any);

      const req = new NextRequest(`http://localhost:3000/api/reschedule/${validRescheduleToken}`);
      const res = await getRescheduleRoute(req, {
        params: Promise.resolve({ token: validRescheduleToken }),
      });
      expect(res.status).toBe(404);
    });

    it("GET returns current appointment and available slot list", async () => {
      const mockVisit = {
        id: "visit-789",
        tenant_id: "tenant-1",
        doctor_id: "doc-1",
        scheduled_at: "2026-10-28T10:00:00.000Z",
        status: "booked",
        patients: { id: "p-1", full_name: "Sunil Joshi", phone: "+919876543210" },
      };

      const mockMember = {
        full_name: "Amitabh Sharma",
        default_specialty: "Cardiology",
        default_slot_duration_minutes: 30,
        availability_schedule: {
          wednesday: {
            enabled: true,
            shifts: [{ start: "10:00", end: "12:00" }],
          },
        },
      };

      const mockAdmin = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "document_share_tokens") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "resched-tok-1",
                      token: validRescheduleToken,
                      tenant_id: "tenant-1",
                      resource_id: "visit-789",
                      expires_at: new Date(Date.now() + 86400000).toISOString(),
                      tenants: { name: "City Care Clinic" },
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "visits") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockImplementation((col: string) => {
                  if (col === "id") {
                    return {
                      single: vi.fn().mockResolvedValue({ data: mockVisit, error: null }),
                    };
                  }
                  return {
                    eq: vi.fn().mockReturnValue({
                      gte: vi.fn().mockReturnValue({
                        lte: vi.fn().mockReturnValue({
                          in: vi.fn().mockResolvedValue({ data: [], error: null }),
                        }),
                      }),
                    }),
                  };
                }),
              }),
            };
          }
          if (table === "memberships") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: mockMember, error: null }),
                  }),
                }),
              }),
            };
          }
          return {};
        }),
      };

      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockAdmin as any);

      const req = new NextRequest(
        `http://localhost:3000/api/reschedule/${validRescheduleToken}?date=2026-10-28`
      );
      const res = await getRescheduleRoute(req, {
        params: Promise.resolve({ token: validRescheduleToken }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.appointment.patient_name).toBe("Sunil Joshi");
      expect(json.appointment.doctor_name).toBe("Amitabh Sharma");
      expect(json.available_slots.length).toBeGreaterThan(0);
    });

    it("POST successfully reschedules appointment and creates in-app notification", async () => {
      const rescheduleSpy = vi.spyOn(appointmentsActions, "rescheduleAppointment").mockResolvedValue({
        success: true,
        appointment: { id: "visit-789", scheduled_at: "2026-10-29T11:00:00.000Z" } as any,
      });

      const tokenUpdateSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const notifInsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });

      const mockAdmin = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "document_share_tokens") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: "resched-tok-1",
                      token: validRescheduleToken,
                      tenant_id: "tenant-1",
                      resource_id: "visit-789",
                      expires_at: new Date(Date.now() + 86400000).toISOString(),
                      tenants: { name: "City Care Clinic" },
                    },
                    error: null,
                  }),
                }),
              }),
              update: tokenUpdateSpy,
            };
          }
          if (table === "in_app_notifications") {
            return {
              insert: notifInsertSpy,
            };
          }
          return {};
        }),
      };

      vi.spyOn(adminSupabase, "getAdminClient").mockReturnValue(mockAdmin as any);

      const futureDate = new Date(Date.now() + 86400000 * 2).toISOString();
      const req = new NextRequest(`http://localhost:3000/api/reschedule/${validRescheduleToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newScheduledAt: futureDate }),
      });

      const res = await postRescheduleRoute(req, {
        params: Promise.resolve({ token: validRescheduleToken }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(rescheduleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          appointmentId: "visit-789",
          newScheduledAt: futureDate,
        }),
        expect.anything()
      );
      expect(tokenUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ revoked_at: expect.any(String) })
      );
      expect(notifInsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: "appointment_rescheduled",
          recipient_role: "receptionist",
        })
      );
    });
  });
});
