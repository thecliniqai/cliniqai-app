/**
 * Invitation token lockout (SEC-14, 01-06 ruling R3; moved from the retired dev-logger-lockout spec).
 * `inviteStaff` never returns the raw token or a join link, in any environment, and never logs or writes it.
 * V2-05 05-07a (R-30): inviteStaff calls the invite_staff RPC with the session clinic, the address and the role only;
 * no token exists at invite time (the email handler mints it at send time), so none can be sent, returned or logged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { inviteStaffMemberAction } from "@/features/staff/actions";

const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const inserted: unknown[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: { id: "inv-mock-uuid-456", expires_at: "2026-11-18T00:00:00Z", deduped: false }, error: null };
    }),
    from: vi.fn().mockImplementation(() => ({
      insert: vi.fn().mockImplementation((row: unknown) => {
        inserted.push(row);
        return { select: () => ({ single: async () => ({ data: null, error: { code: "42501" } }) }) };
      }),
    })),
  }),
}));

vi.mock("@/lib/permissions/guards", () => ({
  requirePermission: vi.fn().mockResolvedValue({
    tenantId: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-000000000002",
    role: "owner",
  }),
}));

describe("inviteStaff never exposes the invitation token", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let spies: Array<{ mockRestore: () => void; mock: { calls: unknown[][] } }> = [];

  beforeEach(() => {
    calls.length = 0;
    inserted.length = 0;
    spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(fs, "appendFileSync").mockImplementation(() => {}),
      vi.spyOn(fs, "writeFileSync").mockImplementation(() => {}),
    ];
  });

  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
  });

  it.each(["production", "development", "test"])(
    "returns only the invitation id when NODE_ENV=%s",
    async (nodeEnv) => {
      (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;

      const result = await inviteStaffMemberAction({ email: "colleague@example.com", role: "doctor" });

      expect(result).toEqual({ success: true, inviteId: "inv-mock-uuid-456" });
      // One invite_staff call with the session clinic, the address and the role; no token, hash or link is sent, and
      // nothing is inserted directly (the INSERT privilege is revoked, 000088).
      expect(calls).toEqual([
        {
          name: "invite_staff",
          args: { p_tenant: "00000000-0000-0000-0000-000000000001", p_email: "colleague@example.com", p_role: "doctor" },
        },
      ]);
      expect(inserted).toHaveLength(0);
      for (const spy of spies) expect(spy.mock.calls).toHaveLength(0);
    },
  );

  it("handles FormData input the same way", async () => {
    const formData = new FormData();
    formData.append("email", "nurse2@example.com");
    formData.append("role", "nurse");

    const result = await inviteStaffMemberAction(formData);

    expect(result).toEqual({ success: true, inviteId: "inv-mock-uuid-456" });
    for (const spy of spies) expect(spy.mock.calls).toHaveLength(0);
  });
});
