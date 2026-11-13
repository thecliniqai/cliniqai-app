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
 *      back; afterwards every B row is byte-identical and no tenant-A row references a B id. B's ids are forged all at
 *      once AND one reference at a time inside otherwise-valid tenant-A inputs (02-06, IR-F2/AR-M2a), and a positive
 *      control proves those inputs succeed (tests/security/guard/valid-inputs.ts; LEG3_CONTROL_EXEMPT for the few that
 *      cannot), so a refusal is attributable to the forged reference;
 *   3b. the same with a user who holds that role in A AND a membership in B, acting in A (02-06, AR-M2b): RLS admits
 *      both clinics, so only the services' own tenant filters keep B's rows out of reach;
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
import { ACTION_GUARDS, LEG3_CONTROL_EXEMPT, type ActionGuard } from "./guard-manifest";
import {
  actionCases,
  argsFor,
  aRowsReferencingB,
  completeness,
  countRows,
  crossTenantActionLeg,
  forgeAt,
  leastPrivilegedHolding,
  pathLabel,
  positiveControlLeg,
  referenceSlots,
  refusedActionLeg,
  report,
  ROOT,
  rolesLacking,
  selfActionLeg,
  selfParamViolations,
  staticGuardViolations,
  tenantSnapshot,
  unauthenticatedActionLeg,
  type ActionCase,
  type RequestSlot,
  type Violation,
} from "./guard/engine";
import { VALID_INPUTS } from "./guard/valid-inputs";
import { seedGuardWorld, type Caller, type GuardWorld, type TenantRowIds } from "./guard/world";

const slot = vi.hoisted((): RequestSlot => ({ client: null, activeTenant: null }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => slot.client };
});

// The active-clinic cookie of a user with several memberships (lib/auth/tenant.ts), set per call by the engine.
vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  const store = {
    get: (name: string) =>
      name === "clinic_active_tenant" && slot.activeTenant ? { name, value: slot.activeTenant } : undefined,
    getAll: () => (slot.activeTenant ? [{ name: "clinic_active_tenant", value: slot.activeTenant }] : []),
    has: (name: string) => name === "clinic_active_tenant" && !!slot.activeTenant,
    set: () => undefined,
    delete: () => undefined,
  };
  return { ...actual, cookies: async () => store };
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

/** No membership needed: onboarding/invitation (`authenticated`) and own-account actions (`self`, 03-12a). */
const isAuthenticatedOnly = (g: ActionGuard | undefined) => typeof g === "object" && ("authenticated" in g || "self" in g);
const isSelf = (g: ActionGuard | undefined) => typeof g === "object" && "self" in g;
const leg3Role = (g: ActionGuard) => leastPrivilegedHolding(typeof g === "string" ? g : null);

/** Otherwise-valid tenant-A inputs for `c` over the row set `a` (valid-inputs.ts, else the generic id filler). */
function validArgs(c: ActionCase, a: TenantRowIds, caller: Caller): unknown[] {
  const entry = VALID_INPUTS[c.key];
  return entry ? entry.args(a, { caller }) : argsFor(c, a);
}

/**
 * Leg 3 for one action and one caller: every B id at once, then (on fresh tenant-A rows each time) the positive
 * control and one variant per reference with only that reference set to B's id.
 */
