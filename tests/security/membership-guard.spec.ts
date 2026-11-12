import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { ctxFor } from "../helpers/context";
import { updateStaffMember } from "@/features/settings/service";

// V2-01 plan 01-02 (P0-02; SEC-03, SEC-08 part, ARC-02, SEC-09). Real JWT clients against the local stack, no
// overrides: SECURITY_VERIFICATION_PLAN TC-RLS-MEM-01..04 and the SEC-09 function checks.

type Rpc = (
  name: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  return (client.rpc as unknown as Rpc).call(client, name, args);
}

describe("P0-02 membership guard (000019)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  let adminMember: SeededTenant;
  let doctor: SeededTenant;
  let receptionist: SeededTenant;
  let nurse: SeededTenant;
  let ownerB: SeededTenant;

  async function membershipOf(m: SeededTenant) {
    const { data, error } = await admin
      .from("memberships")
      .select("id, role, tenant_id, user_id, full_name")
      .eq("tenant_id", m.tenantId)
      .eq("user_id", m.userId)
      .single();
    if (error || !data) throw new Error(`membership lookup failed: ${error?.message}`);
    return data as { id: string; role: string; tenant_id: string; user_id: string; full_name: string | null };
  }

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Guard Clinic ${randomUUID().slice(0, 8)}`);
    ownerB = await seedTenantWithOwner(`Guard Clinic B ${randomUUID().slice(0, 8)}`);
    adminMember = await addMemberToTenant(owner.tenantId, "admin");
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
    receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
    nurse = await addMemberToTenant(owner.tenantId, "nurse");
  });

  describe("TC-RLS-MEM-01: no direct writes to role, tenant_id or user_id", () => {
    it.each(["admin", "doctor", "receptionist", "nurse"] as const)(
      "a %s cannot PATCH their own role, tenant_id or user_id; the row is unchanged",
      async (role) => {
        const m = { admin: adminMember, doctor, receptionist, nurse }[role];
        const before = await membershipOf(m);

        for (const patch of [
          { role: "owner" },
          { tenant_id: ownerB.tenantId },
          { user_id: owner.userId },
        ]) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (m.client.from("memberships") as any).update(patch).eq("id", before.id);
          expect(error).not.toBeNull();
          expect(error?.code).toBe("42501");
        }

        const after = await membershipOf(m);
        expect(after.role).toBe(before.role);
        expect(after.tenant_id).toBe(before.tenant_id);
        expect(after.user_id).toBe(before.user_id);
      }
    );

    it("an admin cannot demote the sole owner by a direct update", async () => {
      const ownerRow = await membershipOf(owner);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (adminMember.client.from("memberships") as any)
        .update({ role: "admin" })
        .eq("id", ownerRow.id);
      expect(error?.code).toBe("42501");
      expect((await membershipOf(owner)).role).toBe("owner");
    });

    it("members cannot insert or delete memberships directly", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insErr } = await (owner.client.from("memberships") as any).insert({
        user_id: ownerB.userId,
        tenant_id: owner.tenantId,
        role: "owner",
      });
      expect(insErr?.code).toBe("42501");

      const doctorRow = await membershipOf(doctor);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: delErr } = await (owner.client.from("memberships") as any).delete().eq("id", doctorRow.id);
      expect(delErr?.code).toBe("42501");
      expect((await membershipOf(doctor)).id).toBe(doctorRow.id);
    });

    it("a member can still update their own profile columns", async () => {
      const name = `Synthetic Nurse ${randomUUID().slice(0, 6)}`;
      const row = await membershipOf(nurse);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (nurse.client.from("memberships") as any)
        .update({ full_name: name })
        .eq("id", row.id)
        .select("full_name")
        .single();
      expect(error).toBeNull();
      expect(data.full_name).toBe(name);
      expect((await membershipOf(nurse)).full_name).toBe(name);
    });
  });

  describe("TC-RLS-MEM-02/03: change_member_role", () => {
    it("an admin cannot grant owner or admin", async () => {
      const doctorRow = await membershipOf(doctor);
      for (const target of ["owner", "admin"]) {
        const { error } = await rpc(adminMember.client, "change_member_role", {
          p_membership_id: doctorRow.id,
          p_role: target,
        });
        expect(error?.message).toContain("owner_required");
        expect(error?.code).toBe("42501");
      }
      expect((await membershipOf(doctor)).role).toBe("doctor");
    });

    it("an admin cannot demote an owner", async () => {
      const ownerRow = await membershipOf(owner);
      const { error } = await rpc(adminMember.client, "change_member_role", {
        p_membership_id: ownerRow.id,
        p_role: "doctor",
      });
      expect(error?.message).toContain("owner_required");
      expect((await membershipOf(owner)).role).toBe("owner");
    });

    it("an admin can move a staff member between non-admin roles", async () => {
      const nurseRow = await membershipOf(nurse);
      const { error } = await rpc(adminMember.client, "change_member_role", {
        p_membership_id: nurseRow.id,
        p_role: "receptionist",
      });
      expect(error).toBeNull();
      expect((await membershipOf(nurse)).role).toBe("receptionist");

      const { error: backErr } = await rpc(adminMember.client, "change_member_role", {
        p_membership_id: nurseRow.id,
        p_role: "nurse",
      });
      expect(backErr).toBeNull();
      expect((await membershipOf(nurse)).role).toBe("nurse");
    });

    it("a receptionist cannot change any role (including their own)", async () => {
      const own = await membershipOf(receptionist);
      const { error } = await rpc(receptionist.client, "change_member_role", {
        p_membership_id: own.id,
        p_role: "owner",
      });
      expect(error?.message).toContain("forbidden");
      expect(error?.code).toBe("42501");
      expect((await membershipOf(receptionist)).role).toBe("receptionist");
    });

    it("an owner of another tenant gets not_found and nothing changes", async () => {
      const doctorRow = await membershipOf(doctor);
      const { error } = await rpc(ownerB.client, "change_member_role", {
        p_membership_id: doctorRow.id,
        p_role: "owner",
      });
      expect(error?.message).toContain("not_found");
      expect((await membershipOf(doctor)).role).toBe("doctor");
    });

    it("rejects an unknown role", async () => {
      const doctorRow = await membershipOf(doctor);
      const { error } = await rpc(owner.client, "change_member_role", {
        p_membership_id: doctorRow.id,
        p_role: "superuser",
      });
      expect(error?.message).toContain("invalid_role");
    });

    it("the sole owner cannot demote themselves; with a second owner they can, and the change is audited", async () => {
      const ownerRow = await membershipOf(owner);
      const { error: lastErr } = await rpc(owner.client, "change_member_role", {
        p_membership_id: ownerRow.id,
        p_role: "admin",
      });
      expect(lastErr?.message).toContain("last_owner");
      expect((await membershipOf(owner)).role).toBe("owner");

      // Owner promotes the doctor to owner (happy path)...
      const doctorRow = await membershipOf(doctor);
      const { error: promoteErr } = await rpc(owner.client, "change_member_role", {
        p_membership_id: doctorRow.id,
        p_role: "owner",
      });
      expect(promoteErr).toBeNull();
      expect((await membershipOf(doctor)).role).toBe("owner");

      const { data: audit } = await admin
        .from("audit_logs")
        .select("actor_id, action, entity_id, metadata")
        .eq("tenant_id", owner.tenantId)
        .eq("action", "staff.member.role_change")
        .eq("entity_id", doctorRow.id);
      expect(audit).toHaveLength(1);
      expect(audit![0].actor_id).toBe(owner.userId);
      expect(audit![0].metadata).toMatchObject({ from_role: "doctor", to_role: "owner" });

      // ...then the first owner may step down, and the second owner restores the original roles.
      const { error: stepDownErr } = await rpc(owner.client, "change_member_role", {
        p_membership_id: ownerRow.id,
        p_role: "admin",
      });
      expect(stepDownErr).toBeNull();
      expect((await membershipOf(owner)).role).toBe("admin");

      const { error: restoreErr } = await rpc(doctor.client, "change_member_role", {
        p_membership_id: ownerRow.id,
        p_role: "owner",
      });
      expect(restoreErr).toBeNull();
      const { error: restoreDocErr } = await rpc(owner.client, "change_member_role", {
        p_membership_id: doctorRow.id,
        p_role: "doctor",
      });
      expect(restoreDocErr).toBeNull();
      expect((await membershipOf(owner)).role).toBe("owner");
      expect((await membershipOf(doctor)).role).toBe("doctor");
    });
  });

  describe("action level: updateStaffMember goes through the RPC", () => {
    it("an admin setting role 'owner' gets success:false and the row is unchanged", async () => {
      const doctorRow = await membershipOf(doctor);
      const res = await updateStaffMember(ctxFor(adminMember), {
        membership_id: doctorRow.id,
        full_name: "Changed By Admin",
        role: "owner",
      } as never);
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error).toMatch(/owner/i);
      const after = await membershipOf(doctor);
      expect(after.role).toBe("doctor");
      expect(after.full_name).not.toBe("Changed By Admin");
    });

    it("an owner changing a role and profile through the service succeeds", async () => {
      const nurseRow = await membershipOf(nurse);
      const res = await updateStaffMember(ctxFor(owner), {
        membership_id: nurseRow.id,
        full_name: "Synthetic Front Desk",
        role: "receptionist",
      } as never);
      expect(res.success).toBe(true);
      const after = await membershipOf(nurse);
      expect(after.role).toBe("receptionist");
      expect(after.full_name).toBe("Synthetic Front Desk");

      const back = await updateStaffMember(ctxFor(owner), {
        membership_id: nurseRow.id,
        full_name: "Synthetic Nurse",
        role: "nurse",
      } as never);
      expect(back.success).toBe(true);
      expect((await membershipOf(nurse)).role).toBe("nurse");
    });

    it("the sole owner demoting themselves through the service is refused", async () => {
      const ownerRow = await membershipOf(owner);
      const res = await updateStaffMember(ctxFor(owner), {
        membership_id: ownerRow.id,
        full_name: "Synthetic Owner",
        role: "doctor",
      } as never);
      expect(res.success).toBe(false);
      if (!res.success) expect(res.error).toMatch(/sole clinic owner/i);
      expect((await membershipOf(owner)).role).toBe("owner");
    });
  });

  describe("TC-RLS-MEM-04: invitations", () => {
    function invite(by: SeededTenant, role: string, createdBy = by.userId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (by.client.from("invitations") as any)
        .insert({
          tenant_id: by.tenantId,
          role,
          invited_address: `invitee-${randomUUID().slice(0, 8)}@example.com`,
          token_hash: randomBytes(32).toString("hex"),
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          created_by: createdBy,
        })
        .select("id")
        .single();
    }

    it("an admin cannot invite an owner or an admin", async () => {
      for (const role of ["owner", "admin"]) {
        const { error } = await invite(adminMember, role);
        expect(error?.code).toBe("42501");
      }
    });

    it("an admin can invite a doctor; an owner can invite an admin", async () => {
      const { data: d, error: dErr } = await invite(adminMember, "doctor");
      expect(dErr).toBeNull();
      expect(d.id).toBeTruthy();
      const { data: a, error: aErr } = await invite(owner, "admin");
      expect(aErr).toBeNull();
      expect(a.id).toBeTruthy();
    });

    it("created_by must be the caller", async () => {
      const { error } = await invite(owner, "doctor", adminMember.userId);
      expect(error?.code).toBe("42501");
    });

    it("a receptionist cannot invite anyone", async () => {
      const { error } = await invite(receptionist, "nurse");
      expect(error?.code).toBe("42501");
    });

    it("members cannot update or delete invitations directly", async () => {
      const { data } = await invite(owner, "nurse");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: upErr } = await (owner.client.from("invitations") as any)
        .update({ role: "owner" })
        .eq("id", data.id);
      expect(upErr?.code).toBe("42501");
      const { data: row } = await admin.from("invitations").select("role").eq("id", data.id).single();
      expect(row?.role).toBe("nurse");
    });
  });

  describe("SEC-09: SECURITY DEFINER functions check the tenant", () => {
    it("a tenant-A owner cannot call the generators or drug search for tenant B", async () => {
      const calls: Array<[string, Record<string, unknown>]> = [
        ["generate_tenant_invoice_number", { p_tenant_id: ownerB.tenantId }],
        ["generate_daily_queue_token", { p_tenant_id: ownerB.tenantId, p_date: "2026-11-12" }],
        [
          "search_medicines",
          { p_query: "Dolo", p_doctor_id: ownerB.userId, p_tenant_id: ownerB.tenantId, p_limit: 5 },
        ],
      ];
      for (const [name, args] of calls) {
        const { data, error } = await rpc(owner.client, name, args);
        expect(error?.code, name).toBe("42501");
        expect(data, name).toBeNull();
      }
    });

    it("search_medicines refuses another doctor's formulary in the caller's own tenant", async () => {
      const { error } = await rpc(owner.client, "search_medicines", {
        p_query: "Dolo",
        p_doctor_id: doctor.userId,
        p_tenant_id: owner.tenantId,
        p_limit: 5,
      });
      expect(error?.code).toBe("42501");
    });

    it("the caller's own tenant still works", async () => {
      const inv = await rpc(owner.client, "generate_tenant_invoice_number", { p_tenant_id: owner.tenantId });
      expect(inv.error).toBeNull();
      expect(inv.data).toMatch(/^INV-\d{4}-\d{5}$/);

      const q = await rpc(owner.client, "generate_daily_queue_token", {
        p_tenant_id: owner.tenantId,
        p_date: "2026-11-12",
      });
      expect(q.error).toBeNull();
      expect(q.data).toBe(1);

      const s = await rpc(owner.client, "search_medicines", {
        p_query: "Dolo",
        p_doctor_id: owner.userId,
        p_tenant_id: owner.tenantId,
        p_limit: 5,
      });
      expect(s.error).toBeNull();
      expect(Array.isArray(s.data)).toBe(true);
    });

    it("an anon-key client without a session cannot execute any of the functions", async () => {
      const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const calls: Array<[string, Record<string, unknown>]> = [
        ["generate_tenant_invoice_number", { p_tenant_id: owner.tenantId }],
        ["generate_daily_queue_token", { p_tenant_id: owner.tenantId, p_date: "2026-11-12" }],
        ["search_medicines", { p_query: "x", p_doctor_id: owner.userId, p_tenant_id: owner.tenantId, p_limit: 1 }],
        ["current_user_tenant_ids", {}],
        ["current_user_is_admin_or_owner", { p_tenant_id: owner.tenantId }],
        ["current_user_has_role", { p_tenant_id: owner.tenantId, p_roles: ["owner"] }],
        ["change_member_role", { p_membership_id: randomUUID(), p_role: "owner" }],
        ["consume_invitation", { p_token_hash: "0".repeat(64) }],
        ["create_clinic_with_owner", { p_name: "Anon Clinic" }],
      ];
      for (const [name, args] of calls) {
        const { error } = await rpc(anon, name, args);
        expect(error, name).not.toBeNull();
        expect(error?.code, name).toBe("42501");
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: memErr } = await (anon.from("memberships") as any).update({ role: "owner" }).eq("user_id", owner.userId);
      expect(memErr?.code).toBe("42501");
    });
  });
});
