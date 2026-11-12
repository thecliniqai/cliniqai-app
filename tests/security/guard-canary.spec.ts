/**
 * P0-13 canary (V2-02 plan 02-02 step 4): the guard engine catches a deliberately unguarded action and route.
 *
 * lint-fixtures/p0-13/unguarded-action.ts is a `"use server"` export that reads `patients` through the request client
 * with no guard and returns the rows; lint-fixtures/p0-13/unguarded-route.ts is a GET handler that does the same and
 * answers 200. With the fixture directory added to the inventory:
 *   (a) the completeness check reports both as missing from the manifest;
 *   (b) given a temporary manifest entry claiming `clinic:manage`, the static check reports the drift, the
 *       receptionist (who lacks it) is not refused and reaches `patients`, and the unauthenticated leg is not refused;
 *   (c) the route engine reports a 200 without a session.
 * The CI canary step (scripts/ci/guard-canary.mjs) additionally proves guard-actions.spec.ts itself fails when the
 * fixture is copied into features/.
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildInventory } from "@/scripts/inventory-server-actions";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ACTION_GUARDS, ROUTE_GUARDS } from "./guard-manifest";
import {
  actionCases,
  completeness,
  refusedActionLeg,
  report,
  ROOT,
  routeCases,
  sessionRouteDenialLegs,
  staticGuardViolations,
  unauthenticatedActionLeg,
  type RequestSlot,
} from "./guard/engine";
import type { TenantBIds } from "./guard/world";

const slot = vi.hoisted((): RequestSlot => ({ client: null }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => slot.client };
});

const FIXTURE_DIR = "lint-fixtures/p0-13";
const ACTION_KEY = `${FIXTURE_DIR}/unguarded-action.ts#listCanaryPatients`;
const ROUTE_KEY = `${FIXTURE_DIR}/unguarded-route.ts#GET`;

const inventory = buildInventory({ extraDirs: [FIXTURE_DIR] });
const actionCase = actionCases(inventory).find((c) => c.key === ACTION_KEY);
const routeCase = routeCases(inventory).find((c) => c.key === ROUTE_KEY);

/** Ids that exist nowhere: the fixture takes no arguments, the engine only needs the shape. */
const NO_TENANT_B = Object.fromEntries(
  ["tenant", "ownerUser", "membership", "patient", "visit", "invoice", "invoiceItem", "document", "prescription",
    "rxItem", "referral", "block", "waitlist", "notification", "webhookSub", "apiKey", "diagnosis"].map((k) => [k, randomUUID()])
) as unknown as TenantBIds;

describe("P0-13 canary: an unguarded action and route are caught", () => {
  let owner: SeededTenant;
  let receptionist: SeededTenant;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Guard Canary ${randomUUID().slice(0, 8)}`);
    receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
    const { error } = await getAdminClient().from("patients").insert({
      tenant_id: owner.tenantId,
      full_name: "Synthetic Canary Patient",
      phone: "+919800000401",
      sex: "male",
      age: 30,
      created_by: owner.userId,
    });
    if (error) throw new Error(`canary patient seed failed: ${error.message}`);
  }, 60_000);

  it("(a) the fixture action and route are inventoried and reported missing from the manifest", () => {
    expect(actionCase?.staticGuard).toBeNull();
    expect(routeCase?.method).toBe("GET");
    const actions = completeness(
      actionCases(inventory).map((c) => c.key),
      Object.keys(ACTION_GUARDS)
    );
    const routes = completeness(
      routeCases(inventory).map((c) => c.key),
      Object.keys(ROUTE_GUARDS)
    );
    expect(actions.missing).toEqual([ACTION_KEY]);
    expect(routes.missing).toEqual([ROUTE_KEY]);
    expect(actions.stale).toEqual([]);
    expect(routes.stale).toEqual([]);
  });

  it("(b) a manifest entry claiming clinic:manage does not hide it: static drift, receptionist and anonymous not refused", async () => {
    if (!actionCase) throw new Error("fixture action not inventoried");
    const mod = (await import(path.join(ROOT, actionCase.file))) as Record<string, (...a: unknown[]) => unknown>;
    const fn = mod[actionCase.name];

    const drift = staticGuardViolations(actionCase, "clinic:manage");
    expect(report(drift)).toContain("manifest says clinic:manage but the body reaches no guard call");

    const asReceptionist = report(await refusedActionLeg(slot, actionCase, fn, receptionist.client, "role receptionist", NO_TENANT_B));
    expect(asReceptionist).toContain(`${ACTION_KEY} [role receptionist] not refused: returned`);
    expect(asReceptionist).toContain("Synthetic Canary Patient");
    expect(asReceptionist).toContain("data access before the refusal: from:patients");

    const anonymous = report(await unauthenticatedActionLeg(slot, actionCase, fn, NO_TENANT_B));
    expect(anonymous).toContain(`${ACTION_KEY} [unauthenticated] not refused: returned`);
    expect(anonymous).toContain("data access without a session: from:patients");
  });

  it("(c) the route engine reports 200 without a session and the lacking role reaching patients", async () => {
    if (!routeCase) throw new Error("fixture route not inventoried");
    const violations = report(
      await sessionRouteDenialLegs(
        slot,
        routeCase,
        { kind: "session", permission: "clinic:manage", resource: "patient" },
        null,
        randomUUID(),
        { receptionist: receptionist.client }
      )
    );
    expect(violations).toContain(`${ROUTE_KEY} [unauthenticated] status 200, expected 401/404`);
    expect(violations).toContain(`${ROUTE_KEY} [role receptionist lacks clinic:manage] status 200, expected 403/404`);
    expect(violations).toContain("request-client data access: from:patients");
  });
});