async function perReferenceLegs(
  c: ActionCase,
  fn: (...args: unknown[]) => unknown,
  world: GuardWorld,
  caller: Caller & { client: object },
  activeTenant: string | null,
  label: string
): Promise<Violation[]> {
  const out: Violation[] = [];
  out.push(...(await crossTenantActionLeg(slot, c, fn, caller.client, world, argsFor(c, world.b), `${label}: every B id`, activeTenant)));

  const controlRows = await world.aRows(caller);
  const controlArgs = validArgs(c, controlRows, caller);
  const slots = referenceSlots(controlArgs, controlRows);
  if (slots.length > 0 && LEG3_CONTROL_EXEMPT[c.key] === undefined) {
    out.push(
      ...(await positiveControlLeg(slot, c, fn, caller.client, controlArgs, {
        voidResult: VALID_INPUTS[c.key]?.voidResult,
        activeTenant,
        leg: `${label}: positive control`,
      }))
    );
  }
  for (const at of slots) {
    const rows = await world.aRows(caller);
    const forged = forgeAt(validArgs(c, rows, caller), at, rows, world.b);
    out.push(...(await crossTenantActionLeg(slot, c, fn, caller.client, world, forged, `${label}: B id at ${pathLabel(at)}`, activeTenant)));
  }
  return out;
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

  it("the inventory sees every entry point: no inline \"use server\", no non-.ts route or action module (IR-F3)", () => {
    const blind = inventory.flagged.filter((f) => f.rule.startsWith("P0-13:"));
    expect(blind.map((f) => `${f.file} ${f.where}: ${f.rule}`)).toEqual([]);
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
        return g !== undefined && !isAuthenticatedOnly(g);
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

    describe("self leg: own-account actions take no id and touch nothing but auth (03-12a)", () => {
      const selfCases = cases.filter((c) => isSelf(ACTION_GUARDS[c.key]));
      let before: Record<string, number>;
      beforeAll(async () => {
        before = await countRows(admin);
      });

      it("the change-password and reset actions are self actions (the leg is not vacuous)", () => {
        expect(selfCases.map((c) => c.key).sort()).toEqual([
          "features/auth/actions.ts#changePasswordAction",
          "features/auth/actions.ts#setNewPasswordAction",
        ]);
      });

      it.each(selfCases.map(label))("%s", async (_k, c) => {
        const violations = [...selfParamViolations(c)];
        for (const caller of [world.outsider, world.roles.receptionist, world.roles.owner]) {
          violations.push(...(await selfActionLeg(slot, c, await load(c), caller.client, world)));
        }
        expect(violations, report(violations)).toEqual([]);
      });

      it("wrote nothing", async () => {
        expect(await countRows(admin)).toEqual(before);
      });
    });

    describe("leg 3: tenant B's ids, least-privileged role holding the permission", () => {
      // `self` actions take no reference to forge (password fields only, checked statically) and have no tenant
      // inputs that could succeed as a control; the self leg above runs their forged-id call instead.
      const manifested = cases.filter((c) => ACTION_GUARDS[c.key] !== undefined && !isSelf(ACTION_GUARDS[c.key]));
      let before: Record<string, string>;
      beforeAll(async () => {
        before = await tenantSnapshot(admin, world.b.tenant);
      });

      it("every control exemption names a manifested action that has a reference to forge", async () => {
        const stale: string[] = [];
        for (const key of Object.keys(LEG3_CONTROL_EXEMPT)) {
          const c = manifested.find((m) => m.key === key);
          if (!c) {
            stale.push(`${key}: not in ACTION_GUARDS`);
            continue;
          }
          const caller: Caller = { userId: world.roles.receptionist.userId, role: "receptionist" };
          const rows = await world.aRows(caller);
          if (referenceSlots(validArgs(c, rows, caller), rows).length === 0) stale.push(`${key}: no reference to forge`);
        }
        expect(stale).toEqual([]);
      }, 60_000);

      it.each(manifested.map(label))("%s", async (_k, c) => {
        const g = ACTION_GUARDS[c.key];
        const caller = isAuthenticatedOnly(g)
          ? { userId: world.outsider.userId, role: "receptionist" as const, client: world.outsider.client }
          : { ...world.roles[leg3Role(g)], client: world.roles[leg3Role(g)].client };
        const violations = await perReferenceLegs(c, await load(c), world, caller, null, "tenant B ids");
        expect(violations, report(violations)).toEqual([]);
      }, 180_000);

      it("every tenant B row is unchanged", async () => {
        expect(await tenantSnapshot(admin, world.b.tenant)).toEqual(before);
      });

      it("no tenant A row references a tenant B id", async () => {
        expect(await aRowsReferencingB(admin, world)).toEqual([]);
      }, 120_000);
    });

    describe("leg 3b: a member of A and B acting in A with A's role (AR-M2b)", () => {
      const inClinic = cases.filter((c) => ACTION_GUARDS[c.key] !== undefined && !isAuthenticatedOnly(ACTION_GUARDS[c.key]));
      let before: Record<string, string>;
      beforeAll(async () => {
        before = await tenantSnapshot(admin, world.b.tenant);
      });

      it("the dual member acts in the clinic the active-clinic cookie names (the leg is not vacuous)", async () => {
        const getPatients = (await import(path.join(ROOT, "features/patients/actions.ts"))).getPatients as () => Promise<Array<{ tenant_id: string }>>;
        const dual = world.dual.receptionist;
        const rows = await world.aRows({ userId: dual.userId, role: "receptionist" });
        expect(rows.patient).toBeTruthy();
        slot.client = dual.client;
        try {
          slot.activeTenant = world.tenantA;
          const inA = await getPatients();
          expect(inA.length).toBeGreaterThan(0);
          expect(inA.every((p) => p.tenant_id === world.tenantA)).toBe(true);
          slot.activeTenant = world.b.tenant;
          const inB = await getPatients();
          expect(inB.some((p) => p.tenant_id === world.b.tenant)).toBe(true);
        } finally {
          slot.client = null;
          slot.activeTenant = null;
        }
      }, 60_000);

      it.each(inClinic.map(label))("%s", async (_k, c) => {
        const role = leg3Role(ACTION_GUARDS[c.key]);
        const dual = world.dual[role];
        const caller = { userId: dual.userId, role, client: dual.client };
        const violations = await perReferenceLegs(c, await load(c), world, caller, world.tenantA, "dual member in A");
        expect(violations, report(violations)).toEqual([]);
      }, 180_000);

      it("every tenant B row is unchanged", async () => {
        expect(await tenantSnapshot(admin, world.b.tenant)).toEqual(before);
      });

      it("no tenant A row references a tenant B id", async () => {
        expect(await aRowsReferencingB(admin, world)).toEqual([]);
      }, 120_000);
    });
  });
});
