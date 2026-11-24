/**
 * V2-09e 09E-06 (R-9, R-18): the rule of "Changed on another device" (`lib/live/use-changed-elsewhere.ts`): a screen's domains against the versions its page
 * read, and the key that tells a new server render from the same one. The notice itself, the signal that moves it and Refresh are proved in a browser by
 * tests/e2e/shell/changed-elsewhere.spec.ts.
 */
import { describe, expect, it } from "vitest";
import type { Versions } from "@/lib/live/domains";
import { basisKeyOf, versionsMoved } from "@/lib/live/use-changed-elsewhere";

const V = (v: Partial<Versions> = {}): Versions => ({ schedule: 4, queue: 7, billing: 2, settings: 1, ...v });

describe("versionsMoved", () => {
  it("is false while nothing is newer than what the page read", () => {
    expect(versionsMoved(["schedule", "billing"], V(), V())).toBe(false);
  });
  it("is true when a domain the screen displays moved", () => {
    expect(versionsMoved(["schedule", "billing"], V(), V({ billing: 3 }))).toBe(true);
    expect(versionsMoved(["settings"], V(), V({ settings: 2 }))).toBe(true);
  });
  it("ignores a domain the screen does not display", () => {
    expect(versionsMoved(["settings"], V(), V({ queue: 99, schedule: 99, billing: 99 }))).toBe(false);
    expect(versionsMoved(["schedule", "queue"], V(), V({ billing: 5, settings: 5 }))).toBe(false);
  });
  it("a version seen that is older than the basis (a late signal) is nothing", () => {
    expect(versionsMoved(["schedule"], V({ schedule: 9 }), V({ schedule: 8 }))).toBe(false);
  });
});

describe("basisKeyOf", () => {
  it("is the same for the same versions and differs when any domain moved (a Refresh hands over a new basis)", () => {
    expect(basisKeyOf(V())).toBe(basisKeyOf(V()));
    for (const domain of ["schedule", "queue", "billing", "settings"] as const) {
      expect(basisKeyOf(V({ [domain]: 50 }))).not.toBe(basisKeyOf(V()));
    }
  });
  it("no basis is its own key (the first confirmed versions are the baseline then)", () => {
    expect(basisKeyOf(undefined)).toBe("");
  });
});

describe("the basis rides on the page's own statement (an embed)", () => {
  const rows = [
    { domain: "schedule", version: 4 },
    { domain: "queue", version: 7 },
    { domain: "billing", version: 2 },
    { domain: "settings", version: 1 },
  ];
  it("parseVersionRows reads all four domains, and nothing less", async () => {
    const { parseVersionRows } = await import("@/lib/live/domains");
    expect(parseVersionRows(rows)).toEqual(V());
    expect(parseVersionRows(rows.slice(0, 3))).toBeNull();
    expect(parseVersionRows(null)).toBeNull();
    expect(parseVersionRows([...rows.slice(0, 3), { domain: "settings", version: -1 }])).toBeNull();
    expect(parseVersionRows([...rows.slice(0, 3), { domain: "other", version: 1 }])).toBeNull();
  });
  it("versionsOfTenantEmbed reads the versions of a row carrying tenants(clinic_versions(...)), as an object or a one-element list", async () => {
    const { versionsOfTenantEmbed } = await import("@/lib/live/domains");
    expect(versionsOfTenantEmbed({ tenants: { clinic_versions: rows } })).toEqual(V());
    expect(versionsOfTenantEmbed({ tenants: [{ clinic_versions: rows }] })).toEqual(V());
    expect(versionsOfTenantEmbed({})).toBeNull();
    expect(versionsOfTenantEmbed(undefined)).toBeNull();
  });
});
