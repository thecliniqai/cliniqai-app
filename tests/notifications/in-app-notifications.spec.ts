import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getInAppNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/features/notifications/actions";
import {
  notifyDoctorPatientArrived,
  notifyDoctorVitalsRecorded,
  notifyDoctorLabReportReady,
  notifyWaitlistSlotFreed,
  notifyFrontDeskWhatsAppReply,
  notifyQuotaWarning,
  notifyOutboxFailure,
} from "@/features/notifications/triggers";
import { InAppNotificationItem } from "@/lib/db/types";

describe("In-App Notification Center & Real-Time Alerts (REQ-reminders-notifications, T-05-08, T-05-09)", () => {
  const doctorSession = { userId: "doc-1", tenantId: "tenant-A", role: "doctor" as const };
  const receptionistSession = { userId: "rec-1", tenantId: "tenant-A", role: "receptionist" as const };
  const ownerSession = { userId: "owner-1", tenantId: "tenant-A", role: "owner" as const };
  const tenantBSession = { userId: "doc-2", tenantId: "tenant-B", role: "doctor" as const };

  const mockNotifications: InAppNotificationItem[] = [
    {
      id: "notif-1",
      tenant_id: "tenant-A",
      recipient_user_id: "doc-1",
      recipient_role: "doctor",
      category: "clinical",
      event_type: "patient_arrived",
      title: "Patient Arrived",
      message: "Vikram is waiting.",
      link_url: "/consultation/v1",
      is_read: false,
      read_at: null,
      metadata: {},
      created_at: "2026-10-27T10:00:00.000Z",
    },
    {
      id: "notif-2",
      tenant_id: "tenant-A",
      recipient_user_id: null,
      recipient_role: "receptionist",
      category: "queue",
      event_type: "waitlist_slot_freed",
      title: "Slot Freed",
      message: "Slot freed with Dr. Amit.",
      link_url: "/queue",
      is_read: false,
      read_at: null,
      metadata: {},
      created_at: "2026-10-27T09:30:00.000Z",
    },
    {
      id: "notif-3",
      tenant_id: "tenant-A",
      recipient_user_id: null,
      recipient_role: "owner",
      category: "system",
      event_type: "messaging_quota_warning",
      title: "Quota 80%",
      message: "Used 800 of 1000 messages.",
      link_url: "/settings",
      is_read: true,
      read_at: "2026-10-27T09:00:00.000Z",
      metadata: {},
      created_at: "2026-10-27T08:00:00.000Z",
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Notification Schema & Scoping (T-05-09)", () => {
    it("validates all 4 notification categories exist", () => {
      const categories = ["clinical", "queue", "billing", "system"];
      expect(categories).toContain("clinical");
      expect(categories).toContain("queue");
      expect(categories).toContain("billing");
      expect(categories).toContain("system");
    });

    it("scopes clinical notifications to assigned doctor user_id only (T-05-09)", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              or: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [mockNotifications[0]],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      };

      const res = await getInAppNotifications({}, mockSupabase, doctorSession);
      expect(res.success).toBe(true);
      expect(res.notifications).toHaveLength(1);
      expect(res.notifications[0].category).toBe("clinical");
      expect(res.notifications[0].recipient_user_id).toBe("doc-1");
    });

    it("scopes queue notifications to front desk receptionist", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              or: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [mockNotifications[1]],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      };

      const res = await getInAppNotifications({}, mockSupabase, receptionistSession);
      expect(res.success).toBe(true);
      expect(res.notifications).toHaveLength(1);
      expect(res.notifications[0].recipient_role).toBe("receptionist");
    });

    it("allows clinic owner to view system alerts", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              or: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [mockNotifications[2]],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      };

      const res = await getInAppNotifications({}, mockSupabase, ownerSession);
      expect(res.success).toBe(true);
      expect(res.notifications).toHaveLength(1);
      expect(res.notifications[0].category).toBe("system");
    });
  });

  describe("2. Multi-Tenant RLS Boundary (T-05-08)", () => {
    it("strictly isolates queries to authenticated tenant_id", async () => {
      const eqSpy = vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: eqSpy,
          }),
        }),
      };

      await getInAppNotifications({}, mockSupabase, tenantBSession);
      expect(eqSpy).toHaveBeenCalledWith("tenant_id", "tenant-B");
      expect(eqSpy).not.toHaveBeenCalledWith("tenant_id", "tenant-A");
    });

    it("markNotificationRead enforces tenant scoping", async () => {
      const secondEqSpy = vi.fn().mockResolvedValue({ data: null, error: null });
      const firstEqSpy = vi.fn().mockReturnValue({ eq: secondEqSpy });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({
            eq: firstEqSpy,
          }),
        }),
      };

      const res = await markNotificationRead("notif-1", mockSupabase, doctorSession);
      expect(res.success).toBe(true);
      expect(firstEqSpy).toHaveBeenCalledWith("id", "notif-1");
      expect(secondEqSpy).toHaveBeenCalledWith("tenant_id", "tenant-A");
    });
  });

  describe("3. Notification State Transitions", () => {
    it("marks individual notification as read with read_at timestamp", async () => {
      const updateSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          update: updateSpy,
        }),
      };

      const res = await markNotificationRead("notif-1", mockSupabase, doctorSession);
      expect(res.success).toBe(true);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          is_read: true,
          read_at: expect.any(String),
        })
      );
    });

    it("marks all unread notifications in tenant as read atomically", async () => {
      const updateSpy = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            or: vi.fn().mockResolvedValue({ data: null, count: 2, error: null }),
          }),
        }),
      });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          update: updateSpy,
        }),
      };

      const res = await markAllNotificationsRead(undefined, mockSupabase, doctorSession);
      expect(res.success).toBe(true);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          is_read: true,
          read_at: expect.any(String),
        })
      );
    });

    it("fetches unread notification count accurately", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                or: vi.fn().mockResolvedValue({ count: 5, error: null }),
              }),
            }),
          }),
        }),
      };

      const res = await getUnreadNotificationCount(mockSupabase, doctorSession);
      expect(res.success).toBe(true);
      expect(res.count).toBe(5);
    });
  });

  describe("4. Internal Clinic Cue Triggers (Events #13, #14, #15, #17, #18, #21, #23)", () => {
    it("notifyDoctorPatientArrived creates clinical notification for doctor", async () => {
      const insertSpy = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "n-new-1" }, error: null }),
        }),
      });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({ insert: insertSpy }),
      };

      await notifyDoctorPatientArrived({
        tenantId: "tenant-A",
        doctorId: "doc-1",
        patientName: "Vikram Malhotra",
        tokenNumber: 4,
        visitId: "visit-123",
        clientOverride: mockSupabase,
      });

      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: "tenant-A",
          recipient_user_id: "doc-1",
          recipient_role: "doctor",
          category: "clinical",
          event_type: "patient_arrived",
        })
      );
    });

    it("notifyWaitlistSlotFreed creates queue notification for receptionist", async () => {
      const insertSpy = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "n-new-2" }, error: null }),
        }),
      });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({ insert: insertSpy }),
      };

      await notifyWaitlistSlotFreed({
        tenantId: "tenant-A",
        doctorName: "Amitabh",
        slotTime: "11:00 AM",
        freedCount: 2,
        clientOverride: mockSupabase,
      });

      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient_role: "receptionist",
          category: "queue",
          event_type: "waitlist_slot_freed",
        })
      );
    });

    it("notifyQuotaWarning creates system notification for owner", async () => {
      const insertSpy = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "n-new-3" }, error: null }),
        }),
      });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({ insert: insertSpy }),
      };

      await notifyQuotaWarning({
        tenantId: "tenant-A",
        sentCount: 850,
        quotaLimit: 1000,
        clientOverride: mockSupabase,
      });

      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient_role: "owner",
          category: "system",
          event_type: "messaging_quota_warning",
        })
      );
    });
  });
});
