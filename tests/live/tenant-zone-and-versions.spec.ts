/**
 * V2-09e 09E-04 (R-18): the zone and the clinic's versions in one statement (`getTenantTimeZoneAndVersions`), on a real user-JWT client of the
 * local stack: the versions are the table's (the four domains), the zone is the clinic's, a clinic the caller does not belong to yields no versions
 * (RLS), and a version raised by a write is what the next read returns. Synthetic data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTenantTimeZoneAndVersions } from "@/lib/datetime/server";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { seedVisit } from "../helpers/billing-commands";
import { psql } from "../helpers/sql";

let a: SeededTenant;
let b: SeededTenant;

beforeAll(async () => {
  a = await seedTenantWithOwner("CI Versions Clinic A");
  b = await seedTenantWithOwner("CI Versions Clinic B");
}, 60_000);

afterAll(() => undefined);

const tableVersions = (tenantId: string) =>
  Object.fromEntries(
    psql(`select domain || '=' || version from public.clinic_versions where tenant_id = '${tenantId}' order by domain`).map((line) => {
      const [domain, version] = line.split("=");
      return [domain, Number(version)];
    }),
  );

describe("getTenantTimeZoneAndVersions", () => {
  it("returns the clinic's zone and exactly the four versions the table holds", async () => {
    const read = await getTenantTimeZoneAndVersions(a.client, a.tenantId);
    expect(read.zone).toBe("Asia/Kolkata");
    expect(read.versions).toEqual(tableVersions(a.tenantId));
    expect(Object.keys(read.versions ?? {}).sort()).toEqual(["billing", "queue", "schedule", "settings"]);
  });

  it("returns the version a write raised on the next read", async () => {
    const before = await getTenantTimeZoneAndVersions(a.client, a.tenantId);
    await seedVisit(a);
    const after = await getTenantTimeZoneAndVersions(a.client, a.tenantId);
    expect(after.versions?.queue).toBe((before.versions?.queue ?? 0) + 1);
    expect(after.versions?.schedule).toBe((before.versions?.schedule ?? 0) + 1);
    expect(after.versions?.billing).toBe(before.versions?.billing);
  });

  it("gives another clinic's member no versions (RLS), and the default zone", async () => {
    const read = await getTenantTimeZoneAndVersions(b.client, a.tenantId);
    expect(read.versions).toBeNull();
    expect(read.zone).toBe("Asia/Kolkata");
  });
});
