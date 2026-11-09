import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { logDevAuthEvent } from "@/lib/auth/dev-logger";
import { requestOtpAction, requestJoinOtpAction } from "@/features/auth/dev-actions";
import { inviteStaffMemberAction } from "@/features/staff/actions";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: "inv-mock-uuid-456" }, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/permissions/guards", () => ({
  requirePermission: vi.fn().mockResolvedValue({
    tenantId: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-000000000002",
    role: "owner",
  }),
}));

describe("Phase 06-05 Task 1: Dev Auth Logger & Staff Invite Token Lockout (D-17, T-06-17)", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnableFlag = process.env.ENABLE_DEV_AUTH_LOGS;

  let consoleLogSpy: any;
  let consoleInfoSpy: any;
  let fsAppendSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    fsAppendSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    fsAppendSpy.mockRestore();
    process.env.NODE_ENV = originalNodeEnv;
    process.env.ENABLE_DEV_AUTH_LOGS = originalEnableFlag;
  });

  describe("1. lib/auth/dev-logger.ts production gate", () => {
    it("strictly suppresses terminal logging and disk persistence when NODE_ENV === 'production'", () => {
      process.env.NODE_ENV = "production";

      logDevAuthEvent({
        type: "LOGIN_OTP",
        email: "doctor@example.com",
        otp: "847291",
      });

      logDevAuthEvent({
        type: "STAFF_INVITATION",
        email: "nurse@example.com",
        role: "nurse",
        link: "https://clinicos.example.com/join?token=secret123",
      });

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(fsAppendSpy).not.toHaveBeenCalled();
    });

    it("does not permit bypass via ENABLE_DEV_AUTH_LOGS in production mode (zero escape hatches)", () => {
      process.env.NODE_ENV = "production";
      process.env.ENABLE_DEV_AUTH_LOGS = "true";

      logDevAuthEvent({
        type: "JOIN_OTP",
        email: "admin@example.com",
        otp: "999888",
      });

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(fsAppendSpy).not.toHaveBeenCalled();
    });
  });

  describe("2. features/auth/dev-actions.ts production credential suppression", () => {
    it("returns null devOtp and null magicLink when NODE_ENV === 'production'", async () => {
      process.env.NODE_ENV = "production";

      const result = await requestOtpAction("doctor@example.com", "login");

      expect(result.success).toBe(true);
      expect(result.devOtp).toBeNull();
      expect(result.magicLink).toBeNull();
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(fsAppendSpy).not.toHaveBeenCalled();
    });

    it("suppresses devOtp and magicLink even if ENABLE_DEV_AUTH_LOGS is set in production", async () => {
      process.env.NODE_ENV = "production";
      process.env.ENABLE_DEV_AUTH_LOGS = "true";

      const result = await requestJoinOtpAction("receptionist@example.com");

      expect(result.success).toBe(true);
      expect(result.devOtp).toBeNull();
      expect(result.magicLink).toBeNull();
      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(fsAppendSpy).not.toHaveBeenCalled();
    });
  });

  describe("3. features/staff/actions.ts rawToken suppression in production", () => {
    it("does not return rawToken or inviteLink when NODE_ENV === 'production'", async () => {
      process.env.NODE_ENV = "production";

      const result = await inviteStaffMemberAction({
        email: "colleague@example.com",
        role: "doctor",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.inviteId).toBe("inv-mock-uuid-456");
        expect(result.rawToken).toBeUndefined();
        expect(result.inviteLink).toBeUndefined();
      }

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(fsAppendSpy).not.toHaveBeenCalled();
    });

    it("also handles FormData input under production without leaking token", async () => {
      process.env.NODE_ENV = "production";

      const formData = new FormData();
      formData.append("email", "nurse2@example.com");
      formData.append("role", "nurse");

      const result = await inviteStaffMemberAction(formData);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.inviteId).toBe("inv-mock-uuid-456");
        expect(result.rawToken).toBeUndefined();
        expect(result.inviteLink).toBeUndefined();
      }

      expect(consoleLogSpy).not.toHaveBeenCalled();
      expect(fsAppendSpy).not.toHaveBeenCalled();
    });
  });
});
