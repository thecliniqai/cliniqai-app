/**
 * Inventory guard and route extraction (P0-13, V2-02 02-02 step 1): the fields guard-actions.spec.ts and
 * guard-routes.spec.ts rely on. Runs the real `buildInventory` over lint-fixtures/inventory/guards/ (source only; no
 * database, no network).
 */
import { describe, expect, it } from "vitest";
import { buildInventory } from "@/scripts/inventory-server-actions";

const DIR = "lint-fixtures/inventory/guards";
const inventory = buildInventory({ scanDirs: [], extraDirs: [DIR] });
const exports = Object.fromEntries(
  inventory.useServerModules.flatMap((m) => m.exports.map((e) => [e.name, e.guard ?? null] as const))
);

describe("inventory: static guard per \"use server\" export", () => {
  it.each([
    ["directPermission", { call: "resolveServiceContext", permission: "patients:view" }],
    ["legacyTwoArgGuard", { call: "requirePermission", permission: "clinic:manage" }],
    ["constantPermission", { call: "requireServiceContext", permission: "exports:create" }],
    ["membershipOnly", { call: "resolveServiceContext", permission: null }],
    ["delegatedGuard", { call: "delegated:loadWithGuard", permission: "billing:view" }],
    ["firstGuardWins", { call: "getActiveMembership", permission: null }],
    ["aliasOfDirect", { call: "resolveServiceContext", permission: "patients:view" }],
    ["unguarded", null],
  ])("%s", (name, expected) => {
    expect(exports[name]).toEqual(expected);
  });

  it("counts the export that reaches no guard", () => {
    expect(inventory.counts.unguardedUseServerFunctionExports).toBe(1);
  });
});

describe("inventory: route handler methods", () => {
  it("lists exported HTTP methods (aliases included) and nothing else", () => {
    expect(inventory.routeHandlers).toEqual([{ file: `${DIR}/sample-route.ts`, methods: ["GET", "PUT"] }]);
    expect(inventory.counts.routeMethods).toBe(2);
  });

  it("finds every app route module in the default scan", () => {
    const full = buildInventory();
    expect(full.routeHandlers.length).toBeGreaterThan(20);
    for (const r of full.routeHandlers) {
      expect(r.file).toMatch(/^app\/(.+\/)?route\.ts$/);
      expect(r.methods.length, r.file).toBeGreaterThan(0);
    }
  }, 60_000);
});
