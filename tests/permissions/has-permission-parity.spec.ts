/**
 * `has_permission` parity (V2-05 05-01b; roadmap test "the has_permission parity unit test"; ADR-006 / C19, R-41).
 *
 * The app decides with `lib/permissions` (`ROLE_PERMISSIONS`, `hasPerm`); the database decides with the hard-coded
 * CASE in `authz.role_has_permission` (migration 000046). `public.permission_matrix()` expands that CASE into every
 * (role, permission) pair it grants. For every role and every key (the owner's `*` expanded through `hasPerm`) the two
 * answers must agree, and neither side may know a key or role the other lacks. A one-key edit in either source fails
 * here (evidence/05a/05-01b/parity-one-key-edit.txt). Local stack only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@/lib/db/types";
import { hasPerm, PERMISSION_KEYS, ROLE_PERMISSIONS } from "@/lib/permissions";
import { getAdminClient } from "../helpers/supabase-admin";

const ROLES = Object.keys(ROLE_PERMISSIONS) as UserRole[];
let sqlPairs: Set<string>;
let sqlRoles: Set<string>;
let sqlKeys: Set<string>;

beforeAll(async () => {
  const { data, error } = await getAdminClient().rpc("permission_matrix");
  if (error || !data) throw new Error(`permission_matrix failed: ${error?.message}`);
  sqlPairs = new Set(data.map((r) => `${r.role}|${r.perm}`));
  sqlRoles = new Set(data.map((r) => r.role));
  sqlKeys = new Set(data.map((r) => r.perm));
});

describe("lib/permissions and authz.role_has_permission agree", () => {
  it.each(ROLES)("%s: every key has the same answer in TypeScript and SQL", (role) => {
    const mismatches = PERMISSION_KEYS.filter((key) => hasPerm(role, key) !== sqlPairs.has(`${role}|${key}`));
    expect(mismatches).toEqual([]);
  });

  it("SQL grants no key the TypeScript union lacks, and knows every key (the owner holds all of them)", () => {
    expect([...sqlKeys].filter((k) => !(PERMISSION_KEYS as readonly string[]).includes(k))).toEqual([]);
    const ownerKeys = [...sqlPairs].filter((p) => p.startsWith("owner|")).map((p) => p.slice("owner|".length));
    expect(ownerKeys.sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("SQL knows exactly the roles of ROLE_PERMISSIONS", () => {
    expect([...sqlRoles].sort()).toEqual([...ROLES].sort());
  });

  it("the PO-3 set holds on both sides (R-6)", () => {
    for (const [role, key, want] of [
      ["receptionist", "billing:collect", true],
      ["receptionist", "billing:view", true],
      ["receptionist", "patients:edit", true],
      ["admin", "billing:collect", true],
      ["doctor", "billing:collect", false],
      ["nurse", "billing:collect", false],
    ] as const) {
      expect(hasPerm(role, key), `${role} ${key} (TS)`).toBe(want);
      expect(sqlPairs.has(`${role}|${key}`), `${role} ${key} (SQL)`).toBe(want);
    }
  });
});
