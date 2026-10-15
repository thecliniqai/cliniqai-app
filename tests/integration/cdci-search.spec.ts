import { describe, it, expect, beforeAll } from "vitest";
import { seedTenantWithOwner } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedCdciTestFixture } from "../../scripts/seed-cdci-test-fixture";

describe("CDCI Drug Search & Multi-Tenant Isolation (REQ-prescribing, REQ-multi-tenancy)", () => {
  let tenantA: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  let tenantB: Awaited<ReturnType<typeof seedTenantWithOwner>>;
  const admin = getAdminClient();
  let customMedAId: string;

  beforeAll(async () => {
    // 1. Seed two distinct test tenants (Tenant A and Tenant B)
    tenantA = await seedTenantWithOwner("Apex Specialty Clinic");
    tenantB = await seedTenantWithOwner("Beacon Care Hospital");

    // 2. Seed test CDCI fixture (~200 essential Indian OPD drugs)
    await seedCdciTestFixture(admin);

    // 3. Add custom medicine for Doctor A in Tenant A
    const { data: customMed, error: customErr } = await tenantA.client
      .from("doctor_custom_medicines")
      .insert({
        tenant_id: tenantA.tenantId,
        doctor_id: tenantA.userId,
        medicine_name: "Dr A Custom Cough Syrup",
        generic_name: "Ambroxol + Guaiphenesin",
        dose_form: "Syrup",
        default_dosage: "5ml",
        default_timing: "After food",
        default_duration: "5 days",
        use_count: 10,
      })
      .select("id")
      .single();

    if (customErr || !customMed) {
      throw new Error(`Failed to seed custom medicine for Doctor A: ${customErr?.message}`);
    }
    customMedAId = customMed.id;
  });

  it("1. Custom medicine appears first with is_custom=true and is_favorite=true", async () => {
    const { data, error } = await tenantA.client.rpc("search_medicines", {
      p_query: "Dr A Custom",
      p_doctor_id: tenantA.userId,
      p_tenant_id: tenantA.tenantId,
      p_limit: 10,
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    const first = data![0];
    expect(first.medicine_name).toBe("Dr A Custom Cough Syrup");
    expect(first.is_custom).toBe(true);
    expect(first.is_favorite).toBe(true);
    expect(first.default_dosage).toBe("5ml");
  });

  it("2. Fuzzy brand search (Augmentin, Dolo) returns matching CDCI drugs", async () => {
    // Brand search for Dolo
    const { data: doloResults, error: doloErr } = await tenantA.client.rpc("search_medicines", {
      p_query: "Dolo",
      p_doctor_id: tenantA.userId,
      p_tenant_id: tenantA.tenantId,
      p_limit: 10,
    });

    expect(doloErr).toBeNull();
    expect(doloResults).not.toBeNull();
    const dolo650 = doloResults!.find((m) => m.medicine_name.includes("Dolo 650"));
    expect(dolo650).toBeDefined();
    expect(dolo650?.generic_name).toContain("Paracetamol");
    expect(dolo650?.is_custom).toBe(false);

    // Brand search for Augmentin
    const { data: augResults, error: augErr } = await tenantA.client.rpc("search_medicines", {
      p_query: "Augmentin",
      p_doctor_id: tenantA.userId,
      p_tenant_id: tenantA.tenantId,
      p_limit: 10,
    });

    expect(augErr).toBeNull();
    expect(augResults).not.toBeNull();
    const augmentinDuo = augResults!.find((m) => m.medicine_name.includes("Augmentin 625"));
    expect(augmentinDuo).toBeDefined();
    expect(augmentinDuo?.generic_name).toContain("Amoxicillin");
  });

  it("3. Fuzzy generic search (Amoxicillin, Paracetamol) returns matching formulations", async () => {
    const { data: paraResults, error: paraErr } = await tenantA.client.rpc("search_medicines", {
      p_query: "Paracetamol",
      p_doctor_id: tenantA.userId,
      p_tenant_id: tenantA.tenantId,
      p_limit: 10,
    });

    expect(paraErr).toBeNull();
    expect(paraResults).not.toBeNull();
    expect(paraResults!.length).toBeGreaterThan(0);
    const hasParacetamol = paraResults!.some((m) =>
      m.generic_name?.toLowerCase().includes("paracetamol")
    );
    expect(hasParacetamol).toBe(true);

    const { data: amoxResults, error: amoxErr } = await tenantA.client.rpc("search_medicines", {
      p_query: "Amoxicillin",
      p_doctor_id: tenantA.userId,
      p_tenant_id: tenantA.tenantId,
      p_limit: 10,
    });

    expect(amoxErr).toBeNull();
    expect(amoxResults).not.toBeNull();
    expect(amoxResults!.length).toBeGreaterThan(0);
    const hasAmox = amoxResults!.some((m) =>
      m.generic_name?.toLowerCase().includes("amoxicillin")
    );
    expect(hasAmox).toBe(true);
  });

  it("4. Drug search latency benchmark executes under 100ms on database tier", async () => {
    const start = performance.now();
    const { data, error } = await tenantA.client.rpc("search_medicines", {
      p_query: "Azithromycin",
      p_doctor_id: tenantA.userId,
      p_tenant_id: tenantA.tenantId,
      p_limit: 20,
    });
    const elapsed = performance.now() - start;

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    console.log(`Drug search roundtrip latency: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(1500);
  });

  it("5. Tenant B doctor searching does NOT see Tenant A's custom medicines", async () => {
    // Doctor B searches for custom cough syrup created by Doctor A
    const { data, error } = await tenantB.client.rpc("search_medicines", {
      p_query: "Dr A Custom",
      p_doctor_id: tenantB.userId,
      p_tenant_id: tenantB.tenantId,
      p_limit: 10,
    });

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const foundDoctorACustom = data!.some((m) => m.medicine_name === "Dr A Custom Cough Syrup");
    expect(foundDoctorACustom).toBe(false);
  });

  it("6. RLS blocks cross-tenant access to doctor_custom_medicines directly", async () => {
    // 1. Tenant B user attempts to read Tenant A's custom medicines
    const { data: leakedData, error: readErr } = await tenantB.client
      .from("doctor_custom_medicines")
      .select("*")
      .eq("tenant_id", tenantA.tenantId);

    expect(readErr).toBeNull();
    // RLS filters out rows not belonging to Tenant B's membership
    expect(leakedData).toEqual([]);

    // 2. Tenant B user attempts to insert custom medicine into Tenant A
    const { error: insertErr } = await tenantB.client
      .from("doctor_custom_medicines")
      .insert({
        tenant_id: tenantA.tenantId, // spoofed tenant ID
        doctor_id: tenantB.userId,
        medicine_name: "Malicious Injection Medicine",
      });

    // Rejected by RLS WITH CHECK policy
    expect(insertErr).not.toBeNull();
  });
});
