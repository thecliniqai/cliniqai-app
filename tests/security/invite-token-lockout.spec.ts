/**
 * Invitation token lockout (SEC-14, 01-06 ruling R3; moved from the retired dev-logger-lockout spec).
 * `inviteStaff` never returns the raw token or a join link, in any environment, and never logs or writes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { inviteStaffMemberAction } from "@/features/staff/actions";

const inserted: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: "inv-mock-uuid-456" }, error: null }),
          }),
        };
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

describe("inviteStaff never exposes the invitation token", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let spies: Array<{ mockRestore: () => void; mock: { calls: unknown[][] } }> = [];

  beforeEach(() => {
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
      // The row stores only a hash of the token.
      expect(inserted).toHaveLength(1);
      expect(inserted[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(inserted[0])).not.toContain("token");
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
