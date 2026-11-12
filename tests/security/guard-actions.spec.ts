/**
 * P0-13 guard enumeration over EVERY server action (V2-02 plan 02-02, T-05; ADR-0005 Verification 3; RL-10).
 *
 * The cases come from scripts/inventory-server-actions.ts (every function export of every `"use server"` module), so a
 * new action is covered automatically, and it fails here until it has an entry in tests/security/guard-manifest.ts.
 * Per action:
 *   0. static: the manifest's permission equals the permission the action's guard call checks (drift either way fails);
 *   1. no session → authentication failure, request client used for nothing but `auth` (the V2-01 sweep in
 *      p0-01-action-sweep.spec.ts stays as the forged-override leg);
 *   2. every role lacking the permission (ROLE_PERMISSIONS) is refused before any data access;
 *   3. the least-privileged role holding it, given tenant B's ids and B as the acting tenant/actor, gets nothing of B
 *      back; afterwards every B row is byte-identical and no tenant-A row references a B id;
 *   4. a signed-in user with no clinic membership is refused (membership-only and permission actions).
 * Legs 1, 2 and 4 write nothing: every tenant table has the same row count before and after each batch.
 *
 * Local stack only: `createClient()` from `@/lib/supabase/server` returns the leg's real client (anonymous or a
 * seeded user's JWT client) behind a recording proxy.
 */
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildInventory } from "@/scripts/inventory-server-actions";
import { getAdminClient } from "../helpers/supabase-admin";
import { ACTION_GUARDS } from "./guard-manifest";
import {
  actionCases,
  aRowsReferencingB,
  completeness,
  countRows,
  crossTenantActionLeg,
  leastPrivilegedHolding,
  refusedActionLeg,
  report,
  ROOT,
  rolesLacking,
  staticGuardViolations,
  tenantSnapshot,
  unauthenticatedActionLeg,
  type ActionCase,
  type RequestSlot,
} from "./guard/engine";
import { seedGuardWorld, type GuardWorld } from "./guard/world";

const slot = vi.hoisted((): RequestSlot => ({ client: null }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => slot.client };
});

// Successful calls in the cross-tenant leg revalidate paths; there is no Next request scope in the test lane.
vi.mock("next/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/cache")>();
  return { ...actual, revalidatePath: () => undefined, revalidateTag: () => undefined };
});

const inventory = buildInventory();
const cases = actionCases(inventory);
const label = (c: ActionCase) => [c.key, c] as const;

async function load(c: ActionCase) {
  const mod = (await import(path.join(ROOT, c.file))) as Record<string, (...args: unknown[]) => unknown>;
  return mod[c.name];
}

describe("P0-13: every server action is in the guard manifest and guarded", () => {
  it("the manifest lists exactly the inventoried actions (a new action without an entry fails here)", () => {
    expect(cases.length).toBeGreaterThan(100);
    const { missing, stale } = completeness(
      cases.map((c) => c.key),
      Object.keys(ACTION_GUARDS)
    );
    expect(missing, `actions with no entry in tests/security/guard-manifest.ts:\n${missing.join("\n")}`).toEqual([]);
    expect(stale, `manifest entries for actions that no longer exist:\n${stale.join("\n")}`).toEqual([]);
  });

  it.each(cases.map(label))("static guard matches the manifest: %s", (_k, c) => {
    const violations = staticGuardViolations(c, ACTION_GUARDS[c.key]);
    expect(violations, report(violations)).toEqual([]);
  });

  it("every inventoried export is a runtime function of its module", async () => {
    for (const c of cases) expect(typeof (await load(c)), c.key).toBe("function");
  }, 120_000);

  describe("seeded legs", () => {
    const admin = getAdminClient();
    let world: GuardWorld;

    beforeAll(async () => {
      world = await seedGuardWorld("Actions");
    }, 120_000);

    describe("leg 1: no session", () => {
      let before: Record<string, number>;
      beforeAll(async () => {
        before = await countRows(admin);
      });

      it.each(cases.map(label))("%s", async (_k, c) => {
        const violations = await unauthenticatedActionLeg(slot, c, await load(c), world.b);
        expect(violations, report(violations)).toEqual([]);
      });

      it("wrote nothing", async () => {
        expect(await countRows(admin)).toEqual(before);
      });
    });

    describe("leg 2: every role lacking the permission", () => {
      const withPermission = cases.filter((c) => {
        const g = ACTION_GUARDS[c.key];
        return g !== undefined && rolesLacking(g).length > 0;
      });
      let before: Record<string, number>;
      beforeAll(async () => {
        before = await countRows(admin);
      });

      it.each(withPermission.map(label))("%s", async (_k, c) => {
        const fn = await load(c);
        const violations = [];
        for (const role of rolesLacking(ACTION_GUARDS[c.key])) {
          violations.push(
            ...(await refusedActionLeg(slot, c, fn, world.roles[role].client, `role ${role}`, world.b))
          );
        }
        expect(violations, report(violations)).toEqual([]);
      });

      it("wrote nothing", async () => {
        expect(await countRows(admin)).toEqual(before);
      });
    });

    describe("leg 4: signed in with no clinic membership", () => {
      const needsMembership = cases.filter((c) => {
        const g = ACTION_GUARDS[c.key];
        return g !== undefined && !(typeof g === "object" && "authenticated" in g);
      });
      let before: Record<string, number>;
      beforeAll(async () => {
        before = await countRows(admin);
      });

      it.each(needsMembership.map(label))("%s", async (_k, c) => {
        const violations = await refusedActionLeg(slot, c, await load(c), world.noMember.client, "no membership", world.b);
        expect(violations, report(violations)).toEqual([]);
      });

      it("wrote nothing", async () => {
        expect(await countRows(admin)).toEqual(before);
      });
    });

    describe("leg 3: tenant B's ids, least-privileged role holding the permission", () => {
      const manifested = cases.filter((c) => ACTION_GUARDS[c.key] !== undefined);
      let before: Record<string, string>;
      beforeAll(async () => {
        before = await tenantSnapshot(admin, world.b.tenant);
      });

      it.each(manifested.map(label))("%s", async (_k, c) => {
        const g = ACTION_GUARDS[c.key];
        const client =
          typeof g === "object" && "authenticated" in g
            ? world.outsider.client
            : world.roles[leastPrivilegedHolding(typeof g === "string" ? g : null)].client;
        const violations = await crossTenantActionLeg(slot, c, await load(c), client, world);
        expect(violations, report(violations)).toEqual([]);
      });

      it("every tenant B row is unchanged", async () => {
        expect(await tenantSnapshot(admin, world.b.tenant)).toEqual(before);
      });

      it("no tenant A row references a tenant B id", async () => {
        expect(await aRowsReferencingB(admin, world)).toEqual([]);
      });
    });
  });
});
